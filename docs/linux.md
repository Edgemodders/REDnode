# Linux and Proton

Status: **a plan, not scheduled.** Asked for by the owner on 2026-11-13: REDnode and EDGEkit working on Linux, with the game under Proton. Nothing here has been tried in the game. The only Linux work so far is REDbridge's spike of 2026-11-06, under WSL with no game (REDbridge's [Linux page](https://github.com/Edgemodders/REDbridge/blob/main/docs/linux.md)). Every "likely" below is unverified.

## The short answer

Probably possible. Most of REDnode runs inside the game's own Windows process, where Proton gives it the same Windows it expects. The unknown is REDnode's overlay host (Electron), which runs beside the game. A two-to-three-day spike on a real Linux machine settles it. WSL cannot run the game, so it cannot stand in.

Rough total, if the Windows host runs inside Proton: **4 to 7 weeks** for REDnode, REDbridge and EDGEkit together. If it does not, add 1 to 3 weeks for a native Linux host.

## The pieces

| Piece | Under Linux and Proton | Why |
|---|---|---|
| REDnode's plugin, REDswap, REDnode's scripts | **Likely works** | They run inside the game's process. RED4ext, redscript and CET have Linux and Steam Deck players. RED4ext needs a DLL override in Steam's launch options (`WINEDLLOVERRIDES="winmm,version=n,b" %command%`, as recalled; check RED4ext's docs). Sound patterns, REDswap and TweakDB calls touch only the game's memory |
| The overlay drawn into the game | **Probably works** | The game's D3D12 runs through vkd3d-proton. CET's overlay draws the same way and works there |
| The sound engine (miniaudio) | **Probably works** | It uses WASAPI, which Wine provides over PipeWire or PulseAudio |
| **The overlay host (Electron)** | **Unknown** | The two routes below |
| GPU sharing of window pictures | **Probably not** | `OpenSharedHandle` in compositor.cpp opens textures Chromium shares from another process. Under Proton that crosses D3D11 to D3D12 through Vulkan in two processes, unlikely to work. The CPU path (`render=cpu`) copies pixels instead and would be the default on Linux, at some cost |
| Input (the window hook, raw input, `GetAsyncKeyState`, the cursor) | **Likely works** | Wine provides them; CET does the same things. Unverified for pointer lock and the Keyboard Lock path |
| The fault watch (`faults.cpp`) | **Unknown** | It hooks `NtTerminateProcess` and `RaiseFailFastException` in Wine's ntdll. Research only; may be left off on Linux |
| The MCP server and the editor channel | **Works, with one fix** | Wine's sockets are Linux sockets, so a Linux Claude Code reaches the game on `127.0.0.1`. But `editor.json` and other files under `%LOCALAPPDATA%` land in the Proton prefix (`steamapps/compatdata/1091500/pfx/drive_c/users/steamuser/AppData/Local/...`), and the tools must look there |
| REDbridge | **Partly** | REDbridge's plan: L1 a Linux build without textures (1 to 2 days), L2 textures (1 to 3 weeks: WolvenKit's texture code is Windows-only), L3 the tools that start it (2 to 4 days) |
| Shared keys ([Shared keys](keys.html)) | **Needs a Linux backend** | The store uses DPAPI through PowerShell, and a Proton prefix has no PowerShell. The VS Code extensions keep their keys in VS Code's SecretStorage, which works on Linux (libsecret) |
| REDbridge for players (**Get REDbridge**) | **Needs a choice** | It fetches the `win-x64` zip and .NET 10 per user. Inside Proton that means .NET under Wine (unverified); with a native host, the Linux build instead |

## The overlay host: two routes

| Route | How | Trade-off |
|---|---|---|
| **A. The Windows host inside Proton** (try first) | No change: the plugin starts the host as today. The plugin tells the host it runs under Wine (ntdll's `wine_get_version` export), and the host takes the CPU path | Almost free to try. Chromium under Wine is touchy (its sandbox, the GPU process: `--no-sandbox` and software drawing may be needed), and Node mods run inside Wine too |
| **B. A native Linux host beside the game** | The plugin's link moves from a named pipe (`link.cpp`) to TCP on `127.0.0.1`, which a Linux program can reach. The host is started by a Steam launch-options script, since the plugin's `CreateProcessW` and job object (`host.cpp`) cannot start a Linux program. Paths are translated between `Z:\...` and `/...` both ways | Robust, and matches a Linux REDbridge and a Linux EDGEkit. 1 to 3 weeks |

## EDGEkit

| Part | What it takes |
|---|---|
| The app | Code - OSS supports Linux upstream, and VSCodium's Linux builds are a reference. `tools/build.ps1` is Windows-only: a Linux build in CI, packaged as an AppImage, `.deb` or tarball. Self-update differs on Linux, where packages usually update through the system. About 3 to 5 days |
| The extensions | Mostly TypeScript, with Windows in places. PowerShell calls in EDGEdeck (`bridgeInstall.ts`, `game.ts`, `nxm.ts`), REDcode (`bridgeUpdater.ts`, `library.ts`) and EDGEwave (`player.ts`); `.exe` names; Steam's Windows paths (Linux: `~/.steam` and `libraryfolders.vdf`); the Proton prefix; starting the game through Steam (`steam://rungameid/1091500`) rather than the exe. EDGEdeck's hardlinks work if its library is on the game's drive. About 1 to 2 weeks across the extensions |
| Claude Code and EDGEchat | Already ship for Linux |

## Phases

| Phase | What | Effort |
|---|---|---|
| **LX0 Spike** | On a real Linux machine: the game under Proton; RED4ext, redscript and Codeware; today's REDnode player zip as it is. Read the logs: does the plugin load, does the host start inside Proton (route A), does F10 show windows with `render=cpu`, do sounds play, do a few `api_read` calls from a Linux Claude Code reach the game | 2 to 3 days |
| **LX1 REDnode** | Route A's fixes (the Wine check and the CPU path, Chromium's switches, the Proton prefix paths, a key store backend), or route B if A fails | About 1 week (A), 2 to 4 weeks (B) |
| **LX2 REDbridge** | Its L1 and L3; L2 textures for EDGEmat and texture previews | 1 to 4 weeks |
| **LX3 EDGEkit** | The Linux build and the extensions' Windows-isms | 2 to 3 weeks |

LX2 and LX3 can start before LX0's result; LX1 waits for it.

## Open questions

| Question | Recommendation |
|---|---|
| Which machine for LX0? | A Steam Deck, a dual boot on one of the owner's PCs, or a spare drive. WSL cannot run the game. To decide with the owner |
| Which distribution and Proton? | The current Proton (or Proton Experimental) with Steam's runtime; SteamOS on a Deck, otherwise a common desktop distribution. Settle in LX0 |
| Steam Deck as a target? | Later: its screen, controller-only input and the CPU path's cost on its GPU make it a target of its own |
| Self-contained REDbridge on Linux? | REDbridge's own question (148 MB with .NET inside, against asking players to install .NET 10) |
