// The REDnode launcher: lists installed apps and Node mods, opens or closes
// them, and shows each mod's state, process and memory.
// Uses window.rednode.apps, which the host gives only to the launcher.
'use strict';

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const rows = new Map(); // package id -> { root, update(item) }

const STATUS = {
  starting: 'STARTING',
  running: 'RUNNING',
  stopped: 'OFF',
  crashed: 'CRASHED',
  'not-responding': 'NOT RESPONDING',
};

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function act(name, fn) {
  try {
    await fn();
  } catch (err) {
    RednodeUI.notify(cleanError(err), { type: 'error', title: name });
  }
  refresh();
}

// The message, and where it came from: the first stack line, as file:line.
function shortError(text) {
  const [message, ...stack] = text.split('\n');
  const at = stack.find((l) => /^\s*at /.test(l));
  const where = at && /([^/\\(]+:\d+):\d+\)?\s*$/.exec(at);
  return where ? `${message}\n  at ${where[1]}` : message;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Under the admin permission, as in the Mod Manager.
const ADMIN_WARNING =
  'Allow this only for a package you trust: it can end or restart any of your mods, and switch on AI tools you switched off.';

function makeRow(item) {
  const root = el('div', 'app');
  const text = el('div');
  const name = el('div', 'name', item.name);
  const meta = el('div', 'meta');
  text.append(name, meta);

  const open = document.createElement('rn-toggle');
  open.addEventListener('change', (e) => act(item.name, () => window.rednode.apps.setOpen(item.id, e.detail.checked)));
  root.append(text, open);

  if (item.description) root.append(el('div', 'desc', item.description));

  // What its "requires" asks for and the game does not have; details in the Mod Manager.
  const missing = (item.requires ?? []).filter((r) => !r.ok);
  if (missing.length) {
    const wants = (r) => `${r.name}${r.wants && r.wants !== '*' ? ` ${r.wants}` : ''}`;
    root.append(el('div', 'err', `Needs ${missing.map((r) => `${wants(r)} (${r.note})`).join(', ')}`));
  }

  // Permissions the package asks for: the player allows each one.
  const grants = new Map(); // permission name -> toggle
  for (const p of item.permissions ?? []) {
    const line = el('div', 'perm');
    line.append(el('span', 'perm-what', `Asks for ${p.what}`));
    const allow = document.createElement('rn-toggle');
    allow.setAttribute('label', 'Allowed');
    allow.addEventListener('change', (e) =>
      act(item.name, () => window.rednode.apps.grant(item.id, p.name, e.detail.checked)),
    );
    line.append(allow);
    root.append(line);
    if (p.name === 'admin') root.append(el('div', 'perm-warn', ADMIN_WARNING));
    grants.set(p.name, allow);
  }

  let update;
  if (item.mod) {
    const mod = el('div', 'mod');
    const status = el('div', 'status-line');
    const controls = el('div', 'controls');
    const shared = document.createElement('rn-toggle');
    shared.setAttribute('label', 'Shared process');
    shared.addEventListener('change', (e) =>
      act(item.name, () => window.rednode.apps.setShared(item.id, e.detail.checked)),
    );
    const restart = document.createElement('rn-button');
    restart.setAttribute('variant', 'ghost');
    restart.textContent = 'Restart';
    restart.addEventListener('click', () => act(item.name, () => window.rednode.apps.restart(item.id)));
    controls.append(shared, restart);
    const error = el('div', 'err');
    const logs = el('div', 'log');
    // Windows the player closed while the mod runs on: one line each, with Show.
    const closed = el('div', 'closed');
    mod.append(status, controls, closed, error, logs);
    root.append(mod);

    update = (it) => {
      const m = it.mod;
      const where = m.shared && m.canShare ? `shared process (${m.processMods} mod${m.processMods === 1 ? '' : 's'})` : 'own process';
      status.replaceChildren(
        el('b', `st st-${m.status}`, STATUS[m.status] ?? m.status.toUpperCase()),
        document.createTextNode(` · ${where}${m.memoryMB ? ` · ${m.memoryMB} MB` : ''}`),
      );
      shared.checked = m.shared && m.canShare;
      if (m.canShare) shared.removeAttribute('disabled');
      else shared.setAttribute('disabled', '');
      restart.hidden = !it.open;
      closed.replaceChildren(
        ...(it.closedWindows ?? []).map((win) => {
          const line = el('div', 'closed-line', it.closedWindows.length > 1 ? `Window "${win}" closed` : 'Window closed');
          const show = document.createElement('rn-button');
          show.setAttribute('variant', 'ghost');
          show.textContent = 'Show';
          show.addEventListener('click', () => act(item.name, () => window.rednode.apps.showWindow(item.id, win)));
          line.append(show);
          return line;
        }),
      );
      closed.hidden = !closed.childElementCount;
      error.textContent = m.error ? shortError(m.error) : '';
      error.hidden = !m.error;
      logs.textContent = m.log.join('\n');
      logs.hidden = !m.log.length;
    };
  }

  return {
    root,
    update(it) {
      const kind = it.app && it.mod ? 'App + Node mod' : it.mod ? 'Node mod' : it.kind === 'hud' ? 'HUD widget' : 'App';
      meta.textContent = it.builtin
        ? `${kind} · built into REDnode`
        : [kind, it.version && `v${it.version}`, it.author].filter(Boolean).join(' · ');
      open.checked = it.open;
      for (const p of it.permissions ?? []) {
        const t = grants.get(p.name);
        if (t) t.checked = p.granted;
      }
      update?.(it);
    },
  };
}

// GPU sharing on or off. Switching reopens every window.
$('gpu').addEventListener('change', async (e) => {
  const path = await window.rednode.apps.renderPath(e.detail.checked ? 'gpu' : 'cpu');
  $('gpu').checked = path === 'gpu';
  RednodeUI.notify(path === 'gpu' ? 'GPU sharing on' : 'GPU sharing off: CPU path', { title: 'Render path' });
});

// Hot reload: restart a mod, or reload an app, when its files change.
$('hot').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.hotReload(e.detail.checked);
  $('hot').checked = on;
  RednodeUI.notify(on ? 'Mods restart when their files change' : 'Hot reload off', { title: 'Hot reload' });
});

// The kernel MCP server: lets AI agents such as Claude Code use REDnode while the game runs.
$('mcp').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.mcp(e.detail.checked);
  $('mcp').checked = on;
  RednodeUI.notify(on ? 'Claude Code can reach REDnode on this PC' : 'MCP server off', { title: 'MCP server' });
});
$('mcp-copy').addEventListener('click', async () => {
  await window.rednode.apps.copyMcpCommand();
  RednodeUI.notify('Run the copied command once in a terminal to add REDnode to Claude Code', { title: 'MCP server' });
});

// Assistants that signed in and were allowed in the game (#19), each with Revoke.
function showMcpClients(list) {
  $('mcp-clients').hidden = !list.length;
  $('mcp-client-list').replaceChildren(
    ...list.map((c) => {
      const line = el('div', 'devdir');
      const name = el('span', 'path', c.name);
      name.style.direction = 'ltr';
      name.title = `${c.name}\nConnected ${new Date(c.created).toLocaleString()}${c.lastUsed ? `\nLast used ${new Date(c.lastUsed).toLocaleString()}` : ''}`;
      const revoke = document.createElement('rn-button');
      revoke.setAttribute('variant', 'ghost');
      revoke.textContent = 'Revoke';
      revoke.addEventListener('click', async () => {
        showMcpClients(await window.rednode.apps.revokeMcpClient(c.id));
        RednodeUI.notify(`${c.name} must ask again to connect`, { title: 'MCP server' });
      });
      line.append(name, revoke);
      return line;
    }),
  );
}

// Developer mode: a debug button on every window's title bar, next to close.
$('dev').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.developer(e.detail.checked);
  $('dev').checked = on;
  $('devdirs').hidden = !on;
  if (on) showDevFolders(await window.rednode.apps.devFolders());
  RednodeUI.notify(on ? 'Windows show a debug button next to close' : 'Developer mode off', { title: 'Developer mode' });
});

// Development folders (#16), under Developer mode: packages there run instead of their
// installed copies, with hot reload.
function showDevFolders(list) {
  $('devdir-list').replaceChildren(
    ...list.map((f) => {
      const line = el('div', 'devdir');
      const name = el('span', f.exists ? 'path' : 'path gone', f.dir);
      // rtl keeps the end of a long path in view; a bdi keeps its characters in order.
      name.replaceChildren(Object.assign(document.createElement('bdi'), { textContent: f.dir }));
      name.title = f.exists ? `${f.dir}\n${f.packages} package${f.packages === 1 ? '' : 's'}` : `${f.dir}\nThis folder is gone`;
      const remove = document.createElement('rn-button');
      remove.setAttribute('variant', 'ghost');
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => devFolderOp('remove', f.dir));
      line.append(name, remove);
      return line;
    }),
  );
}
async function devFolderOp(op, dir) {
  try {
    showDevFolders(await window.rednode.apps.devFolders(op, dir));
    $('devdir-error').hidden = true;
    return true;
  } catch (err) {
    $('devdir-error').textContent = cleanError(err);
    $('devdir-error').hidden = false;
    return false;
  }
}
$('devdir-input').addEventListener('submit', async (e) => {
  const dir = String(e.detail?.value ?? '').trim();
  if (!dir) return;
  if (await devFolderOp('add', dir)) {
    $('devdir-input').value = '';
    RednodeUI.notify('Its packages run from there now, with hot reload', { title: 'Development folder' });
  }
});

// Open at start: off, the game starts with only HUD widgets showing, until F10.
$('start').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.openAtStart(e.detail.checked);
  $('start').checked = on;
  RednodeUI.notify(on ? 'REDnode opens with the game' : 'Next start: only HUD widgets until you press F10', { title: 'Open at start' });
});

// Tooltips: the UI kit's, in every window. Off for players who know REDnode.
$('tips').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.tooltips(e.detail.checked);
  $('tips').checked = on;
  RednodeUI.notify(on ? 'Tooltips show after a short hover' : 'No tooltips in any window', { title: 'Tooltips' });
});

// Theme: every window that uses the UI kit follows it, unless the app chose its own.
const themeButtons = [...document.querySelectorAll('[data-theme]')];
function showTheme(name) {
  for (const b of themeButtons) {
    if (b.dataset.theme === name) b.removeAttribute('variant');
    else b.setAttribute('variant', 'ghost');
  }
}
for (const b of themeButtons) {
  b.addEventListener('click', () => act('Theme', async () => showTheme(await window.rednode.apps.theme(b.dataset.theme))));
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    $('gpu').checked = (await window.rednode.apps.renderPath()) === 'gpu';
    $('hot').checked = await window.rednode.apps.hotReload();
    showTheme(await window.rednode.apps.theme());
    $('mcp').checked = await window.rednode.apps.mcp();
    showMcpClients(await window.rednode.apps.mcpClients().catch(() => []));
    $('dev').checked = await window.rednode.apps.developer();
    $('devdirs').hidden = !$('dev').checked;
    if ($('dev').checked && !drawer.hidden) showDevFolders(await window.rednode.apps.devFolders());
    $('start').checked = await window.rednode.apps.openAtStart();
    $('tips').checked = await window.rednode.apps.tooltips();
    const state = await window.rednode.state();
    $('version').textContent = `Version ${state.version}`;
    // Solo mode: which package has the screen, and a way out.
    $('solo').hidden = !state.solo;
    $('solo-name').textContent = state.solo?.name ?? '';
    if (state.spaces) showSpaces(state.spaces);
    const all = await window.rednode.apps.list();
    // Only packages pinned to the launcher, the Mod Manager first; a crashed one shows
    // even unpinned, so an error never hides. The Mod Manager lists everything.
    const items = all
      .filter((i) => i.manager || i.inLauncher || i.mod?.status === 'crashed')
      .sort((a, b) => Number(b.manager) - Number(a.manager));
    const hidden = all.length - items.length;
    const fresh = all.filter((i) => i.isNew).length;
    $('more').hidden = !hidden && !fresh;
    $('more-text').textContent = [hidden && `${hidden} more in the Mod Manager`, fresh && `${fresh} new`].filter(Boolean).join(' · ');
    const list = $('apps');
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
      let row = rows.get(item.id);
      if (!row) {
        row = makeRow(item);
        rows.set(item.id, row);
      }
      row.update(item);
    }
    for (const [id, row] of rows) {
      if (!seen.has(id)) {
        row.root.remove();
        rows.delete(id);
      }
    }
    const order = items.map((i) => rows.get(i.id).root);
    if (order.some((r, i) => list.children[i] !== r)) list.replaceChildren(...order);
    if (!items.length) list.innerHTML = '<p class="empty">Nothing installed.</p>';
    $('count').textContent = `· ${all.filter((a) => a.open).length}/${all.length}`;
  } finally {
    refreshing = false;
  }
}

// ---------- spaces (O11) ----------
// Named sets of windows. The switcher on the tab shows once there is a second space.
let spaceState = { names: ['Main'], current: 'Main' };
let editing = null; // 'new' or 'rename'

function showSpaces(s) {
  spaceState = s ?? spaceState;
  $('space-now').textContent = spaceState.current;
  $('space-tab').textContent = spaceState.current;
  $('space-switch').hidden = spaceState.names.length < 2;
  if (spaceState.names.length < 2) $('space-delete').setAttribute('disabled', '');
  else $('space-delete').removeAttribute('disabled');
}

function spaceError(text) {
  $('space-error').textContent = text ?? '';
  $('space-error').hidden = !text;
}

function editSpace(mode) {
  editing = mode;
  spaceError(null);
  $('space-edit').hidden = false;
  $('space-input').value = mode === 'rename' ? spaceState.current : '';
  $('space-input').focus();
}

function endEdit() {
  editing = null;
  $('space-edit').hidden = true;
}

async function spaceOp(...args) {
  try {
    showSpaces(await window.rednode.apps.spaces(...args));
    spaceError(null);
    return true;
  } catch (err) {
    spaceError(cleanError(err));
    return false;
  }
}

$('space-new').addEventListener('click', () => editSpace('new'));
$('space-rename').addEventListener('click', () => editSpace('rename'));
$('space-cancel').addEventListener('click', endEdit);
$('space-delete').addEventListener('click', () => spaceOp('delete', spaceState.current));
$('space-input').addEventListener('submit', async (e) => {
  const name = String(e.detail?.value ?? '').trim();
  const ok = editing === 'rename' ? await spaceOp('rename', spaceState.current, name) : await spaceOp('create', name);
  if (ok) endEdit();
});

// The tab's switcher: the list of spaces, Ctrl+number beside each.
let spaceMenu = null;
function closeSpaceMenu() {
  spaceMenu?.remove();
  spaceMenu = null;
}
$('space-switch').addEventListener('click', (e) => {
  e.stopPropagation();
  if (spaceMenu) return closeSpaceMenu();
  spaceMenu = document.createElement('div');
  spaceMenu.className = 'rn-window-menu';
  spaceMenu.setAttribute('role', 'menu');
  spaceMenu.innerHTML = '<div class="rn-head">Spaces</div>';
  spaceState.names.forEach((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(name === spaceState.current));
    b.innerHTML = `<span></span>${name === spaceState.current ? '<span class="rn-on">&#x25CF;</span>' : ''}${i < 9 ? `<span class="key">Ctrl+${i + 1}</span>` : ''}`;
    b.querySelector('span').textContent = name;
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      closeSpaceMenu();
      await spaceOp('switch', name);
    });
    spaceMenu.append(b);
  });
  document.body.append(spaceMenu);
  const r = $('space-switch').getBoundingClientRect();
  spaceMenu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - spaceMenu.offsetWidth - 4))}px`;
  spaceMenu.style.top = `${Math.max(4, r.top - spaceMenu.offsetHeight - 4)}px`;
});
document.addEventListener('click', (e) => {
  if (spaceMenu && !spaceMenu.contains(e.target)) closeSpaceMenu();
});

$('solo-end').addEventListener('click', () => act('Solo mode', () => window.rednode.apps.endSolo()));

$('more-open').addEventListener('click', () => act('Mod Manager', () => window.rednode.apps.setOpen('modmanager', true)));

// ---------- Keys (#23, K2) ----------
// The player's AI service keys in the shared store, swapped into the drawer with a back row.
// A typed key goes to the host and is cleared from the page; only its last 4 characters come back.
let keysShown = [];
let keysExtra = []; // ids typed under "Other service" that have no file yet

function showKeysView(on) {
  $('keys-view').hidden = !on;
  $('settings-view').hidden = on;
  drawer.setAttribute('title', on ? 'Keys' : 'Settings');
  keyError(null);
  if (on) keysOp('list');
  else $('key-list').querySelectorAll('rn-input').forEach((i) => (i.value = ''));
}

function keyError(text) {
  $('key-error').textContent = text ?? '';
  $('key-error').hidden = !text;
}

async function keysOp(op, service, key) {
  try {
    keysShown = await window.rednode.apps.keys(op, service, key);
    keyError(null);
    showKeys();
    return true;
  } catch (err) {
    keyError(cleanError(err));
    return false;
  }
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

function showKeys() {
  const ids = new Set(keysShown.map((k) => k.service));
  const extra = keysExtra.filter((id) => !ids.has(id)).map((service) => ({ service, name: service, set: false, usedBy: [], known: false }));
  $('key-list').replaceChildren(...[...keysShown, ...extra].map(keyLine));
}

function button(text) {
  const b = document.createElement('rn-button');
  b.setAttribute('variant', 'ghost');
  b.textContent = text;
  return b;
}

function keyLine(k) {
  const line = el('div', 'svc');
  const top = el('div', 'top');
  const state = el('span', 'state');
  if (k.source === 'env') {
    state.textContent = `From ${k.env}`;
    state.classList.add('set');
    state.title = `The variable ${k.env} wins over the saved key while it is set`;
  } else if (k.unreadable) {
    state.textContent = 'Unreadable here';
    state.classList.add('bad');
    state.title = 'Saved by another Windows user or PC: set it again';
  } else if (k.set) {
    state.textContent = k.last4 ? `•••• ${k.last4}` : 'Set';
    state.classList.add('set');
    if (k.updated) state.title = `Saved ${new Date(k.updated).toLocaleString()}`;
  } else {
    state.textContent = 'Not set';
  }
  top.append(el('span', 'name', k.name), state);
  line.append(top);

  if (k.usedBy?.length) {
    const used = el('div', 'used', `Used by ${k.usedBy.map((u) => u.tool).join(', ')}`);
    used.title = k.usedBy.map((u) => `${u.tool}: ${ago(u.at)}`).join('\n');
    line.append(used);
  }

  const acts = el('div', 'acts');
  const edit = el('div', 'edit');
  edit.hidden = true;
  const input = document.createElement('rn-input');
  input.setAttribute('type', 'password');
  input.setAttribute('placeholder', 'Paste the key, then Enter');
  if (k.prefix) input.title = `${k.name} keys start with ${k.prefix}`;
  const cancel = button('Cancel');
  edit.append(input, cancel);

  const setBtn = button(k.set || k.unreadable ? 'Replace' : 'Set');
  setBtn.addEventListener('click', () => {
    acts.hidden = true;
    edit.hidden = false;
    input.focus();
  });
  const close = () => {
    input.value = '';
    edit.hidden = true;
    acts.hidden = false;
  };
  cancel.addEventListener('click', close);
  // Saving encrypts through Windows (DPAPI), about a second: the box goes while it runs.
  const busy = el('div', 'busy', 'Encrypting the key…');
  busy.hidden = true;
  input.addEventListener('submit', async (e) => {
    const key = String(e.detail?.value ?? '').trim();
    input.value = '';
    if (!key) return;
    edit.hidden = true;
    busy.hidden = false;
    if (await keysOp('set', k.service, key)) {
      keysExtra = keysExtra.filter((id) => id !== k.service);
      RednodeUI.notify(`Every EDGE tool now uses this ${k.name} key`, { title: 'Keys' });
    } else {
      busy.hidden = true;
      edit.hidden = false;
      input.focus();
    }
  });
  acts.append(setBtn);

  // Remove asks once more, since it removes the key for every tool.
  if (k.updated) {
    const remove = button('Remove');
    let armed = null;
    remove.addEventListener('click', async () => {
      if (!armed) {
        remove.textContent = 'Remove for all tools?';
        armed = setTimeout(() => {
          armed = null;
          remove.textContent = 'Remove';
        }, 4000);
        return;
      }
      clearTimeout(armed);
      acts.hidden = true;
      busy.textContent = 'Removing the key…';
      busy.hidden = false;
      if (await keysOp('remove', k.service)) RednodeUI.notify(`${k.name} key removed`, { title: 'Keys' });
      else {
        busy.hidden = true;
        acts.hidden = false;
        remove.textContent = 'Remove';
        armed = null;
      }
    });
    acts.append(remove);
  }
  line.append(acts, edit, busy);
  return line;
}

// A key, not a name: long, a key's own prefix, or a long run of digits or mixed case.
function keyLikeId(id) {
  return id.length > 24 || /^(sk-|sk_|aiza)/i.test(id) || /\d{6}/.test(id) || (/[a-z]/.test(id) && /[A-Z]/.test(id) && /\d/.test(id));
}

$('keys-open').addEventListener('click', () => showKeysView(true));
$('keys-back').addEventListener('click', () => showKeysView(false));
$('key-other').addEventListener('submit', (e) => {
  const id = String(e.detail?.value ?? '').trim();
  if (!id) return;
  // A key pasted here by mistake would become a file name and a log line: refuse it and clear
  // the box, which shows its text. The host refuses it too (keyLikeId in main.js).
  if (keyLikeId(id)) {
    $('key-other').value = '';
    return keyError("That looks like a key, not a service id. Type the service's name here (like my-tool), then paste the key on its line");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) return keyError('A service id is 1 to 24 lowercase letters, digits or dashes, like my-tool');
  $('key-other').value = '';
  if (!keysExtra.includes(id)) keysExtra.push(id);
  keyError(null);
  showKeys();
});

// The settings drawer, on the right of the panel: the gear opens and closes it, and so do
// its own close button and the panel closing.
const drawer = $('drawer');
function showDrawer(on) {
  if (!on && !$('keys-view').hidden) showKeysView(false);
  drawer.hidden = !on;
  if (on && $('dev').checked) window.rednode.apps.devFolders().then(showDevFolders, () => {});
  $('gear').setAttribute('aria-expanded', String(on));
  if (on) $('gear').removeAttribute('variant');
  else $('gear').setAttribute('variant', 'ghost');
}
$('gear').addEventListener('click', () => showDrawer(drawer.hidden));
drawer.addEventListener('close', () => showDrawer(false)); // a drawer's close hides only it

$('toggle').addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  if (panel.hidden) showDrawer(false);
  else refresh();
});

// Keep memory and state current while the list is open.
setInterval(() => {
  if (!panel.hidden) refresh();
}, 2000);

function showLink(on) {
  $('link').textContent = on ? 'LINKED' : 'OFF';
  $('link').className = on ? '' : 'off';
}

window.rednode.on((m) => {
  if (m.event === 'apps') refresh();
  if (m.event === 'state') showLink(m.state.connected);
});

window.rednode.state().then((s) => showLink(s.connected));
refresh();
