// VATS spike: the research for VATS, the Visual Assisted Targeting System (docs/vats.md).
// Everything goes through `api` and world pins, so REDnode itself is unchanged. Each button
// calls the game and logs what it answered and how long it took; what shows on screen is
// for the player to say. What it learns serves other mods too (where body parts are, the
// camera's zoom, time dilation, hit shapes), so its findings go into the game API notes.
//
//   Target       what V looks at (TargetingSystem.GetLookAtObject), kept as the target
//   Parts (V1)   the target's 15 hit shape slots read with the global GetTargetSlotPosition,
//                grouped into six parts, pinned where they are, again a few times a second
//   Zoom (V3)    the player's camera: GetFOV, SetFOV, SetZoom, and back
//   Slow (V5)    TimeSystem.SetTimeDilation on the world, with V left at normal speed or not;
//                always with a duration, so it runs out on its own if the mod stops
//   Crosshair (V4)  TargetingSystem.GetLookAtComponent: which component V looks at
//   Only one part   DisableHitShape on every other shape of the target, for part 2 (hitting
//                the chosen part); EnableHitShape puts them back after a few seconds
//   Watch        twice a second: the active time dilation and the camera's field of view,
//                to see what the scanner itself changes

import { api, game, ui, world } from 'rednode';

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
const say = (line) => log.push(`${new Date().toLocaleTimeString()}  ${line}`);

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

// Every slot's place now, and how long the reads took. A slot the target lacks reads null.
async function readSlots(t) {
  const started = performance.now();
  const places = await Promise.all(
    SLOTS.map(async (slot) => {
      const r = await api.GetTargetSlotPosition(t, slot, api.$out);
      const p = r?.out?.slotPosition;
      return r?.result && p ? { slot, x: p.X, y: p.Y, z: p.Z } : { slot, x: null };
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
    const missing = places.filter((p) => p.x === null).map((p) => p.slot);
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

async function pinTick() {
  if (!target) return;
  const started = performance.now();
  const { places, ms } = await readSlots(target);
  const parts = partsOf(places);
  await clearPartPins();
  for (const p of parts) {
    if (!pinsOn) break; // switched off while this update ran
    if (!p.at) continue;
    pinIds.push(await world.pin({ at: p.at, title: p.part, style: { color: p.color, scale: 'screen', pinHeight: 0, titleSize: 14 } }));
  }
  pinTicks += 1;
  pinMs += performance.now() - started;
  if (pinTicks % (hz * 5) === 0) say(`Parts: ${pinTicks} updates, ${(pinMs / pinTicks).toFixed(1)} ms each (slot reads ${ms.toFixed(1)} ms), ${parts.filter((p) => p.at).length} parts`);
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
    return `${comp.$type} "${name}" on ${owner ? `${owner.$type} "${(await owner.GetDisplayName()) || 'no name'}"` : 'nothing'}`;
  });

// ---------- part 2: only one part can be hit ----------

let onlySeconds = 6;

const onlyPart = (part) =>
  step(`Only ${part.part} can be hit`, async () => {
    const t = needTarget();
    const off = SLOTS.filter((s) => !part.slots.includes(s));
    for (const shape of off) await api.DisableHitShape(t, shape, false);
    setTimeout(async () => {
      for (const shape of off) await api.EnableHitShape(t, shape, false).catch(() => {});
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
    watchTimer = setInterval(() => watchTick().catch((err) => say(`Watch FAILED: ${err?.message ?? err}`)), 500);
    say('Watch: on (a line only when something changes)');
  } else say('Watch: off');
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
    ui.heading('Only one part can be hit (part 2)'),
    ui.row(...PARTS.map((p) => ui.button(p.part, () => onlyPart(p), { variant: 'ghost' }))),
    ui.heading('Log'),
    log,
  ],
});

say('VATS spike ready. Load a save, look at an enemy and press Target.');
