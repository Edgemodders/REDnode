# Tests

Every test run on REDnode so far: how to run it again, what to expect, and what it showed. Each phase ends with a test in the game on the dev PC; new tests are added here when they are first run. The phase pages keep each test's full history and the reasons behind its changes; this page gathers them for running again.

Last updated 2026-10-16. REDagent's own tests (C2 to C5, the chat and authoring) are in [its repo](https://github.com/Edgemodders/REDagent); its C1, the kernel MCP server, is here.

## At a glance

| Test | Kind | Phase | Last run | Version | Result |
|---|---|---|---|---|---|
| [Unit tests](#unit-tests) | Automated | All | Every build | 0.24.2 | Pass |
| [Build and type check](#build-and-type-check) | Automated | All | Every build | 0.24.2 | Pass |
| [Mock game](#mock-game) | Automated, by hand | All | 2026-10-16 | 0.24.2 | Pass |
| [G1 REDnode on game 2.5](#g1-rednode-on-game-25) | In the game | Game 2.5 | 2026-10-25 | 0.38.0 | **Pass** (dev PC, 2.5): every step; two errors found, neither from 2.5, both fixed in 0.38.1: the World test crashed when Remove came during Spin, and the UI kit's inputs let the browser's own `input` event through to pages ([results](#g1-results)). 0.38.1's retest passed the same day ([results](#g1-retest-0381-results)). The laptop run was dropped by the player (its game needs a reinstall) |
| [P1 probe](#p1-probe) | In the game | P1 | 2026-10-11 | 0.1.0 | Pass |
| [Overlay proof of concept](#overlay-proof-of-concept) | In the game | Overlay | 2026-10-11 | 0.3.0 | Pass |
| [O1 Windows](#o1-windows) | In the game | O1 | 2026-10-11 | 0.4.0 | Pass |
| [O2 UI kit](#o2-ui-kit) | In the game | O2 | 2026-10-11 | 0.5.0 | Pass |
| [O3 Apps](#o3-apps) | In the game | O3 | 2026-10-11 | 0.6.0 | Pass |
| [O4 HUD widgets](#o4-hud-widgets) | In the game | O4 | 2026-10-11 | 0.7.0 | Pass, one open item |
| [O5 Performance](#o5-performance) | In the game | O5 | 2026-10-12 | 0.8.0 | Pass |
| [O6a Runtime](#o6a-runtime) | In the game | O6a | 2026-10-12 | plugin 0.9.0 | Pass |
| [O6b Game API](#o6b-game-api) | In the game | O6b | 2026-10-12 | plugin 0.10.0 | Pass |
| [C1 Kernel MCP server](#c1-kernel-mcp-server) | In the game, with Claude Code | REDagent C1 | 2026-10-12 | host 0.4.0 | Pass |
| [MCP asks before changes](#mcp-asks-before-changes) | In the game, with Claude Code | MCP | 2026-10-23 | 0.32.1 | **Pass** (laptop, Claude Code in auto mode): reads went through `api_read` with no question, `api_call` asked every time, a denial held, `archives_reload` asked. The first run (0.32.0) asked at step 2: `api_read` refused `GetItemInEquipSlot`, fixed in 0.32.1 ([results](#mcp-asks-before-changes-results)) |
| [O8 Mod Manager](#o8-mod-manager) | In the game | O8 | 2026-10-13 | plugin 0.14.0 | Pass |
| [W1 World API](#w1-world-api) | In the game | W1 | 2026-10-13 | 0.15.0 | Pass |
| [O9 Debugger](#o9-debugger) | In the game | O9 | 2026-10-13 | 0.16.0 | Pass |
| [W2 Packaging](#w2-packaging) | In the game | W2 | 2026-10-14 | 0.17.0 | Pass |
| [O10 Layers](#o10-layers) | In the game | O10 | 2026-10-14 | 0.18.0 | Pass |
| [T1 TweakDB read](#t1-tweakdb-read) | In the game | T1 | 2026-10-14 | 0.19.0 | Pass |
| [T2 TweakDB write](#t2-tweakdb-write) | In the game | T2 | 2026-10-14 | 0.20.0 | Pass |
| [O11 Spaces](#o11-spaces) | In the game | O11 | 2026-10-14 | 0.21.0 | Pass |
| [Pointer lock](#pointer-lock) | In the game | EDGEbuilder #11 | 2026-10-15 | 0.22.0 | Pass |
| [S1 research spike](#s1-research-spike) | In the game | Sound S1 | 2026-10-16 | 0.23.1 | Partial |
| [S1 Play](#s1-play) | In the game | Sound S1 | 2026-10-16 | 0.24.0 | Pass but pan, fixed in 0.24.1 |
| [S1 check, 0.24.1](#s1-check-0241) | In the game | Sound S1 | 2026-10-16 | 0.24.1 | Pass |
| [Polish 0.24.2](#polish-0242) | In the game | Polish | 2026-10-17 | 0.24.4 | **Partly**: tooltips failed, HUD widgets on the boot loading screen; both fixed and passed in Polish 0.24.5 |
| [Polish 0.24.5](#polish-0245) | In the game | Polish | 2026-10-17 | 0.24.7 | Pass |
| [W3 REDbridge for players](#w3-redbridge-for-players) | In the game | W3 | 2026-10-17 | 0.25.0 | Pass (with the retest) |
| [H0 and Welcome](#h0-and-welcome) | In the game | #12, Welcome | 2026-10-18 | 0.25.1 | Pass (laptop, with a retest) |
| [H1 archives.reload](#h1-archivesreload) | In the game | #12 H1 | 2026-10-19 | 0.26.1 | Pass (laptop), with a quoted path |
| [H1b sound pak check](#h1b-sound-pak-check) | In the game | #12 H1b | 2026-10-19 | 0.26.2 | Refusal **pass** (laptop). Spike: crash with sound let through, no fault caught; no crash with the game paused, but the sound did not change |
| [H1c-1 sound state](#h1c-1-sound-state) | In the game | #12 H1c-1 | 2026-10-19 | 0.26.3 | Pass (laptop): the reading holds; the index is never re-read, so the swapped sound played silent |
| [H1c-2 sound index reload](#h1c-2-sound-index-reload) | In the game | #12 H1c-2 | 2026-10-19 | 0.26.4 | **Crash** at step 4 with the setting still "try". Second run with "reload" (still 0.26.4): no crash, the index reloaded; the katana played the base sound after the first swap (held by the game) and **EDGEwave's sound** after the second |
| [H1c-3 held sounds](#h1c-3-held-sounds) | In the game | #12 H1c-3 | 2026-10-19 | 0.26.7 | **Pass** (laptop): four swaps with the audio thread held, no crash; EDGEwave's sound plays after a swap, except a sound that just played, which switches once the weapon is equipped again (not the held-sounds table: a cache not yet found). 0.26.7's arrow shows and stays ([results](world.md#h1c-3-test-results)). The Welcome window's F9 note not checked yet |
| [H1d sound swaps](#h1d-sound-swaps) | In the game | #12 H1d | 2026-10-19 | 0.26.8 | **Pass** (laptop): two sound swaps with the defaults, the old index freed each time (3270 KB), no faults; EDGEwave's katana sound played; no missing sounds or stutter; the Welcome window's F9 note shows ([results](world.md#h1d-test-results)) |
| [SP1 sound spike](#sp1-sound-spike) | In the game | Sound Tools SP1, #14 | 2026-10-20 | 0.26.9 | **Pass** (laptop): the hooks attached at runtime, no cost seen, none dropped; an event and a raw sound played ([results](sound.md#sp1-test-results)) |
| [SP2 Sound Tracer](#sp2-sound-tracer) | In the game | Sound Tools SP2, #14 | 2026-10-20 | 0.26.14 | **Pass** (laptop): the 0.26.13 retest passed but for Play on Played rows; 0.26.14 plays an event's own recordings, passed ([results](sound.md#sp2b-test-results)) |
| [SP3 Sound Search](#sp3-sound-search) | In the game | Sound Tools SP3 | 2026-10-20 | 0.26.15 | **Pass** (laptop): every step, Scratch kept across a game restart ([results](sound.md#sp3-test-results)) |
| [SP4 The pack](#sp4-the-pack) | In the game | Sound Tools SP4 | 2026-10-20 | 0.26.15 + pack 0.1.0 | **Pass** (laptop): installed fresh from the 0.26.15 release and the pack zip; plain and sound swaps, ↻, a trace, a search, Recent kept across a restart ([results](sound.md#sp4-test-results)) |
| [H2a Refresh test](#h2a-refresh-test) | In the game | H2a | Partly run | 0.26.15 + Refresh test 0.1.0, then 0.2.0 | 2026-10-21 (laptop): crashes in some sessions at the first swap (cause open); swaps of a worn garment work, and re-equipping or a save load shows the new version; 0.1.0 never reached the trousers' slot. Refresh test 0.2.0's Scan found no item in Legs either; V wears them in Equipment-EX's Legs Middle. 0.2.2 (18:12): Scan found them; **Off and on** showed B after A to B, but V kept B after B to A while the preview showed A. 2026-10-22: swaps of two new trouser versions crashed several sessions, and the slot was still hard to find (Equipment-EX and an instant wardrobe switcher installed). **Parked** by the player to rethink the approach (world.md, "H2 parked") |
| [RED Hot Tools Edgemodders build and the guard](hot-swap-research.md#the-edgemodders-build-and-the-guard-test) | In the game | HP0 | 2026-10-22 | 0.26.19, RED Hot Tools 1.3.0+edgemodders.1 | **Pass** (laptop): the official RED Hot Tools' swap refused with the message, the game running on; the Edgemodders build's swap went through |
| [H2 resumed](world.md#h2-resumed-test-with-the-fixed-red-hot-tools) | In the game | H2 | 2026-10-22 | 0.26.19, RED Hot Tools 1.3.0+edgemodders.1, Refresh test 0.2.3 | **Pass** (laptop): no crash in five swaps; Reset look showed the new version on the worn item; Off and on both ways |
| [H2b-0 Reset look both ways](world.md#h2b-0-reset-look-both-ways-test) | In the game | H2 | 2026-10-22 | 0.26.19 | **Pass** (laptop): six swaps both ways, each shown by Reset look with the item worn |
| [SV1 Mod services and the Task Manager](services.md#sv1-test) | In the game | SV1 | 2026-10-24 | 0.36.0 | **Pass** (2.31 backup folder): calls, events, timeout, Stop, errors, a stopped provider, the Task Manager, End task on a stuck mod in the shared process, Restart ([results](services.md#sv1-test-results)) |
| [SV2 Service descriptions](services.md#sv2-test) | In the game | SV2 | 2026-10-24 | 0.36.0 | **Pass**: the Mod Manager's Service section, Describe, a bad call refused by the host ([results](services.md#sv2-test-results)) |
| [SV3 Mods' tools and the Tools Manager](services.md#sv3-test) | In the game | SV3 | 2026-10-24 | 0.36.0, REDagent 0.3.1 | **Pass** (second run for steps 3 and 5): the Tools Manager, reads without asking, Claude Code and REDagent asking before a change, the switch ([results](services.md#sv3-test-second-run-steps-3-and-5)) |
| [Admin Tools pack](admin-tools.md#admin-tools-test) | In the game | Admin Tools | 2026-10-24 | 0.37.0 + pack 0.1.0 | **Pass** (2.31 backup folder): the managers as a pack, refused before their grants, End task and Restart, a tool switched, permissions withdrawn and allowed, pinned ([results](admin-tools.md#admin-tools-test-results)). Checked first in the mock game: 16 cases (refused before the grant, with the reason in the window; a package without the permission refused; each app's own grant; tasks, End task's refusal, tools and switches after it; the Mod Manager's warning; withdrawn, refused again) |
| [Builder window scroll](#builder-window-scroll-0382) | In the game | O6a | 2026-10-26 | 0.38.2 (in 0.40.1), game 2.5 | **Pass**: the World objects test's window scrolls down to its log (Live log step not run, not installed) |
| [MCP sign-in (#19)](mcp.md#mcp-sign-in-test-19) | In the game | MCP | 2026-10-26 | 0.40.0 and 0.40.1, game 2.5 | **Pass**: on 0.40.0 steps 1 to 7 passed and step 8 failed ("Unknown client": Revoke deleted the registration Claude Code reuses); 0.40.1's retest passed every step: deny, lapse, allow, sign-in after a revoke ([results](mcp.md#mcp-sign-in-retest-on-0401-2026-10-26-passed)) |
| [H2c-b World objects](world.md#h2c-b-test) | In the game | H2c | 2026-10-26 | 0.40.1 + World objects test 0.2.0 and 0.2.1, game 2.5 | **Pass**: spawns, `world.near` (about 20 ms), the file match, the MCP world tools; the scene steps failed through test app 0.2.0 (it wrote its scene into its own folder and hot reload restarted it) and passed with 0.2.1 ([results](world.md#h2c-b-test-retest-with-world-objects-test-021-2026-10-26-passed)). The refresh after a swap is unverified until RED Hot Tools supports 2.5 |
| [H2c-a World objects test](world.md#h2c-a-test) | In the game | H2c | 2026-10-25 | 0.38.1 + World objects test 0.1.0, game 2.5 | Partly run, passed: spawn, hold, entity list, Keep in saves, Resources (retest). The swap steps on 2.31 (2026-10-26): the match finds the user; respawn refreshes REDnode's spawns; a game entity refreshes through another appearance and back. **Done** |
| [Development folders](#development-folders) | In the game | #16 | 2026-10-23 | 0.33.0 | **Pass** (2.31 backup folder): a folder added in the launcher, its Hello mod copy ran instead of the installed one with the DEV tag, two edits hot-reloaded it, Remove brought the installed copy back, bad paths refused ([results](#development-folders-results)) |
| [Launcher settings drawer](#launcher-settings-drawer) | In the game | Launcher | 2026-10-23 | 0.32.2 | **Pass** (laptop): the player: "It looks perfect". 0.32.3 then shows the version line as "Version 0.32.3" |
| [Q-A Quest API](quests.md#q-a-test) | In the game | Q-A | 2026-10-23 | 0.32.0 | **Pass** (laptop): facts read and set, the watcher heard each change and kept working after a load, the tracked entry read, V teleported back, the MCP tools read without asking and asked to set ([results](quests.md#q-a-test-results)) |
| [I2d Ink language](ink.md#i2d-test) | In the game | I2d | 2026-10-22 | 0.31.0 | **Pass** (laptop): game keys and `t()` in English and French, plurals, V's gender, fallbacks logged once; the language set at the main menu applies with no restart ([results](ink.md#i2d-test-results)) |
| [I2c Ink data](ink.md#i2c-test) | In the game | I2c | 2026-10-22 | 0.30.0 | **Partial** (laptop): bindings, bars, adds, removes, mount.update and the rebuild order passed; list inserts and moves failed (the index written as "0.000000", refused as an Int32) ([first run](ink.md#i2c-test-first-run-0300)). Retest 2026-10-22, 0.30.1: **Pass** (laptop): inserts, moves, removes and gaps right, the order kept across a load, bindings 0.13 to 0.17 ms a frame ([results](ink.md#i2c-retest-results)) |
| [I2b Ink layout and look](ink.md#i2b-test) | In the game | I2b | 2026-10-22 | 0.29.0 | **Pass** (laptop): the game look on REDnode's widgets, styles, tones, align, gap, grow, icons (one game record points at a missing atlas part), rebuilt after a load, nothing at the main menu, no crash ([results](ink.md#i2b-test-results)) |
| [I2a Ink driver](ink.md#i2a-test) | In the game | I2a | 2026-10-22 | 0.28.0 | **Pass** (laptop): Ink Coords on the HUD, hidden with it in menus and photo mode, rebuilt after a load, off and on once, no crash at quit ([results](ink.md#i2a-test-results)) |
| [I1 Ink spike](ink.md#i1-test) | In the game | I1 | 2026-10-22 | 0.27.0 | **Fail** (laptop): crashed at step 5, Menu button; `rtti.new` wrote a script class's property over its vtable ([first run](ink.md#i1-test-first-run-0270)). Codeware's HUD layer showed the text; the health bar's root did not. Second run 2026-10-22, 0.27.1: **partial** ([results](ink.md#i1-test-second-run-0271)): roots, building, a game screen, menu entries and Read screen answered; Speed hit dropped calls past 256; clicks not reached; crash at quit. Third run 2026-10-22, 0.27.2: **Pass** ([results](ink.md#i1-test-third-run-0272)): every step, hover and click reached Node (each click 12 to 14 times), 2000 changes at once in 239 ms, a screen of 4138 widgets read in 2 s, no crash at quit |
| [H2b refinement: Equipment-EX's hidden items](world.md#h2b-refinement-test) | In the game | H2 | 2026-10-22 | 0.26.21 | **Pass** (laptop): three swaps both ways shown on V; only `OutfitSlots.*` refreshed; shorts in the base Legs slot never showed through |
| [Sound Tools 0.1.1 and REDswap 1.0.0](sound-tools.md) | In the game | Sound Tools, H3 | 2026-10-27 | 0.41.0 + REDswap 1.0.0, Sound Tools 0.1.1, game 2.5 | **Pass** (dev PC): REDswap 1.0.0 ready at the first frame; Hot swap said ready with no RED Hot Tools and made seven swaps of `EDGEmatA.archive` (the save already wore V2, so several in step 2; ↻ in step 3), 49 to 61 ms each, 0 faults, V and the inventory preview refreshed each time; Sound Search searched and played; Sound Tracer traced (477 lines in `rednode-sound-trace.log`). The first run of Sound Search and Sound Tracer on game 2.5 |
| [H3a REDswap](world.md#h3a-test) | In the game | H3 | 2026-10-27 | 0.41.0 + REDswap, Refresh test 0.3.1, game 2.5, no RED Hot Tools | **Pass** (dev PC): four swaps through REDswap (three replaces of `EDGEmatA.archive`, one new archive added), 52 to 59 ms each, 0 faults; V and the inventory preview refreshed with no button, inventory open or closed, which also verifies PV-b (0.40.2) on 2.5 ([results](world.md#h3a-test-results-2026-10-27-passed)) |
| [H3b World refresh and sound on 2.5](world.md#h3b-test) | In the game | H3 | 2026-10-27 | 0.42.1 + REDswap 1.0.0, World objects test 0.2.2, game 2.5 | **Steps 1 to 6 passed** (dev PC): the spawned box respawned after each of three REDswap swaps (69 to 77 ms), no game entity near V used its mesh, 0 faults. Steps 7 to 10 wait for a new EDGEwave katana override; step 9 checks #18 ([results](world.md#h3b-test)) |
| [O12 Console](#o12-console) | In the game | O12 | 2026-10-27 | 0.42.1, game 2.5 | **Pass** (dev PC): every step. The first run (0.42.0) lost the history at Stop (an unfinished asynchronous write), fixed in 0.42.1 and passed on retest ([results](overlay.md#o12-console-test)). Mock game: 21 checks |
| [Editor channel (#17)](#editor-channel-17) | In the game, with Claude | Sound API | 2026-10-29 | 0.45.0, game 2.5 | **Pass** (dev PC): info, play, play and stop a loop, play after the pause menu, the port closed after the quit. Mock game: 15 checks |
| [Shared keys: the Keys view (K2)](#shared-keys-the-keys-view-k2) | In the game | #23 | 2026-10-30 | 0.47.0, game 2.5 | **Pass** (laptop): every step. Found: no sign of the save while a key is encrypted (about 1 s, the box still editable), and an id typed under Other service is saved and logged whatever it is; both changed in 0.47.1; its [retest](#keys-retest-on-0471) **passed** on 2026-10-30 (laptop). Mock game: 23 checks, 30 on 0.47.1 |
| [Shared keys for packages (K3)](#shared-keys-for-packages-k3) | In the game, with Claude | #23 | Not run | 0.48.1 + Keys test 0.1.0, REDagent 0.4.0, game 2.5 | Awaits its run (0.48.1: Keys slides out beside Settings, step 4). Mock game: 20 checks (Keys test), 8 (REDagent) |
| [Resizable windows and the Mod Manager (0.49.0)](#resizable-windows-and-the-mod-manager-0490) | In the game | Overlay | Not run | 0.49.0, game 2.5 | Awaits its run. Mock game: 21 checks (scratchpad `mm/check.mjs`); unit test: `window.size` |
| [A respawn keeps the moved place (#27)](#a-respawn-keeps-the-moved-place-27) | In the game | World | Not run | 0.49.0 + REDswap 1.0.0, World objects test 0.2.3, game 2.5 | Awaits its run. Stand-in host: 7 checks (scratchpad `w27/check.mjs`) |
| [The world flag and game text (#25, #26)](#the-world-flag-and-game-text-25-26) | In the game, with Claude | EDGEmobile's requests | 2026-10-30 | 0.47.0, game 2.5 | **Pass** (laptop), with one finding: `world` was right at every step, but went off at a load only when the player went, since the `OnDetach` wrap never sent its event; the Console showed the long refusal as `Uncaught:` only. Both fixed in 0.47.1: its [retest](#world-flag-retest-on-0471) **passed** on 2026-10-30 (laptop): `world` went off at the start of each load and at the main menu, 0.3 s before the player went. 0.47.2 moves the event's work off the worker thread it arrives on; a short check rides with the next test |
| [Tools Manager starts EDGEmat's server (0.45.1)](mcp.md#edgemats-tools-test) | In the game | E1 | 2026-10-30 | 0.47.0 + Admin Tools 0.1.0, game 2.5 | **Pass** (laptop): the EDGEmat group showed its 10 tools in a fresh session, no assistant asked first |
| [Roles (#20)](services.md#roles-test) | In the game | Services | 2026-10-29 | 0.45.0 + Roles test 0.1.0, Counter service 0.3.0, game 2.5 | **Pass** (dev PC): all eight steps. Mock game: 15 checks |
| [H2b preview spike](world.md#h2b-preview-test) | In the game | H2 | 2026-10-27 | 0.37.0 + Refresh test 0.3.0, RED Hot Tools 1.3.0+edgemodders.1, game 2.31 | **Pass** (laptop): the preview reached through Codeware's menu layer, alive after the menu closes; Reset preview showed the swapped version, menu open or closed; Game event not run (`DelayEventNextFrame` overload); step 2 unanswered (Scan still running) ([results](world.md#h2b-preview-test-results-2026-10-27-passed)) |
| [H2b refresh after a swap](world.md#h2b-test) | In the game | H2 | 2026-10-22 | 0.26.20 | **Pass** (laptop): four swaps both ways shown on V with no button; nothing else changed; base items Equipment-EX hides were reset from the second swap on, with nothing showing |
| [UI builder list](#ui-builder-list) | In the game | `ui.list` | 2026-10-20 | 0.26.13 | **Pass** (laptop): the list scrolls, the window does not, follow and Clear work |
| [Cursor flicker](#cursor-flicker) | In the game | Laptop cursor | 2026-10-19 | 0.26.1 | **Fixed** by an NVIDIA driver update: the arrow blinked in the game with DLSS on (laptop) and not with DLSS off; drawn on every frame, no jumps. Not a REDnode bug |

## Before any in-game test

| Step | How |
|---|---|
| Build | `.\tools\build-native.ps1` if `native/` changed. `npm run overlay:package` if the host, the launcher, the UI kit or the apps changed: the deploy copies the packaged host and the apps |
| Deploy | Close the game first. `.\tools\deploy-native.ps1 -GameDir '<game folder>'` (the default is Steam's). It changes the game folder, so ask the player first. With a packaged host deployed, the game starts it; close any host started by hand |
| Memory | The game needs about 12 to 16 GB of RAM. On a 16 GB machine, close other apps |
| Tie steps to the log | Switch on the **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Each mark goes to the Mod log and `red4ext/logs/rednode-mods.log` as `[timer] Mark: step N done at mm:ss`. Give this instruction first, above the steps. The tests below leave it out of each step |
| Read the logs | After the game process has exited (the logs can be empty before): `red4ext/logs/rednode-*.log` (the plugin), `rednode-overlay.log` (the host), `rednode-mods.log` (packages), `red4ext-*.log`, and `r6/logs/redscript_rCURRENT.log` for script errors. The expected plugin lines are in the [plugin README](https://github.com/Edgemodders/REDnode/blob/main/native/README.md) |
| Record | Results go in the phase's page and in this page's table. When a test shows how a game type behaves, add a note in `gameapi/notes/` |

The tests ran on Cyberpunk 2077 2.31 (Steam), RED4ext 1.30.0, at 3840 x 2160 SDR, mostly with a modded profile (Cyber Engine Tweaks, ArchiveXL, Codeware, TweakXL and others) unless a test says otherwise.

## Automated

### Unit tests

```powershell
.\tools\build-native.ps1
```

Builds the plugin and runs four test programs without the game. The build stops if one fails. Each prints `ok` or `FAIL` per check and `PASSED: 0 failure(s)`.

| Program | Source | What it checks |
|---|---|---|
| `REDnode_tests` | `native/tests/windows_test.cpp` | The overlay window manager: hit testing, click-through, focus, z-order, dragging, anchors, HUD input and hiding, keyboard routing |
| `REDnode_json_tests` | `native/tests/json_test.cpp` | The JSON parser of the game API |
| `REDnode_capture_tests` | `native/tests/capture_test.cpp` | The game picture's conversion: scaling, channel order, HDR10 and scRGB to SDR, base64 |
| `REDnode_audio_tests` | `native/tests/audio_test.cpp` | The Sound API: the four sample files decode (WAV, OGG, MP3, FLAC) at their length and not silent; pan left, right and centre on the stereo mix; the stereo mix reaches only the front pair of a 7.1 device |

### Build and type check

```powershell
npm run build
npm run typecheck
npm run docs:game
```

Expected: no errors. The `rednode` package's build generates its game types from the newest `gameapi/<version>/rtti.json`, now 2.5 (16,140 classes, 1,554 enums, 822 global functions, about 9.5 MB). `docs:game` builds the game API reference into `docs/game` in about a minute. The site's workflow runs the same on every push.

### Mock game

A stand-in for the plugin's end of the overlay pipe: it starts the host, plays a script of game events and input, answers game calls with fixed values, and saves each window's picture. Every host change since O3 was checked against it before the game. It is kept outside the repo (a dev tool, not maintained as part of REDnode), so this entry records what it is used for:

| Use | How |
|---|---|
| Start-up, discovery, launcher, saved choices | The host's log and the `window.open` commands it sends |
| Input, drag, hover, tooltips | Mouse moves, clicks, typing and wheel sent as the plugin's input events; a picture of the window after |
| Game calls | Fixed answers for the calls a sample makes (vitals, settings, time, TweakDB) |
| GPU sharing | Counted, not drawn: pictures come only from the CPU path (`renderPath: "cpu"` in the test's settings) |

Use a throwaway data folder (`--data-dir=`) so the player's settings are not touched.

## P1

### P1 probe

[Source](p1-results.md#session-2-ordered-retest). Last run 2026-10-11 (session 2), REDnode 0.1.0, the P1 probe build. **Pass.** The probe build's log lines are its own: re-running needs that build (commit history), so this test is a record more than a repeatable check.

Wait for Steam's cloud save sync before starting, and pause about 30 seconds after each step.

1. Launch the game and wait at the main menu. Expected: `REDnode 0.1.0 loading (P1 probe)`, `RTTI ready: 12039 types, 716 global functions`, `Game thread pump started`, then `Event drained on frame N: PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42` about 2 seconds later. redscript logs `Compilation complete`.
2. Open the load-save list and back out, twice. Expected: no event, only `Pump heartbeat` lines.
3. Load a save. Expected: one event.
4. Save the game. Expected: no event.
5. Load a different save from the pause menu. Expected: one event.
6. Quit to desktop. Expected: `Game thread pump stopped after N frames`; RED4ext logs `REDnode has been unloaded`.

Showed: `OnGameAttached` fires at the main menu and at every save load, never on save or on opening the load list. Pump rate about 265 fps at the menu, 110 in gameplay. Open: why the main menu attaches a `PlayerPuppet`, and how to tell a real session start from it.

## Overlay

### Overlay proof of concept

[Source](overlay.md#running-the-test). Last run 2026-10-11 (run 2), REDnode 0.3.0, with CET and 10 other RED4ext plugins. **Pass** in both runs. The proof-of-concept panel was replaced by O1's windows, so this is a record.

1. Start the host by hand: `npm run overlay`. Expected: `Waiting for the game`.
2. Launch the game. Expected: a panel in the middle at the main menu (a placeholder with a moving cyan line without the host).
3. With the host: the demo app shows, the terminal prints `Connected to the game`, the clock ticks.
4. **F10**: a yellow cursor. Click **Click me**, type in the text box. The camera does not move. **Esc** gives input back.
5. Load a save. Expected: `PlayerPuppet.OnGameAttached` in the events tile. **Read player position**, walk, read again: V's coordinates change.
6. **F10** twice to hide, once more to show. Quit.

Showed: REDnode and CET draw together (REDnode chains the `Present` hook). Run 1 fixed the lagging cursor (the plugin draws it) and the missing caret (`focusOnWebView()`).

### O1 Windows

[Source](overlay.md#o1-windows-test). Last run 2026-10-11, REDnode 0.4.0. **Pass.** The demo and Signal apps were used; since O3 the host starts with the game, so skip "start the host".

1. Start the game. Expected: the demo (1024 x 640) and **Signal** (a 320 x 320 ring with a transparent middle and a yellow tab).
2. **F10**. Drag the demo by its title bar and Signal by its tab: they follow without lag.
3. Overlap them and click one: it comes to the front, the other's title dims.
4. Click inside Signal's transparent middle over the demo: the click reaches the demo.
5. **Ping** on Signal: it shows the game frame.
6. Click empty screen: interactive mode ends.
7. Restart the game: the windows come back where you left them.

### O2 UI kit

[Source](overlay.md#o2-ui-kit-test). Last run 2026-10-11, REDnode 0.5.0. **Pass.** Uses the **Kit** and **Native** apps.

1. Open **Kit** (every widget) and **Native** (the red **Open stash** button, lower right).
2. **F10**. In Kit, try every tab: buttons, toggles, slider, type a call sign and Enter, list and menu items. Hover **Hover me**: a tooltip.
3. Flip **Game theme** in Kit's title bar: the window switches to the game look (the HUD red theme). Since O6b the launcher's theme buttons also set it for every window.
4. Keyboard: Tab between widgets, arrows in the list and menu, Enter to choose.
5. **Open stash**, pick an item: a game-style notification. Drag the button by its grip.
6. Kit's **Sound** tab: pick a name, **Play**. Note which names sound.

Showed: game UI sounds play through `AudioSystem.Play` with no entity. Open: gamepad navigation; which sound names work.

### O3 Apps

[Source](overlay.md#o3-apps-test). Last run 2026-10-11, REDnode 0.6.0. **Pass.** The player's path: no host started by hand.

1. Check the game folder: `red4ext/plugins/REDnode/host/` and `apps/`.
2. Launch the game. Expected: the windows left on and the **REDNODE** tab at the lower left appear on their own.
3. **F10**, click the tab: the launcher lists the apps with versions and descriptions.
4. Switch an app on: it opens. Switch one off: it closes.
5. Quit. Expected: `REDnode-overlay.exe` is gone from Task Manager (the host runs in a job object).
6. Launch again: the choices were kept.

### O4 HUD widgets

[Source](overlay.md#o4-hud-widgets-test). Last run 2026-10-11, REDnode 0.7.0. **Pass, one open item.** Uses **Coords HUD** and **Game state**.

1. Launch the game. Expected: Coords HUD hidden at the main menu; Game state shows *Main menu / loading: yes*.
2. Load a save: Coords HUD at the top, its numbers change as you walk.
3. **F10**, click on Coords HUD: the click goes through it.
4. Inventory, map, then the pause menu: Coords HUD hides; Game state shows *Menu open: yes*.
5. Photo mode: Coords HUD hides.
6. Talk to an NPC, and trigger a cutscene if you can: note the **scene tier** shown and whether Coords HUD hid.
7. **F10** to hidden: everything hides.

Showed: a conversation is scene tier 2, so the HUD stays up. Open: the `scene` threshold (`SceneTier >= 4`) is **unverified**: no cutscene could be triggered. Check it on a fresh playthrough.

### O5 Performance

[Source](overlay.md#o5-performance-test). Last run 2026-10-12, REDnode 0.8.0. **Pass.** Uses **Perf**, **Stress** and **Signal**.

1. Launch the game. Expected: **Perf** at the top right says *Render path: GPU sharing*; *GPU-shared frames* counts up.
2. Every window looks right: no garbage, flicker, tearing or stale frames. Switch **Signal** on: its ring animates smoothly.
3. In interactive mode, click through Signal's middle: still works.
4. Switch **Stress** on. Note the game's frame rate, the overlay's CPU and GPU times, the host's memory and CPU.
5. Switch **GPU sharing** off in the launcher: windows reopen on the CPU path. Note the same numbers.
6. GPU sharing back on, Stress off.

Showed (Stress on, GPU sharing against CPU): 29 to 31 fps both; overlay GPU under 0.1 ms; 0 against 55 MB/s uploaded; host about 910 against 1,080 MB; about 60 to 100 MB per open window. Overlay CPU was about 1 ms a frame, fixed in O6a (0.11 to 0.15 ms). Open: measure again in a lighter scene than 30 fps.

### O6a Runtime

[Source](overlay.md#o6a-runtime-test). Last run 2026-10-12, plugin 0.9.0. **Pass.** Uses **Hello mod**, **Ticker mod**, **Crash mod**, the **Mod log** and Coords HUD. Needs a second save, and a way to edit `apps/hello-mod/mod.mjs` in the game folder.

1. Load a save, stand still 60 seconds. Expected: Hello mod at the right and Coords at the top show the same X, Y, Z.
2. **F10**. Hello mod: **Play sound** plays; **Follow** off stops the position; drag it by its title.
3. Launcher: the mods show **RUNNING · own process** and their memory. Switch **Hot reload** on, change `first version` in Hello mod's `mod.mjs`, save: the window comes back with the new text within seconds.
4. Switch **Mod log** and **Crash mod** on. **Throw an error**: Crash mod shows **CRASHED**, the Mod log shows the error in red, Hello mod keeps updating. **Restart**.
5. Mod log: **Errors only**, **Copy**: the crash and its line in `mod.mjs`.
6. Crash mod: **Hang forever**. Expected: after about 10 seconds **NOT RESPONDING**; Hello mod keeps updating. **Restart**.
7. **Shared process** on for all three: the launcher shows **shared process (3 mods)**.
8. Crash mod: **Kill the process**: all three **CRASHED**, then running again about 2 seconds later.
9. **F10** to hidden, 30 seconds, back to passive.
10. Inventory for 30 seconds: Coords hides, Hello mod and the Mod log stay.
11. Load a save: Hello mod's **Saves loaded** goes up by one.
12. Quit. Read `rednode-overlay.log` (perf and `Mod processes:` lines) and `rednode-mods.log`.

Showed: an own process is about 100 MB; three mods in one shared process about 150 MB against 370. Open: a worst frame of 21 to 25 ms when a window opens or closes (freeing a texture waits for the GPU), for O7.

### O6b Game API

[Source](overlay.md#o6b-game-api-test). Last run 2026-10-12, plugin 0.10.0. **Pass.** Uses **Vitals**, the **Game API mod**, Hello mod and Crash mod. Needs two saves and a way to get hurt a little.

1. Load a save. Expected: **Vitals** under Coords shows **HP**, **LVL** and **€$**; the Game API mod shows the same.
2. Compare with the game's health bar, character screen and inventory: they match. Vitals hides in menus.
3. **F10**. **Give 100 eddies**: both money values go up by 100.
4. **Wrong argument type**: "Refused, as it should be:" and the reason; nothing happens in the game.
5. **Use the player from before**: "Still valid" and V's position.
6. Hello mod: **Play sound** plays.
7. Launcher themes: **EDGE** turns every title bar solid yellow, **HUD red** red. Coords, Vitals and Native stay red.
8. Open the Mod log, switch Crash mod on, and click inside its window as soon as it appears, between its buttons: interactive mode does not end.
9. Crash mod off. **F10** to hidden, 30 seconds, back to passive.
10. Get hurt: HP drops in Vitals and the mod.
11. Load a different save, **Use the player from before**: "that game object no longer exists"; the values update.
12. Quit. The plugin log has no crash inside a game call; the overlay log has no "Released ... shared frame(s)" while hidden.

Open: `game.player.setHealth`, out parameters and `rtti.get` were not tried in this test (out parameters were later used in the Sound spike).

### O8 Mod Manager

[Source](overlay.md#o8-mod-manager-test). Last run 2026-10-13, plugin 0.14.0. **Pass.** Step 7 needs REDagent with the player's API key.

1. Deploy, load a save. Expected: every package still in the launcher; Hello mod shows in gameplay.
2. **F10**, launcher: **Mod Manager** first. Switch it on.
3. Sort by a column, search "hello", try the filters, page with **Next**.
4. Select Hello mod, **Pin to HUD** off. F10 to passive: its window goes. F10 to interactive: it is back. Pin it again.
5. Unpin something from the launcher (**L**): the launcher says "1 more in the Mod Manager". Pin it back.
6. Tick two or three rows, bulk **Off** then **On**.
7. Ask REDagent for a small new app: the launcher says "1 new"; the **New** filter finds it.
8. Close the Mod Manager with its close button: the launcher shows it off.

Showed: the cursor flickered with frequent Alt+Tab; plugin 0.14.1 ignores input while the game is not in front and logs "Overlay: the game left the front", confirmed in REDagent's C5 test.

### O9 Debugger

[Source](overlay.md#o9-debugger-test). Last run 2026-10-13, REDnode 0.16.0. **Pass.** Uses World test, Coords and Hello mod.

1. Deploy, load a save, switch **World test** on: its window shows at once (up to 64 windows).
2. **F10**. Mod Manager, Coords, **Window debugger: In the game**: a debugger with Elements. **Console**, `document.title`, Enter. Close it.
3. Same with **On the desktop**: DevTools opens on the desktop without taking focus. Alt+Tab to it and back.
4. Launcher: **Developer mode** on: a bug button by every close button. Click one: its debugger opens.
5. Hello mod, **Debug (Node inspector)** on: the mod restarts with an address. **Node debugger: In the game**. **Play sound** in Hello mod: "Sound button pressed 1 time(s)" in the Console.
6. **Sources**, Ctrl+P, `mod.mjs`, breakpoint on `presses += 1;` (line 28). **Play sound**: it stops there, no sound. Resume (F8): the sound plays. Remove the breakpoint.
7. **Restart** Hello mod: the Node debugger reopens. Debug off: it closes, the mod keeps working.
8. Developer mode off. Quit.

Showed: about 34 game calls a second cost 0.5 to 0.9 ms a frame. Open: what caused W1's drop to 30 fps.

### O10 Layers

[Source](overlay.md#o10-layers-test). Last run 2026-10-14, REDnode 0.18.0. **Pass.** Uses Layers test, Test timer, Hello mod, Coords and Vitals.

1. Deploy, load a save.
2. **F10**. Mod Manager: give **Test timer** "staying above other packages' windows". Give **Layers test** solo mode and switch it on: a faint tint covers the screen; the timer can still be clicked.
3. Click the tint, then the launcher tab, the Mod Manager and the timer: each takes the click. Open Hello mod: the tint stays above it, the tools stay on top.
4. Layers test: **Solo on**. Hello mod and HUD widgets go; the launcher tab shows "SOLO Layers test".
5. **End** by the launcher tab: everything comes back. **Solo on** again, then switch Layers test off: everything comes back.
6. World test **Spawn box**: since 0.18.1 a textured cardboard box.

### O11 Spaces

[Source](overlay.md#o11-spaces-test). Last run 2026-10-14, REDnode 0.21.0. **Pass.**

1. Deploy, load a save.
2. **F10**. Launcher, **Space**: **New**, `Combat`, Enter. The tab shows **▾ Combat**; package windows and HUD widgets go; launcher, Mod Manager and Test timer stay.
3. Ctrl+1: Main is back. Ctrl+2: Combat. Ctrl+1.
4. Hello mod's title bar, space icon: **Combat**. It goes; Ctrl+2 shows it. Ctrl+1.
5. Mod Manager's **Space** column shows each package's space. Coords: **All**: it shows in both spaces.
6. On a title bar: roll up, Pin to HUD; drag, then **Reset position**. Developer mode on: ⋯ on the far left holds the actions past three.
7. **Rename** Combat to `Driving`, then **Delete**: its windows come back to Main.

### Pointer lock

[Source](overlay.md#pointer-lock-test). Last run 2026-10-15, REDnode 0.22.0. **Pass.** Uses **Pointer lock test**.

1. Deploy, load a save.
2. **F10**, switch on **Pointer lock test**. Hold the right button on its pad and move: the cursor stays hidden where you pressed; Yaw and Pitch change smoothly. Let go: the cursor is back.
3. Hold the right button and press **Esc**: the lock ends; the overlay stays interactive.
4. Hold the right button and press **F10**: the lock ends with interactive mode.

Showed: Chromium drops `movementX` from injected moves, so the host sends raw movement and the page dispatches it.

### Polish 0.24.2

[Source](overlay.md#polish-0242-test). First run 2026-10-17, REDnode 0.24.4, without the timer. **Partly passed:** steps 2, 4 and 5 passed. Step 1 failed: no tooltips at all, in the game only (the mock game and an offscreen repro drew the title-bar ones). Step 3: Vitals and Coords showed on the boot loading screen, since the game makes a player there.

1. Load a save, **F10**. Hover a title-bar icon (roll up on the Mod Manager or the Test timer): a tooltip after half a second. Hover the launcher's **Open at start**: a tooltip explains it.
2. Make a second space if needed. Mod Manager, **Test timer**: the Space column says **All**, the space buttons are greyed, a note says it is a tool window.
3. Launcher: **Open at start** off. Restart the game: only HUD widgets at the main menu and after loading a save.
4. **F10**: the launcher and windows show. Start the timer again and Mark. Open at start back on if you like.
5. Since 0.24.4 (#13), with EDGEdeck installed and its **Get REDbridge** pressed before the game: **Packaging test** on, its REDbridge permission allowed. The Mod Manager says REDbridge was found in **EDGEdeck (Code)**; the window lists the archives.
6. Quit. The overlay log has `Open at start is off`, `Open at start: the overlay was opened`, and `Sound: the game's volumes are ... (a save loaded)` after each load.

### Polish 0.24.5

[Source](overlay.md#polish-0245-test). First run 2026-10-17 with 0.24.5: **the game crashed** at the title screen, from a weak handle taken as a strong one in the IsPreGame check. Fixed in 0.24.6. With 0.24.6: no crash; the main menu stayed on through the boot-time player and went off with the save (log); the **Open at start** tooltip showed; the title-bar icons still had none, because Chromium sent `pointerover` for the title bar but not for the icons inside it. 0.24.7 also checks `pointermove`: **passed** in game the same day, all steps. Retests 0.24.2's failed parts: tooltips through shadow roots checked in an offscreen repro only; the main menu by `IsPreGame()` unverified.

1. Start the game. Boot loading screen and main menu: no Vitals, no Coords. Load a save: both show.
2. **F10**, Test timer on, **Start**, **Mark**.
3. Hover **Open at start** and keep still: a tooltip.
4. Hover a title-bar icon (Roll up on the Mod Manager) and keep still: a tooltip. If not, leave the game running for an MCP `window_console` read of the `[rn-tip]` trace.
5. Quit. The plugin log has `Overlay: main menu on`, then `main menu off (player yes, IsPreGame false)` in the save, and no `could not read IsPreGame`.

### W3 REDbridge for players

[Source](world.md#w3-test). First run 2026-10-17: steps 1 and 2 passed; step 3 did not start REDbridge (the sample needs its **Archives** button) and step 4's "on" was never logged. Retest the same day with Packaging test 0.2.1: **passed**. REDbridge started from REDnode's copy on the per-user .NET and listed 57 archives; Tooltips on was logged and saved. **Update REDbridge** is unverified. Checked before the game: the install end to end into an empty `LOCALAPPDATA`, and the Mod Manager's button in the mock game. Needs `"bridgeTest": "clean"` in the host's settings, and really installs REDbridge and, if missing for this user, .NET 10.

1. Load a save, **F10**, timer. Mod Manager, **Packaging test**: ✕ `redbridge >=0.10`, the text naming 0.10.0 (58 MB), **Get REDbridge**.
2. **Get REDbridge**: steps and a bar, then ✓ `0.10.0 installed`, "REDbridge 0.10.0 from REDnode".
3. Packaging test off and on: its window lists the archives.
4. Launcher **Tooltips** off: no tooltip on a title-bar icon; on: tooltip again.
5. Quit. The host log has the newest release, the SHA-256 match, .NET, `ready, 0.10.0 from REDnode`, and the Tooltips lines.

### H0 and Welcome

[Source](world.md#h0-and-welcome-test). Last run 2026-10-18, REDnode 0.25.1, on the user's laptop. **Pass**, with a retest of step 3: the first archive picked, a scene mod missing its other parts and swapped at the main menu, crashed the game while RED Hot Tools loaded it (its log stops at "Loading updated archives..."); a plain archive in a loaded save passed. Load a save before the swap. [Results](world.md#h0-and-welcome-results). On a PC without EDGEmat's probe, copy any plain `.archive` from `archive/pc/mod` (no `.xl`, no required mods).

1. Start: the Welcome window at the main menu, Showing lit. F10: Using lit. **Got it** closes it. Load a save, start the timer.
2. Launcher: switch **Welcome** on, it opens; close it with ✕.
3. In the game, `EDGEmat_M0_probe.archive` copied into `archive/pc/hot`: RED Hot Tools swaps it; play on half a minute.
4. Quit. RED Hot Tools loaded, `Archives reload completed`, `Welcome: closed`, no crash.

### H1 archives.reload

[Source](world.md#h1-test). Last run 2026-10-19, REDnode 0.26.0, on the user's laptop. **Pass**: a swap took about 70 ms on the game thread, `Nope.archive` was refused, the permission check refused a swap before **Allowed** was on, and the game quit cleanly. A path pasted in double quotes was refused; fixed after the test. Retest 2026-10-19, REDnode 0.26.1, on the laptop: **pass**, a path from **Copy as path** swapped with its quotes, and with spaces around them (70 and 75 ms). [Results](world.md#h1-test-results), [retest](world.md#h1-quoted-path-retest). To check quotes again: paste a path from **Copy as path** in step 2. Needs RED Hot Tools, and **Hot swap test** switched on in the launcher with **Allowed** on beside its "Asks for swapping archives..." line (the permission, not a swap). `Plain.archive` is any small archive in `archive/pc/mod` known to work, with no `.xl` and no required mods.

1. Load a save, start the timer.
2. Hot swap test: `Plain.archive`, **Swap**: "1 swapped in N ms"; note any stutter.
3. `Nope.archive`, **Swap**: not found.
4. Play on half a minute.
5. Quit. Host log: `Archives: hot-test swaps Plain.archive` and `1 reloaded`; RED Hot Tools' log: `Archives reload completed.`; `archive/pc/hot` empty; no crash.

### H1b sound pak check

[Source](world.md#h1b-test). First run 2026-10-19, REDnode 0.26.2, on the laptop: run A passed (refused, no crash; a plain swap watched with no faults); run B crashed with nothing in the fault log; run C, paused, did not crash, but the sound stayed the base game's ([results](world.md#h1b-test-results)). Found first on 2026-10-19: swapping an archive with the game's sound paks crashes the game on any route ([limit](world.md#h1-limit-sound-paks-crash-a-swap)). Needs RED Hot Tools, Hot swap test with **Allowed** on, a sound archive from EDGEwave (not installed) and a plain archive known to swap. Runs B and C use the spike settings `"soundPakSwap": "try"` and `"swapPause": "pause"` in the host's `settings.json`, removed afterwards.

1. Run A: load a save, timer; swap the sound archive: refused, no crash.
2. Swap the plain archive: "1 swapped"; the plugin log has the fault watch start and end, 0 faults.
3. Run B, `"soundPakSwap": "try"`: swap the sound archive; expected to crash. Send `rednode-faults.log`, the host log, the plugin log and RED Hot Tools' log.
4. Run C, with `"swapPause": "pause"` too: the same, with the game paused around the swap.

### H1c-1 sound state

[Source](world.md#h1c-1-test). First run 2026-10-19, REDnode 0.26.3, on the laptop: **pass**. The patterns found the tables, every read worked, and the swap left the index unchanged; the swapped sound then played silent, which the readings explain ([results](world.md#h1c-1-test-results)). A read-only look at the game's sound pak index and open paks (`opus.state`, `archives.soundState`), around drawing the katana and a paused sound swap. Needs RED Hot Tools, Hot swap test 0.2.0 with **Allowed** on, `EDGEwaveTest.archive` (not installed), and the spike settings `"soundPakSwap": "try"` and `"swapPause": "pause"`, removed afterwards.

1. Load a save with the katana not drawn; timer.
2. Sound state with the overridden sound's id (EDGEwave's hash): index, open paks, where the sound is.
3. Draw the katana, put it away; Sound state.
4. Swap the sound archive: three state lines (before, after, after the unpause); no crash.
5. Draw the katana; note what played; Sound state.
6. Quit. Plugin log: `Opus: found the sound pak tables`; send the mods, plugin, host and fault logs.

### H1c-2 sound index reload

[Source](world.md#h1c-2-test). Built 2026-10-19 in REDnode 0.26.4: with `"soundPakSwap": "reload"`, a sound archive is swapped with the game paused and the plugin loads the game's sound index again on the audio thread; 0.26.5 also holds the audio thread for the whole swap. Needs RED Hot Tools, Hot swap test with **Allowed** on, `EDGEwaveTest.archive` (not installed) and its sound id (746693166), the setting removed afterwards; swap in gameplay with F10. First run 2026-10-19 on 0.26.4: a crash at step 4 with the setting still "try" ([first run](world.md#h1c-2-test-first-run-0264)). The same build has the Welcome window's F9 note: switch Welcome on in the Mod Manager to see it.

1. Load a save with the katana not drawn; timer.
2. Sound state with the sound id.
3. Draw the katana: the base sound.
4. Swap the sound archive: "the audio thread waits for the swap" in the host log and "sound index reloaded ..." in the Mod log; no crash.
5. Draw the katana: EDGEwave's sound is the goal; note what played.
6. Sound state.
7. Play a minute; note missing or wrong sounds.
8. Swap again, draw the katana.
9. Quit. Plugin log: `Opus: REDnode's callback runs at the end of each audio frame`, `Opus: reloaded the sound index`, and at exit `Opus: REDnode's audio callback unregistered`; send the mods, plugin, host and fault logs.

### H1c-3 held sounds

[Source](world.md#h1c-3-test). Built 2026-10-19 in REDnode 0.26.6: `archives.soundState()` says which sounds the game holds loaded, and a reload lists the held sounds that keep their old data. Same setup as H1c-2; remove `EDGEwaveTest.archive` from `archive\pc\mod` before each game start. First run 2026-10-19 on 0.26.6 and 0.26.7: pass ([results](world.md#h1c-3-test-results)).

1. Load a save with the katana not equipped; timer.
2. Sound state: "not held".
3. Swap: reloaded; the held sounds with old data listed.
4. Equip and draw the katana: EDGEwave's sound expected.
5. New session (archive removed): draw the katana, Sound state: held?
6. Swap: is the katana listed? Draw: which sound?
7. Unequip, wait, Sound state, equip, draw: which sound?
8. If still the base sound: load the save, draw.
9. Quit; send both sessions' logs.

### H1d sound swaps

[Source](world.md#h1d-test). Built 2026-10-19 in REDnode 0.26.8: sound archives swap with the hold and the reload by default, and the old index is freed. No sound settings; `EDGEwaveTest.archive` not installed; swap in gameplay. First run 2026-10-19 on the laptop: **pass** ([results](world.md#h1d-test-results)).

1. Load a save with the katana not equipped; timer.
2. Swap: "sound index reloaded ... the old index freed", and the note.
3. Equip and draw the katana: EDGEwave's sound.
4. Swap again; draw: which sound?
5. Two minutes of play; note missing or wrong sounds, stutter.
6. Welcome window: the F9 note.
7. Quit; send the logs.

### SP1 sound spike

[Source](sound.md#sp1-test). Built 2026-10-19 in REDnode 0.26.9: the Sound Tracer's hooks (Wwise's PostEvent and the sound lookup), an event played by name, a game sound played by id. The Sound spike app, switched on, with the bridge permission.

| Run | Build | Result |
|---|---|---|
| 2026-10-20, laptop | 0.26.9 | **Passed** ([results](sound.md#sp1-test-results)): the hooks attached at runtime in under 1 ms, no cost seen, 407 posts and 314 loads in 117 s with none dropped; an event and a raw sound played. No names, since the app loaded them before the bridge permission was allowed |

1. Load a save; switch on Sound spike; timer.
2. Trace about 30 s: still, walk, katana, inventory. Note any stutter.
3. Trace about 30 s: shooting or driving.
4. Play `ui_menu_onpress`, then an event from the "most posted" line.
5. Play sound 746693166.
6. Quit; send the logs.

### SP2 Sound Tracer

[Source](sound.md#sp2-retest-rednode-02612-or-02613). Built 2026-10-20 in REDnode 0.26.10: the Sound Tracer app, event names from the host, the trace log, `ui.copy`. REDbridge installed for names. 0.26.11 adds events played on V, Stop and Stop all, and a layout that cannot overflow sideways; 0.26.12 a close button, and a package's events stopped when it stops.

| Run | Build | Result |
|---|---|---|
| 2026-10-20, laptop | 0.26.10 | First look, no logs ([what was seen](sound.md#sp2-first-run-what-the-user-saw-02610)): a sideways scroll bar; Played rows silent (posted with no entity); no way to stop a long sound. Names work (seen in the spike) |
| | 0.26.13 | **Pass** except Play on Played rows: still silent ([results](sound.md#sp2-retest-results-02613)) |
| 2026-10-20, laptop | 0.26.14 | **Pass**: SP2b, an event's recordings through REDnode's engine ([steps](sound.md#sp2b-test-rednode-02614), [results](sound.md#sp2b-test-results)) |

1. Load a save; switch on Sound Tracer (no permission asked); timer.
2. Trace about 30 s: walk, katana, inventory. The window stays put, the columns scroll, events get names.
3. Scroll Played up (it stays), back down (it follows); filter `katana`, then clear it.
4. Pause 5 s, Resume: the waiting rows come in.
5. Play three named Played rows (foley, katana, ambience) and Stop any that keeps playing; Play a long Loaded row and Stop it; Stop all.
6. Copy a Loaded row, paste it in the bottom box, Enter: the same sound plays.
7. Play an ambience row, then close the Tracer with its ✕: the trace and the ambience stop.
8. Quit; send `rednode-sound-trace.log` and the usual logs.

### SP3 Sound Search

[Source](sound.md#sp3-test-rednode-02615). Built 2026-10-20 in REDnode 0.26.15: Sound Search in the Sound Tools pack (`packs/sound-tools/apps/sound-search`), `audio.searchSounds`, and the Tracer and Hot swap test moved into the pack.

| Run | Build | Result |
|---|---|---|
| 2026-10-20, laptop | 0.26.15 | **Pass**: every step ([results](sound.md#sp3-test-results)) |

1. Load a save; switch on Sound Search; timer.
2. `katana`: names load, then the katana events; open `w_melee_katana_equip`, play its recordings.
3. `fs concrete walk`: ▶ a few times, a different step each press.
4. `746693166`: `w_melee_katana_equip` opens with it marked.
5. ☆ an event and a recording; the Scratch tab has both, and plays them.
6. Restart the game: Scratch still has both; ✕ one.
7. Quit; send the logs.

### SP4 The pack

[Source](sound.md#sp4-test-the-pack-as-a-player-installs-it). Built 2026-10-20: Hot swap for players, the pack's zip (`npm run release:pack`), `requires: rednode`, the Sound Tools docs page. Run with the released REDnode 0.26.15 and the pack's test zip, put in as a player would, plus the Test timer's own zip (it is not in the release zip). First run 2026-10-20 on the laptop: **pass**, every step.

1. Fresh `red4ext/plugins/REDnode` from the 0.26.15 release, then the pack zip. The three apps listed, off, nothing missing; the Hot swap test gone.
2. Hot swap: allow it, swap a plain archive and a sound archive.
3. ↻ on a recent swap.
4. A short trace and a search, each playing something.
5. Restart: Recent kept.
6. Quit; send the logs.

### UI builder list

Built 2026-10-20 in REDnode 0.26.13: `ui.list` in the UI builder, sample **Live log mod** (`apps/list-mod`, closed at start). Checked in the docs simulation and the real host with the mock game (the list overflows and scrolls, the window keeps its size, it follows the newest line, it stays when scrolled up, Clear empties it). **Passed** in the game on 2026-10-20 (laptop, 0.26.13).

1. In the Mod Manager switch on **Live log mod**. A line arrives every two seconds.
2. Press **Add a line** until the list is full: the list scrolls, the window does not.
3. Scroll the list up: it stays put while lines arrive. Scroll to the bottom: it follows again.
4. Press **Clear**.

### Cursor flicker

[Source](overlay.md#cursor-flicker-test). First run 2026-10-19, REDnode 0.26.1, on the laptop: flicker in the game and not in the pause menu, though the arrow was drawn on every frame without jumps; it came only with DLSS on. **Fixed** the same day by updating the NVIDIA driver; not a REDnode bug ([results](overlay.md#cursor-flicker-first-run)). For the laptop where the overlay's arrow flickered in the game. Notes typed in the Test timer go out with the next **Mark**.

1. Load a save, F10, start the timer; touchpad still 10 s.
2. Move slowly 10 s.
3. Pause menu open, F10; still and moving 10 s.
4. Pause menu closed, F10; fast circles 10 s.
5. Quit. Plugin log: `Overlay: cursor` lines for each step.

### O12 Console

[Source](overlay.md#o12-console-test). Built 2026-10-27 in REDnode 0.42.0: the built-in **Console** (`packages/overlay/console`) and `game.player.addItem`/`removeItem`. Checked in the mock game, in development and with the packaged host (scratchpad `console/check.mjs`, 21 checks). **Passed** in the game on 2026-10-27 with 0.42.1, after 0.42.0 lost the history at Stop ([results](overlay.md#o12-console-test)).

0. Test timer: Start, Mark after each step.
1. Load a save, F10, switch on **Console** in the launcher: it opens at the top with a welcome line.
2. `addItem("Items.Pants_01_basic_01")`: added; the trousers are in the inventory.
3. `addItem("Items.Pants_01_basic_09")`: a red error, no such record.
4. `addItem("Items.money", 1000)`: eddies up by 1,000.
5. `pos()`, fold it open; `await api.GetPlayer(game.instance)` shows `PlayerPuppet #...`; `await $_.GetDisplayName()` answers.
6. Up twice brings entries back; `help()` lists the shortcuts; `game.pl` + Tab gives `game.player`.
7. `while (true) {}` shows RUNNING; **Stop** brings the Console back; `1 + 1` answers 2.
8. Close with ✕, switch on again: history is still there.
9. Quit.

## MCP server

### C1 Kernel MCP server

[Source](mcp.md#c1-test). Last run 2026-10-12, host 0.4.0. **Pass.** Needs Claude Code on the same PC. Uses Crash mod, Hello mod, Coords and Vitals.

1. Load a save. **F10**, launcher: **MCP server** on, **Copy setup**.
2. Alt+Tab to a terminal, run the copied command, then `claude mcp list`: `rednode` connected.
3. In a **new** Claude Code session, ask in turn:
   1. "Using the rednode tools, what are V's health, level and money?" (allow each `api_call`)
   2. "Show me the errors in the REDnode mod log." (first switch Crash mod on and press **Throw an error**)
   3. "Capture the Hello mod window and tell me what it shows."
   4. "What does the game show right now, and what does the overlay cost?" (once in gameplay, once with the inventory open)
   5. "Close the Coords HUD, then open it again."
   6. "Give V 50 eddies." (Claude Code asks first; check Vitals)
4. Quit. `claude mcp list`: `rednode` fails to connect, as expected with the game closed.

### MCP asks before changes

[Source](mcp.md#how-api_read-tells-a-read). Built 2026-10-21, REDnode 0.26.16, asked for by EDGEchat. Checked with an MCP client against a stand-in for the game: only `api_call` and `archives_reload` carry the ask flag, `api_read` runs `GetPlayer`, refuses `GiveItem`, and runs a record's `DisplayName` once `tweakdb` returned the record. Not run in the game yet. Needs Claude Code with REDnode's server (EDGEchat's `edge` plugin, or added by hand), in **auto mode**, so any question asked comes from the flag. Uses an archive you can swap, such as one of the H2a trouser versions, and Vitals.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save. **F10**, launcher: **MCP server** on. Start a **new** Claude Code session in auto mode. **Mark**.
2. Ask "Using the rednode tools, what are V's health, level and money, and what is in V's leg slots?" It should use `api_read` and **not** ask you. **Mark**.
3. Ask "Use api_read to give V 50 eddies." `api_read` should refuse it, and Claude Code should move to `api_call`, which **asks you**. Allow it; check Vitals. **Mark**.
4. Ask it to give 50 more. It asks **again** (no "don't ask again"). Deny it this time. **Mark**.
5. Ask it to swap an archive into the game with `archives_reload`. It asks you; allow it. **Mark**.
6. Quit the game.

#### MCP asks before changes: results

2026-10-23, laptop, REDnode 0.32.0, Claude Code in auto mode with EDGEchat's `edge` plugin. Steps 3, 4 and 5 passed: `api_call` asked each time with no "don't ask again", a denied call did not run, and `archives_reload` asked. Step 2 asked as well: to read V's leg slot Claude Code called `GetItemInEquipSlot` through `api_call`. `api_read` refuses a name with a change word after its start, and "Equip" in "EquipSlot" is a noun; of 2.31's 9,504 names that start like reads, that rule refused 543, most of them reads. So the ask flag worked; the read rule did not. REDnode 0.32.1 refuses only a change word joined with `Or`, `And` or `Then` (7 names, all `GetOrCreate…` or `GetOrAdd…`). Retest: steps 0 to 2 only.

Retest, 2026-10-23, laptop, REDnode 0.32.1: **pass**. The same question (V's health, level, money and leg slots) was answered with no question asked.

### Launcher settings drawer

Asked for by the player on 2026-10-23, REDnode 0.32.2: the launcher's title is **REDNODE** (it was cut off), and its six settings moved to a **Settings** drawer on the right, opened with a gear at the right of the Theme row. The UI kit's `rn-window` gained `drawer` for it. Checked before the build in a picture of the real page with a stand-in for the host: all six settings fit beside the panel, bottoms in line.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. **F10**, open the launcher. The title reads **REDNODE** in full. If you had moved the launcher, it starts at its default place once (its page is wider). **Mark**.
2. Press the gear at the right of the Theme row. The **Settings** drawer opens on the right of the panel with GPU sharing, Hot reload, MCP server (with Copy setup), Developer mode, Open at start and Tooltips, each with a line on what it does, and the gear lights up. **Mark**.
3. Switch **Tooltips** off and on again: it works as before. Click on the game to the right of the panel while the drawer is closed: the click reaches the game. **Mark**.
4. Close the drawer with its ✕, open it again with the gear, then close it with the gear. Close the launcher with the REDNODE tab while the drawer is open: both go. **Mark**.
5. Drag the launcher by its grip, then use **Reset position** on its title bar: it goes back. **Mark**.
6. Switch the theme to **HUD red** and **EDGE** with the drawer open: the drawer follows. **Mark**.

### Development folders

[Source](overlay-apps.md#development-folders). EDGEchat's request #16, built on 2026-10-23 in REDnode 0.33.0: folders in the modder's own projects that REDnode also watches, with hot reload, set in the launcher's Settings drawer under Developer mode. Checked in the mock game with two folders set before the start: a copy of the Hello mod in a project folder ran instead of the installed one (logged as skipped), a folder that is itself a package started with `pkg.dir` its own folder, `pkg.appsDirs` held both folders and the apps folder, an edit to the copy's `mod.mjs` hot-reloaded it, and when the copy changed its `id` the installed Hello mod started again. Adding and removing a folder from the launcher was not run there.

Before: make a folder outside the game, for example `E:\Modding\DevTest`, and copy `red4ext\plugins\REDnode\apps\hello-mod` into it as `E:\Modding\DevTest\hello-mod`. In the copy's `rednode-app.json`, change `"name"` to `"Hello mod (dev)"`.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save. **F10**, the launcher, the gear: switch **Developer mode** on. **Development folders** shows under it. **Mark**.
2. Paste `E:\Modding\DevTest` into the field and press **Enter**. It is listed with **Remove**, and the launcher or Mod Manager shows **Hello mod (dev)**. **Mark**.
3. Open the **Mod Manager**: Hello mod (dev) has a **DEV** tag, and its details say "Development copy, from E:\Modding\DevTest\hello-mod" and name the installed copy it hides. **Mark**.
4. Switch Hello mod (dev) on if it is off. With **Hot reload** on, change a line in `E:\Modding\DevTest\hello-mod\mod.mjs` and save: the mod restarts with the change. **Mark**.
5. Press **Remove** beside the folder: the installed Hello mod comes back. **Mark**.
6. Paste a path that does not exist, then the game's own apps folder: each is refused with a message. **Mark**.
7. Quit the game. Send `rednode-overlay.log` and `rednode-mods.log`.

#### Development folders: results

2026-10-23, REDnode 0.33.0, the game run from the 2.31 backup folder: **pass**, all steps. The host log shows each step: at step 2 "Development folder added: E:\Modding\DevTest", the installed Hello mod skipped ("already loaded from E:\Modding\DevTest\hello-mod") and "New package: hello-mod (development copy, …)"; at step 4 two saves of `mod.mjs`, each "Changed: hello-mod (mod.mjs). Reloading."; at step 5 "Development folder removed" and the installed Hello mod back as "New package: hello-mod". The refusals of step 6 show only in the launcher, as designed, and the player saw both. #16 closed.

## Mod services

### SV1 Mod services and the Task Manager

[Source](services.md#sv1-test). Built 2026-10-24 in REDnode 0.34.0: calls between packages (Counter service and Counter panel) and the built-in Task Manager with End task. Checked in the mock game (17 service cases, a call across a hot reload, End task on a stuck mod in the shared process). The steps are on the source page.

### SV2 Service descriptions

[Source](services.md#sv2-test). Built 2026-10-24 in REDnode 0.35.0: services described by their JSDoc, calls checked before they reach the provider, `service.describe`, `rednode describe` for bundled packages, the Mod Manager's Service section. Checked in plain Node (29 reader cases) and the mock game (26 cases). The steps are on the source page.

### SV3 Mods' tools and the Tools Manager

[Source](services.md#sv3-test). Built 2026-10-24 in REDnode 0.36.0 with REDagent 0.3.1: `@tool` functions as MCP tools, `mod_services`, `mod_read`, `mod_call`, the Tools Manager's switches. Checked in the mock game as an MCP client (23 cases). The steps are on the source page.

## World API

### H2c-a World objects test

[Source](world.md#h2c-a-test). Built 2026-10-23: the spike of H2c, the **World objects test** app over REDnode 0.33.0. Needs Codeware, RED Hot Tools and two versions of an archive that replaces a prop mesh. The steps are on the source page.

First run 2026-10-25 on game 2.5 (REDnode 0.38.1, app 0.1.0), without RED Hot Tools (no 2.5 build), so without the swap steps: **pass** for spawn by record and by template, hold and friendly, the entity list, a prop, and Keep in saves. Targeting found nothing, and its empty list left Resources nothing to read (app 0.1.1 keeps the last list); a retest with Entity list then Resources passed: 12 entities, 217 files, about 1 s an NPC through `api`. Results: [H2c-a test: first run, game 2.5](world.md#h2c-a-test-first-run-game-25).

### Builder window scroll (0.38.2)

Built 2026-10-26 after the H2c-a swap run, where the World objects test's log (a `ui.list` with no height) was squeezed to nothing under its controls and could not be seen. REDnode 0.38.2 keeps such a list at least 160 px tall and lets the window scroll to reach it (`packages/overlay/builder/index.html`). Checked outside the game on a copy of that window: at 560 px tall the old CSS left the log 8 px, the new one 168 px with the window scrolling. Runs on game 2.5 (no RED Hot Tools needed).

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save. F10, Mod Manager: switch on **World objects test**. Its log shows at the bottom of its window, with "World objects test ready". **Mark**.
2. Press **Entity list** a few times. New lines show in the log and it follows the newest. **Mark**.
3. Scroll the window (wheel over the buttons) and the log (wheel over the log). Both move. **Mark**.
4. Open the Live log mod sample, if installed: its log fills its window as before, with no window scrollbar. **Mark**.

Run 2026-10-26 (game 2.5, REDnode 0.40.1), folded into the H2c-b test's step 1 with World objects test 0.2.0 and 0.2.1: **passed**. The window scrolls down to the log and the log shows its lines (the player's word; no timer mark). Step 4 was not run: the Live log mod is not installed.

### H2c-a World objects test: the 2.31 swap run

Swap run 2026-10-26 in the 2.31 backup (REDnode 0.37.0, RED Hot Tools 1.3.0, app 0.1.1, a box archive and a barrel at the box's path): **not run**. Every Swap was refused because the steps never said to allow the app to swap archives; they do now. The rest passed again (prop, respawn, entity list, Resources after Targeting). Rerun the same night with the permission: both swaps went through (77 and 71 ms) and **Respawn spawned** showed the new mesh both ways (box to barrel, barrel to box, about 200 ms); the existing prop did not change by itself; the appearance-again buttons did not run (they needed Entity list first; app 0.1.2 lists by itself). With 0.1.2: Who uses it found the spawned box by its mesh hash; look again, through missing and All near left it a box; respawn made it a barrel. Open: an appearance change on an entity whose `.app` names the swapped mesh. Vending machine runs (app 0.1.3, its cage swapped): look again with the same name did nothing; through another and through missing showed the swapped file both ways (cage to none, none back to cage); walking out of sight and back showed it too; the replacement drew nothing because it lacked the component's mesh appearance `device`. Results: [H2c-a: a game entity](world.md#h2c-a-a-game-entity-the-vending-machine). **H2c-a is done.** Results: [H2c-a swap run on 2.31: not run](world.md#h2c-a-swap-run-on-231-not-run).

### W1 World API

[Source](world.md#w1-test). Last run 2026-10-13, REDnode 0.15.0. **Pass.** Needs Codeware 1.14 or later. Uses **World test** (base-game assets only since 0.17.1).

1. Deploy, load a save. `r6/logs/redscript_rCURRENT.log` has no compile errors.
2. **F10**, Mod Manager: **World test** on. It says "World API ready (Codeware found)".
3. Face an open spot, **Spawn box**: a box about 3 m ahead; the time it took; `Entity/Initialize` and `Entity/AfterAttach` for it.
4. **Spin 10 s**: 5 seconds one move at a time, 5 seconds ten at a time, with moves per second for each.
5. **Remove**: the box goes; `Entity/Detach`.
6. **Next mesh**, **Spawn box**: the marker mesh. Remove it.
7. Quit. Compare moves per second with the frame rate in the perf lines.

Showed: spawn 254 to 257 ms. Awaited moves run one a frame; ten sent together run in the next frame (302 a second), so batching needs no special call. Open: whether the moves caused the drop to 30 fps.

### W2 Packaging

[Source](world.md#w2-test). Last run 2026-10-14, REDnode 0.17.0. **Pass.** Needs Codeware and ArchiveXL, a REDbridge (found in EDGEdeck's or REDcode's storage, or `REDBRIDGE_EXE`) and .NET 10. Uses **Packaging test**.

1. Deploy, load a save.
2. **F10**. Mod Manager, **Packaging test** (New filter): **NEEDS**. Under **Requires**: Codeware and ArchiveXL ticked with versions, `not-a-real-mod` crossed out. The **Errors** filter lists it.
3. Switch it on: its window lists the same three lines.
4. **Permissions**: where REDbridge was found. **Allowed** on.
5. **Archives**: 57 archives, about 584,000 files after a few seconds. **Search**: files named `player_ma_tpp`.
6. Launcher: **EDGE**, open a window debugger: its title bar is yellow. Switch back.

Showed: a RED4ext plugin counts as installed only with a DLL in its folder (0.17.1, #9).

### H2a Refresh test

[Source](world.md#h2a-test). Built 2026-10-21: the spike of `world.refresh`, the **Refresh test** app over the released REDnode 0.26.15. Needs RED Hot Tools, Codeware, and two versions (A and B) of a clothing archive with the same name. First run 2026-10-21: the game closed at step 2, swapped with the inventory open; later sessions showed swaps working and re-equipping showing the new version. Refresh test 0.2.0's Scan found no item in Legs. V wears them in Equipment-EX's Legs Middle. 0.2.2: **Off and on** works from A to B, not back. Next: Refresh test 0.2.3 ([steps](world.md#refresh-test-023-test)): take the trousers off before the swap.

1. Load a save wearing the item (A); Refresh test on and allowed; timer.
2. Swap B: no change by itself expected.
3. Take the item off and on in the inventory: B?
4. Swap A, **Re-attach**.
5. Swap B, **Reset look**.
6. Swap A, **Same look**.
7. Swap B, **Off and on**; still equipped?
8. An NPC: **Same appearance**, **Through a missing one**.
9. Spawn the item's mesh, swap, **Mesh off and on**.
10. Swap back, **Respawn**, **Remove**.
11. Quit; send the logs; put A back in `archive\pc\mod`.

## TweakDB API

### T1 TweakDB read

[Source](tweakdb.md#t1-test). Last run 2026-10-14, REDnode 0.19.0. **Pass.** Uses **TweakDB test**.

1. Deploy, load a save.
2. **F10**, Mod Manager: **TweakDB test** on, **Read**: `gamedataWeaponItem_Record`, the Lexington's quality, item type, display name, friendly name, tags and `FriendlyName()`.
3. Type `Vehicle.v_sport2_quadra_type66_player`, Enter: `gamedataVehicle_Record`. Then `Items.not_a_thing`: "No record".
4. **Vehicles**: the count and the time.

Showed: 7 values in 226 ms; 1,377 vehicle records in 26 ms. Open: names for hashed ids (REDbridge #3).

### T2 TweakDB write

[Source](tweakdb.md#t2-test). Last run 2026-10-14, REDnode 0.20.0. **Pass.** Needs TweakXL (1.11.4 in the run).

1. The TweakDB test shows no **NEEDS**. Load a save.
2. **Read**, then **Change**: the friendly name and `FriendlyName()` read "REDnode was here".
3. Switch the TweakDB test off and on, **Read**: `w_handgun_militech_lexington` again. The log: `Undid 1 TweakDB change(s) of tweakdb-test (the mod stopped)`.
4. **Clone**: `Items.REDnode_Test_Clone`, a `gamedataWeaponItem_Record`, friendly name "REDnode clone".
5. Quit. TweakXL's log has nothing from REDnode's calls.

Open: which objects already in the game see a change.

## Sound API

### S1 research spike

[Source](sound.md#s1-spike-results). Last run 2026-10-16, REDnode 0.23.1. **Partial**: a research test. Uses **Sound test** 0.1 (its spike buttons were replaced in 0.2.0, so this is a record).

1. Load a save. **Read settings**: the audio settings with their numbers.
2. Change master and effects volume in Settings, **Read settings**: the two values changed.
3. **Play test tone** and **Low** with game sound on: clean beeps, the game's sound keeps playing.
4. Pause menu, then the map: the "time" line.
5. Slow time (Sandevistan or scanner): the dilation number.
6. Walk, then only turn: the camera line changes, then stays.
7. Alt+Tab and back, **Play test tone**: still plays.
8. Switch Windows' output, **Play test tone**: which output plays it.

Showed: the volumes are under `/audio/volume` (Ints 0 to 100); `IsPausedState` is always false, the global dilation reads 0 in menus; the camera transform works with `api.$out`; miniaudio plays beside Wwise on an 8-channel device. Open: step 8 (following a change of output device) was skipped.

### S1 Play

[Source](sound.md#s1-play-results). Last run 2026-10-16, REDnode 0.24.0. **Pass but pan**, fixed in 0.24.1. Needs a Sandevistan for step 11. Uses **Sound test** 0.2.0.

1. Load a save. **Music (OGG)**: fades in over 1.5 s, loops every 8 s without a gap or click; the list shows it.
2. With music on: **Beep (WAV)**, **Chime (FLAC)**, **Voice (MP3)**: each plays once over the music.
3. **Voice +12 semitones** (an octave up, twice as fast), **Chime left**, **Chime right** (left ear, then right), **Beep in 2 s**.
4. **Music quieter**, then **Music louder**: fades down over a second and back.
5. Pause menu, then the map: the music stops and goes on from where it was.
6. Settings: **Music volume** to 30: the music is quieter. **Sound effects volume** down, **Chime (FLAC)**: quieter. Put both back.
7. **Master volume** to 30, **Beep (WAV)**: ours and the game's sound drop by about the same. Put it back.
8. **Mute in background** on, Alt+Tab with music on: silent in the background, plays again on return.
9. **Stop all**: fades out over half a second; "Nothing playing".
10. **Music (OGG)**, then switch Sound test off: the music stops.
11. A Sandevistan: note "global dilation" and "V's dilation".

Showed: pan did nothing on the 8-channel HDMI device (miniaudio pans only a stereo mix); a sound started in a menu waits for it to close; the Sandevistan sets the global dilation to 0.3 for 2 to 3 s while V's stays 1. Open: the scanner's slow motion (not the global dilation; the player suspects one of their mods); following a change of output device.

### S1 check, 0.24.1

[Source](sound.md#s1-check-rednode-0241). Last run 2026-10-16, REDnode 0.24.1. **Pass**, with step 2 passed in a retest the same day.

1. Load a save, Sound test on. **Chime left**, **Chime right**, **Chime (FLAC)**: left only, right only, both. The plugin log: `mixed in stereo to the front pair`.
2. Press **Beep (WAV)** first (0.24.1 reads the volumes only after a sound has played; 0.24.2 also at each save load). Settings: **Music volume** to 30, close the menus, wait 5 s: the overlay log reads `music 30` with the others at 100. Put it back: `music 100`.
3. Hold the scanner: note "V's dilation".

Showed: the volume reads follow each slider. Step 3: the scanner did not slow time in that run.

### Editor channel (#17)

Built 2026-10-27 in REDnode 0.43.0 (`packages/overlay/editor.js`; docs: overlay-apps.md, "Editor tools"). Checked in the mock game (scratchpad `editor/check.mjs`, 15 checks: editor.json written, token, Origin and Host refused, info, play, play with no entity, stop one and all, errors). Can run in the same session as H3b.

0. Test timer: Start, Mark after each step.
1. Load a save and stand still. Tell Claude. Claude reads `%LOCALAPPDATA%\REDnode\editor.json` and calls `GET /editor/info`: `connected: true`. Mark.
2. Claude plays `ui_jingle_quest_new` (the new-quest jingle): heard once. Mark.
3. Claude plays `q114_sc_03c_laptop_alarm_loop` on V: a laptop alarm beeps over and over. About 10 s later Claude stops it with `sound.stop`: it stops. Mark.
4. Press Esc (pause menu) and Esc again, back into the game; Claude plays `ui_jingle_quest_new` again: heard. Mark.
5. Quit the game. `editor.json` stays (the game ends the host at once); a call to its port is refused.

Claude sends each sound about 15 s after the player's message, so the player can switch back into the game first: the game mutes when it is not in front, unless its background mute is off. The menu click (`ui_menu_onpress`) and the advert music (`amb_bl_g_adverts_music`) of the first steps were too quiet to tell from the game's own ambient sound.

**First run, 2026-10-29: passed** (dev PC, game 2.5, REDnode 0.45.0). Step 1: `connected: true`. Step 2: the menu click was sent twice (once with the game in the background, which mutes it) and not told apart from the ambient sound; the new-quest jingle was heard. Step 3: the advert music was not clearly heard and was stopped by `sound.stop`; the laptop alarm loop was heard and stopped. Step 4: the jingle heard after the pause menu. Step 5: after the quit, `editor.json` stayed and a call to its port was refused. The host log has one `Editor: played the sound event ...` line per call. #17 closed.

### Roles (#20)

Built 2026-10-28 in REDnode 0.44.0. Its steps are on the Mod services page: [Roles test](services.md#roles-test). Can run in the same session as the editor channel and H3b.

**First run, 2026-10-29: passed** with REDnode 0.45.0 (all eight steps).

### EDGEmat's tools (E1)

Built 2026-10-29 in REDnode 0.45.0, with REDagent 0.3.3. Checked outside the game (scratchpad `e1/check.cjs`, 21 checks). Its steps are on the MCP page: [EDGEmat's tools: test](mcp.md#edgemats-tools-test).

**First run, 2026-10-29: passed** (step 6 after asking REDagent first: the Tools Manager showed EDGEmat only once its server had started; 0.45.1 starts it from the Tools Manager). Host log: `EDGEmat tools: edgemat 0.3.1 started in 133 ms, 10 tools`, the Tools Manager's off and on switches, no `server ended` before the quit.

### Shared keys: the store (K1)

Built 2026-10-29 (`tools/keys/keys.mjs`, [Shared keys](keys.md)). No in-game test: no REDnode part uses it until K2. `node tools/keys/check.mjs` runs 30 checks against a scratch folder with made-up keys: a key written and read back, files made by PowerShell's own `ConvertFrom-SecureString` read and ours decrypted by PowerShell, the cache and a replaced key, the environment variable winning, an undecryptable file counting as unset, the "used by" record holding names only, bad ids and keys refused, and the non-blocking forms.

**First run, 2026-10-29: all 30 passed** on the dev PC (a PowerShell start about 1 s; cached reads under 1 ms). The real store in `%APPDATA%\Edgemodders\keys` was not touched.

### Shared keys: the Keys view (K2)

Built 2026-10-29 in REDnode 0.46.0: a **Keys** line in the launcher's Settings drawer opens the Keys view in its place (`rednode:host:keys` in main.js, launcher and Mod Manager only; the library in the host's `resources/keys`). Checked in the mock game (scratchpad `k2/check.mjs`, 23 checks against a scratch key folder with made-up keys: Set, the prefix refusal, an other service by id, Unreadable here, Used by, Remove pressed twice, the key never in the page, the list answer or the host log, other pages refused). Your keys go into the real store, `%APPDATA%\Edgemodders\keys`. No permission switch is involved: the launcher is REDnode's own.

0. Test timer: Start, Mark after each step.
1. Load a save. Press F10, open the gear (Settings), and press **Open** on the **Keys** line. The drawer's title is **Keys**, with four lines: Anthropic, Google Gemini, OpenAI, ElevenLabs. Note what each shows (Not set, or dots and 4 characters for a key already saved). Mark.
2. On a service you have a key for (Google Gemini if you have one): **Set**, paste the key with Ctrl+V, press Enter. The box closes, the line shows dots and the key's last 4 characters, and a note says every EDGE tool now uses it. Mark.
3. On Anthropic: **Set** (or **Replace**), type `hello`, press Enter: refused with "Anthropic keys start with sk-ant-", and nothing is saved. Press **Cancel**. Mark.
4. In **Other service id**, type `test-key` and press Enter: a `test-key` line, Not set. **Set** it to `abc123456789`: it shows `•••• 6789`. Mark.
5. On `test-key`, press **Remove**: it asks "Remove for all tools?". Press it again: Not set. Mark.
6. Press **‹ Settings**: the settings are back. Open **Keys** again, then close the drawer with ✕ and open the gear: it opens on Settings. Mark.
7. Tell Claude. Claude reads the store outside the game with a plain Node process (`keyInfo`: the last 4 characters only, never the key) and checks it matches step 2, that `test-key` is gone, and that the host log has `Keys: ... set` lines with no key in them. Mark.

#### Results, 2026-10-30 (laptop, 0.47.0): passed

Every step passed, with the ElevenLabs key in step 2, in one session with the world flag test. The host log has `Keys: elevenlabs set`, `test-key set`, `test-key removed`, and no key. Run on the laptop, so step 7's reading of the store was done by the player.

| Finding | Changed in 0.47.1 |
|---|---|
| After Enter, about a second passes (the encryption through PowerShell) with the box still there and editable, before the line shows the key (the player's note) | The box goes and the line says "Encrypting the key…" until it is saved; "Removing the key…" for Remove |
| The host log also has `Keys: abc123456789 set` and `removed`: the test key's value typed under **Other service id** became a service, so its file name and the log line carried it. A real key pasted there would be saved under its own text | Other service id refuses what looks like a key (over 24 characters, `sk-`, `sk_` or `AIza` in front, six digits in a row, or mixed case with digits) and clears the box; the host refuses saving under one too |

#### Keys retest on 0.47.1

0. Test timer: Start, Mark after each step.
1. Keys: **Set** a key on any line, paste it, press Enter. The box goes at once and the line says "Encrypting the key…", then shows the dots. Mark.
2. In **Other service id**, type `sk-test-1234567890` and press Enter: refused with "That looks like a key, not a service id", and the box is empty. Then `my-tool`: a `my-tool` line, Not set. Mark.
3. **Remove** the key from step 1 (twice): "Removing the key…", then Not set. If it was a real key you want to keep, Set it again. Mark.

Result, 2026-10-30 (laptop, 0.47.1): **passed**, every step.

### Shared keys for packages (K3)

Built 2026-10-30 in REDnode 0.48.0, with REDagent 0.4.0. REDnode 0.48.1 (asked for by the user the same day) opens Keys as its own drawer beside Settings rather than in its place, 340 pixels wide and as tall as Settings, with the launcher's window 1040 pixels wide (checked in the mock game: scratchpad `kd/shot.mjs`, 8 checks). A package lists `"keys:<service>"` in its `permissions`; `secrets.shared` reads the key once the player allowed it, and `secrets.askShared` opens REDnode's own **Key request** window (`packages/overlay/keyask`), where the player allows the package and pastes a missing key or moves the key the package offers. Checked in the mock game against a scratch key folder with made-up keys (scratchpad `k3/check.mjs`, 20 checks: null before allowed, the window's text, an empty Allow refused, Encrypting, the key to the mod and the store, the window closed, no window once allowed, the offer moved and the own copy deleted, Deny, an unlisted key refused, another page refused, no key in the host log; `k3/redagent-check.mjs`, 8 checks of REDagent's **Set up the key**). The **Keys test** sample uses a made-up service, `rednode-test`, so your real keys are not touched until step 8.

0. Test timer: Start, Mark after each step.
1. Load a save. In the Mod Manager, switch on **Keys test**. Leave its permission (**your rednode-test key**) off: the Key request window grants it. In its window press **secrets.shared**: the log says `shared: null`. Mark.
2. Press **secrets.askShared**. REDnode's **Key request** window opens over the game: "Keys test asks to use your rednode-test key", "For the Keys test", and a box. Press F10, then **Allow** with the box empty: "Paste your rednode-test key first". Type `rnt-typed-key-ab12` and press **Allow**: "Encrypting the key…", then the window closes and the Keys test logs `askShared: a key ending in ab12`. Mark.
3. Press **secrets.shared**: `a key ending in ab12`. In the Mod Manager, the Keys test's permission is now on. Mark.
4. In Settings, **Open** on the Keys line: Keys slides out on the right of Settings, which stays, both the same height. A `rednode-test` line shows `•••• ab12` and "Used by Keys test". **Remove** it (press twice). Then its ✕ closes only Keys; open it again, and the gear closes both. Mark.
5. In the Keys test, press **Keep an own key**, then **Ask, offering it**: the window says "Keys test kept its own rednode-test key (•••• 7k3q)" with **Move and allow**. Press it: the log says `a key ending in 7k3q; own copy deleted`, and Keys shows `rednode-test` with `•••• 7k3q`. Mark.
6. In Keys, remove `rednode-test` again. Press **secrets.askShared**, then **Deny**: `askShared: null`, and nothing is saved. Mark.
7. Press **secrets.shared("openai")**: refused with `does not ask for "keys:openai"`. Mark.
8. REDagent 0.4.0 (its permission **REDnode's tools** already on). If REDagent kept a key from 0.3, ask it a question: the Key request window offers to move it (its last 4) with **Move and allow**; press it, and REDagent answers. If it had none: press **Set up the key**, paste your Anthropic key, **Allow**. Keys then shows Anthropic set, "Used by REDagent". Mark.
9. Tell Claude. Claude reads the host log: one `asks for` and one answer line per ask, `Granted keys:...` lines, and no key in it. Mark.

### Resizable windows and the Mod Manager (0.49.0)

Asked for by the user on 2026-10-30. A package's manifest can say `"resizable": true` (with `minWidth` and `minHeight`): the UI kit's `rn-window` then shows a grip in its bottom-right corner, the host resizes the page (`windowAction('size')`), and the plugin's new `window.size` command resizes the window in the game, keeping its top-left corner and answering `moved`, so the size is saved with the position. The Mod Manager is the first: resizable down to 720 by 400, rows a page follow its height, columns resize by their header edges (the column on the right, or Name, gives the room; Name keeps 120 px and the table scrolls sideways), and the details slide shut to the right with the tab beside them. Widths and the shut details are kept in the page's storage. The Mod log gets a close button. Checked in the mock game (scratchpad `mm/check.mjs`, 21 checks, driving the grip and the column edges with DevTools mouse events) and in `windows_test.cpp`. Unverified: how the grip feels in the game, where the plugin sends moves to the page a button was pressed in, also outside its edges.

0. Test timer: Start, Mark after each step.
1. In the launcher, open the **Mod Manager**. Its bottom-right corner shows a grip of three short lines. Drag it right and down: the window grows with the cursor, and the table shows more rows a page. Drag it as small as it goes: it stops at 720 by 400, Name stays readable and the table scrolls sideways. Mark.
2. Drag the window by its title to another spot, then resize it again: its top-left corner stays put. Close it (✕) and open it again from the launcher: the same place and size. Mark.
3. In the table's header, drag the line at the right edge of **Kind** to the right: Kind widens and Status narrows by the same, and the sort does not change. Drag the right edge of **Name** to the left: Name narrows and Kind widens. Mark.
4. Press the **›** tab between the table and the details: the details slide shut to the right and the table takes the room; the tab shows **‹**. Close and open the Mod Manager: the details are still shut and the columns as you left them. Press **‹**: the details slide back. Mark.
5. In the title bar, **Reset position and size** (an icon, or under ⋯): the window goes back to the middle of the screen at its first size. Mark.
6. In the launcher, open the **Mod log**: its title bar has ✕. Press it: the Mod log closes and its switch in the launcher goes off. Mark.

### A respawn keeps the moved place (#27)

Built 2026-10-30 in REDnode 0.49.0 for EDGEbuilder's [#27](https://github.com/Edgemodders/REDnode/issues/27). After an archive swap, a package's spawns that use a swapped file are spawned again; until 0.49.0 they came back where they were first spawned. Now `world.move` keeps the new place in the spawn's options, and the respawn reads the entity's place in the game first (`GetWorldPosition`, `GetWorldOrientation`), so an entity moved by physics or a script comes back where it is too; the kept options are the fallback. The host's respawn of assistants' (MCP) spawns does the same. Checked with a stand-in host (scratchpad `w27/check.mjs`, 7 checks). The World objects test 0.2.3 adds **Move** (the newest spawn, 2 m east, turned a quarter).

Files: `E:\Modding\Cyberpunk 2077\Projects\H2c_swap\v1\zzz_rednode_box.archive` (the box) and `...\v2\zzz_rednode_box.archive` (the box's mesh holding a barrel). H3b's run left v2 in `archive\pc\mod`, so the prop may start as a barrel.

0. Test timer: Start, Mark after each step.
1. Load a save in a quiet open spot outdoors. In the launcher, switch on **World objects test** and its **Allowed** switch for swapping archives, and open the **Mod log**. Mark.
2. Press **Spawn a prop**: a cardboard box (or a barrel) appears 2 m ahead, to V's right. Mark.
3. Press **Move**: it jumps 2 m east and turns a quarter. Mark.
4. In **4. Swap**, paste v1's full path and press **Swap**. Expected: the Mod log says one world entity refreshed (spawned again), and the box stands **where Move put it, turned the same way**, not at its first spot. Mark.
5. Press **Move** again, then swap v2's full path: a barrel, at the new place and heading. Mark.
6. Switch **World objects test** off (its spawns go), then quit the game. Remove `zzz_rednode_box.archive` from `archive\pc\mod`.

### The world flag and game text (#25, #26)

Built 2026-10-30 in REDnode 0.47.0 for EDGEmobile's requests. **#25:** `game.state().world`, true only while V is in the world. The plugin turns it on with a player past the main menu after `PlayerPuppet.OnGameAttached`, and off at the main player's `OnDetach` (a new wrap in `REDnode.reds`), so a load from the pause menu turns it off at its start. While it is off, `rtti.call` refuses global and static functions that take a `GameInstance`, except `GetPlayer` and `GetSettingsSystem`. **#26:** `script_ref` arguments in `api`, and `loc.text` (the bridge's `loc.text`, through the game's `GetLocalizedText`). The scripts compiled with redscript-cli against 2.5's `final.redscripts`, with and without Codeware 1.21.0 (0 errors in REDnode's files). Checked in the mock game (scratchpad `w25`): before the plugin's first `ui-state` a mod sees `mainMenu: true, world: false`, `onState` gets each change of `world`, and `loc.text` answers one key and an array. The guard and `script_ref` are in the plugin, so only this test checks them. Everything is typed in the **Console** (launcher, **Console**), which has the whole `rednode` package; no permission switch is involved: the Console is REDnode's own.

0. Test timer: Start, Mark after each step.
1. Start the game and wait for the main menu. F10, open the **Console**, type `(await game.state()).world` and press Enter: `false`. Mark.
2. Type `await api.GameInstance.GetWeatherSystem(game.instance)`: refused with "V is not in the world yet: GetWeatherSystem reaches the game's world, ...", and the game goes on. Mark.
3. Type `await loc.text(["LocKey#10947", 10963, "LocKey#1"])`: `["Watson", "Little China", null]` (the last could be another text if the game knows key 1). Then `await api.GetLocalizedText("LocKey#10963")`: `"Little China"`. Mark.
4. Load a save. Type `(await game.state()).world`: `true`. Then `await (await api.GameInstance.GetWeatherSystem(game.instance)).GetRainIntensityType()`: a name such as `"NoRain"`. Mark.
5. Type `await loc.text(await (await tweakdb.record("Districts.Watson", "District")).LocalizedName())`: `"Watson"`. Mark.
6. Open the inventory, look at V's preview, close it. Type `(await game.state()).world`: still `true`. Mark.
7. Open the pause menu and load another save (or the same one). After it loads, `(await game.state()).world` is `true` again. Mark.
8. Exit to the main menu. `(await game.state()).world` is `false`. Mark.
9. Tell Claude. Claude reads the plugin log: in order, `world off` while the game started, `world on` after the first load, `V left the world (OnDetach)` at the start of step 7's load, `world on` after it, `V left the world` or `world off` at step 8, no "stayed in the world for 10 s" line, and no `crashed inside the game`. Mark.

#### Results, 2026-10-30 (laptop, 0.47.0): passed, with findings

Run on the laptop's game 2.5 (2560 x 1440, about 37 fps), REDnode 0.41.0 with the 0.47.0 update zip over it, Admin Tools 0.1.0, in one session with the K2 test and the 0.45.1 check; the Test timer's 15 marks match the session's steps.

| Step | Result |
|---|---|
| 1 to 3 | **Pass.** `world` false at the main menu; GetWeatherSystem refused and the game went on; `loc.text` and `api.GetLocalizedText` gave the district names. The Console showed the refusal as `Uncaught:` with no message (the player's note: "truncated") |
| 4 to 7 | **Pass.** `world` true in the save; the rain read; Watson from its record; still true after the inventory |
| 14, 15 | **Pass.** True after a load from the pause menu, false at the main menu |
| Log | `world off` from the first poll (09:55:53, no player, IsPreGame true) until the first load; `world on` within 0.2 s of each `OnGameAttached`; no "stayed 10 s" line; no `crashed inside the game` |

Findings:

| Finding | Cause | Fixed in |
|---|---|---|
| No `V left the world (OnDetach)` line at any load or at the main menu: at the pause menu's load `world` went off only with the player (`main menu on (player no, IsPreGame false)`, 10:06:40). So between the start of a load and the player going, `world` was still true | The wrap sent its event only when `GetPlayer` still gave the puppet; the likeliest reading is that the game lets go of its player first (unverified) | 0.47.1: it also sends it when the game has no player (value 2), and REDnode's own scriptable system sends `REDnode.SessionEnd` from its `OnDetach`; either turns `world` off and is logged with its reason |
| The Console showed `Uncaught:` for the refusal | Node's evaluator writes `Uncaught:` on a line of its own when the error's line is longer than 80 characters; the Console kept only that line | 0.47.1 (the Console's `cleanError`); reproduced and checked in the mock game |

#### World flag retest on 0.47.1

0. Test timer: Start, Mark after each step.
1. At the main menu, in the Console: `await api.GameInstance.GetWeatherSystem(game.instance)`. The whole message shows in red: "Error: V is not in the world yet: GetWeatherSystem reaches the game's world, ...". Mark.
2. Load a save. Open the pause menu and load a save again. Mark.
3. Exit to the main menu. Mark.
4. Tell Claude. Claude reads the plugin log: `V left the world (...)` at the start of step 2's load and at step 3, each before `world off` or with "world was already off", then `world on` after the load. Mark.

Result, 2026-10-30 (laptop, 0.47.1, run with the Keys retest): **passed.** The Console showed the whole message. In the plugin log:

| Moment | What came |
|---|---|
| Load from the main menu (11:02:59) | `OnDetach` (value 2, no player left) and `the session ended`, world already off; `world on` 0.6 s after `OnGameAttached` |
| Load from the pause menu (11:04:04.880) | `V left the world (OnDetach, no player left)` turned world off; `main menu on (player no)` came 0.3 s later (11:04:05.180), when the game thread ran again; `the session ended` 29 ms after OnDetach; `world on` with the next `OnGameAttached` |
| Exit to the main menu (11:05:06.008) | The same: OnDetach first, the poll 0.28 s later |
| Quit (11:05:27) | Both, world already off |

So the game lets go of its player before `PlayerPuppet.OnDetach` runs (value 2 every time, never 1), and it runs on one of the game's worker threads, not the game thread. While the load holds the game thread, no call runs; but a call queued then would have run in the first frame after it, before the poll saw no player: 0.47.0 would have let it reach the game, 0.47.1 refused it. 0.47.2 keeps the event's side to atomics (the plugin read the player on that worker thread in 0.47.1) and lets the poll, on the game thread, do the rest; a short check of it (a load from the pause menu, the same log lines) rides with the next in-game test.

## Game 2.5

### G1 REDnode on game 2.5

Built 2026-10-25: REDnode 0.38.0, the first build for game 2.5 (RED4ext.SDK at its 2.5 revision, the sound patterns checked on the 2.5 exe, the game API from a 2.5 dump). One pass over every part, on the laptop and then on the dev PC.

Before: the game at 2.5, with RED4ext 1.31.0, redscript 0.5.32, Codeware 1.21.0, TweakXL 1.12.0 and ArchiveXL 1.28.0 (Cyber Engine Tweaks 1.38.0 if wanted). No RED Hot Tools: it has no 2.5 build, so hot swaps are left out of this test. The sample apps are all in the deploy; the Sound Tools pack's apps are copied in beside them.

Already seen on 2026-10-25 (the dev PC's 2.5 dump run, base game): RED4ext 1.31.0 loaded REDnode 0.38.0, the host connected, Present was hooked on a 3840 x 2160 SDR swapchain, the main menu and the language were read.

1. Start the game. At the main menu, F10: the launcher shows; its Settings drawer shows Version 0.38.0. The Mod Manager opens.
2. Load a save. Switch on **Vitals** and **Coords**: health and the position show and change as V moves.
3. Switch on **Ink Coords** and **Ink vitals**: the game draws them on its HUD. Open the inventory and close it: they hide with the HUD and come back.
4. **Quest test**: **Read**, then **Set +1**: the watcher logs the change. **Tracked** reads the tracked quest entry.
5. **TweakDB test**: **Read**, then **Change**; switch it off: the change is undone.
6. **World test**: **Spawn box** near V, **Spin 10 s**, **Remove**.
7. **Sound test**: **Chime left**, **Chime right**, **Music (OGG)**, **Stop all**.
8. **Sound Tracer** (Sound Tools): start a trace, walk and fire a weapon: rows come in. ▶ on a row with recordings plays it; G posts it through the game.
9. **Sound Search** (Sound Tools): search `katana`, play a result. The names come from REDbridge (0.10.0, built for 2.31): if it cannot read 2.5's files, the search finds nothing, which is a REDbridge finding, not a REDnode failure.
10. **Counter service** and **Counter panel** on: **+1**, **Read**, **Wait 3 s**.
11. **Pointer lock test**: lock, move the mouse, Esc ends it.
12. Tell Claude: it checks the MCP tools against the running game (`game_state`, `game_image`, `api_read`, `tweakdb`, `gameapi_lookup`).
13. Load the save again: the Ink apps come back. Quit to the desktop: no crash.

Expected: every step as written; in the plugin log no `fault`, no `not found` for a pattern, and the Sound Tracer's hook attached; no REDnode errors in `r6/logs/redscript_rCURRENT.log`.

#### G1 results

**Pass** on the dev PC on 2026-10-25 (REDnode 0.38.0; game 2.5 at 3840 x 2160 SDR; RED4ext 1.31.0 with ArchiveXL 1.28.0, Codeware 1.21.0 and TweakXL 1.12.0; REDagent 0.3.1 installed). The player: "It all seemed to work". A mark for each step from 1 to 11.

| Part | What the logs showed |
|---|---|
| Load | The four plugins loaded; REDnode's four scripts compiled with no errors |
| Main menu | Read on (IsPreGame true) and off; the language read as en-us |
| Ink | Ink Coords (3 widgets) and Ink vitals (15) built on the HUD; 5 bindings at about 58 us a frame (2.2 ms in the first second, while the sources are found); after the reload of step 13 both rebuilt, 3 of 3 and 15 of 15 |
| Sound | The sound pak tables found in 93 ms; the Sound Tracer's hooks attached on 2.5 (PostEvent at `+0x1b30e90`, the sound lookup at `+0x78bde8`); 924 posts, 890 loads, none dropped |
| REDbridge | 0.10.0 (WolvenKit 9.1.0, built for 2.31) read 2.5's 57 archives and gave 17,586 event names, so Sound Search found results |
| MCP (step 12) | `game_state`, `perf` (68 fps; the overlay about 0.1 ms CPU and 0.03 ms GPU a frame), `game_image` (4K with the overlay), `api_read` (a system, then a TweakDB record's method), `tweakdb` (a record, 1,384 vehicle records) and `gameapi_lookup` (2.5's signatures) |
| Quit | The pump stopped, the audio output stopped, the host disconnected, REDnode unloaded; no fault log |

Errors seen, neither from 2.5:

- **World test** crashed at 11:54:59: Remove was pressed while Spin ran, and the next move read the removed box. World test 0.1.1 ends a spin when its box is removed.
- **Sound Tracer** and **Sound Search** logged `Cannot read properties of undefined (reading 'trim')` while typing. The browser's own `input` event from the box inside `rn-input` (and `rn-slider`) crossed the shadow root, so a page's `input` handler ran twice, once with no `detail`. The search still worked through the kit's event. The UI kit now stops the browser's event at the box.

#### G1 retest, 0.38.1: results

**Pass** on the dev PC on 2026-10-25 (REDnode 0.38.1, same setup), a mark for each step. Steps: the version in the launcher's Settings drawer; type `katana` in Sound Search letter by letter; start a Sound Tracer trace and type in its filter; World test: Spawn box, Spin 10 s, Remove during the spin; quit. The host logged no page errors; the World test logged `Spin stopped: the box was removed` and kept running; the game quit cleanly, with no fault log.


## Adding a test

When a phase's test runs for the first time, add it here: a row in the table, then its steps with the expected result, what it showed and what is open, with a link to its source section in the phase's page. Keep the steps runnable with the current build; when a later version changes a step, say so in the step.
