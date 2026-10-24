// World objects test: the spike of H2c (docs/world.md, "H2c World objects: plan").
// Through `api` only, no part of REDnode changed. Each button tries one thing and logs
// what it called, what came back and how long it took. What shows on screen is for the
// player to say.
//
//   1 NPC       spawn a character by TweakDB record or by its template, hold it in place
//               and make it friendly; where it went, what it does, whether a save keeps it
//   2 Near V    list the entities around V two ways (the game's entity list, filtered by
//               distance, and the targeting system's search), with the resources their
//               components name
//   3 Swap      swap an archive, then: which entities near V use a file in it, and which
//               refresh shows the new file on each (appearance again, through a missing
//               one and back, respawn for what this app spawned)

import fs from 'node:fs';
import path from 'node:path';
import { api, archives, game, kernel, pkg, tweakdb, ui, world } from 'rednode';

const RECORD = 'Character.CitizenRichFemale';
const TEMPLATE = 'base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent';
const BOX = 'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh';
const MESH_NAME = 'rednode_objects_mesh';
const HOLD_SECONDS = 3600;

let record = RECORD;
let appearance = '';
let keep = false; // DynamicEntitySpec's persistState and persistSpawn
let radius = 15;
let meshPath = BOX;
let file = '';
let busy = '';

const spawned = []; // { id, kind: 'npc'|'box', spec: {...}, at, label }
let near = []; // { ref, type, distance, name, look, hashes: Set<bigint> | null }
let swappedHashes = null; // the file table of the last archive swapped

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function player() {
  const p = await api.GetPlayer(game.instance);
  if (!p) throw new Error('No player: load a save first');
  return p;
}

async function inFront(metres) {
  const v = await player();
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  // Facing V: turned around from V's own heading.
  const yaw = (Math.atan2(f.Y, f.X) * 180) / Math.PI - 90 + 180;
  return { at: { x: p.X + f.X * metres, y: p.Y + f.Y * metres, z: p.Z }, yaw };
}

const distance = (a, b) => Math.hypot(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
const short = (hash) => `0x${hash.toString(16).padStart(16, '0')}`;

// A resource reference as the plugin reads it: the path's hash, as a string.
function hashOf(value) {
  if (value == null) return null;
  const v = typeof value === 'object' ? value.hash ?? value.path ?? null : value;
  try {
    const h = BigInt(v);
    return h === 0n ? null : h;
  } catch {
    return null;
  }
}

// ---- 1. NPC -----------------------------------------------------------------------

// The spec built here rather than through world.spawn, so the spike can set what
// world.spawn does not offer yet (persistState, persistSpawn). REDnodeWorld.Spawn tags it
// and passes the entity events on, as for world.spawn.
async function spawnSpec(fields, components = []) {
  const spec = await api.$new('DynamicEntitySpec', {
    spawnInView: true,
    active: true,
    tags: ['rednode_objects_test'],
    ...(keep ? { persistState: true, persistSpawn: true } : {}),
    ...fields,
  });
  const id = await api.$static('REDnodeWorld', 'Spawn', spec, components);
  if (!id || id.hash === '0') throw new Error('no entity was created (Codeware and a loaded save are needed)');
  const until = Date.now() + 10000;
  let entity = null;
  while (!(entity = await world.entity(id)) && Date.now() < until) await sleep(100);
  return { id, entity };
}

function rotation(yaw) {
  const half = ((yaw * Math.PI) / 180) / 2;
  return { i: 0, j: 0, k: Math.sin(half), r: Math.cos(half) };
}

async function spawnNpc(by) {
  const { at, yaw } = await inFront(3);
  const fields = { position: { X: at.x, Y: at.y, Z: at.z, W: 1 }, orientation: rotation(yaw) };
  let label;
  if (by === 'record') {
    fields.recordID = record;
    label = record;
  } else {
    const r = await tweakdb.record(record);
    if (!r) throw new Error(`no record ${record}`);
    const template = await r.EntityTemplatePath();
    if (!hashOf(template)) throw new Error(`${record} names no template`);
    fields.templatePath = template;
    label = `template of ${record} (${template})`;
  }
  if (appearance.trim()) fields.appearanceName = appearance.trim();
  const started = performance.now();
  const { id, entity } = await spawnSpec(fields);
  const ms = (performance.now() - started).toFixed(0);
  const entry = { id, kind: 'npc', fields, at, label };
  spawned.push(entry);
  if (!entity) return `${label}: created ${id.hash} but not in the world after 10 s`;
  const look = await entity.GetCurrentAppearanceName().catch(() => '?');
  // Where it is 5 s later: did it walk off?
  setTimeout(() => where(entry, '5 s after the spawn').catch((err) => say(`5 s check failed: ${err.message}`)), 5000);
  return `${label}: ${entity.$type} ${id.hash}, appearance ${look}, in the world after ${ms} ms${keep ? ', kept in saves' : ''}`;
}

async function lastNpc() {
  const entry = [...spawned].reverse().find((s) => s.kind === 'npc');
  if (!entry) throw new Error('spawn an NPC first');
  const entity = await world.entity(entry.id);
  if (!entity) throw new Error(`${entry.id.hash} is not in the world`);
  return { entry, entity };
}

async function where(entry, when) {
  const entity = await world.entity(entry.id);
  if (!entity) return say(`${when}: ${entry.id.hash} is not in the world`);
  const v = await player();
  const p = await entity.GetWorldPosition();
  const moved = Math.hypot(p.X - entry.at.x, p.Y - entry.at.y, p.Z - entry.at.z);
  const attitude = await entity.GetAttitudeTowards(v).catch(() => '?');
  const dead = await entity.IsDead().catch(() => '?');
  const look = await entity.GetCurrentAppearanceName().catch(() => '?');
  say(`${when}: ${entry.id.hash} moved ${moved.toFixed(2)} m from its spot, ${distance(p, await v.GetWorldPosition()).toFixed(1)} m from V, attitude to V ${attitude}, dead ${dead}, appearance ${look}`);
}

const holdAndFriendly = () =>
  step('Hold and friendly', async () => {
    const { entry, entity } = await lastNpc();
    const v = await player();
    const notes = [];
    const ai = await entity.GetAIControllerComponent().catch(() => null);
    if (ai) {
      const hold = await api.$new('AIHoldPositionCommand', { duration: HOLD_SECONDS });
      await ai.SendCommand(hold);
      notes.push(`hold ${HOLD_SECONDS} s sent`);
    } else notes.push('no AI controller');
    const agent = await entity.GetAttitudeAgent().catch(() => null);
    const mine = await v.GetAttitudeAgent().catch(() => null);
    if (agent && mine) {
      await agent.SetAttitudeTowards(mine, 'AIA_Friendly');
      notes.push(`group ${await agent.GetAttitudeGroup()}, now ${await agent.GetAttitudeTowards(mine)}`);
    } else notes.push('no attitude agent');
    setTimeout(() => where(entry, '5 s after Hold').catch(() => {}), 5000);
    return notes.join('; ');
  });

// ---- 2. Near V --------------------------------------------------------------------

async function describe(ref, from) {
  if (ref.$type === 'PlayerPuppet') return null; // V; H2b refreshes what V wears
  const p = await ref.GetWorldPosition().catch(() => null);
  if (!p) return null;
  const d = distance(p, from);
  if (d > radius) return null;
  const name = await ref.GetDisplayName().catch(() => '');
  const look = await ref.GetCurrentAppearanceName().catch(() => '');
  return { ref, type: ref.$type, distance: d, name, look, hashes: null };
}

async function inChunks(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

function report(found, how, total, ms) {
  near = found.sort((a, b) => a.distance - b.distance);
  for (const e of near.slice(0, 40)) say(`  ${e.distance.toFixed(1)} m  ${e.type}  ${e.name || '(no name)'}  ${e.look || ''}`);
  if (near.length > 40) say(`  ... and ${near.length - 40} more`);
  return `${how}: ${total} looked at, ${near.length} within ${radius} m, listed in ${ms} ms`;
}

const listByEntityList = () =>
  step('Near V (entity list)', async () => {
    const v = await player();
    const from = await v.GetWorldPosition();
    const started = performance.now();
    const all = (await api.GameInstance.GetEntityList(game.instance)) ?? [];
    const listed = performance.now() - started;
    const found = (await inChunks(all, 128, (e) => describe(e, from).catch(() => null))).filter(Boolean);
    return report(found, `GetEntityList (${listed.toFixed(0)} ms for the list)`, all.length, (performance.now() - started).toFixed(0));
  });

const listByTargeting = () =>
  step('Near V (targeting)', async () => {
    const v = await player();
    const from = await v.GetWorldPosition();
    const started = performance.now();
    const targeting = await api.GameInstance.GetTargetingSystem(game.instance);
    const query = await api.$new('gameTargetSearchQuery', {
      testedSet: 'Complete',
      maxDistance: radius,
      filterObjectByDistance: true,
      includeSecondaryTargets: true,
      ignoreInstigator: true,
    });
    // An out parameter: the call answers { result, out: { parts } }.
    const r = await targeting.GetTargetParts(v, query, api.$out);
    const ok = r?.result;
    const list = r?.out?.parts ?? [];
    // A part is a targeting component; several can belong to one entity.
    const seen = new Map();
    for (const part of list) {
      const component = await api.$static('gametargetingTargetPartInfo', 'GetComponent', part).catch(() => null);
      const entity = component && (await component.GetEntity().catch(() => null));
      if (entity) seen.set(String((await entity.GetEntityID())?.hash ?? seen.size), entity);
    }
    const found = (await Promise.all([...seen.values()].map((e) => describe(e, from).catch(() => null)))).filter(Boolean);
    return report(found, `GetTargetParts returned ${ok}, ${list.length} parts`, seen.size, (performance.now() - started).toFixed(0));
  });

// What files an entity names: its components' meshes (static and skinned, from its
// appearance too once it is loaded) and its template. Codeware's Entity.GetComponents and
// GetTemplatePath; whether they show every file an entity uses is the question.
async function resourcesOf(ref) {
  const hashes = new Set();
  const template = await ref.GetTemplatePath().catch(() => null);
  if (hashOf(template)) hashes.add(hashOf(template));
  const components = (await ref.GetComponents().catch(() => null)) ?? [];
  for (const c of components) {
    for (const prop of ['mesh', 'graph', 'resource']) {
      const h = hashOf(await c.$get(prop).catch(() => null));
      if (h) hashes.add(h);
    }
  }
  return { hashes, components: components.length };
}

const listResources = () =>
  step('Resources near V', async () => {
    if (!near.length) throw new Error('list what is near V first');
    let total = 0;
    let none = 0;
    for (const e of near) {
      const { hashes, components } = await resourcesOf(e.ref).catch(() => ({ hashes: new Set(), components: 0 }));
      e.hashes = hashes;
      total += hashes.size;
      if (!hashes.size) none++;
      if (near.indexOf(e) < 15) say(`  ${e.type} ${e.name || ''}: ${components} components, ${hashes.size} files`);
    }
    return `${near.length} entities, ${total} files named, ${none} named none`;
  });

// ---- 3. Swap and refresh ----------------------------------------------------------

// The archive's full path: as typed, or in the game's archive\pc\mod (the apps folder is
// <game>\red4ext\plugins\REDnode\apps).
function archivePath(name) {
  const clean = name.trim().replace(/^"|"$/g, '');
  if (path.isAbsolute(clean)) return clean;
  const apps = pkg.appsDirs[pkg.appsDirs.length - 1];
  return path.resolve(apps, '..', '..', '..', '..', 'archive', 'pc', 'mod', clean);
}

// The path hashes in an archive's file table (as REDnode's archive-index.js reads it).
function archiveHashes(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(40);
    if (fs.readSync(fd, header, 0, 40, 0) !== 40 || header.toString('latin1', 0, 4) !== 'RDAR') throw new Error(`${file} is not a game archive`);
    const indexAt = Number(header.readBigUInt64LE(8));
    const indexSize = header.readUInt32LE(16);
    const index = Buffer.alloc(indexSize);
    fs.readSync(fd, index, 0, indexSize, indexAt);
    const count = index.readUInt32LE(16);
    const hashes = new Set();
    for (let i = 0; i < count; i++) hashes.add(index.readBigUInt64LE(28 + i * 56));
    return hashes;
  } finally {
    fs.closeSync(fd);
  }
}

const swap = () =>
  step(`Swap ${file.trim()}`, async () => {
    const name = file.trim();
    if (!name) throw new Error('type an archive first');
    const r = await archives.reload([name]);
    const failed = r.failed.map((f) => `failed ${f.file}: ${f.why}`);
    if (r.reloaded.length) {
      // Read after the swap: RED Hot Tools moves the file into archive\pc\mod.
      const where = [archivePath(path.basename(name.replace(/^"|"$/g, ''))), archivePath(name)].find((f) => fs.existsSync(f));
      swappedHashes = where ? archiveHashes(where) : null;
    }
    return [`${r.reloaded.length} swapped in ${r.ms} ms`, swappedHashes ? `${swappedHashes.size} files in it` : 'its file table not found', ...failed].join('; ');
  });

async function users() {
  if (!swappedHashes) throw new Error('swap an archive first');
  if (!near.length) throw new Error('list what is near V first');
  if (near.some((e) => !e.hashes)) say('Resources near V: not read yet, reading them now');
  for (const e of near) if (!e.hashes) e.hashes = (await resourcesOf(e.ref).catch(() => ({ hashes: new Set() }))).hashes;
  return near.filter((e) => [...e.hashes].some((h) => swappedHashes.has(h)));
}

const whoUses = () =>
  step('Who uses the swapped files', async () => {
    const found = await users();
    for (const e of found) {
      const hits = [...e.hashes].filter((h) => swappedHashes.has(h)).map(short);
      say(`  ${e.distance.toFixed(1)} m  ${e.type}  ${e.name || ''}: ${hits.join(', ')}`);
    }
    return `${found.length} of ${near.length} entities near V name a file in the archive`;
  });

async function appearanceAgain(list, through) {
  const notes = [];
  for (const e of list) {
    const look = await e.ref.GetCurrentAppearanceName().catch(() => '');
    if (!look) {
      notes.push(`${e.type}: no appearance`);
      continue;
    }
    const started = performance.now();
    if (through) {
      await e.ref.ScheduleAppearanceChange('rednode_no_such_appearance');
      await sleep(500);
    }
    await e.ref.ScheduleAppearanceChange(look);
    notes.push(`${e.type} ${e.name || ''} ${look} ${(performance.now() - started).toFixed(0)} ms`);
  }
  return notes;
}

const refreshUsers = (through) =>
  step(`Refresh users${through ? ', through a missing appearance' : ''}`, async () => {
    const list = await users();
    if (!list.length) return 'nothing near V uses the swapped files';
    const notes = await appearanceAgain(list, through);
    notes.forEach((n) => say(`  ${n}`));
    return `${notes.length} entities`;
  });

const refreshAllNear = () =>
  step('Refresh everything near V', async () => {
    if (!near.length) throw new Error('list what is near V first');
    const notes = await appearanceAgain(near, false);
    return `${notes.length} entities`;
  });

const refreshNpc = (through) =>
  step(`Spawned NPC appearance again${through ? ', through a missing one' : ''}`, async () => {
    const { entry, entity } = await lastNpc();
    const [note] = await appearanceAgain([{ ref: entity, type: entity.$type, name: entry.label }], through);
    return note;
  });

// Removes what this app spawned and spawns each again with the same spec.
const respawnAll = () =>
  step('Respawn what this app spawned', async () => {
    if (!spawned.length) throw new Error('spawn something first');
    const notes = [];
    for (const s of spawned.splice(0)) {
      const removed = await world.remove(s.id).catch(() => false);
      const started = performance.now();
      const components = s.kind === 'box' ? [await meshComponent(s.mesh)] : [];
      const { id, entity } = await spawnSpec(s.fields, components);
      spawned.push({ ...s, id });
      notes.push(`${s.kind} removed ${removed}, back as ${id.hash} ${entity ? 'in the world' : 'not in the world'} after ${(performance.now() - started).toFixed(0)} ms`);
    }
    return notes.join('; ');
  });

const meshComponent = (mesh) =>
  api.$new('entMeshComponent', { name: MESH_NAME, mesh, meshAppearance: 'default', visualScale: { X: 1, Y: 1, Z: 1 } });

const spawnBox = () =>
  step('Spawn a prop', async () => {
    const { at, yaw } = await inFront(2);
    const mesh = meshPath.trim() || BOX;
    const fields = { templatePath: TEMPLATE, position: { X: at.x + 1, Y: at.y, Z: at.z, W: 1 }, orientation: rotation(yaw) };
    const { id, entity } = await spawnSpec(fields, [await meshComponent(mesh)]);
    spawned.push({ id, kind: 'box', fields, at, mesh, label: mesh });
    return `${id.hash} with ${mesh}${entity ? '' : ', not in the world after 10 s'}`;
  });

const removeAll = () =>
  step('Remove what this app spawned', async () => {
    const notes = [];
    for (const s of spawned.splice(0)) notes.push(`${s.kind} ${await world.remove(s.id).catch(() => false)}`);
    return notes.join(', ') || 'nothing spawned';
  });

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
    ui.heading('1. An NPC'),
    ui.input({ value: RECORD, placeholder: 'A Character record', onChange: (v) => (record = v.trim()), onSubmit: (v) => (record = v.trim()) }),
    ui.input({ placeholder: 'Appearance (blank for the record\'s own)', onChange: (v) => (appearance = v), onSubmit: (v) => (appearance = v) }),
    ui.toggle('Keep in saves (persistState, persistSpawn)', (on) => (keep = on)),
    ui.row(
      ui.button('Spawn by record', () => step('Spawn by record', () => spawnNpc('record'))),
      ui.button('Spawn by template', () => step('Spawn by template', () => spawnNpc('template')), { variant: 'ghost' }),
      ui.button('Hold and friendly', holdAndFriendly, { variant: 'ghost' }),
      ui.button('Where is it', () => step('Where is it', async () => where((await lastNpc()).entry, 'Now')), { variant: 'ghost' }),
    ),
    ui.heading('2. Near V'),
    ui.slider('Radius (m)', (v) => (radius = v), { min: 5, max: 60, step: 5, value: radius }),
    ui.row(
      ui.button('Entity list', listByEntityList),
      ui.button('Targeting', listByTargeting, { variant: 'ghost' }),
      ui.button('Resources', listResources, { variant: 'ghost' }),
    ),
    ui.heading('3. Swap and refresh'),
    ui.input({ value: BOX, placeholder: 'A .mesh for the prop', onChange: (v) => (meshPath = v), onSubmit: (v) => (meshPath = v) }),
    ui.row(
      ui.button('Spawn a prop', spawnBox, { variant: 'ghost' }),
      ui.button('Remove spawned', removeAll, { variant: 'ghost' }),
    ),
    ui.input({
      placeholder: 'MyMod.archive in archive/pc/mod, or a full path (Enter swaps)',
      onChange: (v) => (file = v),
      onSubmit: (v) => {
        file = v;
        swap();
      },
    }),
    ui.row(
      ui.button('Swap', swap),
      ui.button('Who uses it', whoUses, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Users: look again', () => refreshUsers(false)),
      ui.button('Users: through missing', () => refreshUsers(true), { variant: 'ghost' }),
      ui.button('All near: look again', refreshAllNear, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('NPC: look again', () => refreshNpc(false), { variant: 'ghost' }),
      ui.button('NPC: through missing', () => refreshNpc(true), { variant: 'ghost' }),
      ui.button('Respawn spawned', respawnAll, { variant: 'ghost' }),
    ),
    log,
  ],
});

const checked = await kernel.requirements();
const codeware = await world.available().catch(() => false);
requires.set({
  text: [
    ...checked.map((r) => `${r.ok ? 'OK' : 'MISSING'}  ${r.name} ${r.wants}  ${r.found ?? r.note}`),
    `${codeware ? 'OK' : 'NOT READY'}  world API (Codeware, a loaded save)`,
  ].join('\n'),
  tone: checked.every((r) => r.ok) ? 'normal' : 'danger',
});

// After a load: is what this app spawned still there? (Only "Keep in saves" spawns
// should come back, and only in the save they were made in.)
game.on('PlayerPuppet.OnGameAttached', () => {
  near = [];
  if (!spawned.length) return;
  for (const wait of [3000, 10000]) {
    setTimeout(async () => {
      for (const s of spawned) {
        const there = await world.entity(s.id).catch(() => null);
        say(`${wait / 1000} s after the load: ${s.kind} ${s.id.hash} ${there ? 'is in the world' : 'is not'}`);
      }
    }, wait);
  }
});
say('World objects test ready');
