// World node registry (#24, docs/world.md "World node registry (#24)"): which sector and node a
// world object comes from, for EDGEbuilder's inspector. Static nodes (buildings, street
// furniture, decals, lights, foliage) are not entities, and on game 2.5 a sector keeps a node's
// path only as a hash, so nothing in the game API names the node a click hit. RED Hot Tools
// solves it with hooks on sector loading and node-instance setup; this is a port of its
// WorldNodeRegistry and part of its WorldInspector (MIT, by psiberx; LICENSE-RedHotTools.txt
// beside the plugin) to game 2.5, in REDnode's plugin so any package can use it.
//
//   nodes.start {} -> {"attached":[...],"note"}
//     Attaches the hooks (once). Sectors that load from then on are recorded: start it, then
//     load a save so every sector around V loads again. The spike (S24) attaches only on this
//     call, so players who never use it run none of it.
//   nodes.state {} -> {"attached","offset","sectors","setups","instances","hidden","faults",...}
//   nodes.pick {"from":[x,y,z]?,"dir":[x,y,z]?,"max":50,"limit":20,"kinds":[...]?,"all":false,
//               "physics":true}
//     -> {"hits":[node...],"physicsHit":{"point":[x,y,z],"distance":d}|null,"looked":n,"ms":t}
//     Every recorded node whose box the ray crosses, nearest first (bounds mode): decals, lights
//     and objects without collision too. Default ray: the camera's. With physics, the static
//     collision hit is cast too and each hit says whether its box holds that point.
//   nodes.get {"id":"0x<sector>:<instance>"} -> node | null
//   nodes.highlight {"id","on":true,"fill":0,"outline":1,"seeThrough":false,"opacity":1}
//     -> {"done","proxies","why"?}: the game's outline on the node's render proxies
//   nodes.visible {"id","visible":false} -> {"done","was","id"}: hides or shows the node for the
//     session. A hidden node streamed in again is hidden again (on the game thread, after its
//     attach); showing it takes it off that list even when it is not streamed in.
//
// node: {"id","kind" (the node's class),"instanceKind","sector" (path hash),"instance",
//        "instanceCount","index","nodeCount","nodeId","proxyId","interior","position",
//        "orientation","scale","bounds":{"min","max"},"boundsFrom","resource","appearance",
//        "attached","visible","distance"?,"holdsHit"?}
// The id is the sector's path hash and the instance's index in it: the same for a node every
// time its sector loads, so EDGEbuilder can store it (with REDbridge reading the same sector).
//
// What changed for 2.5, read from RED4ext.SDK's types: worldStreamingSector grew by 8 bytes
// between 0x40 and 0xA0, so the node buffer RED Hot Tools reads at +0x40 may be at +0x48. The
// first sectors are checked at both (the setups' count must match the buffer's size, and each
// setup's node must be the node its index names); the place that holds is logged and used.
// Every other layout (CompiledNodeInstanceSetupInfo, the node instances, the render proxies)
// is the same size in the 2.5 SDK; their field offsets are RED Hot Tools' for 2.31, unverified
// on 2.5. Every read of game memory is in a __try function with no C++ objects, so a wrong
// offset answers with an error (and a "faults" count) instead of a crash.

#include "jvalue.hpp"
#include "overlay.hpp"
#include "pins.hpp"

#include <RED4ext/Scripting/Natives/CResource.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
using namespace RED4ext;
using json::Value;

// RED4ext's address list hashes (cyberpunk2077_addresses.json, the same names in 2.31 and 2.5).
constexpr uint32_t SectorReadyHash = 3972601611;    // StreamingSector_OnReady
constexpr uint32_t SectorDtorHash = 3420392384;     // StreamingSector_dtor
constexpr uint32_t NodeInitializeHash = 624308217;  // WorldNodeInstance_Initialize
constexpr uint32_t NodeAttachHash = 3515291207;     // WorldNodeInstance_Attach
constexpr uint32_t NodeVisibilityHash = 2290487415; // WorldNodeInstance_SetVisibility
constexpr uint32_t ProxyVisibilityHash = 1790971865; // RenderProxy_SetVisibility
constexpr uint32_t ProxyHighlightHash = 1093803822; // RenderProxy_SetHighlightParams
constexpr uint32_t ProxyScanningHash = 2838044016;  // RenderProxy_SetScanningState

// RED Hot Tools' offsets (2.31), unverified on 2.5.
constexpr size_t SetupSize = 0x90;      // CompiledNodeInstanceSetupInfo: same size in the 2.5 SDK
constexpr size_t SetupNode = 0x50;      // worldNode*
constexpr size_t SetupNodeId = 0x58;    // globalNodeID
constexpr size_t SetupProxyId = 0x60;   // proxyNodeID
constexpr size_t SetupIndex = 0x78;     // uint16 nodeIndex
constexpr size_t SetupFlags = 0x7A;     // uint16, 0x40: interior
constexpr size_t SetupScale = 0x20;     // Vector3
constexpr size_t BufferNodes = 0x28;    // DynArray<Handle<worldNode>> after the setups' DataBuffer
constexpr size_t InstanceState = 0x88;  // uint16: bit 5 attached, bit 9 visible
constexpr size_t NodeBoundsVfunc = 0x108; // worldNode::GetBoundingBox(Box&), local space

using SectorReady_t = void (*)(void*, uint64_t);
using SectorDtor_t = void (*)(void*);
using NodeInitialize_t = bool (*)(void*, void*, void*);
using NodeAttach_t = bool (*)(void*, void*);
using NodeVisibility_t = void (*)(void*, bool);
using ProxyVisibility_t = void (*)(void*, bool);
struct HighlightParams
{
    bool seeThroughWalls; // 00
    uint8_t patternType;  // 01
    uint8_t fillIndex;    // 02
    uint8_t outlineIndex; // 03
    float opacity;        // 04
    bool forced;          // 08
};
using ProxyHighlight_t = uint8_t (*)(void*, const HighlightParams&);
using ProxyScanning_t = uint8_t (*)(void*, int8_t);

SectorReady_t g_sectorReady = nullptr;
SectorDtor_t g_sectorDtor = nullptr;
NodeInitialize_t g_nodeInitialize = nullptr;
NodeAttach_t g_nodeAttach = nullptr;
void* g_places[5] = {}; // where each hook went, for Detach
bool g_attached[5] = {};
NodeVisibility_t g_nodeVisibility = nullptr;
ProxyVisibility_t g_proxyVisibility = nullptr;
ProxyHighlight_t g_proxyHighlight = nullptr;
ProxyScanning_t g_proxyScanning = nullptr;

// What one setup says, copied when its sector loads.
struct SetupData
{
    uint64_t sector = 0;
    uint32_t instance = 0;
    uint32_t instanceCount = 0;
    uint32_t index = 0;
    uint32_t nodeCount = 0;
    void* node = nullptr;
    uint64_t nodeType = 0; // the node's class name, as a CName hash
    uint64_t nodeId = 0;
    uint64_t proxyId = 0;
    bool interior = false;
    float pos[3] = {};
    float rot[4] = {0, 0, 0, 1};
    float scale[3] = {1, 1, 1};
    // The world box, worked out the first time a pick needs it.
    bool boxDone = false;
    bool boxGood = false;
    float min[3] = {};
    float max[3] = {};
};

SRWLOCK g_lock = SRWLOCK_INIT;
std::unordered_map<const void*, SetupData> g_setups;                      // setup* -> what it says
std::unordered_map<const void*, const void*> g_instanceSetup;             // instance* -> setup*
std::unordered_map<const void*, WeakHandle<ISerializable>> g_setupInstance; // setup* -> instance
std::unordered_map<std::string, const void*> g_byId;                     // "0x<sector>:<i>" -> setup*
std::unordered_set<std::string> g_hidden;                                 // ids hidden for the session
std::deque<const void*> g_attachedQueue;                                  // instances to hide again

std::atomic<int> g_offset{-1}; // the node buffer's place in a sector: 0x40, 0x48, or -1 not yet
std::atomic<uint64_t> g_sectors{0};
std::atomic<uint64_t> g_badSectors{0};
std::atomic<uint64_t> g_faults{0};
std::atomic<uint64_t> g_initialized{0};
std::atomic<uint64_t> g_sectorMs10{0}; // time spent recording sectors, in tenths of a ms
std::string g_offsetNote;

std::string Hex(uint64_t aValue)
{
    char buf[24];
    std::snprintf(buf, sizeof(buf), "0x%llx", static_cast<unsigned long long>(aValue));
    return buf;
}
std::string IdOf(uint64_t aSector, uint32_t aInstance)
{
    return Hex(aSector) + ":" + std::to_string(aInstance);
}
std::string Num(double aValue)
{
    if (!std::isfinite(aValue))
        return "null";
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.3f", aValue);
    std::string s = buf;
    while (!s.empty() && s.back() == '0')
        s.pop_back();
    if (!s.empty() && s.back() == '.')
        s.pop_back();
    return s == "-0" ? "0" : s;
}
std::string Vec(const float* aV, int aN)
{
    std::string out = "[";
    for (int i = 0; i < aN; ++i)
        out += (i ? "," : "") + Num(aV[i]);
    return out + "]";
}

uintptr_t Resolve(uint32_t aHash)
{
    using Resolve_t = uintptr_t (*)(uint32_t);
    static const auto resolve = []() -> Resolve_t {
        const auto red4ext = GetModuleHandleW(L"RED4ext.dll");
        return red4ext ? reinterpret_cast<Resolve_t>(GetProcAddress(red4ext, "RED4ext_ResolveAddress")) : nullptr;
    }();
    return resolve ? resolve(aHash) : 0;
}

bool InImage(const void* aAddress)
{
    static const auto range = []() {
        const auto* base = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
        const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
        const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS*>(base + dos->e_lfanew);
        return std::pair<const uint8_t*, const uint8_t*>(base, base + nt->OptionalHeader.SizeOfImage);
    }();
    const auto* p = static_cast<const uint8_t*>(aAddress);
    return p >= range.first && p < range.second;
}

// ---- guarded reads: no C++ objects in these ----

struct BufferView
{
    const uint8_t* setups;
    uint32_t setupBytes;
    const uint8_t* nodes; // Handle<worldNode> entries, 0x10 each
    uint32_t nodeCount;
    uint32_t nodeCapacity;
};

// Reads the node buffer at aOffset in a sector, and checks it looks like one: the setups'
// size a whole number of setups, the node array's size within its capacity, and the first
// setups' nodes the very nodes their indices name. 1 good, 0 not this place, -1 a fault.
int ReadBuffer(const void* aSector, size_t aOffset, BufferView* aOut)
{
    __try
    {
        const auto* base = static_cast<const uint8_t*>(aSector) + aOffset;
        BufferView v{};
        v.setups = *reinterpret_cast<const uint8_t* const*>(base);
        v.setupBytes = *reinterpret_cast<const uint32_t*>(base + 0x08);
        v.nodes = *reinterpret_cast<const uint8_t* const*>(base + BufferNodes);
        v.nodeCapacity = *reinterpret_cast<const uint32_t*>(base + BufferNodes + 0x08);
        v.nodeCount = *reinterpret_cast<const uint32_t*>(base + BufferNodes + 0x0C);
        if (v.setupBytes % SetupSize != 0 || v.setupBytes / SetupSize > 2000000)
            return 0;
        if (v.nodeCount > v.nodeCapacity || v.nodeCount > 2000000)
            return 0;
        const uint32_t count = v.setupBytes / static_cast<uint32_t>(SetupSize);
        if (count && (!v.setups || !v.nodes))
            return 0;
        const uint32_t check = count < 16 ? count : 16;
        for (uint32_t i = 0; i < check; ++i)
        {
            const uint8_t* s = v.setups + i * SetupSize;
            const uint16_t index = *reinterpret_cast<const uint16_t*>(s + SetupIndex);
            if (index >= v.nodeCount)
                return 0;
            const void* node = *reinterpret_cast<void* const*>(s + SetupNode);
            const void* named = *reinterpret_cast<void* const*>(v.nodes + index * 0x10);
            if (!node || node != named)
                return 0;
        }
        *aOut = v;
        return 1;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return -1;
    }
}

// Copies one setup's fields. False on a fault.
bool CopySetup(const uint8_t* aSetup, SetupData* aOut)
{
    __try
    {
        const auto* pos = reinterpret_cast<const float*>(aSetup); // Transform: position (Vector4), orientation
        aOut->pos[0] = pos[0];
        aOut->pos[1] = pos[1];
        aOut->pos[2] = pos[2];
        for (int i = 0; i < 4; ++i)
            aOut->rot[i] = pos[4 + i];
        const auto* scale = reinterpret_cast<const float*>(aSetup + SetupScale);
        for (int i = 0; i < 3; ++i)
            aOut->scale[i] = scale[i];
        aOut->node = *reinterpret_cast<void* const*>(aSetup + SetupNode);
        aOut->nodeId = *reinterpret_cast<const uint64_t*>(aSetup + SetupNodeId);
        aOut->proxyId = *reinterpret_cast<const uint64_t*>(aSetup + SetupProxyId);
        aOut->index = *reinterpret_cast<const uint16_t*>(aSetup + SetupIndex);
        aOut->interior = (*reinterpret_cast<const uint16_t*>(aSetup + SetupFlags) & 0x40) != 0;
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

// An object's class name as a CName hash, through its vtable's GetType. 0 on a fault.
uint64_t ClassOf(void* aObject)
{
    __try
    {
        if (!aObject)
            return 0;
        auto* type = static_cast<ISerializable*>(aObject)->GetType();
        return type ? type->GetName().hash : 0;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return 0;
    }
}

// The node's own box, in its local space. False when it faults or is no box.
bool NodeBox(void* aNode, float aMin[3], float aMax[3])
{
    __try
    {
        alignas(16) float box[8] = {1, 0, 0, 0, -1, 0, 0, 0}; // Box: Min (Vector4), Max (Vector4)
        auto** vtable = *reinterpret_cast<void***>(aNode);
        auto fn = reinterpret_cast<void (*)(void*, float*)>(vtable[NodeBoundsVfunc / sizeof(void*)]);
        if (!InImage(reinterpret_cast<void*>(fn)))
            return false;
        fn(aNode, box);
        for (int i = 0; i < 3; ++i)
        {
            if (!std::isfinite(box[i]) || !std::isfinite(box[4 + i]) || box[i] > box[4 + i] || box[4 + i] - box[i] > 20000)
                return false;
            aMin[i] = box[i];
            aMax[i] = box[4 + i];
        }
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

// The instance's state bits: 1 attached, 2 visible; -1 on a fault.
int StateOf(const void* aInstance)
{
    __try
    {
        const uint16_t bits = *reinterpret_cast<const uint16_t*>(static_cast<const uint8_t*>(aInstance) + InstanceState);
        return ((bits >> 5) & 1) | (((bits >> 9) & 1) << 1);
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return -1;
    }
}

// A resource path hash (raRef or rRef: the path comes first) and a CName at given offsets.
bool ReadU64(const void* aAt, uint64_t* aOut)
{
    __try
    {
        *aOut = *static_cast<const uint64_t*>(aAt);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

// Up to 64 render proxies of an instance: one SharedPtr at aOffset, or a DynArray of them.
int ProxiesOf(void* aInstance, size_t aOffset, bool aArray, void** aOut)
{
    __try
    {
        auto* at = static_cast<uint8_t*>(aInstance) + aOffset;
        int n = 0;
        if (!aArray)
        {
            void* p = *reinterpret_cast<void**>(at);
            if (p && InImage(*reinterpret_cast<void**>(p)))
                aOut[n++] = p;
            return n;
        }
        auto* entries = *reinterpret_cast<uint8_t**>(at);
        const uint32_t size = *reinterpret_cast<uint32_t*>(at + 0x0C);
        const uint32_t cap = *reinterpret_cast<uint32_t*>(at + 0x08);
        if (size > cap || size > 4096)
            return -1;
        for (uint32_t i = 0; i < size && n < 64; ++i)
        {
            void* p = *reinterpret_cast<void**>(entries + i * 0x10);
            if (p && InImage(*reinterpret_cast<void**>(p)))
                aOut[n++] = p;
        }
        return n;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return -1;
    }
}

bool CallNodeVisibility(void* aInstance, bool aVisible)
{
    __try
    {
        g_nodeVisibility(aInstance, aVisible);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}
bool CallProxyVisibility(void* aProxy, bool aVisible)
{
    __try
    {
        g_proxyVisibility(aProxy, aVisible);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}
bool CallProxyHighlight(void* aProxy, const HighlightParams* aParams, int8_t aScanning)
{
    __try
    {
        g_proxyHighlight(aProxy, *aParams);
        if (g_proxyScanning)
            g_proxyScanning(aProxy, aScanning);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

// ---- recording (streaming threads) ----

void RecordSector(void* aSector)
{
    const auto started = std::chrono::steady_clock::now();
    BufferView v{};
    int offset = g_offset.load();
    if (offset < 0)
    {
        // The first sectors decide where the buffer is: 0x40 (2.31) or 0x48 (2.5 grew the sector).
        const int at40 = ReadBuffer(aSector, 0x40, &v);
        const int at48 = at40 == 1 ? 0 : ReadBuffer(aSector, 0x48, &v);
        if (at40 == 1 || at48 == 1)
        {
            offset = at40 == 1 ? 0x40 : 0x48;
            int expected = -1;
            if (g_offset.compare_exchange_strong(expected, offset))
                Log("World nodes: the sector's node buffer is at +0x%x (checked against its setups)", offset);
            else
                offset = expected;
        }
        else
        {
            if (at40 < 0 || at48 < 0)
                ++g_faults;
            if (++g_badSectors <= 5)
                Log("World nodes: a sector's node buffer was found at neither +0x40 (%d) nor +0x48 (%d)", at40, at48);
            return;
        }
    }
    if (ReadBuffer(aSector, static_cast<size_t>(offset), &v) != 1)
    {
        if (++g_badSectors <= 5)
            Log("World nodes: a sector's node buffer did not check out at +0x%x", offset);
        return;
    }
    const uint64_t sectorHash = reinterpret_cast<CResource*>(aSector)->path.hash;
    const uint32_t count = v.setupBytes / static_cast<uint32_t>(SetupSize);
    std::vector<std::pair<const void*, SetupData>> found;
    found.reserve(count);
    for (uint32_t i = 0; i < count; ++i)
    {
        const uint8_t* s = v.setups + i * SetupSize;
        SetupData d;
        if (!CopySetup(s, &d))
        {
            ++g_faults;
            continue;
        }
        d.sector = sectorHash;
        d.instance = i;
        d.instanceCount = count;
        d.nodeCount = v.nodeCount;
        d.nodeType = ClassOf(d.node);
        found.emplace_back(s, d);
    }
    AcquireSRWLockExclusive(&g_lock);
    for (auto& [setup, d] : found)
    {
        g_byId[IdOf(d.sector, d.instance)] = setup;
        g_setups[setup] = d;
    }
    ReleaseSRWLockExclusive(&g_lock);
    ++g_sectors;
    g_sectorMs10 += static_cast<uint64_t>(
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count() * 10);
}

void ForgetSector(void* aSector)
{
    const int offset = g_offset.load();
    if (offset < 0)
        return;
    BufferView v{};
    if (ReadBuffer(aSector, static_cast<size_t>(offset), &v) != 1)
        return;
    const uint8_t* begin = v.setups;
    const uint8_t* end = v.setups + v.setupBytes;
    AcquireSRWLockExclusive(&g_lock);
    for (const uint8_t* s = begin; s < end; s += SetupSize)
    {
        const auto it = g_setups.find(s);
        if (it == g_setups.end())
            continue;
        const auto byId = g_byId.find(IdOf(it->second.sector, it->second.instance));
        if (byId != g_byId.end() && byId->second == s)
            g_byId.erase(byId);
        g_setups.erase(it);
        g_setupInstance.erase(s);
    }
    for (auto it = g_instanceSetup.begin(); it != g_instanceSetup.end();)
    {
        const auto* s = static_cast<const uint8_t*>(it->second);
        it = (s >= begin && s < end) ? g_instanceSetup.erase(it) : std::next(it);
    }
    ReleaseSRWLockExclusive(&g_lock);
}

void SectorReadyDetour(void* aSector, uint64_t a2)
{
    RecordSector(aSector);
    g_sectorReady(aSector, a2);
}
void SectorDtorDetour(void* aSector)
{
    ForgetSector(aSector);
    g_sectorDtor(aSector);
}
bool NodeInitializeDetour(void* aInstance, void* aSetup, void* a3)
{
    const bool result = g_nodeInitialize(aInstance, aSetup, a3);
    ++g_initialized;
    AcquireSRWLockExclusive(&g_lock);
    if (g_setups.count(aSetup))
    {
        g_instanceSetup[aInstance] = aSetup;
        g_setupInstance[aSetup] = static_cast<ISerializable*>(aInstance)->ref;
    }
    ReleaseSRWLockExclusive(&g_lock);
    return result;
}
bool NodeAttachDetour(void* aInstance, void* a2)
{
    const bool result = g_nodeAttach(aInstance, a2);
    AcquireSRWLockExclusive(&g_lock);
    if (!g_hidden.empty())
        g_attachedQueue.push_back(aInstance); // hidden again on the game thread, if it is one of them
    ReleaseSRWLockExclusive(&g_lock);
    return result;
}

// ---- answers (game thread) ----

// The live instance of a setup, or null when it is not streamed in.
Handle<ISerializable> InstanceOf(const void* aSetup)
{
    const auto it = g_setupInstance.find(aSetup);
    return it == g_setupInstance.end() ? Handle<ISerializable>{} : it->second.Lock();
}

// Rotates v by the unit quaternion q (i, j, k, r).
void Rotate(const float q[4], const float v[3], float out[3])
{
    const float x = q[0], y = q[1], z = q[2], w = q[3];
    const float tx = 2 * (y * v[2] - z * v[1]);
    const float ty = 2 * (z * v[0] - x * v[2]);
    const float tz = 2 * (x * v[1] - y * v[0]);
    out[0] = v[0] + w * tx + (y * tz - z * ty);
    out[1] = v[1] + w * ty + (z * tx - x * tz);
    out[2] = v[2] + w * tz + (x * ty - y * tx);
}

// The setup's box in the world, from the node's local box, its scale, orientation and place.
void WorkOutBox(SetupData& d)
{
    d.boxDone = true;
    float lmin[3], lmax[3];
    if (!d.node || !NodeBox(d.node, lmin, lmax))
        return;
    for (int i = 0; i < 3; ++i)
    {
        d.min[i] = INFINITY;
        d.max[i] = -INFINITY;
    }
    for (int c = 0; c < 8; ++c)
    {
        const float corner[3] = {((c & 1) ? lmax[0] : lmin[0]) * d.scale[0], ((c & 2) ? lmax[1] : lmin[1]) * d.scale[1],
                                 ((c & 4) ? lmax[2] : lmin[2]) * d.scale[2]};
        float r[3];
        Rotate(d.rot, corner, r);
        for (int i = 0; i < 3; ++i)
        {
            d.min[i] = std::min(d.min[i], r[i] + d.pos[i]);
            d.max[i] = std::max(d.max[i], r[i] + d.pos[i]);
        }
    }
    d.boxGood = true;
}

// Where a ray enters a box (0 when it starts inside), or -1 when it misses.
float RayBox(const float o[3], const float dir[3], const float mn[3], const float mx[3])
{
    float t0 = 0, t1 = INFINITY;
    for (int i = 0; i < 3; ++i)
    {
        if (std::fabs(dir[i]) < 1e-8f)
        {
            if (o[i] < mn[i] || o[i] > mx[i])
                return -1;
            continue;
        }
        float a = (mn[i] - o[i]) / dir[i];
        float b = (mx[i] - o[i]) / dir[i];
        if (a > b)
            std::swap(a, b);
        t0 = std::max(t0, a);
        t1 = std::min(t1, b);
        if (t0 > t1)
            return -1;
    }
    return t0;
}

std::string ClassName(uint64_t aHash)
{
    if (!aHash)
        return "";
    const char* s = CName(aHash).ToString();
    return s ? s : Hex(aHash);
}

// The node's resource and appearance, read through its class's RTTI properties.
void ResourceOf(void* aNode, uint64_t aType, std::string& aResource, std::string& aAppearance)
{
    auto* rtti = CRTTISystem::Get();
    auto* cls = aType ? rtti->GetClass(CName(aType)) : nullptr;
    if (!cls)
        return;
    for (const char* name : {"mesh", "meshRef", "material", "entityTemplate", "foliageResource", "particleSystem"})
    {
        auto* prop = cls->GetProperty(name);
        if (!prop)
            continue;
        uint64_t path = 0;
        if (ReadU64(static_cast<uint8_t*>(aNode) + prop->valueOffset, &path) && path)
        {
            aResource = Hex(path);
            break;
        }
    }
    if (auto* prop = cls->GetProperty("meshAppearance"))
    {
        uint64_t name = 0;
        if (ReadU64(static_cast<uint8_t*>(aNode) + prop->valueOffset, &name) && name)
        {
            const char* s = CName(name).ToString();
            aAppearance = s ? s : Hex(name);
        }
    }
}

std::string NodeJson(const void* aSetup, SetupData& d, const char* aExtra)
{
    if (!d.boxDone)
        WorkOutBox(d);
    auto instance = InstanceOf(aSetup);
    const int state = instance ? StateOf(instance.instance) : -1;
    std::string resource, appearance;
    ResourceOf(d.node, d.nodeType, resource, appearance);
    std::string out = "{\"id\":" + JsonString(IdOf(d.sector, d.instance));
    out += ",\"kind\":" + JsonString(ClassName(d.nodeType));
    out += ",\"instanceKind\":" + (instance ? JsonString(ClassName(ClassOf(instance.instance))) : std::string("null"));
    out += ",\"sector\":" + JsonString(Hex(d.sector));
    out += ",\"instance\":" + std::to_string(d.instance) + ",\"instanceCount\":" + std::to_string(d.instanceCount);
    out += ",\"index\":" + std::to_string(d.index) + ",\"nodeCount\":" + std::to_string(d.nodeCount);
    out += ",\"nodeId\":" + (d.nodeId ? JsonString(Hex(d.nodeId)) : std::string("null"));
    out += ",\"proxyId\":" + (d.proxyId ? JsonString(Hex(d.proxyId)) : std::string("null"));
    out += std::string(",\"interior\":") + (d.interior ? "true" : "false");
    out += ",\"position\":" + Vec(d.pos, 3) + ",\"orientation\":" + Vec(d.rot, 4) + ",\"scale\":" + Vec(d.scale, 3);
    out += ",\"bounds\":" + (d.boxGood ? "{\"min\":" + Vec(d.min, 3) + ",\"max\":" + Vec(d.max, 3) + "}" : std::string("null"));
    out += ",\"resource\":" + (resource.empty() ? std::string("null") : JsonString(resource));
    out += ",\"appearance\":" + (appearance.empty() ? std::string("null") : JsonString(appearance));
    out += std::string(",\"streamed\":") + (instance ? "true" : "false");
    out += ",\"attached\":" + std::string(state < 0 ? "null" : (state & 1) ? "true" : "false");
    out += ",\"visible\":" + std::string(state < 0 ? "null" : (state & 2) ? "true" : "false");
    out += std::string(",\"hidden\":") + (g_hidden.count(IdOf(d.sector, d.instance)) ? "true" : "false");
    if (aExtra)
        out += aExtra;
    return out + "}";
}

bool ReadVec(const json::Value* aV, float aOut[3])
{
    if (!aV || aV->kind != Value::Kind::Array || aV->items.size() < 3)
        return false;
    for (int i = 0; i < 3; ++i)
        aOut[i] = static_cast<float>(aV->items[i].number);
    return true;
}
double NumberOr(const json::Value& aParams, const char* aKey, double aDefault)
{
    const auto* v = aParams.Get(aKey);
    return v && v->kind == Value::Kind::Number ? v->number : aDefault;
}
bool BoolOr(const json::Value& aParams, const char* aKey, bool aDefault)
{
    const auto* v = aParams.Get(aKey);
    return v && v->kind == Value::Kind::Bool ? v->boolean : aDefault;
}
std::string StringOr(const json::Value& aParams, const char* aKey)
{
    const auto* v = aParams.Get(aKey);
    return v && v->kind == Value::Kind::String ? v->text : std::string();
}

std::string Start(std::string& aError)
{
    const auto* sdk = GetSdk();
    if (!sdk || !sdk->hooking)
    {
        aError = "RED4ext's hooking is not available";
        return {};
    }
    const struct
    {
        uint32_t hash;
        void* detour;
        void** original;
        const char* name;
    } hooks[] = {
        {SectorReadyHash, reinterpret_cast<void*>(&SectorReadyDetour), reinterpret_cast<void**>(&g_sectorReady), "sectorReady"},
        {SectorDtorHash, reinterpret_cast<void*>(&SectorDtorDetour), reinterpret_cast<void**>(&g_sectorDtor), "sectorGone"},
        {NodeInitializeHash, reinterpret_cast<void*>(&NodeInitializeDetour), reinterpret_cast<void**>(&g_nodeInitialize), "nodeInitialize"},
        {NodeAttachHash, reinterpret_cast<void*>(&NodeAttachDetour), reinterpret_cast<void**>(&g_nodeAttach), "nodeAttach"},
    };
    g_nodeVisibility = reinterpret_cast<NodeVisibility_t>(Resolve(NodeVisibilityHash));
    g_proxyVisibility = reinterpret_cast<ProxyVisibility_t>(Resolve(ProxyVisibilityHash));
    g_proxyHighlight = reinterpret_cast<ProxyHighlight_t>(Resolve(ProxyHighlightHash));
    g_proxyScanning = reinterpret_cast<ProxyScanning_t>(Resolve(ProxyScanningHash));
    std::string attached = "[";
    std::string missing;
    for (size_t i = 0; i < std::size(hooks); ++i)
    {
        if (!g_attached[i])
        {
            const uintptr_t at = Resolve(hooks[i].hash);
            if (!at)
            {
                missing += std::string(missing.empty() ? "" : ", ") + hooks[i].name;
                continue;
            }
            g_places[i] = reinterpret_cast<void*>(at);
            g_attached[i] = sdk->hooking->Attach(GetHandle(), g_places[i], hooks[i].detour, hooks[i].original);
            Log("World nodes: %s hook at +0x%llx %s", hooks[i].name,
                static_cast<unsigned long long>(at - reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr))),
                g_attached[i] ? "attached" : "NOT attached");
        }
        if (g_attached[i])
            attached += std::string(attached.size() > 1 ? "," : "") + JsonString(hooks[i].name);
    }
    attached += "]";
    if (!missing.empty())
        Log("World nodes: the address list lacks %s", missing.c_str());
    if (!g_attached[0] || !g_attached[2])
    {
        aError = "the world node hooks could not be attached" + (missing.empty() ? std::string() : " (missing: " + missing + ")");
        return {};
    }
    return "{\"attached\":" + attached + ",\"note\":" +
           JsonString("Sectors that load from now on are recorded: load a save so the sectors around V load again") + "}";
}

std::string State()
{
    AcquireSRWLockShared(&g_lock);
    const size_t setups = g_setups.size();
    size_t live = 0;
    for (const auto& [s, w] : g_setupInstance)
        live += w.Lock() ? 1 : 0;
    const size_t hidden = g_hidden.size();
    ReleaseSRWLockShared(&g_lock);
    const int offset = g_offset.load();
    std::string out = "{\"attached\":[";
    const char* names[] = {"sectorReady", "sectorGone", "nodeInitialize", "nodeAttach"};
    bool first = true;
    for (int i = 0; i < 4; ++i)
    {
        if (!g_attached[i])
            continue;
        out += std::string(first ? "" : ",") + JsonString(names[i]);
        first = false;
    }
    out += "],\"offset\":" + (offset < 0 ? std::string("null") : JsonString(Hex(static_cast<uint64_t>(offset))));
    out += ",\"sectors\":" + std::to_string(g_sectors.load()) + ",\"badSectors\":" + std::to_string(g_badSectors.load());
    out += ",\"setups\":" + std::to_string(setups) + ",\"instances\":" + std::to_string(live);
    out += ",\"initialized\":" + std::to_string(g_initialized.load());
    out += ",\"hidden\":" + std::to_string(hidden) + ",\"faults\":" + std::to_string(g_faults.load());
    out += ",\"sectorMs\":" + Num(g_sectorMs10.load() / 10.0);
    out += std::string(",\"canHide\":") + (g_nodeVisibility ? "true" : "false");
    out += std::string(",\"canHighlight\":") + (g_proxyHighlight ? "true" : "false") + "}";
    return out;
}

std::string Pick(const json::Value& aParams, std::string& aError)
{
    const auto started = std::chrono::steady_clock::now();
    float from[3], dir[3];
    if (!ReadVec(aParams.Get("from"), from) || !ReadVec(aParams.Get("dir"), dir))
    {
        pins::Camera cam;
        if (!ReadCamera(cam, aError) || !GameCameraForward(dir, aError))
            return {};
        from[0] = cam.px;
        from[1] = cam.py;
        from[2] = cam.pz;
    }
    const float len = std::sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len < 1e-6f)
    {
        aError = "dir must not be zero";
        return {};
    }
    for (float& c : dir)
        c /= len;
    const float max = static_cast<float>(NumberOr(aParams, "max", 50));
    const int limit = static_cast<int>(NumberOr(aParams, "limit", 20));
    const bool all = BoolOr(aParams, "all", false);
    std::unordered_set<std::string> kinds;
    if (const auto* k = aParams.Get("kinds"); k && k->kind == Value::Kind::Array)
        for (const auto& item : k->items)
            kinds.insert(item.text);

    bool hit = false;
    float point[3] = {};
    if (BoolOr(aParams, "physics", true))
    {
        const float to[3] = {from[0] + dir[0] * max, from[1] + dir[1] * max, from[2] + dir[2] * max};
        std::string why;
        if (!RaycastStatic(from, to, hit, point, why))
            hit = false;
    }

    struct Hit
    {
        const void* setup;
        float t;
    };
    std::vector<Hit> hits;
    size_t looked = 0;
    AcquireSRWLockExclusive(&g_lock); // exclusive: boxes are worked out and kept as they are needed
    for (auto& [setup, d] : g_setups)
    {
        // A quick cut first: a node placed far beyond the ray's reach needs no box (500 m covers the largest).
        const float dx = d.pos[0] - from[0], dy = d.pos[1] - from[1], dz = d.pos[2] - from[2];
        if (dx * dx + dy * dy + dz * dz > (max + 500) * (max + 500))
            continue;
        if (!kinds.empty() && !kinds.count(ClassName(d.nodeType)))
            continue;
        ++looked;
        if (!d.boxDone)
            WorkOutBox(d);
        if (!d.boxGood)
            continue;
        const float t = RayBox(from, dir, d.min, d.max);
        if (t < 0 || t > max)
            continue;
        if (!all)
        {
            auto instance = InstanceOf(setup);
            const int state = instance ? StateOf(instance.instance) : -1;
            if (state < 0 || !(state & 1))
                continue;
        }
        hits.push_back({setup, t});
    }
    std::sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) { return a.t < b.t; });
    std::string list = "[";
    for (int i = 0; i < static_cast<int>(hits.size()) && i < limit; ++i)
    {
        auto& d = g_setups[hits[i].setup];
        std::string extra = ",\"distance\":" + Num(hits[i].t);
        if (hit)
        {
            const bool holds = point[0] >= d.min[0] - 0.05f && point[0] <= d.max[0] + 0.05f && point[1] >= d.min[1] - 0.05f &&
                               point[1] <= d.max[1] + 0.05f && point[2] >= d.min[2] - 0.05f && point[2] <= d.max[2] + 0.05f;
            extra += std::string(",\"holdsHit\":") + (holds ? "true" : "false");
        }
        list += (i ? "," : "") + NodeJson(hits[i].setup, d, extra.c_str());
    }
    list += "]";
    ReleaseSRWLockExclusive(&g_lock);
    const float hitDistance =
        hit ? std::sqrt((point[0] - from[0]) * (point[0] - from[0]) + (point[1] - from[1]) * (point[1] - from[1]) +
                        (point[2] - from[2]) * (point[2] - from[2]))
            : 0;
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    return "{\"hits\":" + list + ",\"found\":" + std::to_string(hits.size()) + ",\"physicsHit\":" +
           (hit ? "{\"point\":" + Vec(point, 3) + ",\"distance\":" + Num(hitDistance) + "}" : std::string("null")) +
           ",\"from\":" + Vec(from, 3) + ",\"dir\":" + Vec(dir, 3) + ",\"looked\":" + std::to_string(looked) +
           ",\"ms\":" + Num(ms) + "}";
}

// The setup for an id, under the lock; null when its sector is not loaded.
const void* SetupFor(const std::string& aId)
{
    const auto it = g_byId.find(aId);
    return it == g_byId.end() ? nullptr : it->second;
}

// The render proxies of a node instance, by its class, as RED Hot Tools reads them.
int RenderProxies(void* aInstance, void** aOut)
{
    struct Kind
    {
        const char* cls;
        size_t offset;
        bool array;
    };
    static const Kind kinds[] = {
        {"worldMeshNodeInstance", 0xC8, false},       {"worldStaticDecalNodeInstance", 0xB0, false},
        {"worldBendedMeshNodeInstance", 0xE0, false}, {"worldPhysicalDestructionNodeInstance", 0x1D8, false},
        {"worldInstancedMeshNodeInstance", 0xE8, true}, {"worldFoliageNodeInstance", 0xF8, true},
        {"worldTerrainMeshNodeInstance", 0xC0, true}, {"worldStaticLightNodeInstance", 0xB0, false},
        {"worldStaticParticleNodeInstance", 0xB0, false},
    };
    auto* rtti = CRTTISystem::Get();
    auto* type = static_cast<ISerializable*>(aInstance)->GetType();
    for (const auto& k : kinds)
    {
        auto* cls = rtti->GetClass(k.cls);
        if (cls && type && type->IsA(cls))
            return ProxiesOf(aInstance, k.offset, k.array, aOut);
    }
    return -2; // a kind without render proxies here (an entity, a collision node...)
}

std::string Highlight(const json::Value& aParams, std::string& aError)
{
    const std::string id = StringOr(aParams, "id");
    if (!g_proxyHighlight)
    {
        aError = "this game version's address list lacks the render proxy's highlight";
        return {};
    }
    const bool on = BoolOr(aParams, "on", true);
    HighlightParams params{};
    if (on)
    {
        params.seeThroughWalls = BoolOr(aParams, "seeThrough", false);
        params.fillIndex = static_cast<uint8_t>(NumberOr(aParams, "fill", 0));
        params.outlineIndex = static_cast<uint8_t>(NumberOr(aParams, "outline", 1));
        params.opacity = static_cast<float>(NumberOr(aParams, "opacity", 1));
        params.forced = true;
    }
    AcquireSRWLockShared(&g_lock);
    const void* setup = SetupFor(id);
    auto instance = setup ? InstanceOf(setup) : Handle<ISerializable>{};
    ReleaseSRWLockShared(&g_lock);
    if (!instance)
        return "{\"done\":false,\"proxies\":0,\"why\":" + JsonString(setup ? "not streamed in" : "no such node now") + "}";
    void* proxies[64];
    const int n = RenderProxies(instance.instance, proxies);
    if (n == -2)
        return "{\"done\":false,\"proxies\":0,\"why\":\"this kind of node has no render proxy REDnode knows\"}";
    if (n < 0)
    {
        ++g_faults;
        return "{\"done\":false,\"proxies\":0,\"why\":\"its render proxies could not be read\"}";
    }
    int done = 0;
    for (int i = 0; i < n; ++i)
        done += CallProxyHighlight(proxies[i], &params, on ? 4 /* Complete */ : 0 /* Off */) ? 1 : 0;
    if (done < n)
        g_faults += static_cast<uint64_t>(n - done);
    return "{\"done\":" + std::string(done ? "true" : "false") + ",\"proxies\":" + std::to_string(done) +
           (n == 0 ? ",\"why\":\"no render proxy\"" : "") + "}";
}

// Hides or shows a live instance as RED Hot Tools does: the node instance's own visibility,
// then its render proxies'.
bool ApplyVisible(void* aInstance, bool aVisible)
{
    bool ok = g_nodeVisibility ? CallNodeVisibility(aInstance, aVisible) : false;
    void* proxies[64];
    const int n = RenderProxies(aInstance, proxies);
    if (n > 0 && g_proxyVisibility)
        for (int i = 0; i < n; ++i)
            ok = CallProxyVisibility(proxies[i], aVisible) && ok;
    return ok;
}

std::string Visible(const json::Value& aParams, std::string& aError)
{
    const std::string id = StringOr(aParams, "id");
    if (id.empty())
    {
        aError = "nodes.visible needs an id, such as \"0x1234:56\"";
        return {};
    }
    const bool visible = BoolOr(aParams, "visible", false);
    AcquireSRWLockExclusive(&g_lock);
    if (visible)
        g_hidden.erase(id);
    else
        g_hidden.insert(id);
    const void* setup = SetupFor(id);
    auto instance = setup ? InstanceOf(setup) : Handle<ISerializable>{};
    ReleaseSRWLockExclusive(&g_lock);
    if (!instance)
        return "{\"done\":false,\"id\":" + JsonString(id) + ",\"why\":" +
               JsonString(visible ? "not streamed in (off the hidden list)" : "not streamed in (hidden when it streams in)") + "}";
    const int state = StateOf(instance.instance);
    const bool ok = ApplyVisible(instance.instance, visible);
    if (!ok)
        ++g_faults;
    return "{\"done\":" + std::string(ok ? "true" : "false") + ",\"id\":" + JsonString(id) +
           ",\"was\":" + (state < 0 ? std::string("null") : (state & 2) ? "true" : "false") + "}";
}
} // namespace

bool IsWorldNodesMethod(const std::string& aMethod)
{
    return aMethod.rfind("nodes.", 0) == 0;
}

std::string WorldNodes(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    if (aMethod == "nodes.start")
        return Start(aError);
    if (aMethod == "nodes.state")
        return State();
    if (!g_attached[0])
    {
        aError = "the world node registry is not started: call nodes.start, then load a save";
        return {};
    }
    if (aMethod == "nodes.pick")
        return Pick(aParams, aError);
    if (aMethod == "nodes.get")
    {
        AcquireSRWLockExclusive(&g_lock);
        const void* setup = SetupFor(StringOr(aParams, "id"));
        std::string out = setup ? NodeJson(setup, g_setups[setup], nullptr) : "null";
        ReleaseSRWLockExclusive(&g_lock);
        return out;
    }
    if (aMethod == "nodes.highlight")
        return Highlight(aParams, aError);
    if (aMethod == "nodes.visible")
        return Visible(aParams, aError);
    aError = "Unknown method: " + aMethod;
    return {};
}

// Game thread, each frame: a hidden node that streamed in again is hidden again.
void UpdateWorldNodes()
{
    if (!g_attached[3])
        return;
    std::vector<Handle<ISerializable>> again;
    AcquireSRWLockExclusive(&g_lock);
    while (!g_attachedQueue.empty())
    {
        const void* instance = g_attachedQueue.front();
        g_attachedQueue.pop_front();
        const auto s = g_instanceSetup.find(instance);
        if (s == g_instanceSetup.end())
            continue;
        const auto d = g_setups.find(s->second);
        if (d == g_setups.end() || !g_hidden.count(IdOf(d->second.sector, d->second.instance)))
            continue;
        if (auto h = InstanceOf(s->second))
            again.push_back(h);
    }
    ReleaseSRWLockExclusive(&g_lock);
    for (auto& h : again)
        ApplyVisible(h.instance, false);
}

void StopWorldNodes()
{
    const auto* sdk = GetSdk();
    for (int i = 0; i < 4; ++i)
    {
        if (g_attached[i] && sdk && sdk->hooking)
            sdk->hooking->Detach(GetHandle(), g_places[i]);
        g_attached[i] = false;
    }
}
} // namespace rednode::overlay::detail
