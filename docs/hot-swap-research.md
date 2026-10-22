---
title: Hot swap patch research
---

# Hot swap patch: research

Asked for by the owner on 2026-10-22, after H2 was parked ([World API](world.md), "H2 parked"). The goal: a swap of an archive into the running game after which everything that uses its files shows the new version at once, worn clothing included, without crashing. That may mean holding the game's threads during the swap, or replacing game objects so REDnode controls when they change. This page gathers what is known, what is not, and the phases to find out. Nothing here is built yet.

Phases are named **HP0** to **HP5** (hot swap patch). Each ends with an in-game test, as everywhere in REDnode.

## What a swap does today

| Part | What happens | Source |
|---|---|---|
| The archive | RED Hot Tools (MIT) closes the old archive's file handle, mounts the new file through the game's own `ResourceDepot::LoadArchives`, and writes it into the depot's list. It then **moves the new file into `archive/pc/mod`**, so it stays installed for later sessions | [World API](world.md), "Hot-loading archives (#12)" |
| Cached resources | It drops the resource loader's cached entries **for the files in the new archive** only, swaps ink widget libraries in place, and reloads ArchiveXL's extensions | The same |
| Sound | REDnode holds Wwise's audio thread at the end of a frame (`opus.park`), retires every open pak, frees the old sound index and runs the game's loader again. A sound that just played may keep its old data until the game loads it again | [World API](world.md), H1c to H1d |
| Things already in the world | Nothing. They keep the resources they hold | H2a |

The sound work is the model for this research: read the engine statically, prove the reading with read-only probes, then hold the one thread that owns the data and change it at a safe point.

## What H2a found

| Finding | Notes |
|---|---|
| A worn garment keeps the old version after a swap | Equipping it again, or loading a save, shows the new one. The inventory's preview (a fresh entity) shows the new one at once |
| Calls that redraw an item do not reload it | `RefreshAttachment`, `ResetItemAppearance` and the same appearance again changed nothing, except one redraw that came from un-hiding items |
| **Off and on** (remove from the slot, add back after 500 ms) works one way | Old to new worked; back to the old version did not, while the preview showed it. Likely cause, unverified: the old archive lacked paths the new one had, so their cache entries, holding the new files, were never dropped |
| Taking the item off **before** the swap and putting it back after works | The player's manual tries and Refresh test 0.2.3 |
| Equipment-EX is required | Its slots (`OutfitSlots.LegsMiddle` and so on) hold what V shows. The base slots hold hidden items. Its items read as type `Invalid`. An instant wardrobe switcher mod was also installed in the last runs (its part unverified) |
| Finding slots through `api` is too slow | 354 slot records in 8 to 9 s; it belongs in the plugin |

## The crashes of 2026-10-22

Six crash reports from the laptop (game 2.31, RTX 3070 Laptop with 8 GB, 16 GB RAM, texture quality Medium, then High), with the player's two new trouser versions, between 10:06 and 10:21. The player started the game twice by a double click more than once that morning. Each report names the time its process started (in the attached log's name), which shows the pairs. In each dump the crashing thread is the game's crash reporter, so the stacks say little; the reports and REDnode's logs say more.

| Process started | Crashed | The game's report | Notes |
|---|---|---|---|
| 10:06:33 | 10:09:14 | **GPU device removed** (`0x887a0005`), during the shadow pass's async compute | `EDGEmatB.archive` swapped at 10:08:56 (671 ms). From 10:09:10 REDnode's next call got no answer |
| 10:06:57 | 10:09:14 | **D3D12MA: Out of memory**, at the main menu | A **second copy**, started 24 s after the first. It crashed in the same second as the first |
| 10:09:41 | 10:11:01 | **D3D12MA: Out of memory**, in the game | No swap in REDnode's log for this session |
| 10:13:27 | 10:14:26 | **D3D12MA: Out of memory**, while a save loaded | No swap |
| 10:19:17 | 10:20:23 | **D3D12MA: Out of memory**, in the game | A pair with the next row |
| 10:19:40 | 10:20:23 | **Access violation**, a write to address 0, 43 s after start (its dump is empty) | A **second copy**, crashed in the same second as the one above |

The reading: every crash of that morning is explained by two copies of the game sharing the 8 GB of graphics memory, or comes in a session with no swap. Even the GPU crash after the swap came in the same second as the second copy's out-of-memory crash, so it most likely ran out of graphics memory too (unverified: the swap loading new textures may have tipped it over). So **there is no clean evidence yet of a crash caused by a swap**. The earlier H2a crashes (2026-10-21, at the first swap of some sessions, with the Fia leggings mod installed) left no reports, so whether a second copy ran then is not known.

A small REDnode change would make this visible next time: the plugin can tell when another copy of the game is already running (a named mutex) and say so in its log and on screen. Proposed, not agreed.

## The engine's pieces

Names follow the RED4ext SDK and the game's RTTI where they exist. How they hold each other is **unverified** and is what HP1 maps.

| Piece | What it is | Why it matters |
|---|---|---|
| Resource depot | The mounted archives and their file tables (path hash to archive and offset) | Where a swap changes which file a path reads |
| Resource loader | Loads a path into a resource and caches it by path, with tokens for loads in flight (`ResourceLoader`, `ResourceToken`; the SDK has `FindToken`) | A cached resource is reused by every later load of that path: the one-way result |
| Resources | `CMesh` (`.mesh`), `CBitmapTexture` (`.xbm`), material instances (`.mi`), appearances (`.app`), entity templates (`.ent`) | What a component points to through `raRef` or handles |
| Components | `entMeshComponent`, `entSkinnedMeshComponent`, `entGarmentSkinnedMeshComponent`, morph targets | What a worn item is made of. Garments also get compiled garment data, which may hold its own copy (unverified) |
| Render side | Render proxies built from components, the GPU's buffers and textures, and texture streaming (mips loaded on demand) | What the screen draws from. GPU memory can only be freed once the GPU has finished every frame that used it |
| Threads | The game thread (REDnode's pump), the render thread (REDnode already hooks Present), job workers, streaming and IO threads, Wwise's audio thread | The ones that touch the pieces above must be at a safe point during a swap |

## Phases

| Phase | Builds or does | Answers |
|---|---|---|
| **HP0 Crash triage** | No code. The 2026-10-22 reports are read (above): none is a clean swap crash. Next: swap runs with one copy of the game, and the swapped version installed normally with no swap | Whether swaps crash at all once only one copy runs, and if so where |
| **HP1 Map** | Static reading of the 2.31 exe and read-only probes in the plugin, as in H1c-1: `resources.state(path)` (loaded or not, reference count, which entities and components hold it); Equipment-EX's slots and items read in the plugin | What holds a worn item's mesh and textures, from the slot to the GPU, and what a swap leaves stale |
| **HP2 Safe point** | A hold of the threads that touch resources, built on what exists: the game thread pump, the Present hook (hold the render thread between frames, after the GPU's fence), the audio park. Measure what has to be held | A point where resources can be released and replaced without another thread using them |
| **HP3 Swap and resync** | Under the hold: swap the archive, drop cache entries for every path the old **or** the new archive has (comparing their file tables), then bring each holder up to date. Two ways to compare: (a) rebuild the holders the game's own way, as taking the item off and putting it back does; (b) replace resources in place, keeping the objects (the "replace game objects" idea) | Which way is reliable, and what each costs in time and risk |
| **HP4 GPU memory** | Release the old GPU buffers and textures only after the GPU has finished with them; respect texture streaming's budget | No device removal and no out-of-memory after many swaps |
| **HP5 The call** | `archives.reload(files, { refresh: true })` or `world.refresh()` in the package and MCP, with Equipment-EX support | A modder's swap shows on V and in the world at once |

HP0 can run now. HP1 to HP4 are research on game 2.31; each one's findings decide whether the next is worth doing.

## Rules

| Rule | Why |
|---|---|
| Static reading helpers (MSVC `dumpbin`, Python scripts) stay in the scratchpad; no game code or extracted data is committed | The repo's rule on game files |
| RED Hot Tools and ArchiveXL are MIT and may be read; Audioware has no licence and is never read | Clean room, as for the Sound API |
| Find game functions and tables by byte patterns, never fixed addresses, and check them with a test against the real exe (`REDNODE_GAME_EXE`), as `opus_test` does | Game 2.5 (2026-10-22) will move every offset; the port must only need new patterns |
| Every change to the game's state is behind a setting until its in-game test passes | As H1c-2's `"soundPakSwap": "reload"` |
| Read-only probes run under `__try`, and the fault watch (`faults.watch`) covers every swap | A wrong reading must not crash the player's game |

## Risks

| Risk | Notes |
|---|---|
| The engine's resource ownership is deep and spread over threads | HP1 may show a hold that is too broad to be practical. Then the fallback is HP3 (a): rebuild the holders, not the resources |
| Game 2.5 | Research on 2.31 now; every pattern needs checking on 2.5 before a release |
| Other mods hold references | ArchiveXL's dynamic appearances, Equipment-EX, wardrobe mods. Each needs a test |
| The crashes may not be the swap's | HP0 first, so the patch is aimed at the right problem. Every crash of 2026-10-22 came with a second copy of the game or without a swap |

## HP0 test

On the laptop, game 2.31. No swap in this test: it rules out the archive's own content. Make sure only one copy of the game runs (Task Manager shows one `Cyberpunk2077.exe`).

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. With the game closed: put `EDGEmatB.archive` (the version swapped at 10:08) in `archive\pc\mod`, and only it: no other version of the trousers, `archive\pc\hot` empty.
2. Start the game and load the save wearing the trousers. **Mark**.
3. Play for two minutes, looking at V's legs now and then. **Mark**.
4. Quit. If the game crashed, send the crash report folder (`%LOCALAPPDATA%\REDEngine\ReportQueue\`).

A crash here, with no swap, points at the archive's content. No crash points back at the swap.

### HP0 test: results

2026-10-22, on the laptop. The player loaded a save with each of the two new trouser versions installed normally, one at a time, with no swap. **Both worked**, with no crash. So the archives' content is fine, and a crash with them would come from the swap. Next in HP0: swap runs with only one copy of the game open (the clean archives test in [World API](world.md), "H2a clean archives: test (runs 1 and 2)").

### HP0: a swap crash with one copy of the game

2026-10-22 at 11:02, on the laptop after a reboot, one copy of the game (a copy of the 2.31 install, `Cyberpunk 2077 - Copy`), REDnode 0.26.16, Refresh test 0.2.3. The clean archives test, step 2: the first swap, of `EDGEmatA.archive`, in gameplay. An earlier try at 10:23 crashed at the same step, and its fault watch line is the same.

| Time | Log | What happened |
|---|---|---|
| 11:02:55.240 | Plugin | The press on **Swap** |
| 11:02:55.528 | Plugin, `rednode-faults.log` | The fault watch starts for the swap (the game thread is 44124) |
| 11:02:55.567 | RED Hot Tools, thread 44124 | `Archives reload requested...`, `Found archives: EDGEmatA.archive` |
| 11:02:55.569 | RED Hot Tools | `Unloading game archives...`, `Moving updated archives...` |
| 11:02:55.571 | RED Hot Tools | `Loading updated archives...`, its **last line** |
| 11:02:55 | Host | `The game has exited.` |

What it shows:

- The game died **inside RED Hot Tools' load of the new archive**, the step that calls the game's own `ResourceDepot::LoadArchives` on the game thread. It is the same place as the H0 crash (2026-10-18), the first H2a crash (2026-10-21) and H1c-2's first run.
- **Nothing caught it**: no fault reached REDnode's handler, the game's crash reporter wrote nothing, and the game did not call its own exit. That is the mark of a fail-fast (Windows ends the process at once on heap corruption or a failed security check, code `0xC0000409` or `0xC0000374`) or of a process ended from outside. Unverified which.
- It is not memory: the game ran at 43 fps for a minute before, and a lack of memory fails through the game's own reporter.

Open, to settle next:

| Question | How |
|---|---|
| Was the swap an **add** or a **replace**? RED Hot Tools replaces an archive of the same name in place, and **inserts** a new one into the depot's list | The player (2026-10-22): the first crash that morning was an add (the versions were named `EDGEmatA.archive` and `EDGEmatB.archive`, both in `archive/pc/mod`); for the 11:02 run both were renamed `EDGEmatA.archive`, so it was a **replace**. `EDGEmatB.archive` was no longer in `archive/pc/mod` at 11:02 (the player), so it was a clean replace. Nine replaces of the older `EDGEmat_M3.archive` passed on 2026-10-21. Next: one session in today's setup that replaces `EDGEmat_M3` first, then the new archive, to tell the setup from the archive |
| What the fail-fast is and where | Windows error reporting's own dumps (`LocalDumps` for `Cyberpunk2077.exe`, set by the player), which catch a fail-fast; Event Viewer's Application log (events 1000 and 1001) for the exception code and module |

### HP0: the control run

2026-10-22 at 11:23, on the laptop, one copy of the game, REDagent off. Yesterday's `EDGEmat_M3.archive` (the leather look installed, the base look swapped in), which passed nine replaces on 2026-10-21, **crashed at the first swap**, the same way: the fault watch started at 11:23:34.710, and the plugin log ends there. So the new archives are not the cause; something in the setup changed.

| | 2026-10-21, 18:38 (passed) | 2026-10-22, 11:23 (crashed) |
|---|---|---|
| Game folder | `...\steamapps\common\Cyberpunk 2077` | `...\steamapps\common\Cyberpunk 2077 - Copy` |
| REDnode | 0.26.15 | 0.26.16 (no change on the swap path) |
| Archive | `EDGEmat_M3.archive` | the same |

The game folder is the clear difference: every crash of the morning ran in the copy. How a copied folder could make the archive load die is not known (another mix of mods or plugin versions in the copy, or something in it that was not copied, are guesses). Next: the same swap in the main folder, and the two sessions' RED4ext logs compared.

A Windows dump of the 10:09 GPU crash (`Cyberpunk2077.exe.42248.dmp`, from Windows error reporting) has a real stack: only the game's own code, the render side's check that found the device removed. No mod's module is on it.

### HP0: who ends the game (REDnode 0.26.17)

The crashes inside the archive load leave no fault, no crash report and no exit line. If Windows error reporting's dump setting was on and still no dump came, the game was most likely ended by a `TerminateProcess` call, which Windows does not report. REDnode 0.26.17 (asked for by the player on 2026-10-22) names it:

| Part | What it does |
|---|---|
| `native/src/overlay/faults.cpp` | At the first fault watch, hooks ntdll's `NtTerminateProcess` (under `TerminateProcess`, `ExitProcess` and `abort`) and kernelbase's `RaiseFailFastException` through RED4ext's hooking. While a watch is on, a call that ends this process is written to `rednode-faults.log` as "the game is being ended by ..., status 0x..., on thread ..." with its stack, before it goes ahead. At most 4 per watch. The plugin log says whether the hooks attached |
| Not covered | A `__fastfail` instruction skips both; Windows error reporting's own dumps catch it. A process ended from outside leaves nothing in the game |
| Unit tests | `native/tests/faults_test.cpp`: an end during a watch is written with its status and stack, at most 4 a watch, nothing after the plugin stops |

### HP0 run with 0.26.17: test

On the laptop, in the `Cyberpunk 2077 - Copy` folder, one copy of the game, REDnode 0.26.17 (the update zip over 0.26.16), REDagent off.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. With the game closed: the leather `EDGEmat_M3.archive` in `archive\pc\mod`, no other version, `archive\pc\hot` empty. Start the game, load the save wearing the trousers. **Mark**.
2. In **Refresh test**, swap the base look `EDGEmat_M3.archive`. **Mark** if the game is still running.
3. Send `rednode-faults.log`, the plugin log of the session (its line "Faults: exit hooks attached" matters), the RED Hot Tools log, and any new dump in `%LOCALAPPDATA%\CrashDumps`.

### HP0: the game ends itself (0.26.17 run)

2026-10-22 at 11:42, on the laptop, the `Cyberpunk 2077 - Copy` folder, one copy of the game, REDnode 0.26.17, the control swap (`EDGEmat_M3.archive`, the leather look installed at start, the base look swapped in). The exit hooks attached, and the fault log has the answer:

```
11:42:27.636 watch for 15 s: swap of EDGEmat_M3.archive (the game thread is 29036)
11:42:27.681 the game is being ended by TerminateProcess, status 0x00000001, on thread 29036 (the game thread)
  stack: REDnode.dll (the hook) <- KERNELBASE.dll <- Cyberpunk2077.exe+0x29cea69 <- Cyberpunk2077.exe+0x7bbc29
         <- RedHotTools.dll+0x50e5a <- +0x552d0 <- +0x64ec9 <- Cyberpunk2077.exe (the script call) <- ... <- REDnode.dll (the swap call)
```

A static reading of the 2.31 exe (the helpers stay in the scratchpad):

| Address | What it is |
|---|---|
| `+0x29cea50` | The engine's fatal quit: a 30-byte function that calls through a function pointer, here `TerminateProcess(1)`. No crash report, no exit handlers |
| `+0x7bba48` | The resource depot's archive load (`resourceGameDepot.cpp`), called by RED Hot Tools' `LoadModArchives` through `ResourceDepot::LoadArchives`. Each failure is a fatal assert: "Could not open archive %hs for async reading of contents", "Failed to create the archive %hs", "Could not open archive %hs for reading", "Failed to load archive %hs, error %u, try regenerating archives!", "LoadEntireArchiveIntoMemory failed: %hs" |
| `+0x7bbc24` | The call that ended the game sits in the branch of **"Failed to load archive %hs, error %u, try regenerating archives!"** (assert `result == archive::LoadingResult::SUCCESSFUL`, line 0x26C) |
| `+0x7bcf9c` | The check that returned the error. It reads the first 4 KB through the archive's reader and fails when: the reader's size is under 4 KB; the magic is not `RDAR`; the version is not 11 or 12 (20 takes another path); **the header's file size (+0x20) differs from the reader's size**; the index runs past the file's end; the index offset or the file size is not a multiple of 4 KB; then checks on the index itself |

So the swapped archive failed the engine's own checks at the moment of the swap, and the engine quits on purpose. The same files load fine at start (HP0 test), so the engine read something at the swap that does not match the file on disk. A lead to test (unverified): the size check compares the archive's header with the size its reader reports; if the reader is a reopened handle (RED Hot Tools reopens the old archive's handle before the load) that still reports the old file's size, two versions of different sizes fail and two of the same size pass.

The four test archives, read on the dev PC with the engine's header checks (a scratchpad script, not committed):

| Archive | Size (bytes) | Version | Files | Engine's checks |
|---|---|---|---|---|
| `EDGEmat_M3.archive`, leather | 14,467,072 | 12 | 27 | pass |
| `EDGEmat_M3.archive`, base look | 13,959,168 | 12 | 25 | pass |
| `EDGEmatA.archive`, version 1 | 6,348,800 | 12 | 9 | pass |
| `EDGEmatA.archive`, version 2 | 6,340,608 | 12 | 9 | pass |

Every file passes on disk, and the two versions of each pair differ in size, which fits the lead of a reader reporting the old size. The two `EDGEmatA` versions share only 2 of their 9 paths, so they are not the "same file list" pair the H2 tests assumed.

The check's error numbers (2.31): **1**, the header is wrong for the file (under 4 KB, not `RDAR`, the header's size differs from the reader's, the index past the end, not 4 KB aligned); **2**, an unsupported version; **4**, the header or the index could not be read; any other number comes from the index's own parse (`+0x7bd31c`). The number in the engine's message would tell a size mismatch (1) from a dead file handle (4).

The player adds (2026-10-22): the `EDGEmat_M3` archives were rebuilt for other EDGEmat tests after 2026-10-21, so today's two versions are not the files that passed nine swaps that day. Yesterday's passes therefore do not count against the size lead. Next, a test with no new build: install `EDGEmatA.archive` version 1, swap the identical file (same size), then version 2 (a different size). If the identical swap passes and version 2 ends the game, the size lead holds.

### HP0: the identical file fails too; REDnode 0.26.18

2026-10-22 at 11:56: a swap of `EDGEmat_M3.archive` with the same file that was installed (the player) ended the game the same way (`TerminateProcess(1)` from the engine's fatal quit, after the archive load). The sizes matched, so the size lead is out.

REDnode 0.26.18 adds the engine's own message to the fault log. The engine's assert reporter (`+0x29ce848` in 2.31) formats every assert message into one 1 KB buffer (`+0x3b268f0`) before the fatal quit. The plugin finds the buffer by the reporter's `lea` (one match in 2.31; none or several turn it off) and, when the game is ended during a watch, writes "the engine's last message: ..." under the stack: for this failure, the archive's path and the error number (1 a header that does not fit the file, 2 a version, 4 a read that failed).

### HP0 run with 0.26.18: test

On the laptop, `Cyberpunk 2077 - Copy`, one copy of the game, REDnode 0.26.18 (the update zip over 0.26.17).

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. With the game closed: one `EDGEmatA.archive` (version 1) in `archive\pc\mod`, `archive\pc\hot` empty. Start the game, load the save. **Mark**.
2. In **Refresh test**, swap version 1 itself (the identical file). **Mark** if the game is still running.
3. Send `rednode-faults.log` (its last lines carry the engine's message) and the plugin log (its line "the engine's message buffer found").

### HP0 run with 0.26.18: results

2026-10-22 at 12:15, on the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.26.18, the identical `EDGEmat_M3.archive` swapped over itself. The plugin log: "the engine's message buffer found". The game was ended the same way, and the fault log now carries the engine's words:

```
the engine's last message: Failed to load archive C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077 - Copy\archive\pc\mod\EDGEmat_M3.archive, error 1, try regenerating archives!
```

Error 1 with a file that passes every check on disk, and an identical file at that, means the reader the engine used reported something other than the file: most likely a size of 0, the first check (a reader whose file handle is closed reports no size). A lead from RED Hot Tools' source (MIT, `ArchiveLoader.cpp`), unverified:

| Step | What RED Hot Tools does |
|---|---|
| Unload | Closes the system handle of the mounted archive with the same path |
| Move | Deletes the old file, renames the new one into its place |
| Load | Finds the old archive's entry with `std::lower_bound` and `strcmp` (`FindArchivePosition`), and **reopens its handle only if that finds it**; then calls the engine's load |

`lower_bound` with `strcmp` finds the entry only if the engine keeps the mod archives in `strcmp` order (case-sensitive: every uppercase letter before every lowercase one). If the engine orders them another way, such as case-insensitively, the search can miss an archive whose name starts with uppercase letters (`EDGEmat_M3`, `EDGEmatA`) among names that start with lowercase ones. Its handle then stays closed, and the engine's load reads through it and fails with error 1. Whether it misses depends on the other archives' names around it, which would explain why a swap of the same name can pass in one setup and fail in another.

Next, a test with no new build: the same file under a name that sorts the same both ways, such as `zzz_rednode_test.archive` (after every other name, case-sensitive or not).

### HP0: the name test

2026-10-22 at 12:21, on the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.26.18. `EDGEmatA.archive` version 1 renamed `zzz_rednode_test.archive`, alone in `archive\pc\mod`:

| Time | Swap | Result |
|---|---|---|
| 12:21:57 | The identical file | **Passed**, 0 faults |
| 12:23:55 | Version 2 under the same name (another size) | **Passed**, 0 faults |

The same swaps under the names `EDGEmat_M3.archive` and `EDGEmatA.archive` ended the game every time in this setup. Only the name changed, which supports the lookup lead: RED Hot Tools' `FindArchivePosition` (`lower_bound` with `strcmp`) misses an archive whose name sorts differently case-sensitively and case-insensitively among the other mod archives, so its closed handle is never reopened and the engine's load fails with error 1. Still unverified: the engine's own order of the mod archives (to be checked against the folder's file names).

After that, the player pressed **Reset look** (nothing changed) and then **Re-attach** (`RefreshAttachment`), which crashed the game with a crash report at 12:24:34: an access violation reading address `0x1EC` (a null pointer plus an offset), at `0x7ff7734a0ac4`, about 128 KB below the game exe's start, where hooking libraries put their trampolines, so inside some mod's hook. The dump holds too little of that thread's stack to say whose. A separate crash, on H2's side: refreshing a worn item after a swap. Kept for H2.

### HP0: the lookup, simulated

The laptop's `archive\pc\mod` in `Cyberpunk 2077 - Copy` (2026-10-22): `###_nim_material_override`, `basegame_hud_minimap_scanner_tweak`, `clothing_Fia_00Leggings`, `EquipmentEx`, `instant_wardrobe`, `LimitedHUD`, `SkippySkippy` (`.archive`), plus `.xl` files and `modlist.txt`. RED Hot Tools' `FindArchivePosition` simulated over that list with each test archive added (a scratchpad script):

| Archive | Engine keeps the list case-insensitively | Engine keeps it case-sensitively |
|---|---|---|
| `EDGEmat_M3.archive` | **missed** (lands on `basegame_hud_...`) | found |
| `EDGEmatA.archive` | **missed** (lands on `basegame_hud_...`) | found |
| `zzz_rednode_test.archive` | found | found |

With a case-insensitive order (Windows' own), the simulation matches every result of the day: both `EDGEmat` names fail, `zzz_rednode_test` passes. In `strcmp`, every uppercase letter sorts before every lowercase one, so `EDGEmat...` belongs before `basegame...`; in Windows' order it sits after `clothing_...`. `lower_bound` therefore stops on the wrong entry, RED Hot Tools does not reopen the closed handle, and the engine's load fails with error 1.

Still open: why the `EDGEmat_M3` swaps of 2026-10-21 passed in the main folder (the folder's other archives, or `modlist.txt`, may have differed then), and the engine's exact order rule (case-insensitive is inferred, not read from the exe).

RED Hot Tools' current source (1.3.0-rc.3, 2026-10-20) still uses this lookup, and its issues have no report of it (checked 2026-10-22). The fix there is small: find the archive by comparing paths one by one (or case-insensitively, as the engine orders them), for both the reopen and the insert.

### HP0: a fix in RED Hot Tools

Agreed with the player on 2026-10-22: fix RED Hot Tools locally and test the fix in the game before reporting it upstream. Built from `v1.3.0-rc.3` (the current release) with xmake, as in [dev setup](dev-setup.md), section 11, in a clone beside the other repos, branch `fix/archive-lookup`:

| Commit | What |
|---|---|
| Build fixes | Two missing address entries, and mimalloc 2.x for TiltedCore: the published source does not build without them |
| The fix | `FindArchivePosition` first looks for the archive's exact path in the group, then falls back to the binary search (only used for where a new archive goes). So the mounted archive is found whatever the game's order, its handle is reopened, and a replace writes over its entry instead of inserting a second one |

The unchanged rc.3 build is kept in the scratchpad as a control. The fixed DLL went to the laptop as `RedHotTools-1.3.0-rc.3-lookupfix.zip`.

### HP0: the fix's test

On the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.26.18, the fixed `RedHotTools.dll` in place of the installed one (backed up first).

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. With the game closed: back up `red4ext\plugins\RedHotTools\RedHotTools.dll`, then put the fixed one in its place. Put `EDGEmatA.archive` version 1 in `archive\pc\mod` (the uppercase name that failed), take out `zzz_rednode_test.archive`, empty `archive\pc\hot`. Start the game once, load the save. **Mark**.
2. In **Refresh test**, swap `EDGEmatA.archive` version 1 itself (the identical file). **Mark** if the game is still running.
3. Swap `EDGEmatA.archive` version 2. **Mark**.
4. Swap version 1 again. **Mark**.
5. Quit. Send `rednode-faults.log`, the plugin log and the RED Hot Tools log.

### HP0: the fix's test: results

2026-10-22 at 12:47, on the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.26.18, the fixed `RedHotTools.dll`, `EDGEmatA.archive` (the name that ended the game every time before). **Passed**: four swaps, each logged by RED Hot Tools through "Archives reload completed." and each with 0 faults, then a clean quit.

| Time | Swap | RED Hot Tools | Faults |
|---|---|---|---|
| 12:49:11 | Version 1, the identical file | completed in 66 ms | 0 |
| 12:49:33 | Version 2 | completed in 63 ms | 0 |
| 12:50:01 | Version 1 | completed in 65 ms | 0 |
| 12:50:05 | Version 2 | completed in 70 ms | 0 |

So the swap crashes of 2026-10-22 came from RED Hot Tools' archive lookup, and finding the archive by its exact path fixes them. What it means:

| For | What |
|---|---|
| RED Hot Tools | A report upstream with this evidence and the tested change (with the owner's OK, since it is posted under their account) |
| REDnode | Until a fixed RED Hot Tools is released, players with an archive named like this will lose their game on a swap. REDnode can run the same lookup before each swap and refuse with a clear message when it would miss (proposed) |
| H2 | Swaps of uppercase-named archives work with the fix, so H2's refresh tests can go on with the fixed DLL on the laptop |

