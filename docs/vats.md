# VATS: Visual Assisted Targeting System

Status: **initial research, 2026-11-14; nothing built.** A mod idea from the owner: during combat, scan an enemy, zoom in with another button, and pick one of its body parts to target: head, torso, left arm, right arm, left leg, right leg. This page covers the first part, **body part targeting**: can REDengine highlight the parts itself, or does REDnode draw them over the game? It lives in REDnode's docs while the parts it needs are REDnode's; the mod may get its own repository later.

Sources: the 2.5 game API dump (`gameapi/2.5/rtti.json`), the game's files read through REDbridge, and a decompile of the game's scripts from an earlier version (2.5 may differ). Everything below is unverified in the game unless it says otherwise.

## The short answer

**Both, split by job.** The engine knows exactly where each body part is and can aim at it, zoom the camera and slow time. It has no built-in way to outline one limb, because a body is one mesh. So the first build has REDnode draw the six parts over the game, placed by the plugin each frame as world pins are. A spike tries to draw parts in the engine's own picture instead, with small glowing shapes attached to the bones.

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

## Spikes

| Spike | Question | How |
|---|---|---|
| **V1 Parts on screen** | Can REDnode follow an enemy's 15 slots each frame and draw the six parts in place? At what cost? | Read the slot positions from the plugin for a targeted NPC (`GetSlotTransform` or the game's `GetTargetSlotPosition`), project them with the pins' code, draw outlines and labels. Log the cost per frame |
| **V2 Parts in the engine** | Can a glowing shape ride a bone and take the game's outline? | Attach a small mesh to an NPC's `Head` and `LeftArm` slots, send it `entRenderHighlightEvent`; also try `componentName` on the NPC's own head and garments |
| **V3 Zoom while scanning** | Does `SetFOV` or `SetZoom` on the player's camera hold while the scanner is up? | Call them from the Console while scanning; read them back |
| **V4 The crosshair's part** | Does the game report which part the crosshair is on? | `GetComponentClosestToCrosshair` and `GetTargetParts` on a scanned enemy, from the Console |

V1 and V3 decide whether the first build goes ahead as drawn here.

## Open questions

| Question | Recommendation |
|---|---|
| Six parts or more (hands, feet)? | Six, as the owner described. The table above already groups the 15 shapes |
| Time while targeting | Slowed or stopped; decide with the hit research (part 2) |
| Enemies VATS covers | Human NPCs on `npc_base` first; bosses, mechs and drones later, each with its own shape file |
| What a part's label shows | Name, hit chance, damage modifier, armour. Hit chance needs a formula of the mod's own |
