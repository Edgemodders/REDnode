// Tests for the fault watch (src/overlay/faults.cpp): it runs inside the game while a swap
// may fail, so it must log real faults, skip routine ones, stop at its limit and never
// fault itself. Runs without the game: the plugin functions faults.cpp calls are stubbed here.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/jvalue.hpp"
#include "../src/overlay/overlay.hpp"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
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
// No RED4ext here: the exit hooks are not attached, and FaultsOnEnd is called directly.
const RED4ext::v1::Sdk* GetSdk()
{
    return nullptr;
}
RED4ext::v1::PluginHandle GetHandle()
{
    return nullptr;
}
} // namespace detail
} // namespace rednode::overlay

using namespace rednode::overlay::detail;

namespace
{
int g_failures = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failures;
}

// A real access violation, caught here after the watch has seen it.
__declspec(noinline) void Fault()
{
    __try
    {
        *reinterpret_cast<volatile int*>(0x10) = 1;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
    }
}

std::string Watch(const char* aParams)
{
    json::Value params;
    std::string error;
    json::Parse(aParams, params, error);
    const std::string result = Faults("faults.watch", params, error);
    return error.empty() ? result : "error: " + error;
}

std::string ReadAll(const std::filesystem::path& aFile)
{
    std::ifstream in(aFile, std::ios::binary);
    std::stringstream text;
    text << in.rdbuf();
    return text.str();
}

size_t Count(const std::string& aText, const std::string& aPart)
{
    size_t count = 0;
    for (size_t at = aText.find(aPart); at != std::string::npos; at = aText.find(aPart, at + 1))
        ++count;
    return count;
}
} // namespace

int main()
{
    const auto root = std::filesystem::temp_directory_path() / "rednode-faults-test";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root / "red4ext" / "plugins" / "REDnode");
    std::filesystem::create_directories(root / "red4ext" / "logs");
    const auto file = root / "red4ext" / "logs" / "rednode-faults.log";

    StartFaults(root / "red4ext" / "plugins" / "REDnode");

    Fault();
    Check(!std::filesystem::exists(file), "no watch: a fault writes nothing");

    Check(Watch("{\"seconds\":0}").rfind("error:", 0) == 0, "0 seconds is refused");
    Check(Watch("{\"seconds\":500}").rfind("error:", 0) == 0, "500 seconds is refused");
    const auto reply = Watch("{\"seconds\":5,\"label\":\"swap of Test.archive\"}");
    Check(reply.find("\"watching\":5") != std::string::npos, "a watch of 5 s starts");

    Fault();
    auto text = ReadAll(file);
    Check(text.find("watch for 5 s: swap of Test.archive") != std::string::npos, "the watch is written with its label");
    Check(text.find("fault 0xC0000005 (access violation, writing 0x10)") != std::string::npos,
          "an access violation is written with what it touched");
    Check(text.find("at REDnode_faults_tests.exe+0x") != std::string::npos, "the fault's module and offset");
    Check(text.find("(the game thread)") != std::string::npos, "the watching thread is named as the game thread");
    Check(Count(text, "stack: ") == 1 && Count(text, " <- ") >= 2, "the stack is walked from the fault");

    try
    {
        throw 1;
    }
    catch (int)
    {
    }
    Check(Count(ReadAll(file), "fault 0x") == 1, "a C++ throw is routine and not written");

    for (int i = 0; i < 12; i++)
        Fault();
    Check(Count(ReadAll(file), "fault 0x") == 8, "a watch writes at most 8 faults");

    Watch("{\"seconds\":5,\"label\":\"second\"}");
    Fault();
    Check(Count(ReadAll(file), "fault 0x") == 9, "a new watch writes again");

    FaultsOnEnd("TerminateProcess", 0xC0000409);
    text = ReadAll(file);
    Check(text.find("the game is being ended by TerminateProcess, status 0xC0000409") != std::string::npos,
          "an end during the watch is written with its status");
    Check(Count(text, "being ended by") == 1 && Count(text, "stack: ") == 10, "the end is written with a stack");
    for (int i = 0; i < 6; i++)
        FaultsOnEnd("TerminateProcess", 1);
    Check(Count(ReadAll(file), "being ended by") == 4, "a watch writes at most 4 ends");

    StopFaults();
    Fault();
    FaultsOnEnd("TerminateProcess", 1);
    Check(Count(ReadAll(file), "fault 0x") == 9 && Count(ReadAll(file), "being ended by") == 4,
          "after stop, nothing more is written");

    std::filesystem::remove_all(root);
    std::printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "PASSED", g_failures);
    return g_failures ? 1 : 0;
}
