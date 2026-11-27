// Bones test: REDnode #62's world.bones, for REDcode's check of its body deformation graph.
// Spawns a male average person (the Trauma Team paramedic, on man_base.rig) beside V playing a
// gameplay workspot with the arms crossed, then reads the live pose of its skeleton: the body's,
// the face's and the muscle and twist helpers' bones (its root, face_rig and deformations
// components share one animated object, read once). Each read is saved in full (model and local
// transforms, and each bone's rig bind pose), with the workspot and the seconds since it started,
// as bones-<n>.json in the package's data folder. The log says how far the pose moved since the
// last read and how far the arms are from their bind pose, which tells a live pose from a still one.

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

let last = null; // the last read's model places, by bone name

// The largest move, in metres, of any bone's model place since the last read.
function moved(bones) {
  let worst = 0;
  let where = '';
  if (last) {
    for (const b of bones) {
      const was = last.get(b.name);
      if (!was || !b.model) continue;
      const d = Math.hypot(b.model.t[0] - was[0], b.model.t[1] - was[1], b.model.t[2] - was[2]);
      if (d > worst) (worst = d), (where = b.name);
    }
  }
  last = new Map(bones.filter((b) => b.model).map((b) => [b.name, b.model.t]));
  return { worst, where };
}

const bone = (bones, name) => bones.find((b) => b.name === name);
const fmt = (t) => `[${t.map((v) => v.toFixed(3)).join(', ')}]`;

const spawn = () =>
  step('Spawn', async () => {
    if (person) await world.remove(person.id).catch(() => false);
    person = null;
    const { id, entity } = await world.spawn({ record: RECORD, ...(await inFront(2.5)), workspot: WORKSPOT });
    const r = await world.useWorkspot(id);
    person = { id: r.id, started: Date.now() };
    last = null;
    return `${RECORD} ${r.id.hash}${entity ? '' : ' (not in the world yet)'}; workspot ${r.started ? 'started' : `not started: ${r.why}`}`;
  });

async function readOnce() {
  if (!person) throw new Error('Press Spawn first');
  const read = await world.bones(person.id, { space: 'both', bind: true });
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
    if (c.sameAs) {
      parts.push(`${c.name} (${rigName(c.rig)}): same skeleton as ${c.sameAs}`);
      continue;
    }
    const none = c.bones.filter((b) => b.rig < 0).length;
    const move = moved(c.bones);
    const hand = bone(c.bones, 'LeftHand');
    const helper = bone(c.bones, HELPER);
    parts.push(
      `${c.name} (${rigName(c.rig)}): ${c.count} bones, rigs [${c.rigs.join(', ')}], ${none} in no rig, ` +
        `lod ${c.lod.level}/${c.lod.last} at ${c.lod.distance.toFixed(1)} m, object from ${c.object}; ` +
        (n > 1 ? `moved since the last read: ${(move.worst * 1000).toFixed(1)} mm at most${move.where ? ` (${move.where})` : ''}; ` : '') +
        (hand ? `LeftHand model ${fmt(hand.model.t)}; ` : '') +
        (helper ? `${HELPER} model ${fmt(helper.model.t)}, local ${fmt(helper.local.t)}, bind ${fmt(helper.bind.t)}` : ''),
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
    return r.components
      .map((c) => (c.error ? `${c.name}: ${c.error}` : c.sameAs ? `${c.name}: same skeleton as ${c.sameAs}` : `${c.name} (${rigName(c.rig)}): ${c.count} bones, rigs [${c.rigs.join(', ')}]`))
      .join(' | ') + `, ${r.ms.toFixed(1)} ms`;
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
