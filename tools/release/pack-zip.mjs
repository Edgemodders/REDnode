// Builds an optional app pack's zip for Nexus Mods and GitHub from packs/<pack>, outside
// REDnode's own build. The pack installs into an existing REDnode.
//
//   npm run release:pack                 the Sound Tools pack (the default)
//   npm run release:pack -- <pack>       another pack in packs/
//   npm run release:pack -- --draft      without the changelog check, for a test build
//
// Output: native/build/release/<Pack-Name>-<version>.zip, laid out like the game folder so
// Vortex or a player extracting it by hand puts it in the same place:
//   red4ext/plugins/REDnode/apps/<id>/    each app of the pack, off until the player switches it on
//   red4ext/plugins/REDnode/apps/<id>/LICENSE.txt
//
// packs/<pack>/pack.json names the pack, its version, its apps and the REDnode it needs;
// every app's manifest must ask for that REDnode in "requires", so the Mod Manager says so
// when the player's REDnode is too old.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const draft = args.includes('--draft');
const id = args.find((a) => !a.startsWith('--')) ?? 'sound-tools';
const packDir = join(repo, 'packs', id);
if (!existsSync(join(packDir, 'pack.json'))) throw new Error(`No pack at packs/${id} (pack.json missing)`);
const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));

// Every app of the pack: present, closed at start, asking for the pack's REDnode.
for (const app of pack.apps) {
  const file = join(packDir, 'apps', app, 'rednode-app.json');
  if (!existsSync(file)) throw new Error(`${pack.name}: app ${app} has no rednode-app.json`);
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m.id !== app) throw new Error(`${file}: its id is ${m.id}, the pack lists ${app}`);
  if (m.requires?.rednode !== pack.rednode) {
    throw new Error(`${file}: "requires" must ask for "rednode": "${pack.rednode}", as pack.json does`);
  }
}
const extra = readdirSync(join(packDir, 'apps')).filter((d) => !pack.apps.includes(d));
if (extra.length) throw new Error(`${pack.name}: apps not listed in pack.json: ${extra.join(', ')}`);

// The release notes: a section for this version in the pack's changelog.
const changelog = readFileSync(join(packDir, 'changelog.md'), 'utf8');
const section = new RegExp(`^## ${pack.version.replace(/\./g, '\\.')} \\(`, 'm');
if (!draft && !section.test(changelog)) {
  throw new Error(`packs/${id}/changelog.md has no "## ${pack.version} (<date>)" section. Rename Unreleased first, or pass --draft for a test build`);
}

const out = join(repo, 'native', 'build', 'release');
const stage = join(out, `stage-${id}`);
const target = join(stage, 'red4ext', 'plugins', 'REDnode', 'apps');
const zipName = `${pack.name.replace(/\s+/g, '-')}-${pack.version}${draft ? '-draft' : ''}.zip`;
const zip = join(out, zipName);
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(target, { recursive: true });

for (const app of pack.apps) {
  const to = join(target, app);
  cpSync(join(packDir, 'apps', app), to, { recursive: true });
  const m = JSON.parse(readFileSync(join(to, 'rednode-app.json'), 'utf8'));
  m.open = false;
  writeFileSync(join(to, 'rednode-app.json'), JSON.stringify(m, null, 2) + '\n');
  cpSync(join(repo, 'LICENSE'), join(to, 'LICENSE.txt'));
}

// Windows' own tar writes zip files (-a picks the format from the name). Git's tar does not.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const packed = spawnSync(tar, ['-a', '-c', '-f', zip, 'red4ext'], { cwd: stage, stdio: 'inherit' });
if (packed.status !== 0) throw new Error('Zipping failed');

const count = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
console.log(`${zip}: ${(statSync(zip).size / 1024).toFixed(0)} KB, ${count(stage)} files`);
console.log(`${pack.name} ${pack.version}: ${pack.apps.join(', ')}; needs REDnode ${pack.rednode}`);
