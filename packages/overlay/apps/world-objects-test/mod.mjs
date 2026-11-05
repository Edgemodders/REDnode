// World objects test: H2c-b's test app (docs/world.md, "H2c-b: plan"). Each button calls one
// part of the world API and logs what it called, what came back and how long it took. What
// shows on screen is for the player to say. (0.1.x was H2c-a's spike, through `api` only.)
//
//   1 Spawn     a person by TweakDB record (stands still, friendly, through world.spawn), a
//               prop by mesh alone, the package's spawn list, a move of the newest spawn (#27:
//               a swap's respawn must keep the moved place); far from V (#35): a spawn that
//               times out is removed, and one with wait: false is kept until it comes in;
//               #41's probe: alwaysSpawned boxes far from V, a camera flown to them, a batch
//   2 Near V    world.near: the entities around V with the files they use, read in the game
//               in one call; only those that use a given file
//   3 Scene     writes an EDGEbuilder scene around V into this app's folder, loads it with
//               world.load, unloads it
//   4 Swap      archives.reload, and what its refresh did to the world (through REDswap on 2.5)
//
// Switching the app off removes everything it spawned (the host does it).

import fs from 'node:fs';
import path from 'node:path';
import { archives, kernel, pkg, ui, world, api, game } from 'rednode';

const RECORD = 'Character.CitizenRichFemale';
const BOX = 'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh';
const BARREL = 'base\\environment\\decoration\\containers\\barrel\\drum\\barrel_drum_h_bound.mesh';

let record = RECORD;
let meshPath = BOX;
let keep = false;
let radius = 15;
let uses = '';
let file = '';
let busy = '';
let loaded = null; // the scene name, once loaded

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const log = ui.list({ keep: 500 });

function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

// One step at a time, timed; a failure is logged, not thrown.
async function step(label, fn) {
  if (busy) return say(`${label}: not run, ${busy} is still running`);
  busy = label;
  const started = performance.now();
  try {
    const note = await fn();
    say(`${label}: ${note ?? 'done'} (${(performance.now() - started).toFixed(0)} ms)`);
  } catch (err) {
    say(`${label} failed: ${err.message}`);
  } finally {
    busy = '';
  }
}

async function inFront(metres, side = 0) {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  // Facing V: turned around from V's own heading. `side` moves it to V's right.
  const yaw = (Math.atan2(f.Y, f.X) * 180) / Math.PI + 90;
  return { position: { x: p.X + f.X * metres + f.Y * side, y: p.Y + f.Y * metres - f.X * side, z: p.Z }, yaw };
}

const short = (h) => String(h).replace(/^0x0+/, '0x');

// ---- 1. Spawn ---------------------------------------------------------------------

const spawnPerson = () =>
  step(`Spawn ${record}`, async () => {
    const at = await inFront(3);
    const { id, entity } = await world.spawn({ record, ...at, keep });
    const look = entity ? await entity.GetCurrentAppearanceName().catch(() => '?') : 'not in the world';
    return `${id.hash}, appearance ${look}${keep ? ', kept in saves' : ''}; it should stand still and be friendly`;
  });

const spawnProp = () =>
  step('Spawn a prop', async () => {
    const at = await inFront(2, 1);
    const { id, entity } = await world.spawn({ mesh: meshPath.trim() || BOX, ...at, keep });
    return `${id.hash} with ${meshPath}${entity ? '' : ', not in the world after 10 s'}`;
  });

const listSpawned = () =>
  step('Spawned', async () => {
    const list = world.spawned();
    for (const s of list) say(`  ${s.id.hash}  ${s.options.record ?? s.options.mesh ?? s.options.template}  ${s.attached ? 'in the world' : 'not in the world yet'}${s.scene ? `  (scene ${s.scene})` : ''}`);
    return `${list.length} listed`;
  });

// #35: a box 4 km ahead of V, where the game does not stream it in. Waiting, it times out and
// is removed; with wait: false it is listed at once and comes in when V gets there.
const FAR = 4000;
const farWaiting = () =>
  step('Far, waiting', async () => {
    const at = await inFront(FAR);
    try {
      const { id } = await world.spawn({ mesh: BOX, ...at, timeoutMs: 3000 });
      return `${id.hash} came in after all, 4 km away`;
    } catch (err) {
      return `refused as it should be: ${err.message}`;
    }
  });
const farLater = () =>
  step('Far, wait: false', async () => {
    const at = await inFront(FAR);
    const { id, entity } = await world.spawn({ mesh: BOX, ...at, wait: false });
    const s = world.spawned().find((e) => e.id.hash === id.hash);
    return `${id.hash} at once, entity ${entity === null ? 'null' : 'given'}, listed ${s ? (s.attached ? 'and in the world' : 'and not in the world yet') : 'NOT'}`;
  });

// #41: does alwaysSpawned bring an object in far from V, stay there, and cost little? Every box
// is logged when it comes in and when it leaves, with how long it took and how far V is then.
const watched = new Map();
const distanceToV = async (at) => {
  const v = await api.GetPlayer(game.instance).catch(() => null);
  const p = v ? await v.GetWorldPosition().catch(() => null) : null;
  return p ? Math.hypot(p.X - at.x, p.Y - at.y, p.Z - at.z).toFixed(0) : '?';
};
world.on('Entity/AfterAttach', async (e) => {
  const w = watched.get(String(e.entityId));
  if (!w) return;
  if (w.batch) return void (w.batch.in += 1);
  say(`${w.label}: in the world after ${((performance.now() - w.started) / 1000).toFixed(1)} s, V ${await distanceToV(w.position)} m away`);
});
world.on('Entity/Detach', async (e) => {
  const w = watched.get(String(e.entityId));
  if (!w) return;
  if (w.batch) return void (w.batch.left += 1);
  say(`${w.label}: left the world, V ${await distanceToV(w.position)} m away`);
});

const boxAt = (metres, always, side = 0) =>
  step(`${always ? 'Always' : 'Not always'}, ${metres} m`, async () => {
    const at = await inFront(metres, side);
    const label = `${always ? 'Always' : 'Not always'} box ${metres} m`;
    const started = performance.now();
    const { id } = await world.spawn({ mesh: BOX, ...at, alwaysSpawned: always, wait: false });
    watched.set(id.hash, { label, started, position: at.position });
    // The event can come before the id does.
    const already = world.spawned().find((e) => e.id.hash === id.hash)?.attached;
    return `${id.hash} asked for${already ? ', and in the world already' : ''}`;
  });

// A few hundred, for what they cost: 200 boxes on a grid, 1 km ahead. The log says how long the
// calls took and, on Batch count, how many are in. Watch the game's frame rate while they come in.
let batch = null;
const spawnBatch = () =>
  step('Always, 200 boxes', async () => {
    const at = await inFront(1000);
    batch = { in: 0, left: 0, started: performance.now() };
    const before = performance.now();
    for (let i = 0; i < 200; i++) {
      const position = { ...at.position, x: at.position.x + (i % 20) * 2, y: at.position.y + Math.floor(i / 20) * 2 };
      const { id } = await world.spawn({ mesh: BOX, position, yaw: at.yaw, alwaysSpawned: true, wait: false });
      watched.set(id.hash, { label: 'batch', started: before, position, batch });
    }
    return `200 asked for in ${(performance.now() - before).toFixed(0)} ms; press Batch count`;
  });
const batchCount = () =>
  step('Batch count', async () =>
    batch ? `${batch.in} of 200 in the world, ${batch.left} left, ${((performance.now() - batch.started) / 1000).toFixed(0)} s after asking` : 'no batch yet',
  );

// The camera EDGEbuilder flies, as far as a look needs: an empty entity with a camera component,
// put 6 m short of the newest box, looking at it. V stays where V is.
const EMPTY = 'base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent';
let camera = null;
const cameraBack = () =>
  step('Camera back', async () => {
    if (!camera) return 'the camera is V\'s already';
    await camera.component.Deactivate(0, false).catch(() => {});
    await world.remove(camera.id).catch(() => false);
    camera = null;
    const v = await api.GetPlayer(game.instance);
    const fpp = v ? await v.GetFPPCameraComponent() : null;
    if (fpp) await fpp.Activate(0, false);
    return 'V\'s camera is back';
  });
const cameraToNewest = () =>
  step('Camera to the newest box', async () => {
    const newest = [...watched.values()].filter((w) => !w.batch).at(-1) ?? [...watched.values()].at(-1);
    if (!newest) return 'no box yet: press one of the Always buttons first';
    if (!camera) {
      const component = await api.$new('gameCameraComponent', { name: 'world_test_camera' });
      const { id, entity } = await world.spawn({ template: EMPTY, ...(await inFront(1)), components: [component] });
      const cam = (entity && (await entity.FindComponentByName('world_test_camera'))) ?? component;
      await cam.Activate(0, false);
      camera = { id, component: cam };
    }
    const t = newest.position;
    await world.move(camera.id, { x: t.x, y: t.y - 6, z: t.z + 1.5 }, undefined, 0);
    return `looking at ${newest.label === 'batch' ? 'the batch' : newest.label} from 6 m, V ${await distanceToV(t)} m from it. Is the box drawn? The ground and buildings?`;
  });

// Moves the newest spawn 2 m to its right and turns it a quarter, as an editor's gizmo would.
const moveNewest = () =>
  step('Move', async () => {
    const s = world.spawned().at(-1);
    if (!s) return 'nothing spawned';
    const entity = await world.entity(s.id);
    if (!entity) return `${s.id.hash} is not in the world`;
    const p = await entity.GetWorldPosition();
    const yaw = (await entity.GetWorldYaw()) + 90;
    const moved = await world.move(s.id, { x: p.X + 2, y: p.Y, z: p.Z }, undefined, yaw);
    return `${s.id.hash} ${moved ? `moved 2 m east and turned to ${yaw.toFixed(0)} degrees; a swap's respawn should keep this place` : 'not moved'}`;
  });

const removeAll = () =>
  step('Remove spawned', async () => {
    let n = 0;
    for (const s of world.spawned()) if (await world.remove(s.id).catch(() => false)) n += 1;
    loaded = null;
    return `${n} removed`;
  });

// ---- 2. Near V --------------------------------------------------------------------

function report(list) {
  for (const e of list.slice(0, 30)) {
    const files = e.files ? `, ${e.files.length} files` : '';
    const matches = e.matches ? `, uses ${e.matches.map(short).join(', ')}` : '';
    say(`  ${e.distance.toFixed(1)} m  ${e.type}  ${e.appearance}${files}${matches}`);
  }
  if (list.length > 30) say(`  ... and ${list.length - 30} more`);
}

const near = (files) =>
  step(`Near V${files ? ' with files' : ''}`, async () => {
    const list = await world.near({ radius, files });
    report(list);
    return `${list.length} within ${radius} m`;
  });

const nearUsing = () =>
  step('Near V using a file', async () => {
    const list = uses.trim().split(/[;,]\s*/).filter(Boolean);
    if (!list.length) throw new Error('type a depot path (or a few, with commas) first');
    const found = await world.near({ radius, uses: list });
    report(found);
    return `${found.length} within ${radius} m use ${list.length === 1 ? 'it' : 'one of them'}`;
  });

const nearestFiles = () =>
  step('Files of the nearest', async () => {
    const [first] = await world.near({ radius });
    if (!first) throw new Error(`nothing within ${radius} m`);
    const f = await world.files(first.entity);
    return `${first.type} ${first.appearance}: template ${f.template ?? 'none'}, ${f.components} components, ${f.files.length} files`;
  });

// ---- 3. Scene ---------------------------------------------------------------------

// An EDGEbuilder scene (format 2) around V: two props, a person, a light (skipped).
async function writeScene() {
  const a = await inFront(4, -1.5);
  const b = await inFront(4, 1.5);
  const c = await inFront(6);
  const q = (yaw) => [0, 0, Math.sin((yaw * Math.PI) / 360), Math.cos((yaw * Math.PI) / 360)];
  const t = (at) => ({ position: [at.position.x, at.position.y, at.position.z], rotation: q(at.yaw), scale: [1, 1, 1] });
  const scene = {
    format: 2,
    name: 'world_objects_test',
    game: '2.5',
    groups: [],
    objects: [
      { id: 'box', kind: 'mesh', resource: BOX, appearance: 'default', transform: t(a) },
      { id: 'barrel', kind: 'mesh', resource: BARREL, appearance: 'default', transform: t(b) },
      { id: 'person', kind: 'npc', record: RECORD, transform: t(c), props: { behaviour: 'idle' } },
      { id: 'lamp', kind: 'light', transform: t(c), props: { type: 'point', color: [255, 200, 120], intensity: 800, radius: 8 } },
    ],
  };
  // In the data folder: a file written into pkg.dir would hot reload the app, which removes
  // everything it spawned (0.2.0 did that).
  const out = path.join(pkg.dataDir, 'world_objects_test.scene.json');
  fs.writeFileSync(out, JSON.stringify(scene, null, 2));
  return out;
}

const loadScene = () =>
  step('Load a scene here', async () => {
    const out = await writeScene();
    const r = await world.load(out);
    loaded = r.name;
    for (const s of r.spawned) say(`  ${s.object}: ${s.id.hash}`);
    for (const s of r.skipped) say(`  ${s.object} skipped: ${s.why}`);
    for (const n of r.notes) say(`  ${n}`);
    return `${r.name}: ${r.spawned.length} spawned, ${r.skipped.length} skipped, from ${path.basename(out)}`;
  });

const unloadScene = () =>
  step('Unload the scene', async () => {
    if (!loaded) throw new Error('load a scene first');
    const n = await world.unload(loaded);
    loaded = null;
    return `${n} removed`;
  });

// ---- 4. Swap ----------------------------------------------------------------------

const swap = () =>
  step(`Swap ${file.trim()}`, async () => {
    if (!file.trim()) throw new Error('type an archive first');
    const r = await archives.reload([file.trim()]);
    for (const f of r.failed) say(`  failed ${f.file}: ${f.why}`);
    for (const w of r.world ?? []) say(`  ${w.how}: ${w.type ?? w.package} ${w.entity}${w.appearance ? ` (${w.appearance}, ${w.distance?.toFixed(1)} m)` : ''}`);
    return `${r.reloaded.length} swapped in ${r.ms} ms; ${(r.refreshed ?? []).length} worn item(s) and ${(r.world ?? []).length} world entit${(r.world ?? []).length === 1 ? 'y' : 'ies'} refreshed`;
  });

world.onRespawn((before, after) => say(`Spawned again after a swap: ${before.hash} is now ${after.hash}`));

// ---- Window -----------------------------------------------------------------------

ui.window({
  title: 'World objects test',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 660,
  height: 880,
  closable: true,
  children: [
    requires,
    ui.heading('1. Spawn'),
    ui.input({ value: RECORD, placeholder: 'A Character record', onChange: (v) => (record = v.trim()), onSubmit: (v) => (record = v.trim()) }),
    ui.input({ value: BOX, placeholder: 'A .mesh for a prop', onChange: (v) => (meshPath = v), onSubmit: (v) => (meshPath = v) }),
    ui.toggle('Keep in saves', (on) => (keep = on)),
    ui.row(
      ui.button('Spawn a person', spawnPerson),
      ui.button('Spawn a prop', spawnProp, { variant: 'ghost' }),
      ui.button('Move', moveNewest, { variant: 'ghost' }),
      ui.button('Spawned', listSpawned, { variant: 'ghost' }),
      ui.button('Remove spawned', removeAll, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Far, waiting', farWaiting, { variant: 'ghost' }),
      ui.button('Far, wait: false', farLater, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Always, 8 m', () => boxAt(8, true, -1), { variant: 'ghost' }),
      ui.button('Not always, 8 m', () => boxAt(8, false, 1), { variant: 'ghost' }),
      ui.button('Not always, 300 m', () => boxAt(300, false), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Always, 300 m', () => boxAt(300, true), { variant: 'ghost' }),
      ui.button('Always, 1 km', () => boxAt(1000, true), { variant: 'ghost' }),
      ui.button('Always, 4 km', () => boxAt(4000, true), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Camera to the newest box', cameraToNewest, { variant: 'ghost' }),
      ui.button('Camera back', cameraBack, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Always, 200 boxes', spawnBatch, { variant: 'ghost' }),
      ui.button('Batch count', batchCount, { variant: 'ghost' }),
    ),
    ui.heading('2. Near V'),
    ui.slider('Radius (m)', (v) => (radius = v), { min: 5, max: 60, step: 5, value: radius }),
    ui.row(
      ui.button('Near V', () => near(false)),
      ui.button('With files', () => near(true), { variant: 'ghost' }),
      ui.button('Files of the nearest', nearestFiles, { variant: 'ghost' }),
    ),
    ui.input({ placeholder: 'A depot path, for Using this file', onChange: (v) => (uses = v), onSubmit: (v) => (uses = v) }),
    ui.row(ui.button('Using this file', nearUsing, { variant: 'ghost' })),
    ui.heading('3. Scene'),
    ui.row(
      ui.button('Load a scene here', loadScene),
      ui.button('Unload the scene', unloadScene, { variant: 'ghost' }),
    ),
    ui.heading('4. Swap'),
    ui.input({
      placeholder: 'MyMod.archive in archive/pc/mod, or a full path (Enter swaps)',
      onChange: (v) => (file = v),
      onSubmit: (v) => {
        file = v;
        swap();
      },
    }),
    ui.row(ui.button('Swap', swap)),
    log,
  ],
});

const checked = await kernel.requirements();
let ready = null;
// Checked again every 5 s, since the app may start before a save is loaded (0.2.0 checked once).
async function checkWorld() {
  const now = await world.available().catch(() => false);
  if (now === ready) return;
  ready = now;
  requires.set({
    text: [
      ...checked.map((r) => `${r.ok ? 'OK' : 'MISSING'}  ${r.name} ${r.wants}  ${r.found ?? r.note}`),
      `${ready ? 'OK' : 'NOT READY'}  world API (Codeware, a loaded save)`,
    ].join('\n'),
    tone: checked.every((r) => r.ok) ? 'normal' : 'danger',
  });
}
await checkWorld();
setInterval(checkWorld, 5000);
say('World objects test ready');
