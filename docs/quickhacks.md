# Quickhack functions

Status: **H3c.2 passed in game on 2026-11-11** (REDnode 0.61.1, on the laptop; [results](#quickhack-functions-test)): every step but spread, which was not run. Its first run, on 0.61.0, failed at the define ([first run](#first-run-0610)). EDGEhack's Scripts section (its H3c.3 and H3c.4, passed in game the same day) writes a mod's `quickhacks.define` for it, into a REDnode package the mod ships. It answers [EDGEhack](https://edgemodders.github.io/EDGEhack/design.html#h3c-scripts-plan)'s request [#42](https://github.com/Edgemodders/REDnode/issues/42): a quickhack can carry two functions, for what its TweakDB records cannot say. Open to any mod, not only EDGEhack's. People only for now: devices build their list elsewhere.

| Function | When | Does |
|---|---|---|
| **Scan check** (`canUse`) | While V scans a person, for each hack it is defined on | Returns true or false: the hack shows usable or disabled on that person |
| **On land** (`onLand`) | When the upload completes on a living person | Any logic: more damage, a status effect, damage worked out from the target's state |

```js
import { quickhacks } from "rednode";

// Overheat only on people, and harder on the wounded.
await quickhacks.define(
  ["Items.OverheatProgram", "Items.OverheatLvl1Program", "Items.OverheatLvl2Program",
   "Items.OverheatLvl3Program", "Items.OverheatLvl4Program", "Items.OverheatLvl4PlusPlusProgram"],
  {
    canUse: (target) => target.isHuman,
    disabledText: "People only",
    async onLand(target, hack) {
      if (target.healthPercent < 50) await target.damage(40 * hack.tier);
    },
  },
);
```

## The calls

| Call (the `rednode` package) | Does |
|---|---|
| `quickhacks.define(items, { canUse?, onLand?, disabledText?, hold? })` | `items` is one quickhack item record, or a family's items lowest tier first. REDnode finds their hacks itself (each item's `objectActions` of type `PuppetQuickHack`), with their Boss and Chimera versions and each one's `…Spread` action. A hack another package has defined is refused. Called before a save is loaded (the game starting, the main menu), it resolves at once and the functions start with the next load; a mistake then goes to the mod log instead of throwing. They are set again after each load. Resolves to a function that takes the define away |
| `quickhacks.defined()` | This package's defines: `{ items, actions }` |
| `quickhacks.counts()` | The script's counters (defines, list rebuilds, asks, answers given up on, landings), for tests |

What a function gets:

| `target` | |
|---|---|
| `id` | The person's entity ID hash, as a string |
| `level`, `health`, `healthPercent` | As they were when the game asked (`healthPercent` 0 to 100) |
| `isHuman`, `isBoss`, `isMechanical`, `isDrone`, `isAndroid`, `isElite`, `isCivilian` | Its kind |
| `damage(amount)` | Lowers its health by `amount` points with V as the one who did it. No damage type: for typed damage, `addEffect` with a damage effect, as the game's own hacks do. Whether a kill this way counts as V's is unverified |
| `addEffect(effect)` | A status effect on it from V, such as `"BaseStatusEffect.ContagionPoisonLvl2"` |

| `hack` | |
|---|---|
| `action` | The hack's action record, such as `"QuickHack.OverheatLvl2Hack"`; its id (`"0x…"`) when the package has not seen the name (`tweakdb.learn` teaches it) |
| `item`, `tier` | The first item in the list that has this hack, and its place in the list from 1: the tier, when the list is lowest tier first |
| `spread` | `onLand` only: it reached this person by spreading (its `…Spread` action) |
| `byV` | `onLand` only: V uploaded it |

For anything else, `api` reads and changes the game as usual, with `target.id` as the entity.

## How the scan check works

The game builds a person's quickhack list in one go, on its own thread, and cannot wait for a Node mod (Tier 2). So REDnode's script `REDnodeQuickhacks.reds` asks, remembers and refreshes, as EDGEhack's spike H3c.1 did in the game on 2026-11-05:

1. When the game builds the list (`ScriptedPuppet.TranslateChoicesIntoQuickSlotCommands`, wrapped), a hack with a check and no answer yet shows locked with "Checking...", and the package gets an event with the person and a snapshot (level, health, kind), so a plain check needs no game call.
2. `canUse` answers. The script remembers the answer per person and hack, and asks the game to rebuild the list (`QuickhackModule.RequestRefreshQuickhackMenu`) when it changed.
3. "Checking..." stays up for `hold` seconds (1 by default) the first time V scans that person, whatever the answer, so it can be read; the owner chose this in the spike. Later scans of that person show the answer at once, and ask again at most four times a second while the list is open.
4. With no answer within 1.1 s (the mod is off, `canUse` threw or hung), the game's own result stands; the mod log says why when it threw.

A `canUse` that reads only `target` answers fastest: each game call costs about a frame. At most 512 answers are kept; the oldest go first.

**On land** has no such catch: a wrap on `ScriptableDeviceAction.CompleteAction` sends the event when a defined hack completes on a living person, and `onLand` runs a frame or two later. It adds to what the hack does and cannot cancel it: a hack that should not land at all needs a scan check.

**When a package stops** (switched off, restarted, hot reloaded), the host calls the script's `Release` with its id: its checks and functions go, and every hack is the game's own again. A package can define only under its own id.

The scan's snapshot and the landing reach the package as game events with a text, `quickhacks.scan` and `quickhacks.land`, sent by the plugin's new `REDnode_EntityText(name, entityID, text)`. It is open to any script: a text that changes each time, unlike `REDnode_EntityEvent`'s class name, makes no new game name (CName).

**Ids, not names.** The running game answers a record link as its id (`0x…`) unless the package has seen the name. So `quickhacks.define` finds a hack's type flat and its `…Spread` record from the id itself: a TweakDB id is the CRC32 of the name and its length, and a CRC32 can be carried on over more text without the text before it, so `QuickHack.OverheatHack`'s id and the suffix `Spread` give `QuickHack.OverheatHackSpread`'s id (checked against the game's ids). This works for records TweakXL adds too, such as EDGEhack's.

## Open, for the test

From the spike, still unverified:

| Question | How the test answers it |
|---|---|
| Does a status effect from a function work? | Step 9: **yes** (0.61.1) |
| Does a kill by `target.damage` count as V's (experience, the kill feed)? | Step 10: the kill worked as expected (0.61.1) |
| Does spread reach `onLand`, with `hack.spread`? | Step 11, if V has a way to spread Overheat. **Not run yet: unverified** |
| Do Boss and Chimera versions reach both? | Not in this test unless a boss is handy. **Unverified** |

## Quickhack functions: test

REDnode 0.61.1, on game 2.5. Overheat in V's cyberdeck. The **Quickhack test** app gives the game's Overheat family both functions, switched between rules with its buttons, and logs each ask and landing.

| Step | Do | Expect |
|---|---|---|
| 1 | Load a save. In REDnode's launcher (F10), switch on **Console** and **Quickhack test**. If V has no Overheat in the cyberdeck: in the Console, `await game.player.addItem("Items.OverheatLvl2Program")`, then put it in the cyberdeck | The app's window says "Overheat is defined: … hacks" (on before the save loaded, it says so about 2 s after the load), and its log lists them by name, `QuickHack.OverheatHack` and the rest |
| 2 | Press F10 to close the overlay, scan a person | Overheat shows "Checking..." for about a second, then usable. The log has an "Asked" line with the person's level, health and "human" |
| 3 | Press **Nobody** (F10, then F10 again), scan a new person | "Checking..." for a second, then disabled with "Not on this enemy (test)". Uploading it does nothing |
| 4 | Scan the same person again | Disabled at once, with no "Checking..." |
| 5 | Press **Humans**. Scan a person, then a drone or a robot if one is handy | Usable on the person, disabled on the machine |
| 6 | Press **Silent**, scan a new person | "Checking..." for about a second, then usable: no answer, so the game's own result stands |
| 7 | Press **Throws**, scan a new person | The same as step 6, and the Mod log says "canUse for … threw" |
| 8 | Press **Everyone** and **Damage**. Upload Overheat on a person with plenty of health | It burns as usual. The log has a "Landed" line, then "Damage 30: done", and the person's health drops a further 30 |
| 9 | Press **Effect**, upload Overheat on another person | Burning, and poisoned too. The log says "Poison: applied" |
| 10 | Press **Kill**, upload Overheat on another person | They die. Say whether it looked like a normal kill, and whether Intelligence's skill experience went up |
| 11 | If V can spread Overheat (the Spillover perk with Overclock active, or a cyberdeck's ability), press **Nothing** and upload it into a group. Skip this if not | A "Landed" line for each person it spread to, marked "spread" |
| 12 | Press **Counts** | A line with defines, rebuilds, asks, gave up and landed |
| 13 | Press **Nobody**. In the launcher, switch **Quickhack test** off, then scan a new person | Usable at once, with no "Checking...": the functions went with the package. The host log says "Released … quickhack functions of quickhack-test" |
| 14 | Switch **Quickhack test** on again, then load another save (or the same one) and scan a person | "Checking..." then usable (the rule is back to Everyone after the restart): the functions were set again after the load |

Then quit the game and say what differed. I read REDnode's logs and redscript's log.

### First run (0.61.0)

| Seen | Why | 0.61.1 |
|---|---|---|
| "The game did not answer within 5 seconds" from the app started with the game | Its define ran while the game was starting, when calls can wait for seconds | A define made before a save is loaded waits for the load |
| "… have no quickhack actions" from **Define** with a save loaded | The game answered each item's hacks as ids (`0x…`), and the define built each hack's flat path from its name, so it read nothing. The mock game answered names, so its check passed | Hacks are found from their ids (see "Ids, not names"); the mock game now answers ids, as the game does, and its 9 checks pass on both hosts |

| Run | Result |
|---|---|
| 2026-11-11, laptop, 0.61.1 (the update zip over 0.59.1) | **Pass**, steps 1 to 10 and 12 to 14, as written: the define, "Checking" then usable, Nobody and the remembered answer, Humans, Silent and Throws leaving the game's own result, Damage, the poison from V, the kill, Counts, the functions gone with the package and set again after a load. Step 11 (spread) not run |
| 2026-11-11, laptop, 0.61.0 (the update zip over 0.59.1) | **Failed at step 1**: the app, on from the game's start, said "The game did not answer within 5 seconds" (its define ran while the game was starting); **Define** with a save loaded said the six Overheat items "have no quickhack actions". See [first run](#first-run-0610) |
