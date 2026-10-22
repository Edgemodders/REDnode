# Changelog

What changed in each REDnode release, for players and modders. Each release takes its notes from its section here: the GitHub release (written by the release workflow) and the version's changelog on the Nexus Mods page (pasted by hand). Test builds between releases (like 0.26.0) are folded into the next release.

How to keep it:

- With each change a player or modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line. Leave out what only the tests see, such as the test apps that are not in the player zip.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The release workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub and Nexus.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints plain lines for Nexus's changelog field, one per change.

## Unreleased

**New**

- A package's `requires` can name `rednode` with a version, for app packs that need a REDnode new enough. The overlay host answers with its own version.
- Each release on GitHub also carries the app packs' zips, such as REDnode Sound Tools, each as its own file.
- The MCP tool `api_read` reads from the game without asking: it runs functions named like reads (`Get`, `Is`, `Has`, `Can`, `Find`) and a TweakDB record's methods, and refuses the rest. See [the MCP server](https://edgemodders.github.io/REDnode/mcp.html).
- The **Test timer** is now a sample in the download, off until you switch it on: a stopwatch whose **Mark** writes the step and the time to the Mod log and `red4ext/logs/rednode-mods.log`, to match log lines to what you did while testing a mod.

**Changed**

- Claude Code now asks you before every call of the MCP tools `api_call` and `archives_reload`, in every permission mode, auto mode included. Reads go through the new `api_read`, which never asks.

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
