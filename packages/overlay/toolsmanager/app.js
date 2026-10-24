// The Tools Manager (SV3, docs/services.md): every tool an AI assistant sees through
// REDnode's MCP server, grouped by where it comes from: REDnode's own, then each mod's
// @tool functions. A switch per tool and per group takes it away from every assistant at
// once; the switches are kept across starts. Also: which assistants have connected, and
// their recent calls of mods' tools.
// Uses window.rednode.tools, which the host gives only to apps built into REDnode.
'use strict';

const $ = (id) => document.getElementById(id);

let data = null;
let current = null; // the selected tool's key
let search = '';

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function ago(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// REDnode's own tools that take the game API away from every assistant when off.
const KEY_TOOLS = new Set(['rednode:api_read', 'rednode:api_call']);

async function set(what, id, on) {
  try {
    data = await window.rednode.tools.set(what, id, on);
    render();
  } catch (err) {
    RednodeUI.notify(cleanError(err), { type: 'error', title: 'Tools Manager' });
  }
}

function sw(on, onClick, title) {
  const b = el('button', `sw${on ? ' on' : ''}`);
  b.title = title;
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(!on);
  });
  return b;
}

function matches(t) {
  if (!search) return true;
  const q = search.toLowerCase();
  return `${t.name} ${t.title} ${t.description}`.toLowerCase().includes(q);
}

function render() {
  if (!data) return;
  const list = $('list');
  list.replaceChildren();
  let total = 0;
  let on = 0;
  for (const g of data.groups) {
    const tools = g.tools.filter(matches);
    total += g.tools.length;
    on += g.tools.filter((t) => !t.off && !g.off).length;
    if (!tools.length) continue;
    const head = el('div', 'group');
    const allOn = !g.off && g.tools.every((t) => !t.off);
    head.append(sw(allOn, (v) => set('group', g.id, v), allOn ? `Switch every ${g.name} tool off` : `Switch every ${g.name} tool on`));
    head.append(el('span', '', g.name));
    head.append(el('span', 'count', `${g.tools.length} tool${g.tools.length === 1 ? '' : 's'}${g.off ? ' · off' : ''}`));
    list.append(head);
    for (const t of tools) {
      const off = t.off || g.off;
      const row = el('div', `tool${off ? ' off' : ''}${t.key === current ? ' selected' : ''}`);
      row.append(sw(!off, (v) => set('tool', t.key, v), off ? 'Switched off: no assistant sees it' : 'On: assistants see it'));
      row.append(el('span', 'tname', t.name));
      row.append(el('span', `mode ${t.readonly ? 'reads' : t.asks ? 'asks' : ''}`, t.readonly ? 'READS' : t.asks ? 'ASKS FIRST' : 'ACTS'));
      row.append(el('span', 'what', t.description.split('\n')[0]));
      row.addEventListener('click', () => {
        current = t.key;
        render();
      });
      list.append(row);
    }
  }
  if (!list.children.length) list.append(el('div', 'empty', search ? 'No tool matches.' : 'No tools.'));
  $('count').textContent = `${on} OF ${total} TOOLS ON`;

  const server = $('server');
  server.replaceChildren();
  if (data.mcp.enabled) server.append('MCP server ', el('b', '', `on, port ${data.mcp.port}`), data.mcp.external ? '' : ' (packages only: the desktop switch is off in the launcher)');
  else server.append('MCP server ', el('b', 'off', 'off'), ': switch it on in the launcher\'s settings');
  $('newoff').toggleAttribute('checked', !!data.newOff);

  renderDetails();
  const who = $('who');
  who.replaceChildren();
  if (!data.assistants.length) who.append('None yet.');
  for (const a of data.assistants) {
    const line = el('div');
    line.append(el('b', '', a.name), ` · ${a.kind === 'package' ? 'a package' : 'desktop'} · last call ${ago(a.lastSeenMs)}`);
    who.append(line);
  }
  const calls = $('calls');
  calls.replaceChildren();
  if (!data.recent.length) calls.append('None yet.');
  for (const c of data.recent) {
    const line = el('div', c.ok ? '' : 'bad');
    line.textContent = `${new Date(c.at).toLocaleTimeString()} ${c.assistant}: ${c.tool} ${c.ok ? '✓' : '✕'} ${c.ms} ms${c.detail ? ` · ${c.detail}` : ''}`;
    calls.append(line);
  }
}

function renderDetails() {
  const box = $('details');
  box.replaceChildren();
  const t = data.groups.flatMap((g) => g.tools.map((x) => ({ ...x, group: g }))).find((x) => x.key === current);
  if (!t) {
    box.append('Select a tool to see what an assistant sees.');
    return;
  }
  box.append(el('b', '', t.name));
  box.append(el('div', 'mono', `${t.group.name} · ${t.readonly ? 'only reads: runs without asking' : t.asks ? 'can change the game: the player is asked before every call' : 'acts without asking (it changes REDnode, not the game)'}`));
  box.append(el('div', '', t.description || 'No description.'));
  const params = t.params ?? Object.entries(t.input?.properties ?? {}).map(([name, s]) => ({ name, type: s.type ?? (s.enum ? s.enum.join(' | ') : 'any'), optional: !(t.input.required ?? []).includes(name), description: s.description ?? '' }));
  if (params.length) {
    for (const p of params) {
      const line = el('div', 'param');
      line.append(el('code', '', `${p.name}${p.optional ? '?' : ''}: ${p.type}`));
      if (p.description) line.append(` - ${p.description}`);
      box.append(line);
    }
  } else box.append(el('div', 'mono', 'No parameters.'));
  if (KEY_TOOLS.has(t.key)) box.append(el('div', 'warn', 'Off, this takes the game API away from every assistant, REDagent included.'));
}

async function refresh() {
  try {
    data = await window.rednode.tools.list();
    render();
  } catch (err) {
    $('details').textContent = cleanError(err);
  }
}

$('newoff').addEventListener('change', (e) => set('new-off', null, e.detail.checked));
$('search').addEventListener('input', (e) => {
  search = $('search').value ?? '';
  render();
});

refresh();
setInterval(refresh, 2000);
