// VATS spike: the research for VATS, the Visual Assisted Targeting System (docs/vats.md).
// Everything goes through `api` and world pins, so REDnode itself is unchanged. Each button
// calls the game and logs what it answered and how long it took; what shows on screen is
// for the player to say. What it learns serves other mods too (where body parts are, the
// camera's zoom, time dilation, hit shapes), so its findings go into the game API notes.
//
//   Target       what V looks at (TargetingSystem.GetLookAtObject), kept as the target
//   Parts (V1)   the target's 15 hit shape slots, read from its hit representation's slot component,
//                grouped into six parts, pinned where they are, again a few times a second
//   Zoom (V3)    the player's camera: GetFOV, SetFOV, SetZoom, and back
//   Slow (V5)    TimeSystem.SetTimeDilation on the world, with V left at normal speed or not;
//                always with a duration, so it runs out on its own if the mod stops
//   Outline (V2)  Codeware's GetComponents lists the target's components; entRenderHighlightEvent
//                with a componentName puts the game's outline on one of them (or the whole NPC)
//   Frame (V10)  turn the view onto the target and set the field of view so its body fills
//                the screen: by the camera's own local orientation, or by turning V; Camera back
//   Crosshair (V4)  TargetingSystem.GetLookAtComponent: which component V looks at (the whole
//                hit representation, 2026-11-14), then a ray along the camera's forward
//                direction against the 15 shapes for the part
//   Only one part   HitShapeUserDataBase.DisableHitShape on every other shape of the target, for part 2 (hitting
//                the chosen part); EnableHitShape puts them back after a few seconds
//   Watch        twice a second: the active time dilation and the camera's field of view,
//                to see what the scanner itself changes
//   Exposure (V8)   how much of each part the camera sees: five points across each shape,
//                a ray from the camera to each against the world (SyncRaycastByCollisionGroup,
//                "Static"), and against the target's own other shapes in plain maths (each
//                taken as a sphere of its capsule's radius at its slot: an approximation,
//                since which way a capsule runs on its bone is unverified)

import { api, game, input, ui, world } from 'rednode';

// Each shape's capsule in npc_base.hitrepresentation: radius and height in metres.
const SHAPES = {
  Head: [0.118, 0.1], Belly: [0.2, 0.15], LeftTorso: [0.155, 0.095], RightShoulder: [0.155, 0.095], Chest: [0.05, 0.15],
  LeftArm: [0.08, 0.25], LeftForeArm: [0.065, 0.3], RightArm: [0.08, 0.25], RightForeArm: [0.065, 0.3],
  LeftLeg: [0.09, 0.5], LeftUpLeg: [0.11, 0.3], LeftFoot: [0.07, 0.2], RightLeg: [0.09, 0.5], RightUpLeg: [0.11, 0.3], RightFoot: [0.07, 0.2],
};

// npc_base.hitrepresentation's shapes (docs/vats.md), by VATS part.
const PARTS = [
  { part: 'Head', color: '#ff4d6d', slots: ['Head'] },
  { part: 'Torso', color: '#19f3ff', slots: ['Chest', 'LeftTorso', 'RightShoulder', 'Belly'] },
  { part: 'Left arm', color: '#ffcf3f', slots: ['LeftArm', 'LeftForeArm'] },
  { part: 'Right arm', color: '#ff9f1a', slots: ['RightArm', 'RightForeArm'] },
  { part: 'Left leg', color: '#7dff6b', slots: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'] },
  { part: 'Right leg', color: '#b26bff', slots: ['RightUpLeg', 'RightLeg', 'RightFoot'] },
];
const SLOTS = PARTS.flatMap((p) => p.slots);
const REASON = 'rednode_vats_spike';

const log = ui.list({ keep: 400 });
const status = ui.text('No target. Look at an enemy and press Target.', { tone: 'dim' });
const say = (line) => {
  log.push(`${new Date().toLocaleTimeString()}  ${line}`);
  console.log(line); // also to the Mod log and red4ext/logs/rednode-mods.log, for Claude to read after a run
};

async function step(what, fn) {
  const started = performance.now();
  try {
    const note = await fn();
    say(`${what}: ${note ?? 'done'} (${Math.round(performance.now() - started)} ms)`);
  } catch (err) {
    say(`${what} FAILED: ${err?.message ?? err}`);
  }
}

const player = async () => {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  return v;
};

// ---------- the target ----------

let target = null;
let targetName = '';

async function pickTarget() {
  const v = await player();
  const targeting = await api.GameInstance.GetTargetingSystem(game.instance);
  const t = await targeting.GetLookAtObject(v, false, false);
  if (!t) throw new Error('V is not looking at anything');
  target = t;
  targetName = `${t.$type} "${(await t.GetDisplayName()) || 'no name'}"`;
  const puppet = await t.IsPuppet().catch(() => false);
  status.set({ text: `Target: ${targetName}${puppet ? '' : ' (not a puppet: it may have no body part slots)'}`, tone: puppet ? 'normal' : 'danger' });
  return targetName;
}

const needTarget = () => {
  if (!target) throw new Error('No target: look at an enemy and press Target');
  return target;
};

// ---------- V1: the parts ----------

// The target's hit shape slots live on its hit representation's slot component. Its native
// GetSlotTransform fills its out parameter; the script helper AIActionHelper.GetTargetSlotPosition
// does not when called through api (0.2.1 read 0, 0, 0 for every slot: a script function's out
// parameter is not written back to the caller, unverified why).
let slotsOf = { target: null, component: null, from: '' };

async function slotComponent(t) {
  if (slotsOf.target === t && slotsOf.component) return slotsOf.component;
  let component = await t.GetHitRepresantationSlotComponent().catch(() => null);
  let from = 'GetHitRepresantationSlotComponent';
  if (!component) {
    component = await t.GetSlotComponent().catch(() => null);
    from = 'GetSlotComponent';
  }
  if (!component) throw new Error(`${targetName || 'The target'} has no slot component`);
  slotsOf = { target: t, component, from };
  say(`Slots: from ${from} (${component.$type})`);
  return component;
}

// The game's WorldPosition: fixed point numbers with 17 fraction bits.
const fixed = (f) => (typeof f === 'number' ? f : (f?.Bits ?? 0) / 131072);

// Every slot's place now, and how long the reads took. A slot the target lacks reads null.
async function readSlots(t) {
  const started = performance.now();
  const component = await slotComponent(t);
  const places = await Promise.all(
    SLOTS.map(async (slot) => {
      const r = await component.GetSlotTransform(slot, api.$out);
      const p = r?.out?.worldTransformOut?.Position;
      if (!r?.result || !p) return { slot, x: null };
      const at = { slot, x: fixed(p.x), y: fixed(p.y), z: fixed(p.z) };
      return at.x === 0 && at.y === 0 && at.z === 0 ? { slot, x: null, zero: true } : at;
    }),
  );
  return { places, ms: performance.now() - started };
}

function partsOf(places) {
  const by = new Map(places.filter((p) => p.x !== null).map((p) => [p.slot, p]));
  return PARTS.map((part) => {
    const found = part.slots.map((s) => by.get(s)).filter(Boolean);
    if (!found.length) return { ...part, at: null, found: 0 };
    const n = found.length;
    const at = { x: found.reduce((a, p) => a + p.x, 0) / n, y: found.reduce((a, p) => a + p.y, 0) / n, z: found.reduce((a, p) => a + p.z, 0) / n };
    return { ...part, at, found: n };
  });
}

const readParts = () =>
  step('Read slots', async () => {
    const t = needTarget();
    const { places, ms } = await readSlots(t);
    const missing = places.filter((p) => p.x === null).map((p) => (p.zero ? `${p.slot} (read 0, 0, 0)` : p.slot));
    for (const p of places) if (p.x !== null) say(`  ${p.slot}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`);
    const found = places.filter((p) => p.x !== null);
    const head = found.find((p) => p.slot === 'Head');
    const lowest = found.reduce((a, p) => (a && a.z <= p.z ? a : p), null);
    const height = head && lowest && lowest !== head ? ` the head ${(head.z - lowest.z).toFixed(2)} m above the lowest slot (${lowest.slot});` : '';
    return `${SLOTS.length - missing.length} of ${SLOTS.length} slots in ${ms.toFixed(1)} ms;${height} ${missing.length ? `missing: ${missing.join(', ')}` : 'none missing'}`;
  });

let pinTimer = null;
let pinsOn = false;
let pinWork = Promise.resolve(); // the update in flight, so switching off waits for it
let pinIds = [];
let pinTicks = 0;
let pinMs = 0;
let hz = 5;

async function clearPartPins() {
  const ids = pinIds;
  pinIds = [];
  await Promise.all(ids.map((id) => world.unpin(id).catch(() => false)));
}

// ---------- V8: exposure ----------

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const vec = (v) => ({ x: v.X, y: v.Y, z: v.Z });
const toGame = (p) => ({ X: p.x, Y: p.y, Z: p.z, W: 1 });

async function cameraView() {
  const cams = await api.GameInstance.GetCameraSystem(game.instance);
  const r = await cams.GetActiveCameraWorldTransform(api.$out);
  const pos = r?.out?.transform?.position;
  if (!pos) throw new Error('No camera transform');
  const [right, up, forward] = await Promise.all([cams.GetActiveCameraRight(), cams.GetActiveCameraUp(), cams.GetActiveCameraForward()]);
  return { at: vec(pos), right: vec(right), up: vec(up), forward: vec(forward) };
}

// Does the segment from `from` to `to` pass through the sphere before reaching `to`?
function blockedBySphere(from, to, centre, radius) {
  const d = sub(to, from);
  const total = len(d);
  const dir = { x: d.x / total, y: d.y / total, z: d.z / total };
  const t = dot(sub(centre, from), dir);
  if (t <= 0 || t >= total - radius) return false; // behind the camera, or around the point itself
  const closest = add(from, dir, t);
  return len(sub(centre, closest)) < radius;
}

let exposureCasts = 0;

// Every part's share of points the camera sees, and why the others are hidden.
async function exposure(t, places) {
  const started = performance.now();
  const cam = await cameraView();
  if (!places) places = (await readSlots(t)).places;
  const at = new Map(places.filter((p) => p.x !== null).map((p) => [p.slot, p]));
  const sqs = await api.GameInstance.GetSpatialQueriesSystem(game.instance);
  const centres = partsOf(places);
  // Every point first, those behind the target's own body set aside; then every ray at once,
  // so they share a frame (one at a time, each would wait for the bridge's next frame).
  const points = [];
  for (const part of PARTS) {
    for (const slot of part.slots) {
      const c = at.get(slot);
      if (!c) continue;
      const r = SHAPES[slot][0] * 0.8;
      for (const p of [c, add(c, cam.right, r), add(c, cam.right, -r), add(c, cam.up, r), add(c, cam.up, -r)]) {
        const body = [...at.values()].some((o) => o.slot !== slot && blockedBySphere(cam.at, p, o, SHAPES[o.slot][0]));
        points.push({ part: part.part, p, body, world: false });
      }
    }
  }
  const cast = points.filter((x) => !x.body);
  const rays = await Promise.all(cast.map((x) => sqs.SyncRaycastByCollisionGroup(toGame(cam.at), toGame(x.p), 'Static', api.$out, false, false)));
  rays.forEach((ray, i) => {
    const hit = ray?.result === true && ray.out?.result?.position;
    // A hit more than 0.15 m short of the point is something in the way.
    if (hit && len(sub(vec(ray.out.result.position), cam.at)) < len(sub(cast[i].p, cam.at)) - 0.15) cast[i].world = true;
  });
  const result = PARTS.map((part) => {
    const mine = points.filter((x) => x.part === part.part);
    const seen = mine.filter((x) => !x.body && !x.world).length;
    return {
      part: part.part,
      color: part.color,
      at: centres.find((x) => x.part === part.part)?.at ?? null,
      total: mine.length,
      seen,
      body: mine.filter((x) => x.body).length,
      world: mine.filter((x) => x.world).length,
      chance: mine.length ? Math.round((seen / mine.length) * 100) : null,
    };
  });
  exposureCasts = cast.length;
  return { parts: result, ms: performance.now() - started, casts: cast.length };
}

const exposureOnce = () =>
  step('Exposure', async () => {
    const t = needTarget();
    const { parts, ms, casts } = await exposure(t);
    for (const p of parts) say(`  ${p.part}: ${p.chance === null ? 'no slots' : `${p.chance}% (${p.seen} of ${p.total} points seen, ${p.body} behind its own body, ${p.world} behind the world)`}`);
    return `${casts} ray casts in ${ms.toFixed(1)} ms`;
  });

let exposureLabels = false;

async function pinTick() {
  if (!target) return;
  const started = performance.now();
  const { places, ms } = await readSlots(target);
  let parts = partsOf(places);
  if (exposureLabels) parts = (await exposure(target, places)).parts;
  if (!pinsOn) return; // switched off while this update ran
  // The new places first, then the old pins away: never a moment with no pins, which would
  // make the labels flicker and the host make its labels page again on every update.
  const old = pinIds;
  pinIds = await Promise.all(
    parts.filter((p) => p.at).map((p) => {
      const title = exposureLabels && p.chance !== null ? `${p.part} ${p.chance}%` : p.part;
      return world.pin({ at: p.at, title, style: { color: p.color, scale: 'screen', pinHeight: 0, titleSize: 14 } });
    }),
  );
  await Promise.all(old.map((id) => world.unpin(id).catch(() => false)));
  pinTicks += 1;
  pinMs += performance.now() - started;
  if (pinTicks % (hz * 5) === 0) say(`Parts: ${pinTicks} updates, ${(pinMs / pinTicks).toFixed(1)} ms each (slot reads ${ms.toFixed(1)} ms${exposureLabels ? `, ${exposureCasts} ray casts` : ''}), ${parts.filter((p) => p.at).length} parts`);
}

async function showParts(on) {
  if (pinTimer) clearInterval(pinTimer);
  pinTimer = null;
  pinsOn = false;
  await pinWork;
  if (!on) {
    await clearPartPins();
    say('Parts: hidden');
    return;
  }
  if (!target) {
    say('Parts: no target. Press Target first');
    return;
  }
  pinTicks = 0;
  pinMs = 0;
  pinsOn = true;
  let busy = false;
  pinTimer = setInterval(() => {
    if (busy || !pinsOn) return;
    busy = true;
    pinWork = pinTick()
      .catch((err) => say(`Parts FAILED: ${err?.message ?? err}`))
      .finally(() => (busy = false));
  }, 1000 / hz);
  say(`Parts: shown, ${hz} updates a second`);
}

// ---------- V3: zoom ----------

let savedFov = null;

async function camera() {
  const v = await player();
  const cam = await v.GetFPPCameraComponent();
  if (!cam) throw new Error('No first-person camera');
  return cam;
}

const zoom = (factor) =>
  step(`Zoom x${factor}`, async () => {
    const cam = await camera();
    const fov = await cam.GetFOV();
    if (savedFov === null) savedFov = fov;
    await cam.SetFOV(savedFov / factor);
    const now = await cam.GetFOV();
    return `field of view ${fov.toFixed(1)} -> asked ${(savedFov / factor).toFixed(1)}, reads ${now.toFixed(1)}`;
  });

const zoomProp = (value) =>
  step(`SetZoom ${value}`, async () => {
    const cam = await camera();
    const before = await cam.GetZoom();
    await cam.SetZoom(value);
    return `zoom ${before} -> reads ${await cam.GetZoom()}`;
  });

const zoomReset = () =>
  step('Zoom back', async () => {
    const cam = await camera();
    if (savedFov !== null) await cam.SetFOV(savedFov);
    await cam.SetZoom(1);
    const now = await cam.GetFOV();
    const note = savedFov === null ? 'no zoom to undo' : `field of view back to ${now.toFixed(1)}`;
    savedFov = null;
    return note;
  });

// ---------- V5: slow motion ----------

let slowSeconds = 8;
let vNormal = true;

const slow = (dilation) =>
  step(`Slow the world to ${dilation}`, async () => {
    const ts = await api.GameInstance.GetTimeSystem(game.instance);
    const before = await ts.GetActiveTimeDilation();
    if (vNormal) await ts.SetIgnoreTimeDilationOnLocalPlayerZero(true);
    await ts.SetTimeDilation(REASON, dilation, slowSeconds);
    const now = await ts.GetActiveTimeDilation();
    const mine = await ts.GetActiveTimeDilation(REASON);
    setTimeout(() => {
      if (vNormal) ts.RestorePreviousIgnoreTimeDilationOnLocalPlayerZero().catch(() => {});
    }, slowSeconds * 1000 + 200);
    return `active dilation ${before} -> ${now} (this reason reads ${mine}); runs out in ${slowSeconds} s${vNormal ? '; V left at normal speed' : '; V slowed too'}`;
  });

const unslow = () =>
  step('Normal time', async () => {
    const ts = await api.GameInstance.GetTimeSystem(game.instance);
    await ts.UnsetTimeDilation(REASON);
    await ts.RestorePreviousIgnoreTimeDilationOnLocalPlayerZero().catch(() => {});
    return `active dilation now ${await ts.GetActiveTimeDilation()}`;
  });

// ---------- V4: the crosshair ----------

const crosshair = () =>
  step('Crosshair', async () => {
    const v = await player();
    const targeting = await api.GameInstance.GetTargetingSystem(game.instance);
    const comp = await targeting.GetLookAtComponent(v, true, false);
    if (!comp) return 'no component under the crosshair';
    const name = await comp.GetName().catch(() => '?');
    const owner = await targeting.GetLookAtObject(v, true, false);
    const what = `${comp.$type} "${name}" on ${owner ? `${owner.$type} "${(await owner.GetDisplayName()) || 'no name'}"` : 'nothing'}`;
    // The game names only the whole hit representation, not the shape: find the part with a
    // ray from the camera along its forward direction, against the 15 shapes (as balls).
    const body = owner ?? target;
    if (!body) return what;
    const part = await partUnderCrosshair(body).catch((err) => `part not found (${err?.message ?? err})`);
    return `${what}; ${part}`;
  });

const partOfSlot = (slot) => PARTS.find((x) => x.slots.includes(slot))?.part ?? null;

// The shape a ray from the camera along its forward direction meets first: { part, slot } or null.
async function crosshairPart(t) {
  const [cam, { places }] = await Promise.all([cameraView(), readSlots(t)]);
  let best = null;
  for (const p of places) {
    if (p.x === null) continue;
    const along = dot(sub(p, cam.at), cam.forward);
    if (along <= 0) continue;
    const miss = len(sub(p, add(cam.at, cam.forward, along)));
    const [radius, height] = SHAPES[p.slot];
    if (miss <= Math.max(radius, height / 2) && (!best || along < best.along)) best = { slot: p.slot, along };
  }
  return best ? { part: partOfSlot(best.slot), slot: best.slot } : null;
}

async function partUnderCrosshair(t) {
  const [cam, { places }] = await Promise.all([cameraView(), readSlots(t)]);
  let best = null;
  let nearest = null;
  for (const p of places) {
    if (p.x === null) continue;
    const along = dot(sub(p, cam.at), cam.forward);
    if (along <= 0) continue; // behind the camera
    const miss = len(sub(p, add(cam.at, cam.forward, along)));
    const [radius, height] = SHAPES[p.slot];
    const reach = Math.max(radius, height / 2); // the capsule's long axis is unknown: its half length
    if (!nearest || miss - reach < nearest.miss - nearest.reach) nearest = { slot: p.slot, miss, reach, along };
    if (miss <= reach && (!best || along < best.along)) best = { slot: p.slot, miss, along };
  }
  const partOf = (slot) => PARTS.find((x) => x.slots.includes(slot))?.part ?? '?';
  if (best) return `the crosshair is on the ${partOf(best.slot)} (${best.slot}, ${best.miss.toFixed(2)} m off its middle, ${best.along.toFixed(1)} m away)`;
  if (nearest) return `on no shape; nearest the ${partOf(nearest.slot)} (${nearest.slot}, ${(nearest.miss - nearest.reach).toFixed(2)} m outside it)`;
  return 'no slots to test';
}

// ---------- part 2: only one part can be hit ----------

let onlySeconds = 6;

const onlyPart = (part) =>
  step(`Only ${part.part} can be hit`, async () => {
    const t = needTarget();
    const off = SLOTS.filter((s) => !part.slots.includes(s));
    for (const shape of off) await api.HitShapeUserDataBase.DisableHitShape(t, shape, false);
    setTimeout(async () => {
      for (const shape of off) await api.HitShapeUserDataBase.EnableHitShape(t, shape, false).catch(() => {});
      say(`Only ${part.part}: every hit shape back on`);
    }, onlySeconds * 1000);
    return `${off.length} other hit shapes off for ${onlySeconds} s: shoot the target and watch where hits land`;
  });

// ---------- watch ----------

let watchTimer = null;
let lastWatch = '';

async function watchTick() {
  const ts = await api.GameInstance.GetTimeSystem(game.instance);
  const dilation = await ts.GetActiveTimeDilation();
  const active = await ts.IsTimeDilationActive();
  const cam = await camera();
  const fov = await cam.GetFOV();
  const zoomNow = await cam.GetZoom();
  const line = `dilation ${Number(dilation).toFixed(3)}${active ? ' (active)' : ''}, field of view ${Number(fov).toFixed(1)}, zoom ${zoomNow}`;
  if (line !== lastWatch) say(`Watch: ${line}`);
  lastWatch = line;
}

function watch(on) {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  lastWatch = '';
  if (on) {
    // While a save loads there is no world: wait quietly for it (one line, not two a second).
    let waiting = false;
    watchTimer = setInterval(() => {
      if (!inWorld) {
        if (!waiting) say('Watch: waiting for the world (a load)');
        waiting = true;
        return;
      }
      waiting = false;
      watchTick().catch((err) => say(`Watch FAILED: ${err?.message ?? err}`));
    }, 500);
    say('Watch: on (a line only when something changes)');
  } else say('Watch: off');
}

// ---------- V2: the game's own outline on one component ----------

// entRenderHighlightEvent names a component (componentName), so the game's outline may go on
// one mesh of the NPC: its head (NPC heads are their own mesh), a garment, or the body.
let outlineIndex = 2;
let outlined = new Set(); // component names outlined on the target, for Clear
const componentBox = ui.input({ placeholder: 'Component name (empty: the whole NPC)' });

const listComponents = () =>
  step('Components', async () => {
    const t = needTarget();
    // GetComponents is Codeware's (added at runtime, so not in the base game's type list).
    const list = await t.GetComponents().catch((err) => {
      throw new Error(`GetComponents failed (${err?.message ?? err}): is Codeware installed?`);
    });
    if (!Array.isArray(list)) return `GetComponents answered ${JSON.stringify(list)?.slice(0, 80)}`;
    const named = await Promise.all(list.map(async (c) => ({ type: c?.$type ?? '?', name: c ? String((await c.GetName().catch(() => '')) || '') : '' })));
    const meshes = named.filter((c) => /Mesh/i.test(c.type));
    for (const c of meshes) say(`  ${c.type} "${c.name}"`);
    return `${list.length} components, ${meshes.length} meshes (listed above; type one into the box to outline it)`;
  });

async function sendHighlight(t, name, on) {
  const evt = await api.$new('entRenderHighlightEvent', {
    outlineIndex: on ? outlineIndex : 0,
    fillIndex: 0,
    seeThroughWalls: false,
    opacity: on ? 1 : 0,
    componentName: name,
  });
  await t.QueueEvent(evt);
}

const outline = () =>
  step('Outline', async () => {
    const t = needTarget();
    const name = String(componentBox.props.value ?? '').trim();
    if (name) {
      const found = await t.FindComponentByName(name).catch(() => null);
      if (!found) return `no component "${name}" on the target (List components shows the names)`;
    }
    await sendHighlight(t, name, true);
    outlined.add(name);
    return `outline ${outlineIndex} sent to ${name ? `"${name}"` : 'the whole NPC'}: note its colour, and whether only that part shows it`;
  });

const clearOutline = () =>
  step('Clear outline', async () => {
    const t = needTarget();
    const names = outlined.size ? [...outlined] : [''];
    for (const name of names) await sendHighlight(t, name, false);
    outlined = new Set();
    return `cleared ${names.length}`;
  });

// ---------- V10: framing the enemy ----------

// Quaternions as the game writes them: { i, j, k, r }. The game's forward is +Y, up +Z.
const qmul = (a, b) => ({
  r: a.r * b.r - a.i * b.i - a.j * b.j - a.k * b.k,
  i: a.r * b.i + a.i * b.r + a.j * b.k - a.k * b.j,
  j: a.r * b.j - a.i * b.k + a.j * b.r + a.k * b.i,
  k: a.r * b.k + a.i * b.j - a.j * b.i + a.k * b.r,
});
const qinv = (q) => ({ i: -q.i, j: -q.j, k: -q.k, r: q.r });
// Facing the direction d with no roll: yaw about Z (0 faces +Y), then pitch about X.
function facing(d) {
  const yaw = Math.atan2(d.y, d.x) - Math.PI / 2;
  const pitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
  const qy = { i: 0, j: 0, k: Math.sin(yaw / 2), r: Math.cos(yaw / 2) };
  const qp = { i: Math.sin(pitch / 2), j: 0, k: 0, r: Math.cos(pitch / 2) };
  return { q: qmul(qy, qp), yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}
const angleBetween = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180) / Math.PI;

let fill = 0.8; // share of the screen's height the body fills
let framed = null; // what Back puts back: { local, fov, zoom }

// The body's middle, its height and the camera, from the slots.
async function bodyView(t) {
  const [{ places }, cam] = await Promise.all([readSlots(t), cameraView()]);
  const found = places.filter((p) => p.x !== null);
  if (!found.length) throw new Error('no slots on the target');
  const top = Math.max(...found.map((p) => p.z)) + 0.15; // the head's slot is not its top
  const bottom = Math.min(...found.map((p) => p.z)) - 0.1;
  const mid = { x: found.reduce((a, p) => a + p.x, 0) / found.length, y: found.reduce((a, p) => a + p.y, 0) / found.length, z: (top + bottom) / 2 };
  const dir = sub(mid, cam.at);
  const dist = len(dir);
  return { mid, height: top - bottom, dir, dist, cam };
}

const fovFor = (height, dist) => (2 * Math.atan(height / (2 * fill * dist)) * 180) / Math.PI;

async function checkAim(dir, what) {
  const cams = await api.GameInstance.GetCameraSystem(game.instance);
  const now = vec(await cams.GetActiveCameraForward());
  const off = angleBetween(now, dir);
  say(`  ${what}: the view is ${off.toFixed(1)} degrees off the body's middle`);
  return off;
}

// Way 1: rotate the first-person camera's own local orientation (the game may write over it).
const frameCamera = () =>
  step('Frame (camera)', async () => {
    const t = needTarget();
    const cam = await camera();
    const { dir, dist, height } = await bodyView(t);
    const cams = await api.GameInstance.GetCameraSystem(game.instance);
    const r = await cams.GetActiveCameraWorldTransform(api.$out);
    const world = r?.out?.transform?.orientation;
    const local = await cam.GetLocalOrientation();
    if (!world || !local) throw new Error('no camera orientation');
    if (!framed) framed = { local, fov: await cam.GetFOV(), zoom: await cam.GetZoom() };
    // The camera's parent turns it by world * local^-1; keep that, change what the camera adds.
    const parent = qmul(world, qinv(local));
    const want = facing(dir);
    await cam.SetLocalOrientation(qmul(qinv(parent), want.q));
    const fov = fovFor(height, dist);
    await cam.SetFOV(fov);
    say(`Frame (camera): body ${height.toFixed(2)} m tall, ${dist.toFixed(1)} m away; field of view ${framed.fov.toFixed(1)} -> ${fov.toFixed(1)}`);
    await checkAim(dir, 'at once');
    await new Promise((res) => setTimeout(res, 1000));
    await checkAim(dir, 'after 1 s');
    return 'note whether the view turned onto the body and stayed there, and whether the crosshair and aiming follow it';
  });

// Way 2: turn V where V stands, facing the body (as the Pins window's Go there faces a pin).
const frameTurnV = () =>
  step('Frame (turn V)', async () => {
    const t = needTarget();
    const cam = await camera();
    const v = await player();
    const { dir, dist, height } = await bodyView(t);
    if (!framed) framed = { local: await cam.GetLocalOrientation(), fov: await cam.GetFOV(), zoom: await cam.GetZoom() };
    const want = facing(dir);
    const at = await v.GetWorldPosition();
    const tf = await api.GameInstance.GetTeleportationFacility(game.instance);
    await tf.Teleport(v, at, { Pitch: want.pitch, Yaw: want.yaw, Roll: 0 });
    const fov = fovFor(height, dist);
    await cam.SetFOV(fov);
    say(`Frame (turn V): yaw ${want.yaw.toFixed(1)}, pitch ${want.pitch.toFixed(1)}; body ${height.toFixed(2)} m tall, ${dist.toFixed(1)} m away; field of view ${framed.fov.toFixed(1)} -> ${fov.toFixed(1)}`);
    await new Promise((res) => setTimeout(res, 300));
    await checkAim(dir, 'after 0.3 s');
    return 'note whether V turned to face the body, and whether the pitch (looking up or down) took';
  });

const frameBack = () =>
  step('Frame back', async () => {
    if (!framed) return 'nothing framed';
    const cam = await camera();
    await cam.SetLocalOrientation(framed.local);
    await cam.SetFOV(framed.fov);
    await cam.SetZoom(framed.zoom);
    const fov = await cam.GetFOV();
    framed = null;
    return `camera back: field of view reads ${fov.toFixed(1)}`;
  });

// ---------- the trigger: VATS while scanning (round 3) ----------

// Whether the game has a world (false while a save loads), kept from game.onState.
let inWorld = true;
game.state().then((s) => (inWorld = !!s.world)).catch(() => {});
game.onState((s) => (inWorld = !!s.world));

// The scanner is up when the player state machine's Vision is Focus (1).
let psm = null;
async function scanning() {
  if (!psm) {
    const v = await player();
    const defs = await api.GetAllBlackboardDefs();
    const def = await defs.$get('PlayerStateMachine');
    const vision = await def.$get('Vision');
    const boards = await api.GameInstance.GetBlackboardSystem(game.instance);
    const board = await boards.GetLocalInstanced(await v.GetEntityID(), def);
    if (!board) throw new Error('no player state machine blackboard');
    psm = { board, vision };
  }
  try {
    return (await psm.board.GetInt(psm.vision)) === 1;
  } catch (err) {
    psm = null; // a load made a new player: find the board again
    throw err;
  }
}

// The meshes worn on a part, by their names' prefixes (round 2). Gloves and trousers cover
// both sides, so left and right outline the same meshes.
const PART_PREFIXES = {
  Head: ['h0_', 'heb_', 'hh_', 'h1_'],
  Torso: ['t1_', 't2_'],
  'Left arm': ['g1_', 'a0_'],
  'Right arm': ['g1_', 'a0_'],
  'Left leg': ['l1_', 's1_'],
  'Right leg': ['l1_', 's1_'],
};
let meshesOf = { target: null, names: [] };
async function meshNames(t) {
  if (meshesOf.target === t) return meshesOf.names;
  const list = (await t.GetComponents().catch(() => [])) ?? [];
  const named = await Promise.all(list.map(async (c) => ({ type: c?.$type ?? '', name: c ? String((await c.GetName().catch(() => '')) || '') : '' })));
  const names = named.filter((c) => /Mesh/i.test(c.type) && c.name && !/_shadow/.test(c.name)).map((c) => c.name);
  meshesOf = { target: t, names };
  return names;
}
const meshesFor = (names, part) => names.filter((n) => (PART_PREFIXES[part] ?? []).some((p) => n.startsWith(p)));

let rtMode = false;
let rtHeld = false;
let vatsColour = 1; // the outline colour for VATS's part: green is to find (round 2 saw blue, white, red in 2, 5, 3)
let vats = null; // { target, saved, part, lit: [names], timer }
let vatsChain = Promise.resolve();
const vatsStep = (fn) => (vatsChain = vatsChain.then(fn).catch((err) => say(`VATS FAILED: ${err?.message ?? err}`)));

async function light(t, names, on) {
  await Promise.all(names.map(async (name) => {
    const evt = await api.$new('entRenderHighlightEvent', { outlineIndex: on ? vatsColour : 0, fillIndex: 0, seeThroughWalls: false, opacity: on ? 1 : 0, componentName: name });
    await t.QueueEvent(evt);
  }));
}

async function enterVats() {
  if (vats) return;
  const started = performance.now();
  if (!(await scanning())) {
    say('VATS: right trigger, but the scanner is not up: nothing to do');
    return;
  }
  const v = await player();
  const targeting = await api.GameInstance.GetTargetingSystem(game.instance);
  const t = await targeting.GetLookAtObject(v, false, false);
  if (!t) {
    say('VATS: the scanner is up but V looks at nothing');
    return;
  }
  const cam = await camera();
  const { dir, dist, height } = await bodyView(t);
  const cams = await api.GameInstance.GetCameraSystem(game.instance);
  const r = await cams.GetActiveCameraWorldTransform(api.$out);
  const world = r?.out?.transform?.orientation;
  const local = await cam.GetLocalOrientation();
  if (!world || !local) throw new Error('no camera orientation');
  const saved = { local, fov: await cam.GetFOV(), zoom: await cam.GetZoom() };
  const parent = qmul(world, qinv(local));
  await cam.SetLocalOrientation(qmul(qinv(parent), facing(dir).q));
  await cam.SetFOV(fovFor(height, dist));
  const names = await meshNames(t);
  vats = { target: t, saved, part: null, lit: [], timer: null, names };
  say(`VATS on: ${t.$type} "${(await t.GetDisplayName()) || 'no name'}", ${dist.toFixed(1)} m, field of view ${saved.fov.toFixed(1)} -> ${fovFor(height, dist).toFixed(1)}, ${names.length} meshes (${(performance.now() - started).toFixed(0)} ms)`);
  let busy = false;
  vats.timer = setInterval(() => {
    if (busy || !vats) return;
    busy = true;
    vatsStep(tickVats).finally(() => (busy = false));
  }, 150);
}

async function tickVats() {
  if (!vats) return;
  if (!(await scanning())) {
    await leaveVats('the scanner was let go');
    return;
  }
  const hit = await crosshairPart(vats.target);
  const part = hit?.part ?? null;
  if (part === vats.part) return;
  const want = part ? meshesFor(vats.names, part) : [];
  const off = vats.lit.filter((n) => !want.includes(n));
  const on = want.filter((n) => !vats.lit.includes(n));
  await Promise.all([light(vats.target, off, false), light(vats.target, on, true)]);
  vats.part = part;
  vats.lit = want;
  say(`VATS: crosshair on ${part ? `the ${part} (${hit.slot}): ${want.length ? want.join(', ') : 'no mesh worn there to outline'}` : 'no part'}`);
}

async function leaveVats(why) {
  if (!vats) return;
  const was = vats;
  vats = null;
  clearInterval(was.timer);
  await light(was.target, was.lit, false).catch(() => {});
  const cam = await camera();
  await cam.SetLocalOrientation(was.saved.local);
  await cam.SetFOV(was.saved.fov);
  await cam.SetZoom(was.saved.zoom);
  say(`VATS off (${why}): camera back`);
}

input.onGamepad((pad) => {
  if (!rtMode) return;
  if (!rtHeld && pad.rt >= 0.6) {
    rtHeld = true;
    vatsStep(enterVats);
  } else if (rtHeld && pad.rt <= 0.3) {
    rtHeld = false;
    vatsStep(() => leaveVats('the right trigger was let go'));
  }
});

function rightTriggerMode(on) {
  rtMode = on;
  say(on ? 'Right trigger VATS: on. Hold the scanner, aim at an enemy, hold the right trigger' : 'Right trigger VATS: off');
  if (!on) {
    rtHeld = false;
    vatsStep(() => leaveVats('switched off'));
  }
}

// ---------- the window ----------

ui.window({
  title: 'VATS spike',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 640,
  height: 860,
  closable: true,
  children: [
    ui.text('Research for VATS (docs/vats.md). Each button logs what the game answered. Slow motion always runs out on its own.', { tone: 'dim' }),
    status,
    ui.heading('Target'),
    ui.row(ui.button('Target', () => step('Target', pickTarget)), ui.button('Crosshair (V4)', crosshair, { variant: 'ghost' })),
    ui.heading('Body parts (V1)'),
    ui.row(ui.button('Read slots', readParts), ui.toggle('Show parts', (on) => showParts(on))),
    ui.slider('Updates a second', (v) => {
      hz = Math.round(v);
      if (pinTimer) showParts(true);
    }, { min: 1, max: 15, step: 1, value: hz }),
    ui.heading('Zoom (V3)'),
    ui.row(
      ui.button('x2', () => zoom(2)),
      ui.button('x4', () => zoom(4), { variant: 'ghost' }),
      ui.button('SetZoom 2', () => zoomProp(2), { variant: 'ghost' }),
      ui.button('Back', zoomReset, { variant: 'ghost' }),
    ),
    ui.heading('Slow motion (V5)'),
    ui.toggle('Keep V at normal speed', (on) => (vNormal = on), { checked: true }),
    ui.slider('Seconds', (v) => (slowSeconds = Math.round(v)), { min: 2, max: 30, step: 1, value: slowSeconds, unit: ' s' }),
    ui.row(
      ui.button('0.3', () => slow(0.3)),
      ui.button('0.1', () => slow(0.1), { variant: 'ghost' }),
      ui.button('0.05', () => slow(0.05), { variant: 'ghost' }),
      ui.button('0.01', () => slow(0.01), { variant: 'ghost' }),
      ui.button('Normal', unslow, { variant: 'ghost' }),
    ),
    ui.toggle('Watch the dilation and the camera', (on) => watch(on)),
    ui.heading('Exposure (V8)'),
    ui.row(ui.button('Exposure', exposureOnce), ui.toggle('Chance on the labels', (on) => (exposureLabels = on))),
    ui.heading('Right trigger VATS (round 3)'),
    ui.text('With this on: hold the scanner, aim at an enemy, hold the right trigger. The view frames them and the part under the crosshair is outlined; let go of the trigger (or the scanner) to end it.', { tone: 'dim' }),
    ui.toggle('Right trigger VATS', (on) => rightTriggerMode(on)),
    ui.slider('VATS colour', (v) => (vatsColour = Math.round(v)), { min: 1, max: 7, step: 1, value: vatsColour }),
    ui.heading('Outline (V2)'),
    ui.row(ui.button('List components', listComponents), ui.button('Outline', outline, { variant: 'ghost' }), ui.button('Clear', clearOutline, { variant: 'ghost' })),
    componentBox,
    ui.slider('Outline colour', (v) => (outlineIndex = Math.round(v)), { min: 1, max: 7, step: 1, value: outlineIndex }),
    ui.heading('Frame (V10)'),
    ui.slider('Body fills', (v) => (fill = v / 100), { min: 40, max: 95, step: 5, value: fill * 100, unit: ' %' }),
    ui.row(ui.button('Frame (camera)', frameCamera), ui.button('Frame (turn V)', frameTurnV, { variant: 'ghost' }), ui.button('Camera back', frameBack, { variant: 'ghost' })),
    ui.heading('Only one part can be hit (part 2)'),
    ui.slider('Seconds before the shapes come back', (v) => (onlySeconds = Math.round(v)), { min: 3, max: 30, step: 1, value: onlySeconds, unit: ' s' }),
    ui.row(...PARTS.map((p) => ui.button(p.part, () => onlyPart(p), { variant: 'ghost' }))),
    ui.heading('Log'),
    log,
  ],
});

say('VATS spike ready. Load a save, look at an enemy and press Target.');
