# VATS: Visual Assisted Targeting System

Status: **initial research, 2026-11-14, with the owner's play design added the same day; nothing built.** A mod idea from the owner: during combat, scan an enemy, zoom in with another button, and pick one of its body parts to target: head, torso, left arm, right arm, left leg, right leg. This page covers the first part, **body part targeting**: can REDengine highlight the parts itself, or does REDnode draw them over the game? It lives in REDnode's docs while the parts it needs are REDnode's; the mod may get its own repository later.

Sources: the 2.5 game API dump (`gameapi/2.5/rtti.json`), the game's files read through REDbridge, and a decompile of the game's scripts from an earlier version (2.5 may differ). Everything below is unverified in the game unless it says otherwise.

## The short answer

**Both, split by job.** The engine knows exactly where each body part is and can aim at it, zoom the camera and slow time. It has no built-in way to outline one limb, because a body is one mesh. So the first build has REDnode draw the six parts over the game, placed by the plugin each frame as world pins are. A spike tries to draw parts in the engine's own picture instead, with small glowing shapes attached to the bones.

## How VATS plays

The owner's design, 2026-11-14.

| Step | What happens |
|---|---|
| Scanning | The game's scanner works as it does today |
| Enter VATS | While scanning, the VATS button: the camera zooms onto the scanned enemy, time slows far more than the scanner's own slow motion, and the body part targeting and highlights take over |
| In VATS | The player picks an enemy (the camera moves easily from one enemy to another) and a body part, then attacks it with **quickhacks** or a **smart gun**. The quickhack wheel is the game's own; in VATS only the VATS quickhacks (made with [EDGEhack](https://github.com/Edgemodders/EDGEhack)) are enabled |
| Leave VATS | The VATS button again, with the scanner button still held: back to normal scanning |
| Cancel | Letting go of the scanner cancels VATS too. VATS also has a timed duration: when it runs out, VATS ends, back to scanning, or out of scanning if the scanner is no longer held |

As states:

| State | VATS button | Scanner released | Timer runs out |
|---|---|---|---|
| Not scanning | Nothing | | |
| Scanning | Enter VATS | Not scanning | |
| VATS | Back to scanning (scanner still held) | Not scanning (VATS ends with it) | Scanning if the scanner is held, else not scanning |

### What each part of it needs

| Part | Engine side | Notes and unknowns |
|---|---|---|
| Knowing the scanner is up | The player's vision mode (`PlayerVisionModeController`, the scanner's blackboard `UI_Scanner`, `gameVisionModeSystem`) | Which signal tells "scanner held" most reliably is unverified |
| The VATS button | The mod's own redscript input listener, until REDnode's I3 Input | One button enters and leaves; the scanner button is the game's own |
| Zoom onto the enemy | The player's camera: `SetFOV`/`SetZoom` (spike V3) | Turning the view onto the enemy, and on to the next one, is the targeting system's `LookAt` or the camera itself (unverified). "Moves easily between enemies" suggests snapping to the next enemy with a key or stick, not free aiming |
| Deeper slow motion | `TimeSystem.SetTimeDilation` (the world) with `SetIgnoreTimeDilationOnLocalPlayerZero` or `SetTimeDilationOnLocalPlayerZero` for V; per object `SetIndividualTimeDilation` | The scanner's own slow motion was never found in the global dilation (REDnode's sound spike), so how VATS's dilation stacks with it is unverified. The Sandevistan sets the world's to 0.3 and leaves V at 1: VATS could go much lower, such as 0.05 (to try) |
| Only VATS quickhacks in VATS | The game's own wheel. Its list is built by `TranslateChoicesIntoQuickSlotCommands`, which EDGEhack's scripts can wrap to mark every other quickhack unusable while VATS is on (decided with the owner, 2026-11-14: no wheel of its own, and EDGEhack's scripts handle it). The VATS quickhacks are usable only in VATS | REDnode needs nothing new. REDnode's quickhack functions ([Quickhack functions](quickhacks.html), #42) wrap the same function, and redscript chains wraps, so both run (unverified together). A REDnode package's own VATS hacks could also use `quickhacks.define`'s `canUse` and `disabledText` ("VATS only") |
| A quickhack on a body part | A quickhack lands on the whole target. The part is VATS's own choice, passed to the hack's effect (`onLand` in `quickhacks.define` knows the target) | Which part was picked travels from VATS to the hack's effect in the mod's own code |
| The smart gun on a body part | Smart gun targets already carry a bone: `gamesmartGunUITargetParameters.attachedBoneName`, with lock events (`gamesmartGunSmartGunLockEvent`) and target sorting in TweakDB (`SmartGunTargetSortData` records) | Steering its lock to the chosen part's bone is unverified (spike V6) |
| The duration | A timer that ends VATS | On which clock: in a slowed world, a real-time timer feels right for a player's budget, while game time would stretch it. REDnode's proposed game-time timers would offer both |
| Ending cleanly | Every change undone: camera zoom, time dilation, the quickhacks switched off, the highlights | Also when the player dies, a scene starts or a menu opens during VATS |

## What the engine already has

### Every NPC has body part shapes

Shots are not tested against the visible mesh. They hit **hit shapes**: capsules, spheres and boxes attached to the skeleton (`gameHitRepresentationComponent`, data in a `.hitrepresentation` file). The game has 42 such files. The one for ordinary human NPCs, `base\characters\base_entities\npc_base\npc_base.hitrepresentation`, holds 15 shapes. Each one names a bone slot, a hit reaction zone and a dismemberment part:

| Shape (and slot) | Hit reaction zone | VATS part |
|---|---|---|
| Head | Head | **Head** |
| Chest | ChestRight | **Torso** |
| LeftTorso | ChestLeft | **Torso** |
| RightShoulder | ChestRight | **Torso** |
| Belly | Abdomen | **Torso** |
| LeftArm | ArmLeft | **Left arm** |
| LeftForeArm | HandLeft | **Left arm** |
| RightArm | ArmRight | **Right arm** |
| RightForeArm | HandRight | **Right arm** |
| LeftUpLeg, LeftLeg, LeftFoot | LegLeft | **Left leg** |
| RightUpLeg, RightLeg, RightFoot | LegRight | **Right leg** |

The LeftArm capsule, for example, is 0.08 m in radius and 0.25 m long, centred on its slot. Group shapes by name or hit reaction zone, not by the dismemberment part: that field puts LeftTorso under LEFT_ARM and Chest under RIGHT_ARM.

Each shape's data is a `HitShapeUserDataBase`: its type (`Flesh`, `Metal`, `Cyberware`, `Armor`), whether it is a protection layer or a weak spot, and a damage modifier (`hitShapeDamageMod`). VATS can show this per part, such as "armored" or "x2 damage". Bosses, mechs and big NPCs have their own files (Adam Smasher, the Chimera with separate weak spot files). Whether women and other body types share `npc_base` is unverified.

### Other parts that help

| Need | What the game has |
|---|---|
| Where a part is now | The shapes' slots are the NPC's slots (`entSlot`: a slot name on a bone). `AIActionHelper.GetTargetSlotPosition(target, n"Chest", out pos)` is how the game's scripts read one. `entSlotComponent.GetSlotTransform` reads any slot |
| Which part the crosshair is on | `TargetingSystem`: `GetComponentClosestToCrosshair`, `GetTargetParts`, `GetBestComponentOnTargetObject`; aim assist uses them |
| What a shot hit | `hitEvent` carries the hit shape (`GetHitShape`, `GetHitShapeUserDataBase`); the game's hit reactions read its name |
| Switch a part's hit shape off or on | Global functions `DisableHitShape(object, shapeName, hierarchical)` and `EnableHitShape(...)`, and the event `gamehitRepresentationEventsToggleHitShapeEvent` |
| Zoom | The player's camera (`gameCameraComponent`): `SetFOV`, `SetZoom`, and `fovOverrideWeight`/`fovOverrideValue`. Whether the scanner leaves them alone is unverified |
| Slow time | `TimeSystem`'s time dilation; the Sandevistan sets the world's to 0.3 (seen in REDnode's sound spike) |
| Highlights | The scanner's outlines (`FocusForcedHighlightData`, `gameVisionModeSystem`), weak spot highlights on bosses (`ToggleWeakspotHighlightEvent`: weak spots are objects of their own, so they light up alone), and `entRenderHighlightEvent` with `fillIndex`, `outlineIndex`, `opacity`, `seeThroughWalls` and a `componentName` |
| Wounds | `EWoundedBodyPart` (wounded or dismembered arm or leg) for effects such as a crippled leg |

### What it lacks

**A highlight for one limb.** A body is one mesh (`base\characters\common\base_bodies\man_average\t0_000_ma_base__full.mesh`), with the head and clothes as other components. So `entRenderHighlightEvent`'s `componentName` could light up the head, a shirt or trousers at best, never a left arm alone, and never a bare limb (unverified: no game script sends this event with a component, and whether it honours one is untested). Boss weak spots light up alone only because each is an object of its own.

## Three ways to draw the parts

| Way | How | Looks | Cost and risk |
|---|---|---|---|
| **A. Shapes in the engine's picture** | Attach a small glowing mesh per part (a capsule like the hit shape, or a ring) to the NPC's bone slots, and give it the game's outline with a highlight event | Part of the 3D picture: hidden behind cover, lit and outlined in the game's colours | Needs something attached to a bone at runtime: a spawned entity on a slot, or a component added to the NPC (Codeware may allow it; unverified). Six to eleven objects per target. A capsule is not the body's outline |
| **B. REDnode draws over the game** (recommended first) | The plugin reads the target's slots each frame, projects each shape to the screen (the world pins' projection: about 7 us a frame for 100 points, WP1) and draws an outline, fill and label per part, as pins are drawn | A HUD layer, like the game's own scanner. Labels (part, hit chance, damage, armour) are easy | Drawn over everything, so cover needs ray casts as pins do (WP2). The part's shape on screen is the projected capsules, not the body's outline |
| **C. Ink (the game's UI)** | The same projection, but placed as ink widgets on the HUD layer | Engine-drawn 2D, in the game's own fonts | Ink changes through the bridge cost a frame each (I1), so per-frame placement would need a native driver like the pins'. No gain over B for a first build |

**Recommendation: B first, with A as a spike.** B reuses what world pins already do and puts all six parts on screen soonest. The scanner's own outline of the whole enemy stays as it is. If A's spike shows bone-attached shapes are cheap and look right, VATS can move its highlights into the engine and keep REDnode's labels.

## Picking a part

| Where | How |
|---|---|
| In the world | No cursor, as in the game. The part nearest the crosshair is the pick (the game's `GetComponentClosestToCrosshair`, or REDnode's own projection), and mapped keys or controller buttons cycle between parts. This is the semi-native apps' "mapped inputs in the world" (spike S3 in [Semi-native apps](semi-native.html)) |
| Paused | If VATS stops the world while the player picks (semi-native S6, a paused mode with the cursor), the player clicks a part |

Keys: REDnode has no game input API yet (I3). Until then the mod's own redscript can listen for its keys, as other mods do.

## Hitting the chosen part (part 2, later)

Not researched yet. Candidates, each unverified:

| Way | How |
|---|---|
| Aim at it | Turn the camera or the shot toward the part's slot (the targeting system's `LookAt` and `AimSnap`, or the camera itself) and let the player fire |
| Only that part can be hit | Switch off every other hit shape on the target for the shot (`DisableHitShape`), then back on |
| A scripted hit | Apply the attack to the part's shape directly, as the game's own effects do |

## Hit chance from exposure

The owner's idea, 2026-11-14, not a priority yet: each part's hit chance follows how much of it V can see. An NPC facing left in V's view shows its left arm (90 to 100 %) and hides its right arm behind its own body (a chance by how much of it shows). Nothing found so far prevents it; it would come in a build phase once the spikes pass.

**How it could work:** cast rays from the camera to a few points on each part and count the ones that reach it unblocked.

| Step | How |
|---|---|
| Points on each part | Every hit shape is a capsule, sphere or box of a known size (the shape file: the LeftArm capsule is 0.08 m by 0.25 m) on a slot. `GetTargetSlotTransform(target, slot, out transform)` gives a slot's place and orientation, so each shape's points (its ends, middle and sides) can be placed in the world |
| Blocked by the world | A ray from the camera to each point through `SpatialQueriesSystem.SyncRaycastByCollisionGroup`, as world pins test walls (REDnode's `RaycastStatic`, WP2: 17 to 33 us a ray). `"Static"` catches walls and cover; which groups also catch cars, crates and other NPCs is unverified |
| Blocked by its own body | Physics rays do not see hit shapes, and the far arm hides behind the NPC's own torso. So test each ray against the target's other capsules with plain maths (a ray against a capsule, in the mod, no game call). Other NPCs in the way can be tested the same way, with their slots read too |
| The chance | A part's exposure is the share of its rays that reach it. The hit chance is exposure times the mod's own factors (distance, the weapon's spread, the player's skill), a formula to design |
| Cost | Six parts by six to eight points is 36 to 48 rays, about 1 to 1.5 ms of the game thread if done at once. Spread over frames, or done only when the target, V or the camera moves, a few times a second is enough for a label |

Unverified: the slots' orientation (which axis a capsule runs along), the collision groups for moving things, and whether the game's own bullets agree with the capsules (they hit the same hit shapes, so they should).

## Spikes

| Spike | Question | How |
|---|---|---|
| **V1 Parts on screen** | Can REDnode follow an enemy's 15 slots each frame and draw the six parts in place? At what cost? | Read the slot positions from the plugin for a targeted NPC (`GetSlotTransform` or the game's `GetTargetSlotPosition`), project them with the pins' code, draw outlines and labels. Log the cost per frame |
| **V2 Parts in the engine** | Can a glowing shape ride a bone and take the game's outline? | Attach a small mesh to an NPC's `Head` and `LeftArm` slots, send it `entRenderHighlightEvent`; also try `componentName` on the NPC's own head and garments |
| **V3 Zoom while scanning** | Does `SetFOV` or `SetZoom` on the player's camera hold while the scanner is up? | Call them from the Console while scanning; read them back |
| **V4 The crosshair's part** | Does the game report which part the crosshair is on? | `GetComponentClosestToCrosshair` and `GetTargetParts` on a scanned enemy, from the Console |
| **V5 Deep slow motion** | How low can the world's dilation go while scanning, with V and the camera at normal speed, and how does it stack with the scanner's own? | `SetTimeDilation` and the local-player calls from the Console while scanning; undo with `UnsetTimeDilation` |
| **V6 The smart gun's part** | Can the smart gun lock onto a chosen bone? | Watch `attachedBoneName` on its targets; try its target sorting, or the lock events |
| **V7 Only VATS quickhacks** | Can EDGEhack's scripts switch every other quickhack off while VATS is on, and back after, beside REDnode's own wrap of the same function? | In EDGEhack: wrap `TranslateChoicesIntoQuickSlotCommands` behind a VATS switch, mark the others unusable with a reason; check the wheel, its keys and REDnode's quickhack test together |
| **V8 Exposure** (not a priority) | Can each part's exposure be measured from the camera, against the world and the NPC's own body, cheaply enough? | Read the slots' transforms (`GetTargetSlotTransform`), place points on the capsules, cast rays against the world with `SyncRaycastByCollisionGroup`, test them against the other capsules in the mod; compare with where shots land |

V1 and V3 decide whether the first build goes ahead as drawn here. V5 and V7 decide the rest of the play. V8 waits until those pass.

## Open questions

| Question | Recommendation |
|---|---|
| Six parts or more (hands, feet)? | Six, as the owner described. The table above already groups the 15 shapes |
| Time while targeting | Slowed far below the scanner's slow motion (the owner, 2026-11-14); how low is V5's question |
| The duration's clock | Real time, so the player's budget stays the same however slow the world is. To decide with the owner |
| Moving between enemies | Snap to the next or previous enemy with a key or stick, nearest first. To decide with the owner |
| Enemies VATS covers | Human NPCs on `npc_base` first; bosses, mechs and drones later, each with its own shape file |
| What a part's label shows | Name, hit chance, damage modifier, armour. Hit chance from the part's exposure (above) times the mod's own factors |

## The spike app

Built on 2026-11-14: the **VATS spike** app (`packages/overlay/apps/vats-spike`, a Node mod). It goes through `api` and world pins only, so REDnode itself is unchanged and it runs on REDnode 0.62.4 or later. Each button calls the game and logs what it answered and how long it took, in its window, the Mod log and `red4ext/logs/rednode-mods.log`.

| Section | What it calls | Answers |
|---|---|---|
| Target | `TargetingSystem.GetLookAtObject`: what V looks at becomes the target | |
| Read slots | The global `GetTargetSlotPosition(target, slot, out position)` for the 15 hit shape slots, grouped into the six parts | V1: which slots an NPC has, and the cost |
| Show parts | The same reads a few times a second (1 to 15, a slider), a pin per part at the middle of its slots (`screen` scale, no post) | V1: do six labels follow a moving enemy, and what does it cost |
| Crosshair (V4) | `TargetingSystem.GetLookAtComponent`, with its component's name | V4 |
| Zoom (V3) | The player's camera (`GetFPPCameraComponent`): `SetFOV` to a half or a quarter, `SetZoom`, **Back** | V3 |
| Slow motion (V5) | `TimeSystem.SetTimeDilation` with a reason and a duration (2 to 30 s, a slider), so it always runs out on its own; **Keep V at normal speed** adds `SetIgnoreTimeDilationOnLocalPlayerZero`; **Normal** undoes both | V5 |
| Watch | Twice a second, a line when the active dilation, the field of view or the zoom changes | What the scanner itself changes |
| Only one part can be hit | `DisableHitShape` on the target's other shapes, `EnableHitShape` after 6 s | Part 2: can a shot be made to land on one part |

A package has no stop hook, so nothing it changes outlives it unattended: slow motion runs out by its duration, the hit shapes come back after 6 s, and the zoom has **Back** (unverified whether a save load also resets it).

Checked in the mock game (scratchpad `vats/check.mjs`, its stand-in plugin `vats/mock.mjs` with the game's answers in `vats/answer.mjs`): 30 checks, every button, the calls' arguments as the 2.5 types want them, six pins placed again and again and gone when switched off (the check found an update in flight putting them back after the switch; fixed), and the hit shapes back on.

### Spike test

In the game, on open ground near enemies who are not fighting yet (a gang's hangout, from a distance). The overlay pauses the game while it is interactive, so the scanner cannot be held while clicking: each step sets something up with **F10**, then leaves interactive mode (F10 again) to play.

| Step | Do | Expect, and what to note |
|---|---|---|
| 1 | Press **F10** and switch on **VATS spike** in the launcher (it asks for no permission) | Its window opens on the left: "VATS spike ready" |
| 2 | Look at an enemy and press **Target** | "Target: NPCPuppet ..." with their name |
| 3 | Press **Read slots** | "15 of 15 slots" (or which are missing) and the time it took |
| 4 | Switch on **Show parts**, then leave interactive mode and watch the enemy walk | Six coloured labels (Head, Torso, Left arm, Right arm, Left leg, Right leg) on their body. Note whether they keep up, and whether left and right are the enemy's own |
| 5 | Back in F10, move **Updates a second** to 15, and watch again; then switch Show parts off | Smoother at 15. Note the cost lines ("Parts: ... ms each") |
| 6 | Switch on **Watch the dilation and the camera**, leave interactive mode, hold the scanner for a few seconds, let go | Watch lines show what the scanner changes: the dilation and the field of view, or nothing |
| 7 | In F10, press **x2**, leave interactive mode, and hold the scanner | The view zoomed. Note whether it stays zoomed while scanning and after. Then **Back** in F10 |
| 8 | In F10, with **Keep V at normal speed** on, press **0.05**, then leave interactive mode at once and move V, turn the camera, hold the scanner | For 8 s the world crawls. Note whether V and the camera move normally, and what Watch logs while scanning |
| 9 | Repeat step 8 with Keep V at normal speed off, then with **0.01** | Note the differences |
| 10 | Aim at the enemy's head and press **Crosshair (V4)** (F10 shows the cursor, but the crosshair stays where V aims). Repeat aiming at a leg | Which component is under the crosshair each time |
| 11 | Press **Left arm** under "Only one part can be hit", leave interactive mode and shoot the enemy's torso and head within 6 s, then the left arm | Note whether torso and head shots pass through or miss, and whether the arm takes hits. After 6 s the log says every hit shape is back on |
| 12 | Switch the app off | Its pins go; nothing stays slowed |

Claude then reads `rednode-mods.log` for the `[vats-spike]` lines, the costs and the answers, and writes the results here and into the game API notes (`gameapi/notes/`), since other mods can use them too.
