# Quest API

Status: **Q-A built on 2026-10-22 in REDnode 0.32.0**, awaiting its in-game test ([Q-A test](#q-a-test)). It answers [EDGEquest](https://edgemodders.github.io/EDGEquest/design.html)'s request [#15](https://github.com/Edgemodders/REDnode/issues/15), for its phase Q3 "Try it": pack and deploy a quest, then drive it and watch it in the running game, from EDGEquest's `quest_try` and from an assistant, without raw `api_call`.

## What the game has

Read from the API dump and the game's scripts:

| Need | The game's calls |
|---|---|
| Facts | `QuestsSystem.GetFact(name)` and `SetFact(name, value)` (`GameInstance.GetQuestsSystem`). An unset fact reads 0 |
| Watching facts | `QuestsSystem.RegisterListener(name, object, function)` calls a script function with the new value when the fact changes; `UnregisterListener(name, id)` |
| The journal | `JournalManager` (`GameInstance.GetJournalManager`): `GetEntryByString(path, class)`, `GetEntryState(entry)` (Inactive, Active, Succeeded, Failed), `ChangeEntryState(path, class, state, notify)`, `TrackEntry`, `GetTrackedEntry` |
| Moving V | `TeleportationFacility` (`GameInstance.GetTeleportationFacility`): `Teleport(object, position, orientation)` and `TeleportToNode(object, nodeRef)` |
| Starting a phase or jumping to a node | **Not found.** No call in the dump or the scripts starts a quest phase or a node. Setting the facts a phase waits for is the route the request names; a spike would settle whether there is another |

## Q-A: the calls

| Call (the `rednode` package) | Does |
|---|---|
| `quests.fact(name)`, `quests.facts(names)` | Read one fact, or several at once |
| `quests.setFact(name, value)` | Set one. It changes the player's save |
| `quests.watch(names, (change) => …)` | Hear every change of the named facts (`{ name, value }`), with no polling: a small script class, `REDnodeFactListener`, is registered with the quests system for each name and sends a game event. Registered again after each save load. Returns a function that stops it |
| `journal.entry(path, kind?)` | An entry's state (`"Inactive"`, `"Active"`, `"Succeeded"`, `"Failed"`), and whether it is tracked; `null` when the path is not in the journal. `kind`: `quest`, `phase`, `objective` (the default), `subobjective`, `mappin`, or a class name |
| `journal.setState(path, state, kind?)` | Change it, with the game's notification. It changes the save |
| `journal.track(path, kind?)` | Track an objective |
| `game.player.teleport({ x, y, z, yaw? })` or `({ nodeRef })` | Move V to a position, or to a node by its reference (`"$/…"`, or its hash: unverified which the game takes) |

| MCP tool | Asks first | Does |
|---|---|---|
| `game_facts` | No | Reads facts |
| `game_facts_set` | Yes | Sets facts |
| `game_journal` | No | Reads entries |
| `game_journal_set` | Yes | Changes an entry's state, or tracks it |
| `game_teleport` | Yes | Moves V |

The names start with `game_`, so they do not clash with EDGEquest's own `quest_*` tools in the same assistant.

Not in Q-A: starting a phase or a node (no game call found); whether a running phase or scene picks up an archive swapped in with `archives_reload` (EDGEquest's Q3 question, a case for H2's refresh).

## Q-A test

On the laptop, REDnode 0.32.0 (update zip over 0.31.0). **Quest test** in the launcher.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Switch on **Quest test**. Load a save. **F10**. Press **Read**: the facts in the field are listed with their values (a made-up name reads 0). **Mark**.
2. Press **Watch**, then **Set +1** a few times: each change shows in the log at once, from the watcher (not from the button). **Mark**.
3. In the journal field, the path of an objective you have (the app fills in the tracked one with **Tracked**): **Read entry** shows its state. **Mark**.
4. Press **Here** (fills in V's position), walk 20 m away, press **Teleport**: V is back. **Mark**.
5. Load the save again, press **Set +1**: the watcher still reports it. **Mark**.
6. With Claude Code connected to REDnode's MCP server: ask it to read the fact `rednode_test`, then to set it to 5. Reading does not ask; setting asks. **Mark**.
7. Quit. Send `rednode-mods.log`.
