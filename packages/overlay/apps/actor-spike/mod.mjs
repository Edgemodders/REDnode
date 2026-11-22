// V actor spike: #47 for EDGEdir (docs/world.md, "V as an actor (#47)"). Through api and world
// only. Each button is one step; every call, its answer and its time go to the log, and what
// shows on screen (V's pose, the camera, whether V can still walk) is for the player to say.
//
//   1 Body     game.player.body() (REDnode 0.70.0), with the game's GetResolvedGenderName and
//              GetBodyType it reads
//   2 Device   a bare entity at V's feet, facing V's way, carrying the chosen workspot. V has no
//              workspot component of its own, so the device holds it, as the game's devices do
//   3 Play     WorkspotGameSystem.PlayInDeviceSimple(device, V, ...): whether V enters it
//              (IsActorInWorkspot), V's workspot tags, the scene tier in V's state machine, and
//              whether V's place moves. Watch logs them each second while the player tries to
//              walk and look around
//   4 Exits    fast exit, slow exit, StopInDevice: which gives V back
//   5 Third    the game's third-person body for V (gameActivateTPPRepresentationEvent and its
//              Deactivate) and V's camera moved back by a few metres (the FPP camera's local
//              position), so V is seen while acting
//   6 Copy     the fallback: the photo mode copy of V for V's body (player_wa_photomode.ent or
//              player_ma_photomode.ent), dressed with preview copies of what V wears, as photo
//              mode does, then the workspot played on it as on any spawned person. Whether its
//              face, hair and body match V's character creation is for the player to say

import { api, game, ui, world } from 'rednode';

const WORKSPOTS = [
  ['base\\workspots\\player\\ground\\player__stand_ground__idle__01.workspot', 'Player: stand idle'],
  ['base\\workspots\\player\\ground\\player__stand__dance__01.workspot', 'Player: dance'],
  ['base\\workspots\\player\\ground\\player__sit_ground_lean_back__idle__03.workspot', 'Player: sit on the ground'],
  ['base\\workspots\\player\\ground\\player_kneel_ground_rh_on_ground__01.workspot', 'Player: kneel, hand on the ground'],
  ['base\\workspots\\player\\bar\\player_tpp__sit_barstool_bar_lean_left__sit_around__01.workspot', 'Player (third person): sit at a bar'],
  ['base\\workspots\\common\\ground\\generic__stand_ground_arms_crossed__stand_around__02.workspot', "An NPC's: arms crossed (gameplay)"],
];
const COPIES = {
  wa: ['base\\characters\\entities\\player\\photo_mode\\player_wa_photomode.ent', 'ep1\\characters\\entities\\player\\photo_mode\\player_wa_photomode_ep1.ent'],
  ma: ['base\\characters\\entities\\player\\photo_mode\\player_ma_photomode.ent', 'ep1\\characters\\entities\\player\\photo_mode\\player_ma_photomode_ep1.ent'],
};
const COMPONENT = 'rednode_workspot'; // the name world.spawn gives the workspot component
const EMPTY = 'base\\spawner\\empty_entity.ent';
const BASE_SLOTS = ['Head', 'Eyes', 'Chest', 'Torso', 'Legs', 'Feet', 'Outfit', 'UnderwearTop', 'UnderwearBottom'];
const OUTFIT_SLOTS = [
  'Head', 'Balaclava', 'Mask', 'Glasses', 'Eyes', 'EyeLeft', 'EyeRight', 'Wreath', 'EarLeft', 'EarRight',
  'Neckwear', 'NecklaceTight', 'NecklaceShort', 'NecklaceLong', 'TorsoUnder', 'TorsoInner', 'TorsoMiddle',
  'TorsoOuter', 'TorsoAux', 'Back', 'Waist', 'ShoulderLeft', 'ShoulderRight', 'ElbowLeft', 'ElbowRight',
  'WristLeft', 'WristRight', 'Hands', 'HandLeft', 'HandRight', 'LegsInner', 'LegsMiddle', 'LegsOuter',
  'ThighLeft', 'ThighRight', 'KneeLeft', 'KneeRight', 'AnkleLeft', 'AnkleRight', 'Feet', 'BodyUnder',
  'BodyInner', 'BodyMiddle', 'BodyOuter',
];

let workspot = WORKSPOTS[0][0];
let cameraMoves = true; // PlayInDeviceSimple's allowCameraMov
let atWorkspot = false; // PlayAtResourcePosition, else where the device stands
let nameBoth = false; // the component named as the device's data too
let back = 3; // metres the camera moves back in third person
let ep1 = false;
let device = null; // { id }
let copy = null; // { id }
let tppOn = false;
let busy = '';

const status = ui.text('Load a save, stand on open ground, then press Read the body.', { tone: 'dim' });
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
const quiet = (p) => Promise.resolve(p).catch((err) => `(${err.message})`);

async function player() {
  const v = await api.GetPlayer(game.instance);
  if (!v) throw new Error('No player: load a save first');
  return v;
}
const workspots = () => api.GameInstance.GetWorkspotSystem(game.instance);
const fmt = (p) => `${p.X.toFixed(2)}, ${p.Y.toFixed(2)}, ${p.Z.toFixed(2)}`;

// V's place and the yaw world.spawn takes for V's own facing (0 faces +Y).
async function vPlace(ahead = 0) {
  const v = await player();
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  const yaw = (Math.atan2(f.Y, f.X) * 180) / Math.PI - 90;
  return { position: { x: p.X + f.X * ahead, y: p.Y + f.Y * ahead, z: p.Z }, yaw, p };
}

// The scene tier V's state machine is in (1 is plain gameplay), read from its blackboard.
async function sceneTier(v) {
  const defs = await api.$call('GetAllBlackboardDefs');
  const psm = await defs.$get('PlayerStateMachine');
  const id = await psm.$get('SceneTier');
  const bb = await v.GetPlayerStateMachineBlackboard();
  return bb.GetInt(id);
}

async function reading(v) {
  const ws = await workspots();
  const [inWs, tags, tier, pos] = await Promise.all([
    quiet(ws.IsActorInWorkspot(v)),
    quiet(v.GetPlayerCurrentWorkspotTags()),
    quiet(sceneTier(v)),
    v.GetWorldPosition(),
  ]);
  return { inWs, tags: Array.isArray(tags) ? tags.join(' ') || 'none' : tags, tier, pos };
}

// ---- 1. Body ----------------------------------------------------------------------

const readBody = () =>
  step('Read the body', async () => {
    const v = await player();
    const [body, gender, type] = await Promise.all([quiet(game.player.body()), quiet(v.GetResolvedGenderName()), quiet(v.GetBodyType())]);
    return `game.player.body() ${body}; GetResolvedGenderName ${gender}; GetBodyType ${type}`;
  });

// ---- 2 and 3. A device at V's feet, and V in its workspot ----------------------------

const makeDevice = () =>
  step('Make the device at V', async () => {
    if (device) await world.remove(device.id).catch(() => false);
    const place = await vPlace();
    const { id } = await world.spawn({ template: EMPTY, position: place.position, yaw: place.yaw, workspot, tags: ['actor-spike'] });
    device = { id };
    return `device ${id.hash} at ${fmt(place.p)}, carrying ${workspot}`;
  });

const playOnV = () =>
  step('Play on V', async () => {
    if (!device) throw new Error('Press Make the device at V first');
    const d = await world.entity(device.id);
    if (!d) throw new Error('the device is not in the world');
    const v = await player();
    const ws = await workspots();
    const before = await reading(v);
    say(`  before: in workspot ${before.inWs}, tags ${before.tags}, scene tier ${before.tier}, at ${fmt(before.pos)}`);
    const t = performance.now();
    const answer = await ws.PlayInDeviceSimple(d, v, cameraMoves, COMPONENT, nameBoth ? COMPONENT : '', '', 0.3,
      atWorkspot ? 'PlayAtResourcePosition' : 'DontPlayAtResourcePosition', api.$null);
    say(`  PlayInDeviceSimple answered ${answer} in ${(performance.now() - t).toFixed(0)} ms (camera moves ${cameraMoves}, ${atWorkspot ? 'at the workspot' : 'where the device is'}, named as the device's too ${nameBoth})`);
    let r = before;
    for (let i = 0; i < 12; i += 1) {
      await wait(250);
      r = await reading(v);
      if (r.inWs === true) break;
    }
    return `in workspot ${r.inWs}, tags ${r.tags}, scene tier ${r.tier}, at ${fmt(r.pos)}. Say what V does, and try to walk and look around`;
  });

const watch = () =>
  step('Watch 10 s', async () => {
    const v = await player();
    const start = await v.GetWorldPosition();
    for (let i = 1; i <= 10; i += 1) {
      await wait(1000);
      const r = await reading(v);
      const moved = Math.hypot(r.pos.X - start.X, r.pos.Y - start.Y, r.pos.Z - start.Z);
      say(`  ${i} s: in workspot ${r.inWs}, scene tier ${r.tier}, moved ${moved.toFixed(2)} m, tags ${r.tags}`);
    }
    return 'say whether V could walk, turn or look around while it played';
  });

const exitV = (how) =>
  step(`V: ${how}`, async () => {
    const v = await player();
    const ws = await workspots();
    let answer;
    // The game's optional arguments are left out: the plugin fills them with their defaults.
    if (how === 'fast exit') answer = await ws.SendFastExitSignal(v);
    else if (how === 'slow exit') answer = await ws.SendSlowExitSignal(v);
    else answer = await ws.StopInDevice(v);
    let r;
    for (let i = 0; i < 12; i += 1) {
      await wait(250);
      r = await reading(v);
      if (r.inWs === false) break;
    }
    return `answered ${answer}; in workspot ${r.inWs}, scene tier ${r.tier}. Say whether V walks again`;
  });

// ---- 5. Third person ----------------------------------------------------------------

const thirdPerson = (on) =>
  step(`Third person ${on ? 'on' : 'off'}`, async () => {
    const v = await player();
    const evt = await api.$new(on ? 'gameActivateTPPRepresentationEvent' : 'gameDeactivateTPPRepresentationEvent');
    await v.QueueEvent(evt);
    const cam = await v.GetFPPCameraComponent();
    const was = cam ? await quiet(cam.GetLocalPosition()) : null;
    if (cam) await cam.SetLocalPosition({ X: 0, Y: on ? -back : 0, Z: 0, W: 1 });
    tppOn = on;
    return `event queued; camera ${cam ? `from ${typeof was === 'object' ? fmt(was) : was} to 0, ${on ? -back : 0}, 0` : 'not found'}. Say whether V's body shows, and whether the camera sees it`;
  });

// ---- 6. The copy --------------------------------------------------------------------

const spawnCopy = () =>
  step('Spawn the copy', async () => {
    if (copy) await world.remove(copy.id).catch(() => false);
    const body = await game.player.body();
    const template = COPIES[body][ep1 ? 1 : 0];
    const place = await vPlace(2.5);
    const { id } = await world.spawn({ template, position: place.position, yaw: place.yaw + 180, workspot, tags: ['actor-spike'] });
    copy = { id };
    return `copy ${id.hash} from ${template}, 2.5 m in front, facing V. Say whether its face, hair and body are V's`;
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
    if (!copy) throw new Error('Press Spawn the copy first');
    const c = await world.entity(copy.id);
    if (!c) throw new Error('the copy is not in the world');
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

const playOnCopy = () =>
  step('Play on the copy', async () => {
    if (!copy) throw new Error('Press Spawn the copy first');
    const r = await world.useWorkspot(copy.id);
    copy.id = r.id;
    return r.started ? 'started' : `not started: ${r.why}`;
  });

// ---- clean-up -----------------------------------------------------------------------

const giveBack = () =>
  step('Give V back', async () => {
    const v = await player();
    const ws = await workspots();
    if ((await quiet(ws.IsActorInWorkspot(v))) === true) await quiet(ws.StopInDevice(v));
    if (tppOn) await v.QueueEvent(await api.$new('gameDeactivateTPPRepresentationEvent'));
    const cam = await v.GetFPPCameraComponent();
    if (cam) await cam.SetLocalPosition({ X: 0, Y: 0, Z: 0, W: 1 });
    tppOn = false;
    let n = 0;
    for (const s of world.spawned()) if (await world.remove(s.id).catch(() => false)) n += 1;
    device = null;
    copy = null;
    const r = await reading(v);
    return `${n} removed; in workspot ${r.inWs}, scene tier ${r.tier}`;
  });

world.onRespawn((before, after) => {
  if (device && device.id.hash === before.hash) device.id = after;
  if (copy && copy.id.hash === before.hash) copy.id = after;
});

ui.window({
  title: 'V actor spike (#47)',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 680,
  height: 860,
  closable: true,
  children: [
    status,
    ui.heading('1. V\'s body'),
    ui.row(ui.button('Read the body', readBody)),
    ui.heading('2 to 4. The real V in a workspot'),
    ui.select('Workspot', WORKSPOTS.map(([value, label]) => ({ value, label })), { value: workspot, onChange: (v) => (workspot = v) }),
    ui.toggle('The camera follows the animation (allowCameraMov)', (on) => (cameraMoves = on), { checked: true }),
    ui.toggle("Play at the workspot's own place (off: where the device stands)", (on) => (atWorkspot = on)),
    ui.toggle("Name the component as the device's data too", (on) => (nameBoth = on)),
    ui.row(ui.button('Make the device at V', makeDevice), ui.button('Play on V', playOnV), ui.button('Watch 10 s', watch, { variant: 'ghost' })),
    ui.row(
      ui.button('Fast exit', () => exitV('fast exit'), { variant: 'ghost' }),
      ui.button('Slow exit', () => exitV('slow exit'), { variant: 'ghost' }),
      ui.button('StopInDevice', () => exitV('StopInDevice'), { variant: 'ghost' }),
    ),
    ui.heading('5. Third person'),
    ui.select('Camera back', [{ value: '0', label: '0 m (the body only)' }, { value: '2', label: '2 m' }, { value: '3', label: '3 m' }, { value: '5', label: '5 m' }], { value: String(back), onChange: (v) => (back = Number(v)) }),
    ui.row(ui.button('Third person on', () => thirdPerson(true)), ui.button('Third person off', () => thirdPerson(false), { variant: 'ghost' })),
    ui.heading('6. The fallback: a copy of V'),
    ui.toggle('The Phantom Liberty copy (player_*_photomode_ep1.ent)', (on) => (ep1 = on)),
    ui.row(ui.button('Spawn the copy', spawnCopy), ui.button('Dress the copy', dressCopy), ui.button('Play on the copy', playOnCopy)),
    ui.row(ui.button('Give V back', giveBack, { variant: 'ghost' })),
    log,
  ],
});
say('V actor spike 0.1.0 ready');
