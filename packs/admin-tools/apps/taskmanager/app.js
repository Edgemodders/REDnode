// The Task Manager (SV1, docs/services.md): every running package and what it costs.
// One row per package: its Node mod's process (CPU, memory), the mod's own thread (how
// busy its event loop is, its JavaScript heap), its windows, and its game and service
// calls. End task stops it now; Restart starts it again.
// Part of the Admin Tools pack. Uses window.rednode.tasks, which the host answers only
// for a package the player allowed the "admin" permission; until then the details pane
// says so.
'use strict';

const $ = (id) => document.getElementById(id);

const STATUS = {
  starting: 'STARTING',
  running: 'RUNNING',
  stopped: 'STOPPED',
  crashed: 'CRASHED',
  'not-responding': 'NOT RESPONDING',
};

// Columns: key, label, how to read a row's value (for sorting), how to show it.
const COLUMNS = [
  ['name', 'Package', (r) => r.name.toLowerCase(), (r) => r.name],
  ['status', 'Status', (r) => statusOf(r), (r) => STATUS[statusOf(r)] ?? statusOf(r).toUpperCase()],
  ['cpu', 'CPU %', (r) => cpuOf(r) ?? -1, (r) => num(cpuOf(r), 1)],
  ['memory', 'Memory', (r) => memoryOf(r) ?? -1, (r) => (memoryOf(r) == null ? '-' : `${memoryOf(r)} MB`)],
  ['load', 'Thread', (r) => r.mod?.load ?? -1, (r) => (r.mod?.load == null ? '-' : `${Math.round(r.mod.load * 100)}%`)],
  ['heap', 'Heap', (r) => r.mod?.heapMB ?? -1, (r) => (r.mod?.heapMB == null ? '-' : `${r.mod.heapMB} MB`)],
  ['game', 'Game calls/s', (r) => r.gameCallsPerSec, (r) => `${num(r.gameCallsPerSec, 1)}${r.gameCallMs != null ? ` · ${num(r.gameCallMs, 1)} ms` : ''}`],
  ['svc', 'Service', (r) => r.serviceInPerSec + r.serviceOutPerSec, (r) => (r.service || r.serviceOutPerSec ? `${num(r.serviceInPerSec, 1)} / ${num(r.serviceOutPerSec, 1)}` : '-')],
  ['up', 'Up', (r) => r.mod?.uptimeMs ?? -1, (r) => uptime(r.mod?.uptimeMs)],
];
const NUMERIC = new Set(['cpu', 'memory', 'load', 'heap', 'game', 'svc', 'up']);

let rows = [];
let total = null;
const view = { sort: 'cpu', desc: true };
let current = null;
let every = 1000;
let paused = false;
let timer = null;

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
const num = (v, digits = 0) => (v == null ? '-' : Number(v).toFixed(digits));
function uptime(ms) {
  if (ms == null) return '-';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
function statusOf(r) {
  if (r.mod?.ended) return 'ended';
  if (r.mod) return r.mod.status;
  return r.windows.length ? 'running' : 'stopped';
}
// A mod's process plus its windows' renderers. A mod in the shared process shows the
// whole shared process (the system sees no finer): its own thread's load and heap, in
// the Thread and Heap columns, tell the mods in it apart.
function cpuOf(r) {
  const win = r.windows.reduce((n, w) => n + (w.cpuPercent ?? 0), 0);
  if (r.mod?.cpuPercent == null && !r.windows.length) return null;
  return (r.mod?.cpuPercent ?? 0) + win;
}
function memoryOf(r) {
  const win = r.windows.reduce((n, w) => n + (w.memoryMB ?? 0), 0);
  if (r.mod?.memoryMB == null && !r.windows.length) return null;
  return (r.mod?.memoryMB ?? 0) + win;
}
function heat(key, r) {
  if (key === 'load' && r.mod?.load != null) return r.mod.load > 0.8 ? 'hot' : r.mod.load > 0.3 ? 'warm' : '';
  if (key === 'cpu') {
    const c = cpuOf(r);
    return c == null ? '' : c > 50 ? 'hot' : c > 15 ? 'warm' : '';
  }
  return '';
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderHead() {
  const head = $('head');
  head.replaceChildren();
  for (const [key, label] of COLUMNS) {
    const th = el('th', `${NUMERIC.has(key) ? 'num' : ''}${view.sort === key ? ' sorted' : ''}`, `${label}${view.sort === key ? (view.desc ? ' ▾' : ' ▴') : ''}`);
    th.addEventListener('click', () => {
      if (view.sort === key) view.desc = !view.desc;
      else {
        view.sort = key;
        view.desc = NUMERIC.has(key);
      }
      render();
    });
    head.appendChild(th);
  }
}

function render() {
  renderHead();
  const col = COLUMNS.find((c) => c[0] === view.sort);
  const sorted = rows.slice().sort((a, b) => {
    const x = col[2](a);
    const y = col[2](b);
    const d = x < y ? -1 : x > y ? 1 : 0;
    return view.desc ? -d : d;
  });
  const body = $('rows');
  body.replaceChildren();
  for (const r of sorted) {
    const tr = el('tr', r.id === current ? 'selected' : '');
    for (const [key, , , show] of COLUMNS) {
      const td = el('td', `${NUMERIC.has(key) ? 'num' : ''} ${heat(key, r)}`.trim(), show(r));
      if (key === 'status') td.className = `mono st-${statusOf(r)}`;
      if (key === 'name') {
        td.textContent = '';
        td.append(el('b', '', r.name));
        if (r.mod?.process === 'shared') {
          td.append(el('span', 'dim', ' · shared'));
          td.title = 'In the shared process: CPU and memory are the whole process; Thread and Heap are this mod alone';
        }
        if (r.builtin) td.append(el('span', 'dim', ' · built in'));
      }
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => {
      current = r.id;
      render();
    });
    body.appendChild(tr);
  }
  $('empty').hidden = rows.length > 0;
  const running = rows.filter((r) => statusOf(r) === 'running').length;
  $('count').textContent = `${running} RUNNING`;
  if (total) {
    $('totals').innerHTML = '';
    $('totals').append(
      'REDnode: ',
      el('b', '', `${num(total.cpuPercent, 1)}% CPU`),
      ' · ',
      el('b', '', `${total.memoryMB} MB`),
      ` in ${total.processes} processes`,
    );
  }
  renderDetails();
}

function renderDetails() {
  const r = rows.find((x) => x.id === current);
  const what = $('what');
  what.replaceChildren();
  $('end').hidden = $('restart').hidden = !r;
  if (!r) {
    what.append('Select a row to see more, or to end it.');
    return;
  }
  what.append(el('b', '', `${r.name} ${r.version ?? ''}`.trim()));
  const lines = [];
  if (r.mod) {
    const where = r.mod.process === 'shared' ? `the shared process with ${r.mod.processMods.filter((m) => m !== r.id).join(', ') || 'no other mod'}` : r.mod.process ? 'its own process' : 'no process';
    lines.push(`Node mod in ${where}${r.mod.pid ? ` (pid ${r.mod.pid})` : ''}. Its thread: ${r.mod.load == null ? 'load unknown' : `${Math.round(r.mod.load * 100)}% busy`}, heap ${r.mod.heapMB ?? '?'} of ${r.mod.heapLimitMB ?? '?'} MB${r.mod.cpuMs != null ? `, ${(r.mod.cpuMs / 1000).toFixed(1)} s of CPU so far` : ''}.`);
    if (r.mod.ended) lines.push('Ended from here. Restart starts it again; it also starts with the next game.');
    else if (r.mod.error) lines.push(`Last error: ${r.mod.error.split('\n')[0]}`);
  }
  if (r.windows.length) lines.push(`Windows: ${r.windows.map((w) => `${w.title} ${w.memoryMB ?? '?'} MB`).join(', ')}.`);
  if (r.service) lines.push(`Service: ${r.service.functions ? r.service.functions.join(', ') || 'no functions' : 'not ready'}${r.serviceErrors ? `; ${r.serviceErrors} failed calls in the last 5 s` : ''}${r.serviceMs != null ? `; answers in ${num(r.serviceMs, 1)} ms` : ''}.`);
  for (const l of lines) what.append(el('span', '', l));
  $('end').hidden = r.builtin || statusOf(r) === 'ended' || statusOf(r) === 'stopped';
  $('restart').hidden = r.builtin || !r.mod;
}

async function refresh() {
  try {
    const list = await window.rednode.tasks.list();
    rows = list.rows;
    total = list.total;
    render();
  } catch (err) {
    $('what').textContent = cleanError(err);
  }
}

function schedule() {
  clearInterval(timer);
  timer = paused ? null : setInterval(refresh, every);
}

async function act(name, fn) {
  try {
    await fn();
  } catch (err) {
    RednodeUI.notify(cleanError(err), { type: 'error', title: name });
  }
  setTimeout(refresh, 300);
}

$('end').addEventListener('click', () => {
  const r = rows.find((x) => x.id === current);
  if (r) act('End task', () => window.rednode.tasks.end(r.id));
});
$('restart').addEventListener('click', () => {
  const r = rows.find((x) => x.id === current);
  if (r) act('Restart', () => window.rednode.tasks.restart(r.id));
});
for (const chip of document.querySelectorAll('[data-every]')) {
  chip.addEventListener('click', () => {
    every = Number(chip.dataset.every);
    for (const c of document.querySelectorAll('[data-every]')) c.classList.toggle('on', c === chip);
    schedule();
  });
}
$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').classList.toggle('on', paused);
  schedule();
});

refresh();
schedule();
