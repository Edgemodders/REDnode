// Tests for the opus state and reload (src/overlay/opus.cpp): it finds the game's sound pak tables by
// byte patterns and reads them in the running game, so it must find exactly the places the
// patterns point at, refuse when a pattern is missing or ambiguous, and answer with an error
// rather than crash on a wrong guess. Runs without the game: fake code and tables are built
// in one block, so the RIP-relative operands reach them as they do in the game.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/jvalue.hpp"
#include "../src/overlay/overlay.hpp"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

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
uint16_t* const LoadedCount = reinterpret_cast<uint16_t*>(g_mem + 0x1010);
uint8_t* const LoadedTable = g_mem + 0x3000;

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
constexpr size_t Registration = 0x500;
constexpr size_t TickThunk = 0x580;
constexpr size_t Tick = 0x5A0;
constexpr size_t Register = 0x5C0;
constexpr size_t Unregistration = 0x640;
constexpr size_t Unregister = 0x6C0;
constexpr size_t Acquire = 0x700;

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
    Put(Registration, {0x48, 0x8D, 0x0D, 0, 0, 0, 0, 0x41, 0x8D, 0x51, 0x40, 0xE8, 0, 0, 0, 0});
    Rip(Registration, 3, 7, Code + TickThunk);
    Rip(Registration + 11, 1, 5, Code + Register);
    Put(TickThunk, {0xE9, 0, 0, 0, 0});
    Rip(TickThunk, 1, 5, Code + Tick);
    Put(Register, {0x40, 0x53, 0x55, 0x41, 0x56, 0x41, 0x57});
    Put(Unregistration, {0x48, 0x8D, 0x0D, 0, 0, 0, 0, 0xE8, 0, 0, 0, 0});
    Rip(Unregistration, 3, 7, Code + Tick);
    Rip(Unregistration + 7, 1, 5, Code + Unregister);
    Put(Unregister, {0x40, 0x55, 0x56, 0x57, 0x48, 0x83, 0xEC, 0x30, 0x48, 0x8B, 0xF9, 0x8B, 0xF2});
    Put(Acquire, {0x0F, 0xB7, 0x15, 0, 0, 0, 0, 0x4C, 0x8D, 0x35, 0, 0, 0, 0, 0x33, 0xF6, 0x8B, 0xF9});
    Rip(Acquire, 3, 7, LoadedCount);
    Rip(Acquire + 7, 3, 7, LoadedTable);
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

    // Loaded sounds: 20 held twice, a free slot, 10 held once.
    *LoadedCount = 3;
    std::memset(LoadedTable, 0, 0x10 * 3);
    const uint32_t loaded[][2] = {{20, 2}, {0, 0}, {10, 1}};
    for (int i = 0; i < 3; i++)
        std::memcpy(LoadedTable + 0x10 * i, loaded[i], 8);
}

std::vector<CodeRange> CodeRanges()
{
    return {{Code, Code + CodeSize}};
}

// The game's loader, as far as the reload sees it: it raises the count first and refuses
// once an index is loaded; it writes the entry and opens its first paks only on success.
bool g_loaderAccepts = true;
uint64_t g_loaderHash = 0;
alignas(16) uint8_t g_newBlock[0x100];

bool FakeLoader(uint64_t aHash)
{
    g_loaderHash = aHash;
    if (*IndexCount >= 1)
        return false;
    (*IndexCount)++;
    if (!g_loaderAccepts)
        return false;
    const uint32_t n = 5, m = 0;
    uint8_t* at[7] = {g_newBlock, g_newBlock + 20, g_newBlock + 30, g_newBlock + 50, g_newBlock + 60,
                      g_newBlock + 80, g_newBlock + 100};
    std::memcpy(IndexTable, at, sizeof(at));
    std::memcpy(IndexTable + 0x38, &n, 4);
    std::memcpy(IndexTable + 0x3C, &m, 4);
    uint8_t* e = PakTable + 0x70 * (*PakCount);
    const uint16_t slot = *PakCount, pak = 9;
    std::memcpy(e, &slot, 2);
    std::memcpy(e + 4, &pak, 2);
    (*PakCount)++;
    return true;
}

bool FaultLoader(uint64_t)
{
    (*IndexCount)++;
    *reinterpret_cast<volatile uint32_t*>(uintptr_t{0x30}) = 1;
    return true;
}

uint16_t PakNumber(int aEntry)
{
    uint16_t pak;
    std::memcpy(&pak, PakTable + 0x70 * aEntry + 4, 2);
    return pak;
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
    Check(places.loader == Code + Loader, "the loader is the function the count check is in");

    std::string error, summary;
    const std::string state = OpusState(places, Params(R"({"sounds":[20, 99, "0x1e"]})"), error, &summary);
    Check(error.empty(), "reads the state without an error");
    Check(Has(state, "\"infoPathOk\":true"), "the path hash is sfx_container.opusinfo's");
    Check(Has(state, "\"sounds\":3,\"second\":2,\"bytes\":68"), "the index: 3 sounds, 2 second entries, 68 bytes");
    Check(Has(state, "\"checksum\":\"0x"), "the index has a checksum");
    Check(Has(state, "\"pak\":5") && Has(state, "\"pak\":6") && !Has(state, "\"slot\":65535"),
          "the open paks are listed and the free slot is not");
    Check(Has(state, "{\"id\":20,\"found\":true,\"index\":0,\"row\":1,\"pak\":6,\"offset\":4096,\"size\":2000,"
                     "\"headerSize\":41,\"x10\":200,\"held\":2}"),
          "sound 20 is found with its pak, offset, size and references");
    Check(Has(state, "{\"id\":99,\"found\":false}"), "an unknown sound is not found");
    Check(Has(state, "{\"id\":30,\"found\":true") && Has(state, "\"x10\":300,\"held\":0}"),
          "an id given as a hex string is read; a sound not loaded is not held");
    Check(Has(summary, "1 index of 3 sounds") && Has(summary, "2 paks open: 5 (2), 6 (1)") &&
              Has(summary, "2 sounds held") && Has(summary, "sound 20 in pak 6 at 4096, held (2 references)") &&
              Has(summary, "sound 30 in pak 7 at 8192, not held"),
          "the summary line");
    Check(places.loadedCount == LoadedCount && places.loadedTable == LoadedTable, "finds the loaded sounds");
    {
        OpusPlaces noLoaded = places;
        noLoaded.loadedTable = nullptr;
        std::string noSummary;
        const std::string plain = OpusState(noLoaded, Params(R"({"sounds":[20]})"), error, &noSummary);
        Check(Has(plain, "\"held\":null") && !Has(noSummary, "held"),
              "without the loaded sounds the state says nothing of them");
    }

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

    // The audio engine's callback registration.
    BuildCode();
    AudioCallbacks callbacks;
    Check(LocateAudioCallbacks(CodeRanges(), callbacks, why) && callbacks.registerFn == Code + Register &&
              callbacks.unregisterFn == Code + Unregister,
          "finds RegisterGlobalCallback and UnregisterGlobalCallback around the pak tick");
    Code[TickThunk] = 0xCC;
    Check(!LocateAudioCallbacks(CodeRanges(), callbacks, why) && Has(why, "pak tick"),
          "a registration of something else is refused");
    BuildCode();
    Code[Register + 1] = 0x90;
    Check(!LocateAudioCallbacks(CodeRanges(), callbacks, why) && Has(why, "does not start"),
          "a registration function that starts otherwise is refused");
    BuildCode();
    Code[Unregister + 1] = 0x90;
    Check(!LocateAudioCallbacks(CodeRanges(), callbacks, why) && Has(why, "no unregistration"),
          "no way to unregister is refused");
    BuildCode();

    // The reload: pak entries retired, the loader run again with the path hash.
    BuildTables();
    places.loader = reinterpret_cast<uint8_t*>(&FakeLoader);
    OpusReload r;
    OpusReloadNow(places, r);
    Check(r.loaded && !r.restored && r.soundsBefore == 3 && r.soundsAfter == 5 && *IndexCount == 1,
          "a reload loads the new index: 3 sounds before, 5 after");
    Check(g_loaderHash == *InfoHash, "the loader gets the index's path hash");
    Check(r.retired == 2 && PakNumber(0) == 0xFFFE && PakNumber(2) == 0xFFFE && PakNumber(1) == 0,
          "the two open pak entries are retired, the free slot is left alone");
    Check(*PakCount == 4 && PakNumber(3) == 9, "the paks the new index opens are added after them");
    error.clear();
    summary.clear();
    OpusState(places, Params("{}"), error, &summary);
    Check(error.empty() && Has(summary, "of 5 sounds") && Has(summary, "65534 (2), 65534 (1), 9 (0)"),
          "the state after a reload shows the new index and the retired entries");

    // A refused index: everything goes back.
    BuildTables();
    uint8_t entryBefore[0x60];
    std::memcpy(entryBefore, IndexTable, 0x60);
    g_loaderAccepts = false;
    OpusReloadNow(places, r);
    Check(!r.loaded && r.restored && Has(r.why, "refused") && *IndexCount == 1 &&
              std::memcmp(entryBefore, IndexTable, 0x60) == 0 && PakNumber(0) == 5 && PakNumber(2) == 6,
          "a refused index puts the old index and pak numbers back");
    g_loaderAccepts = true;

    // A fault in the loader: caught, and everything goes back.
    places.loader = reinterpret_cast<uint8_t*>(&FaultLoader);
    OpusReloadNow(places, r);
    Check(!r.loaded && r.restored && Has(r.why, "fault") && *IndexCount == 1 && PakNumber(0) == 5,
          "a fault during the reload is caught and the old index put back");

    // No index loaded: nothing is touched.
    *IndexCount = 0;
    places.loader = reinterpret_cast<uint8_t*>(&FakeLoader);
    OpusReloadNow(places, r);
    Check(!r.loaded && r.retired == 0 && Has(r.why, "not what REDnode expects") && PakNumber(0) == 5,
          "with no index loaded the reload touches nothing");

    // The park (H1c-2b): a thread stands in for the audio thread, ending a frame every millisecond.
    BuildTables();
    places.loader = reinterpret_cast<uint8_t*>(&FakeLoader);
    std::atomic<bool> running{true};
    std::atomic<int> frames{0};
    std::thread audio([&] {
        while (running)
        {
            OpusFrameEnd(places);
            frames++;
            Sleep(1);
        }
    });
    const auto waitFor = [](int aStep) {
        for (int i = 0; i < 500 && OpusStepNow() != aStep; i++)
            Sleep(1);
        return OpusStepNow() == aStep;
    };
    Check(OpusAskPark(2000) && waitFor(OpusParked), "the audio thread waits at its end of frame when asked");
    const int parkedAt = frames;
    Sleep(60);
    Check(frames == parkedAt, "it does no frames while it waits");
    Check(!OpusAskPark(2000), "a second wait is refused while one is on");
    Check(OpusAskReload() && waitFor(OpusDone), "a reload asked while it waits runs on it");
    const OpusOutcome outcome = OpusTakeOutcome();
    Check(outcome.done && outcome.reload.loaded && outcome.reload.soundsAfter == 5 && outcome.parkedMs >= 50,
          "the outcome: the new index, and how long it waited");
    Sleep(20);
    Check(frames > parkedAt && OpusStepNow() == OpusIdle, "it goes on after the reload");

    BuildTables();
    Check(OpusAskPark(2000) && waitFor(OpusParked) && OpusCancel() && waitFor(OpusIdle),
          "a cancelled wait ends without a reload");
    Sleep(20);
    Check(*IndexCount == 1 && PakNumber(0) == 5, "a cancelled wait leaves the index alone");
    Check(OpusAskPark(30) && waitFor(OpusParked) && waitFor(OpusIdle), "a wait nobody ends stops at its cap");
    Check(!OpusTakeOutcome().done, "a wait that ran out has no outcome");
    Check(OpusAskReload() && waitFor(OpusDone) && OpusTakeOutcome().reload.loaded,
          "a reload asked without a wait runs at the next end of frame");
    running = false;
    audio.join();

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
            AudioCallbacks realCallbacks;
            const bool regOk = LocateAudioCallbacks(code, realCallbacks, why);
            Check(regOk, regOk ? "the patterns find the audio callback functions in the game exe" : why.c_str());
            if (regOk)
                std::printf("      loaded sounds +0x%llx (count +0x%llx)\n",
                            static_cast<unsigned long long>(real.loadedTable ? real.loadedTable - image : 0),
                            static_cast<unsigned long long>(
                                real.loadedCount ? reinterpret_cast<const uint8_t*>(real.loadedCount) - image : 0));
            if (regOk)
                std::printf("      callback registration +0x%llx, unregistration +0x%llx, loader +0x%llx\n",
                            static_cast<unsigned long long>(static_cast<const uint8_t*>(realCallbacks.registerFn) - image),
                            static_cast<unsigned long long>(static_cast<const uint8_t*>(realCallbacks.unregisterFn) - image),
                            static_cast<unsigned long long>(real.loader - image));
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

    std::printf("%s\n", g_failed ? "Opus tests FAILED" : "Opus tests passed");
    return g_failed ? 1 : 0;
}
