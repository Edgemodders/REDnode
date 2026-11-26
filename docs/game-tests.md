---
title: Tests run by an assistant
---

# Tests run by an assistant (#57)

REDcode's request [#57](https://github.com/Edgemodders/REDnode/issues/57), agreed with the owner on 2026-11-23: a Claude session in VS Code runs a test of a mod in the game by itself, while the modder watches the game in REDcode's game tab. REDcode's design page: [game-testing.md](https://github.com/Edgemodders/REDcode/blob/main/docs/design/game-testing.md). REDcode already starts and stops the game (`game_start`, `game_stop`, `game_status`). Three gaps are REDnode's, in this order:

| # | Gap | REDnode's part |
|---|---|---|
| 1 | **Into a save.** After a start, the game sits on its main menu | A list of saves and a load, as MCP tools (`game_saves`, `game_load`) and in the `rednode` package |
| 2 | **Asking every time.** Each changing MCP tool carries `anthropic/requiresUserInteraction`, so Claude Code asks before every call: twenty calls are twenty answers | A test session the player starts once, in the game, for one assistant |
| 3 | **Input.** An assistant cannot press a key or move the mouse in the game | `game_input`: keys, holds, mouse moves and clicks with times, reaching the game without the focus |

Step 4 in the order agreed with the owner on 2026-11-23 ("several days"). Started on 2026-11-25 with step 1's spike, while the owner was away. Steps 2 and 3 are proposed below, not agreed.

## Step 1: saves and loading

The game's own load menu (2.31's decompiled `loadGameMenu`, the same calls on 2.5) asks the **system requests handler** (`inkISystemRequestsHandler`) for its saves with `RequestSavesForLoad` and hears two callbacks:

- `OnSavesForLoadReady(saves: array<String>)`: every save's name, such as `ManualSave-3`. A save's place in this list is the `saveIndex` that `LoadSavedGame(saveIndex)` takes.
- `OnSaveMetadataReady(info: ref<SaveMetadataInfo>)`: one save's details (location, quest, type, time, level, valid, modded, game version).

The handler also has `HasLastCheckpoint()`, `LoadLastCheckpoint(onlySamePlaythrough)` (the game's Continue and its quick load) and `GetLatestSaveMetadata()`. REDnode's plugin already reaches the handler through a fresh `inkMenuScenario` for its main-menu check (gamestate.cpp; it answers a weak handle), so a package can reach it the same way through `api`.

A callback needs a script object with a function of that name, so REDnode 0.74.0 adds one: `REDnodeSavesListener` (`native/scripts/REDnodeSaves.reds`). It sends each callback as a game event with a JSON text: `saves.list` (the names in the game's order) and `saves.meta` (one save's details). Nothing runs until a package registers it.

The save folders in `Saved Games\CD Projekt Red\Cyberpunk 2077` are named like the saves, and their `metadata.9.json` holds the location as a text key (`LocKey#94156`), not words.

### 57a: the spike (built)

The **Saves spike** app (`packages/overlay/apps/saves-spike` 0.1.0, through `api` and the listener only), on REDnode 0.74.0. It answers:

| Question | How |
|---|---|
| Q1. Is the handler there at the main menu and in game? | **Handler**: `IsPreGame`, `HasLastCheckpoint`, `GetLatestSaveMetadata` |
| Q2. Does `RequestSavesForLoad` answer without the load menu open, and do the details come too? | **List saves**: the listener's events, timed, and how many details arrive within 3 s |
| Q3. Do the names match the save folders, and is the list newest first? | **List saves** compares each name with a folder in Saved Games |
| Q4. Does `LoadSavedGame(index)` load the save picked, from the main menu and from a loaded game? | **Load the picked save**; the state's changes are logged with the time since the call |
| Q5. Does `LoadLastCheckpoint` continue from the main menu? | **Continue (last checkpoint)**, with or without the same playthrough |

Stand-in check: scratchpad `s57/check.mjs` (11). The script compiles with redscript-cli alone and beside Codeware, and with the game's scc.exe.

### Saves spike: test

The game on its main menu, nothing loaded yet. The Saves spike needs no permission switch.

| Step | Do | Expect |
|---|---|---|
| 1 | In the launcher, switch on **Saves spike (#57)**, open it, press **Handler** | `handler found; IsPreGame true`, whether there is a last checkpoint, the latest save's place |
| 2 | **List saves** | `saves.list: N saves` with the time; up to 5 `saves.meta` lines; the first 12 saves with their folders. Say whether the order matches the game's Load menu |
| 3 | Pick a save that is not the newest, press **Load the picked save** | That save loads (say which one loaded); the log shows `state: loading`, then `state: world` with the seconds |
| 4 | In game, **List saves** again, pick another save, **Load the picked save** | It loads from a loaded game too |
| 5 | Exit to the main menu (pause menu, Exit to main menu), press **Continue (last checkpoint)** | The last save loads, as the game's own Continue |
| 6 | In game, switch on **Continue: only the same playthrough**, press **Continue (last checkpoint)** | The last save of this playthrough loads |

### Saves spike: results (2026-11-26)

On the dev PC, game 2.5, REDnode 0.74.0 with Saves spike 0.1.0, then 0.1.1. **All six steps passed** once step 5 was understood.

| Question | Answer |
|---|---|
| Q1. The handler | Found at the main menu in 23 ms (`IsPreGame` true, a last checkpoint, the latest save's details through `GetLatestSaveMetadata`) |
| Q2. The list without the load menu | Yes: `saves.list` with **940 saves 11 ms** after `RequestSavesForLoad`. The details do **not** come with it: one `saves.meta` (the newest save) at the main menu, none in a game. The game asks for details per save as its menu shows them, so 57b reads them from the save folders' `metadata.9.json` instead |
| Q3. Names and order | All 940 names match a folder in Saved Games. The first 12 are newest first by folder time, the whole list is not (unverified why; the folder time is not the save's own time). The owner could not compare with the Load menu, which shows no names. Each load names the save it asked for, so a wrong order would show as a wrong save |
| Q4. `LoadSavedGame(index)` | Loads the save at that place in the list: ManualSave-1587 (place 3) from the main menu, V in the world 3.7 s after the call; AutoSave-17 (place 1) from a loaded game, the main menu at 1.4 s and the world at 5.0 s. It loads a modded save with no Mod Verification popup |
| Q5. `LoadLastCheckpoint` | In a game, `LoadLastCheckpoint(true)` loads the last save of the playthrough in 3.6 s (the death screen's and the pause menu's quick load call). At the main menu it does **nothing for a modded save**: the game's own Continue calls `LoadModdedSave(0)` then (`SingleplayerMenuGameController.HandleMenuItemActivate`), and `LoadLastCheckpoint(false)` only for an unmodded one |

Found on the way: a listener made at the main menu is gone in the game, since REDnode drops game objects when a save loads (`List saves failed: ... that game object no longer exists`). Saves spike 0.1.1 makes a fresh one for each list. The owner's ask from step 5 became REDnode 0.75.0's **Load modded saves without the mod check** (docs/overlay.md), passed the same day.

### 57b: the build (after the spike)

From what the spike found:

- `game.saves()` in the `rednode` package: `{ index, name, location, quest, type, time, level, modded, version }[]`, in the game's order. The names and order from `RequestSavesForLoad`, the details from each save folder's `metadata.9.json` (the game sends them only as its menu asks); the location as words (`loc.text` for its key).
- `game.load({ save })` by name or index through `LoadSavedGame`, or `game.load({ last: true })`: at the main menu `LoadSavedGame(0)` (the game's Continue for a modded save), in a game `LoadLastCheckpoint(true)`. It waits until V is in the world (or a time limit) and answers how long it took. A list is asked again before each load by name, since a new save shifts every index.
- MCP: `game_saves` (a read, no ask) and `game_load` (asks first), usable from the main menu.

## Step 2: a test session (proposed)

The ask before each changing call is Claude Code's own: REDnode marks those tools with `anthropic/requiresUserInteraction`, and Claude Code asks in VS Code before every one, in every mode. A test session would leave that mark off for one assistant, for a while, after the player said yes **in the game**, so no assistant can start one for itself.

Recommended shape, for the owner to agree:

| Part | Recommendation |
|---|---|
| Who | One connected assistant, named as in the Tools Manager (`claude-code`), and only the MCP client token it holds |
| How it starts | The assistant asks with a tool (`test_session_start { minutes, why }`); REDnode's own prompt window in the game shows the assistant, the reason and the end; only the player's click there starts it |
| What it covers | The asking tools of REDnode's own MCP server: `api_call`, `archives_reload`, `game_load`, `game_input`, the `world_*` changes, `game_facts_set`, `game_journal_set`, `game_teleport`. Not mod services' `@tool` calls, not attached servers (EDGEmat, EDGEhack) |
| How long | The minutes asked, 60 at most, and never past the game's exit |
| Shown | A line in the launcher with the assistant's name, the time left and **End**; the Tools Manager's recent calls mark the session's calls |
| Ended | By End, by the time, at the game's exit, or when the assistant's token is revoked |

Unverified: whether Claude Code reads a tool's `_meta` again for each call or keeps it from its first tool list. REDnode's server is stateless and builds the list per request, so a list change reaches a new request, but Claude Code may hold its first list until it reconnects. A spike with Claude Code itself answers it before the build.

## Step 3: input (proposed, a spike first)

REDcode's docked game often has no focus, so input sent to Windows' focus misses it. REDnode's plugin is inside the game and already reads and blocks its input for the overlay (`input.cpp`), so the recommended route is the plugin putting key and mouse events into the game's own input, which needs no focus. A spike answers first: where the game takes its input (raw input messages, the input system's event queue), whether a synthetic event there moves V, opens a menu and fires, and whether the game reads input at all while it is not in front.

The tool's shape: `game_input { steps: [{ key: "W", hold: 2000 }, { wait: 500 }, { mouse: { dx: 200 } }, { click: "left" }] }`, played on the game thread, asking first (or covered by a test session).
