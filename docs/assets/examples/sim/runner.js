// The page side of a Node mod's preview on the docs site: what the REDnode host does
// for a mod in the game. It starts the mod in a worker (boot.js), answers its calls
// from the simulated game (rednode.js), draws its ui-builder windows with the UI kit
// (as packages/overlay/builder does), and handles a mod that crashes, exits or hangs
// the way the host does: a crash or exit restarts it, at most 3 times a minute, and a
// mod that stops answering for 10 seconds is reported as not responding.
import * as host from './rednode.js';

const post = (m) => parent.postMessage({ rednodeExample: true, ...m }, '*');
const modLog = (level, text) => post({ t: 'log', level, text, source: 'mod' });
const hostLog = (level, text) => post({ t: 'log', level, text, source: 'host' });

const manifest = await fetch('rednode-app.json').then((r) => r.json());
host.useManifest(manifest, new URL('./', location.href).href);

const PING_EVERY = 2000;
const HUNG_AFTER = 10000;
const RESTARTS = 3;

let worker = null;
let lastPong = 0;
let hung = false;
let crashes = [];
let status = 'stopped';
let offs = new Map(); // listener id -> unsubscribe
let aborts = new Map(); // call id -> AbortController

const stage = document.getElementById('stage');
const windows = new Map(); // window id -> rn-window
const elements = new Map(); // node id -> { el, type }

function setStatus(s, detail) {
  status = s;
  post({ t: 'status', status: s, detail });
}

// ---------- the mod's lifecycle ----------

function start() {
  stop(true);
  hung = false;
  lastPong = Date.now();
  worker = new Worker(new URL('boot.js', import.meta.url), { type: 'module', name: new URL('mod.js', location.href).href });
  worker.onmessage = (e) => onMessage(e.data);
  worker.onerror = (e) => {
    e.preventDefault();
    ended('crash', e.message);
  };
  setStatus('starting');
}

function stop(quiet) {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const off of offs.values()) off();
  offs = new Map();
  for (const a of aborts.values()) a.abort();
  aborts = new Map();
  for (const w of windows.values()) w.remove();
  windows.clear();
  elements.clear();
  host.undoTweaks();
  host.audio.stopAll({ fadeOut: 0 });
  placeholder();
  if (!quiet) setStatus('stopped');
}

// A crash's message and the stack lines in the mod's own code, as the host keeps them.
function modFrames(error) {
  const lines = String(error).split('\n');
  const own = lines.slice(1).filter((l) => l.includes('/run/')).map((l) => l.replace(/\(?https?:\/\/[^)]*\/run\/[^/]+\/mod\.js/, '(mod.mjs').replace(/^\s+/, '    '));
  return [lines[0], ...own].join('\n');
}

// The mod ended without being asked to: a crash, process.exit or a killed process.
function ended(how, detail) {
  if (!worker) return;
  const text = {
    crash: `crashed: ${modFrames(detail)}`,
    exit: `crashed: The mod exited with code ${detail}`,
    killed: `crashed: its process ended (${detail}). Mods in it: ${manifest.name}`,
  }[how];
  modLog('error', text);
  stop(true);
  const now = Date.now();
  crashes = [...crashes, now].filter((t) => now - t < 60000);
  if (crashes.length > RESTARTS) {
    hostLog('error', `${manifest.name} crashed ${crashes.length} times in a minute; not restarting it`);
    setStatus('crashed', text);
    return;
  }
  setStatus('restarting', text);
  setTimeout(() => {
    if (!worker && status === 'restarting') start();
  }, 1500);
}

setInterval(() => {
  if (!worker) return;
  worker.postMessage({ t: 'ping' });
  if (!hung && Date.now() - lastPong > HUNG_AFTER) {
    hung = true;
    hostLog('error', `${manifest.name} is not responding`);
    setStatus('not-responding');
  }
}, PING_EVERY);

window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m?.rednodeExample || m.t !== 'control') return;
  if (m.action === 'restart' || m.action === 'start') {
    crashes = [];
    if (worker) hostLog('info', `Restarting ${manifest.name}`);
    start();
  }
  if (m.action === 'stop') stop(false);
});

// ---------- the mod's messages ----------

function encode(v) {
  if (v instanceof host.Remote) {
    const fields = {};
    for (const [k, x] of Object.entries(v.$fields)) {
      if (x && typeof x.then === 'function') {
        fields[k] = { $promise: true };
        const w = worker;
        x.then((value) => w?.postMessage({ t: 'field', ref: v.$ref, name: k, value: encode(value) }));
      } else fields[k] = encode(x);
    }
    return { $ref: v.$ref, $type: v.$type, $fields: fields };
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v;
}
function decode(v) {
  if (v && typeof v === 'object') {
    if (typeof v.$ref === 'number' && Object.keys(v).length === 1) return host.remoteByRef(v.$ref) ?? v;
    if (Array.isArray(v)) return v.map(decode);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

const roots = {
  game: host.game,
  api: host.api,
  tweakdb: host.tweakdb,
  world: host.world,
  audio: host.audio,
  kernel: host.kernel,
  archives: host.archives,
  agent: host.agent,
  ui: host.ui,
  pkg: host.pkg,
  secrets: host.secrets,
};

async function invoke(m) {
  if (m.ref) {
    const target = host.remoteByRef(m.ref);
    if (!target) throw new Error('that game object no longer exists (references are dropped when a save loads)');
    return target.invoke(m.method, decode(m.args));
  }
  let owner = null;
  let fn = roots[m.path[0]];
  for (const name of m.path.slice(1)) {
    owner = fn;
    fn = fn?.[name];
  }
  if (typeof fn !== 'function') throw new Error(`rednode.${m.path.join('.')} is not simulated on this page`);
  const args = decode(m.args);
  if (m.stream) {
    const abort = new AbortController();
    aborts.set(m.id, abort);
    const w = worker;
    return Reflect.apply(fn, owner, [args[0], { ...args[1], signal: abort.signal, onText: (text) => w?.postMessage({ t: 'stream', id: m.id, text }) }]);
  }
  // Reflect.apply: on the simulated api, any property name (even "apply") is a game function.
  return Reflect.apply(fn, owner, args);
}

function onMessage(m) {
  switch (m.t) {
    case 'loaded':
      setStatus('running');
      setTimeout(placeholder, 300);
      break;
    case 'pong':
      lastPong = Date.now();
      if (hung) {
        hung = false;
        setStatus('running');
      }
      break;
    case 'log':
      modLog(m.level, m.text);
      break;
    case 'crash':
      ended('crash', m.error);
      break;
    case 'exit':
      ended('exit', m.code);
      break;
    case 'killed':
      ended('killed', m.signal);
      break;
    case 'call': {
      const w = worker;
      Promise.resolve()
        .then(() => invoke(m))
        .then(
          (value) => w?.postMessage({ t: 'result', id: m.id, ok: true, value: encode(value) }),
          (err) => w?.postMessage({ t: 'result', id: m.id, ok: false, error: err?.message || String(err) }),
        )
        .finally(() => aborts.delete(m.id));
      break;
    }
    case 'abort':
      aborts.get(m.id)?.abort();
      break;
    case 'listen': {
      const w = worker;
      const send = (payload) => w?.postMessage({ t: 'event', id: m.id, payload: encode(payload) });
      const off = {
        game: () => host.game.on(m.name, send),
        state: () => host.game.onState(send),
        world: () => host.world.on(m.name, send),
        solo: () => host.ui.onSolo(send),
      }[m.kind]?.();
      if (off) offs.set(m.id, off);
      break;
    }
    case 'unlisten':
      offs.get(m.id)?.();
      offs.delete(m.id);
      break;
    case 'ui-open':
      openWindow(m.win, m.spec);
      break;
    case 'ui-update': {
      const found = elements.get(m.node);
      if (found) apply(found.type, found.el, m.props ?? {});
      break;
    }
    case 'ui-close':
      windows.get(m.win)?.remove();
      windows.delete(m.win);
      placeholder();
      break;
    default:
      break;
  }
}

// ---------- drawing the windows (as packages/overlay/builder/builder.js) ----------

function setText(el, props) {
  if ('text' in props) el.textContent = props.text ?? '';
  if ('tone' in props) el.dataset.tone = props.tone ?? 'normal';
  el.className = `${el.dataset.base}${el.dataset.tone && el.dataset.tone !== 'normal' ? ` tone-${el.dataset.tone}` : ''}`;
}
function attr(el, name, value) {
  if (value === undefined || value === null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}
function apply(type, el, props) {
  switch (type) {
    case 'text':
    case 'heading':
      setText(el, props);
      break;
    case 'button':
      if ('label' in props) el.textContent = props.label;
      if ('variant' in props) attr(el, 'variant', props.variant === 'primary' ? null : props.variant);
      if ('disabled' in props) attr(el, 'disabled', !!props.disabled);
      if ('sound' in props) attr(el, 'sound', props.sound);
      break;
    case 'toggle':
      if ('label' in props) attr(el, 'label', props.label);
      if ('checked' in props) el.checked = !!props.checked;
      if ('disabled' in props) attr(el, 'disabled', !!props.disabled);
      break;
    case 'slider':
      for (const k of ['label', 'min', 'max', 'step', 'unit', 'value']) if (k in props) attr(el, k, props[k]);
      break;
    case 'input':
      for (const k of ['label', 'placeholder']) if (k in props) attr(el, k, props[k]);
      if ('value' in props) attr(el, 'value', props.value ?? '');
      break;
    case 'progress':
      for (const k of ['label', 'value', 'max']) if (k in props) attr(el, k, props[k]);
      break;
    default:
      break;
  }
}
const toMod = (node, type, value) => worker?.postMessage({ t: 'ui-event', node, type, value });

function render(spec) {
  let el;
  switch (spec.type) {
    case 'text':
      el = document.createElement('div');
      el.dataset.base = 'text';
      break;
    case 'heading':
      el = document.createElement('h3');
      el.dataset.base = 'heading';
      break;
    case 'button':
      el = document.createElement('rn-button');
      el.addEventListener('click', () => toMod(spec.id, 'click'));
      break;
    case 'toggle':
      el = document.createElement('rn-toggle');
      el.addEventListener('change', (e) => toMod(spec.id, 'change', e.detail.checked));
      break;
    case 'slider':
      el = document.createElement('rn-slider');
      el.addEventListener('change', (e) => toMod(spec.id, 'change', e.detail.value));
      break;
    case 'input':
      el = document.createElement('rn-input');
      el.addEventListener('change', (e) => toMod(spec.id, 'change', e.detail.value));
      el.addEventListener('submit', (e) => toMod(spec.id, 'submit', e.detail.value));
      break;
    case 'progress':
      el = document.createElement('rn-progress');
      break;
    case 'row':
    case 'column':
      el = document.createElement('div');
      el.className = spec.type;
      break;
    default:
      el = document.createElement('div');
      el.className = 'text tone-danger';
      el.textContent = `Unknown node type: ${spec.type}`;
      return el;
  }
  apply(spec.type, el, spec.props ?? {});
  elements.set(spec.id, { el, type: spec.type });
  for (const child of spec.children ?? []) el.append(render(child));
  return el;
}

function openWindow(id, spec) {
  windows.get(id)?.remove();
  const win = document.createElement('rn-window');
  win.setAttribute('title', spec.props.title ?? '');
  attr(win, 'closable', spec.props.closable !== false);
  attr(win, 'draggable', true);
  win.style.width = `${spec.props.width}px`;
  win.style.height = `${spec.props.height}px`;
  win.addEventListener('close', (e) => {
    e.preventDefault();
    win.remove();
    windows.delete(id);
    toMod(null, 'close');
    worker?.postMessage({ t: 'ui-event', type: 'close', win: id });
    hostLog('info', `The player closed ${manifest.name}'s window`);
    placeholder();
  });
  const content = document.createElement('div');
  content.className = 'content';
  for (const child of spec.children ?? []) content.append(render(child));
  win.append(content);
  stage.append(win);
  windows.set(id, win);
  placeholder();
}

// A mod with no window shows where its output goes.
function placeholder() {
  const empty = document.getElementById('empty');
  empty.hidden = windows.size > 0;
  const text = !worker
    ? status === 'crashed'
      ? 'The mod stopped after too many crashes. Press Restart.'
      : 'The mod is stopped. Press Start.'
    : 'This mod has no window: what it does shows in the Mod log.';
  empty.textContent = text;
  requestAnimationFrame(() => post({ t: 'size', width: stage.scrollWidth, height: stage.scrollHeight }));
}

start();
