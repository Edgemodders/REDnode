# World API

Status: **W1 passed in game on 2026-10-13** ([results](#w1-results)). W2 is planned, after overlay phase O9. Phases W1 and W2 answer requests from [EDGEbuilder](https://edgemodders.github.io/EDGEbuilder/design.html), the world builder, filed as [`request` issues](https://github.com/Edgemodders/REDnode/issues?q=is%3Aissue+label%3Arequest). Order agreed with the user on 2026-10-13: REDagent's C5 test, then **W1**, then overlay phase O9 Debugger, then **W2**.

EDGEbuilder places objects in the running game: an empty entity spawned through Codeware, with a mesh, light or other component attached while it assembles. The `api` in the `rednode` package can call any game function and read properties ([Overlay apps: the game API](overlay-apps.md#the-game-api)), but it cannot yet build objects, write properties, pass resource references or hear an entity assemble.

## W1 World API

For EDGEbuilder's phase B1 (browse and drop) and B2 (position).

| Piece | Request | Plan |
|---|---|---|
| `api.$new(className, props?)` | [#1](https://github.com/Edgemodders/REDnode/issues/1) | The plugin builds any native object by class name and returns a game reference, like any object `api` returns. `props` sets properties first, with the same type checks function arguments get. A plain struct comes back as its value |
| `ref.$set(prop, value)` | [#1](https://github.com/Edgemodders/REDnode/issues/1) | Writes one property of a game object, type checked like `$get` reads |
| Resource references | [#3](https://github.com/Edgemodders/REDnode/issues/3) | Where a function or property expects a resource reference (`rRef`, `raRef`, `ResRef`), a path string (`"base/.../crate_a.mesh"`, hashed the way the game hashes depot paths) or a hash string is accepted. Reading one gives the hash; turning a hash back into a path needs an asset index, which REDbridge has |
| Entity callbacks | [#2](https://github.com/Edgemodders/REDnode/issues/2) | A small redscript part of REDnode, active only when Codeware (1.14 or later) is installed, turns Codeware's `Entity/Initialize` and `Entity/AfterAttach` (alias `Entity/Attached`) callbacks into REDnode events for the entities a mod watches (not every entity in the world, which would flood the pipe) |
| `api.spawn(...)` | [#2](https://github.com/Edgemodders/REDnode/issues/2) | A helper on top: spawns an entity through Codeware with a template, transform, appearance and components to attach, and resolves when it is attached. Hides the timing from every mod that places things |
| Per-frame budget | [#1](https://github.com/Edgemodders/REDnode/issues/1) | Measure `api` round trips per game frame in game. Add `api.$batch([...])` only if one call per frame is tight |

**Codeware, researched 2026-10-13** from its source at tag v1.20.5 (the latest) and its wiki. Codeware is MIT. The user's game has it installed.

| Fact | Source | Consequence for W1 |
|---|---|---|
| `GameInstance.GetCallbackSystem().RegisterCallback(eventName, target, function)` returns a handler with `AddTarget(...)`, `SetRunMode(...)`, `SetLifetime(...)`, `Unregister()` | `scripts/Callback/CallbackSystem.reds`, `CallbackSystemHandler.reds` | REDnode's redscript part registers from a `ScriptableSystem`, where callbacks stay registered until unregistered |
| Lifecycle order: `Entity/Extract`, `Entity/Assemble` (no entity ID yet), `Entity/Initialize` (ID assigned), `Entity/Reassemble`, `Entity/Attach` (may fire more than once), `Entity/AfterAttach`, `Entity/Detach`, `Entity/Uninitialize` | wiki "Game events"; `src/App/Callback/Controllers/` | |
| **`Entity/Attached` is deprecated:** it is now an alias of `Entity/AfterAttach` | `EntityAttachHook.hpp` | REDnode names the event `Entity/AfterAttach` and accepts `Entity/Attached` as an alias, since EDGEbuilder asked for that name |
| `Entity/Initialize` is dispatched before the entity gathers its components, so `Entity.AddComponent(component)` there is picked up. Codeware's wiki warns components must be added "at the right moment, for example, when entity is assembled" | `EntityRequestComponentsHook.hpp`; wiki "Components" | `api.spawn` attaches the components in `Entity/Initialize` |
| Targets by ID or tag match only once the entity has an ID, which it lacks at `Entity/Assemble` | `DynamicEntityTarget.Matches` | Watch with `EntityTarget.ID(...)` or `DynamicEntityTarget.Tag(...)` from `Entity/Initialize` on. **Unverified in game** |
| `GameInstance.GetDynamicEntitySystem().CreateEntity(spec) -> EntityID`; `DynamicEntitySpec` has `recordID` or `templatePath`, `appearanceName`, `position`, `orientation`, `tags`, `persistState`, `persistSpawn`, `alwaysSpawned`, `spawnInView`, `active`; `GetEntity(id)`, `IsSpawned(id)`, `DeleteEntity(id)` | `scripts/World/DynamicEntitySystem.reds`, `DynamicEntitySpec.reds` | `api.spawn` builds the spec from its options and tags its entities, so the callbacks target only REDnode's |
| `entMeshComponent` has `mesh` (`raRef<CMesh>`), `meshAppearance`, `visualScale`, plus Codeware's `LoadAppearance()` | `scripts/Base/Addons/MeshComponent.reds` | The resource reference support (#3) sets `mesh` from a path |
| Minimum versions: the handler API and targets 1.9.0, `Entity/AfterAttach` 1.14.0. The redscript module is `Codeware`; `Codeware.Require(version)` checks at run time | `git log` of the repo; `scripts/Facade.reds` | REDnode's redscript part needs Codeware 1.14 or later and compiles only when it is installed. The exact `@if(ModuleExists(...))` syntax is redscript's: **to confirm** |
| No Codeware example spawns an entity with a mesh component attached; the nearest adds a mesh to the player | wiki "Components", "Spawning dynamic entities" | Spawn, attach in `Entity/Initialize`, and the mesh appearing is what the W1 test proves |

**Codeware stays optional** (agreed with the user on 2026-10-13). REDnode itself never needs it: `$new`, `$set` and resource references are plain REDnode plugin code. Only the entity events and `api.spawn` use Codeware. Their redscript part is compiled only when Codeware is installed; without it, those calls fail with a clear message ("needs Codeware 1.14 or later"), and a package that uses them says so with W2's `requires`. Rebuilding Codeware's entity hooks inside REDnode would duplicate a maintained MIT library and risk the two clashing in players' games.

**The test proves:** a mod spawns a crate in front of V, with its mesh set by path, moves it every frame without dropping frames, and removes it; the entity events arrive for it and only it.

### W1: built

| Piece | Where |
|---|---|
| `rtti.new`, `rtti.set` | `native/src/overlay/reflect.cpp`. An object made by `rtti.new` is held by its reference (references are otherwise weak) until released or a save loads |
| Resource references | `reflect.cpp`: a path is hashed with the SDK's `ResourcePath::HashSanitized`, the game's own clean-up and hash; an `rRef` starts loading when set. Scripts' `ResRef` (`redResourceReferenceScriptToken`) reads and writes as the reference itself |
| Codeware part | `native/scripts/REDnodeWorld.reds`, compiled only with Codeware (`@if(ModuleExists("Codeware"))`): a `ScriptableSystem` registers `Entity/Initialize`, `Entity/AfterAttach` and `Entity/Detach` for entities tagged `REDnode`, or watched by ID. `Spawn` gives each spawn its own tag too, which keys its components, so they are added in that entity's `Entity/Initialize` and no other. `Delete`, `Move` (Codeware's `Entity.SetWorldTransform`) and `Watch` |
| Events | A native `REDnode_EntityEvent(name, entityID, entityType)` queues them; the plugin sends them as game events with `entityId` and `entityType`. The entity itself is not sent: game events go to every mod and page, and references are counted per hand-out |
| Package | `api.$new`, `ref.$set`, and `world` (`packages/rednode/src/world.ts`) |
| Sample | `packages/overlay/apps/world-test` |
| Plugin | 0.15.0 |

Checked before the game: both scripts compile with the redscript compiler (v1.0.0-preview.22) against the game's own script bundle, with Codeware's scripts and without them; the check found and fixed two errors (`OnAttach` must be public, and `EntityID.GetHash` gives only 32 bits, so the event takes the `EntityID` itself). The package's `world.spawn`, `move`, `remove`, `$new` and `$set` pass a check against a fake game. The plugin builds and its unit tests pass. **Not checked before the game:** building objects, writing properties, resource references and the Codeware part, which only the game can run.

### W1 test

Use the **Test timer**: Start, then Mark after each step. At the time of this test the World test used World Builder's empty entity and box (`base\spawner\...`). Since REDnode 0.17.1 it uses only base-game assets ([#6](https://github.com/Edgemodders/REDnode/issues/6)): the bare `suitcase_small_placeholder.ent`, a textured cardboard box (`cardboard_box_a_closed.mesh`, since 0.18.1: the level-design kit's box rendered black) and the kit's marker mesh.

1. Close the game. Deploy REDnode. Start the game and load a save. Check `r6/logs/redscript_rCURRENT.log` compiled without errors (REDnode's scripts are in it). Mark.
2. F10, Mod Manager: switch **World test** on. Its window says "World API ready (Codeware found)". Mark.
3. Face an open spot and press **Spawn box**. A box appears about 3 metres in front of V; the window says how long it took, and the events `Entity/Initialize` and `Entity/AfterAttach` appear for it. Mark.
4. Press **Spin 10 s** and watch: the box circles for 5 seconds one move at a time, then 5 seconds ten at a time. The window shows the moves per second each way. Mark.
5. Press **Remove**: the box goes, and `Entity/Detach` appears. Mark.
6. Press **Next mesh**, then **Spawn box**: the base game's marker mesh this time. Remove it. Mark.
7. Quit the game. I read the moves per second against the plugin's frame rate in its perf lines, to answer EDGEbuilder's per-frame question.

### W1 results

**2026-10-13: passed.** REDnode 0.15.0, Codeware installed. The scripts compiled in the game. World test spawned World Builder's empty entity with a mesh component built by `api.$new` with its mesh set by path, in 254 to 257 ms from the click; the box appeared in front of V. `Entity/Initialize` and `Entity/AfterAttach` arrived for it, and only for it. `world.remove` removed it, and `Entity/Detach` arrived. The base game's marker mesh worked the same way.

| Measure | Result |
|---|---|
| Spawn to in the world | 254 to 257 ms |
| Moves, one after another (each awaited) | 30 a second at 30 fps: one call a frame, since a call's answer comes the frame after it runs |
| Moves, ten at a time | 302 a second at 30 fps: every call waiting when a frame starts runs in that frame. So `api.$batch` is not needed: send the calls without awaiting each one. The game thread takes at most 256 waiting calls a frame |
| Frame rate | 53 to 61 fps before and after, **30 fps during the 10 seconds of moves**. Unknown yet whether the moves cost it (a few ms can halve the rate under vsync) or something else: the plugin did not time game calls. **Added in 0.15.1:** the perf line gives game calls a second and their milliseconds a frame |

| Finding | Notes |
|---|---|
| World test's window did not show until Restart | The plugin drew at most 16 windows, and refused the 17th (World test's) with only a line in its own log; 17 were open with the samples, mods and built-in apps. **Fixed in 0.15.1:** up to 64 windows, and a refused window is reported in the host's log |

## W2 Packaging

| Piece | Request | Plan |
|---|---|---|
| `requires` in the manifest | [#5](https://github.com/Edgemodders/REDnode/issues/5) | `"requires": { "codeware": ">=1.16", "archivexl": ">=1.23" }`. The host checks the RED4ext plugins and redscript modules installed in the game; the Mod Manager shows what is missing next to the package, and the package can read the result |
| `kernel.bridge()` | [#4](https://github.com/Edgemodders/REDnode/issues/4) | How to reach a running REDbridge, behind a `bridge` permission the player grants, like `kernel.mcp()`. The host finds the copy EDGEdeck or REDcode already fetched and starts it on demand. REDbridge stays its own GPL-3.0 program, reached over JSON-RPC |

**The test proves:** a package that requires something missing says so in the Mod Manager, and a package with the `bridge` permission lists the game's archives through REDbridge.

### W2: built

REDnode 0.17.0. How to use both: [Requirements](overlay-apps.md#requirements) and [The game's files through REDbridge](overlay-apps.md#the-games-files-through-redbridge).

| Piece | Where |
|---|---|
| Game folder scan | `packages/overlay/gamefiles.js`: RED4ext plugins with their DLL file versions (read from the version resource, three parts; the fourth is a build number some plugins fill with a date that overflows), redscript modules, CET mods, and RED4ext, CET and redscript. Rescanned at most every 30 seconds. The host finds the game folder from its own place (`<game>/red4ext/plugins/REDnode/host`), or `--game` |
| `requires` | Checked in the manifest (a bad range is a manifest error). The Mod Manager: **NEEDS** next to the name, the list under **Requires**, and the Errors filter. The launcher: a "Needs ..." line. A Node mod's log: a line at each start. The MCP `apps` tool: each package's `requires`. `kernel.requirements()` in the `rednode` package |
| REDbridge | `packages/overlay/redbridge.js`: finds `REDbridge.exe` (`REDBRIDGE_EXE`, then the newest copy in EDGEdeck's or REDcode's storage in VS Code, VS Code Insiders, VSCodium, EDGEkit or Cursor), starts it with `--game` on the first call, and speaks Content-Length framed JSON-RPC on its stdio. One process for every package; it stops after 10 minutes without calls, and exits by itself if the host dies (its stdin closes). `DOTNET_ROOT` is set for it only when .NET 10 is per-user |
| `kernel.bridge()` | The `bridge` permission. `kernel.bridge()` resolves with `{ version, source, call(method, params) }`, or rejects with why (not allowed, or not installed and how to get it). The Mod Manager shows where REDbridge was found |
| Sample | `apps/packaging-test`: requires Codeware, ArchiveXL and `not-a-real-mod`; lists and searches the archives |

Tested in the mock game, with the real game folder: Codeware 1.20.3 and ArchiveXL 1.27.3 found, `not-a-real-mod` missing, shown in the table, details, the mod's window and its log. After **Allowed**, the first call started REDbridge 0.5.1 from REDdeck's copy, which loaded 57 archives and 583,798 files in 2.8 seconds; a search found 7 files. No REDbridge was left running after the host closed. **Unverified:** REDbridge reading the archives while the game runs.

### W2 test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Mark.
2. F10. In the Mod Manager, find **Packaging test** (it is new, so use the **New** filter or search). It shows **NEEDS**. Select it: under **Requires**, Codeware and ArchiveXL have a tick with their versions and `not-a-real-mod` is crossed out. The **Errors** filter lists it too. Mark.
3. Switch it on. Its window lists the same three lines. Mark.
4. In its details, under **Permissions**, the line says where REDbridge was found. Switch **Allowed** on. Mark.
5. In the Packaging test window, press **Archives**: after a few seconds it says 57 archives and about 584,000 files. Press **Search**: it lists files named `player_ma_tpp`. Mark.
6. Check the theme change from 0.16.1: in the launcher pick **EDGE**, then open a window debugger (Developer mode's bug button): its title bar is yellow. Switch back to the theme you like. Mark.
7. Quit the game.

### W2 results

**Result, 2026-10-14: passed.** REDnode 0.17.0. Every step worked, the 0.16.1 theme check included.

| Check | What the logs show |
|---|---|
| `requires` | The Packaging test showed NEEDS, with Codeware and ArchiveXL ticked and `not-a-real-mod` missing; its log line said so at each start |
| `kernel.bridge()` | REDnode picked the newest copy it found, REDdeck's REDbridge 0.6.0, and started it with the game folder: 57 archives and 583,798 files loaded in 3.0 seconds **while the game ran**, which W2 had marked unverified. The Packaging test listed them twice and found 7 `player_ma_tpp` files |

| Finding | Change |
|---|---|
| ArchiveXL counted as installed, "version unknown", though its folder held only logs and Vortex's marker after a purge ([#9](https://github.com/Edgemodders/REDnode/issues/9), found by the EDGEbuilder session) | REDnode 0.17.1: a RED4ext plugin counts only when its folder holds a DLL; RED4ext's own log confirms it loads nothing else (after the purge it loaded exactly the two folders with a DLL, Codeware and REDnode). A folder without one is "not installed", with a note that it is left over from an uninstall |
| Plugins whose DLL has no version resource (REDnode's own, audioware, RedData) read "version unknown" | REDnode 0.17.1: the version each plugin reported to RED4ext, from RED4ext's newest log, while the DLL is unchanged since |

Also in REDnode 0.17.1, from EDGEbuilder's requests: the World test sample uses only base-game assets ([#6](https://github.com/Edgemodders/REDnode/issues/6)), and a saved window position applies only while the window keeps the size it was saved with ([#8](https://github.com/Edgemodders/REDnode/issues/8)). Positions saved before 0.17.1 have no size and are ignored once.


## W3 REDbridge for players

Agreed with the user on 2026-10-17, as REDnode 0.25.0, right after the Polish and EDGEdeck test (0.24.4). Today REDnode only finds a REDbridge that EDGEdeck or REDcode fetched in VS Code, so a player without VS Code who installs a mod that uses `kernel.bridge()` gets "not installed" and no way forward. W3 lets REDnode fetch REDbridge itself, with the player's OK, from inside the game.

| Piece | Plan |
|---|---|
| **Get REDbridge** in the Mod Manager | Where a package needs REDbridge and none is found, a button replaces the red error. It says what it does before anything happens: "Downloads REDbridge 0.10.0 (58 MB) from GitHub, and the .NET 10 runtime if it is missing. No admin rights." Then a progress bar, and the package's line turns to "REDbridge 0.10.0 from REDnode" |
| Download | The latest release of Edgemodders/REDbridge, asset `REDbridge-<version>-win-x64.zip`, into `%LOCALAPPDATA%\REDnode\bridge\<tag>\`. Checked against the SHA-256 GitHub gives for the asset before it is unpacked; a mismatch deletes it and says so |
| .NET 10 | Only when no .NET 10 runtime is found: Microsoft's `dotnet-install.ps1`, runtime only, for this Windows user, the way EDGEdeck does it. Never machine-wide, and never a user-level `DOTNET_ROOT` (it broke Vortex's .NET check for EDGEdeck); the host already sets `DOTNET_ROOT` for the REDbridge process alone |
| Lookup | `findRedbridge` adds REDnode's own folder after the setting and `REDBRIDGE_EXE`, beside EDGEdeck's and REDcode's copies; the newest version still wins. The source reads `REDnode` |
| Updates | When REDbridge starts, the host asks GitHub once a session for a newer release; the Mod Manager offers **Update REDbridge**. Never automatic |
| `requires` | `"requires": { "redbridge": ">=0.10" }` in a manifest, checked like the game's plugins, so the Mod Manager shows the need, and the button, before the mod runs. `kernel.requirements()` reports it |
| MCP and messages | The "not installed" messages point to the Mod Manager's button first, EDGEdeck and REDcode second. The MCP `apps` tool shows where REDbridge is |

Not in W3: REDbridge in the REDnode zip (58 MB more, plus .NET, for players who never use it), and REDbridge as its own Nexus mod (it would still need .NET from elsewhere; maybe later, for Vortex users).

**The test proves:** on a Windows user with no REDbridge and no .NET 10, a package that needs REDbridge shows the button; one click fetches both, and the package lists the game's archives. The test needs a second Windows user, or the dev PC's EDGEdeck and REDcode copies moved aside and .NET 10 hidden, to start from nothing.

### W3: built

REDnode 0.25.0, built on 2026-10-17. Also in it: the launcher's **Tooltips** switch (on by default; off, the UI kit draws no `title` tooltips in any window), asked for by the user after the Polish test.

| Part | Where |
|---|---|
| Download, SHA-256 check, unpacking (Windows' `tar.exe`, else `Expand-Archive`), .NET 10 per user with `dotnet-install.ps1`, removing REDnode's older copies | `packages/overlay/bridge-install.js` |
| Lookup: REDnode's own copies with the others, newest wins, a tie goes to REDnode's; .NET checked before REDbridge starts; `dotnet` in the status | `packages/overlay/redbridge.js` |
| The job (one at a time, its steps and bytes sent to the Mod Manager four times a second at most), the update offer, `redbridge` as an installed `requires` entry, the messages | `packages/overlay/main.js` |
| **Get REDbridge**, the progress bar, **Try again**, **Update REDbridge to ...**, under the package's REQUIRES when it names REDbridge, else under its bridge permission | `packages/overlay/manager/app.js` |
| The Packaging test sample asks for `"redbridge": ">=0.10"` (sample 0.2.0) | `packages/overlay/apps/packaging-test` |

GitHub is asked for the newest release only: when a package needs REDbridge and none is found (once a session, so the button names the version and size), when the player presses the button, and once a session after the first REDbridge call (for **Update**).

**The clean test switch:** `"bridgeTest": "clean"` in the host's `settings.json` (`%APPDATA%\@rednode\overlay`), set by hand. The lookup then sees only REDnode's own copy and the .NET check only a per-user runtime, as on a PC without VS Code or .NET. Remove it after the test.

Checked before the game:

| Check | Result |
|---|---|
| The install, with `LOCALAPPDATA` pointed at an empty folder | GitHub's v0.10.0 (58 MB) downloaded, matched its SHA-256 and unpacked; a wrong SHA-256 was refused and the file deleted; .NET 10 installed per user with no admin rights; REDbridge started from REDnode's copy on that runtime and listed the game's 583,798 files |
| The Mod Manager in the mock game, clean, from nothing | REQUIRES showed `redbridge >=0.10` missing, the text "REDbridge 0.10.0 (58 MB)" and **Get REDbridge**; pressed, it showed each step and a progress bar, and 8 s later `✓ REDbridge >=0.10 · 0.10.0 installed` and "REDbridge 0.10.0 from REDnode" |
| The launcher in the mock game | The **Tooltips** switch, on |
| The packaged host (the build the game starts), in the mock game with the game's arguments | The same Get REDbridge run, 8 s; this check found `bridge-install.js` missing from the packager's file list (`tools/overlay/package-host.mjs`), fixed before the commit |
| **Update REDbridge** | **Unverified**: it needs an older copy and a newer release |

### W3: test

Before the game: REDnode 0.25.0 deployed, and `"bridgeTest": "clean"` in the host's settings. On a PC without .NET 10 for this user, step 2 really installs it into `%LOCALAPPDATA%\Microsoft\dotnet` (about 70 MB) and REDbridge into `%LOCALAPPDATA%\REDnode\bridge`.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save, press F10, and start the timer. In the Mod Manager, select **Packaging test**. Under REQUIRES: ✕ `redbridge >=0.10` not installed, "REDbridge is not installed", a line naming REDbridge 0.10.0 (58 MB), and **Get REDbridge**. Mark.
2. Press **Get REDbridge**. The steps show: downloading with a bar, then .NET 10. Within a minute: ✓ `redbridge >=0.10 · 0.10.0 installed` and "REDbridge 0.10.0 from REDnode". Mark.
3. Switch the Packaging test off and on again in the Mod Manager. Its window lists the game's archives. Mark.
4. In the launcher, switch **Tooltips** off and hover a title-bar icon: no tooltip. Switch it on again and hover: the tooltip shows. Mark.
5. Quit the game.

The host log should have `REDbridge: the newest release is 0.10.0`, `matches GitHub's SHA-256`, `installing the .NET 10 runtime`, `ready, 0.10.0 from REDnode`, `REDbridge 0.10.0 starting from REDnode`, and `Tooltips: off`, `Tooltips: on`.

**First run, 2026-10-17: steps 1 and 2 passed; 3 and 4 not proven.** REDnode 0.25.0, with the timer, marks matching the steps. The Mod Manager showed the missing REDbridge and the button; pressed, the host logged the release, the SHA-256 match, the .NET 10 install into `%LOCALAPPDATA%\Microsoft\dotnet` and `ready, 0.10.0 from REDnode` within 7 s, and the Packaging test then read `OK REDbridge >=0.10 0.10.0`. But:

| Step | What the logs showed |
|---|---|
| 3. The archives | REDbridge never started: the sample only starts it on its **Archives** button, which the step did not say to press |
| 4. Tooltips | `Tooltips: off` was logged, `Tooltips: on` was not, and the setting stayed off. Off and on again both worked in the mock game |
| The sample's window | One missing requirement painted every line red, the OK ones too. Packaging test 0.2.1 shows the OK lines in the normal colour |

### W3: retest

REDnode 0.25.0 with Packaging test 0.2.1, still with `"bridgeTest": "clean"`. Tooltips are off from the first run.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save, press F10, and start the timer. The Packaging test window: the OK lines in the normal colour, only `MISSING not-a-real-mod` in red. Mark.
2. Press **Archives** in the Packaging test window. Within a few seconds it reads "REDbridge 0.10.0 from REDnode" and lists the archives. Mark.
3. Hover a title-bar icon: no tooltip (they are off). In the launcher, switch **Tooltips** on, then hover the icon again: the tooltip shows. Mark.
4. Quit the game.

The host log should have `REDbridge 0.10.0 starting from REDnode` and `Tooltips: on`.

**Result, 2026-10-17: passed.** All steps, marks matching. The host started `REDbridge 0.10.0 starting from REDnode` from `%LOCALAPPDATA%\REDnode\bridge\v0.10.0` on the per-user .NET 10; it loaded 57 archives and 583,798 files in 3.6 s, and the sample logged `REDbridge: 57 archives, 583798 files`. `Tooltips: on` was logged and saved. With the first run, **W3 passed**. The test switch was then removed from the settings; the normal lookup picks REDnode's copy (a tie in version with EDGEdeck's 0.10.0 goes to REDnode's). Still **unverified**: **Update REDbridge**, which needs a newer release than the copy in use.

## Hot-loading archives (#12)

Asked for by EDGEmat and EDGEfab ([#12](https://github.com/Edgemodders/REDnode/issues/12)): seeing a changed asset in the running game without a restart. Agreed with the user on 2026-10-17: try RED Hot Tools first; if it gives trouble, REDnode's own.

**RED Hot Tools** (psiberx, MIT; 1.3.0-rc.2 of 2026-07-12, last commit 2026-07-29; its README still names game 2.21) watches `archive/pc/hot`. When an `.archive`, `.xl` or `.yaml` file arrives there, it waits half a second for more, then on its own thread unloads only the archives of the same name (wherever they are mounted: `archive/pc/mod` or another mod folder; a new one goes to `archive/pc/mod`), moves the new files over them, loads them, drops the cached resources they hold (ink widget libraries are swapped in place), and calls `ArchiveXL.Reload()`. Its log is `red4ext/plugins/RedHotTools/RedHotTools-<date-time>.log`, ending each swap with `Archives reload completed.` (read from its source, `src/App/Archives/ArchiveLoader.cpp`). Its script class `RedHotTools` also has `ReloadArchives()`, `ReloadResources(paths)` and `HotInstall(path)` (a copy into the hot folder); its own CET menu leaves `ReloadArchives()` unused and relies on the folder, as WolvenKit's Hot Reload does.

| Phase | What |
|---|---|
| H0 Try it | RED Hot Tools 1.3.0-rc.2 in the dev game: it loads on 2.31, and an archive copied into `archive/pc/hot` reloads without trouble |
| H1 `archives.reload` | In the `rednode` package and as an MCP tool: copy the named archives into the hot folder, have RED Hot Tools swap them, return `{ reloaded, failed, via, ms }`. `requires` can name RED Hot Tools |
| H2 `world.refresh` | Respawn or re-apply the appearance of objects using a reloaded mesh or material, V's clothing included |
| Fallback | The same swap in REDnode's plugin, if H0 fails or RED Hot Tools stops being kept up |

Installed on the dev PC on 2026-10-17 from its GitHub release (`RedHotTools-1.3.0.zip`, SHA-256 checked): `red4ext/plugins/RedHotTools` and `bin/x64/plugins/cyber_engine_tweaks/mods/RedHotTools`. Deleting both removes it; it makes `archive/pc/hot`.

### H0 and Welcome: test

REDnode 0.25.1 deployed, with RED Hot Tools. Nothing to set by hand; the dev PC has never closed the Welcome window, so it opens.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game. At the main menu the Welcome window shows in the centre, with **Showing** lit and "Press F10 to use the mouse here". Press F10: **Using** lights up. Press **Got it**: it closes. Then load a save, switch on the Test timer, press **Start**, and **Mark**.
2. In the launcher's list, switch **Welcome** on: it opens again. Close it with its ✕. **Mark**.
3. Alt+Tab and tell me you are in the game. I copy `EDGEmat_M0_probe.archive` (EDGEmat's probe, 24 KB) unchanged from `archive/pc/mod` into `archive/pc/hot`; RED Hot Tools should swap it within a second. Go back to the game, play for half a minute, and **Mark**.
4. Quit the game.

Then: RED4ext's log should list RedHotTools as loaded, RED Hot Tools' log should have `Archives reload completed`, the host log `Welcome: closed`, and nothing should have crashed.

### H0 and Welcome: results

Run on 2026-10-18 on the user's laptop (the release zip of REDnode 0.25.1 with the Test timer added, RED Hot Tools installed there), not the dev PC: three starts. **Pass**, from what the user saw, the plugin logs of all three starts, the Mod log and the host log (`rednode-overlay.log` holds only the last start), and RED Hot Tools' logs of all three starts (sent the next day). RED4ext's log was not read.

| Start | What the logs show |
|---|---|
| 21:29, first run | The Welcome window opened at the main menu; F10 to interactive at 21:30:19; a press on it at 21:30:39 (**Got it**). No save was loaded: the main menu stayed on, so the timer's **Mark** 1 (00:02) and 2 (01:05) were made there, and step 2 reopened Welcome from the launcher (a new 600 x 500 window) and closed it. The game left the front at 21:31:52, the frame pump ran on at the main menu, and the plugin log ends at 21:36:04 with no "pump stopped". RED Hot Tools' log shows the swap of `TraumaTeamCutscenes.archive` starting at 21:36:07 and stopping after "Loading updated archives...": no "Resetting resource cache", no "Archives reload completed". The game died while loading that archive. A scene mod whose other parts were no longer installed, the user's own poor first pick |
| 21:45, retest | Steps renumbered (1 load and Start, 2 swap, 3 quit). A save loaded at 21:46:43; **Mark** 1 at 21:47:36; out of the game from 21:47:37 to 21:48:17 to copy a single archive known to work into `hot` (it left the folder). RED Hot Tools swapped `###_nim_material_override.archive` at 21:47:53, all steps through "Archives reload completed", in 113 ms, on its watcher's thread. A minute of play; **Mark** 2 at 21:49:26 and an extra **Mark** 3 at 21:49:29; "Game thread pump stopped" at 21:49:49, a clean quit. RED Hot Tools' warnings about `box_occluder.w2mesh` came at 21:47:11, before the swap, so the swap did not cause them |
| 21:52 | The main menu, then a clean quit at 21:53:08. Welcome did not open: the host opened the launcher and the timer only. No swap |

What it means:

- RED Hot Tools 1.3.0-rc.2 swaps an archive in a loaded save on game 2.31, and the game runs on and quits cleanly. H1 (`archives.reload`) can build on it.
- The Welcome window works as built: once, then only from the launcher.
- The first crash came during the swap itself, in RED Hot Tools' step that loads the new archive (its log stops there). The swap ran at the main menu, not in a save, with a mod missing its other parts. Unverified whether the main menu, the broken mod or both made it crash. H1 refuses swaps at the main menu, and its docs warn that a broken mod can crash the game at a swap even if it loaded at start.
- A good swap took 113 ms in RED Hot Tools. H1 calls it on the game thread, so expect the game to stop for about that long: a short stutter. Unverified until the H1 test.
- On quitting from the main menu the plugin logs `could not read IsPreGame; the main menu is only "no player"` once, as the game tears down: harmless, but it could be quieter.

### H1 `archives.reload`: built

REDnode 0.26.0. Agreed with the user on 2026-10-18 after reading RED Hot Tools' source: drive RED Hot Tools through its script call rather than its folder alone, so the answer says what happened, and add checks and a queue around it. Our own swap in the plugin stays the fallback: it would mean finding the engine's archive and resource internals again after every game patch, which RED Hot Tools' author already does.

| Piece | What it does |
|---|---|
| `packages/overlay/main.js` | `reloadArchives`: checks the caller (a package with the `archives` permission granted, or the MCP server), the files (a path, or a name in `archive/pc/mod`; `.archive`, `.xl`, `.yaml`; no two of the same name), the game (connected, not at the main menu) and RED Hot Tools (`RedHotTools.Version()` answers). Copies each file into `archive/pc/hot` under a temporary name and renames it, so RED Hot Tools never sees half a file, then calls `RedHotTools.ReloadArchives()` on the game thread with a 60-second limit. A file still in the hot folder afterwards failed, and is removed so it is not swapped later. If the call fails, it waits up to 10 seconds for RED Hot Tools' folder watcher instead. One swap at a time. Each swap is logged in the host log and the package's Mod log |
| `packages/rednode/src/archives.ts` | `archives.reload(files)`, for Node mods and pages |
| `packages/overlay/mcp.js` | The MCP tool `archives_reload` |
| `apps/hot-test` | Hot swap test 0.1.0: a field for a name or path, **Swap**, and the answer; asks for `archives`, requires `redhottools` |

Checked in the mock game, with a stand-in RED Hot Tools that moves the hot folder's files into the mod folder: refused at the main menu; a name in `archive/pc/mod` and a full path swapped, the second waiting for the first; a missing file, a `.txt` and two files of one name refused; RED Hot Tools missing refused with where to get it; a failing call answered from the folder watcher's swap; the Hot swap test swapped with the permission and was refused without it.

Unverified until the game: that `RedHotTools.ReloadArchives()` works when called on the game thread (RED Hot Tools' own menu calls only `ArchiveXL.Reload()`), and how long it holds the game's frame.

Later, agreed the same day: open the archive with REDbridge before a swap when REDbridge is installed, to refuse a corrupt one; and keep the replaced archive, with `archives.restore()` to put it back after a bad swap.

### H1 test

REDnode 0.26.0 deployed, with RED Hot Tools. In the launcher, switch on **Hot swap test**. Under it, the line "Asks for swapping archives in the game's mod folder..." has an **Allowed** switch: switch it on too. That is the permission; the swap itself is step 2. Pick a small archive in `archive/pc/mod` that you know works, with no `.xl` file and no required mods; the steps call it `Plain.archive`.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save. Switch on the Test timer, press **Start**, and **Mark**.
2. In Hot swap test's field type `Plain.archive` and press **Swap**. It answers "1 swapped in N ms". Watch for a stutter at the swap. **Mark**.
3. Type `Nope.archive` and press **Swap**: it answers that the file was not found. **Mark**.
4. Play on half a minute. **Mark**.
5. Quit the game.

Then: the host log has `Archives: hot-test swaps Plain.archive (RED Hot Tools ...)` and `1 reloaded in N ms`, RED Hot Tools' log in its plugin folder has `Archives reload completed.`, `archive/pc/hot` is empty, and nothing crashed.

### H1 test: results

Run on 2026-10-19 on the user's laptop (the 0.26.0 player zip with the Test timer and Hot swap test added, RED Hot Tools 1.3.0). **Pass**, from the plugin log, the host log, the Mod log and RED Hot Tools' log. The archive was `###_nim_material_override.archive`, given as a full path.

| Time | What happened |
|---|---|
| 06:48:51 | A save loaded |
| 06:51:04 | The first **Swap**, before the permission was on: refused with "Allow "Hot swap test" to swap archives in the REDnode launcher first". The check works. The test's "allow it to swap archives" was read as "do a swap"; the steps now name the **Allowed** switch |
| 06:51:32 | `Granted archives for hot-test` |
| 06:51:43 | The path pasted with Windows' double quotes around it: refused as the wrong file type, since the extension read as `.archive"`. Fixed after the test (commit 510334d): `archives.reload` drops quotes and spaces around a path, and the type error names the extension it saw |
| 06:54:09 | The path without quotes: "1 swapped in 71 ms". RED Hot Tools' log shows every step through "Archives reload completed." in 52 ms, on thread 10276, the game thread that runs REDnode's frame pump |
| 06:54:26 to 06:54:28 | Test timer started, **Mark** 1 |
| 06:55:06 | The same swap again: "1 swapped in 67 ms" (RED Hot Tools 49 ms). **Mark** 2 at 06:55:14 |
| 06:55:24 | `Nope.archive`: "Nope.archive was not found in archive/pc/mod". Marks 3 and 4 were not pressed |
| 06:56:27 | "Game thread pump stopped after 31271 frames": a clean quit |

What it means:

- `RedHotTools.ReloadArchives()` works when REDnode calls it on the game thread, and the answer is definite: no swap reported `failed`, and nothing stayed in `archive/pc/hot`.
- A swap holds the game's frame for about 50 ms, three frames at the laptop's 45 fps. The host's 5-second performance lines show no dip. Unverified whether the user saw a stutter.
- About 430 ms after each swap, RED Hot Tools' folder watcher fires on its own thread: it sees REDnode's copy into the hot folder, finds no archives left, and reloads ArchiveXL's extensions a second time, which takes under a millisecond. Harmless; it cannot be avoided while the swap goes through the hot folder.
- RED Hot Tools' `box_occluder.w2mesh` warnings come before and after swaps alike: the game's, not the swap's.

### H1 limit: sound paks crash a swap

Found on 2026-10-19 on the laptop (REDnode 0.26.1, RED Hot Tools 1.3.0), with `EDGEwaveTest.archive` from EDGEwave: a sound override in an opus pak. **Swapping it into a running game crashes the game, on either route; a normal install of the same archive works.**

| Run | Route | Thread | RED Hot Tools' last line | Result |
|---|---|---|---|---|
| 10:31:29 | REDcode's **Pack and Try**, which copies into `archive/pc/hot`; RED Hot Tools' folder watcher reloads | 27088, the watcher's | "Loading updated archives..." | Crash |
| 10:3x | The same archive in `archive/pc/mod`, game started normally | | | Runs |
| 10:43:19 | REDnode's Hot swap test, `archives.reload` | 23000, the game thread (REDnode's pump) | "Loading updated archives..." | Crash a second later |

What it means: the route is not the cause; loading an archive with sound paks into a running game is. Why is unverified. Plain archives swap fine on both routes; H0's other crash was a scene mod swapped at the main menu, and it also stopped at "Loading updated archives...".

More from the user's runs the same day:

- Every hot reload of an archive with opus paks crashed, through REDcode and through REDnode, and whether the game had loaded that archive at the start or not. So it is not about replacing an archive the game has open: adding sound paks to a running game is enough.
- No crash dialog appeared, and Windows' Application log has no "Application Error" or "Windows Error Reporting" entry for either crash. So the game was not ended by an unhandled fault: something in it caught the failure and ended the process.
- What RED Hot Tools does at that step (its `ArchiveLoader.cpp`, MIT): it closes and reopens the file handle of an archive of the same name, calls the game's own `ResourceDepot::LoadArchives` (the boot-time mount) for the new files, and writes the result into the depot's archive list, in place or inserted. Afterwards it refreshes only what the resource loader tracks (cached resources, ink widget libraries, ArchiveXL). Nothing tells the audio engine. The game's script API (2.31) has no function to reload or restart audio either; the only match is a test helper, `AudioFunctionalTests::IsSoundbankLoaded`.
- Hypothesis (the user's, unverified): an audio thread keeps running during the swap and reaches something the swap changed, such as a null reference. The game thread is already held during a swap through REDnode, so pausing the game loop alone does not cover the audio threads.

Agreed with the user on 2026-10-19: refuse such archives by default (H1b, below), and a research spike for a real fix: first find which thread and module fail.

### H1b: sound pak check and fault watch (REDnode 0.26.2)

Built on 2026-10-19:

| Part | What |
|---|---|
| `packages/overlay/archive-index.js` | Reads an `.archive`'s file table (RDAR header, then 56-byte entries starting with each path's FNV-1a 64 hash) without REDbridge, and finds the game's sound paks by hashing their paths: `base\sound\soundbanks\sfx_container.opusinfo` and `sfx_container_<n>.opuspak`. Checked against the game's `audio_2_soundbanks.archive`: 1,880 of them (the index and 1,879 packs, as REDcode counts), none in ep1 |
| `archives.reload` in `main.js` | Refuses an archive with sound paks: "X.archive changes the game's sound (N sound paks, such as sfx_container_42.opuspak), and swapping sound into a running game crashes it. Install it and restart the game instead." Before every swap it asks the plugin to watch for faults for 15 seconds |
| `native/src/overlay/faults.cpp` | `faults.watch`: while a watch is on, a vectored exception handler writes the first 8 faults to `red4ext/logs/rednode-faults.log` before the game's own handler sees them: the code, what an access violation read or wrote (a null reference reads an address near 0), the module and offset, the thread and its name, the stack. If the game exits through `ExitProcess` during the watch, `DllMain` writes who called it; no exit line means `TerminateProcess`. The plugin log says when a watch starts and ends, with the count. Unit tests in `native/tests/faults_test.cpp` (a real access violation) |
| `host.cpp` | The last game session's host log is kept as `red4ext/logs/rednode-overlay.prev.log`, so a crash's host log survives the next start |
| Spike settings, in `%APPDATA%\@rednode\overlay\settings.json` | `"soundPakSwap": "try"` lets sound pak archives through (with a warning in the host log). `"swapPause": "pause"` pauses the game around every swap with `TimeSystem.SetPausedState(true, "REDnode")`, waits half a second, swaps, and unpauses; unverified whether that pauses the game's audio. Remove both after the spike |

Checked in the mock game (default settings: the sound archive refused, a plain one swapped; spike settings: the sound archive swapped, the pause logged as failing, since the mock has no time system). Unverified until the game: the fault watch inside the game, and what it shows.

### H1b test

REDnode 0.26.2 on the laptop, with RED Hot Tools, Hot swap test (**Allowed** on), `EDGEwaveTest.archive` from EDGEwave (not installed in `archive/pc/mod`), and a plain archive known to swap (`###_nim_material_override.archive`). Three game runs: A with default settings, B and C with the spike settings in `%APPDATA%\@rednode\overlay\settings.json`, added while the game is closed.

Run A, default settings:

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save. Switch on the Test timer, **Start**, **Mark**.
2. In Hot swap test, paste the path of `EDGEwaveTest.archive` and press **Swap**. It is refused with "changes the game's sound ... Install it and restart the game instead", and the game keeps running. **Mark**.
3. Swap the plain archive. "1 swapped". **Mark**.
4. Quit the game. The plugin log has `Faults: watching 15 s (swap of ###_nim_material_override.archive)` and, 15 s later, `Faults: watch ended (...), 0 faults`.

Run B, the sound pak let through, with the fault watch: add `"soundPakSwap": "try"`.

0. Switch on **Test timer**, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save. Switch on the Test timer, **Start**, **Mark**.
2. Swap `EDGEwaveTest.archive`. The game is expected to crash. If it does not, **Mark** and type whether the new sound plays.
3. After the crash, send `red4ext/logs/rednode-faults.log`, `rednode-overlay.log` (or `rednode-overlay.prev.log` if the game was started again since), the crashed session's plugin log, and RED Hot Tools' log.

Run C, the same with the game paused: add `"swapPause": "pause"` as well.

0. Switch on **Test timer**, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save. Switch on the Test timer, **Start**, **Mark**.
2. Swap `EDGEwaveTest.archive`. The game pauses half a second before the swap. Crash or not; if not, **Mark** and type what the screen and the sound did.
3. The same logs as run B.

Afterwards remove both settings.

### H1b test: results

Run on 2026-10-19 on the laptop with the REDnode 0.26.2 test build, RED Hot Tools 1.3.0, the archive in `Documents` (not installed).

| Run | Time | What happened |
|---|---|---|
| A, default settings | 11:40 to 11:41 | `EDGEwaveTest.archive` refused: "changes the game's sound (2 sound paks, such as sfx_container.opusinfo) ... Install it and restart the game instead"; the game ran on. The nim archive swapped in 77 ms under a fault watch, with no faults. Marks 1 to 3 present. **Pass** |
| B, `"soundPakSwap": "try"` | 11:46 | Crash. `rednode-faults.log` has the watch's start at 11:46:17 and nothing after it: no fault of the error kind (`0xC...`) reached REDnode's handler, and no `ExitProcess` line |
| C, also `"swapPause": "pause"` | 11:49 | **No crash.** "game paused for the swap (IsPausedState true)", "1 reloaded in 29 ms", "unpaused (IsPausedState false)"; the game ran on, no faults. But drawing the katana played the base game sound, not the override |
| Afterwards | 11:51 | A last start with the archive removed from `archive/pc/mod`: the base katana sound plays. Installed before the test, the same archive had overridden the sound at a normal start |

What it means:

- H1b's refusal works, and the fault watch is quiet on a normal swap.
- Run B's ending passed REDnode's handler by: either a handler registered ahead of REDnode's ends the process at the fault, or a C++ exception (skipped by the watch as routine) ends it through `terminate`, or a fail-fast or `TerminateProcess`. Unverified which.
- Pausing the game with `TimeSystem.SetPausedState` around the swap avoided the crash (one run): what fails is something that runs while the game plays, as the user suspected, plausibly the audio engine's work.
- A clean swap does not change the sound: the audio engine evidently reads its index (`sfx_container.opusinfo`) at start and keeps it, so newly mounted paks are not used until a restart. Hearing a swapped sound would need the audio engine to reload its index, which the game's script API does not offer; it would mean reverse engineering native audio code. Unverified.
- The last start had the archive removed on purpose, to check the base sound; so nothing shows the swap broke the install. Installed normally, the archive overrides the sound.
- The user's reading (2026-10-19): with the pause, a new opus pak gets into the engine while the game runs; what remains is making the audio engine read its index again while paused. That is most likely one class and one or a few methods, found by following what reads `sfx_container.opusinfo` at start. Next step: H1c below.

### H1c: how the game loads its sound paks (research)

Found on 2026-10-19 by following the two paths in the game's code (`Cyberpunk2077.exe` of game 2.31, read with MSVC's `dumpbin`; offsets are from the image base and change with each game version). Static reading only; nothing ran in the game yet.

| Offset (2.31) | What it is |
|---|---|
| `0xA2E9FC` | The audio engine's start: Wwise's memory manager, stream manager and sound engine, each checked. Partway through it calls the opus index loader with the hash of `base\sound\soundbanks\sfx_container.opusinfo` (kept in a global set by a static initializer at `0xF8C20`) |
| `0x279ED4` | The opus index loader. It refuses if an index is already loaded (a count at `0x3495DF8`, at most 1), so calling it again does nothing. Otherwise it reads the whole file through the resource depot, checks the magic `SND ` and version `0xF0000002`, copies its tables into one 0x60-byte entry at `0x3B28FD0` (array pointers, the sound and pak counts, and two hash maps: sound hash to row, and one per pak), and opens the first N paks (N from the file's header) for good |
| `0x3A38CC0` | The open pak table: up to 2,048 entries of 0x70 bytes (count at `0x3495DFC`, a free list at `0x3496E00`): pak number, index number, a reference count, and the depot reader at +0x18 |
| `0x279890` | Looks up a sound when it plays: the sound hash through the index's hash map gives the pak number, offset and size; it reuses an open pak with that number or opens `sfx_container_<n>.opuspak` through the depot on demand and adds it to the table |
| `0x6E3740` | Releases a pak entry: drops its reader and puts the slot on the free list |

What it explains:

- The index is read once at start, from the archives mounted then. A swapped archive's `sfx_container.opusinfo` is never read, so the sound keeps the base game's offsets.
- Paks opened at start keep their readers on the archive they came from, so a sound in one of them plays the base game's data after a swap (run C's katana, plausibly). A pak opened on demand after a swap would be read from the new archive at the old index's offsets: garbage for the decoder, a plausible cause of run B's crash. Unverified which paks the katana and run B touched.

What a reload in REDnode would do, all on the game thread with the game paused: stop playing sounds; release every pak entry (`0x6E3740`) so readers on the old archives go; free the index's arrays and hash maps and set its count to 0; call the loader again (`0x279ED4`) with the same hash, which reads the new index and opens the start paks from the new archives. The functions and tables would be found by byte patterns at start, so a new game version turns the feature off (sound archives refused, as now) rather than crashing.

Next steps, agreed with the user on 2026-10-19: H1c-1, a read-only look at the index and the open pak table in the game, called before and after drawing the katana and around a paused swap, to confirm this reading without changing anything. H1c-2, the reload itself behind a spike setting, only if H1c-1 matches.

### H1c-1: sound state (REDnode 0.26.3)

Built on 2026-10-19:

| Part | What |
|---|---|
| `native/src/overlay/opus.cpp` | Bridge method `opus.state`. At its first call it finds the tables by four byte patterns in the game's code (the index loader's count check and its `SND ` header check, a sound lookup's pak count read, and the call that passes the index's path hash) and logs where: `Opus: found the sound pak tables in N ms (index count +0x..., ...)`, or what it missed. Then it reads, never writes: the index (sounds, a second table's size, a checksum of its tables) and each open pak (number, references, reader), and where the index puts given sound ids (pak, offset, size). Each call logs a summary line in the plugin log. Reads go through `__try`, so a wrong guess is an error, not a crash. Unit tests in `native/tests/opus_test.cpp` with fake code and tables; with `REDNODE_GAME_EXE` set, the test also maps the real exe and finds 2.31's five places (checked on the dev PC: the offsets above) |
| `archives.soundState(ids?)` in the `rednode` package | The same for packages; experimental, no permission needed |
| `archives.reload` in `main.js` | A sound swap let through by `"soundPakSwap": "try"` logs the state before the swap, after it and after the unpause |
| Hot swap test 0.2.0 | A **Sound state** button, with a box for sound ids; the summary goes to the Mod log |

Checked in the mock game (the three lines around a sound swap). Unverified until the game: the patterns on the laptop's game, and every reading of the layout.

### H1c-1 test

REDnode 0.26.3 on the laptop, with RED Hot Tools, Hot swap test (**Allowed** on), and `EDGEwaveTest.archive` not installed. Add `"soundPakSwap": "try"` and `"swapPause": "pause"` to `%APPDATA%\@rednode\overlay\settings.json` while the game is closed, as in H1b's run C. If EDGEwave shows the id of the sound it overrode (a number like 123456789), have it ready; without it the test still works.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save, with the katana in V's inventory but not drawn. Switch on the Test timer, **Start**, **Mark**.
2. In Hot swap test, type the sound id in the sound ids box (or leave it empty) and press **Sound state**. A line like "1 index of ... sounds, checksum 0x...; N paks open: ..." shows. **Mark**.
3. Draw the katana and put it away. Press **Sound state** again. **Mark**.
4. Swap `EDGEwaveTest.archive` (paste its path, **Swap**). The game pauses for a moment; it is expected not to crash. **Mark**.
5. Draw the katana; note in the timer which sound played (expected: the base game's). Press **Sound state**. **Mark**.
6. Quit the game. Send `rednode-mods.log`, the plugin log (`rednode-*.log` of this session), `rednode-overlay.log` and `rednode-faults.log`.

Afterwards remove both settings.

### H1c-1 test: results

Run on the laptop on 2026-10-19 (REDnode 0.26.3, game 2.31, RED Hot Tools 1.3.0). The sound id was 746693166, the katana sound EDGEwave overrode. A first try (18:34) was restarted because Alt+Tab, used to read the steps, drew the katana through a game key binding (the user remapped it). The run that counts started at 18:41. No crash; the fault watch saw no faults.

| Step | Result |
|---|---|
| Patterns | Found in 235 ms at the same five offsets as on the dev PC (`index count +0x3495df8, index +0x3b28fd0, pak count +0x3495dfc, paks +0x3a38cc0, path hash +0x3493b58`). Every read worked: the layout reading holds |
| 2. Sound state | 1 index of 73,139 sounds, checksum `0x84b342b65b6327fd`; 24 paks open; sound 746693166 in pak 881 at offset 179386 |
| 3. Katana drawn | Not read at this step (no Sound state press logged) |
| 4. Paused swap | State before the swap, after it and after the unpause: the checksum unchanged, the same 24 paks with the same readers (only pak 56's references moved, 4 to 2). Swap 50 ms |
| 5. Katana drawn | **Silent**: no sound played (H1b's run C played the base game's sound) |
| Control | The same archive installed normally and the game restarted: the new sound played. The archive is fine |

What it shows:

- **The index is never re-read.** The checksum is the same before and after the swap, as the research said. The sound still points at pak 881, offset 179386, from the base game's index.
- **Paks open on demand and close again.** Pak 881 was not open in any read, even after the katana was drawn at step 3 and before the swap. The list held 24 paks in every read (in this run and the 18:34 try), with different paks each time, and entries with 0 references stayed in it. That looks like a cache of about 24 readers that drops the oldest, unverified. The research read the first paks as kept for good; they are not, or not these.
- **Why silence.** At step 5 the game opened `sfx_container_881.opuspak` again, now from the swapped archive, and read it at the base index's offset and size. The mod's rebuilt pak has its sounds at other places, so the decoder got no valid sound there: silence this time, a crash in H1b's run B. In run C pak 881 was plausibly still open from before the swap, so the old reader played the base sound. Both unverified, but both fit.

What it means for H1c-2: the reading is confirmed. Reloading the index is the missing step, and it can be simpler than planned: reload the index, and drop the cached pak entries with no references so the next play opens them from the new archive. Entries still playing (references above 0) wait, or their sounds stop, before the reload.

### H1 quoted path: retest

Run on 2026-10-19 on the laptop with REDnode 0.26.1 (after its NVIDIA driver update). **Pass.** The path came from File Explorer's **Copy as path**, with its double quotes.

| Time | What happened |
|---|---|
| 09:29:17 | Test timer started, **Mark** 1 (a save loaded at 09:28:31) |
| 09:29:21 | The quoted path: "1 swapped in 70 ms". The host log names the bare file, `Archives: hot-test swaps ###_nim_material_override.archive`; RED Hot Tools: "Archives reload completed." in 52 ms on the game thread. **Mark** 2 |
| 09:29:36 | The quoted path with spaces around it: "1 swapped in 75 ms" (RED Hot Tools 56 ms). **Mark** 3 |
| 09:30:34 | Played on; **Mark** 4 |
| 09:30:43 | "Game thread pump stopped after 41029 frames": a clean quit |

The Mod log line repeats the path as typed, quotes included; the host and RED Hot Tools see it without them. RED Hot Tools' watcher fired its harmless second reload again, about 430 ms after each swap. The cursor lines from the same run show the arrow drawn on every frame, about 44 fps in the game, with no jumps.
