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
| Body part quickhacks | The owner, 2026-11-14: a VATS quickhack is sent to one of the six parts, and each part can take one separately. They can be **started only in VATS**, but an upload goes on after VATS ends, in real time, and its effect lands on that part as usual |
| Leave VATS | The VATS button again, with the scanner button still held: back to normal scanning |
| Cancel | Letting go of the scanner cancels VATS too. VATS also has a timed duration: when it runs out, VATS ends, back to scanning, or out of scanning if the scanner is no longer held |

### On a controller

The owner's addition, 2026-11-14. The game's scanner already zooms, but only while the quickhack wheel is not showing; that zoom stays as it is for surveillance. VATS takes the triggers while the scanner is held:

| Input, while scanning | What happens |
|---|---|
| Right trigger | Enter VATS, with its own zoom: the view frames the enemy so their whole body is large and centred on screen |
| Left trigger | Leave VATS entirely: the camera goes back to the setting it had before |

The framing keeps the view on V's own line of sight, so what the player sees is what V's rays see (exposure and the crosshair's part stay true). Recommended: keep the camera where it is, turn the view onto the enemy and narrow the field of view until the body fills about 80 % of the screen's height (field of view = 2 x atan(body height / (2 x 0.8 x distance)); a 1.8 m body 15 m away needs about 8.6 degrees). Moving the camera nearer the enemy would show what V cannot see. To agree with the owner.

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
| A quickhack on a body part | A quickhack lands on the whole target. The part is VATS's own choice: VATS records target, hack and part when the upload starts, and the hack's effect reads it when it lands (`onLand` in `quickhacks.define` knows the target and the hack, not the part). The record must outlive VATS, since the upload goes on in real time after it | Uploads to several parts of one enemy at once: the game greys out a hack already uploading on a target, and allows one upload at a time unless a perk queues them, so separate parts may need one hack record per part (Arm Short Circuit, Leg Short Circuit) or the queue (spike V11, unverified) |
| The upload icon on its part | The owner, 2026-11-14: each part's upload shows at that part, on its slot (the hidden shape), not above the head. Two ways: **the game's own bar**: `UploadProgramProgressEvent` (the event that starts an upload's progress bar) carries a `slotName` beside its duration, icon and stat pool, so the game may place the bar on a named slot of the target. If so, VATS sets it to the part's slot (`LeftArm`). **REDnode's own icon**: a world pin on the part's slot, its progress read from the target's `QuickHackUpload` stat pool | That the game's bar follows `slotName` is a lead from the type data only (spike V12, unverified). REDnode's way works today at a few updates a second from the mod; after VATS, in real time on a moving enemy, a pin that follows a slot in the plugin (as WP2's pins follow an entity) would keep up every frame: a small REDnode addition |
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
| Where a part is now | The shapes' slots are the NPC's slots (`entSlot`: a slot name on a bone). `AIActionHelper.GetTargetSlotPosition(target, n"Chest", out pos)` is how the game's scripts read one. `entSlotComponent.GetSlotTransform` reads any slot, natively: through REDnode's `api`, the script helper answers true but leaves its out parameter at 0, 0, 0 (2026-11-14), so read the slots from the NPC's `GetHitRepresantationSlotComponent()` (the game's spelling) |
| Which part the crosshair is on | `TargetingSystem`: `GetComponentClosestToCrosshair`, `GetTargetParts`, `GetBestComponentOnTargetObject`; aim assist uses them. `GetLookAtComponent` answers the whole `gameHitRepresentationComponent` ("HitRepresentation"), the same for head and leg (2026-11-14): it does not name the shape |
| What a shot hit | `hitEvent` carries the hit shape (`GetHitShape`, `GetHitShapeUserDataBase`); the game's hit reactions read its name |
| Switch a part's hit shape off or on | Static functions `HitShapeUserDataBase.DisableHitShape(object, shapeName, hierarchical)` and `HitShapeUserDataBase.EnableHitShape(...)`, and the event `gamehitRepresentationEventsToggleHitShapeEvent` |
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

**The owner's look, 2026-11-14:** in VATS no labels as the spike draws them, only a **red outline of the body part**. That changes what each way must draw:

| Way | A red outline of a part |
|---|---|
| A | The game's own outline, in red, on a shape attached to the part's bone: it follows the bone every frame with no work from REDnode and hides behind cover like the game's scanner outline. The shape is a capsule, not the limb. The head may be the exception: NPC heads are their own mesh (the body is one), so `entRenderHighlightEvent` with `componentName` on the head component may outline the real head (unverified, in V2) |
| B | The part's capsules projected to the screen and drawn as one red outline (a rounded shape per capsule, merged). REDnode's pins draw labels and posts only, so this needs a new primitive in the plugin: shapes placed from slots each frame, as pins are from points. Drawn over everything, so cover would need the exposure rays to hide what is behind it |
| C | No gain over B |

**With each part's hit chance as a callout** (the owner, the same day): a small red box in the game's look, outside the body, with the value inside ("72%"), and a line from the box to the part, like a callout in an infographic.

| Piece | How |
|---|---|
| The box | REDnode's pin label in the game's look (`MainColors.Red` from the game's style sheet, as I2b's game look reads it), drawn on the labels page like any pin |
| Where it goes | The owner, 2026-11-14: the head's box above the head; the limbs' and the torso's boxes off to the side, at about the height of their part, so their lines run across to it rather than down through the body. A part's side is the side of the screen it is on, from the body's middle, not its name: an enemy facing V shows its left arm on the right. The torso's box goes on the side with more room. Placed in screen space each frame, the boxes kept clear of the body's outline and of each other |
| The line | Horizontal for the side boxes: from the box's inner edge across to the part's outline, at the part's height (a short bend if boxes on one side have to be spread apart). Vertical and short for the head's box. Straight pieces only, as pin posts are drawn; a bend needs two |
| What REDnode needs | A callout pin: a label placed beside or above its point in screen space, with a horizontal or vertical leader line (an elbow when spread). Today a pin's label sits straight above its point with a vertical post. The side and spread are worked out per frame from the body's projected outline, in the plugin |

The game's own map pins (the mappin system attaches a widget to an object's slot and the engine places it each frame) could give a truly native box, but VATS would need its own ink widget for them, through Codeware (unverified; a later spike).

Neither can trace the true outline of an arm or a leg, since the body is one mesh: both outline the hit shapes, which is also what a shot can hit.

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
| When | Only in VATS, under its deep slow motion (the owner, 2026-11-14); never in real-time play. That makes the spike's 205 ms for 54 rays much less of a problem: at a dilation of 0.05 it is about 10 ms of game time, so the labels can lag a frame or two of real time while the world barely moves. Faster is still better, since the camera can move between enemies at normal speed |

The spike's first run (2026-11-14): exposure read right side-on, with 54 rays in 205 ms (above, "Spike test: first run").

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
| **V9 The triggers while scanning** | Can a mod read the right and left triggers while the scanner is held, and keep the game from using them (the scanner's own zoom, aiming, shooting) while VATS has them? | A redscript input listener on the triggers' actions in the scanner's context, and REDnode's I3 Input when it comes; check what the game still does with them |
| **V10 Framing** | Can VATS turn the view onto an enemy and frame the whole body, then put the camera back exactly? | Turn the view (the player's orientation, or the camera's own rotation: which one works is the question) and set the field of view from the body's height and distance (from the slots); keep the field of view and zoom from before to restore |
| **V11 One enemy, several parts** | Can one enemy take VATS quickhacks on several parts, started in VATS and uploading on after it? | Start two VATS hacks on one target in VATS, leave VATS, watch both upload and land; try the same hack on two parts, and the queue perk. Check that the part recorded at the start reaches `onLand` |
| **V12 The upload icon on a part** | Does the game's upload bar move to the slot named in `UploadProgramProgressEvent.slotName`? | Start a quickhack, find where the event is sent (EDGEhack's scripts can wrap it) and set `slotName` to `LeftArm`; see where the bar shows. If not, REDnode's pin on the slot with the `QuickHackUpload` stat pool's value |
| **V8 Exposure** (not a priority) | Can each part's exposure be measured from the camera, against the world and the NPC's own body, cheaply enough? | Read the slots' transforms (`GetTargetSlotTransform`), place points on the capsules, cast rays against the world with `SyncRaycastByCollisionGroup`, test them against the other capsules in the mod; compare with where shots land |

V1 and V3 decide whether the first build goes ahead as drawn here. V5 and V7 decide the rest of the play. V8 waits until those pass. V9 and V10 are the controller design's.

## Open questions

| Question | Recommendation |
|---|---|
| Six parts or more (hands, feet)? | Six, as the owner described. The table above already groups the 15 shapes |
| Time while targeting | Slowed far below the scanner's slow motion (the owner, 2026-11-14); how low is V5's question |
| The duration's clock | Real time, so the player's budget stays the same however slow the world is. To decide with the owner |
| Moving between enemies | Snap to the next or previous enemy with a key or stick, nearest first. To decide with the owner |
| VATS's zoom | Frame the enemy from V's own camera (turn and narrow the field of view), not a camera moved nearer: the owner's "within the raycast from V's camera". To agree with the owner |
| Enemies VATS covers | Human NPCs on `npc_base` first; bosses, mechs and drones later, each with its own shape file |
| What VATS shows on a part | Decided by the owner, 2026-11-14: a red outline, and the hit chance in a red callout box outside the body with a line to the part. Which parts show (all six, with the picked one brighter, or only the one under the crosshair) is to agree |

## The spike app

Built on 2026-11-14: the **VATS spike** app (`packages/overlay/apps/vats-spike`, a Node mod). It goes through `api` and world pins only, so REDnode itself is unchanged and it runs on REDnode 0.62.4 or later. Each button calls the game and logs what it answered and how long it took, in its window, the Mod log and `red4ext/logs/rednode-mods.log`.

| Section | What it calls | Answers |
|---|---|---|
| Target | `TargetingSystem.GetLookAtObject`: what V looks at becomes the target | |
| Read slots | `GetSlotTransform(slot, out worldTransformOut)` on the target's hit representation slot component, positions in the game's fixed point (17 fraction bits). 0.2.0 called `AIActionHelper.GetTargetSlotPosition` as a global and was refused; 0.2.1 called it by its class and read 0, 0, 0 for every slot (a script function's out parameter does not come back) for the 15 hit shape slots, grouped into the six parts | V1: which slots an NPC has, and the cost |
| Show parts | The same reads a few times a second (1 to 15, a slider), a pin per part at the middle of its slots (`screen` scale, no post) | V1: do six labels follow a moving enemy, and what does it cost |
| Crosshair (V4) | `TargetingSystem.GetLookAtComponent`, with its component's name; from 0.2.3 also the part, by a ray from the camera along `GetActiveCameraForward` against the 15 shapes (as balls, with half a capsule's length as their reach) | V4 |
| Zoom (V3) | The player's camera (`GetFPPCameraComponent`): `SetFOV` to a half or a quarter, `SetZoom`, **Back** | V3 |
| Slow motion (V5) | `TimeSystem.SetTimeDilation` with a reason and a duration (2 to 30 s, a slider), so it always runs out on its own; **Keep V at normal speed** adds `SetIgnoreTimeDilationOnLocalPlayerZero`; **Normal** undoes both | V5 |
| Watch | Twice a second, a line when the active dilation, the field of view or the zoom changes | What the scanner itself changes |
| Exposure (V8) | Five points across each shape (its slot, and its capsule's radius to the camera's right, left, up and down). A point is behind the target's own body if the line from the camera passes through another of its shapes, each taken as a sphere of its capsule's radius at its slot (an approximation). The rest get a ray each from the camera (`GetActiveCameraWorldTransform`, `SyncRaycastByCollisionGroup` with `"Static"`), all sent at once so they share a frame; a hit more than 0.15 m short is the world in the way. **Chance on the labels** shows each part's share on its pin while Show parts is on | V8: do the shares match what the player sees, and what do 40 to 70 rays cost |
| Outline (V2, from 0.3.0) | **List components**: Codeware's `GetComponents()` on the target, each mesh component logged with its type and name. **Outline**: `entRenderHighlightEvent` (made with `api.$new`, sent with `QueueEvent`) with the typed `componentName` (empty: the whole NPC), the colour from a slider (the event's `outlineIndex`, 1 to 7), no fill; **Clear** sends it again with no outline | V2: can the game outline one part (the head, a garment) in red |
| Frame (V10, from 0.3.0) | The body's middle, height and distance from its slots; the field of view that makes it fill a share of the screen's height (**Body fills**, 40 to 95 %). **Frame (camera)** turns the first-person camera's own local orientation (`SetLocalOrientation`, keeping what its parent adds); **Frame (turn V)** teleports V where V stands, facing the body, with yaw and pitch. Each reads the camera's forward direction after and logs how far the view is off the body's middle (the camera way at once and after 1 s, to see whether the game writes over it). **Camera back** restores the orientation, field of view and zoom | V10: which way turns the view, and whether it holds |
| Only one part can be hit | `HitShapeUserDataBase.DisableHitShape` on the target's other shapes, `EnableHitShape` after 6 s (from 0.3.0 a slider, 3 to 30 s) | Part 2: can a shot be made to land on one part |

A package has no stop hook, so nothing it changes outlives it unattended: slow motion runs out by its duration, the hit shapes come back after 6 s, and the zoom has **Back** (unverified whether a save load also resets it).

Checked in the mock game (scratchpad `vats/check.mjs`, its stand-in plugin `vats/mock.mjs` with the game's answers in `vats/answer.mjs`, which since 0.2.1 answers the slot and hit shape calls only by their class and, like the game, leaves the script helper's out parameter at zero): 40 checks from 0.2.3, every button, the calls' arguments as the 2.5 types want them, six pins placed again and again and gone when switched off (the check found an update in flight putting them back after the switch; fixed), and the hit shapes back on. App 0.2.0 adds Exposure: with the mock's camera at the NPC's left side and a kerb below 0.3 m, the left arm read 100 %, the right arm 10 % (9 of 10 points behind the torso), the right leg 20 % (its foot behind the kerb); 43 rays went out within 1 ms.

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
| 10 | Aim at the enemy's head and press **Crosshair (V4)** (F10 shows the cursor, but the crosshair stays where V aims). Repeat aiming at a leg | Which component is under the crosshair each time (0.2.2 and before: the whole hit representation, for any part). From 0.2.3 the line ends "the crosshair is on the Head (Head, ...)": note whether head, torso, an arm and a leg each read right |
| 11 | Stand so the target is side-on to you (facing left or right in your view) and press **Exposure** (V8) | A share per part. The arm and leg nearer you should read high, the far ones low ("behind its own body"). Note whether that matches what you see |
| 12 | Move so a low wall, a car or a crate hides part of the target, and press **Exposure** again. Then switch on **Chance on the labels** and **Show parts**, walk round the target, and switch both off | Parts behind the cover read lower ("behind the world"); a car or crate may not count (which collision groups catch them is the question). The labels show "Left arm 90%" and change as you move. Note the cost lines |
| 13 | Press **Left arm** under "Only one part can be hit", leave interactive mode and shoot the enemy's torso and head within 6 s, then the left arm | Note whether torso and head shots pass through or miss, and whether the arm takes hits. After 6 s the log says every hit shape is back on |
| 14 | Switch the app off | Its pins go; nothing stays slowed |

Claude then reads `rednode-mods.log` for the `[vats-spike]` lines, the costs and the answers, and writes the results here and into the game API notes (`gameapi/notes/`), since other mods can use them too.

### Spike test: round 2

App 0.3.0, on REDnode 0.64.0, game 2.5, Codeware. Every line now also goes to `red4ext/logs/rednode-mods.log`, so nothing needs pasting. As before, set each step up in F10, then leave interactive mode to look.

| Step | Do | Expect, and what to note |
|---|---|---|
| 1 | In the launcher, switch **VATS spike** off and on (its log says "VATS spike ready"). Find an enemy who is not fighting yet, look at them and press **Target** | "Target: NPCPuppet ..." |
| 2 | Under **Outline (V2)**, press **List components** | A line per mesh component, with its type and name; the summary counts them. Note which looks like the head (`h0_...`), the body (`t0_...`) and the garments |
| 3 | Type the head's name into the box (click out of it), press **Outline**, leave F10 and look at the enemy, without and with the scanner | Note whether only the head is outlined, its colour, and whether it shows without the scanner |
| 4 | Move **Outline colour** through 1 to 7, pressing **Outline** after each (F10 in between) | Note each number's colour: which one is the game's red |
| 5 | Try a garment's name, the body's name, then an empty box (the whole NPC), pressing **Outline** each time; then **Clear** | Note what each outlines. Clear should take the outline off |
| 6 | Under **Frame (V10)**, press **Frame (camera)**, then leave F10 | The view turns onto the enemy and their body fills about 80 % of the screen's height. The log says how far off the view is, at once and after 1 s. Note whether it stays, whether you can still look around, and whether the crosshair and your aim follow the turned view. Back in F10, press **Camera back** |
| 7 | Press **Frame (turn V)**, leave F10 | V turns to face the enemy. Note whether looking up or down (the pitch) also took, and the log's "degrees off". Then **Camera back** |
| 8 | Set **Body fills** to 60 % and press **Frame (camera)** again; then **Camera back** | A looser frame |
| 9 | Round 1's steps 6 to 9 again (Watch with the scanner held; **x2** while scanning; **0.05** with **Keep V at normal speed** on, then off, then **0.01**) | Nothing to note: their answers are in the log this time |
| 10 | Save the game first. Under **Only one part can be hit**, set the seconds to 15 and press **Left arm**. Leave F10 and shoot the enemy's torso and head with a weapon that is **not** smart (a power pistol), then the left arm, until the log says the shapes are back | Note whether torso and head shots do damage (the damage numbers), and whether the arm does. Load the save after if the fight goes badly |
| 11 | Switch the app off | Nothing stays outlined, turned, zoomed or slowed |

Claude then reads the `[vats-spike]` lines in `rednode-mods.log`.

### Spike test: first run

2026-11-14, by the owner, dev PC, game 2.5, REDnode 0.64.0. The app went from 0.2.0 to 0.2.3 during the run (each copied into the game while it ran; the host restarted the app on its own). The owner: after the fixes, every step worked as written. The app's lines went only to its window up to 0.2.3, so the numbers below are the ones the owner pasted; 0.2.4 also writes them to `rednode-mods.log`.

| Step | Result |
|---|---|
| 3 Read slots | 0.2.0: refused, "no game function GetTargetSlotPosition" (a static of `AIActionHelper`). 0.2.1: 15 of 15 found, every one at 0, 0, 0 (a script function's out parameter does not come back through `api`). 0.2.2: read from the NPC's hit representation slot component (`GetSlotTransform`, native): **passed** |
| 4 and 5 Show parts | Passed after 0.2.2 (at 0.2.1 the labels went to the map's origin). 0.2.1's cost lines, with the script helper: 25 to 27 ms an update at 5 a second, slot reads 9 to 19 ms |
| 6 to 9 Watch, zoom, slow motion | Worked as written (no numbers pasted) |
| 10 Crosshair (V4) | `GetLookAtComponent` answers the whole `gameHitRepresentationComponent` "HitRepresentation" for head and leg alike, in 170 to 178 ms: **the game does not name the part**. 0.2.3 finds it with a ray along the camera against the shapes: **passed**, aimed at a Dogtown resident's head 4.5 m away it read "the crosshair is on the Head (Head, 0.02 m off its middle)", in 271 ms for the whole button (the slot reads, the camera and the targeting calls one after another) |
| 11 Exposure, side-on (V8) | **Passed**: head 80 %, torso 75 %, near (left) arm 100 %, far (right) arm 20 % (8 of 10 points behind its own body), left leg 33 % (10 of 15 behind the world), right leg 7 % (7 behind its body, 7 behind the world). 54 rays in 205 ms: far slower than one frame, so the rays do not share frames as hoped (unverified why). The legs' "behind the world" likely includes the ground: points at or under the floor, with 0.15 m of slack |
| 12 Exposure behind cover | Worked as written (no numbers pasted) |
| 13 Only one part can be hit | **Inconclusive**: shooting aggroed the enemies, and with a smart pistol where hits land could not be told (it may aim for the game's own target capsule). Retest with a weapon that is not smart, on an enemy that cannot fight back |
| 14 Switch off | Worked as written |

What it decides:

| Question | Answer |
|---|---|
| V1 Can REDnode read and follow the 15 shapes? | Yes, through the native `GetSlotTransform`; labels at 5 and 15 updates a second kept up |
| V4 Does the game name the part under the crosshair? | No, only the whole hit representation. VATS finds the part itself, by a ray against the shapes |
| V8 Exposure | Works side-on. Too slow to run live as it is (205 ms for 54 rays); fewer points, a ground cut-off, and finding why the rays do not share a frame come first |
| For REDnode | `api.$out` works on native functions only; documented on `api.$out` and in the game API notes (`AIActionHelper`, `entSlotComponent`, `gametargetingTargetingSystem`). A package whose `mod.mjs` and manifest change together is restarted twice by the host (hot reload and the package rescan), harmless since the runner keeps one worker per mod |

