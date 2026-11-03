// The UI Workbench's Edit and Projects tabs (UT3a, docs/ink.md "UT3 Workbench: plan").
//
// A project is a REDnode package in Documents\REDnode\UI projects, which the host makes and
// watches as a development folder (admin.projectsFolder). This page's own service
// (service.mjs) reads and writes the files; Run switches the project's package on
// (admin.setOpen), so it runs as the modder's mod will, in a Node mod of its own; saving while
// it runs restarts it (admin.restartTask). The markup is checked as it is typed with ink.check,
// the script with acorn, and each error is shown at its line.
import { admin, ink, service, ui } from 'rednode';
import * as E from './vendor/editor.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
// Status lines are cut at their end when the window is narrow: the whole text is the tooltip.
const editStatus = (text) => {
  $('editStatus').textContent = text;
  $('editStatus').title = text;
  console.log(`[ui-workbench] ${text}`);
};
const projStatus = (text) => {
  $('projStatus').textContent = text;
  $('projStatus').title = text;
  console.log(`[ui-workbench] ${text}`);
};

// ---------- tabs ----------
const panes = { Inspect: $('tabInspect'), Edit: $('tabEdit'), Projects: $('tabProjects') };
// The tabs' change shows its pane; showTab switches from code, through the tabs, so their
// row shows the right one.
$('tabs').addEventListener('change', (e) => {
  const label = e.detail?.label;
  for (const [name, pane] of Object.entries(panes)) pane.hidden = name !== label;
  if (label === 'Projects') listProjects();
  if (label === 'Edit') ensureEditors();
});
function showTab(label) {
  const index = Object.keys(panes).indexOf(label);
  if (!panes[label].hidden) return;
  $('tabs').select(index);
}

// ---------- the projects folder and the service ----------
let root = null;
let files = null;
async function ready() {
  if (!root) root = await admin.projectsFolder('UI projects');
  if (!files) files = await service.connect('ui-workbench');
  $('projFolder').textContent = `Projects are in ${root}: REDnode watches it, as the apps folder.`;
  $('projFolder').title = $('projFolder').textContent;
  return { root, files };
}
const needsAdmin = (err) =>
  /admin permission/.test(err.message)
    ? 'Edit and Projects need the admin permission: allow it for UI Workbench in the Mod Manager (Permissions), then open this tab again.'
    : err.message;

// Which packages run now, by id (the Task Manager's list).
let running = new Set();
async function readRunning() {
  try {
    const { rows } = await admin.tasks();
    running = new Set(rows.filter((r) => r.mod && r.mod.status === 'running').map((r) => r.id));
  } catch {
    // without the admin permission nothing runs from here
  }
  return running;
}

// ---------- Projects ----------
let current = null; // the open project: { id, name, dir }
let dirty = false;

async function listProjects() {
  const box = $('projects');
  let list;
  try {
    const { root: r, files: f } = await ready();
    list = await f.list(r);
    await readRunning();
  } catch (err) {
    box.replaceChildren(el('div', 'empty', needsAdmin(err)));
    projStatus('');
    return;
  }
  box.replaceChildren();
  if (!list.length) box.append(el('div', 'empty', 'No project yet: type a name above and press New.'));
  for (const p of list) box.append(projectRow(p));
  projStatus(`${list.length} project${list.length === 1 ? '' : 's'}`);
}

function projectRow(p) {
  const row = el('div', `projrow${current?.id === p.id ? ' open' : ''}`);
  const name = el('span', 'pname', p.name);
  const meta = el('span', 'pmeta', `${p.id} · ${new Date(p.modified).toLocaleString()}`);
  row.append(name, meta);
  if (running.has(p.id)) row.append(el('span', 'running', 'running'));
  const button = (label, fn, variant = 'ghost') => {
    const b = el('rn-button', '', label);
    if (variant) b.setAttribute('variant', variant);
    b.addEventListener('click', fn);
    row.append(b);
    return b;
  };
  button('Open', () => openProject(p.id), null);
  button('Export', () => exportProject(p), null);
  button('Rename', () => {
    const input = el('rn-input');
    input.setAttribute('value', p.name);
    name.replaceWith(input);
    input.addEventListener('submit', async (e) => {
      try {
        await files.rename(root, p.id, String(e.detail?.value ?? input.value));
        if (current?.id === p.id) setCurrent({ ...current, name: String(e.detail?.value ?? input.value) });
        listProjects();
      } catch (err) {
        projStatus(err.message);
      }
    });
    input.focus?.();
  });
  // Delete asks twice: the project goes to the folder's .trash, where it can be taken back.
  const del = button('Delete', async () => {
    if (del.textContent !== 'Sure?') {
      del.textContent = 'Sure?';
      setTimeout(() => (del.textContent = 'Delete'), 3000);
      return;
    }
    try {
      if (running.has(p.id)) await admin.setOpen(p.id, false);
      const r = await files.remove(root, p.id);
      if (current?.id === p.id) closeProject();
      projStatus(`Moved ${p.name} to ${r.movedTo}`);
      listProjects();
    } catch (err) {
      projStatus(err.message);
    }
  }, 'danger');
  return row;
}

$('newProject').addEventListener('click', newProject);
$('newName').addEventListener('submit', newProject);
async function newProject() {
  const name = String($('newName').value ?? '').trim();
  try {
    const { root: r, files: f } = await ready();
    const p = await f.create(r, name);
    $('newName').value = '';
    projStatus(`Made ${p.name} in ${p.dir}`);
    await openProject(p.id);
  } catch (err) {
    projStatus(needsAdmin(err));
  }
}

// ---------- the splitter between the editors ----------

// The markup's share of the width, 0.15 to 0.85, kept in the page's localStorage.
const SPLIT_KEY = 'ui-workbench:editSplit';
function setSplit(share) {
  const left = Math.min(0.85, Math.max(0.15, share));
  const grid = document.querySelector('.editsplit');
  grid.style.setProperty('--left', `${left}fr`);
  grid.style.setProperty('--right', `${1 - left}fr`);
  return left;
}
{
  const bar = $('editSplitter');
  let drag = null;
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    if (saved) setSplit(saved);
  } catch {
    // storage is a convenience
  }
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture?.(e.pointerId);
    const r = bar.parentElement.getBoundingClientRect();
    drag = { left: r.left, width: r.width - bar.offsetWidth, share: null };
    bar.classList.add('on');
  });
  bar.addEventListener('pointermove', (e) => {
    if (drag) drag.share = setSplit((e.clientX - drag.left - bar.offsetWidth / 2) / drag.width);
  });
  const end = () => {
    if (!drag) return;
    const { share } = drag;
    drag = null;
    bar.classList.remove('on');
    if (share === null) return;
    try {
      localStorage.setItem(SPLIT_KEY, String(share));
    } catch {
      // storage is a convenience
    }
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('lostpointercapture', end);
  bar.addEventListener('dblclick', () => {
    setSplit(0.5);
    try {
      localStorage.removeItem(SPLIT_KEY);
    } catch {
      // storage is a convenience
    }
  });
}

// ---------- Edit ----------
let markupView = null;
let scriptView = null;

// The names the markup's on... attributes may use: the functions the script declares, and the
// keys of its handlers object. A guess from the text; the mod's own ink.load checks for real.
function handlerNames(script) {
  const names = new Set();
  for (const m of script.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  const obj = script.match(/handlers\s*=\s*\{([\s\S]*?)\}/);
  if (obj) for (const m of obj[1].matchAll(/(?:^|,)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?=[,:(}]|$)/g)) names.add(m[1]);
  return [...names];
}

function place(doc, line, column) {
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  return Math.min(l.from + Math.max(0, column - 1), l.to);
}

const theme = E.EditorView.theme(
  {
    '&': { color: 'var(--rn-fg)', backgroundColor: 'var(--rn-bg)', fontSize: '13px', height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--rn-mono)', lineHeight: '1.5', fontVariantLigatures: 'none' }, // <!-- as written, not an arrow
    '.cm-content': { caretColor: 'var(--rn-accent)' },
    '.cm-gutters': { backgroundColor: 'var(--rn-panel)', color: 'var(--rn-dim)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, .035)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, .06)', color: 'var(--rn-fg)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--rn-accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(25, 243, 255, .22)' },
    '.cm-tooltip': { backgroundColor: 'var(--rn-panel)', border: '1px solid var(--rn-line)', color: 'var(--rn-fg)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--rn-accent)', color: 'var(--rn-on-accent)' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--rn-danger)' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--rn-danger)' },
  },
  { dark: true },
);
const highlight = E.syntaxHighlighting(
  E.HighlightStyle.define([
    { tag: [E.tags.keyword, E.tags.controlKeyword, E.tags.moduleKeyword], color: '#ff6b9a' },
    { tag: [E.tags.tagName, E.tags.angleBracket], color: '#19f3ff' },
    { tag: E.tags.attributeName, color: '#fcee0a' },
    { tag: [E.tags.string, E.tags.attributeValue], color: '#5dffa1' },
    { tag: [E.tags.comment, E.tags.lineComment, E.tags.blockComment], color: '#8a93a8', fontStyle: 'italic' },
    { tag: [E.tags.number, E.tags.bool, E.tags.null], color: '#ffb86b' },
    { tag: [E.tags.propertyName, E.tags.definition(E.tags.variableName)], color: '#c9cfdd' },
  ]),
);

// Completion of ink markup's own tags and attributes, from the rednode package's table.
function markupTags() {
  const extraTags = {};
  const tags = ink.markupTags();
  const containers = Object.keys(tags).filter((t) => t !== 'mount');
  for (const [tag, attrs] of Object.entries(tags)) {
    extraTags[tag] = { attrs: Object.fromEntries(attrs.filter((a) => a !== 'on').map((a) => [a, null])), children: containers };
  }
  return extraTags;
}

const markupLint = E.linter(
  (view) => {
    const doc = view.state.doc;
    const err = ink.check(doc.toString(), handlerNames(scriptView?.state.doc.toString() ?? ''), 'panel.ink.html');
    $('markupError').textContent = err ? `line ${err.line}: ${err.reason}` : '';
    if (!err) return [];
    const from = place(doc, err.line, err.column);
    return [{ from, to: Math.min(from + 1, doc.length), severity: 'error', message: err.reason }];
  },
  { delay: 350 },
);

const scriptLint = E.linter(
  (view) => {
    const doc = view.state.doc;
    try {
      E.parseScript(doc.toString(), { ecmaVersion: 'latest', sourceType: 'module' });
      $('scriptError').textContent = '';
      return [];
    } catch (err) {
      const reason = String(err.message).replace(/\s*\(\d+:\d+\)$/, '');
      const line = err.loc?.line ?? 1;
      $('scriptError').textContent = `line ${line}: ${reason}`;
      const from = Math.min(err.pos ?? 0, doc.length);
      return [{ from, to: Math.min(from + 1, doc.length), severity: 'error', message: reason }];
    }
  },
  { delay: 350 },
);

function editor(parent, language, lint) {
  return new E.EditorView({
    parent,
    // The page's document, not rn-window's shadow root, which CodeMirror finds by walking up
    // through the slot: its styles went there and missed the editor, which is in the page.
    root: document,
    state: E.EditorState.create({
      doc: '',
      extensions: [
        E.basicSetup,
        E.keymap.of([E.indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => (save(), true) }]),
        language,
        lint,
        E.lintGutter(),
        theme,
        highlight,
        E.EditorView.updateListener.of((u) => {
          if (u.docChanged && !loading) setDirty(true);
        }),
      ],
    }),
  });
}

function ensureEditors() {
  if (markupView) return;
  markupView = editor($('markupEditor'), E.html({ extraTags: markupTags(), autoCloseTags: true }), markupLint);
  scriptView = editor($('scriptEditor'), E.javascript(), scriptLint);
}

let loading = false;
function setDoc(view, text) {
  loading = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  loading = false;
}

function setDirty(on) {
  dirty = on;
  $('editName').textContent = current ? `${current.name}${dirty ? ' •' : ''}` : 'No project open';
}

function setCurrent(p) {
  current = p;
  for (const id of ['save', 'run', 'stop', 'export']) $(id).toggleAttribute('disabled', !p);
  setDirty(dirty);
}

function closeProject() {
  setCurrent(null);
  if (markupView) {
    setDoc(markupView, '');
    setDoc(scriptView, '');
  }
  setDirty(false);
}

async function openProject(id) {
  try {
    const { root: r, files: f } = await ready();
    const p = await f.read(r, id);
    showTab('Edit');
    ensureEditors();
    setDoc(markupView, p.markup);
    setDoc(scriptView, p.script);
    setCurrent({ id: p.id, name: p.name, dir: p.dir });
    setDirty(false);
    await readRunning();
    editStatus(running.has(p.id) ? `${p.name} is running: Save shows each change in the game` : `Opened ${p.name}`);
  } catch (err) {
    projStatus(needsAdmin(err));
  }
}

async function save() {
  if (!current) return false;
  try {
    await files.save(root, current.id, { markup: markupView.state.doc.toString(), script: scriptView.state.doc.toString() });
    setDirty(false);
    await readRunning();
    if (running.has(current.id)) {
      await admin.restartTask(current.id);
      editStatus(`Saved and restarted ${current.name}`);
    } else editStatus(`Saved ${current.name}`);
    return true;
  } catch (err) {
    editStatus(needsAdmin(err));
    return false;
  }
}

// Run: save, then switch the project's package on; a project made a moment ago is found by
// REDnode within a second or two, so "No package" is asked again for a while.
async function run() {
  if (!current) return;
  // Saved only with unsaved changes: a save is a change REDnode's hot reload restarts the
  // package for, which started a project twice (UT3b's run).
  const changed = dirty;
  if (changed) {
    if (!(await save())) return;
  } else {
    await readRunning();
  }
  if (running.has(current.id)) {
    if (!changed) editStatus(`${current.name} already runs in the game`);
    return; // a save restarted it
  }
  editStatus(`Starting ${current.name}...`);
  for (let i = 0; i < 20; i++) {
    try {
      await admin.setOpen(current.id, true);
      editStatus(`${current.name} runs in the game. Its output and any crash are in the Mod log.`);
      return;
    } catch (err) {
      if (!/No package/.test(err.message)) {
        editStatus(needsAdmin(err));
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  editStatus(`REDnode did not find ${current.id} in ${root}: check that the folder is watched (the launcher's Settings, Development folders)`);
}

async function stop() {
  if (!current) return;
  try {
    await admin.setOpen(current.id, false);
    running.delete(current.id);
    editStatus(`Stopped ${current.name}`);
  } catch (err) {
    editStatus(needsAdmin(err));
  }
}

// For checks (the mock game's) and the window debugger: the two editors.
// To source (UT3b): a project from the markup and script the Inspect tab wrote, under the first
// free name (Name, Name 2, ...), opened in Edit.
async function fromSource(name, files) {
  const { root: r, files: f } = await ready();
  for (let n = 1; n <= 50; n++) {
    const tryName = n === 1 ? name : `${name} ${n}`;
    try {
      const p = await f.create(r, tryName, files);
      await openProject(p.id);
      editStatus(`Made ${p.name} from the game's widgets: Run shows the copy beside the original`);
      return p;
    } catch (err) {
      if (!/already/.test(String(err?.message))) throw new Error(needsAdmin(err));
    }
  }
  throw new Error(`There are 50 projects named ${name} already`);
}

window.uiWorkbenchEdit = { markup: () => markupView, script: () => scriptView, current: () => current, fromSource };

$('save').addEventListener('click', save);
$('run').addEventListener('click', run);
$('export').addEventListener('click', () => current && exportProject(current));

// Export (UT3c): the project as a zip in Documents\REDnode\UI exports, laid out as the game
// folder, so a player extracts it there or adds it to a mod manager. Unsaved changes are saved
// first; the zip's path is copied.
async function exportProject(p) {
  const say = (text) => (panes.Edit.hidden ? projStatus(text) : editStatus(text));
  try {
    if (current?.id === p.id && dirty && !(await save())) return;
    const { root: r, files: f } = await ready();
    const out = await f.exportZip(r, p.id);
    await ui.copy(out.file).catch(() => {});
    say(`Exported ${p.name}: ${out.file} (${out.files} files, ${Math.max(1, Math.round(out.bytes / 1024))} KB). The path is copied.`);
  } catch (err) {
    say(needsAdmin(err));
  }
}
$('stop').addEventListener('click', stop);
