// A small client for Nexus Mods' v3 API (https://api.nexusmods.com/openapi.yaml), shared by
// tools/nexus/nexus.mjs on the dev PC and the release workflow.
//
// The key: in CI the NEXUS_KEY environment variable (the Edgemodders organization's secret). On
// the dev PC, %APPDATA%\Edgemodders\nexus-key.txt, made once with
//   Read-Host 'Nexus API key' -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:APPDATA\Edgemodders\nexus-key.txt"
// which Windows encrypts for this user (DPAPI). The key goes only into the apikey header: never
// printed, never on a command line.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const BASE = process.env.NEXUS_API_BASE || 'https://api.nexusmods.com/v3';
export const GAME = 'cyberpunk2077';

let key = null;

function loadKey() {
  if (key) return key;
  if (process.env.NEXUS_KEY) return (key = process.env.NEXUS_KEY.trim());
  const file = join(process.env.APPDATA || '', 'Edgemodders', 'nexus-key.txt');
  if (process.platform !== 'win32' || !existsSync(file)) {
    throw new Error(`No Nexus key: set NEXUS_KEY, or make ${file} (see tools/nexus/api.mjs)`);
  }
  // PowerShell decrypts the file for this Windows user and writes the key to our pipe only.
  const script =
    `$s = Get-Content -LiteralPath $env:NEXUS_KEY_FILE | ConvertTo-SecureString; ` +
    `[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, NEXUS_KEY_FILE: file },
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (r.status !== 0 || !out) throw new Error(`Could not decrypt ${file} (made by another Windows user or machine?)`);
  return (key = out);
}

/** Calls the API and returns its `data` (or the whole body when there is none). Throws with Nexus's message on an error. */
export async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: loadKey(),
      accept: 'application/json',
      'user-agent': 'Edgemodders-release/1.0',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: keep the text for the error
  }
  if (!res.ok) {
    const why = json?.message || json?.error || json?.errors?.map?.((e) => e.message || e.detail).join('; ') || text.slice(0, 300);
    throw new Error(`${method} ${path}: ${res.status} ${why}`);
  }
  return json && 'data' in json ? json.data : json;
}

/** A mod by the number in its page URL (35419), with its internal id, description and version. */
export const modByPage = (pageId) => api('GET', `/games/${GAME}/mods/${pageId}`);
