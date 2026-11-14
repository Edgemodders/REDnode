# entSlotComponent

Named slots on an entity: a name on a bone, with an offset. An NPC has two: `ScriptedPuppet.GetSlotComponent()` and `ScriptedPuppet.GetHitRepresantationSlotComponent()` (the game's spelling). The second is the NPC's `gameHitRepresentationComponent`, which holds the 15 hit shapes of `npc_base.hitrepresentation`, each on a slot of the same name: Head, Chest, LeftTorso, RightShoulder, Belly, LeftArm, LeftForeArm, RightArm, RightForeArm, LeftUpLeg, LeftLeg, LeftFoot, RightUpLeg, RightLeg, RightFoot.

## GetSlotTransform

Native, so its out parameter comes back with `api.$out`. Read in game on 2.5 (2026-11-14, [VATS spike](https://edgemodders.github.io/REDnode/vats.html#spike-test)): all 15 hit shape slots of a ganger, in world space, following the NPC as it walks (the spike's labels kept up at 5 and 15 reads a second).

The answer is a `WorldTransform`, whose position is in the game's fixed point: each of `x`, `y`, `z` is `{ Bits }`, the metres times 131072 (17 fraction bits).

```js
const slots = await npc.GetHitRepresantationSlotComponent();
const r = await slots.GetSlotTransform('LeftForeArm', api.$out);
if (r.result) {
  const p = r.out.worldTransformOut.Position;
  const at = { x: p.x.Bits / 131072, y: p.y.Bits / 131072, z: p.z.Bits / 131072 };
}
```

Send the 15 reads together (`Promise.all`) so they share bridge frames. In the spike's first run, 15 reads through the script helper took 9 to 19 ms; the native reads' cost is not yet measured.
