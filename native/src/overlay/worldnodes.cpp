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
//     load a save so every sector around V loads again. Attached only on this call, so players
//     who never use it run none of it.
//   nodes.state {} -> {"attached","layout","sectors","setups","instances","hidden","refused",...}
//   nodes.pick {"from":[x,y,z]?,"dir":[x,y,z]?,"max":50,"limit":20,"kinds":[...]?,"all":false,
//               "physics":true}
//     -> {"hits":[node...],"physicsHit":{"point":[x,y,z],"distance":d}|null,"looked":n,"ms":t}
//     Every recorded node whose box the ray crosses, nearest first (bounds mode). Default ray: the
//     camera's. With physics, the static collision is cast too and each hit says whether its box
//     holds that point.
//   nodes.get {"id":"0x<sector>:<instance>"} -> node | null
//   nodes.highlight {...} -> {"done":false,"why"}: not on 2.5 yet (see below)
//   nodes.visible {"id","visible":false} -> {"done","was","id"}: hides or shows the node for the
//     session, through the game's own WorldNodeInstance_SetVisibility. A hidden node streamed in
//     again is hidden again (on the game thread, after its attach).
//
// node: {"id","kind","instanceKind","sector","instance","instanceCount","index","nodeCount",
//        "nodeId","proxyId","flags","position","orientation","scale","bounds","boundsFrom",
//        "resource","appearance","streamed","attached","visible","hidden","distance"?,"holdsHit"?}
// The id is the sector's path hash and the instance's index in it: the same for a node every
// time its sector loads, so EDGEbuilder can store it (with REDbridge reading the same sector).
//
// Game 2.5 (0.66.1, from 0.66.0's crash and its dump, and a static reading of 2.5's code):
//   - The sector's node buffer is still at +0x40, but its node list moved from buffer+0x28 to
//     buffer+0x30 (8 new bytes after the setups' DataBuffer: the "pointer" 0x44 0.66.0 followed),
//     and a setup's node index from a 16-bit field at +0x78 to +0x80 (the fields after +0x68 moved
//     8 bytes). The layout is not assumed: the first sectors try each candidate place and keep the
//     one where every setup's node is the node its index names, and log it.
//   - A node instance's place (+0x30), orientation (+0x40), scale (+0x50) and node (+0x60) are as
//     RED Hot Tools has them (2.5's WorldNodeInstance_Initialize copies them there); its state
//     bits moved from +0x88 to +0x8C (attached bit 5, visible bit 9).
//   - The game's crash handler takes a fault before __try does, so nothing here relies on __try.
//     Unknown memory (the layout candidates at the first sector, an instance class's fields the
//     first time it is seen) is checked with VirtualQuery before it is read, and an unknown object's
//     class is asked for only once it passes the engine's own check (an ISerializable's weak self
//     handle at +0x08 points back at it). Known memory (the game's own buffers once the layout has
//     checked out, its node and instance objects) is read directly: VirtualQuery costs milliseconds
//     in this game, and the game waits for each sector to be recorded (0.66.2, with a check per
//     setup, held a save load for minutes).
//   - Boxes come from the node instance's mesh (a CMesh handle found among its fields, checked as
//     above, and the mesh's RTTI "boundingBox") rather than worldNode's virtual GetBoundingBox,
//     whose slot (0x108 in 2.31) is unverified on 2.5. A node with no mesh gets a 1 m box at its
//     place (boundsFrom "place").
//   - The outline needs the render proxies' offsets in each instance class, unverified on 2.5, so
//     nodes.highlight answers why not; the first instance of each class logs its candidate fields
//     and vtable slots for a static check.

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
constexpr uint32_t NodeVisibilityHash = 2290487415; // WorldNodeInstance_SetVisibility (instance, bool)
constexpr uint32_t ProxyHighlightHash = 1093803822;  // RenderProxy_SetHighlightParams (proxy, params*): bytes see-through, pattern, fill, outline
constexpr uint32_t ProxyScanningHash = 2838044016;   // RenderProxy_SetScanningState (proxy, state): writes proxy+0x22

constexpr size_t SetupSize = 0x90;
constexpr size_t SetupNode = 0x50;
constexpr size_t SetupNodeId = 0x58;
constexpr size_t SetupProxyId = 0x60;
constexpr size_t InstancePlace = 0x30;  // Vector4, then the orientation quaternion at 0x40
constexpr size_t InstanceScale = 0x50;  // Vector3
constexpr size_t InstanceState = 0x8C;  // 2.5 (0x88 in 2.31): bit 5 attached, bit 9 visible

// The hooked functions are passed all four argument registers and their own return value back,
// whatever they really take and give (0.66.1 dropped OnReady's return value by recording after
// it, and save loads hung on the loading screen).
using Hooked_t = uint64_t (*)(void*, void*, void*, void*);
using SectorReady_t = Hooked_t;
using SectorDtor_t = Hooked_t;
using NodeInitialize_t = Hooked_t;
using NodeAttach_t = Hooked_t;
using NodeVisibility_t = void (*)(void*, bool);
struct HighlightParams
{
    bool seeThroughWalls; // 00
    uint8_t patternType;  // 01
    uint8_t fillIndex;    // 02: 0 clears (2.5 takes another branch)
    uint8_t outlineIndex; // 03
    float opacity;        // 04
    bool forced;          // 08
};
using ProxyHighlight_t = uint8_t (*)(void*, const HighlightParams*);
using ProxyScanning_t = uint8_t (*)(void*, int8_t);
ProxyHighlight_t g_proxyHighlight = nullptr;
ProxyScanning_t g_proxyScanning = nullptr;

SectorReady_t g_sectorReady = nullptr;
SectorDtor_t g_sectorDtor = nullptr;
NodeInitialize_t g_nodeInitialize = nullptr;
NodeAttach_t g_nodeAttach = nullptr;
void* g_places[4] = {};
bool g_attached[4] = {};
NodeVisibility_t g_nodeVisibility = nullptr;

// ---- memory checks: VirtualQuery, since __try does not catch in this game ----

bool Readable(const void* aAt, size_t aBytes)
{
    const auto p = reinterpret_cast<uintptr_t>(aAt);
    if (p < 0x10000 || p > 0x7FFFFFFEFFFF || aBytes == 0)
        return false;
    uintptr_t at = p;
    const uintptr_t end = p + aBytes;
    while (at < end)
    {
        MEMORY_BASIC_INFORMATION mbi{};
        if (!VirtualQuery(reinterpret_cast<void*>(at), &mbi, sizeof(mbi)) || mbi.State != MEM_COMMIT)
            return false;
        const DWORD prot = mbi.Protect & 0xFF;
        if ((mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS)) || prot == PAGE_EXECUTE)
            return false;
        at = reinterpret_cast<uintptr_t>(mbi.BaseAddress) + mbi.RegionSize;
    }
    return true;
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

template<typename T>
bool Read(const void* aAt, T& aOut)
{
    if (!Readable(aAt, sizeof(T)))
        return false;
    std::memcpy(&aOut, aAt, sizeof(T));
    return true;
}

// An engine object: readable, a vtable in the exe, and its weak self handle (ISerializable +0x08)
// pointing back at it. Only then is it safe to ask for its class.
bool IsObject(const void* aObject)
{
    const void* vtable = nullptr;
    const void* self = nullptr;
    if (!Read(aObject, vtable) || !InImage(vtable))
        return false;
    if (!Read(static_cast<const uint8_t*>(aObject) + 0x08, self))
        return false;
    return self == aObject;
}

CClass* TypeOf(void* aObject)
{
    return IsObject(aObject) ? static_cast<ISerializable*>(aObject)->GetType() : nullptr;
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
uint64_t Rva(const void* aAt)
{
    return reinterpret_cast<uintptr_t>(aAt) - reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
}

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

// ---- the layout, found at the first sectors ----

struct Layout
{
    size_t buffer = 0;     // the node buffer in the sector
    size_t nodes = 0;      // the node list in the buffer
    size_t index = 0;      // the node index in a setup
    bool wide = false;     // the index is the low 19 bits of a 32-bit field
};
// One candidate for each version seen: 2.5 first (from the dump), then RED Hot Tools' 2.31.
constexpr Layout Candidates[] = {
    {0x40, 0x30, 0x80, false},
    {0x40, 0x30, 0x70, true},
    {0x40, 0x28, 0x78, false},
    {0x48, 0x30, 0x80, false},
};
std::atomic<int> g_layout{-1}; // index into Candidates

struct BufferView
{
    const uint8_t* setups = nullptr;
    uint32_t setupBytes = 0;
    const uint8_t* nodes = nullptr; // Handle<worldNode> entries, 0x10 each
    uint32_t nodeCount = 0;
};

uint32_t IndexOf(const uint8_t* aSetup, const Layout& aL)
{
    if (aL.wide)
        return *reinterpret_cast<const uint32_t*>(aSetup + aL.index) & 0x7FFFF;
    return *reinterpret_cast<const uint16_t*>(aSetup + aL.index);
}

// Reads the buffer as aL says and checks it: sizes in range, the blocks readable, and each of the
// first 16 setups' node the node its index names.
bool ReadBuffer(const void* aSector, const Layout& aL, BufferView& aOut, bool aCareful)
{
    // aCareful (finding the layout): every read is checked with VirtualQuery. Once a layout has
    // checked out, the sector's buffer is the game's own and is read directly: VirtualQuery
    // costs milliseconds in this game, and the game waits for each sector (0.66.2 took minutes).
    const auto* base = static_cast<const uint8_t*>(aSector) + aL.buffer;
    if (aCareful && !Readable(base, aL.nodes + 0x10))
        return false;
    uint32_t nodeCap = 0;
    std::memcpy(&aOut.setups, base, sizeof(aOut.setups));
    std::memcpy(&aOut.setupBytes, base + 0x08, sizeof(aOut.setupBytes));
    std::memcpy(&aOut.nodes, base + aL.nodes, sizeof(aOut.nodes));
    std::memcpy(&nodeCap, base + aL.nodes + 0x08, sizeof(nodeCap));
    std::memcpy(&aOut.nodeCount, base + aL.nodes + 0x0C, sizeof(aOut.nodeCount));
    if (aOut.setupBytes % SetupSize != 0 || aOut.setupBytes / SetupSize > 2000000 || aOut.nodeCount > nodeCap ||
        aOut.nodeCount > 2000000)
        return false;
    const uint32_t count = aOut.setupBytes / static_cast<uint32_t>(SetupSize);
    if (!count)
        return true;
    if (!aOut.nodeCount || !aOut.setups || !aOut.nodes)
        return false;
    if (aCareful && (!Readable(aOut.setups, aOut.setupBytes) || !Readable(aOut.nodes, aOut.nodeCount * 0x10ull)))
        return false;
    const uint32_t check = count < 16 ? count : 16;
    for (uint32_t i = 0; i < check; ++i)
    {
        const uint8_t* s = aOut.setups + i * SetupSize;
        const uint32_t index = IndexOf(s, aL);
        if (index >= aOut.nodeCount)
            return false;
        const void* node = *reinterpret_cast<void* const*>(s + SetupNode);
        const void* named = *reinterpret_cast<void* const*>(aOut.nodes + index * 0x10);
        if (!node || node != named)
            return false;
    }
    return true;
}

// ---- what is recorded ----

struct SetupData
{
    uint64_t sector = 0;
    uint32_t instance = 0;
    uint32_t instanceCount = 0;
    uint32_t index = 0;
    uint32_t nodeCount = 0;
    void* node = nullptr;
    uint64_t nodeType = 0;
    uint64_t nodeId = 0;
    uint64_t proxyId = 0;
    uint16_t flags = 0; // the 16 bits after the index (RED Hot Tools' interior flag is 0x40 there, unverified on 2.5)
    float pos[3] = {};
    float rot[4] = {0, 0, 0, 1};
    float scale[3] = {1, 1, 1};
    // The box in the world, worked out when a pick first needs it, from the live instance.
    bool boxDone = false;
    bool boxFromMesh = false;
    float min[3] = {};
    float max[3] = {};
};

SRWLOCK g_lock = SRWLOCK_INIT;
std::unordered_map<const void*, SetupData> g_setups;
std::unordered_map<const void*, const void*> g_instanceSetup;
struct InstanceRef
{
    const void* raw = nullptr;
    WeakHandle<ISerializable> weak;
};
std::unordered_map<const void*, InstanceRef> g_setupInstance;
std::atomic<size_t> g_hiddenCount{0}; // g_hidden's size, read without the lock
std::unordered_map<std::string, const void*> g_byId;
std::unordered_set<std::string> g_hidden;
std::deque<const void*> g_attachedQueue;
std::unordered_set<uint64_t> g_classesLogged;
std::unordered_map<const void*, std::pair<const uint8_t*, const uint8_t*>> g_sectorRanges; // sector -> its setups

std::atomic<uint64_t> g_sectors{0};
std::atomic<uint64_t> g_badSectors{0};
std::atomic<uint64_t> g_refused{0}; // reads refused by a memory check
std::atomic<uint64_t> g_initialized{0};
std::atomic<uint64_t> g_sectorMs10{0};
std::atomic<uint64_t> g_forgetMs10{0};
std::atomic<uint64_t> g_forgotten{0};

void RecordSector(void* aSector)
{
    const auto started = std::chrono::steady_clock::now();
    BufferView v;
    int which = g_layout.load();
    if (which < 0)
    {
        for (int i = 0; i < static_cast<int>(std::size(Candidates)); ++i)
        {
            BufferView t;
            if (ReadBuffer(aSector, Candidates[i], t, true) && t.setupBytes)
            {
                int expected = -1;
                if (g_layout.compare_exchange_strong(expected, i))
                {
                    const auto& c = Candidates[i];
                    Log("World nodes: layout found: node buffer at sector+0x%zx, node list at buffer+0x%zx, node index at "
                        "setup+0x%zx%s",
                        c.buffer, c.nodes, c.index, c.wide ? " (19 bits)" : " (16 bits)");
                }
                which = g_layout.load();
                break;
            }
        }
        if (which < 0)
        {
            if (++g_badSectors <= 5)
                Log("World nodes: no known layout fits this sector's node buffer (sector at %p)", aSector);
            return;
        }
    }
    const Layout& layout = Candidates[which];
    if (!ReadBuffer(aSector, layout, v, false))
    {
        if (++g_badSectors <= 5)
            Log("World nodes: a sector's node buffer did not check out with the layout found");
        return;
    }
    const uint64_t sectorHash = reinterpret_cast<CResource*>(aSector)->path.hash;
    const uint32_t count = v.setupBytes / static_cast<uint32_t>(SetupSize);
    std::vector<std::pair<const void*, SetupData>> found;
    found.reserve(count);
    // Each node's class, once per node in the node list (the game's own handles).
    std::vector<uint64_t> types(v.nodeCount, 0);
    for (uint32_t k = 0; k < v.nodeCount; ++k)
    {
        auto* node = *reinterpret_cast<ISerializable* const*>(v.nodes + k * 0x10);
        if (auto* type = node ? node->GetType() : nullptr)
            types[k] = type->GetName().hash;
    }
    for (uint32_t i = 0; i < count; ++i)
    {
        const uint8_t* s = v.setups + i * SetupSize; // the whole block was checked readable
        SetupData d;
        const auto* t = reinterpret_cast<const float*>(s);
        d.pos[0] = t[0];
        d.pos[1] = t[1];
        d.pos[2] = t[2];
        for (int k = 0; k < 4; ++k)
            d.rot[k] = t[4 + k];
        const auto* sc = reinterpret_cast<const float*>(s + 0x20);
        for (int k = 0; k < 3; ++k)
            d.scale[k] = sc[k];
        d.node = *reinterpret_cast<void* const*>(s + SetupNode);
        d.nodeId = *reinterpret_cast<const uint64_t*>(s + SetupNodeId);
        d.proxyId = *reinterpret_cast<const uint64_t*>(s + SetupProxyId);
        d.index = IndexOf(s, layout);
        d.flags = layout.wide ? static_cast<uint16_t>(*reinterpret_cast<const uint32_t*>(s + layout.index) >> 19)
                              : *reinterpret_cast<const uint16_t*>(s + layout.index + 2);
        d.sector = sectorHash;
        d.instance = i;
        d.instanceCount = count;
        d.nodeCount = v.nodeCount;
        d.nodeType = d.index < v.nodeCount ? types[d.index] : 0;
        found.emplace_back(s, d);
    }
    AcquireSRWLockExclusive(&g_lock);
    for (auto& [setup, d] : found)
    {
        g_byId[IdOf(d.sector, d.instance)] = setup;
        g_setups[setup] = d;
    }
    g_sectorRanges[aSector] = {v.setups, v.setups + v.setupBytes};
    ReleaseSRWLockExclusive(&g_lock);
    const uint64_t n = ++g_sectors;
    g_sectorMs10 += static_cast<uint64_t>(
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count() * 10);
    if (n == 1 || n % 250 == 0)
        Log("World nodes: %llu sectors recorded (%.0f ms), %llu forgotten (%.0f ms), %llu instances set up",
            static_cast<unsigned long long>(n), g_sectorMs10.load() / 10.0, static_cast<unsigned long long>(g_forgotten.load()),
            g_forgetMs10.load() / 10.0, static_cast<unsigned long long>(g_initialized.load()));
}

void ForgetSector(void* aSector)
{
    const auto started = std::chrono::steady_clock::now();
    AcquireSRWLockExclusive(&g_lock);
    const auto range = g_sectorRanges.find(aSector);
    if (range == g_sectorRanges.end())
    {
        ReleaseSRWLockExclusive(&g_lock);
        return;
    }
    const uint8_t* begin = range->second.first;
    const uint8_t* end = range->second.second;
    g_sectorRanges.erase(range);
    for (const uint8_t* s = begin; s < end; s += SetupSize)
    {
        const auto it = g_setups.find(s);
        if (it == g_setups.end())
            continue;
        const auto byId = g_byId.find(IdOf(it->second.sector, it->second.instance));
        if (byId != g_byId.end() && byId->second == s)
            g_byId.erase(byId);
        g_setups.erase(it);
        if (const auto inst = g_setupInstance.find(s); inst != g_setupInstance.end())
        {
            const auto back = g_instanceSetup.find(inst->second.raw);
            if (back != g_instanceSetup.end() && back->second == s)
                g_instanceSetup.erase(back);
            g_setupInstance.erase(inst);
        }
    }
    ReleaseSRWLockExclusive(&g_lock);
    ++g_forgotten;
    g_forgetMs10 += static_cast<uint64_t>(
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count() * 10);
}

// The sector is recorded after the game's own OnReady, so its setups are complete.
uint64_t SectorReadyDetour(void* aSector, void* a2, void* a3, void* a4)
{
    const uint64_t result = g_sectorReady(aSector, a2, a3, a4);
    RecordSector(aSector);
    return result;
}
uint64_t SectorDtorDetour(void* aSector, void* a2, void* a3, void* a4)
{
    ForgetSector(aSector);
    return g_sectorDtor(aSector, a2, a3, a4);
}
uint64_t NodeInitializeDetour(void* aInstance, void* aSetup, void* a3, void* a4)
{
    const uint64_t result = g_nodeInitialize(aInstance, aSetup, a3, a4);
    if (const uint64_t n = ++g_initialized; n == 1 || n % 50000 == 0)
        Log("World nodes: %llu node instances set up so far", static_cast<unsigned long long>(n));
    AcquireSRWLockShared(&g_lock);
    const bool known = g_setups.count(aSetup) != 0;
    ReleaseSRWLockShared(&g_lock);
    if (!known || !aInstance)
        return result;
    WeakHandle<ISerializable> weak = static_cast<ISerializable*>(aInstance)->ref;
    AcquireSRWLockExclusive(&g_lock);
    if (g_setups.count(aSetup))
    {
        g_instanceSetup[aInstance] = aSetup;
        g_setupInstance[aSetup] = InstanceRef{aInstance, std::move(weak)};
    }
    ReleaseSRWLockExclusive(&g_lock);
    return result;
}
uint64_t NodeAttachDetour(void* aInstance, void* a2, void* a3, void* a4)
{
    const uint64_t result = g_nodeAttach(aInstance, a2, a3, a4);
    if (g_hiddenCount.load(std::memory_order_relaxed) == 0)
        return result;
    AcquireSRWLockExclusive(&g_lock);
    g_attachedQueue.push_back(aInstance);
    ReleaseSRWLockExclusive(&g_lock);
    return result;
}

// ---- answers (game thread) ----

Handle<ISerializable> InstanceOf(const void* aSetup)
{
    const auto it = g_setupInstance.find(aSetup);
    return it == g_setupInstance.end() ? Handle<ISerializable>{} : it->second.weak.Lock();
}

int StateOf(const void* aInstance)
{
    uint16_t bits = 0;
    std::memcpy(&bits, static_cast<const uint8_t*>(aInstance) + InstanceState, sizeof(bits));
    return ((bits >> 5) & 1) | (((bits >> 9) & 1) << 1);
}

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

// The mesh among a node instance's fields: a Handle whose object is a CMesh. Fields 0x90 to
// 0x130, past the base instance (RED Hot Tools has the mesh at 0x98 to 0xB8 in each class).
std::unordered_map<uint64_t, int> g_meshField; // instance class -> its mesh field's offset, or -1 (game thread)

CResource* MeshOf(void* aInstance)
{
    static CClass* const mesh = CRTTISystem::Get()->GetClass("CMesh");
    auto* cls = mesh ? static_cast<ISerializable*>(aInstance)->GetType() : nullptr;
    if (!cls)
        return nullptr;
    const uint64_t key = cls->GetName().hash;
    auto known = g_meshField.find(key);
    if (known == g_meshField.end())
    {
        // Only the mesh node instance families keep a mesh handle in one field for every
        // instance (0.66.3 trusted a GI space's +0xB8, which held a mesh in one instance and
        // flags in the next, and the game crashed). For them, the first instance's fields are
        // checked carefully to find it.
        static const std::vector<CClass*> meshKinds = []() {
            std::vector<CClass*> out;
            for (const char* name : {"worldMeshNodeInstance", "worldInstancedMeshNodeInstance", "worldFoliageNodeInstance",
                                     "worldTerrainMeshNodeInstance", "worldBendedMeshNodeInstance",
                                     "worldStaticOccluderMeshNodeInstance", "worldInstancedDestructibleMeshNodeInstance"})
                if (auto* c = CRTTISystem::Get()->GetClass(name))
                    out.push_back(c);
            return out;
        }();
        const bool meshKind = std::any_of(meshKinds.begin(), meshKinds.end(), [&](CClass* c) { return cls->IsA(c); });
        int found = -1;
        if (meshKind && Readable(static_cast<uint8_t*>(aInstance) + 0x90, 0xA8))
        {
            for (size_t off = 0x90; off <= 0x130 && found < 0; off += 8)
            {
                void* object = nullptr;
                std::memcpy(&object, static_cast<uint8_t*>(aInstance) + off, sizeof(object));
                auto* type = object ? TypeOf(object) : nullptr;
                if (type && type->IsA(mesh))
                    found = static_cast<int>(off);
            }
        }
        known = g_meshField.emplace(key, found).first;
        if (found >= 0)
            Log("World nodes: %s keeps its mesh at +0x%x", CName(key).ToString(), found);
    }
    if (known->second < 0)
        return nullptr;
    void* object = nullptr;
    std::memcpy(&object, static_cast<uint8_t*>(aInstance) + known->second, sizeof(object));
    const auto at = reinterpret_cast<uintptr_t>(object);
    if (at < 0x10000 || at > 0x7FFFFFFEFFFF || (at & 7))
        return nullptr; // not a pointer: never followed
    auto* type = static_cast<ISerializable*>(object)->GetType();
    return type && type->IsA(mesh) ? static_cast<CResource*>(object) : nullptr;
}

// The setup's box in the world: the mesh's box, scaled, turned and placed as the instance is;
// without a live instance or a mesh, a 1 m box at the setup's place.
void WorkOutBox(const void* aSetup, SetupData& d)
{
    d.boxDone = true;
    d.boxFromMesh = false;
    auto instance = InstanceOf(aSetup);
    float lmin[3] = {-0.5f, -0.5f, -0.5f}, lmax[3] = {0.5f, 0.5f, 0.5f};
    float pos[3] = {d.pos[0], d.pos[1], d.pos[2]};
    float rot[4] = {d.rot[0], d.rot[1], d.rot[2], d.rot[3]};
    float scale[3] = {1, 1, 1};
    if (instance)
    {
        float place[12];
        std::memcpy(place, reinterpret_cast<uint8_t*>(instance.instance) + InstancePlace, sizeof(place));
        std::memcpy(pos, place, sizeof(pos));
        std::memcpy(rot, place + 4, sizeof(rot));
        std::memcpy(scale, place + 8, sizeof(scale));
        static CClass* const meshClass = CRTTISystem::Get()->GetClass("CMesh");
        if (auto* mesh = MeshOf(instance.instance); mesh && meshClass)
        {
            if (auto* prop = meshClass->GetProperty("boundingBox"))
            {
                float box[8];
                std::memcpy(box, reinterpret_cast<uint8_t*>(mesh) + prop->valueOffset, sizeof(box));
                {
                    bool ok = true;
                    for (int i = 0; i < 3; ++i)
                        ok = ok && std::isfinite(box[i]) && std::isfinite(box[4 + i]) && box[i] <= box[4 + i] &&
                             box[4 + i] - box[i] < 5000;
                    if (ok)
                    {
                        for (int i = 0; i < 3; ++i)
                        {
                            lmin[i] = box[i];
                            lmax[i] = box[4 + i];
                        }
                        d.boxFromMesh = true;
                    }
                }
            }
        }
    }
    if (!d.boxFromMesh)
        for (float& s : scale)
            s = 1;
    for (int i = 0; i < 3; ++i)
    {
        d.min[i] = INFINITY;
        d.max[i] = -INFINITY;
    }
    for (int c = 0; c < 8; ++c)
    {
        const float corner[3] = {((c & 1) ? lmax[0] : lmin[0]) * scale[0], ((c & 2) ? lmax[1] : lmin[1]) * scale[1],
                                 ((c & 4) ? lmax[2] : lmin[2]) * scale[2]};
        float r[3];
        Rotate(rot, corner, r);
        for (int i = 0; i < 3; ++i)
        {
            d.min[i] = std::min(d.min[i], r[i] + pos[i]);
            d.max[i] = std::max(d.max[i], r[i] + pos[i]);
        }
    }
}

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

// For the static check of the outline's render proxies (N2): the first live instance of each
// class logs its vtable's slots 0xF8 (UpdateVisibility in 2.31) and its fields from 0x90 to
// 0x1E0 that point at objects with a vtable in the exe (render proxies are not ISerializables).
void LogInstanceClass(void* aInstance, uint64_t aClass, void* aNode)
{
    if (!aClass || !g_classesLogged.insert(aClass).second)
        return;
    void** vtable = nullptr;
    void* slot = nullptr;
    if (!Read(aInstance, vtable) || !Read(reinterpret_cast<uint8_t*>(vtable) + 0xF8, slot))
        return;
    std::string fields;
    for (size_t off = 0x90; off <= 0x1E0; off += 8)
    {
        void* object = nullptr;
        void* vt = nullptr;
        if (!Read(static_cast<uint8_t*>(aInstance) + off, object) || !object || !Read(object, vt) || !InImage(vt))
            continue;
        char buf[64];
        std::snprintf(buf, sizeof(buf), " +0x%zx:vt+0x%llx%s", off, static_cast<unsigned long long>(Rva(vt)),
                      IsObject(object) ? "(object)" : "");
        fields += buf;
    }
    void** nodeVtable = nullptr;
    void* bounds = nullptr;
    const bool nodeOk = Read(aNode, nodeVtable) && Read(reinterpret_cast<uint8_t*>(nodeVtable) + 0x108, bounds);
    Log("World nodes: class %s: vtable +0x%llx, slot 0xF8 +0x%llx; node vtable +0x%llx, slot 0x108 +0x%llx; fields:%s",
        ClassName(aClass).c_str(), static_cast<unsigned long long>(Rva(vtable)),
        static_cast<unsigned long long>(Rva(slot)), nodeOk ? static_cast<unsigned long long>(Rva(nodeVtable)) : 0ull,
        nodeOk ? static_cast<unsigned long long>(Rva(bounds)) : 0ull, fields.c_str());
}

void ResourceOf(void* aNode, uint64_t aType, std::string& aResource, std::string& aAppearance)
{
    auto* cls = aType ? CRTTISystem::Get()->GetClass(CName(aType)) : nullptr;
    if (!cls)
        return;
    for (const char* name : {"mesh", "meshRef", "material", "entityTemplate", "foliageResource", "particleSystem"})
    {
        auto* prop = cls->GetProperty(name);
        uint64_t path = 0;
        if (prop)
            std::memcpy(&path, static_cast<uint8_t*>(aNode) + prop->valueOffset, sizeof(path));
        if (path)
        {
            aResource = Hex(path);
            break;
        }
    }
    if (auto* prop = cls->GetProperty("meshAppearance"))
    {
        uint64_t name = 0;
        std::memcpy(&name, static_cast<uint8_t*>(aNode) + prop->valueOffset, sizeof(name));
        if (name)
        {
            const char* s = CName(name).ToString();
            aAppearance = s ? s : Hex(name);
        }
    }
}

// Stand-ins and invisible helpers a pick skips unless asked ("helpers": true): distant LOD
// proxies (terrain, roads, prefabs, entities), occluders, collision, smart objects, GI spaces and
// shapes. 0.66.4's test: they held the hit and came first, and hiding them changed nothing seen.
bool IsHelper(uint64_t aType)
{
    static std::unordered_map<uint64_t, bool> known;
    const auto it = known.find(aType);
    if (it != known.end())
        return it->second;
    const std::string name = ClassName(aType);
    bool helper = false;
    for (const char* part : {"Proxy", "Occluder", "Collision", "SmartObject", "GISpace", "Shape", "AreaNode", "Navigation",
                             "Trigger", "Marker", "Reflection", "Acoustic", "Sound", "Audio"})
        helper = helper || name.find(part) != std::string::npos;
    known.emplace(aType, helper);
    return helper;
}

// An entity or device node's entity, by its entity id (the instance's +0xA0 handle on 2.5, as
// RED Hot Tools has it; checked carefully, since it is read for a few pick results only).
uint64_t EntityOf(void* aInstance)
{
    static CClass* const entityNode = CRTTISystem::Get()->GetClass("worldEntityNodeInstance");
    static CClass* const entity = CRTTISystem::Get()->GetClass("entEntity");
    auto* cls = static_cast<ISerializable*>(aInstance)->GetType();
    if (!entityNode || !entity || !cls || !cls->IsA(entityNode))
        return 0;
    void* object = nullptr;
    if (!Read(static_cast<uint8_t*>(aInstance) + 0xA0, object) || !object)
        return 0;
    auto* type = TypeOf(object);
    if (!type || !type->IsA(entity))
        return 0;
    auto* prop = type->GetProperty("entityID");
    uint64_t hash = 0;
    if (!prop || !Read(static_cast<uint8_t*>(object) + prop->valueOffset, hash))
        return 0;
    return hash;
}

// A node instance's render proxy, where 2.5 keeps it for the kinds seen in the game (0.66.4's
// class lines: the same render proxy vtable at RED Hot Tools' places): the mesh families and
// instanced destructibles at +0xC8, decals at +0xB0, bent meshes at +0xE0. Null for other kinds.
void* ProxyOf(void* aInstance)
{
    struct Kind
    {
        const char* cls;
        size_t offset;
    };
    static const Kind kinds[] = {{"worldBendedMeshNodeInstance", 0xE0}, {"worldStaticDecalNodeInstance", 0xB0},
                                 {"worldInstancedDestructibleMeshNodeInstance", 0xC8}, {"worldMeshNodeInstance", 0xC8}};
    auto* cls = static_cast<ISerializable*>(aInstance)->GetType();
    if (!cls)
        return nullptr;
    for (const auto& k : kinds)
    {
        auto* base = CRTTISystem::Get()->GetClass(k.cls);
        if (!base || !cls->IsA(base))
            continue;
        void* proxy = nullptr;
        void* vtable = nullptr;
        if (!Read(static_cast<uint8_t*>(aInstance) + k.offset, proxy) || !proxy || !Readable(proxy, 0x30) ||
            !Read(proxy, vtable) || !InImage(vtable))
            return nullptr;
        return proxy;
    }
    return nullptr;
}

std::string NodeJson(const void* aSetup, SetupData& d, const char* aExtra)
{
    if (!d.boxDone)
        WorkOutBox(aSetup, d);
    auto instance = InstanceOf(aSetup);
    const int state = instance ? StateOf(instance.instance) : -1;
    uint64_t instanceClass = 0;
    if (instance)
    {
        if (auto* type = instance.instance->GetType())
            instanceClass = type->GetName().hash;
        LogInstanceClass(instance.instance, instanceClass, d.node);
    }
    std::string resource, appearance;
    ResourceOf(d.node, d.nodeType, resource, appearance);
    std::string out = "{\"id\":" + JsonString(IdOf(d.sector, d.instance));
    out += ",\"kind\":" + JsonString(ClassName(d.nodeType));
    out += ",\"instanceKind\":" + (instanceClass ? JsonString(ClassName(instanceClass)) : std::string("null"));
    out += ",\"sector\":" + JsonString(Hex(d.sector));
    out += ",\"instance\":" + std::to_string(d.instance) + ",\"instanceCount\":" + std::to_string(d.instanceCount);
    out += ",\"index\":" + std::to_string(d.index) + ",\"nodeCount\":" + std::to_string(d.nodeCount);
    out += ",\"nodeId\":" + (d.nodeId ? JsonString(Hex(d.nodeId)) : std::string("null"));
    out += ",\"proxyId\":" + (d.proxyId ? JsonString(Hex(d.proxyId)) : std::string("null"));
    out += ",\"flags\":" + std::to_string(d.flags);
    out += ",\"position\":" + Vec(d.pos, 3) + ",\"orientation\":" + Vec(d.rot, 4) + ",\"scale\":" + Vec(d.scale, 3);
    out += ",\"bounds\":{\"min\":" + Vec(d.min, 3) + ",\"max\":" + Vec(d.max, 3) + "}";
    out += std::string(",\"boundsFrom\":") + (d.boxFromMesh ? "\"mesh\"" : "\"place\"");
    out += ",\"resource\":" + (resource.empty() ? std::string("null") : JsonString(resource));
    out += ",\"appearance\":" + (appearance.empty() ? std::string("null") : JsonString(appearance));
    out += std::string(",\"streamed\":") + (instance ? "true" : "false");
    out += ",\"attached\":" + std::string(state < 0 ? "null" : (state & 1) ? "true" : "false");
    out += ",\"visible\":" + std::string(state < 0 ? "null" : (state & 2) ? "true" : "false");
    out += std::string(",\"hidden\":") + (g_hidden.count(IdOf(d.sector, d.instance)) ? "true" : "false");
    if (instance)
        if (const uint64_t entity = EntityOf(instance.instance))
            out += ",\"entity\":" + JsonString(std::to_string(entity));
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

std::string Start(bool aInstances, std::string& aError)
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
    g_proxyHighlight = reinterpret_cast<ProxyHighlight_t>(Resolve(ProxyHighlightHash));
    g_proxyScanning = reinterpret_cast<ProxyScanning_t>(Resolve(ProxyScanningHash));
    std::string attached = "[";
    std::string missing;
    for (size_t i = 0; i < std::size(hooks); ++i)
    {
        if (i >= 2 && !aInstances)
            continue;
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
            Log("World nodes: %s hook at +0x%llx %s", hooks[i].name, static_cast<unsigned long long>(Rva(g_places[i])),
                g_attached[i] ? "attached" : "NOT attached");
        }
        if (g_attached[i])
            attached += std::string(attached.size() > 1 ? "," : "") + JsonString(hooks[i].name);
    }
    attached += "]";
    if (!g_attached[0] || (aInstances && !g_attached[2]))
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
        live += w.weak.Lock() ? 1 : 0;
    const size_t hidden = g_hidden.size();
    ReleaseSRWLockShared(&g_lock);
    const int which = g_layout.load();
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
    out += "],\"layout\":";
    if (which < 0)
        out += "null";
    else
    {
        const auto& c = Candidates[which];
        char buf[160];
        std::snprintf(buf, sizeof(buf), "\"buffer +0x%zx, nodes +0x%zx, index +0x%zx%s\"", c.buffer, c.nodes, c.index,
                      c.wide ? " (19 bits)" : "");
        out += buf;
    }
    out += ",\"sectors\":" + std::to_string(g_sectors.load()) + ",\"badSectors\":" + std::to_string(g_badSectors.load());
    out += ",\"setups\":" + std::to_string(setups) + ",\"instances\":" + std::to_string(live);
    out += ",\"initialized\":" + std::to_string(g_initialized.load());
    out += ",\"hidden\":" + std::to_string(hidden) + ",\"refused\":" + std::to_string(g_refused.load());
    out += ",\"sectorMs\":" + Num(g_sectorMs10.load() / 10.0) + ",\"forgotten\":" + std::to_string(g_forgotten.load()) +
           ",\"forgetMs\":" + Num(g_forgetMs10.load() / 10.0);
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
        float volume;
        bool holds;
    };
    // "fit" (the default with a collision hit): the boxes that hold the hit point first, the
    // smallest first, then the rest by distance. The ray often starts inside large boxes (a road,
    // a terrain piece) that hold the hit too: by distance alone they came first (0.66.4's test).
    const bool fit = StringOr(aParams, "order") != "nearest";
    const bool helpers = BoolOr(aParams, "helpers", false);
    std::vector<Hit> hits;
    size_t looked = 0;
    AcquireSRWLockExclusive(&g_lock);
    for (auto& [setup, d] : g_setups)
    {
        const float dx = d.pos[0] - from[0], dy = d.pos[1] - from[1], dz = d.pos[2] - from[2];
        if (dx * dx + dy * dy + dz * dz > (max + 300) * (max + 300))
            continue;
        if (!kinds.empty() && !kinds.count(ClassName(d.nodeType)))
            continue;
        if (!helpers && kinds.empty() && IsHelper(d.nodeType))
            continue;
        if (!all)
        {
            auto instance = InstanceOf(setup);
            const int state = instance ? StateOf(instance.instance) : -1;
            if (state < 0 || !(state & 1))
                continue;
        }
        ++looked;
        if (!d.boxDone)
            WorkOutBox(setup, d);
        const float t = RayBox(from, dir, d.min, d.max);
        if (t < 0 || t > max)
            continue;
        const bool holds = hit && point[0] >= d.min[0] - 0.05f && point[0] <= d.max[0] + 0.05f &&
                           point[1] >= d.min[1] - 0.05f && point[1] <= d.max[1] + 0.05f && point[2] >= d.min[2] - 0.05f &&
                           point[2] <= d.max[2] + 0.05f;
        const float volume = (d.max[0] - d.min[0]) * (d.max[1] - d.min[1]) * (d.max[2] - d.min[2]);
        hits.push_back({setup, t, volume, holds});
    }
    std::sort(hits.begin(), hits.end(), [fit](const Hit& a, const Hit& b) {
        if (fit && a.holds != b.holds)
            return a.holds;
        if (fit && a.holds)
            return a.volume < b.volume;
        return a.t < b.t;
    });
    std::string list = "[";
    for (int i = 0; i < static_cast<int>(hits.size()) && i < limit; ++i)
    {
        auto& d = g_setups[hits[i].setup];
        std::string extra = ",\"distance\":" + Num(hits[i].t) + ",\"volume\":" + Num(hits[i].volume);
        if (hit)
        {
            extra += std::string(",\"holdsHit\":") + (hits[i].holds ? "true" : "false");
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

const void* SetupFor(const std::string& aId)
{
    const auto it = g_byId.find(aId);
    return it == g_byId.end() ? nullptr : it->second;
}

bool ApplyVisible(void* aInstance, bool aVisible)
{
    if (!g_nodeVisibility || !aInstance)
        return false;
    g_nodeVisibility(aInstance, aVisible);
    return true;
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
        params.fillIndex = static_cast<uint8_t>(std::max(1.0, NumberOr(aParams, "fill", 1)));
        params.outlineIndex = static_cast<uint8_t>(NumberOr(aParams, "outline", 1));
        params.opacity = static_cast<float>(NumberOr(aParams, "opacity", 1));
        params.forced = true;
    }
    AcquireSRWLockShared(&g_lock);
    const void* setup = SetupFor(id);
    auto instance = setup ? InstanceOf(setup) : Handle<ISerializable>{};
    ReleaseSRWLockShared(&g_lock);
    if (!instance)
        return "{\"done\":false,\"why\":" + JsonString(setup ? "not streamed in" : "no such node now") + "}";
    void* proxy = ProxyOf(instance.instance);
    if (!proxy)
        return "{\"done\":false,\"why\":\"no render proxy REDnode knows for this kind on game 2.5 (meshes, decals and bent meshes only)\"}";
    g_proxyHighlight(proxy, &params);
    if (g_proxyScanning)
        g_proxyScanning(proxy, on ? 4 /* Complete */ : 0 /* Off */);
    return "{\"done\":true}";
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
    g_hiddenCount = g_hidden.size();
    const void* setup = SetupFor(id);
    auto instance = setup ? InstanceOf(setup) : Handle<ISerializable>{};
    ReleaseSRWLockExclusive(&g_lock);
    if (!instance)
        return "{\"done\":false,\"id\":" + JsonString(id) + ",\"why\":" +
               JsonString(visible ? "not streamed in (off the hidden list)" : "not streamed in (hidden when it streams in)") + "}";
    const int state = StateOf(instance.instance);
    const bool ok = ApplyVisible(instance.instance, visible);
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
    {
        const auto* v = aParams.Get("instances");
        return Start(!(v && v->kind == Value::Kind::Bool && !v->boolean), aError);
    }
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
