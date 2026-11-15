// The controller (REDnode 0.65.0, for VATS's trigger test): read once a frame on the game thread
// while the game is in front, and each change sent to Node mods as a "gamepad" game event
// (gamepad.hpp says when and how). Only reads: the game still gets every button and trigger.
//
// Two sources:
//
// | Pad | How | Where |
// |---|---|---|
// | Xbox and other XInput pads | XInputGetState (xinput1_4.dll, loaded at run time) | The game thread, the slot in use each frame, empty slots every 120 frames (an empty slot is slow to ask) |
// | Sony: DualSense, DualSense Edge, DualShock 4 (0.65.1) | Their HID input reports, opened shared and read only | A thread of its own: looks for a pad every 2 s, then reads its reports with a timeout |
//
// A Sony pad wins when both are there.

#include "gamepad.hpp"
#include "overlay.hpp"

#include <Windows.h>
#include <hidsdi.h>
#include <setupapi.h>

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "hid.lib")
#pragma comment(lib, "setupapi.lib")

namespace rednode::overlay::detail
{
namespace
{
struct XState
{
    DWORD packet;
    WORD buttons;
    BYTE lt;
    BYTE rt;
    SHORT lx, ly, rx, ry;
};
using GetStateFn = DWORD(WINAPI*)(DWORD, XState*);

GetStateFn g_getState = nullptr;
bool g_loaded = false;
int g_slot = -1; // the XInput controller in use, or -1
gamepad::State g_sent;
std::atomic<bool> g_front{true};
constexpr uint64_t LookFrames = 120;

// ---------- Sony pads ----------

std::thread g_hidThread;
std::atomic<bool> g_hidStop{false};
std::mutex g_hidLock;
gamepad::State g_hidState; // under g_hidLock: the Sony pad now, connected false when none

struct OpenPad
{
    HANDLE handle = INVALID_HANDLE_VALUE;
    gamepad::SonyPad kind = gamepad::SonyPad::None;
    USHORT reportLength = 0;
    std::string what;
};

const char* KindName(gamepad::SonyPad aKind)
{
    return aKind == gamepad::SonyPad::DualSense ? "DualSense" : "DualShock 4";
}

// The first Sony pad Windows lists that opens; the reasons the others did not.
OpenPad FindSonyPad(bool aLogMisses)
{
    OpenPad found;
    GUID hid{};
    HidD_GetHidGuid(&hid);
    HDEVINFO set = SetupDiGetClassDevsW(&hid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
    if (set == INVALID_HANDLE_VALUE)
        return found;
    SP_DEVICE_INTERFACE_DATA iface{sizeof(iface)};
    for (DWORD i = 0; SetupDiEnumDeviceInterfaces(set, nullptr, &hid, i, &iface); ++i)
    {
        DWORD size = 0;
        SetupDiGetDeviceInterfaceDetailW(set, &iface, nullptr, 0, &size, nullptr);
        if (!size)
            continue;
        std::vector<uint8_t> buf(size);
        auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(buf.data());
        detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
        if (!SetupDiGetDeviceInterfaceDetailW(set, &iface, detail, size, nullptr, nullptr))
            continue;
        // No access at first: enough to read the ids of any HID device, even one in use.
        HANDLE probe = CreateFileW(detail->DevicePath, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
        if (probe == INVALID_HANDLE_VALUE)
            continue;
        HIDD_ATTRIBUTES attr{sizeof(attr)};
        const bool ok = HidD_GetAttributes(probe, &attr);
        CloseHandle(probe);
        const gamepad::SonyPad kind = ok ? gamepad::SonyPadOf(attr.VendorID, attr.ProductID) : gamepad::SonyPad::None;
        if (kind == gamepad::SonyPad::None)
            continue;
        HANDLE h = CreateFileW(detail->DevicePath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                               FILE_FLAG_OVERLAPPED, nullptr);
        if (h == INVALID_HANDLE_VALUE)
        {
            if (aLogMisses)
                Log("Gamepad: found a %s (product %04X) but cannot read it (error %lu): another program may hold it alone",
                    KindName(kind), attr.ProductID, GetLastError());
            continue;
        }
        PHIDP_PREPARSED_DATA pre = nullptr;
        HIDP_CAPS caps{};
        if (HidD_GetPreparsedData(h, &pre))
        {
            HidP_GetCaps(pre, &caps);
            HidD_FreePreparsedData(pre);
        }
        if (!caps.InputReportByteLength)
        {
            CloseHandle(h); // a part of the pad with no input reports (its audio, say)
            continue;
        }
        found.handle = h;
        found.kind = kind;
        found.reportLength = caps.InputReportByteLength;
        char what[96];
        std::snprintf(what, sizeof(what), "%s (product %04X, %u-byte reports)", KindName(kind), attr.ProductID,
                      unsigned(caps.InputReportByteLength));
        found.what = what;
        break;
    }
    SetupDiDestroyDeviceInfoList(set);
    return found;
}

void SetHid(const gamepad::State& aState)
{
    std::lock_guard<std::mutex> lock(g_hidLock);
    g_hidState = aState;
}

void HidLoop()
{
    bool loggedMisses = false;
    while (!g_hidStop)
    {
        OpenPad pad = FindSonyPad(!loggedMisses);
        loggedMisses = true;
        if (pad.handle == INVALID_HANDLE_VALUE)
        {
            for (int i = 0; i < 20 && !g_hidStop; ++i)
                Sleep(100); // look again in 2 s
            continue;
        }
        Log("Gamepad: reading %s", pad.what.c_str());
        loggedMisses = false;
        std::vector<uint8_t> report(pad.reportLength);
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        bool firstLogged = false;
        int unknown = 0;
        while (!g_hidStop)
        {
            ResetEvent(ov.hEvent);
            DWORD got = 0;
            if (!ReadFile(pad.handle, report.data(), DWORD(report.size()), nullptr, &ov) && GetLastError() != ERROR_IO_PENDING)
                break; // unplugged
            const DWORD wait = WaitForSingleObject(ov.hEvent, 200);
            if (wait == WAIT_TIMEOUT)
            {
                CancelIoEx(pad.handle, &ov);
                GetOverlappedResult(pad.handle, &ov, &got, TRUE);
                continue; // no report for a while: a pad sends them only while something changes, or on Bluetooth
            }
            if (!GetOverlappedResult(pad.handle, &ov, &got, FALSE))
                break;
            gamepad::State s;
            if (gamepad::ParseSony(pad.kind, report.data(), got, s))
            {
                if (!firstLogged)
                    Log("Gamepad: first report 0x%02X, %lu bytes", report[0], got);
                firstLogged = true;
                SetHid(s);
            }
            else if (unknown++ == 0)
            {
                Log("Gamepad: a report REDnode does not read: 0x%02X, %lu bytes", report.empty() ? 0 : report[0], got);
            }
        }
        CancelIoEx(pad.handle, &ov);
        CloseHandle(ov.hEvent);
        CloseHandle(pad.handle);
        SetHid(gamepad::State{});
        if (!g_hidStop)
            Log("Gamepad: the %s is gone", KindName(pad.kind));
    }
}

bool Load()
{
    if (g_loaded)
        return true;
    g_loaded = true;
    HMODULE lib = LoadLibraryW(L"xinput1_4.dll");
    if (!lib)
        lib = LoadLibraryW(L"xinput9_1_0.dll");
    if (lib)
        g_getState = reinterpret_cast<GetStateFn>(GetProcAddress(lib, "XInputGetState"));
    Log("Gamepad: %s; looking for Sony pads too", g_getState ? "XInput loaded" : "no XInput");
    g_hidStop = false;
    g_hidThread = std::thread(HidLoop);
    return true;
}

// The XInput pad now, or a disconnected State.
gamepad::State ReadXInput(uint64_t aFrame)
{
    gamepad::State now;
    if (!g_getState)
        return now;
    XState s{};
    if (g_slot < 0)
    {
        if (aFrame % LookFrames)
            return now;
        for (DWORD i = 0; i < 4; ++i)
        {
            if (g_getState(i, &s) == ERROR_SUCCESS)
            {
                g_slot = int(i);
                Log("Gamepad: XInput controller in slot %d", g_slot);
                break;
            }
        }
        if (g_slot < 0)
            return now;
    }
    if (g_getState(DWORD(g_slot), &s) != ERROR_SUCCESS)
    {
        Log("Gamepad: XInput controller gone (slot %d)", g_slot);
        g_slot = -1;
        return now;
    }
    now.connected = true;
    now.buttons = s.buttons;
    now.lt = s.lt;
    now.rt = s.rt;
    return now;
}
} // namespace

void SetGamepadFront(bool aFront)
{
    g_front = aFront;
}

void UpdateGamepad(uint64_t aFrame)
{
    Load();
    gamepad::State now;
    {
        std::lock_guard<std::mutex> lock(g_hidLock);
        now = g_hidState;
    }
    if (!now.connected)
        now = ReadXInput(aFrame);
    // Out of the front, the player is in another window: report nothing held.
    if (!g_front)
    {
        now.buttons = 0;
        now.lt = 0;
        now.rt = 0;
    }
    if (gamepad::Changed(g_sent, now))
    {
        SendJson(gamepad::EventJson(g_sent, now, aFrame));
        g_sent = now;
    }
}

void StopGamepad()
{
    g_hidStop = true;
    if (g_hidThread.joinable())
        g_hidThread.join();
}
} // namespace rednode::overlay::detail
