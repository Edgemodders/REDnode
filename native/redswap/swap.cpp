// REDswap's archive swap.
//
// Ported from RED Hot Tools' ArchiveLoader (MIT, Copyright (c) 2022 Pavel Siberx; its license
// is in LICENSE-RedHotTools.txt beside this file), for game 2.5, which RED Hot Tools does not
// support yet. The steps are the same: close the system handles of the archives being
// replaced, put the new files in place, open the handles again, load the archives with the
// game's own loader into a group of their own, merge them into the mod group, and drop the
// resources they hold from the resource loader, so the next request reads the new files.
//
// What REDswap adds: it looks every game function up itself and refuses a swap when one is
// missing (RED4ext's own lookup closes the game), checks the loader's first bytes and the
// file cache's layout before touching anything, finds a replaced archive by its exact path
// (RED Hot Tools' binary search can miss one, docs/hot-swap-research.md, HP0), copies the
// files instead of moving them, and does not keep live ink widget resources (RED Hot Tools
// fills them with the new data on the next frame; REDswap drops them like the rest).
//
// The 2.5 addresses were found by static reading of the game (docs/world.md, "H3").

#include "swap.hpp"

#include <RED4ext/ResourceDepot.hpp>
#include <RED4ext/ResourceLoader.hpp>
#include <RED4ext/Scripting/Natives/CResource.hpp>
#include <RED4ext/Scripting/Utils.hpp>

#include <Windows.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <mutex>
#include <system_error>

namespace redswap
{
namespace
{
RED4ext::v1::PluginHandle g_handle = nullptr;
const RED4ext::v1::Sdk* g_sdk = nullptr;
std::mutex g_swapLock;

template<typename... Args>
void Log(const char* aFormat, Args... aArgs)
{
    if (g_sdk)
        g_sdk->logger->InfoF(g_handle, aFormat, aArgs...);
}

template<typename... Args>
void LogError(const char* aFormat, Args... aArgs)
{
    if (g_sdk)
        g_sdk->logger->ErrorF(g_handle, aFormat, aArgs...);
}

// Address-list hashes (RED4ext's cyberpunk2077_addresses.json for game 2.5).
constexpr uint32_t LoadArchivesHash = 3573367139;          // 2.31: 2517385486 (RED Hot Tools' ResourceDepot_LoadArchives)
constexpr uint32_t AsyncFileApiInstanceHash = 2124810438;  // RED Hot Tools' AsyncFileAPI_Instance
constexpr uint32_t OpenSystemHandleHash = 582815077;       // RED Hot Tools' AsyncFileAPI_OpenSystemHandle
constexpr uint32_t ForgetResourceHash = 2288918343;        // RED Hot Tools' ResourceBank_ForgetResource
constexpr uint32_t ResourceDepotHash = 0x659A0FC7;         // RED4ext.SDK's ResourceDepot
constexpr uint32_t ResourceLoaderHash = 0x783C1034;        // RED4ext.SDK's ResourceLoader

// The loader's first bytes on 2.5 (+0x22d7bd0): mov rax,rsp; mov [rax+20h],r9; mov [rax+8],rcx.
constexpr uint8_t LoadArchivesStart[] = {0x48, 0x8B, 0xC4, 0x4C, 0x89, 0x48, 0x20, 0x48, 0x89, 0x48, 0x08};

// The game's archive loader. The game passes 0 or 1 ("load the whole archive into memory")
// and 2; 2.5 returns a flag. Same arguments on 2.31.
using LoadArchives_t = bool (*)(void* aDepot, RED4ext::ArchiveGroup& aGroup,
                                const RED4ext::DynArray<RED4ext::CString>& aArchivePaths,
                                RED4ext::DynArray<RED4ext::ResourcePath>& aLoadedResourcePaths, int32_t aMemoryResident,
                                uint8_t aMode);
using OpenSystemHandle_t = bool (*)(HANDLE* aHandle, const char* aPath, uint8_t aFlags);
using ForgetResource_t = uintptr_t (*)(uintptr_t aBank, RED4ext::Handle<RED4ext::CResource>& aResource,
                                       RED4ext::ResourcePath aPath);

// The game's async file handle cache (layout from RED Hot Tools; the paths table at +0x100058
// with 512-byte entries is checked against 2.5's code).
constexpr uint32_t MaxFiles = 65536;
constexpr size_t MaxPathLength = 512;
constexpr size_t FilesOffset = 0x58;
constexpr size_t PathsOffset = 0x100058;
constexpr size_t CacheOffsetInApi = 0xF0;

struct FileState
{
    HANDLE* handle;
    int32_t refCount;
    uint8_t flags;
};
static_assert(sizeof(FileState) == 0x10);

struct Functions
{
    LoadArchives_t loadArchives = nullptr;
    uint8_t* asyncFileApi = nullptr;
    OpenSystemHandle_t openSystemHandle = nullptr;
    ForgetResource_t forgetResource = nullptr;
    std::string missing; // why not, when something is missing
};

uintptr_t ResolveQuiet(uint32_t aHash)
{
    using Resolve_t = uintptr_t (*)(uint32_t);
    static const auto resolve = []() -> Resolve_t {
        const auto red4ext = GetModuleHandleW(L"RED4ext.dll");
        return red4ext ? reinterpret_cast<Resolve_t>(GetProcAddress(red4ext, "RED4ext_ResolveAddress")) : nullptr;
    }();
    return resolve ? resolve(aHash) : 0;
}

const Functions& Find()
{
    static const Functions found = []() {
        Functions f;
        const struct
        {
            uint32_t hash;
            const char* name;
        } needed[] = {{LoadArchivesHash, "the archive loader"},
                      {AsyncFileApiInstanceHash, "the async file API"},
                      {OpenSystemHandleHash, "the file opener"},
                      {ForgetResourceHash, "the resource bank"},
                      {ResourceDepotHash, "the resource depot"},
                      {ResourceLoaderHash, "the resource loader"}};
        for (const auto& n : needed)
        {
            if (!ResolveQuiet(n.hash))
            {
                f.missing = std::string(n.name) + " (address " + std::to_string(n.hash) +
                            ") is not in RED4ext's address list for this game version";
                return f;
            }
        }
        const auto load = ResolveQuiet(LoadArchivesHash);
        if (std::memcmp(reinterpret_cast<const void*>(load), LoadArchivesStart, sizeof(LoadArchivesStart)) != 0)
        {
            f.missing = "the archive loader does not start as REDswap expects on this game version";
            return f;
        }
        f.loadArchives = reinterpret_cast<LoadArchives_t>(load);
        f.asyncFileApi = reinterpret_cast<uint8_t*>(ResolveQuiet(AsyncFileApiInstanceHash));
        f.openSystemHandle = reinterpret_cast<OpenSystemHandle_t>(ResolveQuiet(OpenSystemHandleHash));
        f.forgetResource = reinterpret_cast<ForgetResource_t>(ResolveQuiet(ForgetResourceHash));
        return f;
    }();
    return found;
}

uint8_t* FileCache()
{
    const auto& f = Find();
    return f.asyncFileApi ? *reinterpret_cast<uint8_t**>(f.asyncFileApi + CacheOffsetInApi) : nullptr;
}

FileState& FileAt(uint8_t* aCache, uint32_t aHandle)
{
    return reinterpret_cast<FileState*>(aCache + FilesOffset)[aHandle];
}

const char* PathAt(uint8_t* aCache, uint32_t aHandle)
{
    return reinterpret_cast<const char*>(aCache + PathsOffset + static_cast<size_t>(aHandle) * MaxPathLength);
}

bool CloseSystemHandle(uint8_t* aCache, uint32_t aHandle)
{
    auto& file = FileAt(aCache, aHandle);
    if (!file.handle || *file.handle == INVALID_HANDLE_VALUE || !PathAt(aCache, aHandle)[0])
        return false;
    const auto closed = CloseHandle(*file.handle);
    *file.handle = INVALID_HANDLE_VALUE;
    return closed != FALSE;
}

bool ReopenSystemHandle(uint8_t* aCache, uint32_t aHandle)
{
    auto& file = FileAt(aCache, aHandle);
    if (!file.handle || *file.handle != INVALID_HANDLE_VALUE || !PathAt(aCache, aHandle)[0])
        return false;
    const auto flags =
        static_cast<uint8_t>((0xF * (file.flags & 0x4)) | (((file.flags & 0x8) == 0) ? 0x21 : 0xA1));
    return Find().openSystemHandle(file.handle, PathAt(aCache, aHandle), flags);
}

bool SameText(const char* aA, const char* aB)
{
    return _stricmp(aA, aB) == 0;
}

std::string Lower(std::string aText)
{
    std::transform(aText.begin(), aText.end(), aText.begin(), [](unsigned char c) { return static_cast<char>(tolower(c)); });
    return aText;
}

std::string NameOf(const char* aPath)
{
    const std::string p = aPath;
    const auto slash = p.find_last_of("\\/");
    return slash == std::string::npos ? p : p.substr(slash + 1);
}

std::string Utf8(const std::filesystem::path& aPath)
{
    const auto u8 = aPath.u8string();
    return std::string(u8.begin(), u8.end());
}

// Where an archive goes among the game's archives: its index, or the place to insert it in
// strcmp order (RED Hot Tools' order); exact path first (HP0).
uint32_t PositionOf(RED4ext::DynArray<RED4ext::Archive>& aArchives, const char* aPath, bool& aFound)
{
    for (uint32_t i = 0; i < aArchives.size(); ++i)
    {
        if (std::strcmp(aArchives[i].path.c_str(), aPath) == 0)
        {
            aFound = true;
            return i;
        }
    }
    aFound = false;
    uint32_t i = 0;
    while (i < aArchives.size() && std::strcmp(aArchives[i].path.c_str(), aPath) < 0)
        ++i;
    return i;
}

struct Planned
{
    std::filesystem::path source;
    std::string given;
    std::filesystem::path target;
    std::filesystem::path part;           // the copy waiting to replace the target
    RED4ext::ArchiveGroup* group = nullptr; // the mod group it belongs to
    int64_t existing = -1;                  // its index in the group, when already loaded
    bool archive = false;
    bool same = false; // the source is the installed file: reloaded as it is
    bool closed = false;
    bool placed = false;
};

void ReloadArchiveXL(SwapResult& aResult)
{
    auto rtti = RED4ext::CRTTISystem::Get();
    auto cls = rtti ? rtti->GetClass("ArchiveXL") : nullptr;
    auto fn = cls ? cls->GetFunction("Reload") : nullptr;
    if (!fn)
        return;
    aResult.extensions = RED4ext::ExecuteFunction(static_cast<void*>(nullptr), fn, nullptr);
    Log("ArchiveXL.Reload %s", aResult.extensions ? "ran" : "failed");
}
} // namespace

void SetLogger(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk)
{
    g_handle = aHandle;
    g_sdk = aSdk;
}

std::string Check()
{
    const auto& f = Find();
    if (!f.missing.empty())
        return f.missing;
    if (!FileCache())
        return "the game's file cache is not ready";
    if (!RED4ext::ResourceDepot::Get())
        return "the game's resource depot is not ready";
    return {};
}

SwapResult Swap(const std::vector<std::filesystem::path>& aFiles)
{
    std::scoped_lock lock(g_swapLock);
    SwapResult result;

    if (const auto why = Check(); !why.empty())
    {
        result.error = why;
        return result;
    }

    auto* depot = RED4ext::ResourceDepot::Get();
    std::vector<RED4ext::ArchiveGroup*> groups;
    for (auto& group : depot->groups)
    {
        if (group.scope == RED4ext::ArchiveScope::Mod)
            groups.push_back(&group);
    }
    if (groups.empty())
    {
        result.error = "the game has no mod archive group (archive/pc/mod)";
        return result;
    }
    const std::filesystem::path defaultDir = groups[0]->basePath.c_str();
    auto* cache = FileCache();

    // 1. Where each file goes.
    std::vector<Planned> plan;
    for (const auto& source : aFiles)
    {
        Planned p;
        p.source = source;
        p.given = Utf8(source);
        const auto ext = Lower(Utf8(source.extension()));
        const auto name = Utf8(source.filename());
        std::error_code ec;
        if (!std::filesystem::is_regular_file(source, ec))
        {
            result.failed.push_back({p.given, "not found"});
            continue;
        }
        if (ext == ".archive")
        {
            p.archive = true;
            for (auto* group : groups)
            {
                for (uint32_t i = 0; i < group->archives.size() && p.existing < 0; ++i)
                {
                    if (SameText(NameOf(group->archives[i].path.c_str()).c_str(), name.c_str()))
                    {
                        p.group = group;
                        p.existing = i;
                        p.target = group->archives[i].path.c_str();
                    }
                }
                if (p.existing >= 0)
                    break;
            }
            if (p.existing < 0)
            {
                p.group = groups[0];
                p.target = defaultDir / source.filename();
            }
        }
        else if (ext == ".xl" || ext == ".yaml" || ext == ".yml")
        {
            p.target = defaultDir / source.filename();
            for (auto* group : groups)
            {
                const auto there = std::filesystem::path(group->basePath.c_str()) / source.filename();
                if (std::filesystem::exists(there, ec))
                {
                    p.target = there;
                    break;
                }
            }
        }
        else
        {
            result.failed.push_back({p.given, "REDswap swaps .archive, .xl and .yaml files"});
            continue;
        }
        p.same = std::filesystem::exists(p.target, ec) && std::filesystem::equivalent(p.source, p.target, ec);
        plan.push_back(std::move(p));
    }

    // 2. The file cache must hold each replaced archive under its path, or its layout is not
    //    what REDswap knows: then nothing is touched.
    for (const auto& p : plan)
    {
        if (p.existing < 0)
            continue;
        const auto handle = p.group->archives[static_cast<uint32_t>(p.existing)].asyncHandle;
        if (handle < 0 || static_cast<uint32_t>(handle) >= MaxFiles ||
            !SameText(PathAt(cache, static_cast<uint32_t>(handle)), p.target.string().c_str()))
        {
            LogError("The file cache does not hold %s at handle %d; nothing swapped", p.target.string().c_str(), handle);
            result.error = "the game's file cache does not look as REDswap expects on this game version; nothing was swapped";
            return result;
        }
    }

    // 3. Copies next to their targets first, so the archives are closed only for the rename.
    for (auto& p : plan)
    {
        if (p.same)
            continue;
        std::error_code ec;
        std::filesystem::create_directories(p.target.parent_path(), ec);
        p.part = p.target;
        p.part += L".redswap-part";
        if (!std::filesystem::copy_file(p.source, p.part, std::filesystem::copy_options::overwrite_existing, ec))
        {
            result.failed.push_back({p.given, "could not copy it into the game folder: " + ec.message()});
            p.part.clear();
        }
    }

    // 4. Close, place, open again.
    for (auto& p : plan)
    {
        if (p.existing >= 0 && (p.same || !p.part.empty()))
        {
            const auto handle = static_cast<uint32_t>(p.group->archives[static_cast<uint32_t>(p.existing)].asyncHandle);
            p.closed = CloseSystemHandle(cache, handle);
        }
    }
    for (auto& p : plan)
    {
        if (p.same)
        {
            p.placed = true;
            continue;
        }
        if (p.part.empty())
            continue;
        if (MoveFileExW(p.part.c_str(), p.target.c_str(), MOVEFILE_REPLACE_EXISTING))
        {
            p.placed = true;
        }
        else
        {
            const auto error = GetLastError();
            std::error_code ec;
            std::filesystem::remove(p.part, ec);
            result.failed.push_back({p.given, "could not replace " + Utf8(p.target) + " (Windows error " +
                                                  std::to_string(error) + ")"});
        }
    }
    for (auto& p : plan)
    {
        if (p.closed)
        {
            const auto handle = static_cast<uint32_t>(p.group->archives[static_cast<uint32_t>(p.existing)].asyncHandle);
            if (!ReopenSystemHandle(cache, handle))
                LogError("Could not open %s again", p.target.string().c_str());
        }
    }

    // 5. Load the placed archives into a group of their own, then merge it into the mod group.
    RED4ext::DynArray<RED4ext::CString> paths;
    for (const auto& p : plan)
    {
        if (p.archive && p.placed)
            paths.EmplaceBack(p.target.string().c_str());
    }
    RED4ext::DynArray<RED4ext::ResourcePath> loaded;
    if (paths.size())
    {
        RED4ext::ArchiveGroup hotGroup{};
        const auto flag = Find().loadArchives(nullptr, hotGroup, paths, loaded, 0, 2);
        Log("Loaded %u archive(s) holding %u resource(s) (loader answered %d)", static_cast<uint32_t>(hotGroup.archives.size()), static_cast<uint32_t>(loaded.size()),
            flag ? 1 : 0);
        result.resources = static_cast<uint32_t>(loaded.size());

        for (auto& p : plan)
        {
            if (!p.archive || !p.placed)
                continue;
            const auto target = p.target.string();
            bool inHot = false;
            for (auto& archive : hotGroup.archives)
            {
                if (!SameText(archive.path.c_str(), target.c_str()))
                    continue;
                inHot = true;
                bool found = false;
                const auto at = PositionOf(p.group->archives, archive.path.c_str(), found);
                if (found)
                    p.group->archives[at] = archive;
                else
                    p.group->archives.Emplace(p.group->archives.Begin() + at, archive);
                break;
            }
            if (inHot)
                result.done.push_back({p.given, target, p.same ? "reloaded" : (p.existing >= 0 ? "replaced" : "added")});
            else
                result.failed.push_back({p.given, "the game did not load it (see red4ext/logs)"});
        }
    }
    for (const auto& p : plan)
    {
        if (!p.archive && p.placed)
            result.done.push_back({p.given, Utf8(p.target), "config"});
    }

    // 6. Drop what the swapped archives hold from the resource loader, so the next request
    //    reads the new files.
    if (loaded.size())
    {
        auto* loader = RED4ext::ResourceLoader::Get();
        std::unique_lock tokens(loader->tokenLock);
        for (const auto& path : loaded)
        {
            auto* token = loader->tokens.Get(path);
            if (token && token->instance)
            {
                // As RED Hot Tools does: the weak reference is let go of without touching the
                // token's counts, which the game still owns.
                token->refCount = nullptr;
                token->instance = nullptr;
                loader->tokens.Remove(path);
                ++result.invalidated;
            }
            RED4ext::Handle<RED4ext::CResource> resource;
            Find().forgetResource(loader->unk48, resource, path);
        }
    }

    if (!result.done.empty())
        ReloadArchiveXL(result);

    return result;
}
} // namespace redswap
