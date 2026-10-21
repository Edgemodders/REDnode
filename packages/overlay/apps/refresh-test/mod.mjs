// Refresh test: the spike of H2 world.refresh (docs/world.md, "H2 world.refresh: plan").
// A swap replaces an archive, but what is already in the world keeps what it loaded.
// Each button tries one way the game offers to load something again, through `api`
// only, and logs what it called and how long it took. What shows on screen is for the
// player to say: the point is which ways pick up the swapped mesh or material.
//
//   V's clothes   RefreshAttachment, ResetItemAppearance, or take off and put back,
//                 on each slot that holds an item (or the slots typed in)
//   Looked at     the target's appearance scheduled again, the same one or through
//                 a missing one and back
//   Spawned       a box (or any mesh typed in) spawned, then spawned again, or its
//                 mesh component switched off and on (needs Codeware)

import { api, archives, game, kernel, ui, world } from 'rednode';

// V's clothing slots. A slot the game does not know is simply empty.
const CLOTHING = ['Head', 'Eyes', 'Chest', 'Torso', 'Legs', 'Feet', 'Outfit'];
const TEMPLATE = 'base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent';
const BOX = 'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh';
const MESH_NAME = 'rednode_refresh_mesh';

let file = '';
let slotText = '';
let meshPath = BOX;
let spawned = null; // { id, at, mesh }

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const log = ui.list({ keep: 400 });

function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

// Runs one step, timed, and logs its failure instead of throwing.
async function step(label, fn) {
  const started = performance.now();
  try {
    const note = await fn();
    say(`${label}: ${note ?? 'done'} (${(performance.now() - started).toFixed(0)} ms)`);
  } catch (err) {
    say(`${label} failed: ${err.message}`);
  }
}

async function player() {
  const p = await api.GetPlayer(game.instance);
  if (!p) throw new Error('No player: load a save first');
  return p;
}

const shop = () => api.GameInstance.GetTransactionSystem(game.instance);

// The slots typed in (names such as Torso, or full records such as OutfitSlots.Torso),
// or every clothing slot.
function slots() {
  const typed = slotText.split(/[\s,]+/).filter(Boolean);
  return (typed.length ? typed : CLOTHING).map((s) => (s.includes('.') ? s : `AttachmentSlots.${s}`));
}

// The slots that hold an item, with the item's ID and appearance.
async function worn(v, ts) {
  const found = [];
  for (const slot of slots()) {
    if (await ts.IsSlotEmpty(v, slot)) continue;
    const item = await ts.GetItemInSlot(v, slot);
    if (!item) continue;
    const itemID = await item.GetItemID();
    const appearance = await ts.GetItemAppearance(v, itemID);
    found.push({ slot, itemID, appearance });
  }
  if (!found.length) throw new Error(`nothing in ${slots().join(', ')}`);
  return found;
}

const short = (slot) => slot.replace(/^AttachmentSlots\./, '');

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

// The strongest of the three: the item's entity goes and comes back. The item stays in
// the inventory and equipped; a garment's partial look (sleeves, tucked) may be lost.
const putBack = () =>
  clothes('Take off and put back', async (v, ts, w) => {
    const off = await ts.RemoveItemFromSlot(v, w.slot, true, false, true);
    const on = await ts.AddItemToSlot(v, w.slot, w.itemID);
    return `off ${off}, on ${on}, `;
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
  height: 720,
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
      placeholder: `Slots, blank for all: ${CLOTHING.join(' ')}`,
      onChange: (v) => (slotText = v),
      onSubmit: (v) => (slotText = v),
    }),
    ui.row(
      ui.button('Re-attach', reattach),
      ui.button('Reset look', resetAppearance, { variant: 'ghost' }),
      ui.button('Same look', sameAppearance, { variant: 'ghost' }),
      ui.button('Off and on', putBack, { variant: 'ghost' }),
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
    log,
  ],
});

const checked = await kernel.requirements();
const codeware = await world.available().catch(() => false);
requires.set({
  text: [
    ...checked.map((r) => `${r.ok ? 'OK' : 'MISSING'}  ${r.name} ${r.wants}  ${r.found ?? r.note}`),
    `${codeware ? 'OK' : 'NOT READY'}  world API (Codeware, a loaded save): needed for 4`,
  ].join('\n'),
  tone: checked.every((r) => r.ok) ? 'normal' : 'danger',
});
game.on('PlayerPuppet.OnGameAttached', () => {
  spawned = null; // a load removes what was spawned
});
say('Refresh test ready');
