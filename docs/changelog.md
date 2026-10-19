# Changelog

What changed in each REDnode release, for players and modders. Each release takes its notes from its section here: the GitHub release (written by the release workflow) and the version's changelog on the Nexus Mods page (pasted by hand). Test builds between releases (like 0.26.0) are folded into the next release.

How to keep it:

- With each change a player or modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line. Leave out what only the tests see, such as the test apps that are not in the player zip.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The release workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub and Nexus.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints plain lines for Nexus's changelog field, one per change.

## Unreleased

## 0.26.2 (2026-10-19)

**Changed**

- `archives.reload` and the MCP tool `archives_reload` refuse an archive that changes the game's sound paks (`.opuspak`, `.opusinfo`), since swapping sound into a running game crashes it. Install such an archive and restart the game.

**Other**

- The plugin watches for faults around each archive swap and writes what it finds to `red4ext/logs/rednode-faults.log`, for bug reports.
- The host log of the last game session is kept as `red4ext/logs/rednode-overlay.prev.log`, so a crash's log survives the next start.

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
