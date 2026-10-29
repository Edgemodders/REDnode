// Shared keys for every EDGE tool: the player's AI service keys, typed once and read by any
// tool on this PC (REDnode #23). MIT, no dependencies. A file each repo copies, as the Nexus
// tool is: keep the copies the same. The canonical copy is REDnode's tools/keys/keys.mjs.
//
//   import { getKey, setKey, hasKey, removeKey } from './keys.mjs';
//   const key = getKey('gemini', { tool: 'EDGEmat' }); // a string, or undefined when not set
//   setKey('gemini', typed);                            // a tool's own "Set key", when it is missing
//
// Where: %APPDATA%\Edgemodders\keys\<service>.txt, one file per service. Service ids are
// lowercase letters, digits and dashes: anthropic, gemini, openai, elevenlabs, or any other.
//
// Format: Windows DPAPI for the current user, written as PowerShell's ConvertFrom-SecureString
// writes it (one line of hex). Only the same Windows user on the same PC can read it. A key can
// also be set with no tool at all:
//   Read-Host 'Key' -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:APPDATA\Edgemodders\keys\gemini.txt"
//
// An environment variable wins when set (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
// ELEVENLABS_API_KEY; for another id, its name in capitals with _API_KEY), for CI and for
// clients that pass keys.
//
// Used by: getKey with { tool } records which tool read which key and when, names only, in
// used-by.json beside the keys, for REDnode's Keys window.
//
// A key never leaves this process except into PowerShell's standard input: never printed,
// never on a command line, never in a child process's environment. PowerShell gets a short
// environment of its own, not this process's.
//
// The sync functions block for one PowerShell start (about 1 s) the first time a key is read
// or written; a read is then cached until its file changes, an unreadable file too. `promises` has the same
// functions without blocking, for a host that must stay responsive.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Services with a name and, where the service has one, the start every key has. */
export const SERVICES = {
  anthropic: { name: 'Anthropic', prefix: 'sk-ant-', env: 'ANTHROPIC_API_KEY' },
  gemini: { name: 'Google Gemini', env: 'GEMINI_API_KEY' },
  openai: { name: 'OpenAI', prefix: 'sk-', env: 'OPENAI_API_KEY' },
  elevenlabs: { name: 'ElevenLabs', env: 'ELEVENLABS_API_KEY' },
};

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY = /^[\x21-\x7e]{1,4096}$/; // printable ASCII, no spaces or line breaks

/** The folder holding the keys. EDGEMODDERS_KEYS_DIR moves it, for tests. */
export function keysDir() {
  return process.env.EDGEMODDERS_KEYS_DIR || join(process.env.APPDATA || '', 'Edgemodders', 'keys');
}

function check(service) {
  if (typeof service !== 'string' || !ID.test(service)) {
    throw new Error(`A key's service id is 1 to 40 lowercase letters, digits or dashes, not ${JSON.stringify(service)}`);
  }
}
const fileOf = (service) => join(keysDir(), `${service}.txt`);

/** The environment variable that wins over the file for a service. */
export function envName(service) {
  check(service);
  return SERVICES[service]?.env ?? `${service.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

/** A message when the key does not look like one for the service, else null. */
export function checkKey(service, key) {
  check(service);
  if (typeof key !== 'string' || !KEY.test(key.trim())) return 'A key is one line of letters, digits and signs, with no spaces';
  const prefix = SERVICES[service]?.prefix;
  if (prefix && !key.trim().startsWith(prefix)) return `${SERVICES[service].name} keys start with ${prefix}`;
  return null;
}

// ---------- PowerShell, on a pipe ----------

const PS = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
const DECRYPT =
  "$ErrorActionPreference = 'Stop'; $h = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString $h; " +
  '$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); ' +
  'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }';
const ENCRYPT =
  "$ErrorActionPreference = 'Stop'; $k = [Console]::In.ReadToEnd().Trim(); " +
  '[Console]::Out.Write((ConvertTo-SecureString $k -AsPlainText -Force | ConvertFrom-SecureString))';

// Only what PowerShell needs to start as this user: never this process's own variables.
function psEnv() {
  const env = {};
  for (const k of ['SystemRoot', 'windir', 'SystemDrive', 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'ProgramData', 'ProgramFiles', 'ComSpec']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  if (process.env.SystemRoot) env.PATH = join(process.env.SystemRoot, 'System32');
  return env;
}
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script];
const psOptions = { env: psEnv(), windowsHide: true };

function windowsOnly() {
  if (process.platform !== 'win32') throw new Error('Shared keys are kept with Windows DPAPI: set the environment variable instead on this system');
}

function psSync(script, input) {
  windowsOnly();
  const r = spawnSync(PS, psArgs(script), { ...psOptions, input, encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw new Error(`PowerShell did not start: ${r.error.message}`);
  if (r.status !== 0) return null;
  return r.stdout;
}

function psAsync(script, input) {
  return new Promise((resolve, reject) => {
    windowsOnly();
    const child = spawn(PS, psArgs(script), { ...psOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.resume();
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`PowerShell did not start: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
    child.stdin.end(input, 'utf8');
  });
}

// ---------- the files ----------

// A decrypted key, kept until its file changes: { stamp, key }. A stamp is the file's
// modification time and size.
const cache = new Map();
const stampOf = (file) => {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
};

function writeAtomic(file, text) {
  mkdirSync(keysDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function readUsed() {
  try {
    return JSON.parse(readFileSync(join(keysDir(), 'used-by.json'), 'utf8'));
  } catch {
    return {};
  }
}

function recordUse(service, tool) {
  if (typeof tool !== 'string' || !tool.trim()) return;
  try {
    const used = readUsed();
    used[service] = { ...(used[service] ?? {}), [tool.trim().slice(0, 64)]: new Date().toISOString() };
    writeAtomic(join(keysDir(), 'used-by.json'), JSON.stringify(used, null, 2));
  } catch {
    // The record is for the Keys window only: a key read never fails for it.
  }
}

// One read, shared by the sync and async forms: `decrypt` turns the file's hex into the key.
function readWith(service, opts, decrypt, then) {
  check(service);
  const fromEnv = process.env[envName(service)]?.trim();
  if (fromEnv) {
    recordUse(service, opts?.tool);
    return then(fromEnv);
  }
  const file = fileOf(service);
  const stamp = stampOf(file);
  if (!stamp) return then(undefined);
  const hit = cache.get(service);
  if (hit?.stamp === stamp) {
    if (hit.key) recordUse(service, opts?.tool);
    return then(hit.key);
  }
  return decrypt(readFileSync(file, 'utf8'), (out) => {
    // Unreadable (another Windows user or PC made it): it counts as unset, so the tool asks again.
    const key = out?.trim() || undefined;
    cache.set(service, { stamp, key });
    if (key) recordUse(service, opts?.tool);
    return then(key);
  });
}

function prepareWrite(service, key) {
  check(service);
  if (typeof key !== 'string' || !KEY.test(key.trim())) throw new Error('A key is one line of letters, digits and signs, with no spaces');
  return key.trim();
}
function finishWrite(service, key, hex) {
  if (!hex?.trim()) throw new Error('Windows could not encrypt the key for this user');
  const file = fileOf(service);
  writeAtomic(file, `${hex.trim()}\r\n`);
  cache.set(service, { stamp: stampOf(file), key });
}

// ---------- the API ----------

/**
 * The key for a service: the environment variable when set, else the shared file. Undefined
 * when neither is set, or when the file cannot be decrypted by this Windows user.
 * `tool` names the tool reading it, for the "used by" record.
 */
export function getKey(service, opts = {}) {
  return readWith(service, opts, (hex, done) => done(psSync(DECRYPT, hex)), (k) => k);
}

/** Saves a key in the shared store, replacing any. The environment variable still wins when set. */
export function setKey(service, key) {
  const k = prepareWrite(service, key);
  finishWrite(service, k, psSync(ENCRYPT, k));
}

/** Whether a key is set, by its variable or its file, with no decryption. */
export function hasKey(service) {
  check(service);
  return !!process.env[envName(service)]?.trim() || existsSync(fileOf(service));
}

/** Removes a service's file (not its environment variable). True when there was one. */
export function removeKey(service) {
  check(service);
  cache.delete(service);
  const file = fileOf(service);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

function infoOf(service, key) {
  const fromEnv = !!process.env[envName(service)]?.trim();
  const file = fileOf(service);
  const onDisk = existsSync(file);
  const used = readUsed()[service] ?? {};
  return {
    service,
    name: SERVICES[service]?.name ?? service,
    set: !!key,
    source: fromEnv ? 'env' : key ? 'file' : null,
    env: envName(service),
    last4: key && key.length > 8 ? key.slice(-4) : null,
    unreadable: !fromEnv && onDisk && !key,
    updated: onDisk ? statSync(file).mtime.toISOString() : null,
    usedBy: Object.entries(used)
      .map(([tool, at]) => ({ tool, at }))
      .sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}

/**
 * What a Keys window shows for a service, never the key: whether it is set and where from, its
 * last 4 characters, whether its file cannot be decrypted here, and which tools have read it.
 */
export function keyInfo(service) {
  return infoOf(service, getKey(service));
}

/** The services to show: the known ones, then any other with a file in the store. */
export function listServices() {
  const ids = new Set(Object.keys(SERVICES));
  const dir = keysDir();
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.txt') && ID.test(f.slice(0, -4))) ids.add(f.slice(0, -4));
  return [...ids];
}

/** The same functions without blocking. */
export const promises = {
  getKey: (service, opts = {}) =>
    new Promise((resolve, reject) => {
      try {
        readWith(service, opts, (hex, done) => psAsync(DECRYPT, hex).then(done, reject), resolve);
      } catch (err) {
        reject(err);
      }
    }),
  async setKey(service, key) {
    const k = prepareWrite(service, key);
    finishWrite(service, k, await psAsync(ENCRYPT, k));
  },
  hasKey: async (service) => hasKey(service),
  removeKey: async (service) => removeKey(service),
  async keyInfo(service) {
    return infoOf(service, await promises.getKey(service));
  },
};
