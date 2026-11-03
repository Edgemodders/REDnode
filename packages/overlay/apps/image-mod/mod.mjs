// Image mod: ui.image in a Node mod's window. Two pictures side by side: one from the
// package's folder, one the mod writes into its data folder (pkg.dataDir) and draws again
// over the same file. Also a picture from bytes, a larger view on click, and two pictures
// that cannot be shown, to see what the window says.

import { pkg, ui } from 'rednode';

// ---------- a small PNG writer: RGB pixels, stored (not compressed), no library ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type, data) {
  const head = [...type].map((ch) => ch.charCodeAt(0));
  const body = new Uint8Array(head.length + data.length);
  body.set(head);
  body.set(data, head.length);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

// zlib with stored blocks of up to 65,535 bytes each, and the Adler-32 check at the end.
function zlibStored(raw) {
  const out = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const part = raw.subarray(at, at + 65535);
    const last = at + 65535 >= raw.length ? 1 : 0;
    out.push(last, part.length & 0xff, part.length >>> 8, ~part.length & 0xff, (~part.length >>> 8) & 0xff);
    for (const b of part) out.push(b);
    if (!raw.length) break;
  }
  let a = 1;
  let b = 0;
  for (const x of raw) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  out.push(...u32(((b << 16) | a) >>> 0));
  return new Uint8Array(out);
}

/**
 * A PNG of `width` by `height` pixels; `pixel(x, y)` answers [r, g, b], each 0 to 255.
 * @returns {Uint8Array}
 */
function png(width, height, pixel) {
  const raw = new Uint8Array(height * (1 + width * 3));
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[i++] = r;
      raw[i++] = g;
      raw[i++] = b;
    }
  }
  const header = [...u32(width), ...u32(height), 8, 2, 0, 0, 0]; // 8 bits, RGB
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', new Uint8Array(header)),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

// A picture to show: a hat-like shape over a gradient, in a hue from 0 to 360.
function picture(size, hue, label = 0) {
  const rgb = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  };
  const back = (y) => rgb((hue + 180) % 360, 0.35, 0.12 + (0.18 * y) / size);
  return png(size, size, (x, y) => {
    const u = x / size - 0.5;
    const v = y / size - 0.5;
    const brim = Math.abs(v - 0.12) < 0.05 && Math.abs(u) < 0.42;
    const crown = v < 0.1 && v > -0.28 && Math.abs(u) < 0.22 - (v + 0.28) * 0.12;
    const band = crown && Math.abs(v - 0.02) < 0.03;
    const dots = label && Math.abs(v + 0.4) < 0.03 && Math.abs(u) < 0.03 * label && Math.round((u + 1) * 33) % 2 === 0;
    if (band) return rgb(hue, 0.9, 0.6);
    if (brim || crown) return rgb(hue, 0.55, 0.35 + 0.15 * (0.5 - v));
    if (dots) return [255, 255, 255];
    return back(y);
  });
}

// ---------- the window ----------

let hue = 20;
let drawn = 0;
const status = ui.text('Press Draw to write a picture into the data folder.', { tone: 'dim' });
const say = (text, tone = 'normal') => status.set({ text, tone });

// node:fs is loaded when first needed, so the docs preview (no file access) still runs.
async function draw() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const file = path.join(pkg.dataDir, 'drawn.png');
  hue = (hue + 67) % 360;
  drawn++;
  fs.mkdirSync(pkg.dataDir, { recursive: true });
  fs.writeFileSync(file, picture(256, hue, drawn % 4 || 4));
  // The same path again: REDnode shows the file as it is now.
  right.set({ src: file, alt: `Drawn ${drawn}` });
  say(`Drawn ${drawn} times over ${file}. Click it for a larger view.`);
  return file;
}

const left = ui.image('picture.png', { width: 200, alt: 'From the package' });
const right = ui.image(picture(256, hue), {
  width: 200,
  alt: 'From bytes',
  onClick: () => {
    const big = ui.image(right.props.src, { width: 560, alt: 'Larger' });
    ui.window({ id: `large-${Date.now()}`, title: 'Larger', width: 600, height: 640, children: [big] });
  },
});

async function run(what, fn) {
  try {
    await fn();
  } catch (err) {
    say(`${what}: ${err.message}`, 'danger');
  }
}

ui.window({
  title: 'Image mod',
  width: 460,
  height: 520,
  closable: true,
  children: [
    ui.text('Left: picture.png from the package. Right: bytes made by the mod, then a file in its data folder.', { tone: 'dim' }),
    ui.row(left, right),
    status,
    ui.row(
      ui.button('Draw', () => run('Draw', draw)),
      ui.button('From bytes', () =>
        run('From bytes', () => {
          hue = (hue + 67) % 360;
          right.set({ src: picture(256, hue), alt: 'From bytes' });
          say('Bytes from the mod, shown as a data: URL. Click it for a larger view.');
        }),
      { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Missing file', () => left.set({ src: 'not-here.png', alt: 'Missing' }), { variant: 'ghost' }),
      ui.button('Outside', () => left.set({ src: 'C:\\Windows\\win.ini', alt: 'Outside' }), { variant: 'ghost' }),
      ui.button('Back', () => left.set({ src: 'picture.png', alt: 'From the package' }), { variant: 'ghost' }),
    ),
  ],
});
