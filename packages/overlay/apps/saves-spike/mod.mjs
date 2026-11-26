// Saves spike (#57 step 1, for REDcode's tests run by an assistant; docs/world.md, "Saves and
// loading (#57)"). Through api and REDnode 0.74.0's REDnodeSavesListener script only. Each button
// is one question; every call, its answer and its time go to the log.
//
//   Handler   the game's system requests handler, reached through a fresh inkMenuScenario as the
//             plugin's main-menu check does (GetSystemRequestsHandler answers a weak handle):
//             IsPreGame, HasLastCheckpoint and GetLatestSaveMetadata, from the main menu and in game
//   List      RequestSavesForLoad with REDnodeSavesListener registered for OnSavesForLoadReady and
//             OnSaveMetadataReady: the game's own list (its order is the saveIndex LoadSavedGame
//             takes), whether each save's details come without the load menu open, how long it
//             takes, and whether each name matches a folder in Saved Games
//   Load      LoadSavedGame(index) for the save picked, LoadLastCheckpoint(onlySamePlaythrough)
//             for Continue, from the main menu and from a loaded game; the game state's changes
//             are logged with the time since the call, until V is in the world again

import fs from 'node:fs';
import path from 'node:path';
import { api, game, ui } from 'rednode';

const SAVES_DIR = path.join(process.env.USERPROFILE ?? '', 'Saved Games', 'CD Projekt Red', 'Cyberpunk 2077');
const SAVE_TYPES = ['manual', 'quick', 'auto', 'point of no return', 'end game']; // inkSaveType by number (unverified)

let busy = '';
let names = [];
let listed = false;
const meta = new Map(); // index -> details
let listener = null;
let samePlaythrough = false;
let picked = '';
let loadStarted = 0;

const status = ui.text('Works at the main menu and in a loaded game. Press Handler first.', { tone: 'dim' });
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

async function handler() {
  const scenario = await api.$new('inkMenuScenario');
  const h = await scenario.GetSystemRequestsHandler();
  if (!h) throw new Error('GetSystemRequestsHandler answered nothing');
  return h;
}

// What the disk says about a save, by its folder name (unverified: the folder is the save's name).
function onDisk(name) {
  const dir = path.join(SAVES_DIR, name);
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((f) => /^metadata\.\d+\.json$/.test(f));
  let location = '';
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const d = m?.Data?.metadata ?? m?.metadata ?? {};
    location = d.locationName ?? d.LocationName ?? '';
  } catch {
    // unreadable metadata: the folder alone
  }
  return { modified: fs.statSync(dir).mtime, location };
}

game.on('saves.list', (e) => {
  try {
    names = JSON.parse(e.text);
    listed = true;
  } catch (err) {
    return say(`saves.list: unreadable text (${err.message}): ${String(e.text).slice(0, 200)}`);
  }
  say(`saves.list: ${names.length} saves, ${(performance.now() - listStarted).toFixed(0)} ms after RequestSavesForLoad`);
  pick.set({ options: names.map((n, i) => ({ value: String(i), label: `${i}: ${n}` })), value: names.length ? '0' : undefined });
  picked = names.length ? '0' : '';
});
let metaCount = 0;
game.on('saves.meta', (e) => {
  try {
    const m = JSON.parse(e.text);
    meta.set(m.index, m);
    metaCount++;
    if (metaCount <= 5) say(`saves.meta #${m.index} ${m.name}: ${m.location} | ${m.quest} | ${SAVE_TYPES[m.type] ?? m.type} | level ${m.level} | played ${(m.playTime / 3600).toFixed(1)} h | valid ${m.valid} | modded ${m.modded} | ${m.version}`);
  } catch (err) {
    say(`saves.meta: unreadable text (${err.message}): ${String(e.text).slice(0, 200)}`);
  }
});

let lastState = '';
game.onState((s) => {
  const now = `${s.mainMenu ? 'main menu' : ''}${s.world ? 'world' : ''}${s.pauseMenu ? ' pause menu' : ''}${!s.mainMenu && !s.world ? 'loading' : ''}`;
  if (now === lastState) return;
  lastState = now;
  if (loadStarted) say(`state: ${now}, ${((performance.now() - loadStarted) / 1000).toFixed(1)} s after the load call`);
  if (loadStarted && s.world) loadStarted = 0;
});

let listStarted = 0;
async function listSaves() {
  const h = await handler();
  // A fresh listener each time: REDnode drops game objects when a save loads, so one made
  // at the main menu is gone in the game (found in the spike's first run, step 4).
  const old = listener;
  listener = await api.$new('REDnodeSavesListener');
  for (const [event, fn] of [['OnSavesForLoadReady', 'OnSavesForLoadReady'], ['OnSaveMetadataReady', 'OnSaveMetadataReady']]) {
    if (old) await h.UnregisterFromCallback(event, old, fn).catch(() => undefined);
    await h.RegisterToCallback(event, listener, fn);
  }
  names = [];
  listed = false;
  meta.clear();
  metaCount = 0;
  listStarted = performance.now();
  await h.RequestSavesForLoad();
  for (let i = 0; i < 100 && !listed; i++) await wait(100);
  if (!listed) return 'no saves.list event within 10 s (is REDnode 0.74.0\'s script in?)';
  if (!names.length) return 'the game has no saves';
  await wait(3000);
  const disk = names.map(onDisk);
  const found = disk.filter(Boolean).length;
  for (const [i, n] of names.slice(0, 12).entries()) {
    const d = disk[i];
    say(`  ${i}: ${n}${d ? `, folder from ${d.modified.toLocaleString()}${d.location ? `, ${d.location}` : ''}` : ', no folder by that name'}`);
  }
  const ordered = disk.every((d, i) => !d || i === 0 || !disk[i - 1] || disk[i - 1].modified >= d.modified);
  return `${names.length} saves; details for ${meta.size} within 3 s without the load menu; ${found} of ${names.length} names match a folder in Saved Games; newest first by folder time: ${ordered}`;
}

async function info() {
  const h = await handler();
  const pre = await h.IsPreGame();
  const has = await h.HasLastCheckpoint();
  const latest = await h.GetLatestSaveMetadata();
  let l = 'none';
  if (latest) {
    const quest = await latest.$get('trackedQuest');
    l = `${await latest.$get('locationName')}${quest ? `, ${quest}` : ''}, played ${((await latest.$get('playTime')) / 3600).toFixed(1)} h`;
  }
  return `handler found; IsPreGame ${pre}; HasLastCheckpoint ${has}; latest save: ${l}`;
}

async function loadPicked() {
  if (picked === '') throw new Error('Press List saves first, then pick one');
  const index = Number(picked);
  const h = await handler();
  say(`LoadSavedGame(${index}) for ${names[index]}…`);
  loadStarted = performance.now();
  lastState = '';
  const answer = await h.LoadSavedGame(index);
  return `called (answered ${JSON.stringify(answer ?? null)}); watch the state lines`;
}

async function continueGame() {
  const h = await handler();
  if (!(await h.HasLastCheckpoint())) return 'HasLastCheckpoint is false: not called';
  say(`LoadLastCheckpoint(${samePlaythrough})…`);
  loadStarted = performance.now();
  lastState = '';
  await h.LoadLastCheckpoint(samePlaythrough);
  return 'called; watch the state lines';
}

const pick = ui.select('Save', [], { placeholder: 'Press List saves first', onChange: (v) => (picked = v) });

ui.window({
  title: 'Saves spike (#57)',
  width: 640,
  height: 720,
  closable: true,
  children: [
    status,
    ui.row(ui.button('Handler', () => step('Handler', info)), ui.button('List saves', () => step('List saves', listSaves))),
    pick,
    ui.row(ui.button('Load the picked save', () => step('Load', loadPicked)), ui.button('Continue (last checkpoint)', () => step('Continue', continueGame))),
    ui.toggle('Continue: only the same playthrough', (on) => (samePlaythrough = on)),
    log,
  ],
});
say('Saves spike 0.1.1 ready');
