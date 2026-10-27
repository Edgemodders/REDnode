# Changelog

What changed in each REDnode release, for players and modders. Each release takes its notes from its section here: the GitHub release (written by the release workflow) and the version's changelog on the Nexus Mods page (pasted by hand). Test builds between releases (like 0.26.0) are folded into the next release.

How to keep it:

- With each change a player or modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line. Leave out what only the tests see, such as the test apps that are not in the player zip.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The release workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub and Nexus.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints plain lines for Nexus's changelog field, one per change.

## Unreleased

**New**

- REDswap, a plugin installed with REDnode (`red4ext/plugins/REDswap`), swaps archives into the running game on game 2.5, so `archives.reload` and the MCP tool `archives_reload` no longer need RED Hot Tools, which has no 2.5 build. Its swap is ported from RED Hot Tools (MIT, by psiberx). The answer says `via: "redswap"`. RED Hot Tools is still used when REDswap is not loaded. REDswap has its own version (1.0.0), changelog, docs page (https://edgemodders.github.io/REDnode/redswap.html) and Nexus page (https://www.nexusmods.com/cyberpunk2077/mods/36172), and its own zip beside REDnode's in each release.

**Fixed**

- A game function with overloads of the same name can be called by the plain name when that is one overload's full name (such as `DelaySystem.DelayEventNextFrame`); it was refused as ambiguous, though the error said to use the full name.
- After an archive swap, the inventory's preview of V now shows the new version of what V wears too, with the inventory open or closed (it kept the old look until the item was put on again). The answer of `archives.reload` lists it in `preview`. Needs Codeware.

## 0.40.1 (2026-10-26)

**New**

- `world.spawn({ mesh })` spawns a prop from a mesh alone, and a `Character.*` record now stands where it was placed and stays friendly to V. `keep: true` keeps a spawn in the save.
- `world.load()` and `world.unload()` load an [EDGEbuilder scene file](https://edgemodders.github.io/EDGEbuilder/scene.html) into the running game: its meshes, entities and NPCs (lights not yet).
- `world.near()` lists the entities near V with the files each one uses, read in the game in one call; `world.files()` reads one entity's files; `world.spawned()` lists your package's spawns.
- What a package spawns is removed when the package stops.
- After an archive swap (`archives.reload`), your spawns that use a swapped file are spawned again (`world.onRespawn` tells you their new ID), and the game's entities within 30 m of V that use one switch appearance and back, so they show the new version. The answer lists them in `world`. Untested in game until RED Hot Tools supports game 2.5.
- MCP tools `world_near` and `world_spawned` (read), and `world_spawn`, `world_remove` and `world_load` (ask first).
- Connect Claude Code (or another MCP client) without copying a token: it asks to connect, your browser shows a code, and REDnode shows the same code in the game with **Allow** and **Deny**. The connection stays across restarts; the launcher lists connected assistants with **Revoke** ([#19](https://github.com/Edgemodders/REDnode/issues/19)). **Copy setup** still works for clients without sign-in.

**Fixed**

- A Node mod's window with a `ui.list()` log and more controls than fit no longer squeezes the log to nothing: the log keeps at least 160 px and the window scrolls to reach it.

## 0.38.1 (2026-10-25)

**The first release for game version 2.5.** It needs RED4ext 1.31 or later. For game 2.31, use REDnode 0.37.0.

**Changed**

- REDnode moves to game version 2.5: it needs RED4ext 1.31 or later and no longer loads on 2.31 (REDnode 0.37.0 is the last for 2.31).
- On 2.5, sound archive swaps and the Sound Tracer find the game's audio code again (the Tracer's hook on Wwise's PostEvent needed a new pattern).
- The `api` types and the [game API reference](https://edgemodders.github.io/REDnode/game/) now come from game 2.5. 2.5 adds optional parameters to some functions (such as `EquipmentSystem.GetActiveItem`, for dual wielding) and renumbers some enums, which `api` passes by name, so calls written for 2.31 keep working.
- Hot swaps of archives (`archives.reload`, the MCP tool `archives_reload`, the Hot swap app) wait for a RED Hot Tools release for 2.5.

**Fixed**

- UI kit: typing in an `rn-input` or moving an `rn-slider` sent a page two `input` events, one of them the browser's own with no `detail`, so handlers reading `e.detail.value` threw (seen in Sound Tracer and Sound Search).

## 0.37.0 (2026-10-24)

**The last release for game version 2.31.** Game version 2.5 is not supported yet: RED4ext will not load this REDnode on 2.5. The next release moves REDnode to 2.5, as soon as RED4ext, redscript and Codeware support it.

**New**

- **Development folders**: in the launcher's Settings drawer, with Developer mode on, add folders from your own projects. Their packages run from there, with hot reload, instead of their installed copies, so a mod can be developed outside the game folder. The Mod Manager marks such a package **DEV** and names the copy it hides. A folder can be one package or hold several. See [Development folders](https://edgemodders.github.io/REDnode/overlay-apps.html#development-folders).
- **Mod services**: a package names a service file in its manifest (`"service": "service.mjs"`), and every function it exports can be called by other packages through REDnode with `service.connect("<package id>")`, with timeouts, Stop, the caller's name and events (`service.emit`, `$on`). Overlay pages can call too. `requires` takes other REDnode packages by id. Samples: **Counter service** and **Counter panel**. See [Calling other packages](https://edgemodders.github.io/REDnode/overlay-apps.html#calling-other-packages).
- **Service descriptions**: the JSDoc above a service's functions describes them. REDnode checks each call's arguments against it before the function runs, the Mod Manager lists a package's functions, `service.describe(id)` answers it, and `@tool`, `@readonly`, `@timeout` and `@event` mark what an assistant may call, what only reads, a longer timeout and the events. `rednode describe` writes `service.json` from the source for bundled and TypeScript packages. See [Describing a service](https://edgemodders.github.io/REDnode/overlay-apps.html#describing-a-service).
- **Mods' tools for AI assistants**: each service function marked `@tool` is offered to every assistant on REDnode's MCP server (Claude Code, REDagent) as `<package>__<function>`, with the author's description; `@readonly` ones run without asking, the rest ask the player first. `mod_services`, `mod_read` and `mod_call` reach tools of mods started later. See [Mods' tools and the Tools Manager](https://edgemodders.github.io/REDnode/mcp.html#mods-tools-and-the-tools-manager).
- **Tools Manager**, in the new optional **REDnode Admin Tools** pack (its own zip): every tool an assistant can see through REDnode, REDnode's own and each mod's, with what it does and whether it asks first; switch any tool or mod off for every assistant (kept across starts), or start new mods' tools off; see which assistants connected and their recent calls.
- **Task Manager**, in the Admin Tools pack too: every running package with its CPU, memory, its thread's load and heap, game calls and service calls; **End task** stops one, even one stuck in an endless loop, and **Restart** starts it again.
- The **admin** permission: a package that asks for it, once the player allows it in the Mod Manager (with a warning), may see what every package costs, end or restart any package, and switch AI assistants' tools on and off, through `admin` in the `rednode` package. The Admin Tools pack's apps use it. See [Admin Tools](https://edgemodders.github.io/REDnode/admin-tools.html).
- The UI kit's `rn-window` takes `drawer`: a panel that belongs to the page's main window, such as a settings drawer beside it. It has no title-bar actions but close, which only hides it, and the main window keeps its space, pin and reset actions.

**Changed**

- A package can be a Node mod with only a service file and no `main`.
- The launcher's settings (GPU sharing, Hot reload, MCP server, Developer mode, Open at start, Tooltips) moved to a **Settings** drawer beside it, opened with the gear at the right of the Theme row, one setting a row with a line on what it does. The launcher's title is now just **REDNODE**, so it no longer gets cut off. Its version line reads "Version 0.32.3" rather than repeating the name.

**Fixed**

- The docs site's example previews load again: since 0.32.0 every preview stopped at a script error.

**Other**

- The player zip's README says to switch the samples on in the Mod Manager. The docs correct several out-of-date pages: sound archives do swap (since 0.26.8), TweakDB writes exist, the manifest table lists every permission and field, and permissions are allowed in the Mod Manager.

## 0.32.1 (2026-10-23)

**For game version 2.31 only.** Game version 2.5 is not supported yet: RED4ext will not load this REDnode on 2.5. REDnode moves to 2.5 as soon as RED4ext, redscript and Codeware support it.

**New**

- The `ink` API (experimental, needs Codeware): Node mods build trees of the game's own UI widgets on the HUD (`ink.mount`, `ink.column`, `ink.text` and the rest), drawn by the game rather than the overlay. REDnode builds them again after a save load and removes them when the mod stops. The game look comes from the game's own style sheet: a text `style` (`title`, `label`, `value` and the rest) or a `tone` (`normal`, `accent`, `danger` and the rest) gives the game's exact sizes and colors with no styling by hand. Layout with `gap`, `pad`, `align` and `grow`; the game's icons by TweakDB record. Game values bound to texts and bars (`bind: "player.health"`, `ink.bar`), read by the plugin every frame with no update code in the mod; lists from data (`ink.list`, `mount.update`) that send only what changed. See [Native game UI](https://edgemodders.github.io/REDnode/ink.html). Text in the player's language: an ink text set to `"LocKey#…"` shows the game's own translation, and `t()` takes a package's own text from `locales/<language>.json`, with parameters, plurals and V's gender, and follows a language change. `game.language()` and the `language` event give the game's language. Samples: **Ink Coords**, **Ink vitals**, **Ink styles**, **Ink list** and **Ink language**.
- Swapping an archive now shows the new version on the clothing V wears at once, without taking it off: `archives.reload` applies the worn items' appearance again after the swap, in the base game's slots and Equipment-EX's (with Equipment-EX in use only its slots, so items it hides stay hidden). `{ refresh: false }` skips it; the answer's `refreshed` lists what was refreshed. The MCP tool `archives_reload` takes `refresh` too.
- A package's `requires` can name `rednode` with a version, for app packs that need a REDnode new enough. The overlay host answers with its own version.
- Each release on GitHub also carries the app packs' zips, such as REDnode Sound Tools, each as its own file.
- The MCP tool `api_read` reads from the game without asking: it runs functions named like reads (`Get`, `Is`, `Has`, `Can`, `Find`) and a TweakDB record's methods, and refuses the rest. See [the MCP server](https://edgemodders.github.io/REDnode/mcp.html).
- The Quest API, for testing a quest in the running game: `quests.fact`, `quests.facts` and `quests.setFact` read and set the game's quest facts, `quests.watch` hears each change of named facts as the game makes it (with no polling, kept across save loads), `journal.entry`, `journal.setState`, `journal.track` and `journal.tracked` read and change journal entries, and `game.player.teleport` moves V to a position or a world node. MCP tools for assistants: `game_facts` and `game_journal` read without asking; `game_facts_set`, `game_journal_set` and `game_teleport` ask first. See [Quest API](https://edgemodders.github.io/REDnode/quests.html). Sample: **Quest test**.
- New samples in the download, off until you switch them on: **Ink Coords** and **Ink vitals** (the game's own UI, need Codeware) and **Quest test**.
- The **Test timer** is now a sample in the download, off until you switch it on: a stopwatch whose **Mark** writes the step and the time to the Mod log and `red4ext/logs/rednode-mods.log`, to match log lines to what you did while testing a mod.

**Changed**

- Claude Code now asks you before every call of the MCP tools `api_call` and `archives_reload`, in every permission mode, auto mode included. Reads go through the new `api_read`, which never asks.

**Fixed**

- The MCP tool `api_read` no longer refuses reads whose names hold a word like `Equip`, `Start` or `Open` as a noun, such as `GetItemInEquipSlot` or `IsQuickHackPanelOpen`, which then went through `api_call` and asked you first. It refuses only reads that also change something, such as `GetOrCreate…`.
- Sending many game calls at once (more than 256 in one frame) no longer leaves the extra ones unanswered until they time out after 5 seconds: the plugin runs 256 a frame and carries the rest to the next frames, and refuses past 4096 waiting with a message.
- The game no longer crashes when quitting after a Node mod held objects made by another plugin, such as Codeware's: REDnode lets go of every object it holds when the game stops, while the other plugins are still loaded.
- `api.$new` with properties on a class written in redscript no longer breaks the object it makes (and crashes the game at its next use): script fields are now set where the game keeps them, as `$get` and `$set` already did.
- `archives.reload` and the MCP tool `archives_reload` refuse, with a message, a swap that the official RED Hot Tools would get wrong and end the game with: replacing an archive in a mod folder with both upper- and lowercase names. The [Edgemodders build of RED Hot Tools](https://github.com/CyberbuildsAI/cp2077-red-hot-tools/releases) fixes it, and with it REDnode swaps as before.

**Other**

- REDnode's own native calls into the game remember the functions they find, so reading game values every frame costs less.
- REDnode's scripts keep the root widgets of a few HUD and menu screens (`REDnodeInk.reds`), the first part of the coming ink API for the game's own UI. Nothing changes on screen.
- During an archive swap, `red4ext/logs/rednode-faults.log` now also names whatever ends the game (TerminateProcess, ExitProcess or a fail-fast), with its status, its stack and the game engine's last error message, for crashes that leave no crash report.

## 0.26.15 (2026-10-20)

Folds in 0.26.2, which was not released on its own.

**New**

- Swapping sound into the running game: `archives.reload` and the MCP tool `archives_reload` now swap archives that change the game's sound paks (`.opuspak`, `.opusinfo`, such as EDGEwave's sound overrides). The swap runs with the game paused and its audio held, then REDnode loads the game's sound index again, so the new sounds play without a restart. A sound that played just before the swap may keep its old version until the game loads it again (for a weapon, equip it again). The answer's `sound` field says how it went.
- `ui.list()` in the UI builder: a list of lines that scrolls on its own, for a log or a live feed in a Node mod's window. It keeps its newest lines, follows the newest one unless the player scrolls up, and fills the window's free height, so the window itself never scrolls. See the new **Live log mod** sample.
- `ui.copy(text)` in the `rednode` package puts text on the Windows clipboard, from a Node mod or an overlay app.
- Experimental, for the coming REDnode Sound Tools: `audio.trace(onTrace)` lists the events the game posts to its audio engine, named where REDnode knows the name, and the sounds it loads, as they happen; every one is also written to `red4ext/logs/rednode-sound-trace.log`.
- Experimental: `audio.playGame(id)` plays one of the game's own recordings by its sound id through REDnode's engine; `audio.playGame({ event })` plays an event's recordings in turn, heard wherever the sound is in the game; `audio.eventSounds(event)` lists them.
- Experimental: `audio.searchSounds(query)` searches the game's sound events by words of their name or tags, by event id, or by sound id (the events that play it).
- Experimental: `audio.event(name)` posts a game sound event through the game, on V so positional sounds are heard (`{ on: "none" }` for none), and returns `stop()`. When a package stops, REDnode stops the events it posted.

**Fixed**

- The overlay's arrow could vanish in the game after a save loaded on some NVIDIA setups, while the windows still showed. It is now drawn from a texture, the same way as the windows.

**Changed**

- The Welcome window warns that F9, right beside F10, is the game's Quick Load.

**Other**

- The plugin watches for faults, and breakpoints (a failed assert in the game), around each archive swap and writes what it finds to `red4ext/logs/rednode-faults.log`, for bug reports.
- The host log of the last game session is kept as `red4ext/logs/rednode-overlay.prev.log`, so a crash's log survives the next start.
- `archives.soundState()` in the `rednode` package reads the game's sound pak index, the paks it has open and the sounds it holds loaded, without changing them (a sound's fields are `offset`, `headerSize`, `length` and `decodedBytes`): an experimental diagnostic. See [swapping archives](https://edgemodders.github.io/REDnode/overlay-apps.html#swapping-archives-in-the-running-game).

## 0.26.1 (2026-10-19)

**New**

- Hot-loading archives: `archives.reload()` in the `rednode` package swaps `.archive`, `.xl` and `.yaml` files into the running game through [RED Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools), with checks and a queue around it. A package needs the new `archives` permission, which the player allows in the launcher. Also the MCP tool `archives_reload`. See [hot-loading archives](https://edgemodders.github.io/REDnode/world.html).
- A Welcome window at the first start that teaches F10. It shows once.

**Fixed**

- An archive path pasted from Windows' **Copy as path**, with its double quotes, is accepted.

**Other**

- The plugin log reports the overlay's cursor every 5 seconds in interactive mode, for bug reports. If the overlay's arrow blinks with DLSS on, update the GPU driver: an older NVIDIA driver caused it on one laptop.

## 0.25.0 (2026-10-17)

**New**

- **Get REDbridge** in the Mod Manager fetches REDbridge and .NET 10 for the current user, so players no longer need VS Code for packages that read the game's archives. A manifest can list `"redbridge"` in `requires`.
- A **Tooltips** switch in the launcher.

**Changed**

- REDnode finds REDbridge in EDGEdeck's storage (`edgemodders.edgedeck`), no longer REDdeck's.

**Fixed**

- Tooltips show in overlay windows: inside the UI kit's controls and on the title-bar icons.
- HUD widgets no longer show on the loading screen at boot.

## 0.24.3 (2026-10-16)

**Fixed**

- REDnode finds REDbridge under REDcode's store id since REDcode 0.8.2, `edgemodders.redcode-cyberpunk`.

## 0.24.2 (2026-10-16)

The first release. The RED4ext plugin, the HTML overlay host and six samples (Hello mod, Ask mod, UI kit, Vitals, Coords, Perf).

- HTML overlay windows, apps with manifests, HUD widgets, a launcher, a Mod Manager and spaces (named sets of windows), drawn into the game. F10 cycles passive, interactive and hidden.
- Node mods: each package runs in its own process with the `rednode` package, a `ui` builder and hot reload.
- The game API: call game functions and read properties, with generated types; the World API to build objects; TweakDB reads and writes (through TweakXL); REDnode's own sound engine; pointer lock.
- An MCP server so Claude Code can see and drive the overlay and the game.
