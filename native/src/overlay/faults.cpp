// Fault watch: what fails while a risky game call runs, such as an archive swap.
//
// A swap of an archive with sound paks ends the game with no crash dialog and no Windows
// error record (docs/world.md, "H1 limit: sound paks crash a swap"), so the game's own
// handler takes the fault and quits. A vectored handler sees each fault first. While a
// watch is on (bridge method faults.watch, from the host before each swap), it writes the
// first faults to red4ext/logs/rednode-faults.log: the code, the module and offset where
// it happened, what an access violation touched, the thread and its name, and the stack.
// If the game then exits through ExitProcess during the watch, DllMain's detach writes
// who called it. With no exit line, the game was ended by TerminateProcess.
//
// The file is written with WriteFile and flushed at once, since the process may be gone a
// moment later. Outside a watch the handler returns at its first check.

#include "jvalue.hpp"
#include "overlay.hpp"

#include <atomic>
#include <cstdio>
#include <cstring>

namespace rednode::overlay::detail
{
namespace
{
constexpr uint32_t MaxPerWatch = 8;
constexpr int MaxFrames = 24;

std::filesystem::path g_path;
PVOID g_handler = nullptr;
HANDLE g_out = INVALID_HANDLE_VALUE;
SRWLOCK g_writeLock = SRWLOCK_INIT;
std::atomic<uint64_t> g_until{0}; // GetTickCount64 at which the watch ends; 0 for none
std::atomic<uint32_t> g_logged{0};
std::atomic<DWORD> g_gameThread{0};
bool g_reported = true; // game thread: the end of the last watch is in the plugin log
char g_label[200] = "";

void Write(const char* aText)
{
    if (g_out == INVALID_HANDLE_VALUE)
        return;
    DWORD written = 0;
    WriteFile(g_out, aText, static_cast<DWORD>(std::strlen(aText)), &written, nullptr);
    FlushFileBuffers(g_out);
}

void Stamp(char* aOut, size_t aSize)
{
    SYSTEMTIME t;
    GetLocalTime(&t);
    std::snprintf(aOut, aSize, "%02u:%02u:%02u.%03u", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
}

// "Cyberpunk2077.exe+0x1a2b3c", or the bare address outside any module.
void Where(DWORD64 aAddress, char* aOut, size_t aSize)
{
    HMODULE module = nullptr;
    if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           reinterpret_cast<LPCWSTR>(aAddress), &module) &&
        module)
    {
        wchar_t path[MAX_PATH];
        const DWORD length = GetModuleFileNameW(module, path, MAX_PATH);
        const wchar_t* name = path;
        for (DWORD i = 0; i < length; i++)
        {
            if (path[i] == L'\\' || path[i] == L'/')
                name = path + i + 1;
        }
        std::snprintf(aOut, aSize, "%ls+0x%llx", name,
                      static_cast<unsigned long long>(aAddress - reinterpret_cast<DWORD64>(module)));
        return;
    }
    std::snprintf(aOut, aSize, "0x%llx", static_cast<unsigned long long>(aAddress));
}

// Walks the faulting thread's stack from its context. Its own function with __try and no
// C++ objects, so a broken stack ends the walk instead of faulting inside the handler.
int Unwind(CONTEXT aContext, DWORD64* aFrames, int aMax)
{
    int count = 0;
    __try
    {
        while (count < aMax && aContext.Rip)
        {
            aFrames[count++] = aContext.Rip;
            DWORD64 imageBase = 0;
            auto* entry = RtlLookupFunctionEntry(aContext.Rip, &imageBase, nullptr);
            if (!entry)
            {
                // A leaf function: the return address is on top of the stack.
                aContext.Rip = *reinterpret_cast<DWORD64*>(aContext.Rsp);
                aContext.Rsp += 8;
                continue;
            }
            PVOID handlerData = nullptr;
            DWORD64 establisher = 0;
            RtlVirtualUnwind(UNW_FLAG_NHANDLER, imageBase, aContext.Rip, entry, &aContext, &handlerData, &establisher,
                             nullptr);
        }
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
    }
    return count;
}

// Appends to a text buffer, cutting it short rather than overflowing.
void Append(char* aText, size_t aSize, const char* aMore)
{
    const size_t used = std::strlen(aText);
    if (used + 1 < aSize)
        std::snprintf(aText + used, aSize - used, "%s", aMore);
}

void AppendStack(char* aText, size_t aSize, const DWORD64* aFrames, int aCount)
{
    Append(aText, aSize, "  stack:");
    for (int i = 0; i < aCount; i++)
    {
        char where[160];
        Where(aFrames[i], where, sizeof(where));
        Append(aText, aSize, i ? " <- " : " ");
        Append(aText, aSize, where);
    }
    Append(aText, aSize, "\r\n");
}

// The thread's name, when the game gave it one (Windows 10 1607 and later).
void ThreadName(char* aOut, size_t aSize)
{
    aOut[0] = 0;
    using GetDescription = HRESULT(WINAPI*)(HANDLE, PWSTR*);
    static const auto get = reinterpret_cast<GetDescription>(
        reinterpret_cast<void*>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "GetThreadDescription")));
    PWSTR name = nullptr;
    if (get && SUCCEEDED(get(GetCurrentThread(), &name)) && name)
    {
        if (name[0])
            std::snprintf(aOut, aSize, " \"%ls\"", name);
        LocalFree(name);
    }
}

const char* CodeName(DWORD aCode)
{
    switch (aCode)
    {
    case EXCEPTION_ACCESS_VIOLATION: return "access violation";
    case EXCEPTION_STACK_OVERFLOW: return "stack overflow";
    case EXCEPTION_ILLEGAL_INSTRUCTION: return "illegal instruction";
    case EXCEPTION_INT_DIVIDE_BY_ZERO: return "integer divide by zero";
    case EXCEPTION_IN_PAGE_ERROR: return "in-page error (a mapped file could not be read)";
    case 0xC0000374: return "heap corruption";
    case 0xC0000409: return "fail fast";
    case EXCEPTION_BREAKPOINT: return "breakpoint (an assert in the game, or a debugger's)";
    default: return "error";
    }
}

LONG CALLBACK OnException(EXCEPTION_POINTERS* aInfo)
{
    if (GetTickCount64() > g_until.load(std::memory_order_relaxed))
        return EXCEPTION_CONTINUE_SEARCH;
    const auto* record = aInfo->ExceptionRecord;
    // Errors and breakpoints (a failed assert) only: not C++ throws (0xE06D7363), debug output
    // or thread names, which are routine.
    if ((record->ExceptionCode & 0xF0000000u) != 0xC0000000u && record->ExceptionCode != EXCEPTION_BREAKPOINT)
        return EXCEPTION_CONTINUE_SEARCH;
    if (g_logged.fetch_add(1) >= MaxPerWatch)
        return EXCEPTION_CONTINUE_SEARCH;

    char stamp[16], at[160], thread[160], touched[96] = "";
    Stamp(stamp, sizeof(stamp));
    Where(reinterpret_cast<DWORD64>(record->ExceptionAddress), at, sizeof(at));
    ThreadName(thread, sizeof(thread));
    if ((record->ExceptionCode == EXCEPTION_ACCESS_VIOLATION || record->ExceptionCode == EXCEPTION_IN_PAGE_ERROR) &&
        record->NumberParameters >= 2)
    {
        const auto kind = record->ExceptionInformation[0];
        std::snprintf(touched, sizeof(touched), ", %s 0x%llx",
                      kind == 0 ? "reading" : kind == 1 ? "writing" : "executing",
                      static_cast<unsigned long long>(record->ExceptionInformation[1]));
    }
    const DWORD self = GetCurrentThreadId();

    char text[4096];
    std::snprintf(text, sizeof(text), "%s fault 0x%08lX (%s%s) at %s, thread %lu%s%s\r\n", stamp,
                  static_cast<unsigned long>(record->ExceptionCode), CodeName(record->ExceptionCode), touched, at,
                  static_cast<unsigned long>(self), thread,
                  self == g_gameThread.load() ? " (the game thread)" : "");
    DWORD64 frames[MaxFrames];
    const int count = Unwind(*aInfo->ContextRecord, frames, MaxFrames);
    AppendStack(text, sizeof(text), frames, count);

    AcquireSRWLockExclusive(&g_writeLock);
    Write(text);
    ReleaseSRWLockExclusive(&g_writeLock);
    return EXCEPTION_CONTINUE_SEARCH; // the game's own handling goes on as before
}

bool OpenFile()
{
    if (g_out != INVALID_HANDLE_VALUE)
        return true;
    g_out = CreateFileW(g_path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
                        FILE_ATTRIBUTE_NORMAL, nullptr);
    return g_out != INVALID_HANDLE_VALUE;
}
} // namespace

void StartFaults(const std::filesystem::path& aPluginDir)
{
    g_path = aPluginDir.parent_path().parent_path() / L"logs" / L"rednode-faults.log";
    if (!g_handler)
        g_handler = AddVectoredExceptionHandler(1, OnException);
}

void StopFaults()
{
    g_until = 0;
    if (g_handler)
    {
        RemoveVectoredExceptionHandler(g_handler);
        g_handler = nullptr;
    }
    if (g_out != INVALID_HANDLE_VALUE)
    {
        CloseHandle(g_out);
        g_out = INVALID_HANDLE_VALUE;
    }
}

bool IsFaultsMethod(const std::string& aMethod)
{
    return aMethod == "faults.watch";
}

// faults.watch {"seconds":15,"label":"swap of X.archive"}: watches from now, on the game thread.
std::string Faults(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    (void)aMethod;
    double seconds = 15;
    if (const auto* s = aParams.Get("seconds"); s && s->kind == json::Value::Kind::Number)
        seconds = s->number;
    if (seconds < 1 || seconds > 120)
    {
        aError = "faults.watch takes 1 to 120 seconds";
        return {};
    }
    std::string label = "a watch";
    if (const auto* l = aParams.Get("label"); l && l->kind == json::Value::Kind::String)
        label = l->text;
    if (!OpenFile())
    {
        aError = "Could not open " + g_path.string();
        return {};
    }
    std::snprintf(g_label, sizeof(g_label), "%s", label.c_str());
    g_gameThread = GetCurrentThreadId();
    g_logged = 0;
    char stamp[16], text[400];
    Stamp(stamp, sizeof(stamp));
    std::snprintf(text, sizeof(text), "%s watch for %.0f s: %s (the game thread is %lu)\r\n", stamp, seconds, g_label,
                  static_cast<unsigned long>(GetCurrentThreadId()));
    AcquireSRWLockExclusive(&g_writeLock);
    Write(text);
    ReleaseSRWLockExclusive(&g_writeLock);
    g_until = GetTickCount64() + static_cast<uint64_t>(seconds * 1000);
    g_reported = false;
    Log("Faults: watching %.0f s (%s); faults go to %s", seconds, g_label, g_path.string().c_str());
    return "{\"watching\":" + std::to_string(static_cast<int>(seconds)) + ",\"file\":" + JsonString(g_path.string()) +
           "}";
}

void UpdateFaults()
{
    if (g_reported || GetTickCount64() <= g_until.load())
        return;
    g_reported = true;
    const uint32_t logged = g_logged.load();
    Log("Faults: watch ended (%s), %u fault%s", g_label, logged, logged == 1 ? "" : "s");
}

void FaultsOnExit()
{
    if (GetTickCount64() > g_until.load())
        return;
    char stamp[16], text[4096];
    Stamp(stamp, sizeof(stamp));
    std::snprintf(text, sizeof(text), "%s the game is exiting (ExitProcess) during the watch, on thread %lu%s\r\n",
                  stamp, static_cast<unsigned long>(GetCurrentThreadId()),
                  GetCurrentThreadId() == g_gameThread.load() ? " (the game thread)" : "");
    void* frames[MaxFrames];
    const USHORT count = RtlCaptureStackBackTrace(0, MaxFrames, frames, nullptr);
    DWORD64 addresses[MaxFrames];
    for (USHORT i = 0; i < count; i++)
        addresses[i] = reinterpret_cast<DWORD64>(frames[i]);
    AppendStack(text, sizeof(text), addresses, count);
    Write(text);
}
} // namespace rednode::overlay::detail
