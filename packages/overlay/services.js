// Mod services (docs/services.md): packages calling each other's functions through the host.
//
// A package names a service file in its manifest ("service": "service.mjs"). The file runs
// in the package's Node mod worker, and every function it exports can be called by other
// packages, by the package's id, with plain JSON-like values. The host is the only road
// between them: it checks that the provider runs, carries the call and its answer, times it
// out, tells the provider who is calling, and counts calls for the Task Manager.
//
//   caller -> host:    connect(provider) -> { id, name, version, functions }
//                      call(provider, fn, args, { timeoutMs }) -> result
//                      cancel(cid)
//   host -> provider:  { t: 'service-call', sid, fn, args, caller } and { t: 'service-cancel', sid }
//   provider -> host:  ready(functions) once its service file has loaded,
//                      reply(sid, result | error), emit(name, data)
//   host -> caller:    { event: 'service', provider, name, data } for each emit, to every package
//                      that connected to the provider (its Node mod and its pages)

'use strict';

const CALL_TIMEOUT = 30000; // a call the provider does not answer fails after this
const READY_WAIT = 10000; // a call to a provider that is starting waits this long for it

/**
 * @param {object} host
 * @param {(id: string) => object | undefined} host.entry           the installed package
 * @param {(id: string) => { enabled: boolean, status: string }} host.modState   a Node mod's state
 * @param {(id: string, message: object) => boolean} host.toWorker  posts to a mod's worker; false when it is not running
 * @param {(id: string, message: object) => void} host.toPackage    an event for a package's mod and pages
 * @param {(id: string, level: string, text: string) => void} host.modLog   a line in the Mod log
 * @param {(id: string, functions: string[]) => object | null} host.describe   the service's descriptor (SV2):
 *        its JSDoc, read from service.json or the service file; null when it cannot be read
 * @param {(functionKey: string) => boolean} [host.toolOff]   SV3: whether the player switched a tool off
 */
function createServices(host) {
  /** Providers whose service file has loaded: id -> { functions: string[], descriptor, at } */
  const ready = new Map();
  /** Calls waiting for an answer: sid -> { provider, fn, resolve, reject, timer, caller } */
  const pending = new Map();
  /** Calls waiting for a starting provider: provider id -> [{ go, fail, timer }] */
  const waiting = new Map();
  /** Who connected to each provider, for its events: provider id -> Set of package ids */
  const subscribers = new Map();
  /** Counters per package for the Task Manager: id -> { in, out, errors, ms } since the last read */
  const counters = new Map();
  let nextSid = 1;

  const count = (id, key, by = 1) => {
    if (!id) return;
    const c = counters.get(id) ?? { in: 0, out: 0, errors: 0, ms: 0 };
    c[key] += by;
    counters.set(id, c);
  };

  const nameOf = (id) => host.entry(id)?.manifest.name ?? id;
  const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  // Why a provider cannot take a call now, in the player's words, or null when it can.
  // "wait" when it is switched on and starting, so the call can wait for it.
  function why(provider) {
    const entry = host.entry(provider);
    if (!entry) return `No package "${provider}" is installed`;
    if (!entry.manifest.service) return `${entry.manifest.name} offers no service (its rednode-app.json names no "service" file)`;
    const state = host.modState(provider);
    if (!state?.enabled) return `${entry.manifest.name} is off: switch it on in the Mod Manager`;
    if (ready.has(provider)) return null;
    if (state.status === 'crashed') return `${entry.manifest.name} has crashed: see the Mod log`;
    return 'wait';
  }

  // Resolves once the provider is ready, or rejects with the reason it is not.
  function whenReady(provider) {
    const reason = why(provider);
    if (!reason) return Promise.resolve();
    if (reason !== 'wait') return Promise.reject(new Error(reason));
    return new Promise((resolve, reject) => {
      const list = waiting.get(provider) ?? [];
      const w = {
        go: resolve,
        fail: reject,
        timer: setTimeout(() => {
          const l = waiting.get(provider);
          if (l) l.splice(l.indexOf(w), 1);
          reject(new Error(`${nameOf(provider)} did not start within ${READY_WAIT / 1000} s`));
        }, READY_WAIT),
      };
      list.push(w);
      waiting.set(provider, list);
    });
  }

  return {
    /** A provider's service file has loaded, with the names of its exported functions. */
    ready(provider, functions) {
      const names = (Array.isArray(functions) ? functions : []).filter((f) => typeof f === 'string');
      let descriptor = null;
      try {
        descriptor = host.describe(provider, names);
      } catch (err) {
        host.modLog(provider, 'error', `Service description: ${err.message}; calls are not checked`);
      }
      ready.set(provider, { functions: names, descriptor, at: Date.now() });
      host.modLog(provider, 'info', `Service ready: ${names.length ? names.join(', ') : 'no functions exported'}`);
      // What the JSDoc reader could not understand, once a load, so the author can fix it.
      for (const w of descriptor?.warnings ?? []) host.modLog(provider, 'info', `Service description: ${w}`);
      for (const w of waiting.get(provider) ?? []) {
        clearTimeout(w.timer);
        w.go();
      }
      waiting.delete(provider);
    },

    /** A provider stopped, crashed or is restarting: its calls fail, and it is not ready. */
    gone(provider) {
      if (!ready.delete(provider)) return;
      for (const [sid, c] of pending) {
        if (c.provider !== provider) continue;
        pending.delete(sid);
        clearTimeout(c.timer);
        count(c.caller.id, 'errors');
        c.reject(new Error(`${nameOf(provider)} stopped before it answered ${c.fn}`));
      }
    },

    /** A package uninstalled or switched off: calls waiting for it fail at once. */
    removed(provider) {
      this.gone(provider);
      for (const w of waiting.get(provider) ?? []) {
        clearTimeout(w.timer);
        w.fail(new Error(why(provider) ?? `${nameOf(provider)} stopped`));
      }
      waiting.delete(provider);
    },

    /**
     * A caller connects: from then on it gets the provider's events. Answers what the
     * provider offers. Waits for a provider that is starting.
     */
    async connect(callerId, provider) {
      if (typeof provider !== 'string' || !provider) throw new Error('service.connect needs a package id, such as "edgebuilder"');
      if (provider === callerId) throw new Error('A package cannot connect to its own service: call its functions directly');
      await whenReady(provider);
      if (callerId) {
        const set = subscribers.get(provider) ?? new Set();
        if (!set.has(callerId)) host.modLog(callerId, 'info', `Connected to ${nameOf(provider)}'s service`);
        set.add(callerId);
        subscribers.set(provider, set);
      }
      const m = host.entry(provider).manifest;
      return { id: m.id, name: m.name, version: m.version, functions: ready.get(provider).functions };
    },

    /**
     * Calls a provider's function. caller: { id, name } for a package, or { assistant } for an
     * MCP client (SV3). Resolves with the result; rejects with the provider's error or the host's.
     */
    async call(caller, provider, fn, args, options = {}) {
      count(caller.id, 'out');
      try {
        if (typeof fn !== 'string' || !fn) throw new Error('A service call needs a function name');
        await whenReady(provider);
        const offer = ready.get(provider);
        if (!offer.functions.includes(fn)) {
          throw new Error(`${nameOf(provider)} has no function "${fn}". It offers: ${offer.functions.join(', ') || 'none'}`);
        }
        // SV2: the arguments are checked against the function's description before the
        // provider sees them.
        const described = offer.descriptor?.functions?.[fn];
        const list = Array.isArray(args) ? args : [];
        if (described && host.checkArgs) {
          const why = host.checkArgs(described, list);
          if (why) throw new Error(why);
        }
        const sid = nextSid++;
        const started = performance.now();
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : described?.timeoutMs ?? CALL_TIMEOUT;
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(sid);
            host.toWorker(provider, { t: 'service-cancel', sid });
            reject(new Error(`${nameOf(provider)} did not answer ${fn} within ${timeoutMs / 1000} s`));
          }, timeoutMs);
          pending.set(sid, { provider, fn, resolve, reject, timer, caller });
          options.onSid?.(sid);
          const sent = host.toWorker(provider, { t: 'service-call', sid, fn, args: plain(args ?? []), caller: plain(caller) });
          if (!sent) {
            pending.delete(sid);
            clearTimeout(timer);
            reject(new Error(`${nameOf(provider)} is not running`));
          }
        });
        count(provider, 'in');
        count(provider, 'ms', performance.now() - started);
        return result;
      } catch (err) {
        count(caller.id, 'errors');
        if (caller.id) host.modLog(caller.id, 'error', `Service call ${provider}.${fn} failed: ${err.message}`);
        throw err;
      }
    },

    /** A caller gave up on a call (its AbortSignal): the provider's signal for it aborts. */
    cancel(sid) {
      const c = pending.get(sid);
      if (!c) return;
      pending.delete(sid);
      clearTimeout(c.timer);
      host.toWorker(c.provider, { t: 'service-cancel', sid });
      c.reject(new Error('Stopped'));
    },

    /** A provider answered a call. */
    reply(provider, sid, result, error) {
      const c = pending.get(sid);
      if (!c || c.provider !== provider) return;
      pending.delete(sid);
      clearTimeout(c.timer);
      if (error) c.reject(new Error(String(error)));
      else c.resolve(result);
    },

    /** A provider sends an event to every package that connected to it. */
    emit(provider, name, data) {
      if (!ready.has(provider)) throw new Error('Only a package whose service file has loaded can send service events');
      if (typeof name !== 'string' || !name) throw new Error('service.emit needs an event name');
      const message = { event: 'service', provider, name, data: plain(data) };
      for (const id of subscribers.get(provider) ?? []) host.toPackage(id, message);
    },

    /** Whether a provider's service is ready, and its functions and descriptor. */
    offer: (provider) => ready.get(provider) ?? null,

    /**
     * What a provider's service offers, described (SV2): its functions with their JSDoc,
     * parameters and JSON Schema, and its events. Waits for a starting provider.
     */
    async describe(provider) {
      await whenReady(provider);
      const m = host.entry(provider).manifest;
      const offer = ready.get(provider);
      const d = offer.descriptor;
      const functions = {};
      for (const name of offer.functions) {
        functions[name] = d?.functions?.[name] ?? { name, description: '', params: [], checked: false, returns: null, tool: false, readonly: false, timeoutMs: null, deprecated: null };
      }
      return { id: m.id, name: m.name, version: m.version, functions, events: d?.events ?? {} };
    },

    /** Every ready provider: [{ id, functions }]. */
    providers: () => [...ready].map(([id, r]) => ({ id, functions: r.functions })),

    /** The calls each package made and answered since the last read, and resets them. */
    takeCounters() {
      const out = Object.fromEntries(counters);
      counters.clear();
      return out;
    },
  };
}

module.exports = { createServices };
