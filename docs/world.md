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

### H1c-2: the sound index reload (REDnode 0.26.4)

Agreed with the user on 2026-10-19 after H1c-1. More reading of the 2.31 exe first, on who touches the tables:

| Offset (2.31) | What it is |
|---|---|
| `0x6E490C` (thunk `0x6E4904`) | The pak tick: takes finished reads, looks up new sounds (`0x279890`), issues reads (`0x6E4B40`), drops references (`0x6E4AAC`). The audio start registers it as a Wwise global callback at the end of each audio frame (location `0x40`). So the pak table and the lookups belong to the **audio thread**, with no lock: a change from the game thread would race them |
| `0x1ACBCC0` | RegisterGlobalCallback (callback, location bits, cookie, ...): takes a lock, appends to the location's list. Returns 1 on success |
| `0x1AD1AE0` | UnregisterGlobalCallback (callback, location bits): takes the same lock, unlinks and frees |
| `0x6E3740` | Not a plain release: the cache's eviction. When more than 10 entries have no references, it drops the one used longest ago. That is the cache of about 24 paks H1c-1 saw |
| `0xA2D398` | The loader's hash map setup: clears the map and allocates new storage; the old storage is not freed |

The paks the loader opens at start keep one reference forever, and a lookup takes the first entry with the pak's number. So old entries would hide new ones unless they are retired.

Built on 2026-10-19:

| Part | What |
|---|---|
| `native/src/overlay/opus.cpp` | At the first reload, finds RegisterGlobalCallback and UnregisterGlobalCallback by the audio start's registration of the pak tick and the shutdown's unregistration (two patterns; both are needed, or nothing is registered), and registers REDnode's callback at location `0x40`: it runs right after the pak tick, on the audio thread, every audio frame, and does nothing unless a reload was asked. The reload: every pak table entry gets pak number `0xFFFE` (no lookup matches it; idle ones are then evicted by the cache as usual, playing ones finish on their old reader); the index count goes to 0; the game's own loader runs again with the same path hash, so it reads the swapped `sfx_container.opusinfo` and opens its start paks. If the loader refuses the file, or anything faults (`__try`), the old index entry, its count and the pak numbers go back. The old index's memory (about 2.5 MB) is not freed. Bridge methods `opus.reload` (ask) and `opus.reloadStatus` (waiting, running, done with the result, or cancel). The callback is unregistered when the plugin stops |
| `main.js` | `"soundPakSwap": "reload"`: a sound archive is swapped with the game paused (whatever `swapPause` says), then the host asks for the reload and polls until it is done, or cancels it after 3 s. Logged: the state before the swap, after it, the reload's result, the state after the reload and after the unpause |
| Unit tests | `native/tests/opus_test.cpp`: both patterns, a fake loader that behaves like the game's (the count first, the entry only on success): a reload, a refused index and a fault, each putting everything back; with `REDNODE_GAME_EXE`, the real exe gives `+0x1acbcc0`, `+0x1ad1ae0` and the loader `+0x279ed4` |

Checked in the mock game: the swap with a reload (and with `swapPause` off, the pause still runs), and an audio thread that never runs it (cancelled after 3 s, then the unpause). Unverified until the game: everything that runs on the audio thread.

Known risks: anything else that reads the index outside the audio thread (none found, but `0x1D80A40` calls the lookup through a vtable, unverified from where); a sound played between the swap and the reload (a frame or two, paused) can still read the new pak at an old offset.

### H1c-2 test

REDnode 0.26.5 on the laptop (first run on 0.26.4, below), with RED Hot Tools and Hot swap test (**Allowed** on), `EDGEwaveTest.archive` **not** installed. In `%APPDATA%\@rednode\overlay\settings.json`, while the game is closed, set `"soundPakSwap": "reload"` (the host log's swap line must say `"soundPakSwap": "reload" is set`); `swapPause` can stay or go (the reload pauses anyway). The katana sound's id is 746693166. Swap in gameplay with F10, not from the game's pause menu.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save with the katana in V's inventory, not drawn. Switch on the Test timer, **Start**, **Mark**.
2. In Hot swap test, type `746693166` in the sound ids box and press **Sound state**. **Mark**.
3. Draw the katana and put it away: the base game's sound. **Mark**.
4. Swap `EDGEwaveTest.archive` (paste its path, **Swap**). The game pauses for a moment. The Mod log shows "sound index reloaded in N ms: ... sounds before, ... after; N pak entries retired", or why it failed. **Mark**.
5. Draw the katana. Note in the timer which sound played: EDGEwave's (the goal), the base game's, or none. **Mark**.
6. Press **Sound state** again. **Mark**.
7. Play for a minute: walk, draw other weapons, shoot, open a menu. Note any sound that is missing or wrong. **Mark**.
8. Swap `EDGEwaveTest.archive` again (a second reload), then draw the katana and note what played. **Mark**.
9. Quit the game. Send `rednode-mods.log`, the plugin log (`rednode-*.log` of this session), `rednode-overlay.log` and `rednode-faults.log`.

Afterwards set `"soundPakSwap"` back (remove it) and remove `swapPause`.

### H1c-2 test: first run (0.26.4)

Run on the laptop on 2026-10-19 at 19:15; stopped at step 4 by a crash. The settings still said `"soundPakSwap": "try"`, so **the reload never ran** (no `Opus: reload` line; the host log says "try"): this was H1b's run B again, with the game paused. What the logs show:

| Finding | Detail |
|---|---|
| Who swapped | RED Hot Tools' folder watcher (thread 18616), not REDnode's call on the game thread: the host copied the archive into `archive/pc/hot` before the pause and its 500 ms settle, and the watcher took it during that wait |
| When it crashed | Within milliseconds of RED Hot Tools' "Loading updated archives...", inside the archive load. The swap was started from the game's pause menu, with its sounds playing |
| Fault log | Nothing, as in run B. The watch recorded only error-class exceptions; a failed assert in the game (a breakpoint, `0x80000003`) or a fail-fast that skips exception dispatch would leave no line |
| Cursor | The overlay's arrow vanished in gameplay that session (the log says it was drawn every frame) and was fine in the next session; not followed up now |

So sound swaps crash inside the archive load itself, sometimes (run B, this run), not always (run C, H1c-1). The likely race, unverified: the audio thread reading paks through the resource depot while RED Hot Tools changes its archives. The game's pause does not stop the audio thread.

### H1c-2b: the audio thread waits for the swap (REDnode 0.26.5)

Built on 2026-10-19 from that run:

| Part | What |
|---|---|
| `opus.cpp` | `opus.park {"capMs"}`: REDnode's end-of-frame callback holds the audio thread there (after the pak tick: no pak tick, no lookups, no decoding) until the host asks for the reload, which then runs on it, or cancels, or the cap runs out (3 s by default, at most 10 s), so it can never hang the game. `opus.reloadStatus` answers waiting, parked, running, done (with how long it waited) or idle (and whether a wait ran out) |
| `main.js` | With `"soundPakSwap": "reload"`: pause, wait for the audio thread to stop (at most 1 s, or no swap), then copy the archive into `archive/pc/hot` (so RED Hot Tools' watcher cannot start before), swap, read the state, reload, then the audio thread goes on and the game unpauses. Every mode now copies only after the pause |
| `faults.cpp` | The fault watch also records breakpoints (`0x80000003`, a failed assert) |
| Unit tests | A thread stands in for the audio thread: it stops while asked to wait, the reload runs on it, a cancel and the cap end the wait |

Checked in the mock game: a swap with the wait and the reload, and an audio thread that never stops (no swap, the hot folder left empty, the game unpaused). Unverified until the game: whether the game's other threads wait on the audio thread during a swap (the cap bounds it), and whether the wait prevents the crash.

### H1c-2 test: second run (0.26.4)

Run on the laptop on 2026-10-19 at 19:37, with `"soundPakSwap": "reload"` set and the swaps done in gameplay. The plugin was still 0.26.4 (the log says "REDnode 0.26.4 loading"), so without H1c-2b's wait. **No crash**, two swaps, 0 faults.

| Step | Result |
|---|---|
| Before | Index checksum `0x84b342b65b6327fd` (the base game's); sound 746693166 in pak 881 at 179386 |
| First swap (19:40:13) | The reload ran on the audio thread in 4.8 ms, 47 ms after asking. The checksum became `0x67add29894c2a988` and the sound moved to offset 313786: **the new index is in**. 31 pak entries retired |
| Katana after it | **The base game's sound** |
| Second swap (19:42:26) | Reloaded again in 7.9 ms (the same index, the same checksum); 24 entries retired |
| Katana after it | **EDGEwave's sound**: the first hot-swapped sound to play in a running game |

Why the base sound the first time, found in the code the same evening: the game keeps a second table, of **loaded sounds** (`0x3B49050`, 16 bytes each: sound id, references, data object; count at `0x3497E38`). The pak tick acquires a sound there (`0x6E3D94`: an entry with the same id just gets one more reference; otherwise a new data object is filled by the lookup) and releases it (`0x113A51C`). Nothing else touches the table: the game has no function that empties it. So a sound still held when the index is reloaded keeps the data it was loaded with until the game lets it go. The katana was drawn just before the first swap, so its entry was held; between the swaps the user drew other weapons, it was let go, and the next draw loaded it fresh from the new index. The other path, Wwise's own file hook (`0x1D80A40`, Open by sound id, 66 for not found), looks a sound up on every open, so streamed sounds follow the reload at once.

Also found: RED Hot Tools moves a swapped archive into `archive/pc/mod`, so it stays installed: the 19:15 session started with EDGEwave's index already loaded. Remove it from there before a fresh session.

### H1c-3: which sounds the game holds (REDnode 0.26.6)

Built on 2026-10-19, diagnostics only:

| Part | What |
|---|---|
| `opus.cpp` | Finds the loaded sounds table by the acquire's pattern (optional: without it the state just leaves it out). `opus.state` says how many sounds are held, and for each given id whether it is held and by how many references. After a reload, the held sounds whose pak, offset or size differ between the old index (still in memory) and the new one are listed in the plugin log and the reload's result |
| `main.js` | After a reload the Mod log says how many held sounds keep their old data, with their ids |
| `archives.soundState()` | `held`, and `held` per sound |

The real exe gives the table at `+0x3b49050` (count `+0x3497e38`). Next, depending on the test: if letting the sound go (unequipping, loading a save) is enough, the API says so and can tell which sounds wait; if not, a refresh of held entries in the plugin, which needs research first (how Wwise uses the data object).

### H1c-3 test

REDnode 0.26.7 on the laptop (check the plugin log's first line says "REDnode 0.26.7 loading"; 0.26.7 also draws the overlay's arrow from a texture), with RED Hot Tools and Hot swap test (**Allowed** on), `"soundPakSwap": "reload"` in the settings. **Before each game start, remove `EDGEwaveTest.archive` from `archive\pc\mod`** (a swap moves it there). Swap in gameplay with F10. The katana sound's id is 746693166.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save where the katana is in V's inventory but **not equipped** in a weapon slot. Switch on the Test timer, **Start**, **Mark**.
2. Type `746693166` in the sound ids box, press **Sound state**: the line ends "not held". **Mark**.
3. Swap `EDGEwaveTest.archive`. The Mod log says "sound index reloaded ..." and how many held sounds keep their old data (746693166 should not be among them). **Mark**.
4. Equip the katana and draw it. Note which sound played (expected: EDGEwave's). **Mark**.
5. Quit the game. Remove `EDGEwaveTest.archive` from `archive\pc\mod`. Start the game again, load the same save, equip and draw the katana (the base sound), put it away. Press **Sound state**: "held" or "not held"? **Mark**.
6. Swap `EDGEwaveTest.archive`. Is 746693166 in the Mod log's list of held sounds? Draw the katana: which sound? **Mark**.
7. Unequip the katana (take it out of its weapon slot), wait 10 seconds, press **Sound state** (held or not), equip it again and draw it: which sound? **Mark**.
8. If it still played the base sound: load the save again (it keeps the swapped archive and index), draw the katana: which sound? **Mark**.
9. Quit the game. Send `rednode-mods.log`, both sessions' `rednode-*.log`, `rednode-overlay.log` and `rednode-overlay.prev.log`, and `rednode-faults.log`.

Afterwards remove `soundPakSwap` and `swapPause` from the settings, and `EDGEwaveTest.archive` from `archive\pc\mod` if it should not stay installed.

### H1c-3 test: results

Run on the laptop on 2026-10-19 between 20:06 and 20:53 (REDnode 0.26.6, then 0.26.7 from 20:41), with `"soundPakSwap": "reload"`, swaps in gameplay. Four swaps with the audio thread held (it waited 375 to 407 ms each time, the reload took 5 to 9 ms), **no crash**, no faults.

| Session | Katana before the swap | After the swap |
|---|---|---|
| 20:06, 20:11, 20:41 | Not equipped or not drawn; "not held" | **EDGEwave's sound**, every time |
| 20:47 | Equipped and drawn, then put away | The base game's sound (step 6); after unequipping and equipping again, **EDGEwave's sound** (step 7) |

What it shows:

- **The swap works**: with the index reloaded, a sound the game loads after the swap plays from the new archive.
- **The held-sounds table was not the cause.** At the 20:49 swap the game held one sound in it, unchanged by the reload, and not the katana's. Something else kept the katana's old data after it had just played, until the weapon was equipped again; likely Wwise's own stream cache, which keeps recently streamed data by file id (unverified). Re-equipping plausibly makes the game load the weapon's sounds again.
- **The arrow**: on 0.26.7 the overlay's arrow showed and stayed in the game (the user's note at 20:42), drawn from its texture.
- **Holding the audio thread** around the swap: four swaps without a crash (the two crashes since H1b came without it, one from the pause menu). A small sample.

For players and modders today: after a sound swap, a sound that has just played may keep its old version until the game loads it again (for a weapon, equip it again). Next, to agree: make the reload the normal behaviour for sound archives (with the hold), and look for the stream cache's flush.

### H1d: sound swaps by default (REDnode 0.26.8)

Agreed with the user on 2026-10-19 after H1c-3 (then the optional app pack, with a Sound Tracer; the stream cache's flush as a later spike). Built the same day:

| Part | What |
|---|---|
| `main.js` | A sound archive swaps with the hold and the reload by default: no setting needed. Before the swap the host checks that the plugin knows this game version's sound tables (`opus.state`); if not, the archive is refused with the reason. `"soundPakSwap"` stays for research: `"refuse"` (as before), `"try"` (plain, no hold or reload). The answer gets `sound: { index, note }`; the Mod log gets the note about sounds that just played |
| `opus.cpp` | After a reload, the old index's tables and its two hash maps go back to the game's allocator, through the free the loader itself calls (found in the loader's body: `mov rdx,r12; xor ecx,ecx; call`, `+0x1a6f260` in 2.31). A hash map's storage starts 8 bytes before its pointer, with its capacity in the header. `"soundIndexFree": "keep"` in the host's settings keeps the old index instead. The 0.26.6 comparison of held sounds is gone (it read the old index after the reload, and the table was not the cause) |
| `rednode` package, MCP | `archives.reload`'s answer and docs, and `archives_reload`'s description, say how sound swaps work |
| Unit tests | The free the loader calls is found; a reload frees the old maps from their headers, then the tables, and says how much; nothing is freed without the flag, without the free, or when the new index is refused |

Checked in the mock game with no sound settings. Unverified until the game: the free (a wrong guess would corrupt the game's heap, so it is the first thing the test watches).

### H1d test

REDnode 0.26.8 on the laptop (the plugin log's first line says "REDnode 0.26.8 loading"), with RED Hot Tools and Hot swap test (**Allowed** on). **Remove `soundPakSwap` and `swapPause` from `%APPDATA%\@rednode\overlay\settings.json`** (the defaults are what is tested), and `EDGEwaveTest.archive` from `archive\pc\mod` before the game starts. Swap in gameplay with F10.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Start the game and load a save with the katana in V's inventory, not equipped. Switch on the Test timer, **Start**, **Mark**.
2. Swap `EDGEwaveTest.archive`. The Mod log says "sound index reloaded ... the old index freed (... KB)" and the note about sounds that just played. **Mark**.
3. Equip the katana and draw it: EDGEwave's sound expected. **Mark**.
4. Swap `EDGEwaveTest.archive` again (it frees the index the first swap loaded). Draw the katana: which sound? **Mark**.
5. Play for two minutes: walk, draw other weapons, shoot, open the map and a menu. Note any sound that is missing or wrong, and any stutter. **Mark**.
6. In the Mod Manager switch on **Welcome**: it shows the note about F9. Close it. **Mark**.
7. Quit the game. Send `rednode-mods.log`, the plugin log (`rednode-*.log` of this session), `rednode-overlay.log` and `rednode-faults.log`.

### H1d test: results

Run on the laptop on 2026-10-19 between 23:03 and 23:09 (REDnode 0.26.8, no sound settings), swaps in gameplay. **Passed**: "everything worked", no problems. Two marks were missed, so the steps are matched by the logs:

| When | What the logs show |
|---|---|
| 23:05:06 | First swap: game paused, the audio thread held (375 ms), the index reloaded in 9.1 ms, 26 pak entries retired, **the old index freed (3270 KB)**. The Mod log shows the note about sounds that just played |
| 23:05:25 | Second swap, before drawing the katana: held 344 ms, reloaded in 4.7 ms, 28 entries retired, **the index the first swap loaded freed (3270 KB)** |
| 23:06:06 | The katana drawn: **EDGEwave's sound** (the user's note) |
| 23:06 to 23:08 | About two minutes of play: no sound reported missing or wrong, no stutter |
| 23:08:27 | The Welcome window opened, with the F9 note |
| 23:09:38 | Quit: the game exited normally, REDnode's audio callback unregistered |

No faults in either 15 s watch. Freeing with the game's own free held up through two frees and four more minutes of play, so 0.26.8's defaults stay.

One thing not explained: this session's index at the start had checksum `0x31d115933a11cfcb`, where every earlier session had `0x84b342b65b6327fd`; after the swap it was `0x67add29894c2a988`, the same as in earlier runs. So the game loaded a different `sfx_container.opusinfo` at start: the user had been deploying sounds from an EDGEwave session since the last test, which explains it.

**What H1d covers.** EDGEwave has two routes into the game (its `docs/a3-game.md`). The swap covers the **override** route: an archive with the touched `.opuspak` and a whole new `sfx_container.opusinfo`. Since that index is one shared file, the swapped one replaces any other override mod's, as it would at a restart (the last one loaded wins). The **REDmod** route (`customSounds` and `info.json`, deployed by `redMod.exe` when the game starts) is not an archive, so a swap does not reach it; hot-loading it would need REDmod's deploy and a way to make the running game read its custom sounds again (not researched).

**The user's theory for the sound that lingers** (2026-10-19): an object chain keeps a reference to the sound's loaded data, such as the equipped weapon's emitter; unequipping drops it, and the next play loads the new data. If so, some objects may never drop theirs. It fits H1c-3: the game's table of loaded sounds held nothing of the katana's, so the reference would be elsewhere (the emitter, or Wwise's stream of the old pak). The user will test it with the Sound Tracer, which therefore shows plays and loads apart: a sound that plays with no load after a swap is being served from a reference kept from before.

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

## H2 `world.refresh`: plan

Agreed with the user on 2026-10-21: H2 next, then the ink API (I1), then the Sound API's S2.

**The problem.** A swap replaces the archive, and RED Hot Tools drops the resources the loader has cached, but what is already in the world keeps what it loaded: the clothes V wears, a weapon in hand, an NPC or a placed object nearby. The new mesh or material shows only when the game loads that thing again (equip it again, load a save). H2 is a call that makes it load again, right after the swap.

**What the game offers** (from `gameapi/2.31/rtti.json`; none of it tried for this yet, so all **unverified**):

| Target | Game call | Expected |
|---|---|---|
| V's clothing and held items | `TransactionSystem.RefreshAttachment(owner, slot, keepWorldTransform)` on each slot (`AttachmentSlots.Head`, `Face`, `Chest`, `Torso`, `Legs`, `Feet`, `Outfit`, `WeaponRight`...) | Re-attaches the item in the slot, loading its meshes again |
| An item's appearance | `TransactionSystem.ResetItemAppearance(owner, item)`, `ChangeItemAppearanceByName(owner, item, name)` | Applies the appearance again; a stronger fallback: remove the item from its slot and add it back (`RemoveItemFromSlot`, `AddItemToSlot`) |
| An NPC, device or object | `entEntity.ScheduleAppearanceChange(name)` with its current appearance (`GetCurrentAppearanceName()`), or through another appearance and back if the same name does nothing | Rebuilds its appearance's components |
| What REDnode spawned | Delete and spawn again through the DynamicEntitySystem (W1's `api.spawn`), same spec and transform | A full respawn |
| What V looks at | `TargetingSystem.GetLookAtObject(player, ...)` | Picks the target for the two rows above |

The open question behind every row: whether a refreshed thing reads the new file or a copy the engine still holds. The resource loader's cache is dropped by RED Hot Tools, but a mesh or material held by another live object may stay alive. The spike answers it.

**Finding what uses an asset** (the swapped archive's meshes and materials) is the hard part in general: the game has no "who uses this file" lookup. So H2 targets by place, not by asset, and lets the modder say what: V, what V looks at, what REDnode spawned, or everything near V. Reading which entities near V use the swapped files (their components' resource paths) is a later step, if the spike shows it is needed.

| Step | Builds | Answers |
|---|---|---|
| **H2a Spike** | A test app, `apps/refresh-test`, calling the game through `api` only (no plugin change): buttons for V's clothing (each slot, `RefreshAttachment`), V's clothing the stronger way (remove and add back), what V looks at (appearance again), a spawned box (respawn) | Which calls pick up a swapped mesh or material, what each costs (a hitch, a flicker, an animation), and whether anything breaks (a quest item, a weapon in hand, an NPC's state) |
| **H2b `world.refresh`** | The call in the `rednode` package and the MCP tool: `world.refresh({ player, lookAt, spawned, near })` with what the spike found works; Hot swap gains a **Refresh** switch after each swap, on by default for V | One call after a swap shows the change |

The spike's test needs a clothing archive the user can change and swap (a texture or material change that is easy to see on V), a world prop mod with a visible change, and an NPC appearance mod if one is at hand.

### H2a: built

Built on 2026-10-21: **Refresh test** 0.1.0 (`packages/overlay/apps/refresh-test`, a Node mod, closed at start), calling the game through `api` only. No part of REDnode changed, so it runs on the released REDnode 0.26.15 and VERSION stays. It asks for the `archives` permission and requires RED Hot Tools, for its own **Swap** field. Every press goes to its log and the Mod log with what it called and how long it took.

| Section | Buttons | Game calls |
|---|---|---|
| 1. Swap | **Swap** | `archives.reload` (as Hot swap) |
| 2. V's clothes | **Re-attach**, **Reset look**, **Same look**, **Off and on**, on each clothing slot that holds an item (Head, Eyes, Chest, Torso, Legs, Feet, Outfit), or the slots typed in (`Legs`, or a full record such as `OutfitSlots.Torso`) | `RefreshAttachment(V, slot, false)`; `ResetItemAppearance(V, item)`; `ChangeItemAppearanceByName(V, item, its current appearance)`; `RemoveItemFromSlot(V, slot, true, false, true)` then `AddItemToSlot(V, slot, item)` |
| 3. What V looks at | **Same appearance**, **Through a missing one** | `TargetingSystem.GetLookAtObject(V, false, false)`, then `ScheduleAppearanceChange` with its current appearance, or with a name it does not have and back after 0.5 s |
| 4. A spawned object | **Spawn** (the cardboard box, or a `.mesh` depot path typed in), **Respawn**, **Mesh off and on**, **Remove** | `world.spawn` and `world.remove` in the same place; `FindComponentByName` then `Toggle(false)`, `Toggle(true)` |

Checked in the mock game: every button of sections 2 and 3 made the calls above with the right arguments (a jacket and trousers worn, a vendor looked at), and section 4 said what was missing. The docs example page runs it against the simulation. **Unverified** in the game, which is the point of the test.

### H2a test

REDnode 0.26.15 on the laptop, with RED Hot Tools, Codeware, the Test timer and the **Refresh test zip** extracted into the game folder. The test swaps between two versions of the same clothing archive, so each button starts from a V who still shows the other version.

**Before you start, with the game closed:**

- Make two versions of a clothing mod with the **same file name**: **A** as it is, **B** with a change that is easy to see, such as another colour. Something on the legs or feet is easiest to see in first person (the Fia leggings from SP4 would do).
- Put A in `archive\pc\mod`. Keep a copy of each in its own folder, for example `Desktop\A\` and `Desktop\B\`: the swaps use their full paths (Shift+right-click, Copy as path, works).
- Note the item's `.mesh` depot path from WolvenKit, for step 9.
- Optional, for step 8: an NPC or prop appearance mod, in two versions the same way.

**Steps:**

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**: the note goes to the log with it. Step 1 comes before it can be reached.
1. Start the game, load a save, and put on the item (version A). **F10**, Mod Manager: switch on **Refresh test** and allow it to swap archives. Its first lines say RedHotTools OK and the world API OK. Switch on the Test timer, **Start**, **Mark**.
2. Paste B's full path into **1. Swap** and press **Swap**. Does V's item change by itself? (Expected: no.) **Mark**.
3. The baseline: in the inventory, take the item off and put it on again. Does it show B now? Close the inventory. **Mark**.
4. Swap **A**, then press **Re-attach**. Does it show A? Any flicker, animation or hitch? **Mark**.
5. Swap **B**, then press **Reset look**. B? **Mark**.
6. Swap **A**, then press **Same look**. A? **Mark**.
7. Swap **B**, then press **Off and on**. B? Is the item still equipped in the inventory? **Mark**.
8. Face an NPC (with your appearance mod: swap its other version first) and press **Same appearance**, then **Through a missing one**. What did it show each time: no change, a flicker, a different look, nothing for a moment? **Mark**.
9. Type the item's `.mesh` depot path into **4. A spawned object** and press **Spawn**: the item stands about 3 m ahead (if nothing shows, the mesh may have no `default` appearance: say so). Swap the other version, then press **Mesh off and on**. Did it change? **Mark**.
10. Swap the first version back, then press **Respawn**. Did it change? Press **Remove**. **Mark**.
11. Quit the game. Send `rednode-mods.log`, the plugin log (`rednode-*.log` of this session) and `rednode-overlay.log`. RED Hot Tools leaves the swapped archive in `archive\pc\mod`: put A back there, or remove it, before the next session.

### H2a test: first run (crash in the inventory)

2026-10-21 on the laptop, REDnode 0.26.15 with Refresh test 0.1.0. Step 1 passed (Mark at 00:00; the app started and was granted `archives`). At step 2, the player swapped B (`EDGEmat_M3.archive`) **with the inventory open**, watching V's trousers on the inventory's preview of V. The game closed during the swap:

| Log | Last lines |
|---|---|
| Plugin | 13:50:18.411 the fault watch starts for the swap; nothing after |
| Host | 13:50:18 the swap goes to RED Hot Tools 1.3.0, then "The game has exited" |
| RED Hot Tools | "Unloading game archives", "Moving updated archives", "Loading updated archives", then nothing |
| `rednode-faults.log` | only the watch line, no fault (as with the sound pak crashes of H1) |

The crash is inside RED Hot Tools' load of the new archive, with a menu open that shows V and wears the item from the swapped archive. Earlier swaps of plain archives in gameplay passed (H1, SP4), and the H0 crash also came after a swap outside gameplay (the main menu). Unverified whether the inventory is the cause or this archive is: the retest swaps the same archive in gameplay, menus closed. If the inventory is the cause, REDnode should hold a swap until the menus close (the swap queue already exists), not only document it.

### H2a test: second session (the player's findings)

2026-10-21 on the laptop, the Fia leggings mod removed from the game first. Reported by the player; logs not read yet.

| Finding | Detail |
|---|---|
| The swap works | `EDGEmat_M3.archive` swapped from the base trousers to the leather version, with Hot swap and with Refresh test alike |
| Worn items keep the old look | While V wears the trousers, the new material does not show. Taking them off and putting them back on in the inventory shows it, and so does a restart (a fresh save load not checked) |
| Crashes after a few swaps | After a few swaps, every swap crashed the game. Cause unknown: the player suspects something kept in the save |

Reading (unverified): what V wears holds the loaded mesh, material and textures, so they keep the old archive's data until the game lets them go, the same pattern as the held sounds of H1c-2. Unequipping drops the last reference, and the next equip loads from the new archive. The first two crashes may have come from the leggings mod being installed at the same time (unverified). So H2b's first candidate is the release and reload done by a call (the Refresh test's **Off and on**), not rewriting the live objects in place.

### H2a test: third session (loose, no crash)

2026-10-21 on the laptop, the player's own order, no timer; no crash in this round.

| Finding | Detail |
|---|---|
| **Reset look** redrew once | V's trousers changed to the swapped version while watched, after **Reset look**; not reproduced after |
| The world and the inventory disagree | After swapping A back, V in the world kept B, even after taking the trousers off and on in the inventory, while the inventory's preview showed A |

Reading (unverified): RED Hot Tools drops the resource cache entries of a swapped archive, so a fresh load (the inventory's preview, a new entity) reads the new file. V's own garment keeps objects it already holds, and taking it off in the inventory may not destroy the item's entity. Leads: **Off and on** (`RemoveItemFromSlot` with the entity destroyed), time or distance before equipping again, a save load. A plugin diagnostic could settle it: the SDK's `ResourceLoader::FindToken` tells whether a path's resource is still loaded, and the game's garment data (`entGarmentParameter`, compiled per component) may be a second place V keeps it.

The logs of that session (16:40 to 16:56, nine swaps of `EDGEmat_M3.archive`, all reloaded in 63 to 83 ms, no faults) change the reading:

- **The buttons never reached the trousers.** Every press found items only in Head, Eyes, Chest, Torso and Feet; **Legs** held nothing. So **Re-attach** and **Reset look** ran on the helmet, glasses, t-shirt, vest and boots, never on the swapped item.
- **The equipped items were hidden.** Until 16:43:46 every one read `empty_appearance_default`; the first **Reset look** gave them their own appearances (`h1_helmet_10_old_02_&Female&FPP` and so on), and they kept them after. That is likely the one redraw the player saw, and why it did not come again. Hidden equipped items point to an outfit system (the game's wardrobe or Equipment-EX) drawing what V shows, through other slots (unverified).
- **Crashes by session** (from `rednode-faults.log`, one game thread per session): the sessions starting at 13:50, 13:58, 15:52, 15:54, 15:57, 15:59 and 16:29 each ended at their first swap with no result logged; the sessions of 15:43 (six swaps), 16:01 (two) and 16:40 (nine) did not crash. What differed is not in the logs.

Follow-up leads, run by the player the same day after a swap:

| Lead | Result |
|---|---|
| Take the trousers off and put them back on in the inventory | The new look shows at once; no wait or distance needed |
| Load a save | V shows the current version |
| **Off and on** | Not run: the Refresh test does not find the trousers' slot |

So the release and reload that the game does when an item is equipped is enough. H2b's refresh for V is that done by a call, on the items the swap touched; the Refresh test first needs to find the slot that holds the visible trousers (0.2.0, proposed).

### Refresh test 0.2.0

Built on 2026-10-21 from the sessions above (app only, REDnode stays 0.26.15):

| Change | Why |
|---|---|
| **Scan** lists every attachment slot in TweakDB (`tweakdb.records("AttachmentSlot")`) that holds an item, with the item's name, type and appearance, and marks clothing (`Clo_` types) with `*` | 0.1.0's fixed list missed the slot of the trousers V showed; a mod's slots (Equipment-EX's `OutfitSlots`) are records too |
| The buttons act on the clothing Scan found, or on the slots typed in, by the name Scan shows | So one item can be tried alone |
| **Off and on** takes every item off, waits 500 ms, then puts them back | The player's own re-equip worked; the wait gives the game time to let go of the old copy |
| One step at a time: a press while a step runs is refused and logged | 0.1.0 let calls of two buttons interleave |

Checked in the mock game (Scan, Off and on, a press refused while busy, Re-attach). Unverified in the game: the number of slots (each Scan asks every one) and how Off and on behaves with an outfit system.

### Refresh test 0.2.0: test

On the laptop with REDnode 0.26.15, RED Hot Tools, Codeware, the Test timer and the Refresh test 0.2.0 zip. Each step tries one button, then **Off and on** if it did not work, so V always shows the swapped version before the next swap.

**Before you start, with the game closed:**

- Extract the Refresh test 0.2.0 zip into the game folder (it replaces 0.1.0).
- Put A (`EDGEmat_M3.archive`, the base look) in `archive\pc\mod`. Nothing of it in `mods\`, and `archive\pc\hot` empty. The Fia leggings mod stays out.
- Keep A and B in their own folders, for their full paths.

**Steps:**

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Load a save wearing the trousers (A), no menu open. **F10**, then switch on **Refresh test** and press **Scan**. Find the trousers' line (marked `*`) and type its slot name, as the line shows it, into the slots field. Note the name in the timer. **Mark**.
2. Look down at V's legs. Swap **B**. Do the trousers change by themselves? **Mark**.
3. Press **Re-attach**. B? If not, press **Off and on**: B? **Mark**.
4. Swap **A**, press **Reset look**. A? If not, press **Off and on**: A? **Mark**.
5. Swap **B**, press **Same look**. B? If not, press **Off and on**: B? **Mark**.
6. Swap **A**, press **Off and on**. A? Did the trousers vanish for a moment? **Mark**.
7. Open the inventory: are the trousers still equipped, and does the preview show A? Close it. **Mark**.
8. Quit the game. Send `rednode-mods.log`, the plugin log of this session, `rednode-overlay.log` and the RED Hot Tools log. Put A back in `archive\pc\mod` before the next session.
