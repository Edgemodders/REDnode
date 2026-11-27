// Bones (#62, for REDcode; docs/world.md "Bones (#62)"): the live pose of an entity's animated
// object, read only, on the game thread.
//
// bones.hpp has the static reading of 2.5's code and the instruction forms the offsets come from:
// the live read (the animated object's current pose, model-space QsTransforms in meta rig order),
// and the model read with its local read (the rigs' bind pose). Each is found by one byte pattern,
// which must match once; every other place comes from their code and the calls the model read
// makes. The first run (0.76.0) read the rigs' bind pose as if it were the live one: the "pose
// parts" are the rigs (animRig: names +0xD8, reference pose +0x48, A-pose +0xB8). REDnode 0.76.1
// reads the live pose, and the bind pose only when asked.
//
// The game's crash handler takes a fault before __try does (worldnodes.cpp found this), so the
// animated object, its meta rig, its pose, its rigs and each array are checked with VirtualQuery
// before they are read, and sizes past a sane limit refuse the read.
//
//   ReadBones(component, wanted) -> fields of one answer (bones.cpp builds them):
//     "object":"cache"|"lookup", "lod":{"level","last","distance"}, "rigs":[n bones, ...],
//     "count":n, "bones":[{"index","name","parent","rig","model":{t,r,s},"local":{t,r,s},"bind":{t,r,s}}]
//   "model": the live pose, relative to the entity's animated root, as the game holds it.
//   "local": the live pose relative to the parent, computed by REDnode from the two model transforms.
//   "bind": the bone's own rig's bind pose relative to its parent (the A-pose, else the reference pose).
//   "rig": which of the object's rigs holds the bone (-1: none).
//   "lod": the animated object's camera distance level, last level and distance from the camera, at
//   the SDK's offsets for anim::AnimatedObject (0x9C, 0xAC, 0xE4); they changed with distance in the
//   first run.

#include "bones.hpp"
#include "overlay.hpp"

#include <RED4ext/CNamePool.hpp>
#include <RED4ext/RED4ext.hpp>

#include <Windows.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
using namespace rednode::overlay::bones;

constexpr uint32_t MaxBones = 4096;
constexpr uint32_t MaxParts = 32;
constexpr size_t ObjectBytes = 0x100; // the SDK's anim::AnimatedObject
constexpr size_t LodLevel = 0x9C, LodLast = 0xAC, LodDistance = 0xE4;

Layout g_layout;
bool g_looked = false;

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

struct Code
{
    const uint8_t* begin = nullptr;
    const uint8_t* end = nullptr;
};

std::vector<Code> GameCode()
{
    const auto* image = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
    const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(image);
    const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(image + dos->e_lfanew);
    const IMAGE_SECTION_HEADER* section = IMAGE_FIRST_SECTION(nt);
    std::vector<Code> code;
    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, section++)
    {
        if (section->Characteristics & IMAGE_SCN_MEM_EXECUTE)
            code.push_back({image + section->VirtualAddress, image + section->VirtualAddress + section->Misc.VirtualSize});
    }
    return code;
}

// The one match of a pattern in the game's code, or null with aWhy.
const uint8_t* FindOnce(const std::vector<Code>& aCode, const char* aPattern, const char* aName, std::string& aWhy)
{
    const uint8_t* found = nullptr;
    int total = 0;
    for (const Code& c : aCode)
    {
        int count = 0;
        const uint8_t* at = FindPattern(c.begin, c.end, aPattern, &count);
        if (at && !found)
            found = at;
        total += count;
    }
    if (total == 1)
        return found;
    aWhy = std::string(aName) + (total ? "'s pattern matches more than once" : "'s pattern is not in the game's code");
    return nullptr;
}

const Layout& Find()
{
    if (g_looked)
        return g_layout;
    g_looked = true;
    const auto code = GameCode();
    static std::string why;
    const uint8_t* model = FindOnce(code, ModelReadPattern, "the model read", why);
    const uint8_t* live = model ? FindOnce(code, LiveReadPattern, "the live read", why) : nullptr;
    if (model && live)
    {
        auto inside = [&code](const uint8_t* aAt, size_t aBytes) {
            for (const Code& c : code)
            {
                if (aAt >= c.begin && aAt + aBytes <= c.end)
                    return true;
            }
            return false;
        };
        g_layout = ReadLayout(model, live, inside);
    }
    else
    {
        g_layout.why = why.c_str();
    }
    const auto* image = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
    if (g_layout.ok)
        Log("Bones: live read +0x%llx (pose +0x%X), model read +0x%llx; object at component +0x%X (registry +0x%X), "
            "meta rig +0x%X (names +0x%X, parents +0x%X), rigs +0x%X (rig +0x%X, next +0x%X, names +0x%X), "
            "bind poses +0x%X/+0x%X (counts +0x%X/+0x%X)",
            static_cast<unsigned long long>(g_layout.liveRead - image), g_layout.pose,
            static_cast<unsigned long long>(g_layout.modelRead - image), g_layout.objectCache, g_layout.registry,
            g_layout.metaRig, g_layout.rigNames, g_layout.rigParents, g_layout.parts, g_layout.partOf, g_layout.next,
            g_layout.partNames, g_layout.bufferA, g_layout.bufferB, g_layout.countA, g_layout.countB);
    else
        Log("Bones: not available on this game version: %s", g_layout.why ? g_layout.why : "unknown");
    return g_layout;
}

using LookupFn = void*(__fastcall*)(void* aRegistry, void* aComponent);

// The animated object of a component: its cache, else the game's own lookup.
const uint8_t* ObjectOf(const Layout& aL, uint8_t* aComponent, bool& aLookedUp)
{
    aLookedUp = false;
    auto* object = *reinterpret_cast<uint8_t**>(aComponent + aL.objectCache);
    if (object)
        return object;
    void* registry = *reinterpret_cast<void**>(aComponent + aL.registry);
    if (!registry || !Readable(registry, 0x10))
        return nullptr;
    aLookedUp = true;
    return static_cast<const uint8_t*>(reinterpret_cast<LookupFn>(const_cast<uint8_t*>(aL.lookup))(registry, aComponent));
}

// Checks the object, its meta rig, its live pose and its rigs with VirtualQuery. Fills the rigs'
// bone counts and the live pose's array; answers the meta rig, or null with aWhy.
const uint8_t* CheckObject(const Layout& aL, const uint8_t* aObject, std::vector<uint32_t>& aRigs, const Qs*& aPose,
                           const char*& aWhy)
{
    if (!Readable(aObject, ObjectBytes))
        return aWhy = "its animated object is not readable", nullptr;
    if (*reinterpret_cast<const int32_t*>(aObject) == -1)
        return aWhy = "its animated object has no meta rig yet", nullptr;
    const uint8_t* rig = *reinterpret_cast<const uint8_t* const*>(aObject + aL.metaRig);
    const uint32_t extent = (aL.rigNames > aL.rigParents ? aL.rigNames : aL.rigParents) + sizeof(Array);
    if (!Readable(rig, extent))
        return aWhy = "its meta rig is not readable", nullptr;
    const Array* names = ArrayAt(rig, aL.rigNames);
    const Array* parents = ArrayAt(rig, aL.rigParents);
    if (names->size == 0 || names->size > MaxBones || parents->size != names->size)
        return aWhy = "its meta rig's bone lists are not as expected", nullptr;
    if (!Readable(names->entries, names->size * sizeof(uint64_t)) || !Readable(parents->entries, parents->size * sizeof(int16_t)))
        return aWhy = "its meta rig's bone lists are not readable", nullptr;

    const uint8_t* pose = *reinterpret_cast<const uint8_t* const*>(aObject + aL.pose);
    if (!pose)
        return aWhy = "its animated object has no live pose (not animated yet)", nullptr;
    if (!Readable(pose, 8))
        return aWhy = "its live pose is not readable", nullptr;
    aPose = *reinterpret_cast<const Qs* const*>(pose);
    if (!Readable(aPose, names->size * sizeof(Qs)))
        return aWhy = "its live pose's transforms are not readable", nullptr;

    const uint8_t* node = *reinterpret_cast<const uint8_t* const*>(aObject + aL.parts);
    const size_t nodeBytes = (aL.partOf > aL.next ? aL.partOf : aL.next) + 8;
    const size_t partBytes = std::max<size_t>({aL.partNames + sizeof(Array), aL.countA + 4, aL.countB + 4,
                                              aL.bufferA + 8, aL.bufferB + 8});
    while (node)
    {
        if (aRigs.size() >= MaxParts || !Readable(node, nodeBytes))
            return aWhy = "its rigs are not readable", nullptr;
        const uint8_t* part = *reinterpret_cast<const uint8_t* const*>(node + aL.partOf);
        uint32_t count = 0;
        if (part)
        {
            if (!Readable(part, partBytes))
                return aWhy = "a rig is not readable", nullptr;
            const Array* partNames = ArrayAt(part, aL.partNames);
            const uint32_t a = *reinterpret_cast<const uint32_t*>(part + aL.countA);
            const uint32_t b = *reinterpret_cast<const uint32_t*>(part + aL.countB);
            const Qs* buffer = *reinterpret_cast<const Qs* const*>(part + (b == a ? aL.bufferB : aL.bufferA));
            const uint32_t held = b == a ? b : a;
            count = partNames->size;
            if (count > MaxBones || held < count)
                return aWhy = "a rig's lists are not as expected", nullptr;
            if (count && (!Readable(partNames->entries, count * sizeof(uint64_t)) || !Readable(buffer, count * sizeof(Qs))))
                return aWhy = "a rig's lists are not readable", nullptr;
        }
        aRigs.push_back(count);
        node = *reinterpret_cast<const uint8_t* const*>(node + aL.next);
    }
    return rig;
}

void Num(std::string& aOut, float aV)
{
    char buf[32];
    if (!std::isfinite(aV))
        aV = 0.f;
    std::snprintf(buf, sizeof(buf), "%.6g", aV);
    aOut += buf;
}

void QsJson(std::string& aOut, const Qs& aQ)
{
    aOut += "{\"t\":[";
    for (int i = 0; i < 3; ++i)
        (i ? aOut += "," : aOut), Num(aOut, aQ.t[i]);
    aOut += "],\"r\":[";
    for (int i = 0; i < 4; ++i)
        (i ? aOut += "," : aOut), Num(aOut, aQ.r[i]);
    aOut += "],\"s\":[";
    for (int i = 0; i < 3; ++i)
        (i ? aOut += "," : aOut), Num(aOut, aQ.s[i]);
    aOut += "]}";
}

std::string NameOf(uint64_t aHash)
{
    const char* text = RED4ext::CNamePool::Get(RED4ext::CName(aHash));
    return text && *text ? text : "0x" + std::to_string(aHash);
}

std::string Quote(const std::string& aText)
{
    std::string out = "\"";
    for (char c : aText)
    {
        if (c == '"' || c == '\\')
            out += '\\';
        if (static_cast<unsigned char>(c) >= 0x20)
            out += c;
    }
    return out + "\"";
}
} // namespace

bool ReadBones(void* aComponent, const BonesWanted& aWanted, const void*& aObject, std::string& aOut, std::string& aError)
{
    aObject = nullptr;
    const Layout& l = Find();
    if (!l.ok)
    {
        aError = std::string("REDnode cannot read bones on this game version (") + (l.why ? l.why : "unknown") + ")";
        return false;
    }
    auto* component = static_cast<uint8_t*>(aComponent);
    bool lookedUp = false;
    const uint8_t* object = ObjectOf(l, component, lookedUp);
    if (!object)
    {
        aError = "the component has no animated object (not streamed in, or not animated)";
        return false;
    }
    aObject = object;
    if (std::find(aWanted.skip.begin(), aWanted.skip.end(), object) != aWanted.skip.end())
        return true; // read already, for another component: the caller says which

    std::vector<uint32_t> rigs;
    const Qs* pose = nullptr;
    const char* why = nullptr;
    const uint8_t* rig = CheckObject(l, object, rigs, pose, why);
    if (!rig)
    {
        aError = std::string("the pose cannot be read: ") + why;
        return false;
    }
    const Array* names = ArrayAt(rig, l.rigNames);
    const auto* nameList = static_cast<const uint64_t*>(names->entries);
    const auto* parentList = static_cast<const int16_t*>(ArrayAt(rig, l.rigParents)->entries);
    const uint32_t count = names->size;

    // Copied at once, so the whole pose comes from one moment of the game thread.
    std::vector<Qs> model(pose, pose + count);

    char lod[160];
    std::snprintf(lod, sizeof(lod), "{\"level\":%u,\"last\":%u,\"distance\":",
                  *reinterpret_cast<const uint32_t*>(object + LodLevel), *reinterpret_cast<const uint32_t*>(object + LodLast));
    aOut += std::string("\"object\":\"") + (lookedUp ? "lookup" : "cache") + "\",\"lod\":" + lod;
    Num(aOut, *reinterpret_cast<const float*>(object + LodDistance));
    aOut += "},\"rigs\":[";
    for (size_t k = 0; k < rigs.size(); ++k)
        aOut += (k ? "," : "") + std::to_string(rigs[k]);
    aOut += "],\"count\":" + std::to_string(count) + ",\"bones\":[";
    bool first = true;
    for (uint32_t i = 0; i < count; ++i)
    {
        if (!aWanted.names.empty() &&
            std::find(aWanted.names.begin(), aWanted.names.end(), nameList[i]) == aWanted.names.end())
            continue;
        int rigOf = -1;
        const Qs bind = LocalOf(l, object, nameList[i], rigOf);
        const int p = parentList[i];
        const bool hasParent = p >= 0 && static_cast<uint32_t>(p) < count && static_cast<uint32_t>(p) != i;
        aOut += first ? "{" : ",{";
        first = false;
        aOut += "\"index\":" + std::to_string(i) + ",\"name\":" + Quote(NameOf(nameList[i])) + ",\"parent\":";
        aOut += hasParent ? Quote(NameOf(nameList[p])) : "null";
        aOut += ",\"rig\":" + std::to_string(rigOf);
        if (aWanted.model)
        {
            aOut += ",\"model\":";
            QsJson(aOut, model[i]);
        }
        if (aWanted.local)
        {
            aOut += ",\"local\":";
            QsJson(aOut, hasParent ? Local(model[p], model[i]) : model[i]);
        }
        if (aWanted.bind)
        {
            aOut += ",\"bind\":";
            QsJson(aOut, bind);
        }
        aOut += "}";
    }
    aOut += "]";
    return true;
}
} // namespace rednode::overlay::detail
