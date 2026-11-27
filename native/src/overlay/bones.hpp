#pragma once

// Reading a body's live pose, for bones.cpp (#62, docs/world.md "Bones (#62)").
// No game needed: tests/bones_test.cpp checks it on made-up code, and on the game exe with
// REDNODE_GAME_EXE set.
//
// Game 2.5 has no script call that reads bones. Its slot component does, natively: a slot bound
// to a bone (entSlotComponent.GetSlotTransform) asks the entity's entAnimatedComponent for the
// bone's place through two functions, found in a static reading of 2.5's exe:
//
//   "the live read" (+0x32b1e8): bool (animated object, BoneRef*, QsTransform* out). The animated
//   object keeps its current pose at +0x18; the pose's first field is an array of model-space
//   QsTransforms, one per bone of the object's meta rig (the SDK's anim::MetaRig: bone names and
//   parent indices), in meta rig order. This is what the game animates.
//   "the model read" (+0xbf1ec4): QsTransform* (component, out, BoneRef*), which walks the bone's
//   parents through "the local read" over the object's rigs (a list of animRig resources: names at
//   +0xD8, the reference pose at +0x48 and the A-pose at +0xB8, chosen by their counts). It answers
//   the rig's bind pose, not the live one; REDnode reads it only for "bind" and for which rig
//   holds a bone.
//
// Each animated component of an entity (a person's root, face_rig and deformations) names the
// same animated object, cached in the component or found by the game's lookup from a registry
// the component names.
//
// The plugin takes every offset from those functions' own code, found by two byte patterns (each
// unique in 2.5's exe) and the calls the model read makes, rather than from fixed numbers: these
// are the instruction forms it looks for, with 2.5's values.
//
//   live read (pattern below)
//     mov r8, [rcx + pose]              4C 8B 41 <disp8>       0x18, the current pose
//     mov rdx, [rcx + metaRig]          48 8B 51 <disp8>       0x08
//     add rcx, [r8]                     49 03 08               the pose's model-space array
//   model read (pattern below)
//     mov rdi, [rcx + cache]            48 8B B9 <disp32>      the animated object, 0x178
//     mov rcx, [rcx + registry]         48 8B 89 <disp32>      0x168, then call lookup
//     mov rbx, [rdi + metaRig]          48 8B 5F <disp8>       0x08
//     mov r12, [rbx + names]            4C 8B 63 <disp8>       0x20 (DynArray<CName>)
//     mov r15, [rbx + parents]          4C 8B 7B <disp8>       0x10 (DynArray<int16_t>)
//     call local read                   E8 <rel32>
//   local read
//     mov rbx, [rdx + parts]            48 8B 5A <disp8>       0x60, the first list node
//     mov rdi, [rbx + part]             48 8B 7B <disp8>       0x40
//     lea rcx, [rdi + partNames]        48 8D 8F <disp32>      0xD8 (DynArray<CName>)
//     call buffer read (second call)    E8 <rel32>
//     (not found) mov rbx, [rbx + next] 48 8B 5B <disp8>       0x08
//   buffer read
//     mov eax, [rcx + countA]           8B 41 <disp8>          0x5C
//     cmp [rcx + countB], eax           39 81 <disp32>         0xC4
//     mov rdx, [rcx + bufferA]          48 8B 51 <disp8>       0x48   (counts differ)
//     mov r8, [rcx + bufferB]           4C 8B 81 <disp32>      0xB8   (counts equal)

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace rednode::overlay::bones
{
// The game's QsTransform: translation (w unused), rotation quaternion (x, y, z, w), scale (w unused).
struct alignas(16) Qs
{
    float t[4];
    float r[4];
    float s[4];
};
static_assert(sizeof(Qs) == 0x30, "QsTransform is 0x30 bytes");

// What the model read takes for a bone: its index in the meta rig and its name.
struct BoneRef
{
    int32_t index;
    uint32_t pad;
    uint64_t name; // CName hash
    uint64_t unused;
};

struct Layout
{
    bool ok = false;
    const char* why = nullptr;
    const uint8_t* liveRead = nullptr;  // bool (object, BoneRef*, Qs* out)
    uint32_t pose = 0;                  // animated object -> current pose (its first field: Qs[])
    const uint8_t* modelRead = nullptr; // Qs* (component, out, BoneRef*)
    const uint8_t* lookup = nullptr;    // void* (registry, component): the animated object
    const uint8_t* localRead = nullptr;
    uint32_t objectCache = 0;  // component -> animated object
    uint32_t registry = 0;     // component -> what the lookup takes
    uint32_t metaRig = 0;      // animated object -> meta rig
    uint32_t rigNames = 0;     // meta rig -> DynArray<CName>
    uint32_t rigParents = 0;   // meta rig -> DynArray<int16_t>
    uint32_t parts = 0;        // animated object -> first pose part node
    uint32_t partOf = 0;       // node -> pose part
    uint32_t next = 0;         // node -> next node
    uint32_t partNames = 0;    // part -> DynArray<CName>
    uint32_t countA = 0;       // part -> count of buffer A
    uint32_t countB = 0;       // part -> count of buffer B (a DynArray's size)
    uint32_t bufferA = 0;      // part -> buffer A (used when the counts differ)
    uint32_t bufferB = 0;      // part -> buffer B (used when they are equal)
};

// The live read's start, in 2.5.
constexpr const char* LiveReadPattern =
    "48 89 5C 24 08 48 89 6C 24 10 48 89 74 24 18 57 48 83 EC 40 49 8B F8 33 DB 4C 8B 41 ?? 48 8B F2 48 8B E9 "
    "4D 85 C0 74 ?? 83 39 FF 74 ?? 48 8B 51 ?? 48 8B 46 10 48 39 42 ?? 0F 85 ?? ?? ?? ?? 8B 06 83 F8 FF 74 ?? "
    "48 8D 0C 40 48 C1 E1 04 49 03 08";
constexpr size_t LivePose = 28, LiveMetaRig = 48, LiveReadLength = 81;

// The model read's start, in 2.5. ?? are the offsets and calls read below.
constexpr const char* ModelReadPattern =
    "48 89 5C 24 08 48 89 74 24 10 48 89 7C 24 18 41 54 41 56 41 57 48 83 EC 50 48 8B B9 ?? ?? ?? ?? "
    "33 DB 4D 8B F0 48 8B F2 48 85 FF 75 ?? 48 8B D1 48 8B 89 ?? ?? ?? ?? E8 ?? ?? ?? ?? 48 8B F8 83 3F FF "
    "74 04 48 8B 5F ?? 4C 8B 63 ?? 48 8B D7 4C 8B 7B ?? 48 8B CE 4D 8B 46 08 41 8B 1E E8 ?? ?? ?? ??";
// Where its parts are, in bytes from the start.
constexpr size_t ModelCache = 28, ModelRegistry = 51, ModelLookupCall = 55, ModelMetaRig = 71, ModelNames = 75,
                 ModelParents = 82, ModelLocalCall = 93, ModelReadLength = 98;

constexpr const char* LocalReadPattern =
    "48 89 5C 24 08 48 89 74 24 18 57 48 83 EC 30 48 8B 5A ?? 4D 8B D0 4C 8B D9 48 85 DB 0F 84 ?? ?? ?? ?? "
    "48 8B 7B ?? 48 85 FF 0F 84 ?? ?? ?? ?? 48 8D 8F ?? ?? ?? ?? 4C 89 54 24 48 48 8D 54 24 48 E8 ?? ?? ?? ?? "
    "8B F0 83 F8 FF 74 ?? 48 8D 54 24 20 48 8B CF E8 ?? ?? ?? ??";
constexpr size_t LocalParts = 18, LocalPartOf = 37, LocalNoPartJump = 41, LocalPartNames = 50,
                 LocalBufferCall = 84, LocalReadLength = 89;

constexpr const char* BufferReadPattern =
    "48 83 EC 18 8B 41 ?? 4C 8B CA 39 81 ?? ?? ?? ?? 74 ?? 48 8B 51 ?? 48 8D 0C 40 48 C1 E1 04 48 03 CA";
constexpr size_t BufferCountA = 6, BufferCountB = 12, BufferJump = 16, BufferA = 21, BufferReadLength = 33;

// "4C 8B 81 <bufferB> 8B 81 <countB>" where the buffer read jumps when the counts are equal.
constexpr uint8_t BufferBForm[] = {0x4C, 0x8B, 0x81};

// Pattern text to bytes: -1 for ??.
inline size_t ParsePattern(const char* aText, int* aOut, size_t aMax)
{
    size_t n = 0;
    for (const char* c = aText; *c && n < aMax;)
    {
        if (*c == ' ')
        {
            ++c;
            continue;
        }
        if (*c == '?')
        {
            aOut[n++] = -1;
            c += c[1] == '?' ? 2 : 1;
            continue;
        }
        auto hex = [](char h) { return h <= '9' ? h - '0' : (h | 0x20) - 'a' + 10; };
        aOut[n++] = hex(c[0]) * 16 + hex(c[1]);
        c += 2;
    }
    return n;
}

inline bool MatchesAt(const uint8_t* aAt, const char* aPattern)
{
    int bytes[160];
    const size_t n = ParsePattern(aPattern, bytes, 160);
    for (size_t i = 0; i < n; ++i)
    {
        if (bytes[i] >= 0 && aAt[i] != bytes[i])
            return false;
    }
    return true;
}

// The first match of a pattern in [aBegin, aEnd), and how many there are (up to 2).
inline const uint8_t* FindPattern(const uint8_t* aBegin, const uint8_t* aEnd, const char* aPattern, int* aCount)
{
    int bytes[160];
    const size_t n = ParsePattern(aPattern, bytes, 160);
    const uint8_t* found = nullptr;
    int count = 0;
    if (static_cast<size_t>(aEnd - aBegin) < n)
        return nullptr;
    const uint8_t* last = aEnd - n;
    for (const uint8_t* at = aBegin; at <= last;)
    {
        at = static_cast<const uint8_t*>(std::memchr(at, bytes[0], static_cast<size_t>(last - at) + 1));
        if (!at)
            break;
        bool ok = true;
        for (size_t i = 1; i < n && ok; ++i)
            ok = bytes[i] < 0 || at[i] == bytes[i];
        if (ok)
        {
            if (!found)
                found = at;
            if (++count >= 2)
                break;
        }
        ++at;
    }
    if (aCount)
        *aCount = count;
    return found;
}

inline uint32_t Read32(const uint8_t* aAt)
{
    uint32_t v;
    std::memcpy(&v, aAt, 4);
    return v;
}

// The target of a call or jump whose rel32 is at aRel (the instruction ends 4 bytes after it).
inline const uint8_t* Target(const uint8_t* aRel)
{
    return aRel + 4 + static_cast<int32_t>(Read32(aRel));
}

// Reads every offset from the model read's code and the two functions it reaches. aInside says
// whether a target lies inside the code that may be read (aLimit bytes from it at least).
template<typename Inside>
Layout ReadLayout(const uint8_t* aModelRead, const uint8_t* aLiveRead, Inside aInside)
{
    Layout l;
    if (!aLiveRead || !aInside(aLiveRead, LiveReadLength) || !MatchesAt(aLiveRead, LiveReadPattern))
    {
        l.why = "the live read's code is not as expected";
        return l;
    }
    l.liveRead = aLiveRead;
    l.pose = aLiveRead[LivePose];
    if (!aModelRead || !aInside(aModelRead, ModelReadLength) || !MatchesAt(aModelRead, ModelReadPattern))
    {
        l.why = "the model read's code is not as expected";
        return l;
    }
    l.modelRead = aModelRead;
    l.objectCache = Read32(aModelRead + ModelCache);
    l.registry = Read32(aModelRead + ModelRegistry);
    l.lookup = Target(aModelRead + ModelLookupCall + 1);
    l.metaRig = aModelRead[ModelMetaRig];
    l.rigNames = aModelRead[ModelNames];
    l.rigParents = aModelRead[ModelParents];
    if (aLiveRead[LiveMetaRig] != l.metaRig)
    {
        l.why = "the live read and the model read find the meta rig in different places";
        return l;
    }
    l.localRead = Target(aModelRead + ModelLocalCall + 1);
    if (!aInside(l.lookup, 1))
    {
        l.why = "the animated object lookup is outside the game's code";
        return l;
    }
    if (!aInside(l.localRead, LocalReadLength) || !MatchesAt(l.localRead, LocalReadPattern))
    {
        l.why = "the local read's code is not as expected";
        return l;
    }
    l.parts = l.localRead[LocalParts];
    l.partOf = l.localRead[LocalPartOf];
    l.partNames = Read32(l.localRead + LocalPartNames);
    const uint8_t* noPart = Target(l.localRead + LocalNoPartJump + 2);
    if (!aInside(noPart, 4) || noPart[0] != 0x48 || noPart[1] != 0x8B || noPart[2] != 0x5B)
    {
        l.why = "the local read's step to the next pose part is not as expected";
        return l;
    }
    l.next = noPart[3];
    const uint8_t* buffer = Target(l.localRead + LocalBufferCall + 1);
    if (!aInside(buffer, BufferReadLength) || !MatchesAt(buffer, BufferReadPattern))
    {
        l.why = "the buffer read's code is not as expected";
        return l;
    }
    l.countA = buffer[BufferCountA];
    l.countB = Read32(buffer + BufferCountB);
    l.bufferA = buffer[BufferA];
    const uint8_t* equal = buffer + BufferJump + 2 + static_cast<int8_t>(buffer[BufferJump + 1]);
    if (!aInside(equal, 13) || std::memcmp(equal, BufferBForm, sizeof(BufferBForm)) != 0 || equal[7] != 0x8B ||
        equal[8] != 0x81 || Read32(equal + 9) != l.countB)
    {
        l.why = "the buffer read's second buffer is not as expected";
        return l;
    }
    l.bufferB = Read32(equal + 3);
    l.ok = true;
    return l;
}

// The game's DynArray: entries, capacity, size.
struct Array
{
    const void* entries;
    uint32_t capacity;
    uint32_t size;
};

inline const Array* ArrayAt(const uint8_t* aBase, uint32_t aOffset)
{
    return reinterpret_cast<const Array*>(aBase + aOffset);
}

// A bone's local transform as the local read finds it, and which pose part held it (-1: none, the
// identity). Reads memory only: call it where a bad pointer is caught.
inline Qs LocalOf(const Layout& aL, const uint8_t* aObject, uint64_t aName, int& aPart)
{
    aPart = -1;
    int k = 0;
    for (const uint8_t* node = *reinterpret_cast<const uint8_t* const*>(aObject + aL.parts); node;
         node = *reinterpret_cast<const uint8_t* const*>(node + aL.next), ++k)
    {
        const uint8_t* part = *reinterpret_cast<const uint8_t* const*>(node + aL.partOf);
        if (!part)
            continue;
        const Array* names = ArrayAt(part, aL.partNames);
        const auto* list = static_cast<const uint64_t*>(names->entries);
        int64_t at = -1;
        for (uint32_t i = 0; i < names->size; ++i)
        {
            if (list[i] == aName)
            {
                at = i;
                break;
            }
        }
        if (at < 0)
            continue;
        const uint32_t a = *reinterpret_cast<const uint32_t*>(part + aL.countA);
        const uint32_t b = *reinterpret_cast<const uint32_t*>(part + aL.countB);
        const Qs* buffer = *reinterpret_cast<const Qs* const*>(part + (b == a ? aL.bufferB : aL.bufferA));
        aPart = k;
        return buffer[at];
    }
    Qs identity{};
    identity.r[3] = 1.f;
    identity.s[0] = identity.s[1] = identity.s[2] = 1.f;
    return identity;
}

// Quaternion product a * b.
inline void QuatMul(const float* a, const float* b, float* out)
{
    const float x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const float y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const float z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const float w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x, out[1] = y, out[2] = z, out[3] = w;
}

// v rotated by unit quaternion q.
inline void Rotate(const float* q, const float* v, float* out)
{
    const float u[3] = {q[0], q[1], q[2]};
    const float s = q[3];
    const float dotUV = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const float dotUU = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const float cross[3] = {u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]};
    for (int i = 0; i < 3; ++i)
        out[i] = 2.f * dotUV * u[i] + (s * s - dotUU) * v[i] + 2.f * s * cross[i];
}

// parent * local, the usual QsTransform product (scale per axis, not sheared). REDnode's own
// maths, for the unit test and for comparing with the game's model read.
inline Qs Mul(const Qs& aParent, const Qs& aLocal)
{
    Qs out{};
    const float scaled[3] = {aParent.s[0] * aLocal.t[0], aParent.s[1] * aLocal.t[1], aParent.s[2] * aLocal.t[2]};
    float rotated[3];
    Rotate(aParent.r, scaled, rotated);
    for (int i = 0; i < 3; ++i)
    {
        out.t[i] = aParent.t[i] + rotated[i];
        out.s[i] = aParent.s[i] * aLocal.s[i];
    }
    QuatMul(aParent.r, aLocal.r, out.r);
    return out;
}
// The child relative to its parent, from both in model space: parent^-1 * child, so that
// Mul(parent, Local(parent, child)) is the child again.
inline Qs Local(const Qs& aParent, const Qs& aChild)
{
    Qs out{};
    const float inv[4] = {-aParent.r[0], -aParent.r[1], -aParent.r[2], aParent.r[3]};
    const float d[3] = {aChild.t[0] - aParent.t[0], aChild.t[1] - aParent.t[1], aChild.t[2] - aParent.t[2]};
    float back[3];
    Rotate(inv, d, back);
    for (int i = 0; i < 3; ++i)
    {
        const float s = aParent.s[i] != 0.f ? aParent.s[i] : 1.f;
        out.t[i] = back[i] / s;
        out.s[i] = aChild.s[i] / s;
    }
    QuatMul(inv, aChild.r, out.r);
    return out;
}
} // namespace rednode::overlay::bones
