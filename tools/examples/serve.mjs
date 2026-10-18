// Serves docs/ on http://127.0.0.1:4000 for checking the example pages without Jekyll:
// pages with front matter are wrapped in docs/_layouts/default.html, with just enough
// Liquid (relative_url, raw, the nav) for them to look as they do on the site.
// Markdown pages are not rendered.
//
//   npm run docs:examples && node tools/examples/serve.mjs
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs');
const port = Number(process.env.PORT ?? 4000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
};

const config = readFileSync(join(docs, '_config.yml'), 'utf8');
const nav = [...config.matchAll(/- title: (.+)\r?\n\s+url: (.+)/g)].map((m) => ({ title: m[1].trim(), url: m[2].trim() }));
const layout = readFileSync(join(docs, '_layouts', 'default.html'), 'utf8');

function liquid(text, page) {
  return text
    .replace(/\{\{\s*'([^']+)'\s*\|\s*relative_url\s*\}\}/g, '$1')
    .replace(/\{\{\s*item\.url\s*\|\s*relative_url\s*\}\}/g, '{{item.url}}')
    .replace(/\{%\s*raw\s*%\}|\{%\s*endraw\s*%\}/g, '');
}

function render(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return src;
  const title = (m[1].match(/title:\s*(.+)/)?.[1] ?? '').replace(/^"|"$/g, '');
  const body = liquid(m[2]);
  const navHtml = nav.map((i) => `<a href="${i.url}">${i.title}</a>`).join('');
  return liquid(layout)
    .replace(/\{% for item in site\.nav %\}[\s\S]*?\{% endfor %\}/, navHtml)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title} · REDnode</title>`)
    .replace('{{ content }}', body)
    .replace(/\{\{[^}]*\}\}|\{%[^%]*%\}/g, '');
}

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(docs, path));
  if (!file.startsWith(docs)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) return res.writeHead(404).end('not found');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(extname(file) === '.html' ? render(file) : readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`docs on http://127.0.0.1:${port}/examples/`));
