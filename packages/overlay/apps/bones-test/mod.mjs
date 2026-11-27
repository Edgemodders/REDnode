// Bones test: REDnode #62's world.bones, for REDcode's check of its body deformation graph.
// Spawns a male average person (the Trauma Team paramedic, on man_base.rig) beside V playing a
// gameplay workspot with the arms crossed, then reads the live pose of its animated components:
// "root" (the body's rig) and "deformations" (the muscle and twist helpers). Each read is saved
// in full, with the workspot and the seconds since it started, as bones-<n>.json in the
// package's data folder, and checked: each bone's model transform against its parent's model
// transform times its own local one, which says the locals are relative to the meta rig's parents.

import fs from 'node:fs';
import path from 'node:path';
import { api, game, pkg, ui, world } from 'rednode';

const RECORD = 'Character.trauma_team_paramedic';
const WORKSPOT = 'base\\workspots\\common\\ground\\generic__stand_ground_arms_crossed__stand_around__02.workspot';
const RIGS = new Map([
  [14264052059588999261n, 'man_base.rig'],
  [14962943127514873302n, 'man_base_deformations.rig'],
  [10048268983187091494n, 'woman_base_deformations.rig'],
]);
const HELPER = 'l_chest_front_B_top_out_JNT';

let person = null; // { id, started }
let reads = 0;

const status = ui.text('Press Spawn, wait for the arms to cross, then Read.', { tone: 'dim' });
const log = ui.list({ keep: 300 });
const say = (line) => {
  log.push(line);
  console.log(line);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  status.set({ text: `${name}…` });
  try {
    const r = await fn();
    say(`${name}: ${r}`);
    status.set({ text: `${name}: done` });
  } catch (e) {
    say(`${name} failed: ${e.message}`);
    status.set({ text: `${name} failed` });
  }
}

async function inFront(metres) {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  const yaw = (Math.atan2(f.Y, f.X) * 180) / Math.PI + 90; // facing V
  return { position: { x: p.X + f.X * metres, y: p.Y + f.Y * metres, z: p.Z }, yaw };
}

const rigName = (hash) => {
  try {
    return RIGS.get(BigInt(hash)) ?? hash;
  } catch {
    return hash;
  }
};

// parent * local, as bones.hpp's Mul does.
function rotate(q, v) {
  const [x, y, z, w] = q;
  const dotUV = x * v[0] + y * v[1] + z * v[2];
  const dotUU = x * x + y * y + z * z;
  const cross = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
  return [0, 1, 2].map((i) => 2 * dotUV * [x, y, z][i] + (w * w - dotUU) * v[i] + 2 * w * cross[i]);
}
function mul(p, l) {
  const scaled = [p.s[0] * l.t[0], p.s[1] * l.t[1], p.s[2] * l.t[2]];
  const r = rotate(p.r, scaled);
  const [ax, ay, az, aw] = p.r;
  const [bx, by, bz, bw] = l.r;
  return {
    t: [p.t[0] + r[0], p.t[1] + r[1], p.t[2] + r[2]],
    r: [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz],
  };
}

// The largest gap, in metres, between a bone's model place and its parent's model times its local.
function chainGap(bones) {
  const byName = new Map(bones.map((b) => [b.name, b]));
  let worst = 0;
  let where = '';
  for (const b of bones) {
    if (!b.parent || !b.model || !b.local) continue;
    const p = byName.get(b.parent);
    if (!p?.model) continue;
    const m = mul(p.model, b.local);
    const gap = Math.hypot(m.t[0] - b.model.t[0], m.t[1] - b.model.t[1], m.t[2] - b.model.t[2]);
    if (gap > worst) (worst = gap), (where = b.name);
  }
  return { worst, where };
}

const spawn = () =>
  step('Spawn', async () => {
    if (person) await world.remove(person.id).catch(() => false);
    person = null;
    const { id, entity } = await world.spawn({ record: RECORD, ...(await inFront(2.5)), workspot: WORKSPOT });
    const r = await world.useWorkspot(id);
    person = { id: r.id, started: Date.now() };
    return `${RECORD} ${r.id.hash}${entity ? '' : ' (not in the world yet)'}; workspot ${r.started ? 'started' : `not started: ${r.why}`}`;
  });

async function readOnce() {
  if (!person) throw new Error('Press Spawn first');
  const read = await world.bones(person.id, { space: 'both' });
  const n = ++reads;
  const seconds = (read.at - person.started) / 1000;
  const file = path.join(pkg.dataDir, `bones-${n}.json`);
  fs.mkdirSync(pkg.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ record: RECORD, workspot: WORKSPOT, secondsSincePlay: seconds, ...read }, null, 1));
  const parts = [`read ${n} at ${seconds.toFixed(1)} s, ${read.ms.toFixed(2)} ms`];
  for (const c of read.components) {
    if (c.error) {
      parts.push(`${c.name}: ${c.error}`);
      continue;
    }
    const none = c.bones.filter((b) => b.part < 0).length;
    const gap = chainGap(c.bones);
    const helper = c.bones.find((b) => b.name === HELPER);
    parts.push(
      `${c.name} (${rigName(c.rig)}): ${c.count} bones, parts [${c.parts.join(', ')}], ${none} in no part, ` +
        `lod ${c.lod.level}/${c.lod.last} at ${c.lod.distance.toFixed(1)} m, object from ${c.object}; ` +
        `model vs parent x local: ${(gap.worst * 1000).toFixed(2)} mm at worst${gap.where ? ` (${gap.where})` : ''}` +
        (helper ? `; ${HELPER} local t [${helper.local.t.map((v) => v.toFixed(4)).join(', ')}]` : ''),
    );
  }
  return `${parts.join(' | ')} -> ${path.basename(file)}`;
}

const read = () => step('Read', readOnce);

const readFour = () =>
  step('Read 4', async () => {
    const lines = [];
    for (let k = 0; k < 4; k++) {
      lines.push(await readOnce());
      if (k < 3) await wait(1000);
    }
    return `\n  ${lines.join('\n  ')}`;
  });

const readNear = () =>
  step('Read the nearest person', async () => {
    const near = await world.near({ radius: 10 });
    const p = near.find((e) => /NPCPuppet/.test(e.type ?? ''));
    if (!p) throw new Error('No person within 10 m');
    const r = await world.bones(p.id, { space: 'local' });
    return r.components.map((c) => (c.error ? `${c.name}: ${c.error}` : `${c.name} (${rigName(c.rig)}): ${c.count} bones, parts [${c.parts.join(', ')}]`)).join(' | ');
  });

const remove = () =>
  step('Remove', async () => {
    if (!person) return 'nothing to remove';
    const ok = await world.remove(person.id);
    person = null;
    return ok ? 'removed' : 'already gone';
  });

ui.window({
  title: 'Bones test',
  width: 640,
  height: 420,
  children: [
    status,
    ui.row(
      ui.button('Spawn', spawn, { tip: 'The paramedic 2.5 m in front of V, arms crossed' }),
      ui.button('Read', read, { tip: 'One read of every bone, saved in the data folder' }),
      ui.button('Read 4', readFour, { tip: 'Four reads, a second apart' }),
      ui.button('Read the nearest person', readNear, { variant: 'ghost' }),
      ui.button('Remove', remove, { variant: 'ghost' }),
    ),
    log,
  ],
});

say(`Reads are saved in ${pkg.dataDir}`);
