// Keeps a mod's Nexus Mods page in step with its repo, through Nexus's v3 API (tools/nexus/api.mjs).
//
//   node tools/nexus/nexus.mjs pull   [dir]   the live description into <dir>/description.bbcode, ids into <dir>/nexus.json
//   node tools/nexus/nexus.mjs status [dir]   the page's version and files, and whether its description matches the repo
//   node tools/nexus/nexus.mjs check  [dir] --version <v>
//         what a release would do, and whether it may: stops when the description changed on Nexus
//   node tools/nexus/nexus.mjs release [dir] --version <v> --zip <file> [--notes <file>] [--dry-run]
//         uploads the zip as the main file's new version (the old one archived), or as the main
//         file itself on a page with no files yet, adds the version's changelog, and pushes
//         description.bbcode when it differs from the live one
//
// <dir> is the folder with nexus.json (default: nexus). nexus.json names the page ("page": 35419)
// and how the file is uploaded ("upload"); pull adds the internal mod id, the main file's id and
// the hash of the description it pulled. "primary" makes the new version the page's Primary file, its
// default download, and is true on every page, also with "modManager": false: sent as false, a new
// version never takes over and Primary stays on an old one. A page released with tags of its own sets their prefix
// ("tag": "wardrobe-designer-v"); without it the page's release tags are v<version>.
//
// The description is pushed only when the live one is what the repo last saw: the one pulled
// (nexus.json's hash) or the one the previous release pushed (description.bbcode at the previous
// release tag, v* or nexus.json's "tag" prefix). Anything else is an edit made on Nexus since,
// and the release stops before it uploads anything, so that edit is never overwritten: pull,
// merge, commit, and run it again.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { api, modByPage, uploadArchive } from './api.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const values = new Set(['--version', '--zip', '--notes'].flatMap((o) => (args.includes(o) ? [args[args.indexOf(o) + 1]] : [])));
const [cmd, dirArg = 'nexus'] = args.filter((a) => !a.startsWith('--') && !values.has(a));
const dryRun = args.includes('--dry-run');
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
const repoDescription = () => lf(readFileSync(descFile, 'utf8'));
/** A warning: an annotation on the run in CI, a plain line on the dev PC. */
const warn = (title, msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=${title}::${msg}` : msg);

async function mainFile(modId, fileId) {
  if (fileId) return { file: { id: String(fileId) }, versions: (await api('GET', `/mod-files/${fileId}/versions`)).versions };
  const { mod_files: files } = await api('GET', `/mods/${modId}/files`);
  const active = files.filter((f) => f.is_active);
  for (const f of active) {
    const { versions } = await api('GET', `/mod-files/${f.id}/versions`);
    if (versions.some((v) => v.is_primary)) return { file: f, versions };
  }
  if (active.length === 1) return { file: active[0], versions: (await api('GET', `/mod-files/${active[0].id}/versions`)).versions };
  // A new page: the first release creates its main file.
  if (!active.length) return { file: null, versions: [] };
  throw new Error('No primary file on the page, and more than one file: set "file" in nexus.json');
}

/**
 * description.bbcode as the previous release had it, or null: the newest tag with the page's
 * prefix (nexus.json's "tag", "v" when absent) that is not this version's; any, with no version.
 */
function previousReleaseDescription(config, version) {
  const prefix = config.tag ?? 'v';
  try {
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const top = git('rev-parse', '--show-toplevel');
    const tag = git('tag', '--list', `${prefix}*`, '--sort=-v:refname').split('\n').find((t) => t && t !== `${prefix}${version}`);
    if (!tag) return null;
    return { tag, text: git('show', `${tag}:${relative(top, descFile).replace(/\\/g, '/')}`) };
  } catch {
    return null; // no git, no tag, or the file was not there then
  }
}

/** Whether the description may be pushed, and whether it needs to be. Throws when Nexus has an edit the repo has not seen. */
function descriptionPlan(mod, config, version) {
  const live = sha(fromNexus(mod.description));
  const repo = sha(repoDescription());
  if (live === repo) return { push: false, why: 'the repo and Nexus have the same description' };
  if (live === config.pulled?.sha256) return { push: true, why: 'the live description is the one last pulled' };
  const prev = previousReleaseDescription(config, version);
  if (prev && live === sha(prev.text)) return { push: true, why: `the live description is the one ${prev.tag} pushed` };
  throw new Error(
    'The description on Nexus has changed since the last pull and the last release, so pushing would lose that edit. ' +
      `Run node tools/nexus/nexus.mjs pull${dirArg === 'nexus' ? '' : ` ${dirArg}`}, check the diff, commit, and run again.`,
  );
}

async function pull() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const { file } = await mainFile(mod.id, config.file);
  const description = fromNexus(mod.description);
  writeFileSync(descFile, description.endsWith('\n') ? description : description + '\n');
  const next = { ...config, mod: mod.id, ...(file ? { file: Number(file.id) } : {}), pulled: { sha256: sha(description), at: new Date().toISOString(), version: mod.version } };
  writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
  console.log(`Pulled ${mod.name} (page ${config.page}, version ${mod.version}): ${description.length} characters into ${descFile}`);
}

async function status() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const { file, versions } = await mainFile(mod.id, config.file);
  const live = sha(fromNexus(mod.description));
  console.log(`${mod.name}: page ${config.page}, mod ${mod.id}, version ${mod.version}`);
  console.log(
    file
      ? `Main file ${file.id}: ${versions.map((v) => `${v.version}${v.is_primary ? ' (primary)' : ''}${v.category !== 'main' ? ` (${v.category})` : ''}`).join(', ')}`
      : 'No files yet: the first release creates the main file',
  );
  const prev = previousReleaseDescription(config);
  const seen =
    live === config.pulled?.sha256
      ? 'the one last pulled'
      : prev && live === sha(prev.text)
        ? `the one ${prev.tag} pushed`
        : 'CHANGED on Nexus since the last pull and the last release (pull before the next release)';
  console.log(`Description: live is ${seen}; repo ${sha(repoDescription()) === live ? 'same as live' : 'differs from live'}`);
}

/** Reads the page and says what a release of <version> would do; throws if it may not. */
async function plan(version) {
  if (!version) throw new Error('--version is required');
  const config = readConfig();
  if (!config.upload) throw new Error(`nexus.json has no "upload" settings`);
  const mod = await modByPage(config.page);
  const { file, versions } = await mainFile(mod.id, config.file);
  const already = versions.find((v) => v.version === version);
  // The version this one replaces, and Nexus archives when archivePrevious is set: the newest still
  // under Main files. Not simply the Primary one, which can be a version archived since (0.28.0 on
  // EDGEdeck's page and 0.10.2 on REDcode's, while they uploaded with "primary": false).
  const shown = versions.filter((v) => v.category === 'main' && v.version !== version).sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  const previous = shown[0] ?? versions.find((v) => v.is_primary && v.category !== 'archived') ?? null;
  // Older ones still under Main files: the API cannot archive a version by itself, so say so.
  const stale = shown.slice(1);
  const settings = `mod manager download ${config.upload.modManager ? 'on' : 'off'}; ${config.upload.primary ? 'the new Primary file' : 'not Primary'}`;
  console.log(`${mod.name} on Nexus (page ${config.page}): version ${mod.version}, ${file ? `main file ${file.id}` : 'no files yet'}`);
  console.log(
    already
      ? `File: ${version} is already on Nexus (version ${already.id}); no upload and no changelog`
      : !file
        ? `File: create the main file with ${version}; ${settings}; the page's version becomes ${version}`
        : `File: upload ${version} as the main file's new version${previous ? `, replacing ${previous.version}${config.upload.archivePrevious ? ' (archived)' : ''}` : ''}; ${settings}; the page's version becomes ${version}`,
  );
  if (stale.length) console.log(`Also under Main files: ${stale.map((v) => v.version).join(', ')}. Nexus's API cannot archive these; archive them on the page's Files tab (Manage files)`);
  if (!already && !config.upload.primary) warn('Nexus Primary file', `nexus.json has "primary": false, so ${version} will not become the page's Primary file. Set it to true, also with "modManager": false.`);
  // Last, so the file's plan shows even when this stops the release.
  const description = descriptionPlan(mod, config, version);
  console.log(`Description: ${description.push ? 'push' : 'no push'} (${description.why})`);
  return { config, mod, file, already, previous, description };
}

async function check() {
  await plan(option('version'));
}

async function release() {
  const version = option('version');
  const zip = option('zip');
  const notesFile = option('notes');
  if (!zip || !existsSync(zip)) throw new Error(`--zip must name the archive to upload (got ${zip})`);
  const p = await plan(version);
  if (dryRun) return console.log('Dry run: nothing changed on Nexus');
  const up = p.config.upload;

  if (!p.already && !p.file) {
    // A new page: create its main file from the upload (later releases add versions to it).
    const uploadId = await uploadArchive(zip);
    const created = await api('POST', '/mod-files', {
      upload_id: uploadId,
      mod_id: p.mod.id,
      name: up.name,
      description: up.description ? up.description.replaceAll('{version}', version) : null,
      version,
      file_category: up.category ?? 'main',
      primary_mod_manager_download: !!up.primary,
      allow_mod_manager_download: !!up.modManager,
      update_mod_version: true,
    });
    console.log(`Created the main file ${created.id ?? created.mod_file?.id} with ${version}`);
  } else if (!p.already) {
    const uploadId = await uploadArchive(zip);
    const created = await api('POST', `/mod-files/${p.file.id}/versions`, {
      upload_id: uploadId,
      name: up.name,
      description: up.description ? up.description.replaceAll('{version}', version) : null,
      version,
      file_category: up.category ?? 'main',
      primary_mod_manager_download: !!up.primary,
      allow_mod_manager_download: !!up.modManager,
      update_mod_version: true,
      archive_existing_file: !!up.archivePrevious,
      previous_version_id: p.previous?.id ?? null,
    });
    console.log(`Made version ${version} of file ${p.file.id} (${created.version?.id})`);
  }

  if (!p.already) {
    // Changelogs only add: posted once, with the version it belongs to, so a rerun never doubles it.
    const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : '';
    if (notes) {
      await api('POST', `/mods/${p.mod.id}/changelogs`, { version, changelog: notes });
      console.log(`Added the changelog for ${version} (${notes.split('\n').length} lines)`);
    }
  }

  if (p.description.push) {
    await api('PATCH', `/mods/${p.mod.id}`, { description: repoDescription() });
    const after = await modByPage(p.config.page);
    const same = sha(fromNexus(after.description)) === sha(repoDescription());
    console.log(same ? 'Pushed the description' : 'Pushed the description, but Nexus answers with a different text: check the page');
  }

  if (!p.already) {
    // What Nexus made of the upload, read back: update_mod_version is the API's only way to set the
    // page's version, and whether "primary" takes with Mod Manager Download off is unverified.
    const after = await modByPage(p.config.page);
    if (after.version === version) console.log(`The page's version is ${version}`);
    else warn('Nexus page version', `The page's version is still ${after.version}, not ${version}: set it by hand on Nexus (Edit mod page, Version). The API has no other way to set it.`);
    const { versions } = await mainFile(p.mod.id, p.file?.id ?? p.config.file);
    if (versions.find((v) => v.version === version)?.is_primary) console.log(`${version} is the page's Primary file`);
    else if (p.config.upload.primary) warn('Nexus Primary file', `${version} is not the page's Primary file, though nexus.json asks for it: set it by hand on the page's Files tab (Manage files).`);
  }
}

const commands = { pull, status, check, release };
if (!commands[cmd]) {
  console.error('usage: node tools/nexus/nexus.mjs <pull|status|check|release> [dir] [--version <v>] [--zip <file>] [--notes <file>] [--dry-run]');
  process.exit(1);
}
await commands[cmd]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
