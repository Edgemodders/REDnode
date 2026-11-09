// The world pins' atlas (#43): draws every pin's label, measures where each piece is, and
// tells the host, which tells the plugin. The plugin draws the pieces where the pins are.

const labels = document.getElementById('labels');
const START_X = 24; // below the post and the arrows
const START_Y = 40;
const GAP = 8;
const WIDTH = 1024;

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return [Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)];
}

function distanceText(d) {
  if (d === null || d === undefined) return '';
  return d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`;
}

function render(list) {
  labels.replaceChildren();
  const els = [];
  for (const p of list) {
    const el = document.createElement('div');
    el.className = 'piece label';
    el.style.setProperty('--c', p.color);
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
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    labels.append(el);
    els.push([p.id, el]);
  }
  // Shelf packing: left to right, then the next row, at whole pixels.
  let x = START_X, y = START_Y, rowH = 0;
  for (const [, el] of els) {
    const w = Math.ceil(el.offsetWidth), h = Math.ceil(el.offsetHeight);
    if (x + w > WIDTH - GAP) {
      x = START_X;
      y += rowH + GAP;
      rowH = 0;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = 'visible';
    x += w + GAP;
    rowH = Math.max(rowH, h);
  }
  const measured = {};
  for (const [id, el] of els) measured[id] = rectOf(el);
  window.rednode.pins.layout({
    post: rectOf(document.getElementById('post')),
    arrows: {
      left: rectOf(document.getElementById('arrow-left')),
      right: rectOf(document.getElementById('arrow-right')),
      up: rectOf(document.getElementById('arrow-up')),
      down: rectOf(document.getElementById('arrow-down')),
    },
    labels: measured,
  });
}

window.rednode.on((m) => {
  if (m.event === 'pins') render(m.pins);
});
window.rednode.pins.current().then(render);
