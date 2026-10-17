// REDbridge for packages (W2, kernel.bridge()): WolvenKit's engine behind JSON-RPC,
// a separate GPL-3.0 program (https://github.com/Edgemodders/REDbridge). REDnode
// does not ship it: it finds the copy it fetched itself (the Mod Manager's Get
// REDbridge, W3, bridge-install.js) or the one EDGEdeck or REDcode fetched, starts it
// on the first call with the game folder, and shares it between the packages the
// player allowed. It stops after IDLE_MS without calls; the next call starts it again.
//
// The protocol is JSON-RPC 2.0 on the bridge's stdio, Content-Length framed as
// language servers do; stderr is its log.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { bridgeRoot, dotnet10 } = require('./bridge-install');

const IDLE_MS = 10 * 60 * 1000;
// Editors whose storage folders may hold a fetched REDbridge, and the extensions that fetch it.
const EDITORS = ['Code', 'Code - Insiders', 'VSCodium', 'EDGEkit', 'Cursor'];
// REDcode's id: edgemodders.redcode-cyberpunk since 0.8.2 (the store name collided), edgemodders.redcode
// from 0.6.0, edgemodders.redcode-core before. All three are looked at.
const EXTENSIONS = ['edgemodders.edgedeck', 'edgemodders.redcode-cyberpunk', 'edgemodders.redcode', 'edgemodders.redcode-core'];

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// Copies of REDbridge.exe in <dir>/<tag>/, as { exe, version, source }.
function copiesIn(dir, source) {
  let tags = [];
  try {
    tags = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return tags
    .filter((tag) => !tag.startsWith('.') && isFile(path.join(dir, tag, 'REDbridge.exe')))
    .map((tag) => ({ exe: path.join(dir, tag, 'REDbridge.exe'), version: tag.replace(/^v/, ''), source }));
}

/**
 * REDbridge.exe: a configured path (a file or its folder), REDBRIDGE_EXE, or the newest
 * copy REDnode, EDGEdeck or REDcode fetched. { exe, version, source } or null.
 * aClean (the W3 test's "bridgeTest": "clean" setting) sees only REDnode's own copies.
 */
function findRedbridge(configured, aClean) {
  if (aClean) {
    const own = copiesIn(bridgeRoot(), 'REDnode').sort((a, b) => compareVersions(b.version, a.version));
    return own[0] ?? null;
  }
  for (const [p, source] of [
    [configured, 'the REDnode setting'],
    [process.env.REDBRIDGE_EXE, 'REDBRIDGE_EXE'],
  ]) {
    if (!p) continue;
    const exe = isFile(p) ? p : path.join(p, 'REDbridge.exe');
    if (isFile(exe)) return { exe, version: null, source };
  }
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  // REDnode's own copies first, so a tie in version goes to them (the sort is stable).
  const copies = copiesIn(bridgeRoot(), 'REDnode');
  for (const editor of EDITORS) {
    for (const ext of EXTENSIONS) {
      const dir = path.join(appData, editor, 'User', 'globalStorage', ext, 'bridge');
      copies.push(...copiesIn(dir, `${ext === EXTENSIONS[0] ? 'EDGEdeck' : 'REDcode'} (${editor})`));
    }
  }
  copies.sort((a, b) => compareVersions(b.version, a.version));
  return copies[0] ?? null;
}

/** The message for a package that needs REDbridge when none is found. */
const NOT_INSTALLED =
  'REDbridge is not installed. Press Get REDbridge on this package in the Mod Manager, ' +
  'or get it with EDGEdeck or REDcode in VS Code.';

/**
 * @param {object} host
 * @param {(...args: string[]) => void} host.log
 * @param {() => string | null} host.gameDir      the game folder, for --game
 * @param {() => string | undefined} host.configured  a REDbridge path from the settings
 * @param {() => boolean} host.clean  the W3 test: only REDnode's own copy, only a per-user .NET
 */
function createRedbridge(host) {
  let child = null;
  let found = null;
  let nextId = 1;
  const pending = new Map(); // id -> { resolve, reject, method }
  let idleTimer = null;
  let buffer = Buffer.alloc(0);

  function locate() {
    found = findRedbridge(host.configured(), host.clean());
    return found;
  }

  function start() {
    if (child) return;
    if (!locate()) throw new Error(NOT_INSTALLED);
    // REDbridge needs .NET 10. A machine-wide one it finds by itself; a per-user one is
    // given to the bridge process only (a user-level DOTNET_ROOT once broke other programs).
    const runtime = dotnet10(host.clean());
    if (!runtime) {
      throw new Error('REDbridge needs the .NET 10 runtime. Press Get REDbridge on this package in the Mod Manager to install it for this Windows user.');
    }
    const args = host.gameDir() ? ['--game', host.gameDir()] : [];
    const env = { ...process.env };
    if (!runtime.machine) env.DOTNET_ROOT = runtime.root;
    host.log(`REDbridge ${found.version ?? ''} starting from ${found.source}: ${found.exe}`.replace('  ', ' '));
    const proc = spawn(found.exe, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child = proc;
    buffer = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => onData(chunk));
    readline.createInterface({ input: proc.stderr }).on('line', (line) => host.log(`[REDbridge] ${line}`));
    proc.on('error', (err) => host.log(`REDbridge could not start: ${err.message}`));
    proc.on('exit', (code) => {
      if (child === proc) child = null;
      host.log(`REDbridge ended (code ${code})`);
      for (const [, p] of pending) p.reject(new Error(`REDbridge ended (code ${code}) before answering ${p.method}`));
      pending.clear();
    });
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = buffer.subarray(0, end).toString('ascii');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buffer = buffer.subarray(end + 4); // not a header we understand: skip it
        continue;
      }
      const length = Number(m[1]);
      if (buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
      buffer = buffer.subarray(end + 4 + length);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      const p = msg.id !== undefined && pending.get(msg.id);
      if (!p) continue; // a notification, or an answer nobody waits for
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || `REDbridge error ${msg.error.code}`));
      else p.resolve(msg.result);
      idle();
    }
  }

  function idle() {
    clearTimeout(idleTimer);
    if (pending.size) return;
    idleTimer = setTimeout(() => {
      if (!pending.size && child) {
        host.log('REDbridge idle for 10 minutes; stopping it');
        stop();
      }
    }, IDLE_MS);
  }

  /** Calls a REDbridge method; params by name, as REDbridge's docs list them. */
  function call(method, params) {
    if (typeof method !== 'string' || !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/.test(method)) {
      return Promise.reject(new Error(`Not a REDbridge method: ${method}`));
    }
    try {
      start();
    } catch (err) {
      return Promise.reject(err);
    }
    clearTimeout(idleTimer);
    const id = nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }), 'utf8');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    });
  }

  function stop() {
    clearTimeout(idleTimer);
    const proc = child;
    child = null;
    if (proc) {
      proc.stdin.end();
      proc.kill();
    }
  }

  /**
   * Whether REDbridge is found and running, and where its .NET 10 is ('machine', 'user'
   * or null), for the Mod Manager and kernel.bridge().
   */
  function status() {
    const f = child ? found : locate();
    const runtime = dotnet10(host.clean());
    return {
      found: !!f,
      exe: f?.exe ?? null,
      version: f?.version ?? null,
      source: f?.source ?? null,
      running: !!child,
      dotnet: runtime ? (runtime.machine ? 'machine' : 'user') : null,
    };
  }

  return { call, stop, status };
}

module.exports = { createRedbridge, findRedbridge, compareVersions, NOT_INSTALLED };
