// Sound spike: the in-game check of Sound Tools' SP1 (docs/sound.md).
//
// Trace: audio.trace() hooks Wwise's PostEvent (Played) and the sound lookup (Loaded). The
// window shows the rate and the latest rows; Stop writes a summary to the Mod log: the most
// posted events, with names from REDbridge's list (WolvenKit's, game 1.6) where it has them,
// how many game objects posted, and whether V's entity id is one of them (to learn what a
// Wwise game object id is in this game).
// Play: an event by name through the game (audio.event), or one sound by id through
// REDnode's engine (audio.playGame).

import { api, audio, game, kernel, ui } from 'rednode';

const names = new Map(); // Wwise id -> event name
let stopTrace = null;
let started = 0;
let posts = 0, loads = 0, failedPosts = 0, missingLoads = 0, dropped = 0;
let byEvent = new Map(); // event id -> count
let objects = new Set();
let loaded = new Map(); // sound id -> count
let recent = [];
let eventName = '';
let soundId = '';

const status = ui.text('Loading event names from REDbridge...', { tone: 'dim' });
const stats = ui.text('Not tracing.', { tone: 'dim' });
const rows = ui.text('', { tone: 'dim' });
const played = ui.text('Type an event name or a sound id, then play it.', { tone: 'dim' });
const traceButton = ui.button('Start trace', toggle);

ui.window({
  title: 'Sound spike',
  anchor: 'left',
  x: 40,
  y: 120,
  width: 520,
  height: 560,
  children: [
    status,
    traceButton,
    stats,
    rows,
    ui.input({
      placeholder: 'Event name, like ui_menu_onpress (Enter)',
      onChange: (v) => (eventName = v),
      onSubmit: (v) => {
        eventName = v;
        playEvent();
      },
    }),
    ui.button('Play event', playEvent),
    ui.input({
      placeholder: 'Sound id, like 746693166 (Enter)',
      onChange: (v) => (soundId = v),
      onSubmit: (v) => {
        soundId = v;
        playSound();
      },
    }),
    ui.button('Play sound', playSound),
    played,
  ],
});

loadNames();

async function loadNames() {
  try {
    const b = await kernel.bridge();
    const list = await b.call('sound.events');
    for (const e of list.events) names.set(e.hash >>> 0, e.name);
    status.set({ text: `${names.size} event names from REDbridge (WolvenKit's list, game ${list.gameVersion ?? '?'})`, tone: 'dim' });
    console.log(`Names: ${names.size} event names from REDbridge`);
  } catch (err) {
    status.set({ text: `No event names: ${err.message}`, tone: 'danger' });
    console.log(`Names: none (${err.message})`);
  }
}

const label = (id) => names.get(id) ?? `#${id}`;

async function toggle() {
  if (stopTrace) {
    const stop = stopTrace;
    stopTrace = null;
    await stop();
    traceButton.set({ label: 'Start trace' });
    await summary();
    return;
  }
  posts = loads = failedPosts = missingLoads = dropped = 0;
  byEvent = new Map();
  objects = new Set();
  loaded = new Map();
  recent = [];
  try {
    stopTrace = await audio.trace(onBatch);
    started = Date.now();
    traceButton.set({ label: 'Stop trace' });
    console.log('Trace: started');
  } catch (err) {
    stats.set({ text: err.message, tone: 'danger' });
    console.log(`Trace: could not start: ${err.message}`);
  }
}

function onBatch(batch) {
  dropped += batch.dropped;
  for (const p of batch.posts) {
    posts++;
    if (!p.playing) failedPosts++;
    byEvent.set(p.event, (byEvent.get(p.event) ?? 0) + 1);
    objects.add(p.object);
    recent.push(`P ${(p.ms / 1000).toFixed(1)}s ${label(p.event)} on ${p.object}${p.playing ? '' : ' (failed)'}`);
  }
  for (const l of batch.loads) {
    loads++;
    if (!l.found) missingLoads++;
    loaded.set(l.sound, (loaded.get(l.sound) ?? 0) + 1);
    recent.push(`L ${(l.ms / 1000).toFixed(1)}s sound ${l.sound}${l.found ? '' : ' (not in the index)'}`);
  }
  recent = recent.slice(-12);
  const s = Math.max(1, (Date.now() - started) / 1000);
  const named = [...byEvent.keys()].filter((id) => names.has(id)).length;
  stats.set({
    text:
      `${posts} posts (${(posts / s).toFixed(0)}/s, ${failedPosts} failed), ${byEvent.size} events (${named} named), ` +
      `${objects.size} objects; ${loads} loads (${(loads / s).toFixed(1)}/s, ${loaded.size} sounds, ${missingLoads} not in the index); ${dropped} dropped`,
    tone: 'normal',
  });
  rows.set({ text: recent.join('\n') });
}

async function summary() {
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const named = [...byEvent.keys()].filter((id) => names.has(id)).length;
  console.log(
    `Trace: ${seconds} s: ${posts} posts (${failedPosts} failed) of ${byEvent.size} events (${named} named), ` +
      `${objects.size} game objects; ${loads} loads of ${loaded.size} sounds (${missingLoads} not in the index); ${dropped} dropped`,
  );
  const top = [...byEvent].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`Trace: most posted: ${top.map(([id, n]) => `${label(id)} x${n}`).join(', ')}`);
  const unnamed = [...byEvent.keys()].filter((id) => !names.has(id)).slice(0, 15);
  if (unnamed.length) console.log(`Trace: events without a name, first ${unnamed.length}: ${unnamed.join(', ')}`);
  const topLoads = [...loaded].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`Trace: most loaded sounds: ${topLoads.map(([id, n]) => `${id} x${n}`).join(', ')}`);
  console.log(`Trace: game objects, first 20: ${[...objects].slice(0, 20).join(', ')}`);
  try {
    const player = await api.GetPlayer(game.instance);
    const entity = await player.GetEntityID();
    const text = JSON.stringify(entity);
    const hash = String(entity?.hash ?? '');
    console.log(`Trace: V's entity id ${text}; among the game objects: ${hash && objects.has(hash) ? 'yes' : 'no'}`);
  } catch (err) {
    console.log(`Trace: V's entity id not read: ${err.message}`);
  }
}

async function playEvent() {
  const name = eventName.trim();
  if (!name) return;
  try {
    await audio.event(name);
    played.set({ text: `Posted ${name}`, tone: 'normal' });
    console.log(`Play event ${name}: posted`);
  } catch (err) {
    played.set({ text: err.message, tone: 'danger' });
    console.log(`Play event ${name}: ${err.message}`);
  }
}

async function playSound() {
  const id = Number(soundId.trim());
  if (!Number.isInteger(id) || id < 0) {
    played.set({ text: 'A sound id is a whole number', tone: 'danger' });
    return;
  }
  try {
    const t0 = Date.now();
    const s = await audio.playGame(id);
    played.set({ text: `Playing sound ${id} (${s.seconds.toFixed(2)} s), started in ${Date.now() - t0} ms`, tone: 'normal' });
    console.log(`Play sound ${id}: ${s.seconds.toFixed(2)} s, started in ${Date.now() - t0} ms`);
    const end = await s.ended;
    console.log(`Play sound ${id}: ${end.why}${end.error ? ` (${end.error})` : ''}`);
  } catch (err) {
    played.set({ text: err.message, tone: 'danger' });
    console.log(`Play sound ${id}: ${err.message}`);
  }
}
