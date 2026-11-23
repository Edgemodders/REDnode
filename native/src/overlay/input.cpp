// Game window hook: the F10 hotkey, apps' keys, and input for overlay windows in interactive mode.
//
// F10 cycles passive -> interactive -> hidden. A click on empty screen leaves interactive mode
// for passive, or for hidden with {"cmd":"overlay.clickAway","hide":true}. Esc leaves interactive mode, unless the
// focused page asked for it (the Keyboard Lock API, #34).
// Apps' keys (a key the player gave an app in its title bar): the host sends the list with
// {"cmd":"keys.bind","vks":[66,...],"mods":[4,...]} (mods: 1 Ctrl, 2 Shift, 4 Alt, exactly
// those held). In every mode, a press of one is kept from the game and the pages and sent as
// {"event":"app-key","vk":66,"mods":4}; the host shows or hides the app, and sets the mode with
// {"cmd":"overlay.mode","mode":"interactive"}.
// In interactive mode mouse and keyboard messages go to windows.cpp, which
// routes them to the right overlay window, and are not passed to the game.
// The game hides and locks the cursor, so the overlay keeps a virtual cursor
// over the whole screen, moved by raw mouse input. The compositor draws it.
// In a game window smaller than its screen whose pointer the game does not hold (its menus
// set no clip), the cursor follows the Windows pointer instead, and is neither drawn nor
// pressed while that pointer is outside the game's client area (#56).

#include "overlay.hpp"

#include <windowsx.h>

#include "json.hpp"

#include <algorithm>
#include <atomic>
#include <mutex>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
constexpr UINT ToggleKey = VK_F10;

// Apps' keys. Written by the pipe's reader thread, read by the game window's thread.
struct AppKey
{
    UINT vk;
    uint8_t mods;
};
std::mutex g_appKeysMutex;
std::vector<AppKey> g_appKeys;
std::vector<UINT> g_appKeysDown; // window thread only: pressed apps' keys, whose release is kept too
bool g_appKeyChar = false;        // window thread only: the character a pressed app's key makes is kept too

// Hide on a click in the game (0.69.0, the launcher's switch): a press on empty screen in
// interactive mode goes to hidden mode instead of passive. {"cmd":"overlay.clickAway","hide":true}
std::atomic_bool g_clickAwayHides{false};

uint8_t HeldMods()
{
    uint8_t mods = 0;
    if (GetAsyncKeyState(VK_CONTROL) & 0x8000)
        mods |= 1;
    if (GetAsyncKeyState(VK_SHIFT) & 0x8000)
        mods |= 2;
    if (GetAsyncKeyState(VK_MENU) & 0x8000)
        mods |= 4;
    return mods;
}

// A key event, from raw input or a window message. True when it belongs to an app's key and
// goes no further: the press (sent to the host once, not its repeats) and its release.
bool AppKeyEvent(UINT aVk, bool aDown, bool aSend)
{
    const auto held = std::find(g_appKeysDown.begin(), g_appKeysDown.end(), aVk);
    if (!aDown)
    {
        if (held == g_appKeysDown.end())
            return false;
        if (aSend)
            g_appKeysDown.erase(held);
        return true;
    }
    if (held != g_appKeysDown.end())
        return true; // a repeat
    const uint8_t mods = HeldMods();
    {
        std::scoped_lock lock(g_appKeysMutex);
        if (std::none_of(g_appKeys.begin(), g_appKeys.end(), [&](const AppKey& k) { return k.vk == aVk && k.mods == mods; }))
            return false;
    }
    if (aSend)
    {
        g_appKeysDown.push_back(aVk);
        g_appKeyChar = true;
        Log("Overlay: app key %u (mods %u) pressed", aVk, mods);
        SendJson("{\"event\":\"app-key\",\"vk\":" + std::to_string(aVk) + ",\"mods\":" + std::to_string(mods) + "}");
    }
    return true;
}

HWND g_window = nullptr;
WNDPROC g_origProc = nullptr;
std::atomic_int g_mode{static_cast<int>(Mode::Passive)};

// Virtual cursor in reference pixels. Written by the window thread, read by the compositor.
std::atomic<float> g_cursorX{0};
std::atomic<float> g_cursorY{0};
bool g_rawMouse = false;    // raw mouse input seen: use it, ignore WM_MOUSEMOVE and buttons
bool g_rawKeyboard = false; // raw keyboard input seen: use it, ignore WM_KEYDOWN and WM_CHAR
uint64_t g_activatedAt = 0; // when the game window last came back to the front, NowMs()

// The click that brings the game back to the front (after Alt+Tab) is not meant for
// the overlay: on empty screen it would leave interactive mode and hide the cursor.
// Buttons are ignored for a moment after the game is activated. (O8 test: the
// cursor "disappeared" after switching to the desktop and back.)
bool JustActivated()
{
    return g_activatedAt && NowMs() - g_activatedAt < 300;
}

// Cursor diagnostics. H1 test on the user's laptop (2026-10-19, touchpad): the arrow
// flickered in the game, not in menus. Counts what moved the cursor and how often it
// was drawn; CursorFrame logs them every 5 seconds in interactive mode.
struct CursorDiag
{
    std::atomic<uint32_t> raw{0};         // raw relative moves used
    std::atomic<uint32_t> rawAbsolute{0}; // raw moves with absolute positions (ignored)
    std::atomic<uint32_t> rawAway{0};     // raw mouse input while another window was in front
    std::atomic<uint32_t> msgMoves{0};    // WM_MOUSEMOVE in interactive mode
    std::atomic<uint32_t> msgUsed{0};     // ... that moved the cursor (no raw mouse seen)
    std::atomic<uint32_t> jumps{0};       // moves of more than 150 reference pixels at once
    std::atomic<float> jumpFromX{0}, jumpFromY{0}, jumpToX{0}, jumpToY{0};
    std::atomic<char> jumpVia{0};
    uint32_t frames = 0; // render thread only
    uint32_t drawn = 0;
    uint64_t lastReport = 0;
};
CursorDiag g_diag;

// #56 (REDcode's Game view): a game in a window smaller than its screen leaves the Windows
// pointer free in its menus (no clip), and visible outside the window. Raw movement there
// drives a cursor that drifts from the real pointer (no pointer speed or acceleration) and
// stops at the window's edge while the pointer carries on. So while the game is windowed and
// does not clip the pointer to its window, the cursor follows the Windows pointer.
std::atomic_bool g_windowed{false};          // the client area does not cover its monitor
std::atomic_bool g_windowedKnown{false};
std::atomic_bool g_follow{false};            // the cursor follows the Windows pointer
std::atomic_bool g_pointerAway{false};       // following, and the pointer is outside the client area
std::atomic<uint64_t> g_followCheckedAt{0};
std::atomic<uint64_t> g_heldUntil{0};        // a game seen re-centring the pointer: raw movement until then
std::atomic<uint64_t> g_windowCheckedAt{0};  // render thread: the windowed check outside interactive mode
int g_centred = 0;                           // window thread: raw moves in a row that found the pointer at the centre
bool g_tracking = false;                     // window thread: WM_MOUSELEAVE asked for
POINT g_lastFollowed{-1, -1};                // window thread: the client point the cursor was last put at

// The client area, in client and in screen coordinates.
bool ClientOnScreen(RECT& aClient, RECT& aOnScreen)
{
    if (!g_window || !GetClientRect(g_window, &aClient) || aClient.right <= 0 || aClient.bottom <= 0)
        return false;
    POINT topLeft{0, 0}, bottomRight{aClient.right, aClient.bottom};
    ClientToScreen(g_window, &topLeft);
    ClientToScreen(g_window, &bottomRight);
    aOnScreen = {topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
    return true;
}

// The client area leaves part of its monitor uncovered: a window, not full screen.
bool CoversLessThanMonitor(const RECT& aOnScreen)
{
    MONITORINFO info{sizeof(info)};
    if (!GetMonitorInfoW(MonitorFromWindow(g_window, MONITOR_DEFAULTTONEAREST), &info))
        return false;
    const RECT& m = info.rcMonitor;
    return aOnScreen.left > m.left || aOnScreen.top > m.top || aOnScreen.right < m.right || aOnScreen.bottom < m.bottom;
}

void SendGameWindow()
{
    if (!g_windowedKnown)
        return;
    SendJson(std::string("{\"event\":\"game-window\",\"windowed\":") + (g_windowed ? "true" : "false") +
             ",\"pointer\":" + (g_follow ? "\"follows\"" : "\"raw\"") + "}");
}

void NoteWindowed(bool aWindowed)
{
    const bool known = g_windowedKnown.exchange(true);
    if (known && g_windowed.exchange(aWindowed) == aWindowed)
        return;
    g_windowed = aWindowed;
    Log("Overlay: the game is %s", aWindowed ? "in a window smaller than its screen" : "full screen");
    SendGameWindow();
}

// How the cursor moves now: true to follow the Windows pointer. Checked at most every 100 ms,
// or at once with aNow.
bool Follow(bool aNow = false)
{
    const uint64_t now = NowMs();
    if (!aNow && now - g_followCheckedAt.load() < 100)
        return g_follow;
    g_followCheckedAt = now;
    bool follow = false;
    RECT client{}, box{};
    if (ClientOnScreen(client, box))
    {
        const bool windowed = CoversLessThanMonitor(box);
        NoteWindowed(windowed);
        RECT clip{};
        GetClipCursor(&clip); // the whole desktop when nothing clips it
        const bool clipped =
            clip.left >= box.left && clip.top >= box.top && clip.right <= box.right && clip.bottom <= box.bottom;
        follow = windowed && !clipped && now >= g_heldUntil.load();
    }
    if (g_follow.exchange(follow) != follow)
    {
        if (!follow)
            g_pointerAway = false;
        g_lastFollowed = {-1, -1};
        Log("Overlay: the cursor %s", follow ? "follows the Windows pointer (a window, no clip)"
                                             : "moves by raw mouse input (full screen, or the game holds the pointer)");
        SendGameWindow();
    }
    return follow;
}

void MoveCursorTo(float aX, float aY, char aVia);

// Puts the cursor where the Windows pointer is. Outside the client area it is not drawn and
// takes no presses; it stays where it last was inside.
void FollowPointer()
{
    POINT p{};
    RECT client{};
    if (!GetCursorPos(&p) || !ScreenToClient(g_window, &p) || !GetClientRect(g_window, &client) || client.right <= 0 ||
        client.bottom <= 0)
        return;
    const bool inside = p.x >= 0 && p.y >= 0 && p.x < client.right && p.y < client.bottom;
    g_pointerAway = !inside;
    if (!inside || (p.x == g_lastFollowed.x && p.y == g_lastFollowed.y))
        return;
    g_lastFollowed = p;
    const Screen s = GetScreen();
    MoveCursorTo(float(p.x) * s.width / float(client.right), float(p.y) * s.height / float(client.bottom), 'p');
}

// Following, a raw move that finds the pointer at the client area's centre three times in a row
// means the game puts it back there (it holds the pointer without a clip): raw movement for a second.
void CheckRecentre()
{
    RECT client{};
    POINT p{};
    if (!GetClientRect(g_window, &client) || !GetCursorPos(&p) || !ScreenToClient(g_window, &p))
        return;
    const bool centred = std::abs(p.x - client.right / 2) <= 2 && std::abs(p.y - client.bottom / 2) <= 2;
    g_centred = centred ? g_centred + 1 : 0;
    if (g_centred < 3)
        return;
    g_centred = 0;
    g_heldUntil = NowMs() + 1000;
    Log("Overlay: the game puts the pointer back at the centre: raw mouse input for a second");
    Follow(true);
}

// aVia: 'r' raw input, 'w' WM_MOUSEMOVE, 'p' the Windows pointer followed, 'c' centred on entering interactive mode.
void MoveCursorTo(float aX, float aY, char aVia)
{
    const Screen s = GetScreen();
    const float oldX = g_cursorX, oldY = g_cursorY;
    g_cursorX = std::clamp(aX, 0.0f, std::max(0.0f, s.width - 1));
    g_cursorY = std::clamp(aY, 0.0f, std::max(0.0f, s.height - 1));
    const float dx = g_cursorX - oldX, dy = g_cursorY - oldY;
    if (aVia != 'c' && dx * dx + dy * dy > 150.0f * 150.0f)
    {
        g_diag.jumps += 1;
        g_diag.jumpFromX = oldX;
        g_diag.jumpFromY = oldY;
        g_diag.jumpToX = g_cursorX.load();
        g_diag.jumpToY = g_cursorY.load();
        g_diag.jumpVia = aVia;
    }
    OnMouseMove(g_cursorX, g_cursorY);
}

// Client-area mouse position to reference pixels.
bool ClientToReference(LPARAM aLParam, float& aX, float& aY)
{
    RECT client{};
    GetClientRect(g_window, &client);
    const Screen s = GetScreen();
    if (client.right <= 0 || client.bottom <= 0 || s.scale <= 0)
        return false;
    aX = float(GET_X_LPARAM(aLParam)) * s.width / float(client.right);
    aY = float(GET_Y_LPARAM(aLParam)) * s.height / float(client.bottom);
    return true;
}

void ToggleMode()
{
    SetMode(static_cast<Mode>((g_mode.load() + 1) % 3));
}

// Text for a raw key press, from the current modifier state.
void SendRawChar(UINT aVk, UINT aScanCode)
{
    BYTE state[256] = {};
    for (int vk : {VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU})
    {
        if (GetAsyncKeyState(vk) & 0x8000)
            state[vk] = 0x80;
    }
    if (GetKeyState(VK_CAPITAL) & 1)
        state[VK_CAPITAL] = 1;
    wchar_t text[4] = {};
    const int n = ToUnicodeEx(aVk, aScanCode, state, text, 4, 0x4 /* no keyboard state change */, GetKeyboardLayout(0));
    for (int i = 0; i < n; ++i)
        OnChar(text[i]);
}

LRESULT HandleRawInput(HWND aWnd, WPARAM aWParam, LPARAM aLParam, bool aInteractive, bool& aHandled)
{
    alignas(8) BYTE buffer[sizeof(RAWINPUT)];
    UINT size = sizeof(buffer);
    if (GetRawInputData(reinterpret_cast<HRAWINPUT>(aLParam), RID_INPUT, buffer, &size, sizeof(RAWINPUTHEADER)) ==
        UINT(-1))
        return 0;
    const auto* raw = reinterpret_cast<const RAWINPUT*>(buffer);

    // Input that arrives while another window is in front (the desktop after Alt+Tab)
    // is not the player's input to the game: it must not move the overlay's cursor,
    // press its buttons or toggle it.
    if (GET_RAWINPUT_CODE_WPARAM(aWParam) == RIM_INPUTSINK)
    {
        if (raw->header.dwType == RIM_TYPEMOUSE && aInteractive)
            g_diag.rawAway += 1;
        return 0;
    }

    if (raw->header.dwType == RIM_TYPEKEYBOARD)
    {
        const auto& k = raw->data.keyboard;
        const bool down = !(k.Flags & RI_KEY_BREAK);
        g_rawKeyboard = true;
        static bool toggleHeld = false;
        if (k.VKey == ToggleKey)
        {
            if (down && !toggleHeld)
                ToggleMode();
            toggleHeld = down;
            aHandled = true;
            return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
        }
        if (AppKeyEvent(k.VKey, down, true))
        {
            aHandled = true;
            return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
        }
        if (aInteractive)
        {
            if (down && k.VKey == VK_ESCAPE && PointerLocked())
            {
                UnlockPointer("Esc"); // as in a browser: Esc ends the lock and goes no further
            }
            else if (down && k.VKey == VK_ESCAPE && !FocusWantsEscape())
            {
                SetMode(Mode::Passive);
            }
            else
            {
                OnKey(down, k.VKey);
                if (down)
                    SendRawChar(k.VKey, k.MakeCode);
            }
            aHandled = true;
            return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
        }
    }
    else if (raw->header.dwType == RIM_TYPEMOUSE && aInteractive)
    {
        const auto& m = raw->data.mouse;
        g_rawMouse = true;
        if (m.usFlags & MOUSE_MOVE_ABSOLUTE)
            g_diag.rawAbsolute += 1;
        else if (m.lLastX || m.lLastY)
        {
            g_diag.raw += 1;
            // Locked: the cursor stays; the page gets the raw movement.
            if (PointerLocked())
                OnMouseDelta(float(m.lLastX), float(m.lLastY));
            else if (Follow())
            {
                FollowPointer();
                CheckRecentre();
            }
            else
                MoveCursorTo(g_cursorX + float(m.lLastX), g_cursorY + float(m.lLastY), 'r');
        }
        USHORT f = JustActivated() ? 0 : m.usButtonFlags;
        if (g_pointerAway) // a press outside the game's window is for another window; releases still go
            f &= ~USHORT(RI_MOUSE_LEFT_BUTTON_DOWN | RI_MOUSE_RIGHT_BUTTON_DOWN | RI_MOUSE_MIDDLE_BUTTON_DOWN |
                         RI_MOUSE_WHEEL);
        if (f & RI_MOUSE_LEFT_BUTTON_DOWN)
            OnMouseButton(true, "left");
        if (f & RI_MOUSE_LEFT_BUTTON_UP)
            OnMouseButton(false, "left");
        if (f & RI_MOUSE_RIGHT_BUTTON_DOWN)
            OnMouseButton(true, "right");
        if (f & RI_MOUSE_RIGHT_BUTTON_UP)
            OnMouseButton(false, "right");
        if (f & RI_MOUSE_MIDDLE_BUTTON_DOWN)
            OnMouseButton(true, "middle");
        if (f & RI_MOUSE_MIDDLE_BUTTON_UP)
            OnMouseButton(false, "middle");
        if (f & RI_MOUSE_WHEEL)
            OnWheel(static_cast<SHORT>(m.usButtonData));
        aHandled = true;
        return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
    }
    return 0;
}

LRESULT CALLBACK WndProc(HWND aWnd, UINT aMsg, WPARAM aWParam, LPARAM aLParam)
{
    const bool interactive = GetMode() == Mode::Interactive;

    switch (aMsg)
    {
    case WM_INPUT:
    {
        bool handled = false;
        const LRESULT result = HandleRawInput(aWnd, aWParam, aLParam, interactive, handled);
        if (handled)
            return result;
        break;
    }
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
        if (aWParam == ToggleKey)
        {
            if (!g_rawKeyboard && !(aLParam & (1 << 30)))
                ToggleMode();
            return 0;
        }
        if (AppKeyEvent(UINT(aWParam), true, !g_rawKeyboard))
            return 0;
        if (interactive)
        {
            if (!g_rawKeyboard)
            {
                if (aWParam == VK_ESCAPE && PointerLocked())
                    UnlockPointer("Esc");
                else if (aWParam == VK_ESCAPE && !FocusWantsEscape())
                    SetMode(Mode::Passive);
                else
                    OnKey(true, UINT(aWParam));
            }
            return 0;
        }
        break;
    case WM_KEYUP:
    case WM_SYSKEYUP:
        if (aWParam == ToggleKey)
            return 0;
        if (AppKeyEvent(UINT(aWParam), false, !g_rawKeyboard))
            return 0;
        if (interactive)
        {
            if (!g_rawKeyboard)
                OnKey(false, UINT(aWParam));
            return 0;
        }
        break;
    case WM_CHAR:
    case WM_SYSCHAR:
        if (g_appKeyChar)
        {
            g_appKeyChar = false; // made by an app's key (Alt+B makes "b")
            return 0;
        }
        if (interactive)
        {
            if (!g_rawKeyboard)
                OnChar(wchar_t(aWParam));
            return 0;
        }
        break;
    case WM_MOUSEMOVE:
        if (interactive)
        {
            static float lastX = 0, lastY = 0;
            float x = lastX, y = lastY;
            g_diag.msgMoves += 1;
            if (!PointerLocked() && Follow())
            {
                // #56: the Windows pointer is over the game's window; asked to hear when it leaves.
                if (!g_tracking)
                {
                    TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, aWnd, 0};
                    g_tracking = TrackMouseEvent(&track) != FALSE;
                }
                g_diag.msgUsed += 1;
                FollowPointer();
            }
            else if (!g_rawMouse && ClientToReference(aLParam, x, y))
            {
                g_diag.msgUsed += 1;
                if (PointerLocked())
                    OnMouseDelta(x - lastX, y - lastY);
                else
                    MoveCursorTo(x, y, 'w');
            }
            lastX = x;
            lastY = y;
            return 0;
        }
        break;
    case WM_MOUSELEAVE:
        g_tracking = false;
        if (g_follow)
            g_pointerAway = true; // passed on: the game may have asked for it too
        break;
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_RBUTTONDOWN:
    case WM_RBUTTONUP:
    case WM_MBUTTONDOWN:
    case WM_MBUTTONUP:
    case WM_LBUTTONDBLCLK:
        if (interactive)
        {
            if (!g_rawMouse && !JustActivated())
            {
                const bool down = aMsg == WM_LBUTTONDOWN || aMsg == WM_RBUTTONDOWN || aMsg == WM_MBUTTONDOWN ||
                                  aMsg == WM_LBUTTONDBLCLK;
                const bool left = aMsg == WM_LBUTTONDOWN || aMsg == WM_LBUTTONUP || aMsg == WM_LBUTTONDBLCLK;
                const bool middle = aMsg == WM_MBUTTONDOWN || aMsg == WM_MBUTTONUP;
                OnMouseButton(down, left ? "left" : middle ? "middle" : "right");
            }
            return 0;
        }
        break;
    case WM_MOUSEWHEEL:
        if (interactive)
        {
            if (!g_rawMouse)
                OnWheel(GET_WHEEL_DELTA_WPARAM(aWParam));
            return 0;
        }
        break;
    case WM_SETCURSOR:
        if (interactive)
        {
            SetCursor(nullptr); // the compositor draws the cursor
            return TRUE;
        }
        break;
    case WM_ACTIVATEAPP:
        if (aWParam)
            g_activatedAt = NowMs();
        SetAudioFront(aWParam != 0);
        SetGamepadFront(aWParam != 0);
        Log("Overlay: the game %s the front (mode %s)", aWParam ? "came back to" : "left", ModeName(GetMode()));
        break;
    default:
        break;
    }
    return CallWindowProcW(g_origProc, aWnd, aMsg, aWParam, aLParam);
}
} // namespace

Mode GetMode()
{
    return static_cast<Mode>(g_mode.load());
}

void SetMode(Mode aMode)
{
    const auto old = static_cast<Mode>(g_mode.exchange(static_cast<int>(aMode)));
    if (old == aMode)
        return;
    if (old == Mode::Interactive)
        OnLeaveInteractive();
    if (aMode == Mode::Interactive)
    {
        const Screen s = GetScreen();
        MoveCursorTo(s.width * 0.5f, s.height * 0.5f, 'c');
        if (Follow(true)) // #56: where the Windows pointer is, not the centre
        {
            g_lastFollowed = {-1, -1};
            FollowPointer();
        }
    }
    Log("Overlay: %s", ModeName(aMode));
    SendJson(std::string("{\"event\":\"overlay\",\"mode\":") + JsonString(ModeName(aMode)) + "}");
}

const char* ModeName(Mode aMode)
{
    switch (aMode)
    {
    case Mode::Interactive:
        return "interactive";
    case Mode::Hidden:
        return "hidden";
    default:
        return "passive";
    }
}

void GetCursor(float& aX, float& aY)
{
    aX = g_cursorX.load();
    aY = g_cursorY.load();
}

bool CursorAway()
{
    return g_pointerAway.load();
}

void ResendGameWindow()
{
    SendGameWindow();
}

void CursorFrame(bool aDrawn)
{
    const uint64_t now = NowMs();
    // Windowed or full screen, for the host's state (#56), every 2 seconds in any mode.
    if (now - g_windowCheckedAt.load() >= 2000)
    {
        g_windowCheckedAt = now;
        RECT client{}, box{};
        if (ClientOnScreen(client, box))
            NoteWindowed(CoversLessThanMonitor(box));
    }
    if (GetMode() != Mode::Interactive)
    {
        g_diag.lastReport = 0;
        return;
    }
    if (!g_diag.lastReport)
    {
        // Entering interactive mode: start a fresh count.
        g_diag.lastReport = now;
        g_diag.frames = g_diag.drawn = 0;
        g_diag.raw = g_diag.rawAbsolute = g_diag.rawAway = g_diag.msgMoves = g_diag.msgUsed = g_diag.jumps = 0;
    }
    g_diag.frames += 1;
    g_diag.drawn += aDrawn ? 1 : 0;
    if (now - g_diag.lastReport < 5000)
        return;

    CURSORINFO info{sizeof(info)};
    const bool osCursor = GetCursorInfo(&info) && (info.flags & CURSOR_SHOWING);
    RECT clip{};
    GetClipCursor(&clip);
    char jump[160] = "";
    if (g_diag.jumps)
        snprintf(jump, sizeof(jump), " (last %.0f,%.0f to %.0f,%.0f by %s)", g_diag.jumpFromX.load(),
                 g_diag.jumpFromY.load(), g_diag.jumpToX.load(), g_diag.jumpToY.load(),
                 g_diag.jumpVia == 'r' ? "raw input" : g_diag.jumpVia == 'p' ? "the Windows pointer" : "window message");
    Log("Overlay: cursor, last %.1f s: %u frames, drawn on %u; raw moves %u (absolute %u, while away %u); window "
        "moves %u (used %u); jumps over 150 px %u%s; now at %.0f,%.0f; Windows cursor %s at %ld,%ld, clip %ld,%ld "
        "to %ld,%ld; %s",
        double(now - g_diag.lastReport) / 1000.0, g_diag.frames, g_diag.drawn, g_diag.raw.load(),
        g_diag.rawAbsolute.load(), g_diag.rawAway.load(), g_diag.msgMoves.load(), g_diag.msgUsed.load(),
        g_diag.jumps.load(), jump, g_cursorX.load(), g_cursorY.load(), osCursor ? "shown" : "hidden", info.ptScreenPos.x,
        info.ptScreenPos.y, clip.left, clip.top, clip.right, clip.bottom,
        g_follow ? (g_pointerAway ? "following the Windows pointer, now outside the game's window" : "following the Windows pointer")
                 : "raw movement");
    g_diag.lastReport = now;
    g_diag.frames = g_diag.drawn = 0;
    g_diag.raw = g_diag.rawAbsolute = g_diag.rawAway = g_diag.msgMoves = g_diag.msgUsed = g_diag.jumps = 0;
}

bool InstallInput(HWND aWindow)
{
    if (g_origProc)
        return true;
    if (!aWindow || !IsWindow(aWindow))
    {
        Log("Overlay: no game window to hook");
        return false;
    }
    g_window = aWindow;
    g_origProc = reinterpret_cast<WNDPROC>(
        SetWindowLongPtrW(aWindow, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&WndProc)));
    if (!g_origProc)
    {
        Log("Overlay: could not hook the game window (error %lu)", GetLastError());
        return false;
    }
    return true;
}

bool ClickAwayHides()
{
    return g_clickAwayHides.load();
}

bool HandleInputCommand(const std::string& aJson)
{
    if (aJson.find("\"cmd\":\"overlay.clickAway\"") != std::string::npos)
    {
        const bool hide = aJson.find("\"hide\":true") != std::string::npos;
        if (g_clickAwayHides.exchange(hide) != hide)
            Log("Overlay: a click in the game %s", hide ? "hides the overlay" : "leaves the overlay passive");
        return true;
    }
    if (aJson.find("\"cmd\":\"keys.bind\"") != std::string::npos)
    {
        std::vector<double> vks, mods;
        json::Numbers(aJson, "vks", vks);
        json::Numbers(aJson, "mods", mods);
        std::vector<AppKey> keys;
        for (size_t i = 0; i < vks.size() && i < mods.size() && keys.size() < 64; ++i)
        {
            const UINT vk = UINT(vks[i]);
            // Never F10 or Esc: the overlay's own keys.
            if (vk > 0 && vk < 256 && vk != ToggleKey && vk != VK_ESCAPE)
                keys.push_back({vk, uint8_t(uint32_t(mods[i]) & 7)});
        }
        {
            std::scoped_lock lock(g_appKeysMutex);
            g_appKeys = std::move(keys);
            Log("Overlay: %zu app keys", g_appKeys.size());
        }
        return true;
    }
    if (aJson.find("\"cmd\":\"overlay.mode\"") != std::string::npos)
    {
        std::string mode;
        json::String(aJson, "mode", mode);
        if (mode == "interactive")
            SetMode(Mode::Interactive);
        else if (mode == "hidden")
            SetMode(Mode::Hidden);
        else if (mode == "passive")
            SetMode(Mode::Passive);
        return true;
    }
    return false;
}

void UninstallInput()
{
    if (!g_origProc)
        return;
    // Only restore if nobody hooked the window after us. If someone did, their
    // chain still calls ours, which keeps passing messages through.
    if (GetWindowLongPtrW(g_window, GWLP_WNDPROC) == reinterpret_cast<LONG_PTR>(&WndProc))
        SetWindowLongPtrW(g_window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(g_origProc));
    g_mode = static_cast<int>(Mode::Passive);
}
} // namespace rednode::overlay::detail
