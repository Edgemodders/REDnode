// Refresh test: the spike of H2 world.refresh (docs/world.md, "H2 world.refresh: plan").
// A swap replaces an archive, but what is already in the world keeps what it loaded.
// Each button tries one way the game offers to load something again, through `api`
// only, and logs what it called and how long it took. What shows on screen is for the
// player to say: the point is which ways pick up the swapped mesh or material.
//
//   V's clothes   RefreshAttachment, ResetItemAppearance, or take off and put back,
//                 on each slot that holds clothing (found by Scan, outfit slots such
//                 as Equipment-EX's included), or on the slots typed in
//   Looked at     the target's appearance scheduled again, the same one or through
//                 a missing one and back
//   Spawned       a box (or any mesh typed in) spawned, then spawned again, or its
//                 mesh component switched off and on (needs Codeware)
//   Preview       the inventory's preview of V, a second character: found through the
//                 in-game menu controller (needs Codeware), its items' appearance applied
//                 again directly or through the game's own event (docs/world.md, "H2b
//                 preview: plan")

import { api, archives, game, kernel, tweakdb, ui, world } from 'rednode';

// How long Off and on waits between taking an item off and putting it back, so the
// game can let go of what the item held before it loads it again.
const OFF_MS = 500;
const TEMPLATE = 'base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent';
const BOX = 'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh';
const MESH_NAME = 'rednode_refresh_mesh';

let file = '';
let slotText = '';
let meshPath = BOX;
let spawned = null; // { id, at, mesh }
let scanned = null; // the slots holding clothing at the last Scan
const labels = new Map(); // a slot's id -> its name, from the last Scan
let busy = ''; // the step running, so a second press waits its turn

// The base game's clothing slots, named so a scan shows them by name.
tweakdb.learn(['Head', 'Face', 'Eyes', 'Chest', 'Torso', 'Legs', 'Feet', 'Outfit'].map((n) => `AttachmentSlots.${n}`));
// And some an outfit mod adds (Equipment-EX's layered slots; names unverified).
tweakdb.learn(
  ['Inner', 'Middle', 'Outer'].flatMap((l) => ['Legs', 'Feet', 'Torso'].map((p) => `OutfitSlots.${p}${l}`)).concat(['TorsoUnder', 'TorsoAux', 'Head', 'Feet', 'Glasses', 'Mask', 'Balaclava', 'Wreath', 'Neckwear', 'Waist', 'Back', 'BodyUnder', 'BodyInner', 'BodyMiddle', 'BodyOuter'].map((n) => `OutfitSlots.${n}`)),
);

// A record id as the game hashes its name: the low 40 bits (length and CRC32). An id
// TweakDB lists also carries its place in TweakDB's flat table in the high bits, which
// a slot comparison does not expect (unverified: 0.2.0's Scan found only named slots).
const plainId = (id) => (id.startsWith('0x') ? `0x${(BigInt(id) & 0xffffffffffn).toString(16).toUpperCase().padStart(16, '0')}` : id);

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const log = ui.list({ keep: 400 });

function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

// Runs one step, timed, and logs its failure instead of throwing. One at a time: a
// press while another step runs is refused, so their game calls never interleave.
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

async function player() {
  const p = await api.GetPlayer(game.instance);
  if (!p) throw new Error('No player: load a save first');
  return p;
}

const shop = () => api.GameInstance.GetTransactionSystem(game.instance);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every attachment slot V has, from TweakDB: the base game's AttachmentSlots and any a
// mod adds (Equipment-EX's OutfitSlots). Lists each one that holds an item, and keeps
// those holding clothing (an item type starting with Clo_) for the buttons.
async function scan() {
  const v = await player();
  const ts = await shop();
  const ids = (await tweakdb.records('AttachmentSlot')).map(plainId);
  const held = [];
  let failed = 0;
  // A few calls at a time: each waits for the game thread.
  for (let i = 0; i < ids.length; i += 16) {
    const part = ids.slice(i, i + 16);
    const empty = await Promise.all(part.map((slot) => ts.IsSlotEmpty(v, slot).catch(() => null)));
    part.forEach((slot, n) => (empty[n] === null ? failed++ : !empty[n] && held.push(slot)));
  }
  const found = [];
  for (const slot of held) {
    const item = await ts.GetItemInSlot(v, slot);
    if (!item) continue;
    const itemID = await item.GetItemID();
    const data = await item.GetItemData().catch(() => null);
    const type = String((data && (await data.GetItemType())) ?? '?');
    const name = (await item.GetDisplayName().catch(() => '')) || '';
    const appearance = await ts.GetItemAppearance(v, itemID);
    let label = slot;
    if (slot.startsWith('0x')) {
      const record = await tweakdb.record(slot).catch(() => null);
      label = (record && (await record.EntitySlotName().catch(() => ''))) || slot;
    }
    // Equipment-EX's items read as type Invalid, with the appearance V shows; the base
    // items it hides read empty_appearance_default.
    const shown = appearance && appearance !== 'default' && !appearance.startsWith('empty_appearance');
    found.push({ slot, label, type, name, appearance, clothing: type.startsWith('Clo_') || (type === 'Invalid' && shown) });
  }
  scanned = found.filter((f) => f.clothing).map((f) => f.slot);
  labels.clear();
  for (const f of found) labels.set(f.slot, f.label);
  for (const f of found) say(`  ${f.clothing ? '*' : ' '} ${short(f.label)}: ${f.name || '(no name)'}, ${f.type}, ${f.appearance || '(no appearance)'}`);
  return `${ids.length} slots${failed ? ` (${failed} could not be read)` : ''}, ${found.length} hold an item, ${scanned.length} clothing (marked *): the buttons use those`;
}

// The slots typed in (names such as Legs, or full records such as OutfitSlots.LegsMiddle),
// or the clothing found by the last Scan (scanning first if there was none).
async function slots() {
  const typed = slotText.split(/[\s,]+/).filter(Boolean);
  // A name as Scan showed it (LegsMiddle), a record (OutfitSlots.LegsMiddle), or a base slot (Legs).
  const byLabel = (t) => [...labels].find(([, l]) => l.toLowerCase() === t.toLowerCase() || short(l).toLowerCase() === t.toLowerCase())?.[0];
  if (typed.length) return typed.map((t) => byLabel(t) ?? (t.includes('.') || t.startsWith('0x') ? t : `AttachmentSlots.${t}`));
  if (!scanned) say(`Scan: ${await scan()}`);
  return scanned;
}

// The slots that hold an item, with the item's ID and appearance.
async function worn(v, ts) {
  const found = [];
  const list = await slots();
  for (const slot of list) {
    if (await ts.IsSlotEmpty(v, slot)) continue;
    const item = await ts.GetItemInSlot(v, slot);
    if (!item) continue;
    const itemID = await item.GetItemID();
    const appearance = await ts.GetItemAppearance(v, itemID);
    found.push({ slot, itemID, appearance });
  }
  if (!found.length) throw new Error(`nothing in ${list.map(short).join(', ') || 'any clothing slot'}`);
  return found;
}

const short = (slot) => (labels.get(slot) ?? slot).replace(/^AttachmentSlots\./, '');

async function clothes(label, each) {
  await step(label, async () => {
    const v = await player();
    const ts = await shop();
    const notes = [];
    for (const w of await worn(v, ts)) {
      const started = performance.now();
      const r = await each(v, ts, w);
      notes.push(`${short(w.slot)} ${w.appearance || '(no appearance)'} ${r ?? ''}${(performance.now() - started).toFixed(0)} ms`);
    }
    return notes.join('; ');
  });
}

const reattach = () =>
  clothes('RefreshAttachment', async (v, ts, w) => {
    await ts.RefreshAttachment(v, w.slot, false);
  });

const resetAppearance = () =>
  clothes('ResetItemAppearance', async (v, ts, w) => {
    await ts.ResetItemAppearance(v, w.itemID);
  });

const sameAppearance = () =>
  clothes('ChangeItemAppearanceByName (same name)', async (v, ts, w) => {
    if (!w.appearance) return 'skipped, ';
    await ts.ChangeItemAppearanceByName(v, w.itemID, w.appearance);
  });

// The strongest of the three: the item's entity goes and comes back, as taking it off
// and putting it on in the inventory does. It waits between the two, so the game lets go
// of what the item held. The item stays in the inventory and equipped; a garment's
// partial look (sleeves, tucked) may be lost.
const putBack = () =>
  step('Take off and put back', async () => {
    const v = await player();
    const ts = await shop();
    const items = await worn(v, ts);
    const off = [];
    for (const w of items) off.push(await ts.RemoveItemFromSlot(v, w.slot, true, false, true));
    await sleep(OFF_MS);
    const on = [];
    for (const w of items) on.push(await ts.AddItemToSlot(v, w.slot, w.itemID));
    return items.map((w, i) => `${short(w.slot)} ${w.appearance || '(no appearance)'} off ${off[i]}, on ${on[i]}`).join('; ') + `; ${OFF_MS} ms between`;
  });

// The same in two presses, so the player chooses the gap, and can swap while the items
// are off: then nothing V wears holds the old version during the swap.
let takenOff = []; // { slot, itemID, appearance }

const takeOff = () =>
  step('Take off', async () => {
    if (takenOff.length) throw new Error(`${takenOff.map((w) => short(w.slot)).join(', ')} already off: press Put back first`);
    const v = await player();
    const ts = await shop();
    const items = await worn(v, ts);
    const off = [];
    for (const w of items) off.push(await ts.RemoveItemFromSlot(v, w.slot, true, false, true));
    takenOff = items;
    return items.map((w, i) => `${short(w.slot)} ${w.appearance || '(no appearance)'} off ${off[i]}`).join('; ');
  });

const putOn = () =>
  step('Put back', async () => {
    if (!takenOff.length) throw new Error('nothing taken off: press Take off first');
    const v = await player();
    const ts = await shop();
    const on = [];
    for (const w of takenOff) on.push(await ts.AddItemToSlot(v, w.slot, w.itemID));
    const items = takenOff;
    takenOff = [];
    const now = [];
    for (const w of items) now.push(await ts.GetItemAppearance(v, w.itemID).catch(() => '?'));
    return items.map((w, i) => `${short(w.slot)} on ${on[i]}, appearance ${now[i] || '(none)'}`).join('; ');
  });

// The inventory's own way: the equipment system, by equipment area. Lists what each
// clothing area holds (the item equipped and the wardrobe's visual item), and takes an
// area's item off and puts it back through the requests the inventory sends.
const AREAS = ['Head', 'Face', 'OuterChest', 'InnerChest', 'Legs', 'Feet', 'Outfit', 'UnderwearTop', 'UnderwearBottom'];
const NO_ITEM = /^0x0+$/;

async function equipmentSystem() {
  const container = await api.GameInstance.GetScriptableSystemsContainer(game.instance);
  const es = await container.Get('EquipmentSystem');
  if (!es) throw new Error('no EquipmentSystem');
  return es;
}

async function itemName(itemID) {
  const id = String(itemID?.id ?? '');
  if (!id || NO_ITEM.test(id)) return '';
  const record = await tweakdb.record(id).catch(() => null);
  return (record && (await record.FriendlyName().catch(() => ''))) || id;
}

// The areas typed in (Legs, OuterChest), or every clothing area.
function areas() {
  const typed = slotText.split(/[\s,]+/).filter((t) => AREAS.some((a) => a.toLowerCase() === t.toLowerCase()));
  return typed.length ? typed.map((t) => AREAS.find((a) => a.toLowerCase() === t.toLowerCase())) : AREAS;
}

const listEquipment = () =>
  step('Equipment', async () => {
    const v = await player();
    const ts = await shop();
    const data = await (await equipmentSystem()).GetPlayerData(v);
    const lines = [];
    for (const area of AREAS) {
      const item = await data.GetActiveItem(area);
      const visual = await data.GetVisualItemInSlot(area).catch(() => null);
      const name = await itemName(item);
      const look = name ? await ts.GetItemAppearance(v, item) : '';
      const shown = await itemName(visual);
      lines.push(`  ${area}: ${name || '(none)'}${look ? `, ${look}` : ''}${shown && shown !== name ? `; wardrobe shows ${shown}` : ''}`);
    }
    lines.forEach(say);
    return `wardrobe set active: ${await data.IsVisualSetActive().catch(() => '?')}`;
  });

const inventoryOffOn = () =>
  step('Inventory off and on', async () => {
    const v = await player();
    const es = await equipmentSystem();
    const data = await es.GetPlayerData(v);
    const items = [];
    for (const area of areas()) {
      const item = await data.GetActiveItem(area);
      if (await itemName(item)) items.push({ area, item });
    }
    if (!items.length) throw new Error(`nothing equipped in ${areas().join(', ')}`);
    for (const { area } of items) await es.QueueRequest(await api.$new('UnequipRequest', { owner: v, areaType: area, slotIndex: 0 }));
    await sleep(OFF_MS);
    for (const { item } of items) await es.QueueRequest(await api.$new('gameEquipRequest', { owner: v, itemID: item, slotIndex: 0 }));
    const notes = [];
    for (const { area, item } of items) {
      const now = await data.GetActiveItem(area);
      notes.push(`${area} ${await itemName(item)} equipped again: ${String(now?.id) === String(item.id)}`);
    }
    return `${notes.join('; ')}; ${OFF_MS} ms between`;
  });

async function lookedAt() {
  const v = await player();
  const targeting = await api.GameInstance.GetTargetingSystem(game.instance);
  const target = await targeting.GetLookAtObject(v, false, false);
  if (!target) throw new Error('V is not looking at anything');
  const name = await target.GetCurrentAppearanceName();
  return { target, name, what: `${target.$type} "${(await target.GetDisplayName()) || 'no name'}"` };
}

const lookSame = () =>
  step('Looked at, same appearance', async () => {
    const { target, name, what } = await lookedAt();
    await target.ScheduleAppearanceChange(name);
    return `${what}, appearance ${name}`;
  });

// Through an appearance the entity does not have and back: unverified what the game
// does with a missing name (keeps the old one, or shows nothing for a moment).
const lookThrough = () =>
  step('Looked at, through a missing appearance', async () => {
    const { target, name, what } = await lookedAt();
    await target.ScheduleAppearanceChange('rednode_no_such_appearance');
    await new Promise((r) => setTimeout(r, 500));
    await target.ScheduleAppearanceChange(name);
    const now = await target.GetCurrentAppearanceName();
    return `${what}, ${name} -> missing -> ${now}`;
  });

async function inFront(metres) {
  const v = await player();
  const p = await v.GetWorldPosition();
  const f = await v.GetWorldForward();
  return { x: p.X + f.X * metres, y: p.Y + f.Y * metres, z: p.Z };
}

async function place(at, mesh) {
  const component = await api.$new('entMeshComponent', {
    name: MESH_NAME,
    mesh,
    meshAppearance: 'default',
    visualScale: { X: 1, Y: 1, Z: 1 },
  });
  const { id } = await world.spawn({ template: TEMPLATE, position: at, components: [component] });
  spawned = { id, at, mesh };
  return id.hash;
}

const spawn = () =>
  step('Spawn', async () => {
    if (spawned) await world.remove(spawned.id).catch(() => false);
    const hash = await place(await inFront(3), meshPath.trim() || BOX);
    return `${hash} with ${spawned.mesh}`;
  });

const respawn = () =>
  step('Respawn', async () => {
    if (!spawned) throw new Error('spawn first');
    const { at, mesh } = spawned;
    const removed = await world.remove(spawned.id);
    spawned = null;
    const hash = await place(at, mesh);
    return `removed ${removed}, spawned ${hash} in the same place`;
  });

const toggleMesh = () =>
  step('Mesh off and on', async () => {
    if (!spawned) throw new Error('spawn first');
    const entity = await world.entity(spawned.id);
    if (!entity) throw new Error('the spawned entity is gone');
    const mesh = await entity.FindComponentByName(MESH_NAME);
    if (!mesh) throw new Error(`no component ${MESH_NAME}`);
    await mesh.Toggle(false);
    await new Promise((r) => setTimeout(r, 200));
    await mesh.Toggle(true);
    return `enabled ${await mesh.IsEnabled()}`;
  });

const removeBox = () =>
  step('Remove', async () => {
    if (!spawned) return 'nothing spawned';
    const ok = await world.remove(spawned.id);
    spawned = null;
    return `removed ${ok}`;
  });

// The inventory's preview of V is a second character, dressed with copies of V's items.
// The in-game menu controller holds it: Codeware's menu layer gives that controller
// (unverified that it is that one: Find preview logs its type), and GetPuppet("inventory")
// the character, or nothing when the game has none at the moment.
async function preview() {
  const ink = await api.GameInstance.GetInkSystem().catch(() => null);
  if (!ink) throw new Error('no ink system: the preview steps need Codeware');
  const layer = await ink.GetLayer('inkMenuLayer');
  const menu = layer && (await layer.GetGameController());
  if (!menu) throw new Error('no game controller on the menu layer');
  const puppet = await menu.GetPuppet('inventory').catch(() => null);
  return { menu, puppet };
}

// What the preview wears in V's clothing slots (Scan's, or those typed in).
async function previewWorn(puppet, ts) {
  const found = [];
  for (const slot of await slots()) {
    const item = await ts.GetItemInSlot(puppet, slot).catch(() => null);
    if (!item) continue;
    const itemID = await item.GetItemID();
    found.push({ slot, itemID, appearance: String((await ts.GetItemAppearance(puppet, itemID).catch(() => '')) ?? '') });
  }
  return found;
}

const findPreview = () =>
  step('Find preview', async () => {
    const { menu, puppet } = await preview();
    // Equipment-EX keeps the preview character too: the same one, if both are found.
    const container = await api.GameInstance.GetScriptableSystemsContainer(game.instance);
    const helper = await container.Get('EquipmentEx.PaperdollHelper').catch(() => null);
    const theirs = helper && (await helper.GetPuppet().catch(() => null));
    const idOf = async (p) => (p ? String((await p.GetEntityID().catch(() => null))?.hash ?? '?') : 'none');
    const notes = [`menu layer controller ${menu.$type}`, `preview ${puppet ? `${puppet.$type} ${await idOf(puppet)}` : 'none'}`];
    if (helper) notes.push(`Equipment-EX's preview ${await idOf(theirs)}`);
    if (puppet) for (const w of await previewWorn(puppet, await shop())) say(`  ${short(w.slot)}: ${w.appearance || '(no appearance)'}`);
    return notes.join('; ');
  });

// Applies the appearance of each item the preview wears again, as the refresh does on V.
const resetPreview = () =>
  step('Reset preview', async () => {
    const { puppet } = await preview();
    if (!puppet) throw new Error('no preview character now');
    const ts = await shop();
    const items = (await previewWorn(puppet, ts)).filter((w) => w.appearance && w.appearance !== 'None' && !w.appearance.startsWith('empty_appearance'));
    if (!items.length) throw new Error('the preview wears nothing in those slots');
    for (const w of items) await ts.ResetItemAppearance(puppet, w.itemID);
    return items.map((w) => `${short(w.slot)} ${w.appearance}`).join('; ');
  });

// The game's own way, as its wardrobe does: an event to V, next frame, that the in-game
// menu controller answers by applying the preview's item in that slot again. Sent only
// when the preview exists: the game's answer does not check for it.
const previewEvent = () =>
  step('Game event', async () => {
    const { puppet } = await preview();
    if (!puppet) throw new Error('no preview character now');
    const v = await player();
    const delay = await api.GameInstance.GetDelaySystem(game.instance);
    const list = await slots();
    for (const slot of list) await delay.DelayEventNextFrame(v, await api.$new('ResetItemAppearanceInSlotDelayEvent', { slotID: slot }));
    return `sent for ${list.map(short).join(', ')}`;
  });

async function swap() {
  const name = file.trim();
  if (!name) return say('Type an archive first');
  await step(`Swap ${name}`, async () => {
    const r = await archives.reload([name]);
    const failed = r.failed.map((f) => `failed ${f.file}: ${f.why}`);
    return [`${r.reloaded.length} swapped in ${r.ms} ms`, ...failed].join('; ');
  });
}

ui.window({
  title: 'Refresh test',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 640,
  height: 860,
  closable: true,
  children: [
    requires,
    ui.heading('1. Swap'),
    ui.input({
      placeholder: 'MyMod.archive in archive/pc/mod, or a full path (Enter swaps)',
      onChange: (v) => (file = v),
      onSubmit: (v) => {
        file = v;
        swap();
      },
    }),
    ui.button('Swap', swap),
    ui.heading("2. V's clothes"),
    ui.input({
      placeholder: 'Slots, blank for what Scan found',
      onChange: (v) => (slotText = v),
      onSubmit: (v) => (slotText = v),
    }),
    ui.row(
      ui.button('Scan', () => step('Scan', scan), { variant: 'ghost' }),
      ui.button('Re-attach', reattach),
      ui.button('Reset look', resetAppearance, { variant: 'ghost' }),
      ui.button('Same look', sameAppearance, { variant: 'ghost' }),
      ui.button('Off and on', putBack, { variant: 'ghost' }),
      ui.button('Take off', takeOff, { variant: 'ghost' }),
      ui.button('Put back', putOn, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Equipment', listEquipment, { variant: 'ghost' }),
      ui.button('Inventory off and on', inventoryOffOn, { variant: 'ghost' }),
    ),
    ui.heading('3. What V looks at'),
    ui.row(
      ui.button('Same appearance', lookSame),
      ui.button('Through a missing one', lookThrough, { variant: 'ghost' }),
    ),
    ui.heading('4. A spawned object'),
    ui.input({
      value: BOX,
      placeholder: 'A .mesh depot path',
      onChange: (v) => (meshPath = v),
      onSubmit: (v) => (meshPath = v),
    }),
    ui.row(
      ui.button('Spawn', spawn),
      ui.button('Respawn', respawn, { variant: 'ghost' }),
      ui.button('Mesh off and on', toggleMesh, { variant: 'ghost' }),
      ui.button('Remove', removeBox, { variant: 'ghost' }),
    ),
    ui.heading('5. The inventory preview'),
    ui.row(
      ui.button('Find preview', findPreview, { variant: 'ghost' }),
      ui.button('Reset preview', resetPreview),
      ui.button('Game event', previewEvent, { variant: 'ghost' }),
    ),
    log,
  ],
});

const checked = await kernel.requirements();
const codeware = await world.available().catch(() => false);
requires.set({
  text: [
    ...checked.map((r) => `${r.ok ? 'OK' : 'MISSING'}  ${r.name} ${r.wants}  ${r.found ?? r.note}`),
    `${codeware ? 'OK' : 'NOT READY'}  world API (Codeware, a loaded save): needed for 4 and 5`,
  ].join('\n'),
  tone: checked.every((r) => r.ok) ? 'normal' : 'danger',
});
game.on('PlayerPuppet.OnGameAttached', () => {
  spawned = null; // a load removes what was spawned
  scanned = null; // and may change what V wears
  takenOff = []; // and puts back what V wore
});
say('Refresh test ready');
