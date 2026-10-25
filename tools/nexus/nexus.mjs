// Keeps a mod's Nexus Mods page in step with its repo, through Nexus's v3 API (tools/nexus/api.mjs).
//
//   node tools/nexus/nexus.mjs pull   [dir]   the live description into <dir>/description.bbcode, ids into <dir>/nexus.json
//   node tools/nexus/nexus.mjs status [dir]   the page's version and files, and whether its description matches the repo
//
// <dir> is the folder with nexus.json (default: nexus). nexus.json names the page ({ "page": 35419 });
// pull adds the internal mod id, the main file's id and the hash of the description it pulled.
// The release workflow pushes the description only when the live one still has that hash, so an
// edit made on Nexus after the last pull is never overwritten.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { api, modByPage } from './api.mjs';

const [cmd, dirArg = 'nexus'] = process.argv.slice(2);
const dir = resolve(dirArg);
const configFile = join(dir, 'nexus.json');
const descFile = join(dir, 'description.bbcode');

// Nexus stores a description with an HTML <br /> on each line and some characters as entities
// (&gt;, &#92; for a backslash). fromNexus turns that back into the plain BBCode the repo keeps,
// with LF line ends; a push sends plain BBCode and Nexus adds its markup again.
const lf = (s) => s.replace(/\r\n/g, '\n');
const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const fromNexus = (s) =>
  lf(s ?? '')
    .replace(/\n?<br\s*\/?>/g, '\n')
    .replace(/&(#\d+|#x[0-9a-f]+|lt|gt|quot|apos|amp);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
    );
// The hash ignores whitespace: Nexus drops the newline after a block such as [/list] or [/quote],
// so a pushed description comes back with the same text but not the same line breaks.
const sha = (s) => createHash('sha256').update(s.replace(/\s+/g, '')).digest('hex');
const readConfig = () => JSON.parse(readFileSync(configFile, 'utf8'));

async function mainFile(modId) {
  const { mod_files: files } = await api('GET', `/mods/${modId}/files`);
  const active = files.filter((f) => f.is_active);
  for (const f of active) {
    const { versions } = await api('GET', `/mod-files/${f.id}/versions`);
    if (versions.some((v) => v.is_primary)) return { file: f, versions };
  }
  if (active.length === 1) return { file: active[0], versions: (await api('GET', `/mod-files/${active[0].id}/versions`)).versions };
  throw new Error('No primary file on the page, and more than one file: set "file" in nexus.json');
}

async function pull() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const { file } = config.file ? { file: { id: String(config.file) } } : await mainFile(mod.id);
  const description = fromNexus(mod.description);
  writeFileSync(descFile, description.endsWith('\n') ? description : description + '\n');
  const next = { ...config, mod: mod.id, file: Number(file.id), pulled: { sha256: sha(description), at: new Date().toISOString(), version: mod.version } };
  writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
  console.log(`Pulled ${mod.name} (page ${config.page}, version ${mod.version}): ${description.length} characters into ${descFile}`);
}

async function status() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const { file, versions } = await mainFile(mod.id);
  const live = sha(fromNexus(mod.description));
  const repo = sha(readFileSync(descFile, 'utf8'));
  console.log(`${mod.name}: page ${config.page}, mod ${mod.id}, version ${mod.version}`);
  console.log(`Main file ${file.id} "${file.name}": ${versions.map((v) => `${v.version}${v.is_primary ? ' (primary)' : ''}${v.archived ? ' (archived)' : ''}`).join(', ')}`);
  console.log(`Description: live ${live === config.pulled?.sha256 ? 'unchanged since the last pull' : 'CHANGED on Nexus since the last pull'}; repo ${repo === live ? 'same as live' : 'differs from live'}`);
}

const commands = { pull, status };
if (!commands[cmd]) {
  console.error('usage: node tools/nexus/nexus.mjs <pull|status> [dir]');
  process.exit(1);
}
await commands[cmd]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
