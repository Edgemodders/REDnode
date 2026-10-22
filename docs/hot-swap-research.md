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
| Was the swap an **add** or a **replace**? RED Hot Tools replaces an archive of the same name in place, and **inserts** a new one into the depot's list | The player (2026-10-22): the first crash that morning was an add (the versions were named `EDGEmatA.archive` and `EDGEmatB.archive`, both in `archive/pc/mod`); for the 11:02 run both were renamed `EDGEmatA.archive`, so it was a **replace**. Open: whether `EDGEmatB.archive` was still in `archive/pc/mod` at 11:02. Nine replaces of the older `EDGEmat_M3.archive` passed on 2026-10-21 |
| What the fail-fast is and where | Windows error reporting's own dumps (`LocalDumps` for `Cyberpunk2077.exe`, set by the player), which catch a fail-fast; Event Viewer's Application log (events 1000 and 1001) for the exception code and module |

