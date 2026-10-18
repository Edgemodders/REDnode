// Builds the docs' example apps section (docs/examples, never committed) from the apps
// in packages/overlay/apps: an index page, and a page per app with a live preview and
// its files, each with a copy button. The text around the code is in notes.mjs.
//
//   node tools/examples/build.mjs        (npm run docs:examples)
//
// Previews run the apps' real code against a simulated game (docs/assets/examples/sim):
//   docs/examples/run/<id>/   the app's files, with rednode:// URLs pointed at the docs'
//                             copies; a Node mod gets a runner page and its mod.mjs as mod.js
//   docs/examples/kit/        the UI kit, copied from packages/ui/src
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import hljs from 'highlight.js';
import { GROUPS, NOTES } from './notes.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appsDir = join(repo, 'packages', 'overlay', 'apps');
const out = join(repo, 'docs', 'examples');
const GITHUB = 'https://github.com/Edgemodders/REDnode/blob/main/packages/overlay/apps';
const SIM = '../../../assets/examples/sim'; // from docs/examples/run/<id>/
const KIT = '../../kit/rednode-ui.js';
const FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Rajdhani:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">';
// Same scheme as the docs page, or the browser paints the preview frame opaque.
const SCHEME = '<meta name="color-scheme" content="dark">';
// API names that have a page in the API reference (docs/api, made by TypeDoc).
const API_PAGES = new Set(['game', 'ui', 'api', 'tweakdb', 'world', 'audio', 'agent', 'kernel', 'pkg', 'secrets', 'channel']);

// The samples in the player download, read from the release script.
const SAMPLES = (() => {
  const src = readFileSync(join(repo, 'tools', 'release', 'player-zip.mjs'), 'utf8');
  const m = src.match(/const SAMPLES = \[([^\]]*)\]/);
  return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);
})();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Notes use `code` for code; nothing else is markup.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const KIND_NAMES = { mod: 'Node mod', hud: 'HUD widget', window: 'Overlay app' };
const LANG = { '.html': 'xml', '.css': 'css', '.js': 'javascript', '.mjs': 'javascript', '.json': 'json', '.ts': 'typescript' };
const TEXT = new Set(Object.keys(LANG));

function filesOf(dir, base = dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? filesOf(p, base) : [relative(base, p).replace(/\\/g, '/')];
    })
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}
// index.html, then styles, then scripts, then the manifest, then the rest.
function order(f) {
  if (f === 'index.html') return 0;
  if (f.endsWith('.css')) return 1;
  if (f.endsWith('.js') || f.endsWith('.mjs')) return 2;
  if (f === 'rednode-app.json') return 3;
  return 4;
}

function readApp(id) {
  const dir = join(appsDir, id);
  const manifest = JSON.parse(readFileSync(join(dir, 'rednode-app.json'), 'utf8'));
  const kind = manifest.main ? 'mod' : manifest.kind === 'hud' ? 'hud' : 'window';
  const files = filesOf(dir).map((f) => ({ path: f, text: TEXT.has(extname(f)) ? readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n') : null }));
  return { id, dir, manifest, kind, files, note: NOTES[id] ?? { group: 'tests', summary: manifest.description ?? '' } };
}

// ---------- the preview's copy of an app ----------

function preparePage(html) {
  let page = html
    .replaceAll('rednode://ui/rednode-ui.js', KIT)
    .replaceAll('rednode://sdk/index.js', `${SIM}/rednode.js`);
  // window.rednode and the fonts, before the app's own scripts.
  const inject = `${SCHEME}\n${FONTS}\n<script src="${SIM}/page.js"></script>`;
  page = /<meta charset[^>]*>/i.test(page) ? page.replace(/(<meta charset[^>]*>)/i, `$1\n${inject}`) : page.replace(/<head>/i, `<head>\n${inject}`);
  return page;
}

function runnerPage(app) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${SCHEME}
<title>${esc(app.manifest.name)}</title>
${FONTS}
<script src="${KIT}"></script>
<style>
  /* A Node mod's windows, drawn as the REDnode host draws ui-builder windows. */
  html, body { margin: 0; background: transparent; }
  #stage { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 16px; padding: 2px; }
  rn-window { max-width: 100%; }
  .content { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .column { display: flex; flex-direction: column; gap: 8px; }
  .text { font-size: 15px; line-height: 1.4; color: var(--rn-fg); white-space: pre-wrap; }
  .heading { margin: 4px 0 0; font: 700 14px var(--rn-display); letter-spacing: .12em; text-transform: uppercase; color: var(--rn-accent); }
  .tone-dim { color: var(--rn-dim); }
  .tone-accent { color: var(--rn-accent); }
  .tone-danger { color: var(--rn-danger); }
  .empty { width: 360px; padding: 18px; border: 1px dashed var(--rn-line); color: var(--rn-dim);
    font: 13px var(--rn-mono); background: color-mix(in srgb, var(--rn-bg) 70%, transparent); }
</style>
</head>
<body>
<div id="stage"><div id="empty" class="empty" hidden></div></div>
<script type="module" src="${SIM}/runner.js"></script>
</body>
</html>
`;
}

function copyForPreview(app) {
  const dest = join(out, 'run', app.id);
  mkdirSync(dest, { recursive: true });
  for (const f of app.files) {
    const from = join(app.dir, f.path);
    let to = join(dest, f.path);
    mkdirSync(dirname(to), { recursive: true });
    if (f.path.endsWith('.html')) writeFileSync(to, preparePage(f.text));
    else if (f.path === app.manifest.main) {
      // Served as .js: module workers need a JavaScript MIME type, and not every host knows .mjs.
      to = join(dest, 'mod.js');
      writeFileSync(to, f.text.replace(/from\s+(['"])rednode\1/g, `from '${SIM}/worker.js'`));
    } else cpSync(from, to);
  }
  if (app.kind === 'mod') writeFileSync(join(dest, 'index.html'), runnerPage(app));
}

// ---------- pages ----------

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

function codeBlock(app, name, text, { caption, lang } = {}) {
  const language = lang ?? LANG[extname(name)] ?? 'plaintext';
  const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  const label = caption ?? name;
  return `<figure class="ex-file">
  <figcaption><span class="ex-file-name">${esc(label)}</span><a class="ex-gh" href="${GITHUB}/${app.id}/${esc(name)}">GitHub</a><button class="ex-copy" type="button" title="Copy ${esc(label)}" aria-label="Copy ${esc(label)}">${COPY_ICON}<span>Copy</span></button></figcaption>
  <pre><code class="hljs language-${language}">${html}</code></pre>
</figure>`;
}

// Scripts and styles written inside index.html, shown on their own too.
function inlineParts(text) {
  const scripts = [...text.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="importmap")[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].replace(/^\n/, ''));
  return scripts.map((s) => {
    const lines = s.split('\n');
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    return lines.map((l) => l.slice(indent)).join('\n').trimEnd() + '\n';
  });
}

function apiChip(t) {
  const root = t.split('.')[0];
  if (API_PAGES.has(root) && t.includes('.')) return `<a class="ex-chip" href="../api/variables/${root}.html"><code>${esc(t)}</code></a>`;
  return `<span class="ex-chip"><code>${esc(t)}</code></span>`;
}

function badges(app) {
  const b = [`<span class="ex-badge ex-kind-${app.kind}">${KIND_NAMES[app.kind]}</span>`];
  if (SAMPLES.has(app.id)) b.push('<span class="ex-badge ex-sample" title="Ships in the REDnode player download">In the download</span>');
  for (const p of app.manifest.permissions ?? []) b.push(`<span class="ex-badge" title="Asks for this permission">${esc(p)} permission</span>`);
  for (const r of Object.keys(app.manifest.requires ?? {})) b.push(`<span class="ex-badge" title="Listed in requires">needs ${esc(r)}</span>`);
  return b.join('');
}

function appPage(app, apps) {
  const n = app.note;
  const markup = app.files.filter((f) => /\.(html|css)$/.test(f.path));
  const scripts = app.files.filter((f) => /\.(m?js|ts)$/.test(f.path));
  const inlineScripts = app.files.filter((f) => f.path.endsWith('.html')).flatMap((f) => inlineParts(f.text).map((s) => ({ from: f.path, text: s })));
  const manifestFile = app.files.find((f) => f.path === 'rednode-app.json');
  const others = app.files.filter((f) => !f.text);
  const tabs = [['preview', 'Preview']];
  if (markup.length) tabs.push(['markup', 'HTML / CSS']);
  if (scripts.length || inlineScripts.length) tabs.push(['code', 'JavaScript']);
  tabs.push(['manifest', 'Manifest']);

  const w = app.manifest.width ?? 400;
  const h = app.manifest.height ?? 320;
  const idx = apps.findIndex((a) => a.id === app.id);
  const prev = apps[idx - 1];
  const next = apps[idx + 1];

  const panels = {
    preview: `<div class="ex-screen" data-kind="${app.kind}"><div class="ex-stage"><iframe class="ex-frame" src="run/${app.id}/" title="${esc(app.manifest.name)}, running" width="${w}" height="${h}" data-width="${w}" data-height="${h}" data-kind="${app.kind}" allow="autoplay; pointer-lock"></iframe></div></div>
<div class="ex-controls">
  <span class="ex-controls-label">Simulated game</span>
  <button type="button" data-control="load" title="Load a save: PlayerPuppet.OnGameAttached fires, and game object references from before stop working">Load a save</button>
  <button type="button" data-control="menu" data-state="menu" title="Open or close a game menu: the game pauses">Menu</button>
  <button type="button" data-control="photo" data-state="photoMode">Photo mode</button>
  <button type="button" data-control="scene" data-state="scene">Scene</button>
  <button type="button" data-control="overlay" title="F10: Showing, Using, Hidden">F10 <b data-overlay>interactive</b></button>
  <button type="button" data-control="hurt">Hurt V</button>
  ${app.kind === 'mod' ? '<span class="ex-mod"><span class="ex-status" data-status>starting</span><button type="button" data-control="restart">Restart</button><button type="button" data-control="stop">Stop</button></span>' : '<span class="ex-mod"><button type="button" data-reload>Reload</button></span>'}
</div>
<div class="ex-log" aria-live="polite"><div class="ex-log-head"><span>Mod log</span><button type="button" data-clear>Clear</button></div><ol data-log></ol></div>
${n.preview ? `<p class="ex-note">${inline(n.preview)}</p>` : ''}`,
    markup: markup.map((f) => codeBlock(app, f.path, f.text)).join('\n'),
    code: [
      ...scripts.map((f) => codeBlock(app, f.path, f.text)),
      ...inlineScripts.map((s, k) => codeBlock(app, s.from, s.text, { caption: `${s.from} (inline script${inlineScripts.length > 1 ? ` ${k + 1}` : ''})`, lang: 'javascript' })),
      '<p class="ex-note">REDnode runs JavaScript. The <code>rednode</code> package also has TypeScript types, so an editor checks these calls; compile TypeScript to <code>.mjs</code> first.</p>',
    ].join('\n'),
    manifest:
      codeBlock(app, 'rednode-app.json', manifestFile.text) +
      `\n<p class="ex-note">The manifest names the package and says how REDnode runs it. Its fields are in <a href="../overlay-apps.html">Overlay apps</a>.</p>` +
      (others.length ? `\n<p class="ex-note">Other files: ${others.map((f) => `<a href="${GITHUB}/${app.id}/${esc(f.path)}"><code>${esc(f.path)}</code></a>`).join(', ')}.</p>` : ''),
  };

  const body = `<h1>${esc(app.manifest.name)}</h1>
<div class="ex">
<p class="ex-crumb"><a href="./">Example apps</a> / <code>${esc(app.id)}</code> / v${esc(app.manifest.version ?? '')}</p>
<p class="ex-badges">${badges(app)}</p>
<p class="ex-lede">${inline(n.summary)}</p>
<div class="ex-tabs" role="tablist" aria-label="${esc(app.manifest.name)}">
${tabs.map(([k, label], i) => `  <button type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${k}">${label}</button>`).join('\n')}
</div>
${tabs.map(([k], i) => `<section class="ex-panel" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" data-panel="${k}"${i ? ' hidden' : ''}>\n${panels[k]}\n</section>`).join('\n')}
${n.how?.length ? `<h2>How it works</h2>\n${n.how.map((p) => `<p>${inline(p)}</p>`).join('\n')}` : ''}
${n.teaches?.length ? `<h2>What it uses</h2>\n<p class="ex-chips">${n.teaches.map(apiChip).join(' ')}</p>` : ''}
${n.tryThis?.length ? `<h2>Try this</h2>\n<ul>${n.tryThis.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>` : ''}
<h2>Use it</h2>
<p>Copy the files into <code>red4ext/plugins/REDnode/apps/${esc(app.id)}/</code> in the game folder, or start your own package from them: change <code>id</code> and <code>name</code> in the manifest first. The whole folder is on <a href="${GITHUB}/${app.id}">GitHub</a>.</p>
<nav class="ex-pager">${prev ? `<a href="${prev.id}.html">&larr; ${esc(prev.manifest.name)}</a>` : '<span></span>'}<a href="./">All examples</a>${next ? `<a href="${next.id}.html">${esc(next.manifest.name)} &rarr;</a>` : '<span></span>'}</nav>
</div>`;
  return page(`${app.manifest.name} · Example apps`, body);
}

function page(title, body) {
  // raw: the code may hold Liquid-like text. The h1 stays the first element, as the
  // site's heading style expects; the stylesheet follows it.
  const cut = body.indexOf('</h1>') + 5;
  return `---\nlayout: default\ntitle: ${JSON.stringify(title)}\n---\n{% raw %}${body.slice(0, cut)}{% endraw %}\n<link rel="stylesheet" href="{{ '/assets/examples/examples.css' | relative_url }}">\n{% raw %}\n${body.slice(cut)}\n{% endraw %}\n<script src="{{ '/assets/examples/examples.js' | relative_url }}" defer></script>\n`;
}

function indexPage(apps) {
  const card = (a) => `<a class="ex-card" href="${a.id}.html" data-kind="${a.kind}" data-search="${esc(`${a.manifest.name} ${a.id} ${(a.note.teaches ?? []).join(' ')} ${a.note.summary}`.toLowerCase())}">
  <span class="ex-card-head"><b>${esc(a.manifest.name)}</b><span class="ex-badge ex-kind-${a.kind}">${KIND_NAMES[a.kind]}</span></span>
  <span class="ex-card-text">${inline(a.note.summary)}</span>
  <span class="ex-card-api">${(a.note.teaches ?? []).slice(0, 5).map((t) => `<code>${esc(t)}</code>`).join(' ')}</span>
</a>`;
  const groups = GROUPS.map(([key, title, text]) => {
    const list = apps.filter((a) => a.note.group === key);
    if (!list.length) return '';
    return `<section class="ex-group" data-group="${key}">\n<h2>${esc(title)}</h2>\n<p>${esc(text)}</p>\n<div class="ex-cards">\n${list.map(card).join('\n')}\n</div>\n</section>`;
  }).join('\n');
  const body = `<h1>Example apps</h1>
<div class="ex">
<p class="ex-lede">Every app REDnode ships or was tested with, ${apps.length} in all, each running live on its page. Read the code beside the result, copy it with one click, and change it into your own.</p>
<div class="ex-kinds">
  <p><b>Overlay apps</b> are web pages drawn over the game: HTML, CSS and the REDnode UI kit.</p>
  <p><b>HUD widgets</b> are overlay apps that sit on the HUD and never take input.</p>
  <p><b>Node mods</b> run in Node beside the game, and build windows with the <code>ui</code> builder.</p>
</div>
<p class="ex-note">The previews run each app's real code. The game is simulated on this page: V walks about, and the buttons under each preview load a save, open a menu or switch F10 modes, so you can see how an app reacts.</p>
<div class="ex-filter"><input type="search" placeholder="Filter by name or API, e.g. tweakdb" aria-label="Filter examples" data-filter>
<span class="ex-filter-kinds"><button type="button" data-kind-filter="" aria-pressed="true">All</button><button type="button" data-kind-filter="window" aria-pressed="false">Overlay apps</button><button type="button" data-kind-filter="hud" aria-pressed="false">HUD widgets</button><button type="button" data-kind-filter="mod" aria-pressed="false">Node mods</button></span></div>
${groups}
<p class="ex-empty" hidden data-none>No example matches.</p>
</div>`;
  return page('Example apps', body);
}

// ---------- build ----------

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'kit'), { recursive: true });
cpSync(join(repo, 'packages', 'ui', 'src', 'rednode-ui.js'), join(out, 'kit', 'rednode-ui.js'));

const ids = readdirSync(appsDir).filter((d) => existsSync(join(appsDir, d, 'rednode-app.json')));
const apps = ids.map(readApp);
// Pages in the index's order: by group, then as listed in notes.mjs.
const noteOrder = Object.keys(NOTES);
const rank = (a) => GROUPS.findIndex(([k]) => k === a.note.group) * 1000 + (noteOrder.includes(a.id) ? noteOrder.indexOf(a.id) : 999);
apps.sort((a, b) => rank(a) - rank(b));

for (const app of apps) {
  copyForPreview(app);
  writeFileSync(join(out, `${app.id}.html`), appPage(app, apps));
}
writeFileSync(join(out, 'index.html'), indexPage(apps));
const missing = apps.filter((a) => !NOTES[a.id]).map((a) => a.id);
console.log(`Example apps: ${apps.length} pages in docs/examples${missing.length ? `; no notes yet for ${missing.join(', ')}` : ''}`);
