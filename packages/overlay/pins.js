// World pins (#43, WP1): pins packages drop in the world with world.pin, drawn by the plugin.
//
// The host keeps the pins, per package. Their labels, the post and the edge arrows are drawn
// once into one hidden page, the built-in "pins" window (an atlas the plugin never draws whole),
// and again only when a label's text or rounded distance changes. The page measures where each
// piece is and the host sends the plugin a pins.set with those rectangles and every pin's place;
// the plugin reads the camera each frame and draws the pieces where the pins land on the screen
// (native/src/overlay/pins.cpp).
//
// About three times a second the plugin sends pins.camera, the camera's place, for the
// distances. Pins of a package go when it stops, and every pin goes when the game session ends.

'use strict';

const MAX_PINS = 200;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;

function createPins({ sendJson, log, openAtlas, closeAtlas, atlasWindow, toPage }) {
  const pins = new Map(); // id -> pin
  let nextId = 1;
  let camera = null; // { pos: [x, y, z] }
  let layout = null; // the page's last measured rectangles
  let shown = ''; // the labels the page shows now, to send again only on a change

  const distanceOf = (p) => {
    if (!camera) return null;
    const [x, y, z] = camera.pos;
    return Math.hypot(p.at.x - x, p.at.y - y, p.at.z - z);
  };
  const rounded = (d) => (d === null ? null : d < 100 ? Math.round(d) : d < 1000 ? Math.round(d / 10) * 10 : Math.round(d / 100) * 100);

  function labels() {
    return [...pins.values()].map((p) => ({ id: p.id, title: p.title, text: p.text, color: p.color, distance: rounded(distanceOf(p)) }));
  }

  // The page draws the labels; once it has measured them, toPlugin sends the rectangles. Until
  // then the plugin keeps the last list, so a label never shows another pin's place.
  function refresh() {
    if (!pins.size) {
      shown = '';
      layout = null;
      sendJson({ cmd: 'pins.set', pins: [] });
      closeAtlas();
      return;
    }
    openAtlas();
    const list = labels();
    const json = JSON.stringify(list);
    if (json === shown) return;
    shown = json;
    const w = atlasWindow();
    if (w) toPage(w, { event: 'pins', pins: list });
  }

  function toPlugin() {
    const w = atlasWindow();
    if (!w || !layout || !pins.size) return;
    sendJson({
      cmd: 'pins.set',
      window: w.id,
      fov: 'vertical',
      margin: 28,
      postMin: 36,
      postMax: 420,
      post: layout.post,
      arrows: layout.arrows,
      pins: [...pins.values()]
        .filter((p) => layout.labels[p.id])
        .map((p) => ({ id: p.id, at: [p.at.x, p.at.y, p.at.z], height: p.height, label: layout.labels[p.id] })),
    });
  }

  function placeOf(at) {
    const x = Number(at?.x), y = Number(at?.y), z = Number(at?.z);
    if (![x, y, z].every(Number.isFinite)) throw new Error('world.pin needs at: { x, y, z }, a place in the world in metres');
    return { x, y, z };
  }

  return {
    count: () => pins.size,

    /** A package's new pin. Answers its id. */
    add(owner, options) {
      if (pins.size >= MAX_PINS) throw new Error(`world.pin: at most ${MAX_PINS} pins at once`);
      const title = String(options?.title ?? '').slice(0, 80);
      if (!title) throw new Error('world.pin needs a title');
      const color = typeof options?.color === 'string' && COLOR.test(options.color) ? options.color : '#19f3ff';
      const height = Number.isFinite(Number(options?.height)) ? Math.min(Math.max(Number(options.height), 0), 200) : 3;
      const pin = { id: nextId++, owner, at: placeOf(options?.at), title, text: options?.text ? String(options.text).slice(0, 160) : '', color, height };
      pins.set(pin.id, pin);
      if (pins.size === 1) log(`Pins: ${owner ?? 'a tool'} dropped the first pin`);
      refresh(); // the plugin hears of it once the page has laid it out
      return pin.id;
    },

    remove(owner, id) {
      const pin = pins.get(Number(id));
      if (!pin) return false;
      if (owner && pin.owner !== owner) throw new Error(`pin ${id} belongs to ${pin.owner}`);
      pins.delete(pin.id);
      refresh();
      return true;
    },

    list(owner) {
      return [...pins.values()]
        .filter((p) => !owner || p.owner === owner)
        .map((p) => ({ id: p.id, owner: p.owner, at: { ...p.at }, title: p.title, text: p.text, color: p.color, height: p.height, distance: distanceOf(p) }));
    },

    clear(owner) {
      let n = 0;
      for (const p of [...pins.values()]) if (!owner || p.owner === owner) pins.delete(p.id), n++;
      if (n) refresh();
      return n;
    },

    /** A package stopped, or the session ended (owner null: every pin). */
    gone(owner, why) {
      const n = this.clear(owner);
      if (n) log(`Pins: removed ${n} pin(s) of ${owner ?? 'every package'} (${why})`);
    },

    /** The plugin's pins.camera: the distances change. */
    camera(m) {
      if (!Array.isArray(m.pos) || m.pos.length < 3) return;
      camera = { pos: m.pos.map(Number) };
      if (pins.size) refresh();
    },

    /** The page measured its pieces. */
    layout(l) {
      if (!l || typeof l !== 'object' || !l.labels) return;
      layout = { post: l.post, arrows: l.arrows ?? {}, labels: l.labels };
      toPlugin();
    },

    /** For the page when it loads. */
    current: () => labels(),

    /** The game connected again: the plugin has forgotten the pins. */
    resend() {
      shown = '';
      if (pins.size) refresh();
    },
  };
}

module.exports = { createPins };
