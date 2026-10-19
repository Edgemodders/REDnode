// Opus state (H1c-1): a read-only look at the game's sound pak index and its open paks.
//
// The game's sound effects are Opus streams in sfx_container_<n>.opuspak files, found
// through one index, base\sound\soundbanks\sfx_container.opusinfo. A swap of an archive
// with them crashes the game, or, with the game paused, changes nothing (docs/world.md,
// "H1c: how the game loads its sound paks"). Reading the game 2.31 exe found why: the
// audio engine's start reads the index once, through the resource depot, into a table
// in memory, and opens some paks for good; a playing sound looks up its pak, offset and
// size there and opens its pak on demand. Offsets in 2.31 (from the image base):
//
//   0x279ED4  the index loader: refuses once an index is loaded (count at 0x3495DF8),
//             else reads the file (magic "SND ", version 0xF0000002) into an entry
//             of 0x60 bytes at 0x3B28FD0 and opens the first paks
//   0x279890  a sound's lookup: hash map, pak number, offset and size; opens the pak
//             through the depot if no entry has it (pak table: 0x70 bytes each at
//             0x3A38CC0, used count at 0x3495DFC, at most 2048)
//   0x3493B58 the index's resource path hash, set by a static initializer
//
// This file finds those places by byte patterns in the running game's code (so another
// game version either matches or reports what it missed) and reads them, never writes.
// The bridge method opus.state reports the index (sound count, a checksum of its tables)
// and the open paks (number, references, reader), and looks up given sound ids. Field
// names past the pak number are guesses from the code, unverified.
//
// Every read of game memory goes through a __try function with no C++ objects, so a
// wrong guess answers with an error instead of a crash.

#include "jvalue.hpp"
#include "overlay.hpp"

#include <cstdio>
#include <cstring>

namespace rednode::overlay::detail
{
namespace
{
constexpr size_t IndexStride = 0x60;
constexpr size_t PakStride = 0x70;
constexpr uint16_t MaxIndexes = 4;
constexpr uint16_t MaxPaks = 0x800;
constexpr uint32_t MaxSounds = 4000000;
constexpr const char* InfoPath = "base\\sound\\soundbanks\\sfx_container.opusinfo";

// The index loader's counter check: movzx eax,[count]; mov edx,1; mov [rbp+6F],ax; cmp ax,dx
constexpr const char* IndexCountPattern = "0F B7 05 ?? ?? ?? ?? BA 01 00 00 00 66 89 45 6F 66 3B C2";
constexpr size_t LoaderToIndexCount = 0x1C;            // from the loader's first byte
constexpr const char* LoaderStart = "48 89 5C 24 08";  // mov [rsp+8],rbx
// The loader's header check: cmp dword ptr [r12+r13],'SND '. The first lea rax after it is the table.
constexpr const char* MagicPattern = "43 81 3C 2C 53 4E 44 20";
// A sound's lookup: movzx edx,[pak count]; lea rcx,[image]; movzx eax,r14w; xor ebx,ebx.
constexpr const char* PakCountPattern = "0F B7 15 ?? ?? ?? ?? 48 8D 0D ?? ?? ?? ?? 41 0F B7 C6 33 DB";
constexpr size_t PakCountToTable = 0x38; // lea rax,[pak table]
// The audio start passes the index's path hash: mov rcx,[hash]; call loader.
constexpr const char* HashCallPattern = "48 8B 0D ?? ?? ?? ?? E8 ?? ?? ?? ??";

struct Pattern
{
    std::vector<int> bytes; // -1 for ??
};

Pattern Parse(const char* aText)
{
    Pattern p;
    for (const char* c = aText; *c;)
    {
        if (*c == ' ')
        {
            c++;
            continue;
        }
        if (c[0] == '?')
        {
            p.bytes.push_back(-1);
            c += c[1] == '?' ? 2 : 1;
            continue;
        }
        p.bytes.push_back(static_cast<int>(std::strtoul(std::string(c, 2).c_str(), nullptr, 16)));
        c += 2;
    }
    return p;
}

bool Matches(const uint8_t* aAt, const Pattern& aPattern)
{
    for (size_t i = 0; i < aPattern.bytes.size(); i++)
    {
        if (aPattern.bytes[i] >= 0 && aAt[i] != aPattern.bytes[i])
            return false;
    }
    return true;
}

// Calls aFound for each match in the code, in order; stops when it returns false.
template<typename F>
void ForEach(const std::vector<CodeRange>& aCode, const char* aText, F aFound)
{
    const Pattern p = Parse(aText);
    const auto first = static_cast<uint8_t>(p.bytes[0]);
    for (const auto& range : aCode)
    {
        if (static_cast<size_t>(range.end - range.begin) < p.bytes.size())
            continue;
        const uint8_t* last = range.end - p.bytes.size();
        for (const uint8_t* at = range.begin; at <= last;)
        {
            at = static_cast<const uint8_t*>(std::memchr(at, first, static_cast<size_t>(last - at) + 1));
            if (!at)
                break;
            if (Matches(at, p) && !aFound(at))
                return;
            at++;
        }
    }
}

// The one match of a pattern, or null with the count in aWhy.
const uint8_t* FindOne(const std::vector<CodeRange>& aCode, const char* aText, const char* aName, std::string& aWhy)
{
    const uint8_t* found = nullptr;
    int count = 0;
    ForEach(aCode, aText, [&](const uint8_t* at) {
        if (!found)
            found = at;
        return ++count < 2;
    });
    if (count != 1)
    {
        aWhy = std::string(aName) + (count ? " matched more than once" : " not found");
        return nullptr;
    }
    return found;
}

// The address a RIP-relative operand points at: the displacement at aAt + aDisp, from the
// end of an instruction of aLength bytes.
uint8_t* RipTarget(const uint8_t* aAt, size_t aDisp, size_t aLength)
{
    int32_t disp;
    std::memcpy(&disp, aAt + aDisp, sizeof(disp));
    return const_cast<uint8_t*>(aAt + aLength + disp);
}

uint64_t Fnv1a64(const char* aText)
{
    uint64_t h = 0xCBF29CE484222325ull;
    for (const char* c = aText; *c; c++)
    {
        h ^= static_cast<uint8_t>(*c);
        h *= 0x100000001B3ull;
    }
    return h;
}

// ---- reads of game memory: __try, no C++ objects ----

bool Copy(void* aTo, const void* aFrom, size_t aSize)
{
    __try
    {
        std::memcpy(aTo, aFrom, aSize);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

bool Checksum(const uint8_t* aFrom, size_t aSize, uint64_t* aOut)
{
    __try
    {
        uint64_t h = 0xCBF29CE484222325ull;
        for (size_t i = 0; i < aSize; i++)
        {
            h ^= aFrom[i];
            h *= 0x100000001B3ull;
        }
        *aOut = h;
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

bool FindRow(const uint32_t* aIds, uint32_t aCount, uint32_t aId, int64_t* aRow)
{
    __try
    {
        *aRow = -1;
        for (uint32_t i = 0; i < aCount; i++)
        {
            if (aIds[i] == aId)
            {
                *aRow = i;
                break;
            }
        }
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

// ---- the layout, as read from the code ----

template<typename T>
T At(const uint8_t* aRaw, size_t aOffset)
{
    T v;
    std::memcpy(&v, aRaw + aOffset, sizeof(T));
    return v;
}

struct Index
{
    const uint8_t* arrays[7]; // ids (u32), pak (u16), +0x10 (u32), header size? (u16), size? (u32), offset? (u32), second table (u32)
    uint32_t sounds;
    uint32_t second;
};

Index ReadIndex(const uint8_t* aRaw)
{
    Index x{};
    for (int i = 0; i < 7; i++)
        x.arrays[i] = At<const uint8_t*>(aRaw, static_cast<size_t>(i) * 8);
    x.sounds = At<uint32_t>(aRaw, 0x38);
    x.second = At<uint32_t>(aRaw, 0x3C);
    return x;
}

std::string HexBare(uint64_t aValue)
{
    char text[24];
    std::snprintf(text, sizeof(text), "0x%llx", static_cast<unsigned long long>(aValue));
    return text;
}

std::string Hex(uint64_t aValue)
{
    return "\"" + HexBare(aValue) + "\"";
}

bool ReadId(const json::Value& aValue, uint32_t& aOut)
{
    if (aValue.kind == json::Value::Kind::Number && aValue.number >= 0 && aValue.number <= 4294967295.0)
    {
        aOut = static_cast<uint32_t>(aValue.number);
        return true;
    }
    if (aValue.kind == json::Value::Kind::String && !aValue.text.empty())
    {
        char* end = nullptr;
        const unsigned long long v = std::strtoull(aValue.text.c_str(), &end, 0);
        if (end && !*end && v <= 0xFFFFFFFFull)
        {
            aOut = static_cast<uint32_t>(v);
            return true;
        }
    }
    return false;
}

bool g_tried = false;
bool g_found = false;
std::string g_why;
OpusPlaces g_places;
} // namespace

bool LocateOpus(const std::vector<CodeRange>& aCode, OpusPlaces& aOut, std::string& aWhy)
{
    const uint8_t* countAt = FindOne(aCode, IndexCountPattern, "the index count check", aWhy);
    if (!countAt)
        return false;
    const uint8_t* loader = countAt - LoaderToIndexCount;
    if (!Matches(loader, Parse(LoaderStart)))
    {
        aWhy = "the index loader does not start where expected";
        return false;
    }
    const uint8_t* magic = FindOne(aCode, MagicPattern, "the index header check", aWhy);
    if (!magic)
        return false;
    const uint8_t* table = nullptr;
    for (const uint8_t* at = magic; at < magic + 0x100; at++)
    {
        if (at[0] == 0x48 && at[1] == 0x8D && at[2] == 0x05)
        {
            table = at;
            break;
        }
    }
    if (!table)
    {
        aWhy = "the index table was not found after the header check";
        return false;
    }
    const uint8_t* pakAt = FindOne(aCode, PakCountPattern, "the pak count read", aWhy);
    if (!pakAt)
        return false;
    const uint8_t* pakTable = pakAt + PakCountToTable;
    if (!Matches(pakTable, Parse("48 8D 05")))
    {
        aWhy = "the pak table is not where expected after the pak count read";
        return false;
    }
    uint64_t* hash = nullptr;
    bool twoHashes = false;
    ForEach(aCode, HashCallPattern, [&](const uint8_t* at) {
        if (RipTarget(at + 7, 1, 5) != loader)
            return true;
        auto* h = reinterpret_cast<uint64_t*>(RipTarget(at, 3, 7));
        if (hash && hash != h)
            twoHashes = true;
        hash = h;
        return true;
    });
    if (!hash || twoHashes)
    {
        aWhy = hash ? "the index loader is called with two different paths" : "no call of the index loader with a path";
        return false;
    }
    aOut.indexCount = reinterpret_cast<uint16_t*>(RipTarget(countAt, 3, 7));
    aOut.indexTable = RipTarget(table, 3, 7);
    aOut.pakCount = reinterpret_cast<uint16_t*>(RipTarget(pakAt, 3, 7));
    aOut.pakTable = RipTarget(pakTable, 3, 7);
    aOut.infoHash = hash;
    return true;
}

// opus.state {"sounds": [id, ...]}: the index, the open paks, and the rows of the given sound ids.
std::string OpusState(const OpusPlaces& aPlaces, const json::Value& aParams, std::string& aError,
                      std::string* aSummary)
{
    uint16_t indexes = 0, paks = 0;
    uint64_t infoHash = 0;
    if (!Copy(&indexes, aPlaces.indexCount, 2) || !Copy(&paks, aPlaces.pakCount, 2) ||
        !Copy(&infoHash, aPlaces.infoHash, 8))
    {
        aError = "Could not read the sound pak counts";
        return {};
    }
    if (indexes > MaxIndexes || paks > MaxPaks)
    {
        aError = "The sound pak counts are out of range (" + std::to_string(indexes) + " indexes, " +
                 std::to_string(paks) + " paks): the layout is not what REDnode expects";
        return {};
    }

    std::string out = "{\"infoHash\":" + Hex(infoHash) + ",\"infoPathOk\":" +
                      (infoHash == Fnv1a64(InfoPath) ? "true" : "false") + ",\"indexes\":[";
    std::string summary = std::to_string(indexes) + (indexes == 1 ? " index" : " indexes");
    std::vector<Index> list;
    for (uint16_t i = 0; i < indexes; i++)
    {
        uint8_t raw[IndexStride];
        if (!Copy(raw, aPlaces.indexTable + i * IndexStride, IndexStride))
        {
            aError = "Could not read sound index " + std::to_string(i);
            return {};
        }
        const Index x = ReadIndex(raw);
        if (x.sounds > MaxSounds || x.second > MaxSounds)
        {
            aError = "Sound index " + std::to_string(i) + " has " + std::to_string(x.sounds) +
                     " sounds: the layout is not what REDnode expects";
            return {};
        }
        list.push_back(x);
        // The tables are one block: 20 bytes per sound, then 4 per entry of the second table.
        const size_t bytes = static_cast<size_t>(x.sounds) * 20 + static_cast<size_t>(x.second) * 4;
        uint64_t sum = 0;
        const bool summed = x.arrays[0] && Checksum(x.arrays[0], bytes, &sum);
        out += std::string(i ? "," : "") + "{\"sounds\":" + std::to_string(x.sounds) +
               ",\"second\":" + std::to_string(x.second) + ",\"bytes\":" + std::to_string(bytes) +
               ",\"at\":" + Hex(reinterpret_cast<uint64_t>(x.arrays[0])) +
               ",\"checksum\":" + (summed ? Hex(sum) : "null") + "}";
        summary += (i ? "; " : " of ") + std::to_string(x.sounds) + " sounds, checksum " +
                   (summed ? HexBare(sum) : std::string("unreadable"));
    }

    out += "],\"paks\":[";
    int open = 0;
    std::string pakLine;
    for (uint16_t i = 0; i < paks; i++)
    {
        uint8_t raw[PakStride];
        if (!Copy(raw, aPlaces.pakTable + i * PakStride, PakStride))
        {
            aError = "Could not read pak entry " + std::to_string(i);
            return {};
        }
        const auto slot = At<uint16_t>(raw, 0);
        const auto reader = At<uint64_t>(raw, 0x18);
        if (slot == 0xFFFF && !reader)
            continue;
        const auto pak = At<uint16_t>(raw, 4);
        const auto refs = At<uint32_t>(raw, 0x10);
        out += std::string(open ? "," : "") + "{\"slot\":" + std::to_string(slot) +
               ",\"index\":" + std::to_string(At<uint16_t>(raw, 2)) + ",\"pak\":" + std::to_string(pak) +
               ",\"flag\":" + std::to_string(At<uint8_t>(raw, 6)) +
               ",\"serial\":" + std::to_string(At<uint32_t>(raw, 8)) +
               ",\"row\":" + std::to_string(At<int32_t>(raw, 0xC)) + ",\"refs\":" + std::to_string(refs) +
               ",\"reader\":" + Hex(reader) + "}";
        pakLine += (open ? ", " : "") + std::to_string(pak) + " (" + std::to_string(refs) + ")";
        open++;
    }
    summary += "; " + std::to_string(open) + " paks open" + (open ? ": " + pakLine : "");

    out += "],\"sounds\":[";
    if (const auto* sounds = aParams.Get("sounds"); sounds && sounds->kind == json::Value::Kind::Array)
    {
        bool first = true;
        for (const auto& item : sounds->items)
        {
            uint32_t id = 0;
            if (!ReadId(item, id))
            {
                aError = "sounds takes ids from 0 to 4294967295";
                return {};
            }
            std::string entry = "{\"id\":" + std::to_string(id) + ",\"found\":false}";
            for (size_t i = 0; i < list.size(); i++)
            {
                const Index& x = list[i];
                int64_t row = -1;
                if (!x.arrays[0] || !FindRow(reinterpret_cast<const uint32_t*>(x.arrays[0]), x.sounds, id, &row) ||
                    row < 0)
                    continue;
                uint16_t pak = 0, header = 0;
                uint32_t x10 = 0, size = 0, offset = 0;
                Copy(&pak, x.arrays[1] + row * 2, 2);
                Copy(&x10, x.arrays[2] + row * 4, 4);
                Copy(&header, x.arrays[3] + row * 2, 2);
                Copy(&size, x.arrays[4] + row * 4, 4);
                Copy(&offset, x.arrays[5] + row * 4, 4);
                entry = "{\"id\":" + std::to_string(id) + ",\"found\":true,\"index\":" + std::to_string(i) +
                        ",\"row\":" + std::to_string(row) + ",\"pak\":" + std::to_string(pak) +
                        ",\"offset\":" + std::to_string(offset) + ",\"size\":" + std::to_string(size) +
                        ",\"headerSize\":" + std::to_string(header) + ",\"x10\":" + std::to_string(x10) + "}";
                summary += "; sound " + std::to_string(id) + " in pak " + std::to_string(pak) + " at " +
                           std::to_string(offset);
                break;
            }
            out += (first ? "" : ",") + entry;
            first = false;
        }
    }
    out += "],\"summary\":" + JsonString(summary) + "}";
    if (aSummary)
        *aSummary = summary;
    return out;
}

bool IsOpusMethod(const std::string& aMethod)
{
    return aMethod == "opus.state";
}

std::string Opus(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    (void)aMethod;
    if (!g_tried)
    {
        g_tried = true;
        const auto* image = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
        const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(image);
        const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(image + dos->e_lfanew);
        const IMAGE_SECTION_HEADER* section = IMAGE_FIRST_SECTION(nt);
        std::vector<CodeRange> code;
        for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, section++)
        {
            if (section->Characteristics & IMAGE_SCN_MEM_EXECUTE)
                code.push_back({image + section->VirtualAddress, image + section->VirtualAddress + section->Misc.VirtualSize});
        }
        const uint64_t started = GetTickCount64();
        g_found = LocateOpus(code, g_places, g_why);
        const auto rel = [&](const void* p) {
            return static_cast<unsigned long long>(static_cast<const uint8_t*>(p) - image);
        };
        if (g_found)
            Log("Opus: found the sound pak tables in %llu ms (index count +0x%llx, index +0x%llx, pak count +0x%llx, "
                "paks +0x%llx, path hash +0x%llx)",
                static_cast<unsigned long long>(GetTickCount64() - started), rel(g_places.indexCount),
                rel(g_places.indexTable), rel(g_places.pakCount), rel(g_places.pakTable), rel(g_places.infoHash));
        else
            Log("Opus: the sound pak tables were not found in this game version: %s", g_why.c_str());
    }
    if (!g_found)
    {
        aError = "REDnode does not know this game version's sound pak tables (" + g_why + ")";
        return {};
    }
    std::string summary;
    std::string result = OpusState(g_places, aParams, aError, &summary);
    if (aError.empty())
        Log("Opus: %s", summary.c_str());
    return result;
}
} // namespace rednode::overlay::detail
