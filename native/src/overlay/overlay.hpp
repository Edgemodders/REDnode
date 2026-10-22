#pragma once

// HTML overlay. See docs/overlay.md.
//
// An out-of-process host (Electron) renders overlay apps off-screen, one page
// per window, and streams the frames here over a named pipe. The plugin owns
// window placement, focus and dragging, so they keep up with the game. The
// compositor draws every window and the cursor in a Present hook. Bridge
// requests from apps run on the game thread.
//
// Coordinates: "reference pixels" are screen pixels at 1080p. Page pixels and
// reference pixels are the same size; both are scaled by back buffer height / 1080.

#include <RED4ext/RED4ext.hpp>

#include <Windows.h>

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace rednode::overlay
{
// Plugin load: start the pipe, and the packaged overlay host if there is one.
void Start(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk, const std::filesystem::path& aPluginDir);
// First Running frame: hook Present and the game window. Safe to call again.
void Install();
// Every game frame, on the game thread: run queued bridge requests.
void Update(uint64_t aFrame);
// Forgets every game object reference handed to apps and mods. Called on each
// session attach, when the objects of the last session are gone.
void ClearGameRefs();

// Plugin unload: remove hooks and stop threads.
void Stop();

// Queues a JSON message for the host. Dropped when no host is connected. Any thread.
void SendJson(std::string aJson);
// Returns aText as a quoted, escaped JSON string.
std::string JsonString(std::string_view aText);

namespace detail
{
enum class Mode : int
{
    Passive = 0,     // windows drawn, input goes to the game
    Interactive = 1, // windows and cursor drawn, input goes to the windows
    Hidden = 2       // nothing drawn
};
Mode GetMode();
void SetMode(Mode aMode);
uint64_t NowMs(); // a millisecond clock, for double-clicks
const char* ModeName(Mode aMode);

void Log(const char* aFormat, ...);

// The back buffer, published by the compositor every frame.
struct Screen
{
    float scale = 0;             // back buffer pixels per reference pixel
    float width = 0, height = 0; // in reference pixels
    float backBufferWidth = 0, backBufferHeight = 0;
};
Screen GetScreen();
void SetScreen(const Screen& aScreen);

// link.cpp
void StartLink();
void StopLink();
bool IsConnected();

// windows.cpp: the window registry and input routing. Thread safe.
// Windows open at once. 16 was reached in the W1 test (built-in apps, mods and samples:
// the 17th window was ignored and never drawn). Each slot reserves only a texture view
// until a window uses it.
constexpr uint32_t MaxWindows = 64;
struct WindowView // what the compositor needs, back to front
{
    uint32_t id;
    float x, y;             // reference pixels, top-left
    uint32_t width, height; // page pixels
};
// The changed part of a window's image, ready to upload.
struct WindowFrame
{
    uint32_t fullWidth = 0, fullHeight = 0; // the whole window image
    uint32_t x = 0, y = 0;                  // where the region goes
    uint32_t width = 0, height = 0;         // the region
    std::vector<uint8_t> pixels;            // BGRA, premultiplied, width * height
};
void HandleWindowCommand(const std::string& aJson); // host -> plugin "cmd" messages
void SubmitFrame(uint32_t aWindow, uint32_t aWidth, uint32_t aHeight, std::vector<uint8_t>&& aPixels);
// A frame shared on the GPU: an NT handle already duplicated into this process.
struct SharedFrame
{
    HANDLE handle = nullptr;
    uint32_t width = 0, height = 0;
    uint32_t frameId = 0;
};
// Keeps the newest shared frame per window; an older one still waiting is closed and acknowledged.
void SubmitShared(uint32_t aWindow, const SharedFrame& aFrame);
bool TakeShared(uint32_t aWindow, SharedFrame& aOut);
// Gives back the shared frames of every window not in aDrawn: hidden mode, or hidden with the game's UI.
void DropSharedExcept(const std::vector<WindowView>& aDrawn);
// True once Present is hooked. Until then a shared frame is acknowledged as soon as it arrives.
void SetCompositorActive(bool aActive);
// Tells the host it may give these shared textures back to Chromium.
void AckFrames(const std::vector<uint32_t>& aFrameIds);
// Alpha read back from the GPU, for click-through on GPU-shared windows. Rows are aRowPitch bytes of BGRA.
void SubmitAlpha(uint32_t aWindow, uint32_t aWidth, uint32_t aHeight, const uint8_t* aRows, uint32_t aRowPitch);
// Game calls run in one frame on the game thread and how long they took, for the perf line. Any thread.
void RecordCalls(uint32_t aCount, double aMs);
// Asks for a picture of the game, sent to the host as {"event":"capture"}: the back
// buffer before the overlay is drawn, or after it, scaled to at most aMaxWidth. Any thread.
void RequestCapture(uint32_t aId, bool aWithOverlay, uint32_t aMaxWidth);
// Reports, once, that GPU sharing failed, so the host falls back to the CPU path.
void ReportSharedFailure(const char* aWhat, long aCode);

// A changed rectangle of a window's image, in page pixels.
void SubmitRect(uint32_t aWindow, uint32_t aFullWidth, uint32_t aFullHeight, uint32_t aX, uint32_t aY, uint32_t aWidth,
                uint32_t aHeight, const uint8_t* aPixels);
void CloseAllWindows(); // host disconnected
std::vector<WindowView> SnapshotWindows();
bool TakeFrame(uint32_t aWindow, WindowFrame& aOut);
// Input, called from the game window's thread. Positions in reference pixels.
void OnMouseMove(float aX, float aY);
void OnMouseButton(bool aDown, const char* aButton);
void OnWheel(int aDelta);
void OnKey(bool aDown, UINT aVk);
void OnChar(wchar_t aChar);
void OnLeaveInteractive();
// Pointer lock (request #11): a page holds the cursor in place and gets the mouse's raw
// movement. True while a window holds it; the cursor is then neither moved nor drawn.
bool PointerLocked();
// Raw mouse movement while the pointer is locked: sent to the window that holds it.
void OnMouseDelta(float aDx, float aDy);
// Ends the pointer lock, if any, and tells the host why.
void UnlockPointer(const char* aWhy);

// compositor.cpp
bool InstallCompositor(HWND& aWindow);
void UninstallCompositor();

// input.cpp
bool InstallInput(HWND aWindow);
void UninstallInput();
void GetCursor(float& aX, float& aY); // reference pixels
void CursorFrame(bool aDrawn);        // each present: counts for the cursor diagnostics log

// gamestate.cpp: what the game is showing, for hideWith. Bits of GetUiState().
enum : uint32_t
{
    StateMenu = 1,      // a game menu is open
    StatePhotoMode = 2, // photo mode
    StateScene = 4,     // a cinematic scene
    StateMainMenu = 8,  // no player: main menu or loading screen
};
void PollGameState(uint64_t aFrame); // game thread
uint32_t GetUiState();               // any thread
void ResendGameState();              // send the state again, e.g. to a new host

// host.cpp
void StartHost(const std::filesystem::path& aPluginDir);
void StopHost();

// bridge.cpp
void QueueRequest(std::string aJson);
void RunRequests(uint64_t aFrame);

// reflect.cpp: the generic game API (rtti.call, rtti.get, rtti.release). Game thread.
namespace json
{
struct Value;
}
bool IsReflectMethod(const std::string& aMethod);
std::string Reflect(const std::string& aMethod, const json::Value& aParams, std::string& aError); // result JSON
// REDnode's own audio output (audio.cpp): sound.* and audio.tone, on the game thread.
bool IsAudioMethod(const std::string& aMethod);
std::string Audio(const std::string& aMethod, const json::Value& aParams, std::string& aError);
void UpdateAudio();               // game thread, each frame: menu pauses, ended sounds
void SetAudioFront(bool aFront);  // any thread: the game window came to or left the front
void StopAudio();
void ClearRefs();
// faults.cpp: logs the first faults while a risky game call runs (faults.watch, game thread).
void StartFaults(const std::filesystem::path& aPluginDir);
void StopFaults();
bool IsFaultsMethod(const std::string& aMethod);
std::string Faults(const std::string& aMethod, const json::Value& aParams, std::string& aError);
void UpdateFaults();  // game thread, each frame: logs the end of a watch
void FaultsOnExit();  // DllMain's process detach: who called ExitProcess during a watch
void FaultsOnEnd(const char* aHow, unsigned long aStatus); // the exit hooks: who ends the game during a watch
const uint8_t* FindAssertBufferIn(const uint8_t* aCode, size_t aSize); // the engine's assert message buffer
bool CopyMessage(const char* aFrom, char* aOut, size_t aSize); // a C string read safely, as one printable line
// opus.cpp: a read-only look at the game's sound pak index and open paks (opus.state, H1c).
struct OpusPlaces
{
    uint16_t* indexCount = nullptr; // loaded indexes (sfx_container.opusinfo), at most one
    uint8_t* indexTable = nullptr;  // their entries, 0x60 bytes each
    uint16_t* pakCount = nullptr;   // pak table entries used so far
    uint8_t* pakTable = nullptr;    // open paks, 0x70 bytes each
    uint64_t* infoHash = nullptr;   // the resource path hash the game loads its index from
    uint8_t* loader = nullptr;      // the index loader: bool (uint64_t path hash)
    uint16_t* loadedCount = nullptr; // loaded sounds: entries used so far (null if not found)
    uint8_t* loadedTable = nullptr;  // their entries, 16 bytes each: id, references, data object
    uint8_t* gameFree = nullptr;     // the game's free, as the loader calls it: void (uint32_t pool, void*)
};
struct CodeRange
{
    const uint8_t* begin;
    const uint8_t* end;
};
bool LocateOpus(const std::vector<CodeRange>& aCode, OpusPlaces& aOut, std::string& aWhy);
std::string OpusState(const OpusPlaces& aPlaces, const json::Value& aParams, std::string& aError,
                      std::string* aSummary = nullptr); // result JSON; aSummary: one line for logs
// The audio engine's RegisterGlobalCallback (Wwise), found where the audio start registers
// the pak tick: int (callback, location bits, cookie, 0, 0, 0), 1 on success; and its
// UnregisterGlobalCallback, found where the audio shutdown unregisters the tick:
// int (callback, location bits).
struct AudioCallbacks
{
    void* registerFn = nullptr;
    void* unregisterFn = nullptr;
};
bool LocateAudioCallbacks(const std::vector<CodeRange>& aCode, AudioCallbacks& aOut, std::string& aWhy);
void StopOpus(); // unregisters REDnode's audio callback, if it registered one
// A reload of the sound index (H1c-2), run on the audio thread: retires every pak table
// entry (pak number 0xFFFE, so no lookup matches it), then loads the index again with the
// game's own loader. On failure or a fault it puts the old index and pak numbers back.
struct OpusReload
{
    bool loaded = false;
    bool restored = false;
    uint32_t retired = 0;
    uint32_t soundsBefore = 0;
    uint32_t soundsAfter = 0;
    bool freed = false;      // the old index's tables and hash maps went back to the game's allocator
    uint64_t freedBytes = 0;
    char why[160] = {};
};
void OpusReloadNow(const OpusPlaces& aPlaces, OpusReload& aOut, bool aFreeOld = false);
// The hand-off between the bridge (game thread) and the audio thread's end of frame.
enum OpusStep : int
{
    OpusIdle,
    OpusParkAsked,   // the audio thread is to wait at its next end of frame
    OpusParked,      // it waits there: no pak tick, no lookups, until let go or the cap
    OpusReloadAsked, // it is to reload (and stop waiting, if it waits)
    OpusRunning,
    OpusDone         // the result waits for OpusTakeOutcome
};
struct OpusOutcome
{
    bool done = false;
    OpusReload reload;
    double ms = 0;
    uint64_t parkedMs = 0;
};
bool OpusAskPark(uint32_t aCapMs);            // idle -> park asked
bool OpusAskReload(bool aFreeOld = true);     // idle or parked -> reload asked
bool OpusCancel();                            // a request not yet running, or a wait, ends
int OpusStepNow();
void OpusFrameEnd(const OpusPlaces& aPlaces); // the audio thread, at the end of each frame
OpusOutcome OpusTakeOutcome();                // done -> idle, with the result
bool IsOpusMethod(const std::string& aMethod);
std::string Opus(const std::string& aMethod, const json::Value& aParams, std::string& aError);
// The Sound Tracer's places (SP1), found by byte patterns next to the opus tables:
//   postEvent  Wwise's PostEvent by id: uint32_t (event id, game object id, flags, callback,
//              cookie, external sources, playing id) -> the new playing id, 0 if it failed.
//              Every post goes through it, from the game's own wrapper and from Wwise's
//              by-name versions alike. Called on the game's threads
//   lookup     a sound's lookup in the index: bool (sound id, entry out). The pak tick's
//              acquire (memory) and the streaming IO hook's open both call it, so every
//              sound the game loads passes here, on the audio and streaming threads
struct SoundTracePlaces
{
    uint8_t* postEvent = nullptr;
    uint8_t* lookup = nullptr;
};
// aIndexCount, when known, must be what the lookup's first read points at.
bool LocateSoundTrace(const std::vector<CodeRange>& aCode, const uint16_t* aIndexCount, SoundTracePlaces& aOut,
                      std::string& aWhy);
bool FindSoundTrace(SoundTracePlaces& aOut, std::string& aWhy); // in the running game
// soundtrace.cpp: trace.start, trace.stop, trace.state. The hooks are attached at the first
// trace.start and stay until the plugin stops; they record only while tracing.
bool IsTraceMethod(const std::string& aMethod);
std::string Trace(const std::string& aMethod, const json::Value& aParams, std::string& aError);
void UpdateTrace(); // game thread, each frame: sends what was recorded, about 10 times a second
void StopTrace();
// reflect.cpp, for REDnode's own native code (the ink driver), on the game thread: calls a
// method on aSelf, or a static function of aClass (a global when aClass is null) when aSelf
// is empty, converting JSON arguments as rtti.call does. aObject receives a returned object.
bool CallNative(RED4ext::Handle<RED4ext::IScriptable>& aSelf, const char* aClass, const std::string& aFn,
                const json::Value& aArgs, RED4ext::Handle<RED4ext::IScriptable>* aObject, std::string& aError);
json::Value RefArg(const RED4ext::Handle<RED4ext::IScriptable>& aObject); // an object as a call argument
void DropRefArg(const json::Value& aRef);                                  // and let go of it after
// ink.cpp: the ink driver (I2a): ink.apply, ink.clear and ink.state, on the game thread.
bool IsInkMethod(const std::string& aMethod);
std::string Ink(const std::string& aMethod, const json::Value& aParams, std::string& aError);
void UpdateInk(uint64_t aFrame); // game thread, each frame: builds again what the game removed
void InkHostGone();             // any thread: the host left, and its packages' widgets go with it
void ClearInk();                // game thread: forget every mount (the game is stopping)
// overlay.cpp
const RED4ext::v1::Sdk* GetSdk();
RED4ext::v1::PluginHandle GetHandle();
} // namespace detail
} // namespace rednode::overlay
