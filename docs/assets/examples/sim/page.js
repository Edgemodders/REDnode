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
    // The admin calls (the Admin Tools pack's Task Manager and Tools Manager), as if the
    // player had allowed the admin permission: made-up packages and tools.
    tasks: {
      list: async () => ({ at: Date.now(), rows: tasks.map(taskRow), total: { cpuPercent: 3.4, memoryMB: 742, processes: 9, hostMB: 214 } }),
      end: async (id) => {
        const t = tasks.find((x) => x.id === id);
        if (t) t.ended = true;
        return true;
      },
      restart: async (id) => {
        const t = tasks.find((x) => x.id === id);
        if (t) Object.assign(t, { ended: false, started: Date.now() });
        return true;
      },
    },
    tools: {
      list: async () => toolList(),
      set: async (what, id, on) => {
        if (what === 'tool') for (const g of toolGroups) for (const t of g.tools) if (t.key === id) t.off = !on;
        if (what === 'group') for (const g of toolGroups) if (g.id === id) g.off = !on;
        if (what === 'new-off') newOff = !!on;
        return toolList();
      },
    },
  };

  const tasks = [
    { id: 'hello-mod', name: 'Hello mod', mod: true, cpu: 0.4, mem: 81, load: 0.02, heap: 6, started: Date.now() - 754000 },
    { id: 'counter-service', name: 'Counter service', mod: true, cpu: 0.2, mem: 79, load: 0.01, heap: 5, started: Date.now() - 312000, svc: 1.2 },
    { id: 'counter-panel', name: 'Counter panel', mod: true, cpu: 0.6, mem: 92, load: 0.04, heap: 7, started: Date.now() - 311000, svcOut: 1.2 },
    { id: 'vitals', name: 'Vitals', mod: false, cpu: 0.3, mem: 88, calls: 2 },
    { id: 'crash-mod', name: 'Crash mod', mod: true, cpu: 12.5, mem: 84, load: 1, heap: 9, started: Date.now() - 41000 },
  ];
  const wobble = (n) => Math.round(n * (0.8 + Math.random() * 0.4) * 10) / 10;
  const taskRow = (t) => ({
    id: t.id,
    name: t.name,
    version: '0.1.0',
    builtin: false,
    mod: t.mod
      ? t.ended
        ? { status: 'stopped', ended: true, process: null, pid: null, cpuPercent: null, memoryMB: null, processMods: [], uptimeMs: null }
        : { status: 'running', ended: false, process: 'own', pid: 4000 + t.mem, cpuPercent: wobble(t.cpu), memoryMB: t.mem, processMods: [t.id], uptimeMs: Date.now() - t.started, load: Math.min(1, wobble(t.load)), heapMB: t.heap, heapLimitMB: 4144 }
      : null,
    windows: t.mod ? [] : [{ key: t.id, title: t.name, cpuPercent: wobble(t.cpu), memoryMB: t.mem }],
    service: t.svc ? { functions: [] } : null,
    gameCallsPerSec: t.calls ?? 0,
    gameCallMs: t.calls ? 1.4 : null,
    serviceInPerSec: t.svc ?? 0,
    serviceOutPerSec: t.svcOut ?? 0,
    serviceErrors: 0,
    serviceMs: t.svc ? 0.8 : null,
  });

  let newOff = false;
  const own = (name, description, readonly) => ({ key: `rednode:${name}`, name, title: name, description, readonly, asks: !readonly, off: false });
  const toolGroups = [
    { id: 'rednode', name: 'REDnode', builtin: true, off: false, tools: [
      own('logs', "What Node mods printed, newest last.", true),
      own('game_state', 'Whether REDnode is linked to the game, and what the game shows.', true),
      own('api_read', 'A live game call that only reads, without asking.', true),
      own('api_call', 'A live game call. It can change the player\'s game, so it asks first.', false),
      own('archives_reload', 'Swaps archives into the running game.', false),
    ] },
    { id: 'counter-service', name: 'Counter service', builtin: false, off: false, tools: [
      { key: 'counter-service:add', name: 'counter_service__add', title: 'add', description: 'Adds to the count and answers the new count.', params: [{ name: 'by', type: 'number', optional: true, description: 'How much to add; 1 if left out.' }], readonly: false, asks: true, off: false },
      { key: 'counter-service:get', name: 'counter_service__get', title: 'get', description: 'The count now.', params: [], readonly: true, asks: false, off: false },
      { key: 'counter-service:reset', name: 'counter_service__reset', title: 'reset', description: 'Sets the count back to 0.', params: [], readonly: false, asks: true, off: false },
    ] },
  ];
  const toolList = () => ({
    mcp: { enabled: true, port: 41820, external: true },
    newOff,
    groups: toolGroups,
    assistants: [
      { name: 'claude-code', kind: 'desktop', lastSeenMs: 42000 },
      { name: 'REDagent', kind: 'package', lastSeenMs: 380000 },
    ],
    recent: [
      { at: Date.now() - 42000, assistant: 'claude-code', tool: 'counter_service__add', pkg: 'counter-service', fn: 'add', ok: true, ms: 2, detail: '6' },
      { at: Date.now() - 380000, assistant: 'REDagent', tool: 'counter_service__get', pkg: 'counter-service', fn: 'get', ok: true, ms: 1, detail: '1' },
    ],
  });
})();
