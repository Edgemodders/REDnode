# REDswap

**REDswap** swaps archives into the running game, so a new mesh, material or texture shows without restarting Cyberpunk 2077. It is a small RED4ext plugin for game version 2.5. REDnode installs it and uses it for every archive swap, and it has its own download on [Nexus Mods](https://www.nexusmods.com/cyberpunk2077/mods/36172) and the GitHub release for tools and players who want it alone. Its source lives in this repo at [`native/redswap/`](https://github.com/Edgemodders/REDnode/tree/main/native/redswap), with its own [changelog](https://github.com/Edgemodders/REDnode/blob/main/native/redswap/changelog.md).

| | |
|---|---|
| Version | 1.0.1, its own (`native/redswap/redswap.json`), apart from REDnode's |
| Game | 2.5, with RED4ext 1.31 or later |
| Installed at | `red4ext/plugins/REDswap/REDswap.dll` |
| Log | `red4ext/logs/redswap-*.log` |
| Swap time | About 50 ms on the game thread for a garment archive (52 to 59 ms in its first test) |
| License | MIT. The swap is ported from [RED Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) (MIT, by psiberx), whose license ships with it |

## Why it exists

Until game 2.5, REDnode swapped archives through RED Hot Tools. RED Hot Tools has no build for 2.5 yet: the game function it calls to load archives moved, and the address list RED4ext ships for 2.5 no longer names it. REDswap finds that function under its 2.5 address, keeps RED Hot Tools' way of swapping, and adds checks so a game version it does not know gets a refusal instead of a crash. How it was found is in [World API, "H3"](world.md#h3-rednodes-own-hot-loader-plan).

## What a swap does

1. Each file goes where the game expects it. An `.archive` the game already loaded is **replaced** at its own path; a new one is **added** to `archive/pc/mod`; ArchiveXL's `.xl`, `.yaml` and `.yml` files go beside them. REDswap **copies** each file, so the one you built stays where it is.
2. The game's open handles on a replaced archive are closed for the moment of the copy, then opened again.
3. The game's own archive loader loads the new files, and they take the old ones' place in the game's list of mod archives.
4. The resources those archives hold are dropped from the game's resource loader, so whatever loads them next gets the new version. So are the resources a replaced archive held and its new version does not (read from the old file's table before the copy, since 1.0.1): they load from the base game, or another mod, next time. That is how a mod restores the game's own look: it swaps in its archive without the files it changed.
5. ArchiveXL, when installed, is asked to reload.

What is already in the world keeps what it loaded. REDswap only swaps; REDnode's `archives.reload` then refreshes what V wears, the inventory's preview of V, REDnode's own spawns and the game's entities near V that use a swapped file ([World API](world.md)).

### The checks before anything changes

| Check | If it fails |
|---|---|
| Every game function REDswap calls is in RED4ext's address list for this game version | The swap is refused with the missing function's name. RED4ext's own lookup would close the game |
| The archive loader starts with the instructions REDswap knows from 2.5 | Refused: a game patch moved it |
| The game's file cache holds each archive being replaced, under its own path | Refused, nothing touched: the cache's layout changed |

REDswap writes the result to its log at the first frame: `Ready: the game's archive loader and file cache were found`, or `Cannot swap in this game: <why>`.

## From a REDnode package

Most mods use REDswap through the `rednode` package's `archives.reload`, which also refreshes what is already in the world. The package needs the `archives` permission in its `rednode-app.json`, and the player allows it in the launcher.

```json
{
  "id": "my-material-preview",
  "name": "My material preview",
  "version": "0.1.0",
  "main": "mod.mjs",
  "permissions": ["archives"]
}
```

```js
// mod.mjs
import { archives } from 'rednode';

const r = await archives.reload(['E:/Projects/MyJacket/packed/archive/pc/mod/MyJacket.archive']);
console.log(`${r.via}: ${r.reloaded.length} swapped in ${r.ms} ms`); // "redswap: 1 swapped in 68 ms"
for (const f of r.failed) console.warn(`${f.file}: ${f.why}`);
console.log('refreshed on V:', r.refreshed.map((w) => w.slot)); // ["OutfitSlots.LegsMiddle", ...]
console.log('refreshed on the inventory preview:', r.preview?.items.length ?? 0);
```

A name alone, such as `'MyJacket.archive'`, reloads the archive already in `archive/pc/mod` as it is. `{ refresh: false }` swaps without refreshing anything. The whole answer is in [Overlay apps, "Swapping archives in the running game"](overlay-apps.md#swapping-archives-in-the-running-game).

## From an AI assistant

REDnode's [MCP server](mcp.md) offers the same as the tool `archives_reload`, so Claude Code can rebuild an asset and show it in the game. The player is asked before every call. A prompt such as:

> Pack my WolvenKit project and swap `MyJacket.archive` into the game, then tell me what was refreshed.

## From redscript

REDswap registers three global functions. Declare them in your `.reds` file and call them on the game thread, which is where scripts run:

```swift
// REDswap's functions (REDswap 1.0.0 or later).
public static native func REDswap_Version() -> String
public static native func REDswap_Check() -> String
public static native func REDswap_Swap(files: String) -> String

public static func SwapMyJacket() -> Void {
  let why = REDswap_Check();
  if NotEquals(why, "") {
    LogChannel(n"DEBUG", s"REDswap cannot swap here: \(why)");
    return;
  }
  // Absolute paths, joined by "|" for more than one file.
  let answer = REDswap_Swap("E:\\Projects\\MyJacket\\packed\\archive\\pc\\mod\\MyJacket.archive");
  LogChannel(n"DEBUG", s"REDswap \(REDswap_Version()): \(answer)");
}
```

A script that declares these functions fails to compile when REDswap is not installed, and one compile error stops every script in the game. Ship such a script only with REDswap listed as a requirement, or call it from a plugin, which can check first (below).

## From a RED4ext plugin

A plugin finds the functions through the game's RTTI, so it builds without REDswap and can tell the player when it is missing:

```cpp
#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Utils.hpp>

// Swaps the files (absolute paths) through REDswap; call it on the game thread.
// Returns REDswap's JSON answer, or an empty string when REDswap is not installed.
std::string SwapThroughREDswap(const std::string& aFiles)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* swap = rtti->GetFunction("REDswap_Swap");
    if (!swap)
        return {};

    RED4ext::CString files(aFiles.c_str());
    RED4ext::CString answer;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &files);
    if (!RED4ext::ExecuteFunction(static_cast<void*>(nullptr), swap, &answer, args))
        return {};
    return answer.c_str();
}
```

## The answer

`REDswap_Swap` answers JSON. This one is from REDswap's first in-game test, with the inventory open (`left` and `leftInvalidated` added as 1.0.1 would answer it):

```json
{
  "done": [
    {
      "file": "E:\\Gallery\\Files\\EDGEmat A\\EDGEmatA.archive",
      "target": "E:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\archive\\pc\\mod\\EDGEmatA.archive",
      "how": "replaced"
    }
  ],
  "failed": [],
  "resources": 9,
  "invalidated": 4,
  "left": 7,
  "leftInvalidated": 0,
  "extensions": true,
  "ms": 52
}
```

| Field | What it is |
|---|---|
| `done` | Each file swapped: as given, where it went, and `how`: `replaced`, `added`, `reloaded` (the file given was the installed one) or `config` (an ArchiveXL file) |
| `failed` | Each file not swapped, with `why` |
| `resources` | The resource paths the swapped archives hold |
| `invalidated` | Of those, the ones the game had loaded, now dropped from its resource loader |
| `left` | The resource paths a replaced archive held and the new one does not (1.0.1 and later) |
| `leftInvalidated` | Of those, the ones the game had loaded, now dropped from its resource loader (1.0.1 and later) |
| `extensions` | Whether ArchiveXL was asked to reload |
| `ms` | The swap's time on the game thread |
| `error` | Only when nothing could be swapped at all, such as a failed check |

## Installing it

- **With REDnode:** nothing to do. REDnode 0.41.0 and later put REDswap in `red4ext/plugins/REDswap/`.
- **Alone:** from its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/36172) with Vortex or EDGEdeck, or extract `REDswap-<version>.zip` into the game folder. It needs RED4ext.
- **Both:** the same files. A mod manager may show them as a conflict; either copy works, and the newer one wins.
- **With RED Hot Tools:** they can sit side by side. REDswap never uses RED Hot Tools' `archive/pc/hot` folder, and REDnode uses REDswap when both are there (`"swapWith": "redhottools"` in the overlay host's `settings.json` switches back, for comparison).

## Good to know

- Swap in a loaded save, not at the main menu. REDnode refuses the main menu; a script calling REDswap there is on its own.
- A broken archive, or a mod whose other parts are missing, can still crash the game when it loads, as it would at start.
- Archives with the game's sound paks (`.opuspak`, `.opusinfo`) need REDnode's sound handling around the swap (the game paused, its audio held, its sound index loaded again). Swap them through `archives.reload`, not `REDswap_Swap` alone. Unverified on 2.5 so far.
- Open ink screens that use a swapped widget keep the old one until they are built again (unverified). RED Hot Tools refills them live; REDswap does not.

## Tests

| Test | Result |
|---|---|
| Sound Tools 0.1.1 check (2026-10-27, game 2.5, REDnode 0.41.0, REDswap 1.0.0) | Passed: Hot swap swapped through REDswap seven times, 49 to 61 ms each, no faults |
| [H3a REDswap](world.md#h3a-test) (2026-10-27, game 2.5, REDnode 0.41.0) | Passed: three replaces and one new archive, 52 to 59 ms each, no faults; V and the inventory preview refreshed with no button, inventory open or closed |
