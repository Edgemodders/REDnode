// Tests for the opus state (src/overlay/opus.cpp): it finds the game's sound pak tables by
// byte patterns and reads them in the running game, so it must find exactly the places the
// patterns point at, refuse when a pattern is missing or ambiguous, and answer with an error
// rather than crash on a wrong guess. Runs without the game: fake code and tables are built
// in one block, so the RIP-relative operands reach them as they do in the game.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/jvalue.hpp"
#include "../src/overlay/overlay.hpp"

#include <cstdio>
#include <cstring>
#include <string>

namespace rednode::overlay
{
std::string JsonString(std::string_view aText)
{
    return "\"" + std::string(aText) + "\"";
}
namespace detail
{
void Log(const char*, ...)
{
}
} // namespace detail
} // namespace rednode::overlay

using namespace rednode::overlay::detail;

namespace
{
int g_failed = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        g_failed++;
}

bool Has(const std::string& aText, const char* aPart)
{
    return aText.find(aPart) != std::string::npos;
}

uint64_t Fnv(const char* aText)
{
    uint64_t h = 0xCBF29CE484222325ull;
    for (const char* c = aText; *c; c++)
    {
        h ^= static_cast<uint8_t>(*c);
        h *= 0x100000001B3ull;
    }
    return h;
}

// Code first, then the game's globals, then the index's tables.
alignas(16) uint8_t g_mem[0x4000];
uint8_t* const Code = g_mem;
constexpr size_t CodeSize = 0x800;
uint16_t* const IndexCount = reinterpret_cast<uint16_t*>(g_mem + 0x1000);
uint16_t* const PakCount = reinterpret_cast<uint16_t*>(g_mem + 0x1004);
uint64_t* const InfoHash = reinterpret_cast<uint64_t*>(g_mem + 0x1008);
uint8_t* const IndexTable = g_mem + 0x1100;
uint8_t* const PakTable = g_mem + 0x1200;
uint8_t* const Block = g_mem + 0x2000;

void Put(size_t aAt, std::initializer_list<int> aBytes)
{
    for (int b : aBytes)
        Code[aAt++] = static_cast<uint8_t>(b);
}

// A displacement at aAt + aDisp, from the end of an aLength-byte instruction, to aTarget.
void Rip(size_t aAt, size_t aDisp, size_t aLength, const void* aTarget)
{
    const auto disp = static_cast<int32_t>(static_cast<const uint8_t*>(aTarget) - (Code + aAt + aLength));
    std::memcpy(Code + aAt + aDisp, &disp, 4);
}

constexpr size_t Loader = 0x100;
constexpr size_t Magic = 0x200;
constexpr size_t Opener = 0x300;
constexpr size_t Caller = 0x400;

void BuildCode()
{
    std::memset(Code, 0xCC, CodeSize);
    Put(Loader, {0x48, 0x89, 0x5C, 0x24, 0x08});
    Put(Loader + 0x1C, {0x0F, 0xB7, 0x05, 0, 0, 0, 0, 0xBA, 0x01, 0, 0, 0, 0x66, 0x89, 0x45, 0x6F, 0x66, 0x3B, 0xC2});
    Rip(Loader + 0x1C, 3, 7, IndexCount);
    Put(Magic, {0x43, 0x81, 0x3C, 0x2C, 0x53, 0x4E, 0x44, 0x20, 0x90, 0x90, 0x48, 0x8D, 0x05, 0, 0, 0, 0});
    Rip(Magic + 10, 3, 7, IndexTable);
    Put(Opener, {0x0F, 0xB7, 0x15, 0, 0, 0, 0, 0x48, 0x8D, 0x0D, 0, 0, 0, 0, 0x41, 0x0F, 0xB7, 0xC6, 0x33, 0xDB});
    Rip(Opener, 3, 7, PakCount);
    Put(Opener + 0x38, {0x48, 0x8D, 0x05, 0, 0, 0, 0});
    Rip(Opener + 0x38, 3, 7, PakTable);
    Put(Caller, {0x48, 0x8B, 0x0D, 0, 0, 0, 0, 0xE8, 0, 0, 0, 0});
    Rip(Caller, 3, 7, InfoHash);
    Rip(Caller + 7, 1, 5, Code + Loader);
}

// Three sounds (ids 10, 20, 30 in paks 5, 6, 7) and two entries of the second table, laid
// out as the game's loader does: 20 bytes per sound, then 4 per second entry, in one block.
void BuildTables()
{
    *IndexCount = 1;
    *PakCount = 3;
    *InfoHash = Fnv("base\\sound\\soundbanks\\sfx_container.opusinfo");
    const uint32_t n = 3, m = 2;
    const uint32_t ids[] = {10, 20, 30};
    const uint16_t paks[] = {5, 6, 7};
    const uint32_t x10[] = {100, 200, 300};
    const uint16_t headers[] = {40, 41, 42};
    const uint32_t sizes[] = {1000, 2000, 3000};
    const uint32_t offsets[] = {0, 4096, 8192};
    uint8_t* at[7] = {Block, Block + 4 * n, Block + 6 * n, Block + 10 * n, Block + 12 * n, Block + 16 * n, Block + 20 * n};
    std::memcpy(at[0], ids, sizeof(ids));
    std::memcpy(at[1], paks, sizeof(paks));
    std::memcpy(at[2], x10, sizeof(x10));
    std::memcpy(at[3], headers, sizeof(headers));
    std::memcpy(at[4], sizes, sizeof(sizes));
    std::memcpy(at[5], offsets, sizeof(offsets));
    std::memset(at[6], 0xAB, 4 * m);
    std::memset(IndexTable, 0, 0x60);
    std::memcpy(IndexTable, at, sizeof(at));
    std::memcpy(IndexTable + 0x38, &n, 4);
    std::memcpy(IndexTable + 0x3C, &m, 4);

    std::memset(PakTable, 0, 0x70 * 3);
    auto pak = [](int i, uint16_t slot, uint16_t number, uint32_t refs, uint64_t reader) {
        uint8_t* e = PakTable + 0x70 * i;
        std::memcpy(e, &slot, 2);
        std::memcpy(e + 4, &number, 2);
        std::memcpy(e + 0x10, &refs, 4);
        std::memcpy(e + 0x18, &reader, 8);
    };
    pak(0, 0, 5, 2, 0x1234);
    pak(1, 0xFFFF, 0, 0, 0); // a free slot
    pak(2, 2, 6, 1, 0x5678);
}

std::vector<CodeRange> CodeRanges()
{
    return {{Code, Code + CodeSize}};
}

json::Value Params(const char* aJson)
{
    json::Value v;
    std::string error;
    json::Parse(aJson, v, error);
    return v;
}
} // namespace

int main()
{
    BuildCode();
    BuildTables();

    OpusPlaces places;
    std::string why;
    const bool found = LocateOpus(CodeRanges(), places, why);
    Check(found, "finds the tables in the fake code");
    Check(places.indexCount == IndexCount && places.indexTable == IndexTable && places.pakCount == PakCount &&
              places.pakTable == PakTable && places.infoHash == InfoHash,
          "each place is the one its pattern points at");

    std::string error, summary;
    const std::string state = OpusState(places, Params(R"({"sounds":[20, 99, "0x1e"]})"), error, &summary);
    Check(error.empty(), "reads the state without an error");
    Check(Has(state, "\"infoPathOk\":true"), "the path hash is sfx_container.opusinfo's");
    Check(Has(state, "\"sounds\":3,\"second\":2,\"bytes\":68"), "the index: 3 sounds, 2 second entries, 68 bytes");
    Check(Has(state, "\"checksum\":\"0x"), "the index has a checksum");
    Check(Has(state, "\"pak\":5") && Has(state, "\"pak\":6") && !Has(state, "\"slot\":65535"),
          "the open paks are listed and the free slot is not");
    Check(Has(state, "{\"id\":20,\"found\":true,\"index\":0,\"row\":1,\"pak\":6,\"offset\":4096,\"size\":2000,"
                     "\"headerSize\":41,\"x10\":200}"),
          "sound 20 is found with its pak, offset and size");
    Check(Has(state, "{\"id\":99,\"found\":false}"), "an unknown sound is not found");
    Check(Has(state, "{\"id\":30,\"found\":true"), "an id given as a hex string is read");
    Check(Has(summary, "1 index of 3 sounds") && Has(summary, "2 paks open: 5 (2), 6 (1)") &&
              Has(summary, "sound 20 in pak 6 at 4096"),
          "the summary line");

    // The checksum follows the tables.
    const auto before = state.substr(state.find("checksum"), 30);
    Block[0] ^= 1;
    const std::string changed = OpusState(places, Params("{}"), error);
    Check(changed.substr(changed.find("checksum"), 30) != before, "a changed table changes the checksum");
    Block[0] ^= 1;

    error.clear();
    OpusState(places, Params(R"({"sounds":[-1]})"), error);
    Check(!error.empty(), "a negative id is refused");

    // Wrong guesses answer with an error, not a crash.
    *PakCount = 5000;
    error.clear();
    OpusState(places, Params("{}"), error);
    Check(Has(error, "out of range"), "a pak count past 2048 is refused");
    *PakCount = 3;
    uint8_t* const saved = *reinterpret_cast<uint8_t**>(IndexTable);
    *reinterpret_cast<uintptr_t*>(IndexTable) = 0x10;
    error.clear();
    const std::string unreadable = OpusState(places, Params(R"({"sounds":[20]})"), error);
    Check(error.empty() && Has(unreadable, "\"checksum\":null") && Has(unreadable, "{\"id\":20,\"found\":false}"),
          "an unreadable table gives no checksum and finds nothing, without a crash");
    *reinterpret_cast<uint8_t**>(IndexTable) = saved;
    OpusPlaces bad = places;
    bad.pakCount = reinterpret_cast<uint16_t*>(uintptr_t{0x20});
    error.clear();
    OpusState(bad, Params("{}"), error);
    Check(Has(error, "Could not read"), "an unreadable count is an error");

    // Patterns that miss or match twice.
    Code[Magic] = 0xCC;
    OpusPlaces none;
    Check(!LocateOpus(CodeRanges(), none, why) && Has(why, "header check not found"), "a missing pattern is named");
    BuildCode();
    Put(0x600, {0x43, 0x81, 0x3C, 0x2C, 0x53, 0x4E, 0x44, 0x20});
    Check(!LocateOpus(CodeRanges(), none, why) && Has(why, "more than once"), "a pattern matched twice is refused");
    BuildCode();
    Code[Loader] = 0x90;
    Check(!LocateOpus(CodeRanges(), none, why) && Has(why, "does not start"), "a loader that starts otherwise is refused");
    BuildCode();
    Rip(Caller + 7, 1, 5, Code + Magic);
    Check(!LocateOpus(CodeRanges(), none, why) && Has(why, "no call"), "no call of the loader is refused");

    // Optional: the patterns against a real game exe, mapped as an image without running it.
    // Set REDNODE_GAME_EXE to Cyberpunk2077.exe's path. Prints the offsets (they change with
    // each game version); the 2.31 ones are in opus.cpp's header.
    wchar_t exe[MAX_PATH];
    if (GetEnvironmentVariableW(L"REDNODE_GAME_EXE", exe, MAX_PATH))
    {
        HMODULE mapped = LoadLibraryExW(exe, nullptr, LOAD_LIBRARY_AS_IMAGE_RESOURCE);
        Check(mapped != nullptr, "the game exe maps");
        if (mapped)
        {
            const auto* image = reinterpret_cast<const uint8_t*>(reinterpret_cast<uintptr_t>(mapped) & ~uintptr_t{3});
            const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(
                image + reinterpret_cast<const IMAGE_DOS_HEADER*>(image)->e_lfanew);
            const IMAGE_SECTION_HEADER* section = IMAGE_FIRST_SECTION(nt);
            std::vector<CodeRange> code;
            for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, section++)
            {
                if (section->Characteristics & IMAGE_SCN_MEM_EXECUTE)
                    code.push_back({image + section->VirtualAddress,
                                    image + section->VirtualAddress + section->Misc.VirtualSize});
            }
            OpusPlaces real;
            const bool ok = LocateOpus(code, real, why);
            Check(ok, ok ? "the patterns find the tables in the game exe" : why.c_str());
            const auto rel = [&](const void* p) {
                return static_cast<unsigned long long>(static_cast<const uint8_t*>(p) - image);
            };
            if (ok)
                std::printf("      index count +0x%llx, index +0x%llx, pak count +0x%llx, paks +0x%llx, path hash +0x%llx\n",
                            rel(real.indexCount), rel(real.indexTable), rel(real.pakCount), rel(real.pakTable),
                            rel(real.infoHash));
            FreeLibrary(mapped);
        }
    }

    std::printf("%s\n", g_failed ? "Opus state tests FAILED" : "Opus state tests passed");
    return g_failed ? 1 : 0;
}
