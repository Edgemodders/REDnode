// Director spike: #46 for EDGEdir (docs/world.md, "A written workspot (#46)"). Through REDbridge,
// archives, api and world only, no REDnode change. Each button is one step; every call, its answer
// and its time go to the log, and what shows on screen is for the player to say.
//
//   1 Build    reads the game's arms-crossed workspot through REDbridge and writes two of its own
//              into this app's data folder: "full" (the game's entries, exits and reactions kept)
//              and "bare" (only the test clips and a fast exit); each test clip is a sequence whose
//              idle is the clip, holding the clip once. Packs them into zzz_rednode_s46.archive.
//              Nothing from the game is in this package: it is all made on the player's PC.
//   2 Swap     archives.reload of that archive (REDswap)
//   3 Actors   two people beside V carrying the chosen workspot; Play puts both in it
//   4 Jumps    SendJumpToAnimEnt to each clip, blended or instant ("snap")
//   5 Gap      the step-off clip with root motion: where the actor is at 0, 3 and 6 s
//   6 Timed    jumps on setTimeout at set times for both actors: how late each lands, in ms and
//              in frames, and how far apart the two actors' jumps are
//   7 Weather  (0.6.0) world.weather, world.setWeather and world.resetWeather (REDnode 0.66.10): the
//              state, held or the game's cycle, and every state the world has; rain, fog and sun
//   8 Quest    (0.3.0) why the quest clip stays in a T pose: one more person, Q, plays each of six
//              workspots that differ by one thing from the game's own quest medic workspot
//   9 Start    (0.3.0) whether the T pose at the first play goes when the person waits after spawning
//  10 Hash     (0.4.0) round 3 found the quest clip plays from the game's quest workspot but not from
//              ours, written from the arms-crossed one. Ours kept that workspot's animation setup
//              hash, so the lead is the engine reusing the arms-crossed setup (no quest set in it)
//              by that hash. Six variants set the hash each way. And whether loading the workspot
//              ahead (Codeware's ResourceDepot.LoadResource) removes the first play's T pose.
//  11 Call     (0.5.0) the rounds' recipe as REDnode's own call: world.writeWorkspot writes and
//              swaps, world.jumpWorkspot moves between its clips by name; and whether a new person
//              on a file already played shows the first play's T pose

import { api, archives, game, kernel, pkg, ui, world } from 'rednode';
import fs from 'node:fs';
import path from 'node:path';

const GAME_WORKSPOT = 'base\\workspots\\common\\ground\\generic__stand_ground_arms_crossed__stand_around__02.workspot';
const OURS = 'rednode\\spikes';
const ARCHIVE = 'zzz_rednode_s46';
const IDLE_2H = 'base\\animations\\npc\\generic_characters\\male_average\\interactive_scene\\generic_male_average__stand__2h_on_sides__01.anims';
const IDLE_CROSSED = 'base\\animations\\npc\\generic_characters\\male_average\\interactive_scene\\generic_male_average__stand__arms_crossed_front__01.anims';
const TRANSITIONS = 'base\\animations\\npc\\generic_characters\\male_average\\interactive_scene\\generic_average_male_transitions.anims';
const QUEST = 'base\\animations\\quest_custom\\q001\\q001_00c_rescuing_girl\\q001_00c_trauma_arrives\\q001_00c_trauma_arrives_male_average.anims';
const CLIPS = [
  ['A standing', 'stand__2h_on_sides__01'],
  ['B arms crossed', 'stand__arms_crossed_front__01'],
  ['C quest medic', 'q001_00c_trauma_arrives___med_1_idle__01'],
  ['D step off (root motion)', 'stand__2h_on_sides__01__to__walk_0__turn0__01'],
];
const RECORD = 'Character.trauma_team_paramedic';
const QUEST_WORKSPOT = 'base\\workspots\\quest\\main_quests\\prologue\\q001\\q001_00c_rescuing_girl\\q001_00c_trauma_arrives___med_01_idle__01.workspot';
const QUEST_CLIP = CLIPS[2][1];
// The game's quest medic workspot's animation setup hash (its one set, the q001 quest set).
const QUEST_HASH = '991092134768372540';
// Round 4's variants: the quest clip in ours, with the animation setup's hash set each way.
const VARIANTS = [
  ['game', "the game's own quest medic workspot, as it is (the control: round 3 saw it play, no T pose)"],
  ['copy', "the game's quest workspot written back by REDbridge (round 3: a brief T pose, then it played)"],
  ['solo-keep', "ours, the quest clip only, keeping the arms-crossed workspot's hash (round 3's solo200: a T pose that stays)"],
  ['solo-0', 'the same with the hash 0'],
  ['solo-quest', "the same with the game's quest workspot's hash (its setup has the same one set)"],
  ['solo-new', 'the same with a new hash made from the list of sets'],
  ['mixed-0', "0.2.0's four clips with the hash 0: say whether C, the quest clip, now plays after a jump"],
  ['mixed-new', 'the four clips with a new hash made from the list of sets'],
];

let which = 'bare';
let snap = true; // instant: jump now, blended by the game; off waits for the clip's end
let byEntry = false;
let loopClips = true;
// The entry id of each clip's sequence, the same in both workspots (both count on from the game's idCounter).
let entryIds = {};
let actors = []; // [{ id, label }]
let quest = null; // { id, label: 'Q', variant }
let busy = '';

const status = ui.text('Press Build, then Swap, then Spawn.', { tone: 'dim' });
const log = ui.list({ keep: 800 });
function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const workspotPath = () => `${OURS}\\s46_${which}.workspot`;

// ---- 1. Build ---------------------------------------------------------------------

// FNV-1a 64 of a text, as a decimal string (WolvenKit JSON's Uint64).
function fnv64(text) {
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(text, 'utf8')) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString();
}
const cname = (v) => ({ $type: 'CName', $storage: 'string', $value: v });
const animset = (p, questPriority = 128) => ({ $type: 'animAnimSetupEntry', animSet: { DepotPath: { $type: 'ResourcePath', $storage: 'string', $value: p }, Flags: 'Default' }, priority: p.includes('interactive_scene') ? 200 : p === QUEST ? questPriority : 128, variableNames: [] });
const loading = (p) => ({ DepotPath: { $type: 'ResourcePath', $storage: 'string', $value: p }, Flags: 'Default' });

// clips: [label, clip] pairs; sets: the animation sets to list (bare only); questPriority: the quest set's.
// hash: 'keep' the template's animation setup hash, '0', or 'new' (FNV-1a 64 of the set paths), or a hash as text.
function writeWorkspot(source, bare, { clips = CLIPS, sets: only, questPriority = 128, ids = true, hash = 'keep' } = {}) {
  const d = structuredClone(source);
  const tree = d.Data.RootChunk.workspotTree.Data;
  let entry = tree.idCounter;
  let handle = 100000;
  const nextEntry = () => ++entry;
  const nextHandle = () => String(++handle);
  const sequence = (clip) => {
    if (ids) entryIds[clip] = entry + 1;
    return {
    HandleId: nextHandle(),
    Data: {
      $type: 'workSequence', category: 'Any', disableAutoTransition: 0, flags: 0,
      id: { $type: 'workWorkEntryId', id: nextEntry() },
      idleAnim: cname(clip), loopInfinitely: loopClips ? 1 : 0, previousLoopInfinitely: 0,
      list: [{ HandleId: nextHandle(), Data: { $type: 'workAnimClip', animName: cname(clip), blendOutTime: 0.5, flags: 2, id: { $type: 'workWorkEntryId', id: nextEntry() } } }],
    },
    };
  };
  const root = tree.rootEntry.Data;
  const kept = bare ? root.list.filter((c) => c.Data.$type === 'workFastExit') : root.list;
  root.list = [...clips.map(([, clip]) => sequence(clip)), ...kept];
  tree.idCounter = entry + 1;
  const male = tree.finalAnimsets[0];
  const sets = only ?? (bare ? [IDLE_2H, IDLE_CROSSED, TRANSITIONS, QUEST] : [...male.animations.cinematics.map((x) => x.animSet.DepotPath.$value), QUEST]);
  male.animations.cinematics = sets.map((x) => animset(x, questPriority));
  if (hash !== 'keep') male.animations.hash = hash === 'new' ? fnv64(sets.join('|')) : hash;
  male.loadingHandles = sets.map(loading);
  tree.finalAnimsets = [male];
  if (bare) tree.customTransitionAnims = [];
  return d;
}

const build = () =>
  step('Build the workspots', async () => {
    const b = await kernel.bridge();
    const work = path.join(pkg.dataDir, 's46');
    const tree = path.join(work, 'archive');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(tree, ...OURS.split('\\')), { recursive: true });
    const raw = path.join(work, 'source.workspot');
    await b.call('archive.extract', { path: GAME_WORKSPOT, outFile: raw });
    const json = path.join(work, 'source.json');
    await b.call('cr2w.fileToJson', { file: raw, outFile: json });
    const source = JSON.parse(fs.readFileSync(json, 'utf8'));
    for (const kind of ['full', 'bare']) {
      const jf = path.join(work, `s46_${kind}.json`);
      fs.writeFileSync(jf, JSON.stringify(writeWorkspot(source, kind === 'bare')));
      const out = path.join(tree, ...OURS.split('\\'), `s46_${kind}.workspot`);
      await b.call('cr2w.fromJson', { outFile: out, jsonFile: jf });
      say(`  ${kind}: ${fs.statSync(out).size} bytes`);
    }
    fs.writeFileSync(path.join(work, 'entries.json'), JSON.stringify(entryIds));
    // Round 3's quest variants ("game" is the game's own file, nothing to write).
    const qraw = path.join(work, 'quest.workspot');
    await b.call('archive.extract', { path: QUEST_WORKSPOT, outFile: qraw });
    const qjson = path.join(work, 'quest.json');
    await b.call('cr2w.fileToJson', { file: qraw, outFile: qjson });
    const questSource = JSON.parse(fs.readFileSync(qjson, 'utf8'));
    const questOnly = [[CLIPS[2][0], QUEST_CLIP]];
    const solo = (hash) => writeWorkspot(source, true, { clips: questOnly, sets: [QUEST], questPriority: 200, ids: false, hash });
    const variants = {
      copy: questSource,
      // The same file under another name, used only by the preload test, so nothing has loaded it before.
      'copy-pre': questSource,
      'solo-keep': solo('keep'),
      'solo-0': solo('0'),
      'solo-quest': solo(QUEST_HASH),
      'solo-new': solo('new'),
      'mixed-0': writeWorkspot(source, true, { questPriority: 200, ids: false, hash: '0' }),
      'mixed-new': writeWorkspot(source, true, { questPriority: 200, ids: false, hash: 'new' }),
    };
    for (const [name, doc] of Object.entries(variants)) {
      const jf = path.join(work, `s46_q_${name}.json`);
      fs.writeFileSync(jf, JSON.stringify(doc));
      const out = path.join(tree, ...OURS.split('\\'), `s46_q_${name}.workspot`);
      await b.call('cr2w.fromJson', { outFile: out, jsonFile: jf });
    }
    say(`  quest variants: ${Object.keys(variants).join(', ')} written`);
    say(`  entries: ${CLIPS.map(([label, clip]) => `${label[0]} ${entryIds[clip]}`).join(', ')}; clips ${loopClips ? 'loop until a jump' : 'play once and move on'}`);
    const packed = await b.call('project.pack', { dir: tree, outDir: path.join(work, 'packed'), modName: ARCHIVE });
    return `${packed.archive} (${packed.bytes} bytes, ${packed.files} files)`;
  });

// ---- 2. Swap ----------------------------------------------------------------------

const swap = () =>
  step('Swap in', async () => {
    const file = path.join(pkg.dataDir, 's46', 'packed', `${ARCHIVE}.archive`);
    if (!fs.existsSync(file)) throw new Error('Press Build first');
    const r = await archives.reload([file]);
    for (const f of r.failed ?? []) say(`  failed ${f.file}: ${f.why}`);
    return `${r.reloaded?.length ?? 0} swapped in ${r.ms} ms${r.via ? ` via ${r.via}` : ''}`;
  });

// ---- 3. Actors ----------------------------------------------------------------------

async function inFront(metres, side) {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  const yaw = (Math.atan2(f.Y, f.X) * 180) / Math.PI + 90;
  return { position: { x: p.X + f.X * metres + f.Y * side, y: p.Y + f.Y * metres - f.X * side, z: p.Z }, yaw };
}

const spawn = () =>
  step(`Spawn two actors with ${which}`, async () => {
    for (const a of actors) await world.remove(a.id).catch(() => false);
    actors = [];
    for (const [label, side] of [['A', -0.9], ['B', 0.9]]) {
      const { id, entity } = await world.spawn({ record: RECORD, ...(await inFront(3, side)), workspot: workspotPath() });
      actors.push({ id, label });
      say(`  ${label} ${id.hash}${entity ? '' : ' not in the world yet'}`);
    }
    return `${actors.length} actors`;
  });

const people = async () => {
  if (!actors.length) throw new Error('Spawn first');
  return Promise.all(actors.map(async (a) => ({ ...a, e: await world.entity(a.id) })));
};
const system = () => api.GameInstance.GetWorkspotSystem(game.instance);

const play = () =>
  step('Play both', async () => {
    const out = [];
    for (const a of actors) {
      const r = await world.useWorkspot(a.id);
      a.id = r.id;
      out.push(`${a.label} ${r.started ? 'started' : `not started: ${r.why}`}`);
    }
    return out.join('; ');
  });

// ---- 4. Jumps ---------------------------------------------------------------------

function entryOf(clip) {
  if (!entryIds[clip]) {
    const f = path.join(pkg.dataDir, 's46', 'entries.json');
    if (fs.existsSync(f)) entryIds = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  if (!entryIds[clip]) throw new Error('Press Build first: the entry ids come from it');
  return entryIds[clip];
}
const sendJump = (ws, e, clip) => (byEntry ? ws.SendJumpCommandEnt(e, entryOf(clip), snap) : ws.SendJumpToAnimEnt(e, clip, snap));

async function jumpAll(clip) {
  const ws = await system();
  const ps = await people();
  const times = await Promise.all(
    ps.map(async (p) => {
      const t = performance.now();
      await sendJump(ws, p.e, clip);
      return performance.now() - t;
    }),
  );
  return times;
}
const jump = (label, clip) =>
  step(`Jump to ${label}${byEntry ? ' by entry' : ' by name'}${snap ? ' (instant)' : ' (at the clip end)'}`, async () => {
    const t = await jumpAll(clip);
    await wait(600);
    return `calls ${t.map((x) => x.toFixed(0)).join(' / ')} ms; after 0.6 s: ${await brief()}`;
  });

// One line per actor: in the workspot, active, entering or exiting.
async function brief() {
  const ps = await people();
  const out = await Promise.all(
    ps.map(async (p) => {
      const s = await world.workspotState(p.id).catch(() => null);
      if (!s?.inWorkspot) return `${p.label} out`;
      return `${p.label} in${s.isActive ? '' : ' (not active)'}${s.entering ? ' entering' : ''}${s.exiting ? ' exiting' : ''}`;
    }),
  );
  return out.join(', ');
}

// Watch both actors for 30 s, a line every 2 s: shows a clip running out, the next starting, or the workspot ending.
const watch = () =>
  step('Watch 30 s', async () => {
    const t0 = performance.now();
    let last = '';
    for (let i = 0; i < 15; i++) {
      const b = await brief();
      if (b !== last) say(`  ${((performance.now() - t0) / 1000).toFixed(0)} s: ${b}`);
      last = b;
      await wait(2000);
    }
    return `last: ${last}`;
  });

// ---- 5. Gap and root motion -------------------------------------------------------

const gap = () =>
  step('Step off, then nothing', async () => {
    const ps = await people();
    const pos = async () => Promise.all(ps.map(async (p) => await p.e.GetWorldPosition()));
    const at0 = await pos();
    await jumpAll(CLIPS[3][1]);
    const lines = [];
    for (const s of [3, 6]) {
      await wait(3000);
      const now = await pos();
      const ws = await system();
      const inWs = await Promise.all(ps.map((p) => ws.IsActorInWorkspot(p.e)));
      lines.push(`at ${s} s: ${now.map((p, i) => `${ps[i].label} moved ${Math.hypot(p.X - at0[i].X, p.Y - at0[i].Y).toFixed(2)} m, in workspot ${inWs[i]}`).join('; ')}`);
    }
    for (const l of lines) say(`  ${l}`);
    return 'say what the actors do at the end of the clip: hold, loop, or leave';
  });

// ---- 6. Timed jumps ---------------------------------------------------------------

const timed = () =>
  step('Timed run (8 s)', async () => {
    const plan = [
      [0, CLIPS[0]], [2000, CLIPS[1]], [4000, CLIPS[2]], [6000, CLIPS[0]], [8000, CLIPS[1]],
    ];
    const ws = await system();
    const ps = await people();
    const f0 = (await game.call('game.info')).frame;
    const t0 = performance.now() + 300;
    const results = await Promise.all(
      plan.map(
        ([at, [label, clip]]) =>
          new Promise((resolve) => {
            setTimeout(async () => {
              const fired = performance.now();
              const frame = (await game.call('game.info')).frame;
              const each = [];
              await Promise.all(
                ps.map(async (p) => {
                  await sendJump(ws, p.e, clip);
                  each.push(performance.now() - fired);
                }),
              );
              resolve({ at, label, late: fired - (t0 + at), frame: frame - f0, spread: Math.abs((each[0] ?? 0) - (each[1] ?? 0)), done: Math.max(...each) });
            }, Math.max(0, t0 + at - performance.now()));
          }),
      ),
    );
    for (const r of results) {
      say(`  ${(r.at / 1000).toFixed(0)} s ${r.label}: timer late ${r.late.toFixed(1)} ms, frame +${r.frame}, both jumps sent within ${r.done.toFixed(0)} ms, A and B apart ${r.spread.toFixed(0)} ms`);
    }
    const frames = results.map((r) => r.frame);
    const fps = (frames[frames.length - 1] - frames[0]) / ((results[results.length - 1].at - results[0].at) / 1000);
    return `about ${fps.toFixed(0)} frames a second; a jump lands when its call reaches the game thread`;
  });

// ---- 7. Weather -------------------------------------------------------------------

const weather = () =>
  step('world.weather', async () => {
    const w = await world.weather();
    const sys = await api.GameInstance.GetWeatherSystem(game.instance);
    const rain = sys ? await sys.GetRainIntensity().catch((e) => `error ${e.message}`) : 'no system';
    say(`  states: ${w.states.join(', ')}`);
    return `${w.state}, ${w.held ? `held by ${w.source}${w.by ? ` (${w.by})` : ''}` : `the game's cycle (last set by ${w.source})`}, priority ${w.priority}, rain ${rain}`;
  });

// (0.6.0) REDnode 0.66.10's weather calls: what a quest's weather node does.
const setWeather = (state, blend) =>
  step(`world.setWeather ${state} (${blend} s)`, async () => {
    const r = await world.setWeather(state, { blend });
    return `${r.applied ? 'applied' : 'not applied'}${r.changed ? '' : ', unchanged'}, was ${r.was}, ${r.held ? 'held' : 'not held'}`;
  });

const resetWeather = () =>
  step('world.resetWeather', async () => {
    const r = await world.resetWeather();
    return `was ${r.was}; the game's cycle picks the next weather in its own time`;
  });

// ---- 8. Quest variants -------------------------------------------------------------

const variantPath = (name) => (name === 'game' ? QUEST_WORKSPOT : `${OURS}\\s46_q_${name}.workspot`);

async function watchOne(id, seconds) {
  const t0 = performance.now();
  let last = '';
  while (performance.now() - t0 < seconds * 1000) {
    const st = await world.workspotState(id).catch(() => null);
    const b = !st?.inWorkspot ? 'out' : `in${st.isActive ? '' : ' (not active)'}${st.entering ? ' entering' : ''}${st.exiting ? ' exiting' : ''}`;
    if (b !== last) say(`    ${((performance.now() - t0) / 1000).toFixed(1)} s: Q ${b}`);
    last = b;
    await wait(500);
  }
}

// Tokens of preloaded workspots, kept so the game keeps them loaded.
const tokens = new Map();
async function preload(file) {
  const depot = await api.GameInstance.GetResourceDepot();
  const token = await depot.LoadResource(file);
  tokens.set(file, token);
  const t0 = performance.now();
  while (performance.now() - t0 < 5000) {
    if (await token.IsFinished()) break;
    await wait(100);
  }
  return `${(await token.IsLoaded()) ? 'loaded' : (await token.IsFailed()) ? 'failed' : 'not finished'} in ${(performance.now() - t0).toFixed(0)} ms`;
}

const tryVariant = (name, { preloaded = false } = {}) =>
  step(`Quest variant ${name}${preloaded ? ', preloaded' : ''}`, async () => {
    if (quest) await world.remove(quest.id).catch(() => false);
    if (preloaded) say(`  preload ${variantPath(name)}: ${await preload(variantPath(name))}`);
    const { id } = await world.spawn({ record: RECORD, ...(await inFront(4.5, 0)), workspot: variantPath(name) });
    quest = { id, label: 'Q', variant: name };
    await wait(1500);
    const r = await world.useWorkspot(id);
    quest.id = r.id;
    if (!r.started) return `not started: ${r.why}`;
    if (name.startsWith('mixed')) {
      await wait(4000);
      const ws = await system();
      await ws.SendJumpToAnimEnt(await world.entity(quest.id), QUEST_CLIP, true);
      say('    4 s: jumped to C, the quest clip');
    }
    await watchOne(r.id, 12);
    return name.startsWith('mixed') ? 'started in A, then C: say whether C plays' : 'started; say what Q does: plays the medic idle, a T pose first, or a T pose that stays';
  });

// ---- 9. The first play's T pose -----------------------------------------------------

const spawnWaitPlay = () =>
  step(`Spawn, wait 10 s, then play (${which})`, async () => {
    for (const a of actors) await world.remove(a.id).catch(() => false);
    actors = [];
    for (const [label, side] of [['A', -0.9], ['B', 0.9]]) {
      const { id } = await world.spawn({ record: RECORD, ...(await inFront(3, side)), workspot: workspotPath() });
      actors.push({ id, label });
    }
    say('  spawned; waiting 10 s');
    await wait(10000);
    const out = [];
    for (const a of actors) {
      const r = await world.useWorkspot(a.id);
      a.id = r.id;
      out.push(`${a.label} ${r.started ? 'started' : `not started: ${r.why}`}`);
    }
    return `${out.join('; ')}; say whether the T pose came again`;
  });

// ---- 11. world.writeWorkspot ------------------------------------------------------

let called = null; // what world.writeWorkspot answered
let callActors = []; // [{ id, label }]
const CALL_CLIPS = [
  { set: IDLE_2H, anim: CLIPS[0][1], name: 'stand' },
  { set: IDLE_CROSSED, anim: CLIPS[1][1], name: 'crossed' },
  { set: QUEST, anim: QUEST_CLIP, name: 'worried' },
  { set: TRANSITIONS, anim: CLIPS[3][1], name: 'step' },
];

const callWrite = () =>
  step('world.writeWorkspot', async () => {
    called = await world.writeWorkspot('director', { clips: CALL_CLIPS });
    say(`  ${called.path}: ${called.entries.map((e) => `${e.name} ${e.entry}`).join(', ')}`);
    return `${called.swap ? `swapped via ${called.swap.via}` : 'not swapped'} (${called.ms} ms)`;
  });

const callSpawn = () =>
  step('Spawn two with it', async () => {
    if (!called) throw new Error('Press Write and swap first');
    for (const a of callActors) await world.remove(a.id).catch(() => false);
    callActors = [];
    for (const [label, side] of [['A', -0.9], ['B', 0.9]]) {
      const { id } = await world.spawn({ record: RECORD, ...(await inFront(3, side)), workspot: called.path });
      callActors.push({ id, label });
    }
    return `${callActors.length} actors`;
  });

const callPlay = () =>
  step('Play', async () => {
    const out = [];
    for (const a of callActors) {
      const r = await world.useWorkspot(a.id);
      a.id = r.id;
      out.push(`${a.label} ${r.started ? 'started' : `not started: ${r.why}`}`);
    }
    return out.join('; ');
  });

const callJump = (name) =>
  step(`world.jumpWorkspot ${name}`, async () => {
    if (!callActors.length) throw new Error('Spawn first');
    const t = performance.now();
    const done = await Promise.all(callActors.map((a) => world.jumpWorkspot(a.id, name)));
    const ms = (performance.now() - t).toFixed(0);
    return done.every(Boolean) ? `all in ${ms} ms` : `${callActors.filter((_, i) => !done[i]).map((a) => a.label).join(', ')} not in the workspot: press Play first`;
  });

const callNewPerson = () =>
  step('A new person, same file', async () => {
    if (!called) throw new Error('Press Write and swap first');
    const { id } = await world.spawn({ record: RECORD, ...(await inFront(4.5, 0)), workspot: called.path });
    callActors.push({ id, label: 'C' });
    await wait(1500);
    const r = await world.useWorkspot(id);
    callActors[callActors.length - 1].id = r.id;
    return `${r.started ? 'started' : `not started: ${r.why}`}; say whether it showed a T pose`;
  });

// ---- state and clean-up -----------------------------------------------------------

const state = () =>
  step('State', async () => {
    const out = [];
    for (const a of actors) out.push(`${a.label} ${JSON.stringify(await world.workspotState(a.id))}`);
    return out.join(' | ') || 'no actors';
  });
const removeAll = () =>
  step('Remove the actors', async () => {
    let n = 0;
    for (const s of world.spawned()) if (await world.remove(s.id).catch(() => false)) n += 1;
    actors = [];
    callActors = [];
    quest = null;
    return `${n} removed`;
  });
world.onRespawn((before, after) => {
  for (const a of actors) if (a.id.hash === before.hash) a.id = after;
  if (quest && quest.id.hash === before.hash) quest.id = after;
  for (const a of callActors) if (a.id.hash === before.hash) a.id = after;
});

const chosen = ui.text('Workspot: bare (only the test clips)', { tone: 'accent' });
ui.window({
  title: 'Director spike (#46)',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 700,
  height: 880,
  closable: true,
  children: [
    status,
    ui.heading('1 and 2. The workspots'),
    ui.toggle('Clips loop until a jump (off: each plays once and the next follows, as 0.1.0 wrote them)', (on) => (loopClips = on), { checked: true }),
    ui.row(ui.button('Build', build), ui.button('Swap in', swap, { variant: 'ghost' })),
    chosen,
    ui.row(
      ui.button('Use bare', () => {
        which = 'bare';
        chosen.set({ text: 'Workspot: bare (only the test clips)' });
      }, { variant: 'ghost' }),
      ui.button('Use full', () => {
        which = 'full';
        chosen.set({ text: "Workspot: full (the game's entries and exits kept)" });
      }, { variant: 'ghost' }),
    ),
    ui.heading('3. Two actors'),
    ui.row(ui.button('Spawn', spawn), ui.button('Play both', play), ui.button('State', state, { variant: 'ghost' }), ui.button('Watch 30 s', watch, { variant: 'ghost' })),
    ui.heading('4. Jumps'),
    ui.toggle('Instant: jump now (off: wait for the clip playing to end)', (on) => (snap = on), { checked: true }),
    ui.toggle('Jump by entry id (SendJumpCommandEnt) instead of by clip name', (on) => (byEntry = on)),
    ui.row(...CLIPS.slice(0, 3).map(([label, clip]) => ui.button(label, () => jump(label, clip), { variant: 'ghost' }))),
    ui.heading('5 and 6. Gap, root motion, timing'),
    ui.row(ui.button('Step off, then nothing', gap), ui.button('Timed run (8 s)', timed)),
    ui.heading('8 and 10. Quest clip: one more person, Q, plays each variant'),
    ui.row(...VARIANTS.slice(0, 4).map(([name]) => ui.button(name, () => tryVariant(name), { variant: 'ghost' }))),
    ui.row(...VARIANTS.slice(4).map(([name]) => ui.button(name, () => tryVariant(name), { variant: 'ghost' }))),
    ui.row(ui.button('copy, preloaded (its own file)', () => tryVariant('copy-pre', { preloaded: true }), { variant: 'ghost' })),
    ui.heading('9. The first play'),
    ui.row(ui.button('Spawn, wait 10 s, then play', spawnWaitPlay, { variant: 'ghost' })),
    ui.heading('11. world.writeWorkspot (REDnode 0.66.9)'),
    ui.row(ui.button('Write and swap', callWrite), ui.button('Spawn two with it', callSpawn, { variant: 'ghost' }), ui.button('Play', callPlay, { variant: 'ghost' })),
    ui.row(...CALL_CLIPS.slice(0, 3).map((c) => ui.button(c.name, () => callJump(c.name), { variant: 'ghost' })), ui.button('A new person, same file', callNewPerson, { variant: 'ghost' })),
    ui.heading('7. Weather (REDnode 0.66.10)'),
    ui.row(
      ui.button('Read the weather', weather, { variant: 'ghost' }),
      ui.button('Rain', () => setWeather('24h_weather_rain', 10)),
      ui.button('Fog', () => setWeather('WeatherPresets.Fog', 10), { variant: 'ghost' }),
      ui.button('Sunny, at once', () => setWeather('24h_weather_sunny', 0), { variant: 'ghost' }),
      ui.button('Give it back', resetWeather, { variant: 'ghost' }),
    ),
    ui.row(ui.button('Remove the actors', removeAll, { variant: 'ghost' })),
    log,
  ],
});
say('Director spike 0.6.0 ready');
for (const [name, what] of VARIANTS) say(`  variant ${name}: ${what}`);
