// Runs one Node mod on its own worker thread. Started by runner.js.
//
// Before the mod loads (its main, then its service file if it has one), this sets up
// what the rednode package needs:
//   - `import ... from "rednode"` (or require) resolves to the SDK the host ships;
//   - globalThis[Symbol.for('rednode.transport')] carries calls, events and UI
//     messages through runner.js to the host.
// A thrown error that nothing catches ends this worker only; runner.js reports it.

'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { registerHooks } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { id, dir, main, service, sdk, dataDir, appsDirs, debug } = workerData;

// The mod's Debug switch (Mod Manager): Node's inspector, opened from this thread so
// a debugger attaches to the mod's own thread. A free local port; it does not wait
// for a debugger, so use a debugger statement or a breakpoint set after attaching.
if (debug) {
  const inspector = require('node:inspector');
  inspector.open(0, '127.0.0.1');
  parentPort.postMessage({ t: 'inspector', url: inspector.url() });
}

// This package, for `pkg` in the rednode package.
globalThis[Symbol.for('rednode.package')] = Object.freeze({ id, dir, dataDir, appsDirs });
const sdkUrl = pathToFileURL(sdk).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'rednode') return { url: sdkUrl, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let nextRequest = 1;
const pending = new Map(); // request id -> { resolve, reject }
const listeners = new Set();

function request(message) {
  const rid = nextRequest++;
  return new Promise((resolve, reject) => {
    pending.set(rid, { resolve, reject });
    parentPort.postMessage({ ...message, rid });
  });
}

globalThis[Symbol.for('rednode.transport')] = {
  call: (method, params) => request({ t: 'call', method, params }),
  state: () => request({ t: 'state' }),
  secret: (op, name, value) => request({ t: 'secret', op, name, value }),
  mcp: () => request({ t: 'mcp' }),
  bridge: (op, method, params) => request({ t: 'bridge', op, method, params }),
  requires: () => request({ t: 'requires' }),
  solo: (on) => request({ t: 'solo', on }),
  post: (data) => parentPort.postMessage({ t: 'post', data }),
  agent: (msg) => parentPort.postMessage({ t: 'agent', msg }),
  service: (msg) => request({ t: 'service', msg }),
  listen(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  ui: {
    open: (window, spec) => parentPort.postMessage({ t: 'ui', op: 'open', window, spec }),
    update: (window, node, props) => parentPort.postMessage({ t: 'ui', op: 'update', window, node, props }),
    close: (window) => parentPort.postMessage({ t: 'ui', op: 'close', window }),
  },
};

parentPort.on('message', (m) => {
  switch (m.t) {
    case 'reply': {
      const p = pending.get(m.rid);
      if (!p) return;
      pending.delete(m.rid);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
      return;
    }
    case 'event':
      for (const fn of listeners) fn(m.message);
      return;
    case 'ping':
      parentPort.postMessage({ t: 'pong' });
      return;
    case 'service-call':
      serviceCall(m);
      return;
    case 'service-cancel':
      running.get(m.sid)?.abort();
      return;
    default:
      return;
  }
});

// ---------- the package's service (docs/services.md) ----------
//
// The service file's exported functions, called by other packages through the host. Each
// call runs with its caller and an AbortSignal in an AsyncLocalStorage, which `service.caller()`
// and `service.signal()` in the rednode package read.

const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
globalThis[Symbol.for('rednode.serviceContext')] = context;
let exported = null; // the service file's module
const running = new Map(); // sid -> AbortController

function serviceCall({ sid, fn, args, caller }) {
  const f = exported?.[fn];
  const answer = (result, error) => {
    running.delete(sid);
    let plain;
    try {
      plain = result === undefined ? undefined : JSON.parse(JSON.stringify(result));
    } catch (err) {
      error = `${fn} returned a value that is not plain data (${err.message})`;
    }
    parentPort.postMessage({ t: 'service-reply', sid, result: plain, error });
  };
  if (typeof f !== 'function') return answer(undefined, `no function "${fn}"`);
  const controller = new AbortController();
  running.set(sid, controller);
  context.run({ caller, signal: controller.signal }, () => {
    Promise.resolve()
      .then(() => f(...(Array.isArray(args) ? args : [])))
      .then(
        (result) => answer(result),
        (err) => answer(undefined, err?.message || String(err)),
      );
  });
}

(async () => {
  // main first, so the service file can use what main set up (they share module instances).
  if (main) await import(pathToFileURL(path.join(dir, main)).href);
  if (service) {
    exported = await import(pathToFileURL(path.join(dir, service)).href);
    const functions = Object.keys(exported).filter((k) => typeof exported[k] === 'function' && k !== 'default');
    parentPort.postMessage({ t: 'service-ready', functions });
  }
})().then(
  () => parentPort.postMessage({ t: 'loaded' }),
  (err) => {
    throw err; // an error while loading counts as a crash, reported by runner.js
  },
);
