// The Pins window (#43, WP3): every pin in the world, Drop a pin here, Go there, and the player's
// pin sets. Built into the host, so it may use window.rednode.pinWindow.
'use strict';

const $ = (id) => document.getElementById(id);
const pw = window.rednode.pinWindow;
let state = { pins: [], sets: [], clicks: false, hideAll: false, game: false };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const distanceText = (d) => (d === null || d === undefined ? '' : d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`);

async function act(what, fn) {
  try {
    return await fn();
  } catch (err) {
    RednodeUI.notify(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { title: what, type: 'error' });
    return undefined;
  } finally {
    refresh();
  }
}

function pinRow(p) {
  const row = el('div', `pin${p.hidden || state.hideAll ? ' hidden' : ''}`);
  const dot = el('span', 'dot');
  dot.style.color = p.color;
  const mid = el('div');
  const title = el('div', 'title', p.title);
  title.title = p.text ? `${p.title}: ${p.text}` : p.title;
  const from = p.kind === 'set' ? `Set: ${p.from}` : p.kind === 'assistant' ? 'From an assistant' : `From ${p.from}${p.set ? ` · ${p.set}` : ''}`;
  mid.append(title, el('div', 'sub', [p.text, from, p.hidden ? 'hidden' : ''].filter(Boolean).join(' · ')));
  const right = el('div', 'row small');
  right.append(el('span', 'dist', p.placed ? distanceText(p.distance) : 'not found yet'));
  const go = el('rn-button', 'small', 'Go there');
  go.setAttribute('variant', 'ghost');
  go.title = p.placed ? 'Moves V beside the pin, facing it' : 'Its entity has not been found yet';
  if (!p.placed || !state.game) go.setAttribute('disabled', '');
  go.addEventListener('click', () => act(p.title, () => pw.go(p.id)));
  right.append(go);
  const x = el('button', 'x', '✕');
  if (p.kind === 'set') {
    x.title = `Remove it from ${p.from} (and its file)`;
    x.addEventListener('click', () => act(p.title, () => pw.remove(p.id)));
  } else {
    x.disabled = true;
  }
  row.append(dot, mid, right, x);
  return row;
}

function setRow(s) {
  const row = el('div', 'set');
  const toggle = el('rn-toggle');
  toggle.checked = s.shown;
  toggle.title = s.shown ? 'Shown in the world' : 'Hidden';
  toggle.addEventListener('change', (e) => act(s.name, () => pw.sets('show', s.file, e.detail.checked)));
  const mid = el('div');
  const title = el('div', 'title', s.name);
  title.title = s.file;
  mid.append(title, el('div', s.error ? 'sub err' : 'sub', s.error ?? `${s.count} pin${s.count === 1 ? '' : 's'} · ${s.own ? 'in REDnode\'s folder' : s.file}`));
  const tag = s.current ? el('span', 'current', 'IN USE') : el('button', 'use', 'USE');
  if (!s.current) {
    tag.title = 'Drop a pin here adds to this set';
    tag.addEventListener('click', () => act(s.name, () => pw.sets('current', s.file)));
  }
  const x = el('button', 'x', '✕');
  x.title = s.own ? 'Take it off the list (its file stays in REDnode\'s pins folder)' : 'Take it off the list (its file stays)';
  x.addEventListener('click', () => act(s.name, () => pw.sets('forget', s.file)));
  row.append(toggle, mid, tag, x);
  return row;
}

function render() {
  const q = $('filter').value.trim().toLowerCase();
  const pins = state.pins
    .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.text ?? '').toLowerCase().includes(q) || p.from.toLowerCase().includes(q))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.title.localeCompare(b.title));
  const list = $('pins');
  const top = list.scrollTop;
  list.replaceChildren(...(pins.length ? pins.map(pinRow) : [el('div', 'empty', state.pins.length ? `No pin matches "${q}".` : 'No pins yet. Drop one here, or a mod or an assistant drops them with world.pin.')]));
  list.scrollTop = top;
  $('count').textContent = `${state.pins.length} PIN${state.pins.length === 1 ? '' : 'S'}${state.hideAll ? ' · ALL HIDDEN' : ''}`;
  $('sets').replaceChildren(...(state.sets.length ? state.sets.map(setRow) : [el('div', 'empty', 'No sets yet. Drop a pin here makes "My pins".')]));
  $('clicks').checked = state.clicks;
  $('hideAll').checked = state.hideAll;
  $('clicksNote').hidden = !state.clicks;
  const drop = $('drop');
  drop.toggleAttribute('disabled', !state.game);
  drop.title = state.game ? `Drops a pin at V's feet, in ${state.sets.find((s) => s.current)?.name ?? 'a new set, My pins'}` : 'Load a save first';
}

let busy = false;
let shownKey = '';
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    state = await pw.state();
    // Drawn again only on a change a player would see (distances to the metre), so a hover or a
    // tooltip is not lost every second.
    const key = JSON.stringify({ ...state, pins: state.pins.map((p) => ({ ...p, distance: p.distance === null ? null : Math.round(p.distance) })) });
    if (key === shownKey) return;
    shownKey = key;
    render();
  } catch {
    // The host is restarting.
  } finally {
    busy = false;
  }
}

async function dropHere() {
  const title = $('title').value.trim();
  const r = await act('Drop a pin here', () => pw.drop({ title }));
  if (r) {
    $('title').value = '';
    RednodeUI.notify(`"${r.title}" dropped`, { title: 'Pins' });
  }
}

$('drop').addEventListener('click', dropHere);
$('title').addEventListener('submit', dropHere);
$('filter').addEventListener('input', () => render());
$('clicks').addEventListener('change', (e) => act('Click a pin to go there', () => pw.sets('options', { clicks: e.detail.checked })));
$('hideAll').addEventListener('change', (e) => act('Hide all', () => pw.sets('options', { hideAll: e.detail.checked })));
$('create').addEventListener('click', async () => {
  const name = $('newName').value.trim();
  if (!name) return RednodeUI.notify('Type a name for the set first', { title: 'New set' });
  if (await act('New set', () => pw.sets('create', name))) $('newName').value = '';
});
const openSet = async () => {
  const file = $('openPath').value.trim();
  if (!file) return RednodeUI.notify('Type or paste the full path of a .pins.json file', { title: 'Open' });
  const r = await act('Open', () => pw.sets('open', file));
  if (r) {
    $('openPath').value = '';
    RednodeUI.notify(r.already ? 'Already in the list: shown' : `${r.count} pin${r.count === 1 ? '' : 's'} shown`, { title: 'Open' });
  }
};
$('open').addEventListener('click', openSet);
$('openPath').addEventListener('submit', openSet);

refresh();
setInterval(refresh, 1000);
