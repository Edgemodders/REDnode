// Prints the release notes for one version from its section of docs/changelog.md. The release
// workflow uses it for the GitHub release, and stops when the version has no section.
//
//   node tools/release/notes.mjs [version]            markdown for GitHub, with the install line
//   node tools/release/notes.mjs [version] --nexus    plain lines for Nexus's changelog field
//   --out <file>                                      writes the notes to a file (UTF-8)
//   --changelog <file>                                another changelog, such as REDswap's
//                                                     (native/redswap/changelog.md): its section
//                                                     alone, with no pack or install lines
//
// The GitHub notes end with a line for each app pack in packs/, whose zip the release workflow
// attaches beside REDnode's (tools/release/pack-zip.mjs).
//
// The GitHub notes also end with a line for REDswap's own zip (tools/release/redswap-zip.mjs).
//
// The version defaults to VERSION.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const nexus = args.includes('--nexus');
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const logAt = args.indexOf('--changelog');
const changelog = logAt >= 0 ? args.splice(logAt, 2)[1].replace(/\\/g, '/') : 'docs/changelog.md';
const own = changelog === 'docs/changelog.md';
const version = args.find(a => !a.startsWith('--')) ?? readFileSync(root + 'VERSION', 'utf8').trim();
const lines = readFileSync(root + changelog, 'utf8').split(/\r?\n/);

// "## 0.26.1" or "## 0.26.1 (2026-10-19)"
const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`);
const start = lines.findIndex(line => heading.test(line));
if (start < 0) {
  console.error(`${changelog} has no section for ${version}: rename Unreleased to "## ${version} (date)" first`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
if (end < 0) end = lines.length;
const section = lines.slice(start + 1, end);
if (!section.some(line => line.trim())) {
  console.error(`${changelog}: the section for ${version} is empty`);
  process.exit(1);
}

if (nexus) {
  // Nexus's changelog takes one plain line per change: no markdown, links as "text (url)".
  const plain = text => text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
  const result = [];
  let group = '';
  for (const line of section) {
    const groupHeading = line.match(/^\*\*(.+)\*\*$/);
    if (groupHeading) group = groupHeading[1];
    else if (line.startsWith('- ')) result.push((group ? `${group}: ` : '') + plain(line.slice(2)));
    else if (line.trim()) result.push(plain(line.trim()));
  }
  write(result.join('\n'));
} else if (!own) {
  write(section.join('\n').trim());
} else {
  write(`${section.join('\n').trim()}
${packNotes()}${redswapNote()}
**Install:** extract into the game folder, or add the zip to Vortex or EDGEdeck. Needs RED4ext and redscript. Packages that read the game's archives also need REDbridge: press **Get REDbridge** in the Mod Manager. Docs: https://edgemodders.github.io/REDnode/ (changelog: https://edgemodders.github.io/REDnode/changelog.html)`);
}

// One line per app pack: its zip, what it is, the REDnode it needs, its guide and changelog.
function packNotes() {
  const dir = root + 'packs/';
  if (!existsSync(dir)) return '';
  const lines = readdirSync(dir)
    .filter((id) => existsSync(`${dir}${id}/pack.json`))
    .map((id) => {
      const p = JSON.parse(readFileSync(`${dir}${id}/pack.json`, 'utf8'));
      const zip = `${p.name.replace(/\s+/g, '-')}-${p.version}.zip`;
      const needs = p.rednode.replace(/^>=\s*/, '');
      const guide = p.guide ? ` Guide: ${p.guide}` : '';
      return `**Also attached: ${p.name} ${p.version}** (\`${zip}\`). ${p.summary ?? ''} Extract it into the game folder after REDnode; it needs REDnode ${needs} or later.${guide} (changelog: https://github.com/Edgemodders/REDnode/blob/main/packs/${id}/changelog.md)`;
    });
  return lines.length ? `\n${lines.join('\n\n')}\n` : '';
}

// REDswap's own zip, attached beside REDnode's: REDnode's zip has it already.
function redswapNote() {
  const file = root + 'native/redswap/redswap.json';
  if (!existsSync(file)) return '';
  const r = JSON.parse(readFileSync(file, 'utf8'));
  return `\n**Also attached: REDswap ${r.version}** (\`REDswap-${r.version}.zip\`), the archive swap plugin on its own, for tools and players without REDnode. REDnode's zip already has it. Nexus: https://www.nexusmods.com/cyberpunk2077/mods/36172 (changelog: https://github.com/Edgemodders/REDnode/blob/main/native/redswap/changelog.md)\n`;
}

function write(text) {
  if (out) writeFileSync(out, text + '\n', 'utf8');
  else console.log(text);
}
