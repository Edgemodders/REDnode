// The game's on-screen text table, changed while it runs (EDGEhack's H4 live-names spike, 2026-11-11):
// a name a modder writes is a key in the mod's onscreens file, which reaches the game only with its
// archive, so Try Live could not show it. The game loads the table through one function,
// Localization_LoadOnScreens (address hash 3550098299, the one Codeware hooks to merge its providers'
// texts, also through RED4ext, so the two chain). REDnode keeps the table it returns, and:
//
//   loc.table   {}                  -> { caught, entries, loads }       what was caught, for the spike
//   loc.put     { key, text }       -> { changed, added }
//       key "LocKey#27962" (a number) or a secondary key "EDGEhack-mod-Name": the entries with that key
//       get the text; a secondary key not in the table is added twice, under its FNV-1a 32 and 64
//       numbers, as Codeware adds its providers' entries.
//
// Unverified, for the spike: whether the game reads the table again for each name (so a change shows),
// or keeps what it read at load.
#include "jvalue.hpp"
#include "overlay.hpp"

#include <RED4ext/Hashing/FNV1a.hpp>
#include <RED4ext/Scripting/Natives/Generated/localization/PersistenceOnScreenEntries.hpp>

#include <cstdlib>
#include <mutex>
#include <string>

namespace rednode::overlay::detail
{
namespace
{
using Table = RED4ext::localization::PersistenceOnScreenEntries;
using LoadTexts_t = uint64_t (*)(RED4ext::Handle<Table>& aOut, RED4ext::ResourcePath aPath);

constexpr uint32_t LoadOnScreensHash = 3550098299;

LoadTexts_t g_original = nullptr;
bool g_attached = false;
std::mutex g_mutex;
RED4ext::Handle<Table> g_table;
uint64_t g_path = 0;
int g_loads = 0;

uint64_t LoadTextsDetour(RED4ext::Handle<Table>& aOut, RED4ext::ResourcePath aPath)
{
    const uint64_t r = g_original(aOut, aPath);
    if (aOut)
    {
        std::scoped_lock lock(g_mutex);
        g_table = aOut;
        g_path = aPath.hash;
        ++g_loads;
        Log("Text table: loaded %u entries (load %d)", aOut->entries.Size(), g_loads);
    }
    return r;
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
} // namespace

void AttachTextTableHook()
{
    const auto at = Resolve(LoadOnScreensHash);
    if (!at)
    {
        Log("Text table: the game's text load is not in RED4ext's address list; live texts are off");
        return;
    }
    g_attached = GetSdk()->hooking->Attach(GetHandle(), reinterpret_cast<void*>(at), reinterpret_cast<void*>(&LoadTextsDetour),
                                           reinterpret_cast<void**>(&g_original));
    Log("Text table: hook %s", g_attached ? "attached" : "NOT attached");
}

bool IsLocTableMethod(const std::string& aMethod)
{
    return aMethod == "loc.table" || aMethod == "loc.put";
}

std::string LocTable(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    std::scoped_lock lock(g_mutex);
    if (aMethod == "loc.table")
    {
        return std::string("{\"attached\":") + (g_attached ? "true" : "false") + ",\"caught\":" + (g_table ? "true" : "false") +
               ",\"entries\":" + std::to_string(g_table ? g_table->entries.Size() : 0) + ",\"loads\":" + std::to_string(g_loads) + "}";
    }
    if (!g_table)
    {
        aError = "the game's text table was not caught (is REDnode's hook attached?)";
        return {};
    }
    const json::Value* key = aParams.Get("key");
    const json::Value* text = aParams.Get("text");
    if (!key || key->kind != json::Value::Kind::String || key->text.empty() || !text || text->kind != json::Value::Kind::String)
    {
        aError = "loc.put takes { key, text }: a key such as \"LocKey#27962\" or \"EDGEhack-mod-Name\", and the text";
        return {};
    }
    std::string k = key->text;
    if (k.rfind("LocKey#", 0) == 0)
        k = k.substr(7);
    const bool number = !k.empty() && k.find_first_not_of("0123456789") == std::string::npos && k.size() <= 20;
    const uint64_t primary = number ? std::strtoull(k.c_str(), nullptr, 10) : 0;
    const uint64_t k32 = number ? 0 : RED4ext::FNV1a32(k.c_str());
    const uint64_t k64 = number ? 0 : RED4ext::FNV1a64(k.c_str());
    int changed = 0;
    for (auto& e : g_table->entries)
    {
        const bool hit = number ? e.primaryKey == primary : (e.primaryKey == k32 || e.primaryKey == k64 || k == e.secondaryKey.c_str());
        if (!hit)
            continue;
        e.femaleVariant = RED4ext::CString(text->text.c_str());
        e.maleVariant = RED4ext::CString(text->text.c_str());
        ++changed;
    }
    int added = 0;
    if (!changed && !number)
    {
        for (const uint64_t p : {k32, k64})
        {
            RED4ext::localization::PersistenceOnScreenEntry e{};
            e.primaryKey = p;
            e.secondaryKey = RED4ext::CString(k.c_str());
            e.femaleVariant = RED4ext::CString(text->text.c_str());
            e.maleVariant = RED4ext::CString(text->text.c_str());
            g_table->entries.PushBack(e);
            ++added;
        }
    }
    Log("Text table: put %s (%d changed, %d added)", key->text.c_str(), changed, added);
    return "{\"changed\":" + std::to_string(changed) + ",\"added\":" + std::to_string(added) + "}";
}
} // namespace rednode::overlay::detail
