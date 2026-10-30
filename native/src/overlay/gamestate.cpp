// Reads the game's UI state on the game thread, for HUD widgets that hide
// while the game shows a menu, photo mode, a scene or the main menu.
//
// | State      | Source                                                         |
// |------------|----------------------------------------------------------------|
// | menu       | UI_System blackboard, IsInMenu                                 |
// | photo-mode | PhotoModeSystem.IsPhotoModeActive()                            |
// | scene      | the player's PlayerStateMachine blackboard, SceneTier >= 4     |
// | main-menu  | no player, or the system requests handler's IsPreGame(): the   |
// |            | main menu and loading screens, also the boot loading screen,   |
// |            | where the game already has a player                            |
// | world      | V is in the world (#25): a player, not IsPreGame, and attached |
// |            | (PlayerPuppet.OnGameAttached seen, and no OnDetach of the main |
// |            | player since). False while the game starts, at the main menu   |
// |            | and from the start of a load, so mods know when the game's     |
// |            | world systems exist. rtti.call refuses world calls without it. |
//
// A load from the pause menu does not pass the main menu: the main player's OnDetach and
// REDnode's session system (REDnode.reds) turn world off at its start, before the player
// is gone. 0.47.0's OnDetach alone never came (laptop, 2026-10-30): world went off only
// when the player did. Should the
// game keep the same player for 10 s after it (unverified), world comes back on.
//
// The SceneTier threshold is unverified. Tiers run from 1 (free gameplay) to
// 5 (full cinematic); the in-game test calibrates it.
//
// IsPreGame() is reached the way CET mods do, through an inkMenuScenario made for
// it: the handler is the game's own, not the scenario's. Unverified in REDnode.
//
// Sends {"event":"ui-state", ...} to the host when the state changes, and logs
// each change of main-menu with its reason.

#include "overlay.hpp"
#include "rtti.hpp"

#include <atomic>
#include <string>

namespace rednode::overlay::detail
{
namespace
{
constexpr int SceneTierThreshold = 4; // unverified
constexpr uint64_t PollEveryFrames = 6;

std::atomic<uint32_t> g_state{StateMainMenu};
std::atomic_bool g_resend{true};
int g_lastTier = -1;
bool g_warned = false;
bool g_preGameWarned = false;
int g_lastMainMenu = -1; // 0 or 1 once logged
int g_lastWorld = -1;    // 0 or 1 once logged

// The player's attach and detach, from REDnode.reds through NotePlayerEvent. OnDetach runs on
// one of the game's worker threads (seen on the laptop, 2026-10-30), so the event side only
// touches atomics; the poll, on the game thread, does the rest.
std::atomic_bool g_attached{false}; // an OnGameAttached since the start or the last detach
enum : int { NoEvent, Attached, Left };
std::atomic_int g_lastEvent{NoEvent}; // the last attach or leave since the poll, for the poll
void* g_detachedPlayer = nullptr;     // game thread: the player there when world went off
uint64_t g_detachedFrame = 0;
constexpr uint64_t DetachHoldFrames = 600; // about 10 s at 60 fps
bool g_scriptsChecked = false;
bool g_scripts = false; // REDnode's scripts are loaded, so attach events come

rtti::Handle g_scenario; // an inkMenuScenario, only to reach the system requests handler

rtti::Handle g_defs; // GetAllBlackboardDefs(), a long-lived singleton

rtti::Handle BlackboardDefs()
{
    if (!g_defs)
    {
        auto* fn = RED4ext::CRTTISystem::Get()->GetFunction("GetAllBlackboardDefs");
        RED4ext::StackArgs_t none;
        if (fn)
            RED4ext::ExecuteFunction(static_cast<void*>(nullptr), fn, &g_defs, none);
    }
    return g_defs;
}

// The definition object for one blackboard, e.g. UI_System.
rtti::Handle Def(const char* aName)
{
    auto* slot = static_cast<rtti::Handle*>(rtti::Property(BlackboardDefs(), aName));
    return slot ? *slot : rtti::Handle{};
}

bool InMenu()
{
    auto ui = Def("UI_System");
    void* id = rtti::Property(ui, "IsInMenu");
    if (!id)
        return false;
    auto system = rtti::GameSystem("GetBlackboardSystem");
    rtti::Handle board;
    RED4ext::StackArgs_t getArgs;
    getArgs.emplace_back(nullptr, &ui);
    if (!rtti::Call(system, "Get", &board, getArgs) || !board)
        return false;
    bool value = false;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, id);
    rtti::Call(board, "GetBool", &value, args);
    return value;
}

bool InPhotoMode()
{
    bool value = false;
    rtti::Call(rtti::GameSystem("GetPhotoModeSystem"), "IsPhotoModeActive", &value);
    return value;
}

// The game's IsPreGame(): true before a save is running. -1 when it cannot be read.
int PreGame()
{
    if (!g_scenario)
    {
        auto* cls = RED4ext::CRTTISystem::Get()->GetClass("inkMenuScenario");
        auto* raw = cls ? static_cast<RED4ext::IScriptable*>(cls->CreateInstance(true)) : nullptr;
        if (!raw)
            return -1;
        g_scenario = rtti::Handle(raw);
    }
    // It returns a weak handle (whandle): taken into a strong Handle, its destructor
    // would drop a strong reference never added, and the game would free its own
    // handler after a few polls. That crashed the game in REDnode 0.24.5.
    RED4ext::WeakHandle<RED4ext::IScriptable> weak;
    if (!rtti::Call(g_scenario, "GetSystemRequestsHandler", &weak))
        return -1;
    const rtti::Handle handler = weak.Lock();
    if (!handler)
        return -1;
    bool value = false;
    if (!rtti::Call(handler, "IsPreGame", &value))
        return -1;
    return value ? 1 : 0;
}

int SceneTier(const rtti::Handle& aPlayer)
{
    auto psm = Def("PlayerStateMachine");
    void* id = rtti::Property(psm, "SceneTier");
    uint64_t entityId = 0;
    if (!id || !rtti::Call(aPlayer, "GetEntityID", &entityId))
        return -1;
    auto system = rtti::GameSystem("GetBlackboardSystem");
    rtti::Handle board;
    RED4ext::StackArgs_t getArgs;
    getArgs.emplace_back(nullptr, &entityId);
    getArgs.emplace_back(nullptr, &psm);
    if (!rtti::Call(system, "GetLocalInstanced", &board, getArgs) || !board)
        return -1;
    int32_t tier = -1;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, id);
    rtti::Call(board, "GetInt", &tier, args);
    return tier;
}
} // namespace

bool InMainMenu()
{
    return (g_state.load() & StateMainMenu) != 0;
}

bool InWorld()
{
    return (g_state.load() & StateWorld) != 0;
}

void PollGameState(uint64_t aFrame)
{
    if (aFrame % PollEveryFrames != 0 && !g_resend)
        return;

    uint32_t state = 0;
    int tier = -1;
    const auto player = rtti::Player();
    const int preGame = PreGame();
    if (preGame < 0 && !g_preGameWarned)
    {
        g_preGameWarned = true;
        Log("Overlay: could not read IsPreGame; the main menu is only \"no player\"");
    }
    if (!player || preGame == 1)
    {
        state |= StateMainMenu;
    }
    else
    {
        if (InMenu())
            state |= StateMenu;
        if (InPhotoMode())
            state |= StatePhotoMode;
        tier = SceneTier(player);
        if (tier >= SceneTierThreshold)
            state |= StateScene;
        if (tier < 0 && !g_warned)
        {
            g_warned = true;
            Log("Overlay: could not read the scene tier; scene hiding is off");
        }
    }

    switch (g_lastEvent.exchange(NoEvent))
    {
    case Left:
        g_detachedPlayer = player.GetPtr(); // null once the game has let go of it
        g_detachedFrame = aFrame;
        break;
    case Attached:
        g_detachedPlayer = nullptr;
        break;
    default:
        break;
    }
    if (!g_scriptsChecked)
    {
        // Without REDnode's scripts (a script error stops them all) no attach event comes:
        // world then needs only a player past the main menu.
        g_scriptsChecked = true;
        g_scripts = RED4ext::CRTTISystem::Get()->GetClass("REDnodeFactListener") != nullptr;
        if (!g_scripts)
            Log("Overlay: REDnode's scripts are not loaded; \"world\" is only a player past the main menu");
    }
    if (g_detachedPlayer && player.GetPtr() != g_detachedPlayer)
        g_detachedPlayer = nullptr; // that player is gone: the next attach decides
    if (g_detachedPlayer && !(state & StateMainMenu) && aFrame - g_detachedFrame > DetachHoldFrames)
    {
        Log("Overlay: V detached but stayed in the world for 10 s; world on again");
        g_detachedPlayer = nullptr;
        g_attached = true;
    }
    if (!(state & StateMainMenu) && (g_scripts ? g_attached.load() : true) && !g_detachedPlayer)
        state |= StateWorld;

    const int mainMenu = (state & StateMainMenu) ? 1 : 0;
    if (mainMenu != g_lastMainMenu)
    {
        g_lastMainMenu = mainMenu;
        Log("Overlay: main menu %s (player %s, IsPreGame %s)", mainMenu ? "on" : "off", player ? "yes" : "no",
            preGame < 0 ? "unread" : (preGame ? "true" : "false"));
    }
    const int world = (state & StateWorld) ? 1 : 0;
    if (world != g_lastWorld)
    {
        g_lastWorld = world;
        Log("Overlay: world %s (player %s, IsPreGame %s, attached %s)", world ? "on" : "off", player ? "yes" : "no",
            preGame < 0 ? "unread" : (preGame ? "true" : "false"), g_attached.load() ? "yes" : "no");
    }

    const uint32_t old = g_state.exchange(state);
    if (old != state || tier != g_lastTier || g_resend.exchange(false))
    {
        g_lastTier = tier;
        SendJson("{\"event\":\"ui-state\",\"menu\":" + std::string(state & StateMenu ? "true" : "false") +
                 ",\"photoMode\":" + (state & StatePhotoMode ? "true" : "false") +
                 ",\"scene\":" + (state & StateScene ? "true" : "false") +
                 ",\"mainMenu\":" + (state & StateMainMenu ? "true" : "false") +
                 ",\"world\":" + (state & StateWorld ? "true" : "false") +
                 ",\"sceneTier\":" + std::to_string(tier) + "}");
    }
}

uint32_t GetUiState()
{
    return g_state.load();
}

void ResendGameState()
{
    g_resend = true;
}

// Turns world off at once, before the next poll, so a call queued in the same frame is refused.
void LeaveWorld()
{
    g_state.fetch_and(~uint32_t(StateWorld));
    g_resend = true;
}
} // namespace rednode::overlay::detail

namespace rednode::overlay
{
// Any thread: OnDetach comes on a worker thread. Only atomics and the log here.
void NotePlayerEvent(std::string_view aName, int32_t aValue)
{
    using namespace detail;
    if (aName == "PlayerPuppet.OnGameAttached")
    {
        g_attached = true;
        g_lastEvent = Attached;
        return;
    }
    // REDnode.reds sends OnDetach for the main player (1) or once the game has let go of it
    // (2), and SessionEnd from its scriptable system when the game session ends.
    const char* why = aName == "PlayerPuppet.OnDetach" ? (aValue == 2 ? "OnDetach, no player left" : "OnDetach")
                      : aName == "REDnode.SessionEnd"  ? "the session ended"
                                                       : nullptr;
    if (!why)
        return;
    const bool wasOn = InWorld();
    g_attached = false;
    g_lastEvent = Left;
    LeaveWorld();
    Log("Overlay: V left the world (%s)%s", why, wasOn ? "" : "; world was already off");
}
} // namespace rednode::overlay
