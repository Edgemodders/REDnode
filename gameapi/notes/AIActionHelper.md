# AIActionHelper

A script class of static helpers for the game's AI actions. Its functions are statics, not globals: call them as `api.AIActionHelper.Name(...)`. Called as a global (`api.GetTargetSlotPosition`), the game answers "no game function".

## GetTargetSlotPosition

A script function, so its out parameter does not come back through `api.$out`. Seen in game on 2.5 (2026-11-14, [VATS spike](https://edgemodders.github.io/REDnode/vats.html#spike-test)): it answered `true` for every one of an NPC's 15 hit shape slots and left the position at 0, 0, 0. Why the value is not written back is unverified.

Read a slot with the native function it uses instead: `GetSlotTransform` on the NPC's slot component (see `entSlotComponent`):

```js
const slots = await npc.GetHitRepresantationSlotComponent(); // the game's spelling
const r = await slots.GetSlotTransform('Head', api.$out);
const p = r.out.worldTransformOut.Position; // fixed point: Bits / 131072
const head = { x: p.x.Bits / 131072, y: p.y.Bits / 131072, z: p.z.Bits / 131072 };
```

## GetTargetSlotTransform

A script function with an out parameter, like `GetTargetSlotPosition`: through `api`, expect its out parameter at its starting value (unverified; the same as `GetTargetSlotPosition` by its kind).
