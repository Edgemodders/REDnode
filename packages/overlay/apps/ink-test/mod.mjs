// Ink test: the spike of the ink API (docs/ink.md, "I1 Spike: plan").
// Everything goes through `api`, one game call at a time, to learn what I2's ink driver
// must do. REDnode's script REDnodeInk.reds keeps the roots of a few HUD and menu
// controllers (no Codeware needed) and gives the listener class for clicks.
//
//   Roots           which roots exist: the script's (hud.*, menu.*) and Codeware's layers
//   HUD text        a text and a rectangle on the chosen root
//   Menu button     a clickable rectangle with a label on the open menu's root
//   Speed           one change's round trip, 50 in a row, 200 and 600 at once
//   Check           whether what was added still exists
//   Open screen     a hub menu by name, through StartHubMenuEvent
//   Menu entries    the game's menu resources, found through REDbridge, read through Codeware
//   Read screen     walks a root's widget tree and writes it to a file in this app's data folder
//   Clean up        removes everything this app added

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, game, kernel, pkg, ui } from 'rednode';

const FONT = 'base\\gameplay\\gui\\fonts\\raj\\raj.inkfontfamily';
const SCREENS = ['inventory_screen', 'new_perks', 'world_map', 'codex', 'phone', 'tarot_main'];
// Codeware's layer names (its inkSystem.GetLayer), tried when Codeware is installed.
const LAYERS = ['inkHUDLayer', 'inkMenuLayer', 'inkGameNotificationsLayer'];

let rootName = 'hud.healthbar';
let screen = SCREENS[0];
let busy = '';
let nextId = 1;
const added = []; // { label, widget, parent }
const listeners = []; // kept so ink's weak hold on them lasts

const status = ui.text('Load a save, then press Roots.', { tone: 'dim' });
const log = ui.list({ keep: 400 });

function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

// Runs one step, timed, and logs its failure instead of throwing. One at a time, so the
// steps' game calls never interleave.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const size = (v) => (v ? `${Math.round(v.X)}x${Math.round(v.Y)}` : '?');

// Codeware's ink system, or null without Codeware.
async function inkSystem() {
  try {
    return await api.GameInstance.GetInkSystem();
  } catch {
    return null;
  }
}

// A root by name: one the script keeps (hud.*, menu.*), or a Codeware layer's window
// (cw.inkHUDLayer and the rest).
async function root(name) {
  if (name.startsWith('cw.')) {
    const ink = await inkSystem();
    if (!ink) throw new Error('Codeware is not installed, or its ink system is not ready');
    const layer = await ink.GetLayer(name.slice(3));
    if (!layer) throw new Error(`Codeware has no layer ${name.slice(3)}`);
    const window = await layer.GetVirtualWindow();
    if (!window) throw new Error(`${name} has no window now`);
    return window;
  }
  const r = await api.$static('REDnodeInk', 'Root', name);
  if (!r) throw new Error(`No root ${name} now (press Roots to see which exist)`);
  return r;
}

async function describe(name, w) {
  const [type, size2, visible, children] = await Promise.all([
    w.$type,
    w.GetSize().catch(() => null),
    w.IsVisible().catch(() => null),
    w.GetNumChildren().catch(() => null),
  ]);
  return `${name}: ${type}, ${size(size2)}, ${visible ? 'visible' : 'hidden'}, ${children} children`;
}

async function roots() {
  const names = (await api.$static('REDnodeInk', 'Names')) ?? [];
  const lines = [];
  for (const name of names) {
    const r = await api.$static('REDnodeInk', 'Root', name);
    lines.push(r ? await describe(name, r) : `${name}: gone`);
  }
  if (!names.length) lines.push('no script roots (REDnodeInk.reds not loaded, or no HUD yet)');
  const ink = await inkSystem();
  if (!ink) {
    lines.push('Codeware: not installed or not ready');
  } else {
    const layers = (await ink.GetLayers()) ?? [];
    const named = await Promise.all(layers.map((l) => l.GetLayerName()));
    lines.push(`Codeware: ${layers.length} layers: ${named.join(', ')}`);
    for (const name of LAYERS) {
      try {
        lines.push(await describe(`cw.${name}`, await root(`cw.${name}`)));
      } catch (err) {
        lines.push(`cw.${name}: ${err.message}`);
      }
    }
  }
  for (const l of lines) say(`  ${l}`);
  status.set({ text: lines.join('\n'), tone: 'normal' });
  return `${names.length} script roots`;
}

// Adds a child of an ink class: tries the script name, then the native name, since which
// one AddChild takes is one of the spike's questions.
async function addChild(parent, names) {
  for (const name of names) {
    const w = await parent.AddChild(name).catch(() => null);
    if (w) return { w, name };
  }
  throw new Error(`AddChild took none of ${names.join(', ')}`);
}

async function addText(parent, text, x, y, fontSize) {
  const { w, name } = await addChild(parent, ['inkText', 'inkTextWidget']);
  await w.SetName(`rednode_ink_${nextId++}`);
  await w.SetFontFamily(FONT, 'Medium');
  await w.SetFontSize(fontSize);
  await w.SetText(text, null);
  await w.SetAnchor('TopLeft');
  await w.$call('SetMargin;FloatFloatFloatFloat', x, y, 0, 0);
  await w.$call('SetTintColor;Uint8Uint8Uint8Uint8', 94, 246, 255, 255);
  return { w, name };
}

async function addRect(parent, x, y, width, height, rgba) {
  const { w, name } = await addChild(parent, ['inkRectangle', 'inkRectangleWidget']);
  await w.SetName(`rednode_ink_${nextId++}`);
  await w.SetAnchor('TopLeft');
  await w.$call('SetMargin;FloatFloatFloatFloat', x, y, 0, 0);
  await w.$call('SetSize;FloatFloat', width, height);
  await w.$call('SetTintColor;Uint8Uint8Uint8Uint8', ...rgba);
  return { w, name };
}

async function hudText() {
  const parent = await root(rootName);
  const rect = await addRect(parent, 40, 40, 360, 90, [12, 12, 16, 200]);
  const text = await addText(parent, 'REDnode ink', 60, 55, 48);
  added.push({ label: `rect on ${rootName}`, widget: rect.w, parent }, { label: `text on ${rootName}`, widget: text.w, parent });
  return `added a rectangle (${rect.name}) and a text (${text.name}) on ${rootName}`;
}

async function menuButton() {
  const names = (await api.$static('REDnodeInk', 'Names')) ?? [];
  const menu = rootName.startsWith('menu.') || rootName.startsWith('cw.') ? rootName : names.find((n) => n.startsWith('menu.'));
  if (!menu) throw new Error('No menu is open: open the pause menu or a hub screen first, or type a cw. root');
  const parent = await root(menu);
  const id = nextId++;
  const rect = await addRect(parent, 80, 80, 320, 70, [200, 40, 50, 230]);
  const text = await addText(parent, `Ink button ${id}`, 100, 92, 36);
  await rect.w.SetInteractive(true);
  const listener = await api.$new('REDnodeInkListener', { id });
  listeners.push(listener);
  for (const event of ['OnPress', 'OnRelease', 'OnHoverOver', 'OnHoverOut']) {
    await rect.w.RegisterToCallback(event, listener, event);
  }
  added.push({ label: `button ${id} on ${menu}`, widget: rect.w, parent }, { label: `label ${id} on ${menu}`, widget: text.w, parent });
  return `button ${id} on ${menu}: hover it and click it`;
}

async function speed() {
  const target = added.find((a) => a.label.startsWith('text'))?.widget;
  if (!target) throw new Error('Press HUD text first: Speed changes that text');
  const lines = [];
  let t = performance.now();
  await target.SetText('speed 1', null);
  lines.push(`1 change: ${(performance.now() - t).toFixed(1)} ms`);
  t = performance.now();
  for (let i = 0; i < 50; i++) await target.SetText(`in a row ${i}`, null);
  const row = performance.now() - t;
  lines.push(`50 in a row: ${row.toFixed(0)} ms, ${(row / 50).toFixed(1)} ms each`);
  for (const n of [200, 600]) {
    t = performance.now();
    await Promise.all(Array.from({ length: n }, (_, i) => target.SetText(`at once ${i}`, null)));
    lines.push(`${n} at once: ${(performance.now() - t).toFixed(0)} ms`);
  }
  await target.SetText('REDnode ink', null);
  for (const l of lines) say(`  ${l}`);
  return lines.join('; ');
}

async function check() {
  if (!added.length) return 'nothing added';
  const lines = await Promise.all(
    added.map(async (a) => {
      try {
        return `${a.label}: exists, ${(await a.widget.IsVisible()) ? 'visible' : 'hidden'}`;
      } catch (err) {
        return `${a.label}: ${err.message}`;
      }
    }),
  );
  for (const l of lines) say(`  ${l}`);
  return `${lines.filter((l) => l.includes('exists')).length} of ${added.length} exist`;
}

async function openScreen() {
  const event = await api.$new('StartHubMenuEvent');
  await event.$call('SetStartMenu;CNameCNameIScriptable', screen, '', null);
  const uiSystem = await api.GameInstance.GetUISystem(game.instance);
  await uiSystem.QueueEvent(event);
  return `queued StartHubMenuEvent for ${screen}`;
}

// The game's menu resources: found by name through REDbridge, loaded through Codeware's
// ResourceDepot (the game already has them loaded), and their entries listed.
async function menuEntries() {
  const b = await kernel.bridge();
  const found = [];
  for (const query of ['.inkmenu', '.inklayers']) {
    const r = await b.call('archive.search', { query, limit: 20 });
    found.push(...r.items.map((f) => f.name));
  }
  say(`  found ${found.length}: ${found.join(', ')}`);
  const depot = await api.GameInstance.GetResourceDepot().catch(() => null);
  if (!depot) return `${found.length} found; reading them needs Codeware`;
  for (const path of found) {
    const token = await depot.LoadResource(path);
    for (let i = 0; i < 40 && !(await token.IsFinished()); i++) await sleep(50);
    const res = await token.GetResource();
    if (!res) {
      say(`  ${path}: not loaded (${(await token.IsFailed()) ? 'failed' : 'not finished'})`);
      continue;
    }
    if (res.$type === 'inkMenuResource') {
      const entries = (await res.$get('menusEntries')) ?? [];
      say(`  ${path}: ${entries.length} entries: ${entries.map((e) => e.name).join(', ')}`);
      const scenarios = (await res.$get('scenariosNames')) ?? [];
      say(`  ${path}: scenarios: ${scenarios.join(', ')}`);
    } else if (res.$type === 'inkLayersResource') {
      const defs = await res.$get('layerDefinitions');
      say(`  ${path}: menu layer's menu resource ${defs?.menuLayer?.menuResource}`);
    } else {
      say(`  ${path}: a ${res.$type}`);
    }
  }
  return `${found.length} resources`;
}

// Walks the root's tree level by level, all the calls of a level at once, and writes
// one line per widget. The file is game data: it stays on this PC.
async function readScreen() {
  const top = await root(rootName);
  const first = { w: top, depth: 0, kids: [] };
  let level = [first];
  let count = 0;
  const started = performance.now();
  while (level.length) {
    const next = [];
    const read = await Promise.all(
      level.map(async (n) => {
        const w = n.w;
        const [name, visible, sz, controllers, children, text] = await Promise.all([
          w.GetName().catch(() => ''),
          w.IsVisible().catch(() => null),
          w.GetSize().catch(() => null),
          w.GetNumControllers().catch(() => 0),
          w.GetNumChildren().catch(() => null),
          /text/i.test(w.$type) ? w.GetText().catch(() => null) : null,
        ]);
        n.line =
          `${'  '.repeat(n.depth)}${w.$type} "${name}" ${size(sz)}${visible ? '' : ' hidden'}` +
          `${controllers ? ` controllers:${controllers}` : ''}${text != null ? ` text:${JSON.stringify(text)}` : ''}`;
        return { n, children };
      }),
    );
    for (const { n, children } of read) {
      count++;
      if (!children) continue;
      const kids = await Promise.all(Array.from({ length: children }, (_, i) => n.w.GetWidgetByIndex(i).catch(() => null)));
      for (const k of kids.filter(Boolean)) {
        const kid = { w: k, depth: n.depth + 1, kids: [] };
        n.kids.push(kid);
        next.push(kid);
      }
    }
    level = next;
  }
  const ms = performance.now() - started;
  // Read level by level, written as a tree: each widget, then its children.
  const lines = [];
  const write = (n) => {
    lines.push(n.line);
    n.kids.forEach(write);
  };
  write(first);
  const file = join(pkg.dataDir, `ink-dump-${rootName.replace(/[^a-z0-9.]/gi, '_')}-${Date.now()}.txt`);
  writeFileSync(file, `${rootName}: ${count} widgets read in ${ms.toFixed(0)} ms\n\n${lines.join('\n')}\n`);
  return `${count} widgets in ${ms.toFixed(0)} ms, written to ${file}`;
}

async function cleanUp() {
  let removed = 0;
  for (const a of added.splice(0)) {
    try {
      await a.parent.RemoveChild(a.widget);
      removed++;
    } catch {
      // gone already (a save load or a closed menu)
    }
  }
  listeners.length = 0;
  return `removed ${removed}`;
}

for (const event of ['press', 'release', 'hoverOver', 'hoverOut']) {
  game.on(`REDnodeInk.${event}`, (e) => say(`ink ${event} on button ${e.value}`));
}
game.on('REDnodeInk.root', (e) => console.log(`REDnodeInk: ${e.value} roots kept`));
game.on('REDnodeInk.noSystem', () => say('REDnodeInk: a root came before the script system was ready'));
game.on('PlayerPuppet.OnGameAttached', () => {
  if (added.length) say(`A save loaded: ${added.length} added widgets may be gone (press Check)`);
});

ui.window({
  title: 'Ink test',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 640,
  height: 860,
  closable: true,
  children: [
    status,
    ui.heading('Roots'),
    ui.input({
      value: rootName,
      placeholder: 'hud.healthbar, hud.minimap, hud.quests, menu.hub, menu.pause, cw.inkHUDLayer',
      onChange: (v) => (rootName = v.trim()),
      onSubmit: (v) => (rootName = v.trim()),
    }),
    ui.row(
      ui.button('Roots', () => step('Roots', roots)),
      ui.button('HUD text', () => step('HUD text', hudText)),
      ui.button('Menu button', () => step('Menu button', menuButton)),
    ),
    ui.row(
      ui.button('Speed', () => step('Speed', speed), { variant: 'ghost' }),
      ui.button('Check', () => step('Check', check), { variant: 'ghost' }),
      ui.button('Clean up', () => step('Clean up', cleanUp), { variant: 'ghost' }),
    ),
    ui.heading('Screens'),
    ui.input({
      value: screen,
      placeholder: SCREENS.join(', '),
      onChange: (v) => (screen = v.trim()),
      onSubmit: (v) => (screen = v.trim()),
    }),
    ui.row(
      ui.button('Open screen', () => step('Open screen', openScreen)),
      ui.button('Menu entries', () => step('Menu entries', menuEntries), { variant: 'ghost' }),
      ui.button('Read screen', () => step('Read screen', readScreen), { variant: 'ghost' }),
    ),
    log,
  ],
});

say('Ink test ready');
