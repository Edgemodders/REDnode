// Prints the release notes for one version from its section of docs/changelog.md. The release
// workflow uses it for the GitHub release, and stops when the version has no section.
//
//   node tools/release/notes.mjs [version]            markdown for GitHub, with the install line
//   node tools/release/notes.mjs [version] --nexus    the section's short Nexus summary (see below), for
//                                                     Nexus's changelog field; stops when there is none
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

// The section for GitHub: without its Nexus summary (below).
const github = [];
for (let i = 0, inBlock = false; i < section.length; i++) {
  if (!inBlock && section[i].trim() === '<!-- nexus') inBlock = true;
  else if (inBlock && section[i].trim() === '-->') inBlock = false;
  else if (!inBlock) github.push(section[i]);
}

if (nexus) {
  // Nexus shows each line of a version's changelog as one entry, as plain text in a small field,
  // so its lines are a short summary written by hand in the section, not the section itself:
  //
  //   <!-- nexus
  //   New: Hide in the pause menu, on by default (F10 still works there)
  //   Fixed: Update REDbridge while it ran kept the old version
  //   -->
  //
  // An HTML comment, so GitHub and the docs site show none of it. Each line starts with New:,
  // Changed:, Fixed:, Other: or Needs:, has no markdown and at most NEXUS_LINE characters; at most
  // NEXUS_LINES lines. A "Full changelog" line with the link is added at the end.
  const NEXUS_LINE = 120;
  const NEXUS_LINES = 12;
  const open = section.findIndex(line => line.trim() === '<!-- nexus');
  const close = open < 0 ? -1 : section.findIndex((line, i) => i > open && line.trim() === '-->');
  if (open < 0 || close < 0) {
    console.error(`${changelog}: the section for ${version} has no Nexus summary. Add one under its heading:

<!-- nexus
New: one short line per change, at most ${NEXUS_LINE} characters
-->`);
    process.exit(1);
  }
  const summary = section.slice(open + 1, close).map(line => line.trim()).filter(Boolean);
  const wrong = [];
  if (!summary.length) wrong.push('it is empty');
  if (summary.length > NEXUS_LINES) wrong.push(`${summary.length} lines, at most ${NEXUS_LINES}`);
  for (const line of summary) {
    if (!/^(New|Changed|Fixed|Other|Needs): \S/.test(line)) wrong.push(`"${line}" does not start with New:, Changed:, Fixed:, Other: or Needs:`);
    if (line.length > NEXUS_LINE) wrong.push(`"${line.slice(0, 50)}..." is ${line.length} characters, at most ${NEXUS_LINE}`);
    if (/`|\*\*|\]\(/.test(line)) wrong.push(`"${line.slice(0, 50)}..." has markdown`);
  }
  if (wrong.length) {
    console.error(`${changelog}: the Nexus summary for ${version}:\n- ${wrong.join('\n- ')}`);
    process.exit(1);
  }
  const full = own ? 'https://edgemodders.github.io/REDnode/changelog.html' : `https://github.com/Edgemodders/REDnode/blob/main/${changelog}`;
  write([...summary, `Full changelog: ${full}`].join('\n'));
} else if (!own) {
  write(github.join('\n').trim());
} else {
  write(`${github.join('\n').trim()}
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
