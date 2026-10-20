// The rednode package inside a Node mod's worker, for the docs' example previews.
// A mod runs in a Web Worker here, as it runs on a worker thread in the REDnode host,
// so an endless loop stops only the mod. Every call goes to the page (runner.js), which
// answers from the simulated game in rednode.js, the way the real package sends calls
// to the host. The ui builder works here as in the real package: it describes windows,
// and the page draws them with the UI kit.

const send = (m) => postMessage(m);
const show = (a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a));

// What the mod prints goes to the Mod log, as in the game.
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => send({ t: 'log', level: level === 'log' || level === 'debug' ? 'info' : level, text: args.map(show).join(' ') });
}

// A thrown error or a rejected promise nobody handles ends the mod, as in Node.
let ended = false;
const crash = (error) => {
  if (ended) return;
  ended = true;
  send({ t: 'crash', error });
  close();
};
self.addEventListener('error', (e) => {
  e.preventDefault();
  crash(e.error?.stack || e.message);
});
self.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  crash(e.reason?.stack || String(e.reason));
});

// The parts of Node's process a mod might use.
globalThis.process = {
  pid: 4242,
  platform: 'win32',
  arch: 'x64',
  env: {},
  argv: [],
  versions: { node: '24.11.1' },
  cwd: () => 'red4ext/plugins/REDnode/apps/example',
  on() {},
  exit(code = 0) {
    ended = true;
    send({ t: 'exit', code });
    close();
    throw new Error('process.exit'); // stop running this code at once
  },
  kill(_pid, signal = 'SIGTERM') {
    ended = true;
    send({ t: 'killed', signal });
    close();
    throw new Error('process.kill');
  },
};

// ---------- calls to the page ----------

const REF = Symbol('ref');
const pending = new Map(); // call id -> { resolve, reject }
const streams = new Map(); // call id -> onText
const fieldPromises = new Map(); // "ref.name" -> resolve
let nextCall = 1;

function encode(v) {
  if (v && typeof v === 'object') {
    if (v[REF]) return { $ref: v[REF] };
    if (Array.isArray(v)) return v.map(encode);
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x !== 'function').map(([k, x]) => [k, encode(x)]));
  }
  return v;
}

function remote(ref, type, fields = {}) {
  const values = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value && value.$promise) values[name] = new Promise((resolve) => fieldPromises.set(`${ref}.${name}`, resolve));
    else values[name] = decode(value);
  }
  return new Proxy({}, {
    get(_t, name) {
      if (name === REF) return ref;
      if (name === '$ref') return ref;
      if (name === '$type') return type;
      if (typeof name === 'symbol' || name === 'then' || name === 'toJSON') return undefined;
      if (name in values) return values[name];
      return (...args) => call({ ref, method: name, args });
    },
  });
}

function decode(v) {
  if (v && typeof v === 'object') {
    if (typeof v.$ref === 'number') return remote(v.$ref, v.$type, v.$fields);
    if (Array.isArray(v)) return v.map(decode);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

function call(target, extra = {}) {
  const id = nextCall++;
  send({ t: 'call', id, ...target, args: encode(target.args ?? []), ...extra });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

// game.x.y(...) -> a call to that path on the page. `own` holds members that run here.
function path(p, own = {}) {
  return new Proxy(() => {}, {
    get(_t, name) {
      if (Object.hasOwn(own, name)) return own[name];
      if (typeof name === 'symbol' || name === 'then') return undefined;
      return path([...p, name]);
    },
    apply: (_t, _this, args) => call({ path: p, args }),
  });
}

const listeners = new Map(); // listener id -> handler
let nextListener = 1;
function listen(kind, name, handler) {
  const id = nextListener++;
  listeners.set(id, handler);
  send({ t: 'listen', id, kind, name });
  return () => {
    listeners.delete(id);
    send({ t: 'unlisten', id });
  };
}

// ---------- ui builder ----------

let nextNode = 1;
const nodes = new Map(); // node id -> { spec, window }
const handlers = new Map(); // node id -> { click, change, submit }
const windows = new Map(); // window id -> { onClose, closed }

function node(type, props, on = {}, children = []) {
  const id = `n${nextNode++}`;
  const spec = { id, type, props: { ...props }, children: children.map((c) => nodes.get(c.id).spec) };
  nodes.set(id, { spec, window: null });
  handlers.set(id, on);
  return {
    id,
    type,
    get props() {
      return spec.props;
    },
    set(p) {
      Object.assign(spec.props, p);
      const n = nodes.get(id);
      if (n.window && !windows.get(n.window)?.closed) send({ t: 'ui-update', node: id, props: p });
    },
  };
}
const split = (options = {}) => {
  const { onChange, onSubmit, ...props } = options;
  return { props, onChange, onSubmit };
};
const collect = (spec, ids) => {
  ids.push(spec.id);
  for (const c of spec.children ?? []) collect(c, ids);
};

export const ui = {
  text: (text, o = {}) => node('text', { text, ...o }),
  heading: (text, o = {}) => node('heading', { text, ...o }),
  button: (label, onClick, o = {}) => node('button', { label, ...o }, { click: onClick }),
  // Like the package, a toggle, slider or field keeps what the player set in its props.
  toggle(label, onChange, o = {}) {
    const self = node('toggle', { label, ...o }, { change: (v) => (Object.assign(self.props, { checked: !!v }), onChange?.(!!v)) });
    return self;
  },
  slider(label, onChange, o = {}) {
    const self = node('slider', { label, ...o }, { change: (v) => (Object.assign(self.props, { value: Number(v) }), onChange?.(Number(v))) });
    return self;
  },
  input(options = {}) {
    const { props, onChange, onSubmit } = split(options);
    const self = node('input', props, {
      change: (v) => (Object.assign(self.props, { value: String(v) }), onChange?.(String(v))),
      submit: (v) => onSubmit?.(String(v)),
    });
    return self;
  },
  progress: (value, o = {}) => node('progress', { value, ...o }),
  // Like the package: push sends only the new lines; both ends keep the newest "keep".
  list(o = {}) {
    const keep = Math.min(5000, Math.max(1, Math.floor(Number(o.keep) || 500)));
    const self = node('list', { ...o, keep, lines: (o.lines ?? []).map(String).slice(-keep) });
    return Object.assign(self, {
      push(...lines) {
        const add = lines.map(String);
        if (!add.length) return;
        self.props.lines.push(...add);
        if (self.props.lines.length > keep) self.props.lines.splice(0, self.props.lines.length - keep);
        const n = nodes.get(self.id);
        if (n.window && !windows.get(n.window)?.closed) send({ t: 'ui-update', node: self.id, props: { push: add } });
      },
      clear() {
        self.set({ lines: [] });
      },
    });
  },
  row: (...children) => node('row', {}, {}, children),
  column: (...children) => node('column', {}, {}, children),
  window(options) {
    const id = options.id ?? 'main';
    if (windows.get(id) && !windows.get(id).closed) throw new Error(`rednode: a window with id "${id}" is already open`);
    const root = {
      id: `w:${id}`,
      type: 'window',
      props: {
        title: options.title,
        width: options.width ?? 360,
        height: options.height ?? 320,
        anchor: options.anchor ?? 'center',
        x: options.x ?? 0,
        y: options.y ?? 0,
        closable: options.closable !== false,
      },
      children: options.children.map((c) => nodes.get(c.id).spec),
    };
    const ids = [];
    for (const c of root.children) collect(c, ids);
    for (const n of ids) nodes.get(n).window = id;
    const state = { onClose: options.onClose, closed: false };
    windows.set(id, state);
    send({ t: 'ui-open', win: id, spec: root });
    return {
      id,
      get closed() {
        return state.closed;
      },
      close() {
        if (state.closed) return;
        state.closed = true;
        send({ t: 'ui-close', win: id });
      },
    };
  },
  copy: (text) => call({ path: ['ui', 'copy'], args: [text] }),
  solo: (on) => call({ path: ['ui', 'solo'], args: [on] }),
  onSolo: (fn) => listen('solo', null, fn),
};

// ---------- messages from the page ----------

self.addEventListener('message', (e) => {
  const m = e.data;
  switch (m.t) {
    case 'ping':
      send({ t: 'pong' });
      break;
    case 'result': {
      const p = pending.get(m.id);
      pending.delete(m.id);
      streams.delete(m.id);
      if (!p) break;
      if (m.ok) p.resolve(decode(m.value));
      else p.reject(Object.assign(new Error(m.error), { name: 'Error' }));
      break;
    }
    case 'stream':
      streams.get(m.id)?.(m.text);
      break;
    case 'field':
      fieldPromises.get(`${m.ref}.${m.name}`)?.(decode(m.value));
      fieldPromises.delete(`${m.ref}.${m.name}`);
      break;
    case 'event':
      listeners.get(m.id)?.(m.payload);
      break;
    case 'ui-event': {
      if (m.type === 'close') {
        const w = windows.get(m.win);
        if (w && !w.closed) {
          w.closed = true;
          w.onClose?.();
        }
        break;
      }
      const fn = handlers.get(m.node)?.[m.type];
      if (fn) {
        const r = m.type === 'click' ? fn() : fn(m.value);
        // A handler's rejected promise is unhandled, as in Node: the mod crashes.
        if (r && typeof r.then === 'function') r.then(undefined, (err) => crash(err?.stack || String(err)));
      }
      break;
    }
    default:
      break;
  }
});

// ---------- the package ----------

const instance = Object.freeze({});

export const game = {
  instance,
  player: path(['game', 'player']),
  audio: path(['game', 'audio']),
  state: () => call({ path: ['game', 'state'], args: [] }),
  on: (name, fn) => listen('game', name, fn),
  onState: (fn) => listen('state', null, fn),
};

export const api = path(['api']);
export const world = path(['world'], { on: (name, fn) => listen('world', name, fn) });
// audio.trace's callback runs here; the page sends it each batch as an event.
export const audio = path(['audio'], {
  async trace(fn) {
    const off = listen('trace', null, fn);
    return async () => off();
  },
});
export const kernel = path(['kernel']);
export const archives = path(['archives']);
export const pkg = path(['pkg']);
export const secrets = path(['secrets']);
export const channel = { post() {}, on: () => () => {} };

// TweakDB ids are worked out in the mod, as the real package does: CRC32 and length.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export const tweakdb = path(['tweakdb'], {
  id(p) {
    if (p.startsWith('0x')) return p;
    const bytes = new TextEncoder().encode(p);
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    const v = (BigInt(bytes.length) << 32n) | BigInt((c ^ 0xffffffff) >>> 0);
    return `0x${v.toString(16).toUpperCase().padStart(16, '0')}`;
  },
  name: () => null,
  learn() {},
});

export const agent = {
  ask(question, options = {}) {
    const id = nextCall++;
    if (options.onText) streams.set(id, options.onText);
    options.signal?.addEventListener('abort', () => send({ t: 'abort', id }));
    send({ t: 'call', id, path: ['agent', 'ask'], args: [question, encode({ context: options.context })], stream: true });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  },
  serve: () => () => {},
};

export function defineInterceptor(definition) {
  return definition;
}
export function interceptor(name) {
  return { set: () => call({ path: ['interceptor', 'set'], args: [name] }) };
}
