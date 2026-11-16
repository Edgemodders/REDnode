// Animation test: #39's spike, A1 (docs/world.md, "Animations on a spawned character (#39): plan").
// Through `api` and `world` only, no REDnode change. Each button is one step; every call, its
// answer and its time go to the log, and what shows on screen is for the player to say.
//
//   1 Person   spawns a character beside V (the Trauma Team medic by default) carrying a workspot
//              component (workWorkspotResourceComponent named "workspot") that names the chosen
//              workspot file. The workspot system takes only game objects as its device, so the
//              person is their own device (0.1.0 put the component on a box, a bare entity, and
//              every call was refused). Choosing another workspot means spawning the person again.
//   2 Play     PlayInDeviceSimple(person, person, ...) at the workspot's place or where the person
//              stands, or PlayNpcInWorkspot(person, person, person, ...)
//   3 Jump     SendJumpToAnimEnt to one animation by name, and the animation's length from the
//              person's animation controller (-1: not loaded on that rig)
//   4 State    IsActorInWorkspot, IsWorkspotEnabled and the extended info's flags
//   5 Stop     a fast exit, or StopNpcInWorkspot; then remove everything
//
// The answers decide #39's call (A2): whether a quest's workspot plays outside its scene on a
// spawned person, what it needs, and what a failure looks like.

import { api, game, kernel, ui, world } from 'rednode';

const PEOPLE = [
  ['Person: paramedic', 'Character.trauma_team_paramedic'],
  ['Person: hey_07 medic', 'Character.mws_hey_07_trauma_medic_01'],
  ['Person: pac_06 medic', 'Character.mws_pac_06_trauma_medic_01'],
];
const Q001 = 'base\\workspots\\quest\\main_quests\\prologue\\q001\\q001_00c_rescuing_girl\\';
// A gameplay workspot as the control, then the medics' quest workspots (male rig).
const WORKSPOTS = [
  ['Pose: arms crossed (gameplay)', 'base\\workspots\\common\\ground\\generic__stand_ground_arms_crossed__stand_around__02.workspot', 'stand__2h_on_sides__01'],
  ['Pose: quest medic 1', `${Q001}q001_00c_trauma_arrives___med_01_idle__01.workspot`, 'q001_00c_trauma_arrives___med_1_idle__01'],
  ['Pose: quest medic 2', `${Q001}q001_00c_trauma_arrives___med_02_idle__01.workspot`, 'q001_00c_trauma_arrives___med_2_idle__01'],
  ['Pose: quest soldier 1', `${Q001}q001_00c_trauma_arrives___soldier_01_idle__01.workspot`, 'q001_00c_trauma_arrives___soldier_1_idle__01'],
];

let record = PEOPLE[0][1];
let hold = false;
let workspot = WORKSPOTS[0][1];
let anim = WORKSPOTS[0][2];
let person = null; // { id, at, workspot }
let busy = '';

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const chosen = ui.text(`Chosen: ${WORKSPOTS[0][0]}`, { tone: 'accent' });
const log = ui.list({ keep: 500 });

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

async function inFront(metres) {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  const yaw = (Math.atan2(f.Y, f.X) * 180) / Math.PI + 90; // facing V
  return { position: { x: p.X + f.X * metres, y: p.Y + f.Y * metres, z: p.Z }, yaw };
}

const system = () => api.GameInstance.GetWorkspotSystem(game.instance);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function personRef() {
  if (!person) throw new Error('Spawn the person first (1)');
  const e = await world.entity(person.id);
  if (!e) throw new Error('The person is not in the world');
  return e;
}
const short = (path) => path.split('\\').pop();

// ---- 1. Person, carrying the workspot ----------------------------------------------

const spawnPerson = () =>
  step(`Spawn ${record}${hold ? ', holding' : ', not holding'}, with ${short(workspot)}`, async () => {
    if (person) await world.remove(person.id).catch(() => false);
    person = null;
    const at = await inFront(3);
    const component = await api.$new('workWorkspotResourceComponent', { name: 'workspot', workspotResource: workspot });
    const { id, entity } = await world.spawn({ record, ...at, npc: { hold, friendly: true }, components: [component] });
    person = { id, at, workspot };
    if (!entity) return `${id.hash}, not in the world after 10 s`;
    const look = await entity.GetCurrentAppearanceName().catch(() => '?');
    const comp = await entity.FindComponentByName('workspot').catch((e) => `error ${e.message}`);
    return `${id.hash}, appearance ${look}; its "workspot" component ${comp ? 'found' : 'NOT found'}`;
  });

// ---- 2. Play ----------------------------------------------------------------------

// Round 2 (0.3.0): how long the person stays in the workspot, logged by a watcher, and Keep it
// looping, which plays it again the same way each time it ends (a quest workspot plays once:
// its sequence does not loop, the scene repeats it).
let looping = false;
let lastPlay = null; // () => Promise<void>, the last way played
let watch = null;

function watchWorkspot(person, label) {
  if (watch) clearInterval(watch.timer);
  const w = { started: performance.now(), person: person.id.hash, timer: null, busy: false };
  watch = w;
  w.timer = setInterval(async () => {
    if (w.busy) return;
    w.busy = true;
    try {
      const p = person && (await world.entity(person.id).catch(() => null));
      if (!p) return void clearInterval(w.timer);
      const ws = await system();
      if (await ws.IsActorInWorkspot(p)) return;
      say(`  ${label}: left the workspot after ${((performance.now() - w.started) / 1000).toFixed(1)} s`);
      if (looping && lastPlay) {
        await lastPlay();
        w.started = performance.now();
        say(`  ${label}: played again (Keep it looping)`);
      } else clearInterval(w.timer);
    } finally {
      w.busy = false;
    }
  }, 250);
}

const playSelf = (where) =>
  step(`PlayInDeviceSimple on itself, ${where}`, async () => {
    const ws = await system();
    const p = await personRef();
    lastPlay = async () => ws.PlayInDeviceSimple(await personRef(), await personRef(), false, 'workspot', '', '', 0.3, where, api.$null);
    await lastPlay();
    await wait(800);
    watchWorkspot(person, short(person.workspot));
    return `called; in a workspot after 0.8 s: ${await ws.IsActorInWorkspot(p)}`;
  });

// The quest clips, kept loaded through Codeware's resource depot while this app runs, so a play
// need not wait for them (the T pose before each quest idle, unverified as the cause).
const QUEST_ANIMS = 'base\\animations\\quest_custom\\q001\\q001_00c_rescuing_girl\\q001_00c_trauma_arrives\\q001_00c_trauma_arrives_male_average.anims';
const kept = [];
const loadClips = () =>
  step('Load the quest clips', async () => {
    const depot = await api.GameInstance.GetResourceDepot();
    if (!depot) throw new Error('no resource depot (needs Codeware)');
    const token = await depot.LoadResource(QUEST_ANIMS);
    const started = performance.now();
    for (let i = 0; i < 200 && !(await token.IsFinished()); i++) await wait(50);
    const res = await token.GetResource().catch(() => null);
    kept.push(token, res);
    const failed = await token.IsFailed().catch(() => '?');
    return `${short(QUEST_ANIMS)}: ${res ? 'loaded' : 'NOT loaded'} after ${((performance.now() - started) / 1000).toFixed(1)} s (failed ${failed}); kept while the app runs`;
  });

const playNpc = () =>
  step('PlayNpcInWorkspot on itself', async () => {
    const ws = await system();
    const p = await personRef();
    lastPlay = async () => ws.PlayNpcInWorkspot(await personRef(), await personRef(), await personRef(), 'workspot', '', 0.3, '');
    await lastPlay();
    await wait(800);
    watchWorkspot(person, short(person.workspot));
    return `called; in a workspot after 0.8 s: ${await ws.IsActorInWorkspot(p)}`;
  });

// ---- 3. Jump ----------------------------------------------------------------------

const jump = () =>
  step(`Jump to ${anim}`, async () => {
    if (!anim.trim()) throw new Error('No animation name: type one');
    const ws = await system();
    await ws.SendJumpToAnimEnt(await personRef(), anim.trim(), false);
    return 'called';
  });

const duration = () =>
  step(`Length of ${anim}`, async () => {
    const p = await personRef();
    const ctrl = await p.GetAnimationControllerComponent();
    if (!ctrl) return 'no animation controller';
    const s = await ctrl.GetAnimationDuration(anim.trim());
    return `${s} s${s > 0 ? ' (loaded on this rig)' : ' (not loaded, or not on this rig)'}`;
  });

// ---- 4. State ---------------------------------------------------------------------

const state = () =>
  step('State', async () => {
    const ws = await system();
    const p = await personRef();
    const inWs = await ws.IsActorInWorkspot(p);
    const enabled = await ws.IsWorkspotEnabled(p).catch(() => '?');
    const info = await ws.GetExtendedInfo(p).catch(() => null);
    let flags = 'no extended info';
    if (info) {
      const keys = ['isActive', 'entering', 'exiting', 'playingSyncAnim', 'inReaction', 'inMotion'];
      const values = await Promise.all(keys.map((k) => info.$get(k).catch(() => '?')));
      flags = keys.map((k, i) => `${k} ${values[i]}`).join(', ');
    }
    return `in a workspot ${inWs}, enabled ${enabled}; ${flags}`;
  });

// ---- 5. Stop ----------------------------------------------------------------------

const fastExit = () =>
  step('Fast exit', async () => {
    const ws = await system();
    const p = await personRef();
    await ws.SendFastExitSignal(p, { X: 0, Y: 0, Z: 0 }, false, true, false, false);
    await wait(1500);
    return `in a workspot after 1.5 s: ${await ws.IsActorInWorkspot(p)}`;
  });

const stop = () =>
  step('StopNpcInWorkspot', async () => {
    const ws = await system();
    const p = await personRef();
    await ws.StopNpcInWorkspot(p);
    await wait(500);
    return `in a workspot after 0.5 s: ${await ws.IsActorInWorkspot(p)}`;
  });

const removeAll = () =>
  step('Remove all', async () => {
    let n = 0;
    for (const s of world.spawned()) if (await world.remove(s.id).catch(() => false)) n += 1;
    person = null;
    return `${n} removed`;
  });

// ---- A2: the call (REDnode 0.66.8) -----------------------------------------------------
// world.spawn({ workspot }), world.useWorkspot, world.workspotState, world.stopWorkspot: what
// rounds 1 to 3 did by hand, in the rednode package.

let a2 = null; // the person's id

const a2Spawn = () =>
  step(`A2 spawn ${record} carrying ${short(workspot)}`, async () => {
    if (a2) await world.remove(a2).catch(() => false);
    const { id, entity } = await world.spawn({ record, ...(await inFront(3)), workspot });
    a2 = id;
    return `${id.hash}${entity ? '' : ', not in the world yet'}`;
  });

const a2Use = (withChosen) =>
  step(withChosen ? `A2 useWorkspot with ${short(workspot)}` : 'A2 useWorkspot', async () => {
    if (!a2) throw new Error('Press A2 spawn first');
    const r = await world.useWorkspot(a2, withChosen ? { workspot } : {});
    const was = a2.hash;
    a2 = r.id;
    return `${r.started ? 'started' : `not started: ${r.why}`}${r.id.hash !== was ? `; spawned again as ${r.id.hash}` : ''}`;
  });

const a2State = () =>
  step('A2 workspotState', async () => {
    if (!a2) throw new Error('Press A2 spawn first');
    return JSON.stringify(await world.workspotState(a2));
  });

const a2Stop = () =>
  step('A2 stopWorkspot', async () => {
    if (!a2) throw new Error('Press A2 spawn first');
    return `stopped: ${await world.stopWorkspot(a2)}`;
  });

world.onRespawn((before, after) => {
  if (a2 && before.hash === a2.hash) a2 = after;
});

// ---- Window -----------------------------------------------------------------------

const recordInput = ui.input({ value: record, placeholder: 'A Character record', onChange: (v) => (record = v.trim()), onSubmit: (v) => (record = v.trim()) });
const animInput = ui.input({ value: anim, placeholder: 'An animation name in the workspot', onChange: (v) => (anim = v), onSubmit: (v) => (anim = v) });
const wsInput = ui.input({ value: workspot, placeholder: 'A .workspot depot path', onChange: (v) => (workspot = v.trim()), onSubmit: (v) => (workspot = v.trim()) });
function pick([name, path, a]) {
  workspot = path;
  anim = a;
  wsInput.set({ value: path });
  animInput.set({ value: a });
  chosen.set({ text: `Chosen: ${name}. Spawn the person again to give it to them.`, tone: 'accent' });
}

ui.window({
  title: 'Animation test',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 680,
  height: 860,
  closable: true,
  children: [
    requires,
    ui.heading('1. Person, carrying the workspot'),
    chosen,
    ui.row(...WORKSPOTS.map((w) => ui.button(w[0], () => pick(w), { variant: 'ghost' }))),
    wsInput,
    recordInput,
    ui.row(
      ...PEOPLE.map(([label, r]) =>
        ui.button(
          label,
          () => {
            record = r;
            recordInput.set({ value: r });
          },
          { variant: 'ghost' },
        ),
      ),
    ),
    ui.toggle('Hold still (a hold command)', (on) => (hold = on)),
    ui.row(ui.button('Spawn the person', spawnPerson)),
    ui.heading('2. Play'),
    ui.row(ui.button('Load the quest clips', loadClips, { variant: 'ghost' })),
    ui.toggle('Keep it looping (play again each time it ends)', (on) => (looping = on)),
    ui.row(
      ui.button('Play here', () => playSelf('DontPlayAtResourcePosition')),
      ui.button('Play at the workspot\'s place', () => playSelf('PlayAtResourcePosition'), { variant: 'ghost' }),
      ui.button('Play: NPC way', playNpc, { variant: 'ghost' }),
    ),
    ui.heading('3. Jump'),
    animInput,
    ui.row(ui.button('Jump to it', jump), ui.button('Its length', duration, { variant: 'ghost' })),
    ui.heading('A2: the call (world.useWorkspot)'),
    ui.row(
      ui.button('A2 spawn', a2Spawn),
      ui.button('A2 use', () => a2Use(false)),
      ui.button('A2 use the chosen pose', () => a2Use(true), { variant: 'ghost' }),
    ),
    ui.row(ui.button('A2 state', a2State, { variant: 'ghost' }), ui.button('A2 stop', a2Stop, { variant: 'ghost' })),
    ui.heading('4 and 5. State, stop'),
    ui.row(
      ui.button('State', state),
      ui.button('Fast exit', fastExit, { variant: 'ghost' }),
      ui.button('Stop', stop, { variant: 'ghost' }),
      ui.button('Remove all', removeAll, { variant: 'ghost' }),
    ),
    log,
  ],
});

const checked = await kernel.requirements();
let ready = null;
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
say('Animation test 0.4.0 ready');
