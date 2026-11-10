// Starts the packaged overlay host with the game.
//
// Players get the host as red4ext/plugins/REDnode/host/REDnode-overlay.exe. The
// plugin starts it at load, with the apps folder, the game's process id and a
// log file. The host goes into a job object that ends it when the job handle
// closes: at plugin unload, or when Windows cleans up after a game crash.
//
// Without a packaged host (a developer setup), nothing starts: run the host by
// hand with `npm run overlay`. If both run, the host started first keeps the
// pipe and the other exits.

#include "overlay.hpp"

#include <filesystem>
#include <string>
#include <system_error>

namespace rednode::overlay::detail
{
namespace
{
HANDLE g_job = nullptr;
HANDLE g_process = nullptr;

// The game's environment for the host, without the variables that stop an Electron app
// from starting as one. A game started from VS Code (EDGEdeck's Run game, a terminal, a
// Claude session) inherits ELECTRON_RUN_AS_NODE=1, which makes the host run as plain Node:
// it refuses its own arguments and exits before writing a line of its log.
std::wstring HostEnvironment(int& aDropped)
{
    aDropped = 0;
    std::wstring block;
    LPWCH env = GetEnvironmentStringsW();
    if (!env)
        return block;
    for (const wchar_t* p = env; *p; p += wcslen(p) + 1)
    {
        constexpr const wchar_t* kDrop[] = {L"ELECTRON_RUN_AS_NODE=", L"ELECTRON_NO_ATTACH_CONSOLE="};
        bool drop = false;
        for (const auto* name : kDrop)
            if (_wcsnicmp(p, name, wcslen(name)) == 0)
                drop = true;
        if (drop)
        {
            ++aDropped;
            continue;
        }
        block.append(p);
        block.push_back(L'\0');
    }
    FreeEnvironmentStringsW(env);
    block.push_back(L'\0');
    return block;
}
} // namespace

void StartHost(const std::filesystem::path& aPluginDir)
{
    std::error_code ec;
    const auto hostDir = aPluginDir / L"host";
    const auto exe = hostDir / L"REDnode-overlay.exe";
    if (!std::filesystem::exists(exe, ec))
    {
        Log("Overlay: no packaged host in %s. Start it by hand with npm run overlay.", hostDir.string().c_str());
        return;
    }

    const auto logFile = aPluginDir.parent_path().parent_path() / L"logs" / L"rednode-overlay.log";
    // One log per game session; the last session's is kept beside it, since after a crash the
    // next start would otherwise erase the log that shows it.
    auto previous = logFile;
    previous.replace_filename(L"rednode-overlay.prev.log");
    std::filesystem::remove(previous, ec);
    std::filesystem::rename(logFile, previous, ec);

    std::wstring cmd = L"\"" + exe.wstring() + L"\" --apps-dir=\"" + (aPluginDir / L"apps").wstring() +
                       L"\" --parent-pid=" + std::to_wstring(GetCurrentProcessId()) + L" --log=\"" +
                       logFile.wstring() + L"\"";

    g_job = CreateJobObjectW(nullptr, nullptr);
    if (g_job)
    {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(g_job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    }

    int dropped = 0;
    auto env = HostEnvironment(dropped);
    if (dropped)
        Log("Overlay: the game was started with ELECTRON_RUN_AS_NODE set (from VS Code?); the host starts "
            "without it");

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(exe.c_str(), cmd.data(), nullptr, nullptr, FALSE,
                        CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, env.size() > 1 ? env.data() : nullptr,
                        hostDir.c_str(), &si, &pi))
    {
        Log("Overlay: could not start the host (error %lu)", GetLastError());
        return;
    }
    if (g_job && !AssignProcessToJobObject(g_job, pi.hProcess))
        Log("Overlay: could not put the host in a job object (error %lu). It exits by itself when the game does.",
            GetLastError());
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    g_process = pi.hProcess;
    Log("Overlay: started the host, process %lu", pi.dwProcessId);
}

void StopHost()
{
    // Closing the job ends the host and every Chromium process it started.
    if (g_job)
    {
        CloseHandle(g_job);
        g_job = nullptr;
    }
    if (g_process)
    {
        CloseHandle(g_process);
        g_process = nullptr;
    }
}
} // namespace rednode::overlay::detail
