// The world pins' atlas (#43): draws every pin's label, and a post and four edge arrows in each
// colour in use, measures where each piece is, and tells the host, which tells the plugin. The
// plugin draws the pieces where the pins are.

const pieces = document.getElementById('pieces');
const labels = document.getElementById('labels');
const WIDTH = 2048;
const HEIGHT = 2048;
const GAP = 8;
const POST_W = 10;
const POST_H = 128; // stretched to each pin's height; 15 colours fit down the page
const ARROW = 28;
const ARROW_SVG = {
  left: 'M16 3 6 12l10 9z',
  right: 'm8 3 10 9-10 9z',
  up: 'm3 16 9-10 9 10z',
  down: 'm3 8 9 10 9-10z',
};

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return [Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)];
}

function distanceText(d) {
  if (d === null || d === undefined) return '';
  return d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`;
}

function place(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

// One post and four arrows per colour, in a row each, from the top of the page.
function drawStyles(colors) {
  pieces.replaceChildren();
  const out = {};
  let y = 4;
  for (const color of colors) {
    if (y + POST_H > HEIGHT - GAP) break; // more colours than fit: those pins use the first
    const post = document.createElement('div');
    post.className = 'piece post';
    post.style.setProperty('--c', color);
    place(post, 4, y);
    pieces.append(post);
    const arrows = {};
    let x = 4 + POST_W + GAP;
    for (const [side, d] of Object.entries(ARROW_SVG)) {
      const a = document.createElement('div');
      a.className = 'piece arrow';
      a.style.setProperty('--c', color);
      a.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${d}" /></svg>`;
      place(a, x, y);
      pieces.append(a);
      arrows[side] = a;
      x += ARROW + GAP;
    }
    out[color] = { post, arrows };
    y += POST_H + GAP;
  }
  return out;
}

function render(list) {
  const colors = [...new Set(list.map((p) => p.color))];
  // The posts take a column on the left; the labels the rest of the page.
  const styles = drawStyles(colors);
  labels.replaceChildren();
  const els = [];
  for (const p of list) {
    const el = document.createElement('div');
    el.className = 'piece label';
    el.style.setProperty('--c', p.color);
    if (p.font) el.style.fontFamily = `${p.font}, 'Rajdhani', 'Bahnschrift', 'Segoe UI', sans-serif`;
    el.style.setProperty('--title', `${p.titleSize ?? 18}px`);
    el.style.setProperty('--text', `${p.textSize ?? 14}px`);
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = p.title;
    el.append(title);
    if (p.text) {
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = p.text;
      el.append(text);
    }
    const dist = document.createElement('div');
    dist.className = 'distance';
    dist.textContent = distanceText(p.distance);
    el.append(dist);
    place(el, 0, 0);
    el.style.visibility = 'hidden';
    labels.append(el);
    els.push([p.id, el]);
  }
  // Shelf packing to the right of the posts, left to right, then the next row, at whole pixels.
  const startX = 4 + POST_W + GAP + 4 * (ARROW + GAP);
  let x = startX, y = 4, rowH = 0;
  const measured = {};
  const full = [];
  for (const [id, el] of els) {
    const w = Math.ceil(el.offsetWidth), h = Math.ceil(el.offsetHeight);
    if (x + w > WIDTH - GAP) {
      x = startX;
      y += rowH + GAP;
      rowH = 0;
    }
    if (y + h > HEIGHT - GAP) {
      full.push(id); // no room: not drawn until others go
      el.remove();
      continue;
    }
    place(el, x, y);
    el.style.visibility = 'visible';
    x += w + GAP;
    rowH = Math.max(rowH, h);
  }
  for (const [id, el] of els) if (el.isConnected) measured[id] = rectOf(el);
  const out = {};
  for (const [color, s] of Object.entries(styles)) {
    out[color] = {
      post: rectOf(s.post),
      arrows: Object.fromEntries(Object.entries(s.arrows).map(([side, a]) => [side, rectOf(a)])),
    };
  }
  window.rednode.pins.layout({ styles: out, labels: measured, full });
}

window.rednode.on((m) => {
  if (m.event === 'pins') render(m.pins);
});
window.rednode.pins.current().then(render);
