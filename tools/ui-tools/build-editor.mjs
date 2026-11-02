// Builds the UI Workbench's editor: CodeMirror 6 and acorn (both MIT) into one ES module,
// packs/ui-tools/apps/ui-workbench/vendor/editor.js, which the page imports. The file is
// committed, so the pack needs no build step; run this again after changing editor-entry.mjs
// or the packages' versions (devDependencies in the root package.json).
//
//   node tools/ui-tools/build-editor.mjs
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(repo, 'packs', 'ui-tools', 'apps', 'ui-workbench', 'vendor');
const out = join(outDir, 'editor.js');
mkdirSync(outDir, { recursive: true });

// Read from node_modules: the packages' exports leave out package.json.
const pkgDir = (name) => join(repo, 'node_modules', ...name.split('/'));
const version = (name) => JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8')).version;
const parts = ['codemirror', '@codemirror/lang-html', '@codemirror/lang-javascript', 'acorn'].map((n) => `${n} ${version(n)}`);

await build({
  entryPoints: [join(repo, 'tools', 'ui-tools', 'editor-entry.mjs')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'chrome120',
  outfile: out,
  legalComments: 'none',
  banner: {
    js: `// The UI Workbench's editor: ${parts.join(', ')}, bundled by tools/ui-tools/build-editor.mjs.\n// CodeMirror: MIT, (c) Marijn Haverbeke and others. acorn: MIT, (c) Marijn Haverbeke, Ingvar Stepanyan and others.\n// Their licence texts: LICENSES.txt beside this file.`,
  },
});

// The licence texts, from the packages themselves.
const licence = (name) => {
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try {
      return readFileSync(join(pkgDir(name), file), 'utf8').trim();
    } catch {
      // the next name
    }
  }
  return 'MIT';
};
writeFileSync(
  join(outDir, 'LICENSES.txt'),
  ['codemirror', 'acorn'].map((n) => `== ${n} ${version(n)} ==\n\n${licence(n)}\n`).join('\n'),
);
console.log(`${out}: ${Math.round(statSync(out).size / 1024)} KB (${parts.join(', ')})`);
