// The controller (REDnode 0.65.0, for VATS's trigger test): XInput read once a frame on the game
// thread while the game is in front, and each change sent to Node mods as a "gamepad" game event
// (gamepad.hpp says when and how). Only reads: the game still gets every button and trigger.
//
// XInput is loaded at run time (xinput1_4.dll, Windows 8 and later), so REDnode needs no import
// of it. Polling a slot with no controller is slow (milliseconds), so empty slots are looked at
// only every 120 frames, and the slot in use every frame.

#include "gamepad.hpp"
#include "overlay.hpp"

#include <Windows.h>
#include <atomic>

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
int g_slot = -1; // the controller in use, or -1
gamepad::State g_sent;
std::atomic<bool> g_front{true};
constexpr uint64_t LookFrames = 120;

bool Load()
{
    if (g_loaded)
        return g_getState != nullptr;
    g_loaded = true;
    HMODULE lib = LoadLibraryW(L"xinput1_4.dll");
    if (!lib)
        lib = LoadLibraryW(L"xinput9_1_0.dll");
    if (lib)
        g_getState = reinterpret_cast<GetStateFn>(GetProcAddress(lib, "XInputGetState"));
    Log("Gamepad: %s", g_getState ? "XInput loaded" : "no XInput: controller events are off");
    return g_getState != nullptr;
}

void Send(const gamepad::State& aNow, uint64_t aFrame)
{
    if (aNow.connected != g_sent.connected)
        Log("Gamepad: controller %s (slot %d)", aNow.connected ? "connected" : "gone", g_slot);
    SendJson(gamepad::EventJson(g_sent, aNow, aFrame));
    g_sent = aNow;
}
} // namespace

void SetGamepadFront(bool aFront)
{
    g_front = aFront;
}

void UpdateGamepad(uint64_t aFrame)
{
    if (!Load())
        return;
    gamepad::State now;
    if (g_slot < 0)
    {
        if (aFrame % LookFrames)
            return;
        XState s{};
        for (DWORD i = 0; i < 4; ++i)
        {
            if (g_getState(i, &s) == ERROR_SUCCESS)
            {
                g_slot = int(i);
                break;
            }
        }
        if (g_slot < 0)
            return;
    }
    XState s{};
    if (g_getState(DWORD(g_slot), &s) != ERROR_SUCCESS)
    {
        g_slot = -1;
        if (g_sent.connected)
            Send(now, aFrame); // gone: everything let go
        return;
    }
    now.connected = true;
    // Out of the front, the player is in another window: report nothing held.
    if (g_front)
    {
        now.buttons = s.buttons;
        now.lt = s.lt;
        now.rt = s.rt;
    }
    if (gamepad::Changed(g_sent, now))
        Send(now, aFrame);
}
} // namespace rednode::overlay::detail
