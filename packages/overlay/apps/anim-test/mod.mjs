// Animation test: #39's spike, A1 (docs/world.md, "Animations on a spawned character (#39): plan").
// Through `api` and `world` only, no REDnode change. Each button is one step; every call, its
// answer and its time go to the log, and what shows on screen is for the player to say.
//
//   1 Person   spawns a character beside V (the Trauma Team medic by default), holding still or not
//   2 Device   spawns a box at the person's place carrying a workspot component
//              (workWorkspotResourceComponent named "workspot") that names the workspot file
//   3 Play     puts the person in the device's workspot, two ways: PlayInDeviceSimple (the device
//              way, with the component named as the actor's or the device's data), or
//              PlayNpcInWorkspot (V as the master, the box as the reference)
//   4 Jump     SendJumpToAnimEnt to one animation by name, and the animation's length from the
//              person's animation controller (whether its set is loaded on that rig)
//   5 State    IsActorInWorkspot and the extended info (active, entering, exiting, sync anim)
//   6 Stop     a fast exit, or StopNpcInWorkspot; then remove everything
//
// The answers decide #39's call (A2): whether a quest's workspot plays outside its scene on a
// spawned person, what the device needs, and what a failure looks like.

import { api, game, kernel, ui, world } from 'rednode';

const PEOPLE = ['Character.trauma_team_paramedic', 'Character.mws_hey_07_trauma_medic_01', 'Character.mws_pac_06_trauma_medic_01'];
const Q001 = 'base\\workspots\\quest\\main_quests\\prologue\\q001\\q001_00c_rescuing_girl\\';
// The medics' quest workspots (male rig), then a gameplay one as the control.
const WORKSPOTS = [
  ['Medic 1', `${Q001}q001_00c_trauma_arrives___med_01_idle__01.workspot`, 'q001_00c_trauma_arrives___med_1_idle__01'],
  ['Medic 2', `${Q001}q001_00c_trauma_arrives___med_02_idle__01.workspot`, 'q001_00c_trauma_arrives___med_2_idle__01'],
  ['Soldier 1', `${Q001}q001_00c_trauma_arrives___soldier_01_idle__01.workspot`, 'q001_00c_trauma_arrives___soldier_1_idle__01'],
  ['Arms crossed (gameplay)', 'base\\workspots\\common\\ground\\generic__stand_ground_arms_crossed__stand_around__02.workspot', 'stand__2h_on_sides__01'],
];
const BOX = 'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh';

let record = PEOPLE[0];
let hold = false;
let workspot = WORKSPOTS[0][1];
let anim = WORKSPOTS[0][2];
let person = null; // { id, at }
let device = null; // { id }
let busy = '';

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const chosen = ui.text(`Workspot: ${WORKSPOTS[0][0]}`, { tone: 'dim' });
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
async function personRef() {
  if (!person) throw new Error('Spawn a person first (1)');
  const e = await world.entity(person.id);
  if (!e) throw new Error('The person is not in the world');
  return e;
}
async function deviceRef() {
  if (!device) throw new Error('Make a device first (2)');
  const e = await world.entity(device.id);
  if (!e) throw new Error('The device is not in the world');
  return e;
}

// ---- 1. Person --------------------------------------------------------------------

const spawnPerson = () =>
  step(`Spawn ${record}${hold ? ', holding' : ', not holding'}`, async () => {
    if (person) await world.remove(person.id).catch(() => false);
    const at = await inFront(3);
    const { id, entity } = await world.spawn({ record, ...at, npc: { hold, friendly: true } });
    person = { id, at };
    if (!entity) return `${id.hash}, not in the world after 10 s`;
    const look = await entity.GetCurrentAppearanceName().catch(() => '?');
    const body = await entity.GetBodyType?.().catch(() => null);
    const gender = await entity.GetResolvedGenderName?.().catch(() => null);
    return `${id.hash}, appearance ${look}${gender ? `, gender ${gender}` : ''}${body ? `, body ${body}` : ''}`;
  });

// ---- 2. Device --------------------------------------------------------------------

const makeDevice = () =>
  step(`Device for ${workspot.split('\\').pop()}`, async () => {
    if (!person) throw new Error('Spawn a person first (1)');
    if (device) await world.remove(device.id).catch(() => false);
    const component = await api.$new('workWorkspotResourceComponent', { name: 'workspot', workspotResource: workspot });
    const { id, entity } = await world.spawn({ mesh: BOX, position: person.at.position, yaw: person.at.yaw, components: [component] });
    device = { id };
    if (!entity) return `${id.hash}, not in the world after 10 s`;
    const comp = await entity.FindComponentByName('workspot').catch((e) => `error ${e.message}`);
    return `${id.hash} at the person's place; its "workspot" component ${comp ? 'found' : 'NOT found'}`;
  });

// ---- 3. Play ----------------------------------------------------------------------

const playDevice = (asActorData) =>
  step(`PlayInDeviceSimple (component as ${asActorData ? 'actor' : 'device'} data)`, async () => {
    const ws = await system();
    const [p, d] = [await personRef(), await deviceRef()];
    await ws.PlayInDeviceSimple(d, p, false, asActorData ? 'workspot' : '', asActorData ? '' : 'workspot', '', 0.3, 'PlayAtResourcePosition', api.$null);
    await new Promise((r) => setTimeout(r, 600));
    return `called; in a workspot after 0.6 s: ${await ws.IsActorInWorkspot(p)}`;
  });

const playNpc = () =>
  step('PlayNpcInWorkspot (V master, box reference)', async () => {
    const ws = await system();
    const [p, d] = [await personRef(), await deviceRef()];
    const v = await api.GetPlayer(game.instance);
    await ws.PlayNpcInWorkspot(p, v, d, 'workspot', '', 0.3, '');
    await new Promise((r) => setTimeout(r, 600));
    return `called; in a workspot after 0.6 s: ${await ws.IsActorInWorkspot(p)}`;
  });

// ---- 4. Jump ----------------------------------------------------------------------

const jump = () =>
  step(`Jump to ${anim}`, async () => {
    if (!anim.trim()) throw new Error('No animation name for this workspot: type one');
    const ws = await system();
    const p = await personRef();
    await ws.SendJumpToAnimEnt(p, anim.trim(), false);
    return 'called';
  });

const duration = () =>
  step(`Length of ${anim}`, async () => {
    const p = await personRef();
    const ctrl = await p.GetAnimationControllerComponent();
    if (!ctrl) return 'no animation controller';
    const s = await ctrl.GetAnimationDuration(anim.trim());
    return `${s} s${s > 0 ? ' (its set is loaded on this rig)' : ' (0: not loaded, or not on this rig)'}`;
  });

// ---- 5. State ---------------------------------------------------------------------

const state = () =>
  step('State', async () => {
    const ws = await system();
    const p = await personRef();
    const inWs = await ws.IsActorInWorkspot(p);
    const info = await ws.GetExtendedInfo(p).catch(() => null);
    const flags = info
      ? ['isActive', 'entering', 'exiting', 'playingSyncAnim', 'inReaction', 'inMotion'].map((k) => `${k} ${info[k] ?? '?'}`).join(', ')
      : 'no extended info';
    const enabled = await ws.IsWorkspotEnabled(p).catch(() => '?');
    return `in a workspot ${inWs}, enabled ${enabled}; ${flags}`;
  });

// ---- 6. Stop ----------------------------------------------------------------------

const fastExit = () =>
  step('Fast exit', async () => {
    const ws = await system();
    const p = await personRef();
    await ws.SendFastExitSignal(p, { X: 0, Y: 0, Z: 0 }, false, true, false, false);
    await new Promise((r) => setTimeout(r, 1500));
    return `in a workspot after 1.5 s: ${await ws.IsActorInWorkspot(p)}`;
  });

const stop = () =>
  step('StopNpcInWorkspot', async () => {
    const ws = await system();
    const p = await personRef();
    await ws.StopNpcInWorkspot(p);
    await new Promise((r) => setTimeout(r, 500));
    return `in a workspot after 0.5 s: ${await ws.IsActorInWorkspot(p)}`;
  });

const removeAll = () =>
  step('Remove all', async () => {
    let n = 0;
    for (const s of world.spawned()) if (await world.remove(s.id).catch(() => false)) n += 1;
    person = null;
    device = null;
    return `${n} removed`;
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
  chosen.set({ text: `Workspot: ${name}${a ? '' : ' (no animation name: Jump does not apply)'}` });
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
    ui.heading('1. Person'),
    recordInput,
    ui.row(
      ...PEOPLE.map((r, i) =>
        ui.button(`Medic ${i + 1}`, () => {
          record = r;
          recordInput.set({ value: r });
        }, { variant: 'ghost' }),
      ),
    ),
    ui.toggle('Hold still (a hold command)', (on) => (hold = on)),
    ui.row(ui.button('Spawn the person', spawnPerson)),
    ui.heading('2. Device'),
    chosen,
    ui.row(...WORKSPOTS.map((w) => ui.button(w[0], () => pick(w), { variant: 'ghost' }))),
    wsInput,
    ui.row(ui.button('Make the device', makeDevice)),
    ui.heading('3. Play'),
    ui.row(
      ui.button('Play: device, actor data', () => playDevice(true)),
      ui.button('Play: device, device data', () => playDevice(false), { variant: 'ghost' }),
      ui.button('Play: NPC way', playNpc, { variant: 'ghost' }),
    ),
    ui.heading('4. Jump'),
    animInput,
    ui.row(ui.button('Jump to it', jump), ui.button('Its length', duration, { variant: 'ghost' })),
    ui.heading('5 and 6. State, stop'),
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
say('Animation test ready');
