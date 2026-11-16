// World nodes test: #24's spike, S24 (docs/world.md, "World node registry (#24)"). The world node
// registry, ported from RED Hot Tools into REDnode's plugin: which sector and node an object
// in the world comes from, its outline, hiding it for the session. Each button is one call,
// logged with its answer and time; what shows on screen is for the player to say.
//
//   Start      world.nodeRegistry(): attaches the hooks; then load a save so the sectors around V
//              are recorded. Says where the sector's node buffer was found (+0x40 or +0x48)
//   Pick       world.pick() along the camera's view: the nodes whose box it crosses, nearest first,
//              each with its class, sector and index, and whether its box holds the collision hit
//   Outline    world.highlight on the picked node (the one holding the hit, else the nearest)
//   Hide/Show  world.setVisible for the session; hidden nodes show again when the app stops
//   Again      world.node(id): the same node again by its id
//   Timing     20 picks, for the cost
//
// With the bridge permission, sector and resource hashes are named through REDbridge.

import { kernel, ui, world } from 'rednode';

let max = 50;
let kinds = '';
let all = false;
let picked = []; // the last pick's hits
let chosen = null; // the node the buttons act on
const hidden = new Set();
let busy = '';
let bridge = null;

const state = ui.text('Press Start, then load a save.', { tone: 'dim' });
const target = ui.text('No node chosen.', { tone: 'dim' });
const log = ui.list({ keep: 600 });

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

const names = new Map();
async function nameOf(hash) {
  if (!hash) return '';
  if (names.has(hash)) return names.get(hash);
  let name = '';
  try {
    bridge ??= await kernel.bridge();
    const r = await bridge.call('hash.resolve', { hash });
    name = r?.path ?? r?.Path ?? '';
  } catch {
    // no bridge permission, or REDbridge not found: hashes only
  }
  names.set(hash, name);
  return name;
}

const short = (n) => (typeof n === 'number' ? n.toFixed(1) : '?');
async function describe(n) {
  const sector = (await nameOf(n.sector)) || n.sector;
  const res = n.resource ? (await nameOf(n.resource)) || n.resource : '';
  return `${n.kind} ${n.id}  sector ${sector.split('\\').pop()}  node ${n.index}/${n.nodeCount}, instance ${n.instance}/${n.instanceCount}${
    n.distance !== undefined ? `  at ${short(n.distance)} m` : ''
  }  box from ${n.boundsFrom}${n.holdsHit ? '  HOLDS THE HIT' : ''}${res ? `  ${res.split('\\').pop()}` : ''}${n.appearance ? ` (${n.appearance})` : ''}${
    n.streamed ? `  attached ${n.attached}, visible ${n.visible}` : '  not streamed'
  }${n.hidden ? '  HIDDEN' : ''}`;
}

function choose(n) {
  chosen = n;
  target.set({ text: n ? `Chosen: ${n.kind} ${n.id}` : 'No node chosen.', tone: n ? 'accent' : 'dim' });
}

const start = () =>
  step('Start', async () => {
    const s = await world.nodeRegistry();
    showState(s);
    return `hooks ${s.attached.join(', ') || 'none'}; layout ${s.layout ?? 'not found yet'}; ${s.sectors} sectors, ${s.setups} nodes`;
  });

function showState(s) {
  state.set({
    text: `Hooks: ${s.attached.join(', ') || 'none'}. Layout: ${s.layout ?? '?'}. Sectors ${s.sectors} (${s.badSectors} bad), nodes ${s.setups}, live ${s.instances}, hidden ${s.hidden}, refused reads ${s.refused}, ${s.sectorMs} ms recording. Hide ${s.canHide ? 'yes' : 'NO'}, outline ${s.canHighlight ? 'yes' : 'not yet'}.`,
    tone: s.badSectors ? 'danger' : 'normal',
  });
}

const refresh = () =>
  step('State', async () => {
    const s = await world.nodeRegistry();
    showState(s);
    return JSON.stringify(s);
  });

const pick = () =>
  step(`Pick (${max} m${kinds ? `, ${kinds}` : ''}${all ? ', all' : ''})`, async () => {
    const r = await world.pick({ max, limit: 12, all, ...(kinds.trim() ? { kinds: kinds.split(',').map((k) => k.trim()) } : {}) });
    picked = r.hits;
    say(`  physics hit: ${r.physicsHit ? `${r.physicsHit.distance.toFixed(1)} m at ${r.physicsHit.point.map((c) => c.toFixed(1)).join(', ')}` : 'none'}`);
    for (const [i, n] of r.hits.entries()) say(`  ${i + 1}. ${await describe(n)}`);
    choose(r.hits.find((n) => n.holdsHit) ?? r.hits[0] ?? null);
    return `${r.found} crossed, ${r.hits.length} shown; ${r.looked} looked at in ${r.ms} ms in the game`;
  });

const pickNth = (i) => {
  if (!picked[i]) return say(`No hit ${i + 1}: pick first`);
  choose(picked[i]);
  say(`Chose ${i + 1}: ${picked[i].kind} ${picked[i].id}`);
};

const need = () => {
  if (!chosen) throw new Error('Pick first');
  return chosen;
};
const outline = (on) =>
  step(on ? 'Outline' : 'Outline off', async () => {
    const n = need();
    const done = await world.highlight(n.id, on ? { outline: 1, seeThrough: false } : null);
    return `${n.id}: ${done ? 'done' : 'not done (see the warning line)'}`;
  });
const outlineRed = () =>
  step('Outline, see-through, fill', async () => {
    const n = need();
    const done = await world.highlight(n.id, { outline: 2, fill: 2, seeThrough: true, opacity: 0.6 });
    return `${n.id}: ${done ? 'done' : 'not done'}`;
  });
const hide = () =>
  step('Hide', async () => {
    const n = need();
    const done = await world.setVisible(n.id, false);
    if (done) hidden.add(n.id);
    return `${n.id}: ${done ? 'hidden' : 'not done (see the warning line)'}`;
  });
const showAll = () =>
  step('Show all hidden', async () => {
    let n = 0;
    for (const id of hidden) if (await world.setVisible(id, true)) n += 1;
    hidden.clear();
    return `${n} shown`;
  });
const again = () =>
  step('Again by id', async () => {
    const n = need();
    const again = await world.node(n.id);
    return again ? await describe(again) : `${n.id}: its sector is not loaded`;
  });
const timing = () =>
  step('20 picks', async () => {
    const ms = [];
    for (let i = 0; i < 20; i++) ms.push((await world.pick({ max, limit: 5, physics: false })).ms);
    ms.sort((a, b) => a - b);
    return `in the game: median ${ms[10].toFixed(2)} ms, worst ${ms[19].toFixed(2)} ms`;
  });

ui.window({
  title: 'World nodes test',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 760,
  height: 880,
  closable: true,
  children: [
    state,
    ui.row(ui.button('Start', start), ui.button('State', refresh, { variant: 'ghost' })),
    ui.heading('Pick (aim with the camera first, then F10)'),
    ui.slider('Reach (m)', (v) => (max = v), { min: 5, max: 200, step: 5, value: max }),
    ui.input({ placeholder: 'Only these kinds, comma separated (e.g. worldMeshNode, worldInstancedMeshNode)', onChange: (v) => (kinds = v), onSubmit: (v) => (kinds = v) }),
    ui.toggle('Also nodes not streamed in', (on) => (all = on)),
    ui.row(ui.button('Pick', pick), ui.button('20 picks (timing)', timing, { variant: 'ghost' })),
    ui.row(...[1, 2, 3, 4, 5, 6].map((i) => ui.button(`Choose ${i}`, () => pickNth(i - 1), { variant: 'ghost' }))),
    target,
    ui.heading('The chosen node'),
    ui.row(
      ui.button('Outline', () => outline(true)),
      ui.button('See-through, filled', outlineRed, { variant: 'ghost' }),
      ui.button('Outline off', () => outline(false), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Hide', hide),
      ui.button('Show all hidden', showAll, { variant: 'ghost' }),
      ui.button('Again by id', again, { variant: 'ghost' }),
    ),
    log,
  ],
});

say('World nodes test ready. Press Start, then load a save.');
