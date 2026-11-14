# gametargetingTargetingSystem

What the player looks at and aims at. Get it with `api.GameInstance.GetTargetingSystem(game.instance)`.

## GetLookAtComponent

On an NPC, it answers the NPC's whole `gameHitRepresentationComponent` (named "HitRepresentation"), the same for the head and a leg: seen in game on 2.5 (2026-11-14, [VATS spike](https://edgemodders.github.io/REDnode/vats.html#spike-test)). It does not say which hit shape the crosshair is on. To find the part, cast a ray from the camera along `gameCameraSystem.GetActiveCameraForward` against the shapes' slots (`entSlotComponent.GetSlotTransform`), as the VATS spike does.

## GetLookAtObject

Answers the entity V looks at, as a reference: an NPC is an `NPCPuppet`. A generic NPC's `GetDisplayName()` can be empty.
