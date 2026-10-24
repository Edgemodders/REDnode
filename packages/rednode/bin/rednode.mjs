#!/usr/bin/env node
// The rednode command, for modders' builds.
//
//   rednode describe <service source> [--out <file>]
//
// Reads a service file's source (JavaScript or TypeScript) and writes its description,
// service.json, from the JSDoc and the parameter lists: what the REDnode host reads for
// a package whose built service file has lost its comments (a bundled or TypeScript
// package). By default service.json goes beside the nearest rednode-app.json above the
// source, or beside the source. See docs/services.md and the Overlay apps guide.

import fs from 'node:fs';
import path from 'node:path';
import { describeSource } from '../dist/describe.js';

const [command, ...args] = process.argv.slice(2);

function usage(code) {
  console.log('Usage: rednode describe <service source> [--out <file>]');
  process.exit(code);
}

if (command !== 'describe') usage(command ? 1 : 0);
const source = args.find((a) => !a.startsWith('--'));
if (!source) usage(1);
const outAt = args.indexOf('--out');
let out = outAt >= 0 ? args[outAt + 1] : null;

if (!out) {
  // The package folder: the nearest rednode-app.json above the source.
  let dir = path.dirname(path.resolve(source));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'rednode-app.json'))) break;
    const up = path.dirname(dir);
    if (up === dir) {
      dir = path.dirname(path.resolve(source));
      break;
    }
    dir = up;
  }
  out = path.join(dir, 'service.json');
}

const d = describeSource(fs.readFileSync(source, 'utf8'));
const { warnings, ...json } = d;
fs.writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
const names = Object.keys(d.functions);
console.log(`${out}: ${names.length} function(s) (${names.join(', ')}), ${Object.keys(d.events).length} event(s)`);
for (const w of warnings) console.log(`  note: ${w}`);
