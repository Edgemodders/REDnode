// Builds REDswap's own zip for its Nexus page (mod 36172) and the GitHub release, from the
// staged plugin (.\tools\build-native.ps1). REDnode's player zip carries REDswap too; this
// zip is for players and tools that want REDswap alone.
//
//   npm run release:redswap               the zip, checked against native/redswap/changelog.md
//   npm run release:redswap -- --draft    without the changelog checks, for a test build
//
// Output: native/build/release/REDswap-<version>.zip, laid out like the game folder:
//   red4ext/plugins/REDswap/REDswap.dll
//   red4ext/plugins/REDswap/LICENSE.txt, LICENSE-RedHotTools.txt, README.txt
//
// The version is REDswap's own, in native/redswap/redswap.json. Like an app pack, its changelog
// must be released: a section for the version, and nothing left under Unreleased.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const draft = process.argv.includes('--draft');
const dir = join(repo, 'native', 'redswap');
const info = JSON.parse(readFileSync(join(dir, 'redswap.json'), 'utf8'));
const staged = join(repo, 'native', 'build', 'dist', 'red4ext', 'plugins', 'REDswap');

if (!existsSync(join(staged, 'REDswap.dll'))) throw new Error('REDswap.dll is not staged. Run .\\tools\\build-native.ps1 first.');

if (!draft) {
  const changelog = readFileSync(join(dir, 'changelog.md'), 'utf8');
  if (!new RegExp(`^## ${info.version.replace(/\./g, '\\.')} \\(`, 'm').test(changelog)) {
    throw new Error(`native/redswap/changelog.md has no "## ${info.version} (<date>)" section. Rename Unreleased first, or pass --draft for a test build`);
  }
  const unreleased = changelog.match(/^## Unreleased\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (unreleased && unreleased[1].trim()) {
    throw new Error('native/redswap/changelog.md has changes under Unreleased. Raise "version" in native/redswap/redswap.json and rename Unreleased to "## <version> (<date>)", or pass --draft for a test build');
  }
}

const out = join(repo, 'native', 'build', 'release');
const stage = join(out, 'stage-redswap');
const target = join(stage, 'red4ext', 'plugins', 'REDswap');
const zip = join(out, `REDswap-${info.version}${draft ? '-draft' : ''}.zip`);
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(target, { recursive: true });

cpSync(join(staged, 'REDswap.dll'), join(target, 'REDswap.dll'));
cpSync(join(staged, 'LICENSE-RedHotTools.txt'), join(target, 'LICENSE-RedHotTools.txt'));
cpSync(join(repo, 'LICENSE'), join(target, 'LICENSE.txt'));
writeFileSync(
  join(target, 'README.txt'),
  [
    `REDswap ${info.version}: swaps archives into the running game, for Cyberpunk 2077 (PC).`,
    '',
    'For game version 2.5 (RED4ext 1.31 or later). Needs RED4ext. REDnode installs REDswap too;',
    'if you have REDnode, this is the same plugin.',
    '',
    'For scripts and other plugins, three global functions:',
    '  REDswap_Version() -> String',
    '  REDswap_Check() -> String               empty when REDswap can swap in this game',
    '  REDswap_Swap(files: String) -> String   absolute paths joined by "|"; answers JSON',
    '',
    'Its log: red4ext/logs/redswap-*.log.',
    '',
    'The swap is ported from RED Hot Tools (MIT, Copyright (c) 2022 Pavel Siberx),',
    'https://github.com/psiberx/cp2077-red-hot-tools; its license is in LICENSE-RedHotTools.txt.',
    'REDswap is MIT too (LICENSE.txt).',
    '',
    'Source and changelog: https://github.com/Edgemodders/REDnode/tree/main/native/redswap',
    '',
  ].join('\r\n'),
);

// Windows' own tar writes zip files (-a picks the format from the name). Git's tar does not.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const packed = spawnSync(tar, ['-a', '-c', '-f', zip, 'red4ext'], { cwd: stage, stdio: 'inherit' });
if (packed.status !== 0) throw new Error('Zipping failed');

const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
console.log(`${zip}: ${(statSync(zip).size / 1024).toFixed(0)} KB, ${count(stage)} files`);
