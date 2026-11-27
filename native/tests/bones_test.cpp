// Checks bones.hpp (#62): the offsets read from made-up code laid out as 2.5's, a bone's local
// transform found in made-up pose parts, and the QsTransform product. With REDNODE_GAME_EXE set to
// Cyberpunk2077.exe's path, also finds the model read in the real exe and prints its offsets.

#include "../src/overlay/bones.hpp"

#include <Windows.h>

#include <cmath>
#include <cstdio>
#include <vector>

using namespace rednode::overlay::bones;

namespace
{
int g_failed = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s %s\n", aOk ? "  ok  " : "  FAIL", aWhat);
    if (!aOk)
        g_failed++;
}

bool Near(float a, float b)
{
    return std::fabs(a - b) < 1e-4f;
}

// Writes a pattern's bytes at aAt, ?? as 0.
void Put(uint8_t* aAt, const char* aPattern)
{
    int bytes[160];
    const size_t n = ParsePattern(aPattern, bytes, 160);
    for (size_t i = 0; i < n; ++i)
        aAt[i] = bytes[i] < 0 ? 0 : static_cast<uint8_t>(bytes[i]);
}

void Put32(uint8_t* aAt, uint32_t aV)
{
    std::memcpy(aAt, &aV, 4);
}

// A call or jump at aRel (its rel32) to aTo.
void Aim(uint8_t* aRel, const uint8_t* aTo)
{
    Put32(aRel, static_cast<uint32_t>(aTo - (aRel + 4)));
}

void MadeUpCode()
{
    std::vector<uint8_t> code(0x400, 0xCC);
    uint8_t* model = code.data();
    uint8_t* lookup = code.data() + 0x80;
    uint8_t* local = code.data() + 0x100;
    uint8_t* next = code.data() + 0x180;
    uint8_t* buffer = code.data() + 0x200;
    uint8_t* equal = code.data() + 0x240;

    Put(model, ModelReadPattern);
    Put32(model + ModelCache, 0x1234);
    Put32(model + ModelRegistry, 0x5678);
    Aim(model + ModelLookupCall + 1, lookup);
    model[ModelMetaRig] = 0x18;
    model[ModelNames] = 0x28;
    model[ModelParents] = 0x38;
    Aim(model + ModelLocalCall + 1, local);

    Put(local, LocalReadPattern);
    local[LocalParts] = 0x70;
    local[LocalPartOf] = 0x50;
    Put32(local + LocalPartNames, 0x1E0);
    Aim(local + LocalNoPartJump + 2, next);
    Aim(local + LocalBufferCall + 1, buffer);
    next[0] = 0x48, next[1] = 0x8B, next[2] = 0x5B, next[3] = 0x10;

    Put(buffer, BufferReadPattern);
    buffer[BufferCountA] = 0x64;
    Put32(buffer + BufferCountB, 0x2C4);
    buffer[BufferA] = 0x58;
    buffer[BufferJump + 1] = static_cast<uint8_t>(equal - (buffer + BufferJump + 2));
    equal[0] = 0x4C, equal[1] = 0x8B, equal[2] = 0x81;
    Put32(equal + 3, 0x2B8);
    equal[7] = 0x8B, equal[8] = 0x81;
    Put32(equal + 9, 0x2C4);

    auto inside = [&](const uint8_t* aAt, size_t aBytes) {
        return aAt >= code.data() && aAt + aBytes <= code.data() + code.size();
    };
    int count = 0;
    Check(FindPattern(code.data(), code.data() + code.size(), ModelReadPattern, &count) == model && count == 1,
          "the model read's pattern is found once");
    const Layout l = ReadLayout(model, inside);
    Check(l.ok, l.ok ? "the layout reads" : l.why);
    Check(l.objectCache == 0x1234 && l.registry == 0x5678, "the component's object and registry offsets");
    Check(l.lookup == lookup && l.localRead == local, "the lookup and the local read");
    Check(l.metaRig == 0x18 && l.rigNames == 0x28 && l.rigParents == 0x38, "the meta rig and its lists");
    Check(l.parts == 0x70 && l.partOf == 0x50 && l.next == 0x10 && l.partNames == 0x1E0, "the pose parts");
    Check(l.countA == 0x64 && l.countB == 0x2C4 && l.bufferA == 0x58 && l.bufferB == 0x2B8, "the buffers");

    // A broken second buffer form is refused.
    equal[7] = 0x90;
    Check(!ReadLayout(model, inside).ok, "a changed buffer read is refused");
    equal[7] = 0x8B;
    // A call outside the code is refused.
    auto narrow = [&](const uint8_t* aAt, size_t aBytes) { return aAt >= model && aAt + aBytes <= model + 0x100; };
    Check(!ReadLayout(model, narrow).ok, "a local read outside the code is refused");
}

Qs Make(float tx, float ty, float tz, float rx, float ry, float rz, float rw)
{
    Qs q{};
    q.t[0] = tx, q.t[1] = ty, q.t[2] = tz;
    q.r[0] = rx, q.r[1] = ry, q.r[2] = rz, q.r[3] = rw;
    q.s[0] = q.s[1] = q.s[2] = 1.f;
    return q;
}

void MadeUpPose()
{
    // 2.5's offsets, on made-up objects: two parts, the second holding "b" in buffer B.
    Layout l;
    l.parts = 0x60, l.partOf = 0x40, l.next = 0x08, l.partNames = 0xD8;
    l.countA = 0x5C, l.countB = 0xC4, l.bufferA = 0x48, l.bufferB = 0xB8;

    alignas(16) uint8_t object[0x100] = {};
    alignas(16) uint8_t node1[0x48] = {}, node2[0x48] = {};
    alignas(16) uint8_t part1[0x100] = {}, part2[0x100] = {};
    uint64_t names1[2] = {111, 222};
    uint64_t names2[1] = {333};
    Qs buffer1A[2] = {Make(1, 0, 0, 0, 0, 0, 1), Make(2, 0, 0, 0, 0, 0, 1)};
    Qs buffer2B[1] = {Make(0, 3, 0, 0, 0, 0, 1)};
    Qs buffer2A[1] = {Make(9, 9, 9, 0, 0, 0, 1)};

    auto setPtr = [](uint8_t* aBase, uint32_t aOff, const void* aPtr) { std::memcpy(aBase + aOff, &aPtr, 8); };
    auto setArray = [&](uint8_t* aBase, uint32_t aOff, const void* aEntries, uint32_t aSize) {
        setPtr(aBase, aOff, aEntries);
        std::memcpy(aBase + aOff + 8, &aSize, 4);
        std::memcpy(aBase + aOff + 12, &aSize, 4);
    };
    setPtr(object, l.parts, node1);
    setPtr(node1, l.partOf, part1);
    setPtr(node1, l.next, node2);
    setPtr(node2, l.partOf, part2);
    setArray(part1, l.partNames, names1, 2);
    uint32_t two = 2, three = 3, one = 1;
    std::memcpy(part1 + l.countA, &two, 4);
    std::memcpy(part1 + l.countB, &three, 4); // differ: buffer A
    setPtr(part1, l.bufferA, buffer1A);
    setArray(part2, l.partNames, names2, 1);
    std::memcpy(part2 + l.countA, &one, 4);
    std::memcpy(part2 + l.countB, &one, 4); // equal: buffer B
    setPtr(part2, l.bufferA, buffer2A);
    setPtr(part2, l.bufferB, buffer2B);

    int part = 9;
    Qs q = LocalOf(l, object, 222, part);
    Check(part == 0 && Near(q.t[0], 2), "a bone in the first part, from buffer A when the counts differ");
    q = LocalOf(l, object, 333, part);
    Check(part == 1 && Near(q.t[1], 3), "a bone in the second part, from buffer B when the counts are equal");
    q = LocalOf(l, object, 444, part);
    Check(part == -1 && Near(q.r[3], 1) && Near(q.s[0], 1) && Near(q.t[0], 0), "a bone no part holds is the identity");
}

void Product()
{
    const float h = std::sqrt(0.5f);
    // Parent turned 90 degrees about z, at (1, 0, 0); child 1 m along x from it.
    const Qs parent = Make(1, 0, 0, 0, 0, h, h);
    const Qs child = Make(1, 0, 0, 0, 0, 0, 1);
    const Qs m = Mul(parent, child);
    Check(Near(m.t[0], 1) && Near(m.t[1], 1) && Near(m.t[2], 0), "the child's place turns with its parent");
    Check(Near(m.r[2], h) && Near(m.r[3], h), "the rotations multiply");
    Qs scaled = parent;
    scaled.s[0] = scaled.s[1] = scaled.s[2] = 2.f;
    const Qs ms = Mul(scaled, child);
    Check(Near(ms.t[1], 2) && Near(ms.s[0], 2), "the parent's scale scales the child's place");
}

void RealExe()
{
    wchar_t exe[MAX_PATH];
    if (!GetEnvironmentVariableW(L"REDNODE_GAME_EXE", exe, MAX_PATH))
    {
        std::printf("  (set REDNODE_GAME_EXE to check the game exe)\n");
        return;
    }
    HMODULE mapped = LoadLibraryExW(exe, nullptr, LOAD_LIBRARY_AS_IMAGE_RESOURCE);
    Check(mapped != nullptr, "the game exe maps");
    if (!mapped)
        return;
    const auto* image = reinterpret_cast<const uint8_t*>(reinterpret_cast<uintptr_t>(mapped) & ~uintptr_t{3});
    const auto* nt =
        reinterpret_cast<const IMAGE_NT_HEADERS64*>(image + reinterpret_cast<const IMAGE_DOS_HEADER*>(image)->e_lfanew);
    const IMAGE_SECTION_HEADER* section = IMAGE_FIRST_SECTION(nt);
    std::vector<std::pair<const uint8_t*, const uint8_t*>> code;
    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, section++)
    {
        if (section->Characteristics & IMAGE_SCN_MEM_EXECUTE)
            code.push_back({image + section->VirtualAddress, image + section->VirtualAddress + section->Misc.VirtualSize});
    }
    const uint8_t* found = nullptr;
    int total = 0;
    for (const auto& c : code)
    {
        int count = 0;
        const uint8_t* at = FindPattern(c.first, c.second, ModelReadPattern, &count);
        if (at && !found)
            found = at;
        total += count;
    }
    Check(total == 1, "the model read's pattern matches once in the game exe");
    if (total != 1)
        return;
    auto inside = [&](const uint8_t* aAt, size_t aBytes) {
        for (const auto& c : code)
        {
            if (aAt >= c.first && aAt + aBytes <= c.second)
                return true;
        }
        return false;
    };
    const Layout l = ReadLayout(found, inside);
    Check(l.ok, l.ok ? "the layout reads from the game exe" : l.why);
    if (!l.ok)
        return;
    std::printf("      model read +0x%llx, lookup +0x%llx, local read +0x%llx\n",
                static_cast<unsigned long long>(l.modelRead - image), static_cast<unsigned long long>(l.lookup - image),
                static_cast<unsigned long long>(l.localRead - image));
    std::printf("      object +0x%X, registry +0x%X, meta rig +0x%X, names +0x%X, parents +0x%X\n", l.objectCache,
                l.registry, l.metaRig, l.rigNames, l.rigParents);
    std::printf("      parts +0x%X, part +0x%X, next +0x%X, part names +0x%X, buffers +0x%X (count +0x%X), +0x%X (count +0x%X)\n",
                l.parts, l.partOf, l.next, l.partNames, l.bufferA, l.countA, l.bufferB, l.countB);
}
} // namespace

int main()
{
    std::printf("bones.hpp\n");
    MadeUpCode();
    MadeUpPose();
    Product();
    RealExe();
    std::printf(g_failed ? "%d failed\n" : "all passed\n", g_failed);
    return g_failed ? 1 : 0;
}
