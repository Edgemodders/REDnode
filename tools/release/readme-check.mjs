// Stops a release whose README does not say it: the repo's README.md must name the version in
// its status line ("Status: 0.56.1 released ..."), and its status badge, when it has one, must
// too (aria-label="status: 0.56.1 released"). The release workflow runs it before it builds,
// as it checks the changelog, so the README never stays on an old release again (it said
// 0.38.1 through four releases, found on 2026-11-03).
//
//   node tools/release/readme-check.mjs [--version <v>] [--readme README.md]
//        [--badge docs/assets/brand/badges/status.svg]
//
// The version is VERSION's, or package.json's when there is no VERSION file. The badge is the
// file the README's <img> for status.svg names, unless --badge says another. The same file in
// every Edgemodders repo: copy it as it is.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const root = process.cwd();

function versionOf() {
  const given = option('--version');
  if (given) return given;
  if (existsSync(join(root, 'VERSION'))) return readFileSync(join(root, 'VERSION'), 'utf8').trim();
  if (existsSync(join(root, 'package.json'))) return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  throw new Error('No version: give --version, or run where VERSION or package.json is');
}

const version = versionOf();
const readmePath = resolve(root, option('--readme') ?? 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const problems = [];

// "Status: 0.56.1 released", with or without bold, as each repo's NOTE block writes it.
// Images are left out: the badge's alt text says "status: ... released" too.
const status = /status:?\**\s*(\S+)\s+released/i.exec(readme.replace(/<img[^>]*>/gi, ''));
if (!status) problems.push(`${readmePath} has no status line ("**Status: ${version} released on <date>** ..."): add one`);
else if (status[1].replace(/\*+$/, '') !== version) problems.push(`${readmePath}'s status line says ${status[1].replace(/\*+$/, '')} released: make it ${version}`);

// The status badge, when the README shows one.
const img = /<img[^>]*src="([^"]*badges\/status\.svg)"[^>]*>/i.exec(readme);
const badgePath = option('--badge') ? resolve(root, option('--badge')) : img ? resolve(dirname(readmePath), img[1]) : null;
if (img && !new RegExp(`alt="status: ${escaped} released"`, 'i').test(img[0])) {
  problems.push(`${readmePath}'s status badge <img> says ${/alt="([^"]*)"/i.exec(img[0])?.[1] ?? 'no alt'}: make its alt "status: ${version} released"`);
}
if (badgePath) {
  if (!existsSync(badgePath)) problems.push(`${badgePath} is missing`);
  else if (!new RegExp(`aria-label="status: ${escaped} released"`, 'i').test(readFileSync(badgePath, 'utf8'))) {
    const said = /aria-label="([^"]*)"/i.exec(readFileSync(badgePath, 'utf8'))?.[1] ?? 'nothing';
    problems.push(`${badgePath} says "${said}": draw it again for "status: ${version} released" (tools/brand/badges.py)`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`README check: ${p}`);
  console.error(`The README must say ${version} is released before the release run. Change it, commit, and run again.`);
  process.exit(1);
}
console.log(`README check: ${version} in the status line${badgePath ? ' and the badge' : ''}`);
