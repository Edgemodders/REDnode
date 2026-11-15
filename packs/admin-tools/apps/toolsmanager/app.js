// The Tools Manager (SV3, docs/services.md): every tool an AI assistant sees through
// REDnode's MCP server, grouped by where it comes from: REDnode's own, then each mod's
// @tool functions. A switch per tool and per group takes it away from every assistant at
// once; the switches are kept across starts. Also: which assistants have connected, and
// their recent calls of mods' tools. #22: a second switch per tool and per package, MODS, for
// calls from other packages: ON (any package), ALLOWED (only packages that list it in their
// "calls" and that the player allowed in the Mod Manager) or OFF.
// Part of the Admin Tools pack. Uses window.rednode.tools, which the host answers only
// for a package the player allowed the "admin" permission; until then the details pane
// says so.
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

// #22: the MODS switch. A tool goes on -> allowed -> off -> on; a package also has its default.
const MOD_LABEL = { on: 'MODS ON', allowed: 'ALLOWED', off: 'MODS OFF' };
const MOD_NEXT = { on: 'allowed', allowed: 'off', off: 'on' };
const MOD_TIP = {
  on: 'Mods: any package may call it',
  allowed: 'Mods: only packages you allowed in the Mod Manager (their "calls")',
  off: 'Mods: no package may call it',
};
const MOD_DETAIL = {
  on: 'any package may call it',
  allowed: 'only packages you allowed in the Mod Manager (their "calls")',
  off: 'no package may call it',
};
function modsPill(mode, onClick, title) {
  const b = el('button', `mods ${mode ?? 'none'}`, mode ? MOD_LABEL[mode] : '');
  if (!mode) {
    b.disabled = true;
    return b;
  }
  b.title = `${title ?? MOD_TIP[mode]}. Click for: ${MOD_TIP[MOD_NEXT[mode]].replace('Mods: ', '')}`;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(MOD_NEXT[mode]);
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
    // The package's own MODS switch: every tool of it at once. Its default is each tool's own.
    if (!g.builtin && g.tools.some((t) => t.mods)) {
      const shown = g.mods ?? 'default';
      const pill = el('button', `mods ${g.mods ?? ''}`, g.mods ? MOD_LABEL[g.mods] : 'MODS: DEFAULT');
      pill.title = g.mods
        ? `${MOD_TIP[g.mods]}, for every ${g.name} tool. Click for the next`
        : `Every ${g.name} tool has its default for mods (read-only ones on, the rest allowed only). Click to set them all`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = { default: 'on', on: 'allowed', allowed: 'off', off: null }[shown];
        set('mods-group', g.id, next);
      });
      head.append(pill);
    }
    list.append(head);
    for (const t of tools) {
      const off = t.off || g.off;
      const row = el('div', `tool${off ? ' off' : ''}${t.key === current ? ' selected' : ''}`);
      row.append(sw(!off, (v) => set('tool', t.key, v), off ? 'Switched off: no assistant sees it' : 'On: assistants see it'));
      row.append(el('span', 'tname', t.name));
      row.append(el('span', `mode ${t.readonly ? 'reads' : t.asks ? 'asks' : ''}`, t.readonly ? 'READS' : t.asks ? 'ASKS FIRST' : 'ACTS'));
      row.append(modsPill(t.mods, (next) => set('mods-tool', t.key, next)));
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
  $('modsnewoff').toggleAttribute('checked', !!data.modsNewOff);

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
    line.textContent = `${new Date(c.at).toLocaleTimeString()} ${c.assistant}${c.kind === 'mod' ? ' (mod)' : ''}: ${c.tool} ${c.ok ? '✓' : '✕'} ${c.ms} ms${c.detail ? ` · ${c.detail}` : ''}`;
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
  // #22: calls from other packages.
  if (t.mods) {
    const def = t.mods === t.modsDefault && !t.modsSet;
    box.append(el('div', 'mono', `Mods: ${MOD_DETAIL[t.mods]}${def ? ' (the default)' : t.modsSet ? '' : ` (set for all of ${t.group.name})`}`));
    const callers = el('div', 'callers');
    if (!t.callers.length) callers.append(el('div', 'no', 'No installed package lists it in its "calls".'));
    for (const c of t.callers) {
      const state = t.mods === 'on' ? 'may call it' : t.mods === 'off' ? 'refused (switched off)' : c.granted ? 'allowed' : 'refused until allowed in the Mod Manager';
      callers.append(el('div', c.granted || t.mods === 'on' ? '' : 'no', `${c.name}${c.as !== `${t.group.id}.${t.title}` ? ` (as ${c.as})` : ''}: ${state}`));
    }
    box.append(callers);
    if (t.modsSet) {
      const back = document.createElement('rn-button');
      back.textContent = `Back to ${t.group.mods ? `${t.group.name}'s` : 'the default'}`;
      back.addEventListener('click', () => set('mods-tool', t.key, null));
      box.append(back);
    }
  }
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
$('modsnewoff').addEventListener('change', (e) => set('mods-new-off', null, e.detail.checked));
$('search').addEventListener('input', (e) => {
  search = $('search').value ?? '';
  render();
});

refresh();
setInterval(refresh, 2000);
