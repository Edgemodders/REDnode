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
  clearInk(); // the host removes a stopped mod's ink
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
        trace: () => {
          let stop = null;
          host.audio.trace(send).then((s) => (stop = s));
          return () => stop?.();
        },
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
    case 'ink':
      for (const op of m.ops ?? []) inkOp(op);
      placeholder();
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
    case 'list':
      if ('keep' in props) el.dataset.keep = String(props.keep ?? 500);
      if ('follow' in props) el.dataset.follow = props.follow === false ? 'no' : 'yes';
      if ('height' in props) {
        el.style.height = props.height ? `${Number(props.height)}px` : '';
        el.classList.toggle('fill', !props.height);
      }
      if ('lines' in props) {
        el.replaceChildren();
        addLines(el, props.lines ?? [], true);
      }
      if ('push' in props) addLines(el, props.push ?? [], false);
      break;
    default:
      break;
  }
}
// ui.list's lines, as builder.js adds them.
function addLines(el, lines, toEnd) {
  const atEnd = toEnd || el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'line';
    div.textContent = String(line);
    frag.append(div);
  }
  el.append(frag);
  const keep = Number(el.dataset.keep) || 500;
  while (el.childElementCount > keep) el.firstElementChild.remove();
  if (atEnd && el.dataset.follow !== 'no') el.scrollTop = el.scrollHeight;
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
    case 'list':
      el = document.createElement('div');
      el.className = 'list fill';
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
  apply(spec.type, el, spec.type === 'list' ? { height: undefined, ...spec.props } : spec.props ?? {});
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
  for (const list of win.querySelectorAll('.list')) list.scrollTop = list.scrollHeight;
  windows.set(id, win);
  placeholder();
}

// ---------- ink ----------
// The game draws a mod's ink tree on its own HUD. Here a 16:9 box stands for the screen, and
// the page draws what the plugin would build from the package's batches (ink.apply): the
// same props, read as CSS. Units: the HUD layer's, 1920 across here (unverified against the
// game's, which follows the screen: 2560 on a 2560x1440 one).

const INK_UNITS = 1920;
// The game's MainColors, as sRGB (its HDR values clipped), for bound colors.
const INK_GAME_COLORS = {
  'MainColors.Red': '#ff6159', 'MainColors.Blue': '#5ef6ff', 'MainColors.Yellow': '#ffd741', 'MainColors.Green': '#1ded83',
  'MainColors.Warning': '#f86a32', 'MainColors.ActiveRed': '#ff7167', 'MainColors.Grey': '#a09a96', 'MainColors.White': '#ffffff',
  'MainColors.Fullscreen_PrimaryBackgroundDarkest': 'rgba(13, 14, 23, 0.9)',
};
const INK_ANCHORS = {
  TopLeft: [0, 0], TopCenter: [0.5, 0], TopRight: [1, 0], CenterLeft: [0, 0.5], Centered: [0.5, 0.5], CenterRight: [1, 0.5],
  BottomLeft: [0, 1], BottomCenter: [0.5, 1], BottomRight: [1, 1],
};
const INK_SELF = { Left: 'flex-start', Top: 'flex-start', Center: 'center', Right: 'flex-end', Bottom: 'flex-end', Fill: 'stretch' };
const INK_GAME_TEXT = { 'LocKey#15396': 'Inventory', 'UI-ResourceExports-Inventory': 'Inventory' };
const inkMounts = new Map(); // mount key -> { el }
const inkNodes = new Map(); // "mount/key" -> { el, tag, props, parent, mount }
let inkHud = null;
let inkTimer = null;

const inkScale = () => (inkHud?.clientWidth || 640) / INK_UNITS;
const inkRgba = (c) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
const inkParentTag = (n) => (n.parent ? inkNodes.get(`${n.mount}/${n.parent}`)?.tag : 'canvas');

function inkStyle(n) {
  const k = inkScale();
  const p = n.props;
  const el = n.el;
  const panel = inkParentTag(n);
  const inPanel = panel === 'column' || panel === 'row';
  if (n.tag === 'column' || n.tag === 'row') {
    el.style.display = 'flex';
    el.style.flexDirection = n.tag === 'column' ? 'column' : 'row';
    el.style.alignItems = 'flex-start';
  }
  if (n.tag === 'canvas') el.style.position = 'relative';
  if (!inPanel && p.anchor) {
    el.style.position = 'absolute';
    if (p.anchor === 'Fill') {
      el.style.left = el.style.top = el.style.translate = '';
      el.style.inset = '0';
    } else {
      const [ax, ay] = INK_ANCHORS[p.anchor] ?? [0, 0];
      const [px, py] = p.anchorPoint ?? [0, 0];
      const [tx, ty] = p.translation ?? [0, 0];
      el.style.left = `${ax * 100}%`;
      el.style.top = `${ay * 100}%`;
      el.style.translate = `calc(${-px * 100}% + ${tx * k}px) calc(${-py * 100}% + ${ty * k}px)`;
    }
  }
  if (inPanel) {
    el.style.alignSelf = INK_SELF[panel === 'column' ? p.hAlign : p.vAlign] ?? '';
    el.style.flexGrow = p.sizeRule === 'Stretch' ? String(p.sizeCoefficient ?? 1) : '';
    if (p.margin) el.style.margin = [p.margin[1], p.margin[2], p.margin[3], p.margin[0]].map((v) => `${v * k}px`).join(' ');
  }
  if (p.padding) el.style.padding = [p.padding[1], p.padding[2], p.padding[3], p.padding[0]].map((v) => `${v * k}px`).join(' ');
  if (p.size && p.anchor !== 'Fill') {
    if (p.size[0]) el.style.width = `${p.size[0] * k}px`;
    if (p.size[1]) el.style.height = `${p.size[1] * k}px`;
  }
  const bound = p.bind?.tintColor ? INK_GAME_COLORS[p.bind.tintColor] ?? '#ff6159' : null;
  const color = bound ?? (p.tint ? inkRgba(p.tint) : n.tag === 'text' ? '#ffffff' : '');
  el.style.opacity = p.opacity ?? (p.bind?.opacity ? 0.4 : 1);
  el.style.visibility = p.visible === false ? 'hidden' : '';
  if (n.tag === 'text') {
    // A game key: the game shows its own translation; here, English for the keys the samples use.
    if (!p.binding) el.textContent = p.locKey ? INK_GAME_TEXT[p.locKey] ?? p.locKey : p.text ?? '';
    el.style.color = color;
    el.style.fontSize = `${(p.fontSize ?? 32) * k}px`;
    el.style.fontWeight = /Semi-Bold|Bold/.test(p.font?.[1] ?? '') ? 600 : 500;
    el.style.textTransform = p.letterCase === 'UpperCase' ? 'uppercase' : p.letterCase === 'LowerCase' ? 'lowercase' : '';
    el.style.textAlign = (p.textAlign ?? '').toLowerCase();
    el.style.whiteSpace = 'pre';
  } else if (n.tag === 'rect' || n.tag === 'circle') {
    el.style.background = color || '#ffffff';
    el.style.borderRadius = n.tag === 'circle' ? '50%' : '';
  } else if (n.tag === 'image') {
    el.style.border = `1px dashed ${color || '#888'}`;
    el.title = `${p.atlas ?? ''} ${p.part ?? ''}: atlas images show only in the game`;
  }
  if (p.pivot) el.style.transformOrigin = `${p.pivot[0] * 100}% ${p.pivot[1] * 100}%`;
  if (p.scale) el.style.scale = `${p.scale[0]} ${p.scale[1]}`;
}

// Bindings: the plugin reads them every frame; the page, four times a second.
function inkBindings() {
  for (const n of inkNodes.values()) {
    const b = n.props.binding;
    if (!b) continue;
    const value = host.inkSource(b.source);
    if (value === undefined) continue;
    if (b.target === 'scaleX') {
      const of = typeof b.of === 'string' ? host.inkSource(b.of) : b.of ?? 1;
      n.el.style.transformOrigin = '0% 50%';
      n.el.style.scale = `${of > 0 ? Math.max(0, Math.min(1, value / of)) : 0} 1`;
    } else {
      n.el.textContent = (b.format ?? '{value}').replaceAll('{value}', Number(value).toFixed(b.decimals ?? 0));
    }
  }
}

function inkInsert(parent, el, index) {
  const before = index === undefined ? null : parent.children[index] ?? null;
  parent.insertBefore(el, before);
}

function inkOp(op) {
  if (op.op === 'mount') {
    if (!inkHud) {
      inkHud = document.createElement('div');
      inkHud.className = 'ink-hud';
      Object.assign(inkHud.style, {
        position: 'relative', width: '640px', maxWidth: '100%', aspectRatio: '16 / 9', overflow: 'hidden',
        background: 'linear-gradient(160deg, #1b2330, #0c0f14)', border: '1px solid #333', fontFamily: 'Rajdhani, sans-serif',
      });
      stage.append(inkHud);
      inkTimer = setInterval(inkBindings, 250);
    }
    inkMounts.get(op.mount)?.el.remove();
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', inset: '0' });
    inkHud.append(el);
    inkMounts.set(op.mount, { el });
    hostLog('info', 'ink: a tree is on the HUD (in the game, Codeware draws it on the HUD layer)');
    return;
  }
  const mount = inkMounts.get(op.mount);
  if (!mount) return;
  if (op.op === 'unmount') {
    mount.el.remove();
    inkMounts.delete(op.mount);
    for (const key of [...inkNodes.keys()]) if (key.startsWith(`${op.mount}/`)) inkNodes.delete(key);
    return;
  }
  const id = `${op.mount}/${op.key}`;
  const n = inkNodes.get(id);
  if (op.op === 'add') {
    const parent = op.parent ? inkNodes.get(`${op.mount}/${op.parent}`)?.el : mount.el;
    const el = document.createElement(op.tag === 'text' ? 'span' : 'div');
    const node = { el, tag: op.tag, props: { ...op.props }, parent: op.parent, mount: op.mount };
    inkNodes.set(id, node);
    if (parent) inkInsert(parent, el, op.index);
    inkStyle(node);
  } else if (op.op === 'set' && n) {
    for (const [k, v] of Object.entries(op.props ?? {})) {
      if (k === 'bind' && v && n.props.bind) n.props.bind = Object.fromEntries(Object.entries({ ...n.props.bind, ...v }).filter(([, x]) => x !== null));
      else if (v === null) delete n.props[k];
      else n.props[k] = v;
    }
    inkStyle(n);
  } else if (op.op === 'remove' && n) {
    n.el.remove();
    for (const key of [...inkNodes.keys()]) if (!document.contains(inkNodes.get(key).el)) inkNodes.delete(key);
  } else if (op.op === 'move' && n) {
    const parent = n.el.parentElement;
    n.el.remove();
    inkInsert(parent, n.el, op.index);
  }
}

function clearInk() {
  clearInterval(inkTimer);
  inkTimer = null;
  inkHud?.remove();
  inkHud = null;
  inkMounts.clear();
  inkNodes.clear();
}

// A mod with no window shows where its output goes.
function placeholder() {
  const empty = document.getElementById('empty');
  empty.hidden = windows.size > 0 || inkMounts.size > 0;
  const text = !worker
    ? status === 'crashed'
      ? 'The mod stopped after too many crashes. Press Restart.'
      : 'The mod is stopped. Press Start.'
    : 'This mod has no window: what it does shows in the Mod log.';
  empty.textContent = text;
  requestAnimationFrame(() => post({ t: 'size', width: stage.scrollWidth, height: stage.scrollHeight }));
}

start();
