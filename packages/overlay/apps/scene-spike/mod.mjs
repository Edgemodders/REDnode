// Scene spike (SC1): EDGEdir's #50 part 2, #48 part 2 and the copy of V left open by #47's test
// (docs/world.md, "The scene spike (SC1)"). Through api and world only, no REDnode change. Each
// button is one step; every call, its answer and its time go to the log, and what shows on screen
// is for the player to say.
//
//   1 Walk     the game's AI move command (AIMoveToCommand through the person's AI component) on a
//              person spawned with npc.hold: the hold is cancelled first, the walk's state, distance
//              and speed are logged each second, and where the person stops. Walk, run or sprint,
//              the navmesh or a straight line, how close to stop, and a facing at the end
//   2 Gap      a person carrying a written workspot: play it, then stop, walk to the target and play
//              it there, with the time of each part (out of the workspot, the first step, arrival,
//              in the workspot again), and whether it plays where the person now stands
//   3 Move     world.move on a person playing a written workspot (EDGEdir's Adjust): a step aside,
//              a quarter turn, and a 2 s drag at 30 moves a second, then where the person is after
//              0.5 s and 2 s and whether the workspot still runs; the game's teleport beside it
//   4 Direct   a person who does not carry the workspot (#48 part 2): a bare device spawned at their
//              feet carries it and WorkspotGameSystem.PlayInDeviceSimple(device, person) plays it, as
//              #47 did for V. On a plain person this package spawned, and on the nearest of the
//              game's own people
//   5 Copy     a copy of V by another route than the photo mode puppet, which crashed the game in
//              #47's test: the game's cutscene copy of V, Character.TPP_Player_Cutscene_Female or
//              _Male (an NPCPuppet on the NPC rig, player_wa_tpp_cutscene.ent), spawned by record with
//              no workspot component, dressed with preview copies of V's clothes, then directed
//              through a device (section 4) and walked (section 1)

import { api, game, ui, world } from 'rednode';

const WALKER = 'Character.trauma_team_paramedic'; // a man: the male clips below
const PLAIN = 'Character.trauma_team_paramedic';
// A bare gameObject with no components, from the game's own files (as #47's spike, 0.2.1).
const EMPTY = 'base\\quest\\minor_quests\\mq061\\entities\\mq061_empty_entity.ent';
const COMPONENT = 'rednode_workspot'; // the name world.spawn gives the workspot component
const MALE_SETS = {
  stand: 'base\\animations\\npc\\generic_characters\\male_average\\interactive_scene\\generic_male_average__stand__2h_on_sides__01.anims',
  crossed: 'base\\animations\\npc\\generic_characters\\male_average\\interactive_scene\\generic_male_average__stand__arms_crossed_front__01.anims',
};
const CLIPS = {
  ma: [
    { set: MALE_SETS.stand, anim: 'stand__2h_on_sides__01', name: 'stand' },
    { set: MALE_SETS.crossed, anim: 'stand__arms_crossed_front__01', name: 'crossed' },
  ],
  wa: [
    { set: 'base\\animations\\npc\\generic_characters\\female_average\\interactive_scene\\generic_female_average__stand__2h_on_sides__01.anims', anim: 'stand__2h_on_sides__01__wait_long__01', name: 'stand' },
    { set: 'base\\animations\\npc\\generic_characters\\female_average\\interactive_scene\\generic_female_average__stand__2h_on_sides__01.anims', anim: 'stand__2h_on_sides__01__stretch_arms__03', name: 'crossed' },
  ],
};
const RIGS = {
  ma: 'base\\characters\\base_entities\\man_base\\man_base.rig',
  wa: 'base\\characters\\base_entities\\woman_base\\woman_base.rig',
};
const COPIES = [
  ['cutscene', 'The cutscene copy (TPP_Player_Cutscene_*)', { wa: 'Character.TPP_Player_Cutscene_Female', ma: 'Character.TPP_Player_Cutscene_Male' }],
  ['noimpostor', 'The cutscene copy, no impostor', { wa: 'Character.TPP_Player_Cutscene_No_Impostor_Female', ma: 'Character.TPP_Player_Cutscene_No_Impostor_Male' }],
];
const BASE_SLOTS = ['Head', 'Eyes', 'Chest', 'Torso', 'Legs', 'Feet', 'Outfit', 'UnderwearTop', 'UnderwearBottom'];
const OUTFIT_SLOTS = [
  'Head', 'Balaclava', 'Mask', 'Glasses', 'Eyes', 'EyeLeft', 'EyeRight', 'Wreath', 'EarLeft', 'EarRight',
  'Neckwear', 'NecklaceTight', 'NecklaceShort', 'NecklaceLong', 'TorsoUnder', 'TorsoInner', 'TorsoMiddle',
  'TorsoOuter', 'TorsoAux', 'Back', 'Waist', 'ShoulderLeft', 'ShoulderRight', 'ElbowLeft', 'ElbowRight',
  'WristLeft', 'WristRight', 'Hands', 'HandLeft', 'HandRight', 'LegsInner', 'LegsMiddle', 'LegsOuter',
  'ThighLeft', 'ThighRight', 'KneeLeft', 'KneeRight', 'AnkleLeft', 'AnkleRight', 'Feet', 'BodyUnder',
  'BodyInner', 'BodyMiddle', 'BodyOuter',
];

// The walk's settings.
let movement = 'Walk';
let straight = false; // ignoreNavigation
let stopAt = 0.5; // desiredDistanceFromTarget, metres
let faceV = false; // rotateEntityTowardsFacingTarget, facing V
let byMarker = false; // the target as an entity (a bare marker at the target) instead of a place
let holdAfter = true;
let fastExit = true;
let copyKind = COPIES[0][0];

let target = null; // { x, y, z }
let targetPin = null;
let marker = null; // { id }
let walker = null; // { id }: the person sections 1 to 3 use
let plain = null; // { id }: section 4's person without a workspot
let copy = null; // { id }
let directed = null; // { person: GameRef getter, label, device: { id }, entries }
let written = {}; // { ma, wa }: what world.writeWorkspot answered, per body
let walk = null; // { cmd, person, label }: the walk running
let busy = '';

const status = ui.text('Load a save outdoors, then press Write the workspots.', { tone: 'dim' });
const log = ui.list({ keep: 1000 });
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
const quiet = (p) => Promise.resolve(p).catch((err) => `(${err.message})`);
const fmt = (p) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
const flat = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vec = (p) => ({ x: p.X, y: p.Y, z: p.Z });

async function player() {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  return v;
}
const workspots = () => api.GameInstance.GetWorkspotSystem(game.instance);

// The yaw world.spawn takes: 0 faces +Y, so an entity facing the way f points has atan2(f) - 90.
const yawOf = (f) => (Math.atan2(f.Y, f.X) * 180) / Math.PI - 90;

// A place `ahead` metres in front of V and `side` to V's right, facing V (or V's way).
async function inFront(ahead, side = 0, { facingV = true } = {}) {
  const v = await player();
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  return {
    position: { x: p.X + f.X * ahead + f.Y * side, y: p.Y + f.Y * ahead - f.X * side, z: p.Z },
    yaw: yawOf(f) + (facingV ? 180 : 0),
  };
}

async function entityOf(who, label) {
  if (!who) throw new Error(`no ${label}: spawn one first`);
  const e = await world.entity(who.id);
  if (!e) throw new Error(`the ${label} is not in the world`);
  return e;
}
async function placeOf(e) {
  return vec(await e.GetWorldPosition());
}

// ---- workspots -----------------------------------------------------------------------

const writeAll = () =>
  step('Write the workspots', async () => {
    const body = await game.player.body();
    const out = [];
    // The man's for the walker and the plain person; V's body's for the copy (the NPC rig, as the
    // cutscene copy's animated component names it), when V is a woman.
    written.ma = await world.writeWorkspot('sc1_ma', { clips: CLIPS.ma, rig: RIGS.ma, swap: body === 'ma' });
    out.push(`${written.ma.path}: ${written.ma.entries.map((e) => `${e.name} ${e.entry}`).join(', ')}`);
    if (body === 'wa') {
      written.wa = await world.writeWorkspot('sc1_wa', { clips: CLIPS.wa, rig: RIGS.wa });
      out.push(`${written.wa.path}: ${written.wa.entries.map((e) => `${e.name} ${e.entry}`).join(', ')}`);
    } else written.wa = written.ma;
    for (const o of out) say(`  ${o}`);
    const last = body === 'wa' ? written.wa : written.ma;
    return `for a ${body} V; ${last.swap ? `swapped in via ${last.swap.via} in ${last.swap.ms} ms` : 'not swapped'}`;
  });

function writtenFor(body) {
  const w = written[body];
  if (!w) throw new Error('Press Write the workspots first');
  return w;
}

// ---- 1. The walk ---------------------------------------------------------------------

const setTarget = () =>
  step('Set the target here', async () => {
    const v = await player();
    target = vec(await v.GetWorldPosition());
    if (targetPin !== null) await world.unpin(targetPin).catch(() => false);
    targetPin = await world.pin({ at: target, title: 'Target' }).catch(() => null);
    if (marker) await world.remove(marker.id).catch(() => false);
    marker = null;
    return `${fmt(target)}. Walk V away from it before a walk, so V is not in the way`;
  });

const spawnWalker = () =>
  step('Spawn the walker', async () => {
    const w = writtenFor('ma');
    if (walker) await world.remove(walker.id).catch(() => false);
    const place = await inFront(3, 0);
    const { id, position } = await world.spawn({ record: WALKER, ...place, workspot: w.path, npc: { hold: true } });
    walker = { id };
    return `${id.hash} at ${position ? fmt(position) : 'a place not read'}, holding, carrying ${w.path}`;
  });

// The AI component's command state, as the game names it (Executing, Success, Failure, ...).
async function commandState(ai, cmd) {
  return String(await quiet(ai.GetCommandState(cmd)));
}

const FIXED = 131072; // a FixedPoint's Bits per metre (2^17)
const fixed = (v) => ({ Bits: Math.round(v * FIXED) });

async function makeMove(person) {
  let spec;
  if (byMarker) {
    if (!marker) {
      const { id } = await world.spawn({ template: EMPTY, position: target, tags: ['scene-spike'], ground: false });
      marker = { id };
    }
    spec = { entity: await world.entity(marker.id) };
  } else {
    spec = { worldPosition: { x: fixed(target.x), y: fixed(target.y), z: fixed(target.z) } };
  }
  const props = {
    movementTarget: spec,
    movementType: movement,
    ignoreNavigation: straight,
    useStart: true,
    useStop: true,
    desiredDistanceFromTarget: stopAt,
    finishWhenDestinationReached: true,
  };
  if (faceV) {
    props.rotateEntityTowardsFacingTarget = true;
    props.facingTarget = { entity: await player() };
  }
  return api.$new('AIMoveToCommand', props);
}

// Sends the walk to `person` and follows it: a line each second and at each state change, until
// it ends or 60 s pass. Answers the timings for section 2.
async function walkTo(person, label, { cancelHold = true } = {}) {
  if (!target) throw new Error('Press Set the target here first');
  const ai = await person.GetAIControllerComponent();
  if (!ai) throw new Error(`the ${label} has no AI component`);
  if (cancelHold) {
    const hadHold = await quiet(ai.IsCommandExecuting('AIHoldPositionCommand', true));
    await quiet(ai.CancelOrInterruptCommand('AIHoldPositionCommand', true, true));
    say(`  hold command: ${hadHold === true ? 'was running, cancelled' : `not running (${hadHold})`}`);
  }
  const cmd = await makeMove(person);
  const start = await placeOf(person);
  const t0 = performance.now();
  await ai.SendCommand(cmd);
  walk = { cmd, ai, person, label };
  say(`  ${label}: ${movement}${straight ? ', a straight line' : ', on the navmesh'}, stop ${stopAt} m short${faceV ? ', facing V' : ''}${byMarker ? ', target a marker entity' : ''}; ${flat(start, target).toFixed(2)} m to go`);
  let state = '';
  let last = start;
  let lastAt = t0;
  let firstStep = null;
  let lastLine = 0;
  let peak = 0;
  while (performance.now() - t0 < 60000) {
    await wait(100);
    if (!walk || walk.cmd !== cmd) return { cancelled: true };
    const now = performance.now();
    const p = await placeOf(person).catch(() => null);
    if (!p) return { lost: true };
    const s = await commandState(ai, cmd);
    const speed = flat(p, last) / ((now - lastAt) / 1000);
    peak = Math.max(peak, speed);
    if (firstStep === null && flat(p, start) > 0.1) firstStep = now - t0;
    if (s !== state || now - lastLine > 1000) {
      say(`  ${((now - t0) / 1000).toFixed(1)} s: ${s}, ${flat(p, target).toFixed(2)} m to the target, ${speed.toFixed(1)} m/s, height ${(p.z - target.z).toFixed(2)} m`);
      lastLine = now;
    }
    state = s;
    last = p;
    lastAt = now;
    if (/Success|Failure|Cancelled|Interrupted|NotExecuting/.test(s) && now - t0 > 300) break;
  }
  const end = await placeOf(person);
  const f = await person.GetWorldForward();
  walk = null;
  if (holdAfter) await quiet(ai.SendCommand(await api.$new('AIHoldPositionCommand', { duration: 3600 })));
  const facing = yawOf(f);
  return {
    state,
    ms: performance.now() - t0,
    firstStep,
    end,
    off: flat(end, target),
    peak,
    facing,
    note: `${state} after ${((performance.now() - t0) / 1000).toFixed(1)} s; stopped ${flat(end, target).toFixed(2)} m from the target (asked ${stopAt}), height ${(end.z - target.z).toFixed(2)} m, facing yaw ${facing.toFixed(0)}, top speed ${peak.toFixed(1)} m/s, first step at ${firstStep === null ? 'never' : `${firstStep.toFixed(0)} ms`}${holdAfter ? '; holding again' : ''}`,
  };
}

const walkWalker = () =>
  step('Walk to the target', async () => {
    const e = await entityOf(walker, 'walker');
    const r = await walkTo(e, 'the walker');
    return r.note ?? (r.cancelled ? 'stopped' : 'the walker left the world');
  });

const stopWalk = () => {
  if (!walk) return say('Stop the walk: no walk running');
  const w = walk;
  walk = null;
  w.ai
    .CancelCommand(w.cmd)
    .then(() => say(`Stop the walk: cancelled ${w.label}'s walk`))
    .catch((err) => say(`Stop the walk failed: ${err.message}`));
};

// ---- 2. Workspot, walk, workspot ----------------------------------------------------------

async function inWorkspot(e) {
  return (await (await workspots()).IsActorInWorkspot(e)) === true;
}

const playHere = () =>
  step('Play the workspot here', async () => {
    if (!walker) throw new Error('Press Spawn the walker first');
    const r = await world.useWorkspot(walker.id);
    walker.id = r.id;
    return r.started ? 'started on "stand"' : `not started: ${r.why}`;
  });

const gapRun = (walkInside = false) =>
  step(walkInside ? 'Walk while in the workspot' : 'Stop, walk there, play there', async () => {
    const e = await entityOf(walker, 'walker');
    if (!target) throw new Error('Press Set the target here first');
    if (!(await inWorkspot(e))) throw new Error('the walker is not in the workspot: press Play the workspot here first');
    const t0 = performance.now();
    let out = 0;
    if (!walkInside) {
      await world.stopWorkspot(walker.id, { fast: fastExit });
      while (performance.now() - t0 < 10000 && (await inWorkspot(e))) await wait(50);
      out = performance.now() - t0;
      say(`  out of the workspot after ${out.toFixed(0)} ms (${fastExit ? 'fast exit' : "the game's own stop"})`);
    }
    const r = await walkTo(e, 'the walker');
    if (!r.note) return r.cancelled ? 'the walk was stopped' : 'the walker left the world';
    say(`  walk: ${r.note}`);
    if (walkInside) return `in the workspot after the walk: ${await inWorkspot(e)}. Say whether the walker left the workspot to walk, or stayed`;
    const t1 = performance.now();
    const u = await world.useWorkspot(walker.id, { waitMs: 5000 });
    walker.id = u.id;
    const back = performance.now() - t1;
    const at = await placeOf(await world.entity(walker.id));
    return `${u.started ? `in the workspot again ${back.toFixed(0)} ms after the walk` : `not started: ${u.why}`}; at ${flat(at, r.end).toFixed(2)} m from where the walk ended. Gaps: stop ${out.toFixed(0)} ms, first step ${r.firstStep?.toFixed(0) ?? '-'} ms after the walk was sent, walk ${(r.ms / 1000).toFixed(1)} s, play ${back.toFixed(0)} ms. Say whether it plays where the walker stands now`;
  });

const jumpWalker = (name) =>
  step(`Walker: ${name}`, async () => {
    if (!walker) throw new Error('Press Spawn the walker first');
    return (await world.jumpWorkspot(walker.id, name)) ? 'jumped' : 'not in the workspot';
  });

// ---- 3. world.move during a workspot ----------------------------------------------------

async function afterMove(e, label, aimed) {
  const lines = [];
  for (const ms of [0, 500, 2000]) {
    if (ms) await wait(ms === 500 ? 500 : 1500);
    const p = await placeOf(e);
    const f = await e.GetWorldForward();
    lines.push(`${ms / 1000} s: ${flat(p, aimed.position).toFixed(2)} m from the aim, yaw ${yawOf(f).toFixed(0)} (aimed ${aimed.yaw.toFixed(0)}), in workspot ${await inWorkspot(e)}`);
  }
  for (const l of lines) say(`  ${label} ${l}`);
}

async function walkerPlace(e) {
  return { position: await placeOf(e), yaw: yawOf(await e.GetWorldForward()) };
}

const moveStep = (how) =>
  step(`world.move: ${how}`, async () => {
    const e = await entityOf(walker, 'walker');
    const was = await inWorkspot(e);
    const p = await walkerPlace(e);
    const f = await e.GetWorldForward();
    const aimed = how === 'quarter turn'
      ? { position: p.position, yaw: p.yaw + 90 }
      : { position: { x: p.position.x + f.Y * 1, y: p.position.y - f.X * 1, z: p.position.z }, yaw: p.yaw };
    const ok = await world.move(walker.id, aimed.position, undefined, aimed.yaw);
    say(`  in the workspot before: ${was}; world.move answered ${ok}`);
    await afterMove(e, 'after', aimed);
    return 'say whether the walker moved, kept playing, slid back, or left the workspot';
  });

const teleportStep = () =>
  step('The game\'s teleport: a step aside', async () => {
    const e = await entityOf(walker, 'walker');
    const was = await inWorkspot(e);
    const p = await walkerPlace(e);
    const f = await e.GetWorldForward();
    const aimed = { position: { x: p.position.x - f.Y * 1, y: p.position.y + f.X * 1, z: p.position.z }, yaw: p.yaw };
    const tf = await api.GameInstance.GetTeleportationFacility(game.instance);
    await tf.Teleport(e, { X: aimed.position.x, Y: aimed.position.y, Z: aimed.position.z, W: 1 }, { Roll: 0, Pitch: 0, Yaw: aimed.yaw });
    say(`  in the workspot before: ${was}`);
    await afterMove(e, 'after', aimed);
    return 'say what differs from world.move';
  });

const dragStep = () =>
  step('world.move: a 2 s drag, 2 m', async () => {
    const e = await entityOf(walker, 'walker');
    const was = await inWorkspot(e);
    const p = await walkerPlace(e);
    const f = await e.GetWorldForward();
    const t0 = performance.now();
    let n = 0;
    let fails = 0;
    while (performance.now() - t0 < 2000) {
      const k = (performance.now() - t0) / 2000;
      const at = { x: p.position.x + f.Y * 2 * k, y: p.position.y - f.X * 2 * k, z: p.position.z };
      if (!(await world.move(walker.id, at, undefined, p.yaw))) fails += 1;
      n += 1;
      await wait(33);
    }
    const aimed = { position: { x: p.position.x + f.Y * 2, y: p.position.y - f.X * 2, z: p.position.z }, yaw: p.yaw };
    await world.move(walker.id, aimed.position, undefined, aimed.yaw);
    say(`  in the workspot before: ${was}; ${n} moves in 2 s (${(n / 2).toFixed(0)} a second), ${fails} answered false`);
    await afterMove(e, 'after', aimed);
    return 'say whether the walker slid smoothly, jumped, or left the workspot';
  });

// ---- 4. Directing a person through a device ----------------------------------------------

// Spawns a bare device at the person's feet, facing their way, carrying the workspot, and plays it
// on them: the person is not the device (A2's people are their own device).
async function direct(getPerson, label, body) {
  const w = writtenFor(body);
  if (directed?.device) await world.remove(directed.device.id).catch(() => false);
  const person = await getPerson();
  const p = await placeOf(person);
  const f = await person.GetWorldForward();
  const { id } = await world.spawn({ template: EMPTY, position: p, yaw: yawOf(f), workspot: w.path, tags: ['scene-spike'], ground: false });
  const device = await world.entity(id);
  if (!device) throw new Error('the device is not in the world');
  directed = { getPerson, label, device: { id }, entries: w.entries };
  const ws = await workspots();
  const t = performance.now();
  const answer = await ws.PlayInDeviceSimple(device, person, false, COMPONENT, '', '', 0.3, 'DontPlayAtResourcePosition', api.$null);
  let inWs = false;
  for (let i = 0; i < 20 && !inWs; i += 1) {
    await wait(100);
    inWs = await inWorkspot(person);
  }
  return `PlayInDeviceSimple answered ${answer}; ${label} ${inWs ? `in the workspot after ${(performance.now() - t).toFixed(0)} ms` : 'not in the workspot after 2 s'}, on "${w.entries[0].name}". Say whether ${label} plays it, and where`;
}

const directJump = (index) =>
  step(`Directed: ${index === 0 ? 'stand' : 'crossed'}`, async () => {
    if (!directed) throw new Error('Direct someone first');
    const person = await directed.getPerson();
    if (!(await inWorkspot(person))) return `${directed.label} is not in the workspot`;
    const e = directed.entries[index];
    await (await workspots()).SendJumpCommandEnt(person, e.entry, true);
    return `${directed.label}: "${e.name}" (entry ${e.entry}). Say whether they moved to it`;
  });

const directStop = () =>
  step('Directed: stop', async () => {
    if (!directed) throw new Error('Direct someone first');
    const person = await directed.getPerson();
    const ws = await workspots();
    await ws.SendFastExitSignal(person, { X: 0, Y: 0, Z: 0 }, false, true, false, false);
    let inWs = true;
    for (let i = 0; i < 30 && inWs; i += 1) {
      await wait(100);
      inWs = await inWorkspot(person);
    }
    await world.remove(directed.device.id).catch(() => false);
    const label = directed.label;
    directed = null;
    return `${label} ${inWs ? 'still in the workspot after 3 s' : 'out of the workspot'}; device removed. Say what ${label} does now`;
  });

const spawnPlain = () =>
  step('Spawn a plain person', async () => {
    if (plain) await world.remove(plain.id).catch(() => false);
    const { id } = await world.spawn({ record: PLAIN, ...(await inFront(3, 1.5)) });
    plain = { id };
    return `${id.hash}, holding, with no workspot`;
  });

const directPlain = () =>
  step('Direct the plain person', () => direct(() => entityOf(plain, 'plain person'), 'the plain person', 'ma'));

let gamePerson = null; // { id, label }
const directNearest = () =>
  step("Direct the nearest of the game's people", async () => {
    const mine = new Set(world.spawned().map((s) => s.id.hash));
    const near = (await world.near({ radius: 20 })).filter((n) => n.type === 'NPCPuppet' && !mine.has(n.id.hash)).sort((a, b) => a.distance - b.distance);
    if (!near.length) throw new Error("no one of the game's own within 20 m: stand near people");
    const n = near[0];
    const e = n.entity;
    const gender = String(await quiet(e.GetResolvedGenderName()));
    const body = gender === 'Female' ? 'wa' : 'ma';
    if (body === 'wa' && written.wa === written.ma) throw new Error('the nearest person is a woman and V is a man: the woman\'s workspot was not written; stand near a man');
    gamePerson = { id: n.id, label: `the game's ${gender.toLowerCase()} person ${n.distance.toFixed(1)} m away (${n.appearance})` };
    const ai = await e.GetAIControllerComponent().catch(() => null);
    if (ai) await quiet(ai.SendCommand(await api.$new('AIHoldPositionCommand', { duration: 600 })));
    say(`  ${gamePerson.label}: held for 10 minutes first`);
    return direct(() => entityOf(gamePerson, 'person'), gamePerson.label, body);
  });

// ---- 5. A copy of V ----------------------------------------------------------------------

const spawnCopy = () =>
  step('Spawn the copy', async () => {
    if (copy) await world.remove(copy.id).catch(() => false);
    const body = await game.player.body();
    const record = COPIES.find((c) => c[0] === copyKind)[2][body];
    const { id, position } = await world.spawn({ record, ...(await inFront(2.5, 0)) });
    copy = { id, body };
    return `${record} as ${id.hash}${position ? ` at ${fmt(position)}` : ''}, 2.5 m in front, facing V. Say whether its face, hair and body are V's`;
  });

// The clothing V shows, as REDnode's refresh after a swap reads it: Equipment-EX's slots when it
// is in use, else the base slots; empty_appearance_* items are hidden ones.
async function worn(v) {
  const ts = await api.GameInstance.GetTransactionSystem(game.instance);
  const slots = [...BASE_SLOTS.map((n) => `AttachmentSlots.${n}`), ...OUTFIT_SLOTS.map((n) => `OutfitSlots.${n}`)];
  const held = [];
  for (const slot of slots) {
    const item = await ts.GetItemInSlot(v, slot).catch(() => null);
    if (!item) continue;
    const itemID = await item.GetItemID();
    const look = String(await ts.GetItemAppearance(v, itemID).catch(() => ''));
    held.push({ slot, itemID, look });
  }
  const outfit = held.some((w) => w.slot.startsWith('OutfitSlots.'));
  return { ts, items: held.filter((w) => !(outfit && w.slot.startsWith('AttachmentSlots.')) && w.look && w.look !== 'None' && !w.look.startsWith('empty_appearance')) };
}

const dressCopy = () =>
  step('Dress the copy', async () => {
    const c = await entityOf(copy, 'copy');
    const v = await player();
    const { ts, items } = await worn(v);
    let put = 0;
    for (const w of items) {
      const data = await ts.GetItemData(v, w.itemID).catch(() => null);
      const given = data ? await quiet(ts.GivePreviewItemByItemData(c, data)) : await quiet(ts.GivePreviewItemByItemID(c, w.itemID));
      const preview = await ts.CreatePreviewItemID(w.itemID);
      const added = await quiet(ts.AddItemToSlot(c, w.slot, preview, true));
      if (added === true) put += 1;
      say(`  ${w.slot} ${w.look}: given ${given}, added ${added}`);
    }
    return `${put} of ${items.length} items on the copy. Say whether it wears V's clothes`;
  });

const directCopy = () =>
  step('Direct the copy', async () => direct(() => entityOf(copy, 'copy'), 'the copy', copy?.body ?? (await game.player.body())));

const walkCopy = () =>
  step('Walk the copy to the target', async () => {
    const e = await entityOf(copy, 'copy');
    if (directed?.label === 'the copy' && (await inWorkspot(e))) throw new Error('the copy is in a workspot: press Directed: stop first');
    const r = await walkTo(e, 'the copy');
    return r.note ?? (r.cancelled ? 'stopped' : 'the copy left the world');
  });

// ---- clean-up --------------------------------------------------------------------------

const removeAll = () =>
  step('Remove everything', async () => {
    walk = null;
    if (directed && gamePerson && directed.label === gamePerson.label) {
      const e = await world.entity(gamePerson.id).catch(() => null);
      if (e) {
        await quiet((await workspots()).SendFastExitSignal(e, { X: 0, Y: 0, Z: 0 }, false, true, false, false));
        const ai = await e.GetAIControllerComponent().catch(() => null);
        if (ai) await quiet(ai.CancelOrInterruptCommand('AIHoldPositionCommand', true, true));
      }
    }
    let n = 0;
    for (const s of world.spawned()) if (await world.remove(s.id).catch(() => false)) n += 1;
    if (targetPin !== null) await world.unpin(targetPin).catch(() => false);
    walker = plain = copy = marker = directed = gamePerson = null;
    targetPin = null;
    return `${n} removed`;
  });

world.onRespawn((before, after) => {
  for (const who of [walker, plain, copy, marker]) if (who && who.id.hash === before.hash) who.id = after;
});

const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));
ui.window({
  title: 'Scene spike (SC1)',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 720,
  height: 900,
  closable: true,
  children: [
    status,
    ui.row(ui.button('Write the workspots', writeAll), ui.button('Remove everything', removeAll, { variant: 'ghost' })),
    ui.heading('1. A walk (#50)'),
    ui.row(
      ui.select('Pace', opt([['Walk', 'Walk'], ['Run', 'Run'], ['Sprint', 'Sprint']]), { value: movement, onChange: (v) => (movement = v) }),
      ui.select('Stop short by', opt([['0.1', '0.1 m'], ['0.5', '0.5 m'], ['1', '1 m'], ['2', '2 m']]), { value: String(stopAt), onChange: (v) => (stopAt = Number(v)) }),
    ),
    ui.toggle('A straight line (ignoreNavigation), not the navmesh', (on) => (straight = on)),
    ui.toggle('Face V at the end (rotateEntityTowardsFacingTarget)', (on) => (faceV = on)),
    ui.toggle('Target a marker entity at the target, not the place', (on) => (byMarker = on)),
    ui.toggle('Hold again after the walk', (on) => (holdAfter = on), { checked: true }),
    ui.row(ui.button('Set the target here', setTarget), ui.button('Spawn the walker', spawnWalker), ui.button('Walk to the target', walkWalker)),
    ui.row(ui.button('Stop the walk', stopWalk, { variant: 'ghost' })),
    ui.heading('2. Workspot, walk, workspot'),
    ui.toggle("Fast exit (off: the game's own stop)", (on) => (fastExit = on), { checked: true }),
    ui.row(ui.button('Play the workspot here', playHere), ui.button('Stop, walk there, play there', () => gapRun(false))),
    ui.row(
      ui.button('stand', () => jumpWalker('stand'), { variant: 'ghost' }),
      ui.button('crossed', () => jumpWalker('crossed'), { variant: 'ghost' }),
      ui.button('Walk while in the workspot', () => gapRun(true), { variant: 'ghost' }),
    ),
    ui.heading('3. world.move during a workspot (EDGEdir\'s Adjust)'),
    ui.row(
      ui.button('A step aside', () => moveStep('a step aside')),
      ui.button('A quarter turn', () => moveStep('quarter turn')),
      ui.button('A 2 s drag', dragStep),
      ui.button("The game's teleport", teleportStep, { variant: 'ghost' }),
    ),
    ui.heading('4. A person without the workspot (#48)'),
    ui.row(ui.button('Spawn a plain person', spawnPlain), ui.button('Direct the plain person', directPlain), ui.button("Direct the nearest of the game's people", directNearest)),
    ui.row(
      ui.button('Directed: stand', () => directJump(0), { variant: 'ghost' }),
      ui.button('Directed: crossed', () => directJump(1), { variant: 'ghost' }),
      ui.button('Directed: stop', directStop, { variant: 'ghost' }),
    ),
    ui.heading('5. A copy of V (#47)'),
    ui.select('Copy', COPIES.map(([value, label]) => ({ value, label })), { value: copyKind, onChange: (v) => (copyKind = v) }),
    ui.row(ui.button('Spawn the copy', spawnCopy), ui.button('Dress the copy', dressCopy), ui.button('Direct the copy', directCopy), ui.button('Walk the copy to the target', walkCopy)),
    log,
  ],
});
say('Scene spike 0.1.0 ready');
