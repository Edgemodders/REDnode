// window.rednode for an overlay app's page in the docs' example previews: the same
// methods the REDnode host's preload gives a page in the game, answered by the
// simulation in rednode.js. Loaded before the app's own scripts.
'use strict';

(() => {
  const here = document.currentScript.src;
  // Loaded once the page is parsed: a module load before the page's import map would
  // make the browser ignore that map, and the app's `import ... from 'rednode'` fail.
  const parsed = new Promise((r) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r()));
  const sim = parsed.then(() => import(new URL('rednode.js', here).href));
  const post = (m) => parent.postMessage({ rednodeExample: true, ...m }, '*');

  // The page's console goes to the docs page's log too.
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      post({ t: 'log', level: level === 'log' ? 'info' : level, source: 'page', text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });
    };
  }
  window.addEventListener('error', (e) => post({ t: 'log', level: 'error', source: 'page', text: e.message }));

  window.rednode = {
    call: (method, params) => sim.then((s) => s.hostCall(method, params)),
    on(fn) {
      let off = null;
      let gone = false;
      sim.then((s) => {
        if (!gone) off = s.onHostEvent(fn);
      });
      return () => {
        gone = true;
        off?.();
      };
    },
    state: () => sim.then((s) => s.hostState()),
    close() {
      post({ t: 'closed' });
    },
    // No overlay window here: the kit then shows only the actions a page does itself (Roll up).
    windowInfo: () => Promise.reject(new Error('no overlay window on the docs page')),
    windowAction: () => Promise.resolve(),
    pointerLock: () => Promise.resolve(true),
    // No debugger on the docs page: the kit then leaves its Debug action out.
    debug: undefined,
  };
})();
