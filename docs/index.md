# RED<span class="y">node</span> docs

REDnode is a Node.js API for scripting Cyberpunk 2077 (PC, single-player). These pages track the design, the research and how to set up a machine to work on it.

## What REDnode is made of

| Part | What it does | In the repo | In the game folder |
|---|---|---|---|
| **Plugin** (`REDnode.dll`) | Runs inside the game, loaded by RED4ext: draws the overlay windows on the game's frame, takes input (F10), runs game calls on the game thread (the generic game API), sends game events, and starts the host | `native/` | `red4ext/plugins/REDnode/REDnode.dll` |
| **Plugin scripts** | Small redscript parts: the game events REDnode sends, and the world support, which compiles only when Codeware is installed | `native/scripts/` | `red4ext/plugins/REDnode/Scripts/` |
| **Overlay host** | An Electron app beside the game: renders overlay apps, runs Node mods in their processes, the kernel MCP server, the agent broker, hot reload, settings | `packages/overlay/` | `red4ext/plugins/REDnode/host/` |
| **Built-in apps** | The launcher, the Mod log, the Mod Manager and the Welcome window, inside the host | `packages/overlay/launcher/`, `modlog/`, `manager/`, `welcome/` | Inside the host |
| **`rednode` package** | The API mods and apps import: `game`, `api` (typed from the game's own data), `ui`, `world`, `agent`, `pkg`, `secrets`, `kernel`, `channel` | `packages/rednode/` | `host/resources/sdk/` |
| **UI kit** | Web components and themes for overlay apps | `packages/ui/` | Inside the host, served as `rednode://ui/` |
| **Sample packages** | Example apps and mods (Hello mod, Ask mod, World test, Test timer...). Each has its own version | `packages/overlay/apps/` | `red4ext/plugins/REDnode/apps/` |

**Versions.** REDnode has one version, shared by every part above except the samples. It is in `VERSION` at the root of the repo: the plugin's build reads it, and `node tools/version.mjs <version>` copies it into the host, the package, the UI kit and the built-in apps. `tools/build-native.ps1` stops if any part differs. The plugin's log says `REDnode <version> loading`, the host's log `REDnode overlay host <version>`, and the launcher shows it. Releases will ship the parts together as one REDnode bundle.

| Document | What it covers |
|---|---|
| [API reference](api/) | The `rednode` package: every function, interface and type, generated from the source |
| [Game API](game/) | Every class, struct, enum and global function in the base game (2.31), with REDnode's notes |
| [Design](design.html) | Architecture: the two tiers, the native bridge, the API sketch, safety rails, risks and roadmap |
| [MCP server](mcp.md) | The kernel's tools for AI agents: Claude Code can read mod logs, see overlay windows, look up game types and call the game |
| [Overlay apps](overlay-apps.md) | Guide with tested examples: your first app, UI kit windows, a native-looking button, and playing game sounds |
| [World API](world.md) | The plan for building and placing objects in the game from a package: `$new`, `$set`, resource references, entity events, `api.spawn`, `requires` and `kernel.bridge()` |
| [TweakDB API](tweakdb.md) | The plan for reading and changing TweakDB, the game's tuning database, from a package |
| [Hot swap research](hot-swap-research.md) | Research toward a swap that every user of an archive's files picks up at once, worn clothing included: what a swap does today, the crashes of 2026-10-22, the engine's pieces, phases HP0 to HP5 |
| [Sound API](sound.md) | The plan for REDnode's own audio engine: a package's audio files in the game, following its volume and pause, on entities |
| [HTML overlay](overlay.md) | Design of the overlay: how it works, in-game test results, and the plan for phases O1 to O9 |
| [P0 findings](p0-findings.md) | How RED4ext loads plugins, the plugin entry points, and what that means for the bridge |
| [Tests](testing.md) | Every test so far, automated and in the game: how to run it again, what to expect, and what it showed |
| [P1 results](p1-results.md) | The in-game probe test: what passed, the logs, and when `OnGameAttached` fires |
| [Dev setup](dev-setup.md) | Every tool and step needed to build and test REDnode on a new machine |

## Roadmap status

| Phase | Status |
|---|---|
| P0 Research | RED4ext side done. Cyber Engine Tweaks analysis deferred |
| P1 Proof | Done. Passed in game on 2026-10-11. See [P1 results](p1-results.md) |
| HTML overlay | O1 to O6 passed in game: Node mods run beside overlay apps, and `api` calls any game function, typed. O8 Mod Manager (a table of every package, Pin to launcher, Pin to HUD) passed in game. O9 Debugger (DevTools for apps and Node mods, in the game; Developer mode) passed in game. Then O7 Display. See [HTML overlay](overlay.md) |
| REDagent | An in-game assistant, powered by Claude, that writes, runs and fixes REDnode mods with the player. C1, the [kernel MCP server](mcp.md) in this repo, and C2, the chat in the game, passed in game. C3, authoring, passed in game. C4, chat history and a picture of the game's screen (`game_image`), passed in game. C5, other mods asking REDagent (`agent.ask`), passed in game. Its [guide](https://edgemodders.github.io/REDagent/), repo and design: [Edgemodders/REDagent](https://github.com/Edgemodders/REDagent) |
| World API | Planned: W1 (build objects, set properties, resource references, entity events through Codeware, `api.spawn`) and W2 (`requires` in manifests, `kernel.bridge()`), asked for by EDGEbuilder. W1 and W2 passed in game. W3, REDbridge for players (the Mod Manager's **Get REDbridge** fetches it and .NET 10 per user, no VS Code needed), passed in game on 2026-10-17 (REDnode 0.25.0, with the launcher's **Tooltips** switch). #12 hot-loading archives: H0, RED Hot Tools in game 2.31, passed on 2026-10-18 (REDnode 0.25.1, with the Welcome window); H1 `archives.reload` (a package call and an MCP tool driving RED Hot Tools) passed in game on 2026-10-19 (REDnode 0.26.0, and 0.26.1 with a quoted path). H1d, swapping sound archives into the running game (the audio held, the game's sound index loaded again), passed in game on 2026-10-19 (REDnode 0.26.8). H2 (what V wears shows a swapped archive): after the RED Hot Tools lookup fix (the Edgemodders build), H2b refreshes worn clothing after each swap with no button, Equipment-EX's slots included; passed in game on 2026-10-22 (REDnode 0.26.20 and 0.26.21). H2c, things in the world (NPCs, props, with EDGEbuilder), comes after the ink API. See [World API](world.md) |
| Window layers | O10: a tool layer for REDnode's own windows and packages allowed `front`, and solo mode (`ui.solo`). Passed in game. See [HTML overlay](overlay.md#o10-layers-built) |
| Native game UI | Proposed on 2026-10-18; scheduled on 2026-10-21 right after H2 `world.refresh`, before the Sound API's S2: an `ink` API and tags over the game's own UI widgets (ink), drawn by the engine rather than the overlay, plus screens: open and switch the game's menus (inventory, character, cyberware) and build new ones. The plugin keeps and applies each package's tree; Tier 2 describes it; Tier 1 comes later, for frame drawing (animations and cosmetic effects each frame). Phases I1 to I6. The I1 spike (the Ink test app and `REDnodeInk.reds`) passed in game on 2026-10-22 (REDnode 0.27.2). Codeware is required. I2a, the driver and the first `ink` API with the Ink Coords sample, passed in game on 2026-10-22 (REDnode 0.28.0). I2b, layout and the game look from the game's own style sheet, passed in game on 2026-10-22 (REDnode 0.29.0). I2c, bound game values and lists from data, passed in game on 2026-10-22 (REDnode 0.30.1). I2d, text in the player's language, is built in REDnode 0.31.0 and awaits its in-game test. See [Native game UI](ink.md) and [the design doc](design.html#ink) |
| Localization | Proposed on 2026-10-18, not scheduled: the game's language for text, Windows' regional format for numbers and dates, `t()` with package `locales/` files, `LocKey#` strings, plurals and V's gender forms, everywhere REDnode shows text. Phases L1 to L3. See [Localization](localization.md) |
| Console | O12, proposed: a CET-style console for free-form JavaScript with the `rednode` package ready, in the HUD style. See [HTML overlay](overlay.md#o12-console-plan) |
| Pointer lock | EDGEbuilder's request #11: the web's Pointer Lock API in overlay pages, the cursor held by the plugin. Passed in game. See [HTML overlay](overlay.md#pointer-lock-built) |
| Polish 0.24.2 | Partly passed in game on 2026-10-17 (0.24.4): tooltips failed and HUD widgets showed on the boot loading screen, the rest passed. 0.24.5 crashed the game at the title screen (a weak handle taken as strong); 0.24.6 passed the main menu and the switch's tooltip; 0.24.7 fixes the title-bar tooltips (Chromium skipped pointerover into the icons) and passed in game on 2026-10-17: **Polish done** (tooltips through shadow roots with a trace, the main menu by `IsPreGame()`). Built: tooltips drawn by the UI kit (the browser's never showed in the game), the Mod Manager showing tool windows in every space, an **Open at start** switch in the launcher, volume reads at each save load. 0.24.4 adds REDbridge from EDGEdeck (#13). See [Polish 0.24.2](overlay.md#polish-0242-built) |
| Spaces | O11: named sets of windows the player switches between, like virtual desktops, and title-bar actions with overflow. Passed in game. See [HTML overlay](overlay.md#o11-spaces-built) |
| Sound API | Sound Tools (an optional app pack, SP1 to SP4): SP1 and SP2, the **Sound Tracer** (every event the game posts and every sound it loads, live, each playable), passed in game on 2026-10-20 (REDnode 0.26.14), and SP3, **Sound Search** (every game sound event by name, tag or id, with a Scratch tab), the same day (0.26.15); SP4, the pack itself (its own zip, Hot swap for players), passed the same day over the released REDnode 0.26.15: the pack is ready for its first release. S1 Play passed in game on 2026-10-16 (REDnode 0.24.0) and its pan fix for surround devices in 0.24.1: packages' own WAV, OGG, MP3 and FLAC files, following the game's sliders, pausing in menus (`audio` in the rednode package). The S1 research spike passed in game on 2026-10-16 (REDnode 0.23.1); the scanner's slow motion is still to find. Planned: REDnode's own engine in the plugin (S1 play, S2 space, S3 effects and voices, S4 game events), clean room from Audioware's docs. See [Sound API](sound.md) |
| TweakDB API | T1 (read, from the plugin) passed in game. T2 (write through TweakXL, with undo per package) passed in game. T3 (offline through REDbridge) waits for REDbridge's TweakDB methods. See [TweakDB API](tweakdb.md) |
| P2 Tier 2 | Mostly covered by overlay phase O6: the pipe bridge, the Node SDK and the generated game API. Events from hooked game functions are still to do |
| P3 Rules | Not started |
| P4 Tier 1 | Not started |

Source code and issues: [github.com/Edgemodders/REDnode](https://github.com/Edgemodders/REDnode)
