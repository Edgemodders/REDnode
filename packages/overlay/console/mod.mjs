// The Console's Node mod (O12): runs what the player types, one entry at a time, in one
// shared scope with the whole rednode package in it. Its page (index.html) is only the
// window: it sends the code over the channel and shows what comes back.
//
// Code runs through Node's own REPL evaluator, which gives top-level await, keeps
// variables between entries, and says when an entry is not finished. Its errors come out
// on its output stream (they go through its domain, which also catches errors thrown later
// by timers and promises the code started), so this reads them from there.

import * as rednode from 'rednode';
import fs from 'node:fs';
import path from 'node:path';
import repl from 'node:repl';
import { PassThrough } from 'node:stream';

const { channel, game, pkg } = rednode;

const HISTORY = 200; // entries kept in history.json
const KEPT = 300; // output entries kept for a page that opens again
const RESULTS = 50; // $1, $2 ... kept; older ones are let go, with the game objects they hold
const ITEMS = 100; // array items and object keys shown per level
const DEPTH = 5; // levels of an object shown

// ---------- the scope ----------

// Everything the rednode package exports, without imports.
for (const [k, v] of Object.entries(rednode)) if (!(k in globalThis)) globalThis[k] = v;

// Shortcuts for routine jobs, listed by help().
const HELP = [
  ['addItem(id, count?)', 'puts items in V\'s inventory: addItem("Items.slim_fit_pants")'],
  ['removeItem(id, count?)', 'takes items out of V\'s inventory'],
  ['pos()', "V's position"],
  ['tp(x, y, z)', 'moves V there'],
  ['clear()', 'empties the output (also Ctrl+L)'],
  ['$1, $2 ...', 'the result of each entry, by its number; $_ is the last one'],
  ['game, api, tweakdb, world, ...', 'the whole rednode package, ready without imports'],
];
globalThis.addItem = (id, count = 1) => game.player.addItem(id, count).then(() => `${count} × ${id} added`);
globalThis.removeItem = (id, count = 1) => game.player.removeItem(id, count);
globalThis.pos = () => game.player.position();
globalThis.tp = (x, y, z) => game.player.teleport({ x, y, z });
globalThis.clear = () => {
  kept.length = 0;
  channel.post({ type: 'clear' });
};
globalThis.help = () => {
  info(['The Console runs JavaScript with REDnode ready. Enter runs, Shift+Enter adds a line, Up and Down go through history, Tab completes.', ...HELP.map(([a, b]) => `  ${a.padEnd(32)}${b}`), "let and const at the top level act like var, so an entry can run again. The docs: Overlay apps guide, 'The rednode package'."].join('\n'));
};

// ---------- the evaluator ----------

const out = new PassThrough();
const server = repl.start({ input: new PassThrough(), output: out, terminal: false, useGlobal: true, prompt: '' });
let pending = null; // the entry running now: { resolve }

// Errors from the evaluator's domain: the running entry's, or one thrown later.
out.on('data', (chunk) => {
  for (const block of String(chunk).split(/^(?=Uncaught )/m)) {
    const text = cleanError(block);
    if (!text) continue;
    if (pending) {
      const p = pending;
      pending = null;
      p.resolve({ error: text });
    } else push({ kind: 'error', text });
  }
});

// The first line and the frames in the player's code; the evaluator's own frames go.
function cleanError(block) {
  const lines = block.replace(/^Uncaught /, '').trimEnd().split('\n');
  if (!lines[0]) return '';
  return [lines[0], ...lines.slice(1).filter((l) => /\bat .*console:\d/.test(l))].join('\n');
}

// Top-level let and const become var, so running an entry again does not fail with
// "already declared". Only at depth 0, outside strings and comments.
function lenient(code) {
  let out = '';
  let depth = 0;
  let start = true; // at the start of a statement
  for (let i = 0; i < code.length; ) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
      start = false;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      const j = code.indexOf('\n', i);
      const end = j < 0 ? code.length : j;
      out += code.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const j = code.indexOf('*/', i + 2);
      const end = j < 0 ? code.length : j + 2;
      out += code.slice(i, end);
      i = end;
      continue;
    }
    if (depth === 0 && start) {
      const m = /^(let|const)(?=\s+[\w$[{])/.exec(code.slice(i));
      if (m) {
        out += 'var';
        i += m[1].length;
        start = false;
        continue;
      }
    }
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === ';' || c === '\n' || (c === '}' && depth === 0)) start = true;
    else if (!/\s/.test(c)) start = false;
    out += c;
    i++;
  }
  return out;
}

function evaluate(code) {
  return new Promise((resolve) => {
    pending = { resolve };
    try {
      server.eval(`${lenient(code)}\n`, globalThis, 'console', (err, value) => {
        if (pending?.resolve !== resolve) return;
        pending = null;
        if (err instanceof repl.Recoverable) resolve({ unfinished: true });
        else if (err) resolve({ error: cleanError(String(err.stack ?? err)) });
        else resolve({ value });
      });
    } catch (err) {
      pending = null;
      resolve({ error: String(err?.stack ?? err) });
    }
  });
}

// ---------- showing values ----------

const isRef = (v) => v !== null && typeof v === 'object' && typeof v.$ref === 'number' && typeof v.$type === 'string';

/** A value as a tree the page can fold: { t: kind, s: text, kids?: [{ k, v }], more? }. */
function tree(v, depth = 0, seen = new WeakSet()) {
  if (v === null) return { t: 'null', s: 'null' };
  switch (typeof v) {
    case 'undefined':
      return { t: 'null', s: 'undefined' };
    case 'string':
      return { t: 'str', s: JSON.stringify(v) };
    case 'number':
    case 'boolean':
      return { t: 'num', s: String(v) };
    case 'bigint':
      return { t: 'num', s: `${v}n` };
    case 'symbol':
      return { t: 'sym', s: v.toString() };
    case 'function': {
      const name = typeof v.name === 'string' && v.name ? v.name : 'anonymous';
      return { t: 'fn', s: `ƒ ${name}()` };
    }
  }
  if (isRef(v)) return { t: 'ref', s: `${v.$type} #${v.$ref}` };
  if (v instanceof Error) return { t: 'err', s: cleanError(String(v.stack ?? v)) || String(v) };
  if (v instanceof Date) return { t: 'num', s: v.toISOString() };
  if (v instanceof RegExp) return { t: 'str', s: String(v) };
  if (typeof v.then === 'function') return { t: 'null', s: 'Promise' };
  if (seen.has(v)) return { t: 'null', s: '[circular]' };
  seen.add(v);
  let entries;
  let label;
  if (Array.isArray(v)) {
    entries = v.slice(0, ITEMS).map((x, i) => [String(i), x]);
    label = `Array(${v.length})`;
  } else if (v instanceof Map) {
    entries = [...v].slice(0, ITEMS).map(([k, x]) => [String(k), x]);
    label = `Map(${v.size})`;
  } else if (v instanceof Set) {
    entries = [...v].slice(0, ITEMS).map((x, i) => [String(i), x]);
    label = `Set(${v.size})`;
  } else {
    const keys = Object.keys(v);
    entries = keys.slice(0, ITEMS).map((k) => [k, v[k]]);
    // From the prototype, not v.constructor: api's proxies answer any property with a game function.
    const name = Object.getPrototypeOf(v)?.constructor?.name;
    label = typeof name === 'string' && name !== 'Object' ? name : '';
  }
  const total = Array.isArray(v) ? v.length : v instanceof Map || v instanceof Set ? v.size : Object.keys(v).length;
  const node = { t: Array.isArray(v) || v instanceof Set ? 'arr' : 'obj', s: label, n: total };
  if (depth >= DEPTH) return { ...node, s: `${label}${node.t === 'arr' ? '[…]' : '{…}'}` };
  node.kids = entries.map(([k, x]) => ({ k, v: tree(x, depth + 1, seen) }));
  if (total > entries.length) node.more = total - entries.length;
  return node;
}

// ---------- output, history, the page ----------

const kept = [];
let history = [];
let counter = 0;
const historyFile = path.join(pkg.dataDir, 'history.json');
try {
  history = JSON.parse(fs.readFileSync(historyFile, 'utf8')).slice(-HISTORY);
} catch {
  // none yet
}

function push(entry) {
  kept.push(entry);
  if (kept.length > KEPT) kept.shift();
  channel.post({ type: 'entry', entry });
}
function info(text) {
  push({ kind: 'info', text });
}

// console.log and its kin show in the output, and still reach the Mod log.
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    push({ kind: 'log', level, parts: args.map((a) => (typeof a === 'string' ? { t: 'text', s: a } : tree(a))) });
    original(...args);
  };
}

function remember(code) {
  if (history[history.length - 1] !== code) history.push(code);
  if (history.length > HISTORY) history = history.slice(-HISTORY);
  fs.promises.writeFile(historyFile, JSON.stringify(history)).catch(() => {});
}

let busy = false;
async function run(code) {
  if (busy) return;
  remember(code);
  busy = true;
  channel.post({ type: 'busy', busy: true });
  const n = ++counter;
  push({ kind: 'input', n, code });
  const started = performance.now();
  let r = await evaluate(code);
  // A promise is waited for, as if the entry had awaited it.
  if (!r.error && !r.unfinished && r.value && typeof r.value.then === 'function') {
    try {
      r = { value: await r.value };
    } catch (err) {
      r = { error: err instanceof Error ? cleanError(String(err.stack ?? err)) || err.message : String(err) };
    }
  }
  const ms = Math.round(performance.now() - started);
  // An entry that printed something and returned nothing, such as help(), shows no "undefined".
  const printed = kept[kept.length - 1]?.kind !== 'input';
  if (r.unfinished) push({ kind: 'error', text: 'The entry is not finished: add the rest (Shift+Enter starts a new line).' });
  else if (r.error) push({ kind: 'error', text: code.includes('\n') ? r.error : r.error.split('\n')[0], ms });
  else if (r.value === undefined && printed) {
    // nothing more to show
  } else {
    if (r.value !== undefined) {
      globalThis[`$${n}`] = r.value;
      globalThis.$_ = r.value;
      delete globalThis[`$${n - RESULTS}`];
    }
    push({ kind: 'result', n, value: tree(r.value), ms, named: r.value !== undefined });
  }
  busy = false;
  channel.post({ type: 'busy', busy: false });
}

function complete(id, line) {
  try {
    server.complete(line, (err, result) => {
      const [list, prefix] = err || !result ? [[], ''] : result;
      channel.post({ type: 'complete', id, list: list.filter((x) => x && !x.startsWith('__')).slice(0, 200), prefix });
    });
  } catch {
    channel.post({ type: 'complete', id, list: [], prefix: '' });
  }
}

channel.on((m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'hello') channel.post({ type: 'state', entries: kept, history, busy });
  else if (m.type === 'run' && typeof m.code === 'string' && m.code.trim()) void run(m.code);
  else if (m.type === 'complete' && typeof m.line === 'string') complete(m.id, m.line);
  else if (m.type === 'clear') globalThis.clear();
});

channel.post({ type: 'ready' });
info('REDnode Console. Type JavaScript and press Enter: try addItem("Items.slim_fit_pants"), or help() for more.');
