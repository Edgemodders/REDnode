// REDswap: swaps archives into the running game, a RED4ext plugin shipped beside REDnode
// (docs/world.md, "H3 REDnode's own hot loader"). REDnode's host calls it through RTTI, as
// it called RED Hot Tools; scripts and other plugins can call it too:
//
//   public static native func REDswap_Version() -> String
//   public static native func REDswap_Check() -> String     // empty when it can swap
//   public static native func REDswap_Swap(files: String) -> String
//
// REDswap_Swap takes absolute paths separated by "|" (a character Windows paths never hold)
// and answers JSON: { "done": [{ file, target, how }], "failed": [{ file, why }],
// "resources", "invalidated", "left", "leftInvalidated", "extensions", "ms", "error"? }. It runs on the game thread.

#include "swap.hpp"

#include <RED4ext/RED4ext.hpp>

#include <Windows.h>

#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

namespace
{
RED4ext::v1::PluginHandle g_handle = nullptr;
const RED4ext::v1::Sdk* g_sdk = nullptr;

std::string Json(const std::string& aText)
{
    std::string out = "\"";
    for (const unsigned char c : aText)
    {
        switch (c)
        {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20)
            {
                char buffer[8];
                snprintf(buffer, sizeof(buffer), "\\u%04x", c);
                out += buffer;
            }
            else
            {
                out += static_cast<char>(c);
            }
        }
    }
    return out + "\"";
}

void ReturnString(void* aOut, const std::string& aText)
{
    if (!aOut)
        return;
    RED4ext::CString value(aText.c_str());
    RED4ext::CRTTISystem::Get()->GetType("String")->Assign(aOut, &value);
}

std::filesystem::path FromUtf8(const std::string& aText)
{
    return std::filesystem::path(std::u8string(aText.begin(), aText.end()));
}

void REDswap_Version(RED4ext::IScriptable* aContext, RED4ext::CStackFrame* aFrame, void* aOut, int64_t a4)
{
    RED4EXT_UNUSED_PARAMETER(aContext);
    RED4EXT_UNUSED_PARAMETER(a4);
    aFrame->code++; // skip ParamEnd
    ReturnString(aOut, REDSWAP_VERSION);
}

void REDswap_Check(RED4ext::IScriptable* aContext, RED4ext::CStackFrame* aFrame, void* aOut, int64_t a4)
{
    RED4EXT_UNUSED_PARAMETER(aContext);
    RED4EXT_UNUSED_PARAMETER(a4);
    aFrame->code++; // skip ParamEnd
    ReturnString(aOut, redswap::Check());
}

void REDswap_Swap(RED4ext::IScriptable* aContext, RED4ext::CStackFrame* aFrame, void* aOut, int64_t a4)
{
    RED4EXT_UNUSED_PARAMETER(aContext);
    RED4EXT_UNUSED_PARAMETER(a4);

    RED4ext::CString list;
    RED4ext::GetParameter(aFrame, &list);
    aFrame->code++; // skip ParamEnd

    std::vector<std::filesystem::path> files;
    const std::string text = list.c_str();
    size_t start = 0;
    while (start <= text.size())
    {
        const auto end = text.find('|', start);
        const auto one = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (!one.empty())
            files.push_back(FromUtf8(one));
        if (end == std::string::npos)
            break;
        start = end + 1;
    }

    g_sdk->logger->InfoF(g_handle, "Swap of %zu file(s) asked for", files.size());
    const auto started = std::chrono::steady_clock::now();
    const auto result = redswap::Swap(files);
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();

    std::string json = "{\"done\":[";
    for (size_t i = 0; i < result.done.size(); ++i)
    {
        const auto& d = result.done[i];
        json += (i ? "," : "") + std::string("{\"file\":") + Json(d.file) + ",\"target\":" + Json(d.target) +
                ",\"how\":" + Json(d.how) + "}";
        g_sdk->logger->InfoF(g_handle, "  %s: %s", d.how.c_str(), d.target.c_str());
    }
    json += "],\"failed\":[";
    for (size_t i = 0; i < result.failed.size(); ++i)
    {
        const auto& f = result.failed[i];
        json += (i ? "," : "") + std::string("{\"file\":") + Json(f.file) + ",\"why\":" + Json(f.why) + "}";
        g_sdk->logger->ErrorF(g_handle, "  failed: %s: %s", f.file.c_str(), f.why.c_str());
    }
    json += "],\"resources\":" + std::to_string(result.resources) + ",\"invalidated\":" +
            std::to_string(result.invalidated) + ",\"left\":" + std::to_string(result.left) +
            ",\"leftInvalidated\":" + std::to_string(result.leftInvalidated) + ",\"extensions\":" + (result.extensions ? "true" : "false") +
            ",\"ms\":" + std::to_string(ms);
    if (!result.error.empty())
    {
        json += ",\"error\":" + Json(result.error);
        g_sdk->logger->ErrorF(g_handle, "Swap refused: %s", result.error.c_str());
    }
    json += "}";
    g_sdk->logger->InfoF(g_handle,
                         "Swap done in %lld ms: %zu swapped, %zu failed, %u resources (%u dropped), %u left by the old "
                         "archive (%u dropped)",
                         ms, result.done.size(), result.failed.size(), result.resources, result.invalidated, result.left,
                         result.leftInvalidated);
    ReturnString(aOut, json);
}

void PostRegisterTypes()
{
    auto rtti = RED4ext::CRTTISystem::Get();
    const RED4ext::CBaseFunction::Flags flags = {.isNative = true, .isStatic = true};

    auto version = RED4ext::CGlobalFunction::Create("REDswap_Version", "REDswap_Version", &REDswap_Version);
    version->flags = flags;
    version->SetReturnType("String");
    rtti->RegisterFunction(version);

    auto check = RED4ext::CGlobalFunction::Create("REDswap_Check", "REDswap_Check", &REDswap_Check);
    check->flags = flags;
    check->SetReturnType("String");
    rtti->RegisterFunction(check);

    auto swap = RED4ext::CGlobalFunction::Create("REDswap_Swap", "REDswap_Swap", &REDswap_Swap);
    swap->flags = flags;
    swap->AddParam("String", "files");
    swap->SetReturnType("String");
    rtti->RegisterFunction(swap);
}

bool OnRunningEnter(RED4ext::CGameApplication* aApp)
{
    RED4EXT_UNUSED_PARAMETER(aApp);
    const auto why = redswap::Check();
    if (why.empty())
        g_sdk->logger->Info(g_handle, "Ready: the game's archive loader and file cache were found");
    else
        g_sdk->logger->ErrorF(g_handle, "Cannot swap in this game: %s", why.c_str());
    return true;
}
} // namespace

RED4EXT_C_EXPORT bool RED4EXT_CALL Main(RED4ext::v1::PluginHandle aHandle, RED4ext::v1::EMainReason aReason,
                                        const RED4ext::v1::Sdk* aSdk)
{
    if (aReason == RED4ext::v1::EMainReason::Load)
    {
        g_handle = aHandle;
        g_sdk = aSdk;
        redswap::SetLogger(aHandle, aSdk);
        aSdk->logger->Info(aHandle, "REDswap " REDSWAP_VERSION " loading");
        RED4ext::CRTTISystem::Get()->AddPostRegisterCallback(PostRegisterTypes);
        static RED4ext::v1::GameState running{OnRunningEnter, nullptr, nullptr};
        aSdk->gameStates->Add(aHandle, RED4ext::EGameStateType::Running, &running);
    }
    return true;
}

RED4EXT_C_EXPORT void RED4EXT_CALL Query(RED4ext::v1::PluginInfo* aInfo)
{
    aInfo->name = L"REDswap";
    aInfo->author = L"Edgemodders";
    aInfo->version = RED4EXT_V1_SEMVER(REDSWAP_VERSION_MAJOR, REDSWAP_VERSION_MINOR, REDSWAP_VERSION_PATCH);
    aInfo->runtime = RED4EXT_V1_RUNTIME_VERSION_LATEST;
    aInfo->sdk = RED4EXT_V1_SDK_VERSION_CURRENT;
}

RED4EXT_C_EXPORT uint32_t RED4EXT_CALL Supports()
{
    return RED4EXT_API_VERSION_1;
}
