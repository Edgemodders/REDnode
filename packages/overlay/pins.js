// World pins (#43): pins packages drop in the world with world.pin, drawn by the plugin.
//
// The host keeps the pins, per package. Their labels, and a post and the edge arrows in each
// colour in use, are drawn once into one hidden page, the built-in "pins" window (an atlas the
// plugin never draws whole), and again only when a label's text, look or rounded distance
// changes. The page measures where each piece is and the host sends the plugin a pins.set with
// those rectangles and every pin's place, scale and the entity it follows; the plugin reads the
// camera each frame and draws the pieces where the pins land on the screen
// (native/src/overlay/pins.cpp).
//
// About three times a second the plugin sends pins.camera, the camera's place and where the
// followed entities went, for the distances. Pins of a package go when it stops, and every pin
// goes when the game session ends.

'use strict';

const MAX_PINS = 200;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const FONT = /^[\w\s,'"-]{1,80}$/;
const SCALES = ['fit', 'world', 'screen'];

// The HUD style: what a pin looks like with no style given.
const BASE = Object.freeze({ color: '#19f3ff', font: null, titleSize: 18, textSize: 14, pinHeight: 3, scale: 'fit', minScreenSize: 0.45 });

const clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// The style fields a caller gave, checked. Unknown fields and wrong values are refused, so a
// typo says so instead of being ignored.
function styleOf(input, what) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(`${what}: style must be an object`);
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const num = Number(value);
    switch (key) {
      case 'color':
        if (typeof value !== 'string' || !COLOR.test(value)) throw new Error(`${what}: style.color must be a colour such as "#19f3ff"`);
        out.color = value;
        break;
      case 'font':
        if (value !== null && (typeof value !== 'string' || !FONT.test(value))) throw new Error(`${what}: style.font must be a font family name, such as "Rajdhani"`);
        out.font = value;
        break;
      case 'titleSize':
        if (!Number.isFinite(num)) throw new Error(`${what}: style.titleSize must be a number of pixels`);
        out.titleSize = clampNum(num, 10, 48);
        break;
      case 'textSize':
        if (!Number.isFinite(num)) throw new Error(`${what}: style.textSize must be a number of pixels`);
        out.textSize = clampNum(num, 8, 36);
        break;
      case 'pinHeight':
        if (!Number.isFinite(num)) throw new Error(`${what}: style.pinHeight must be a number of metres`);
        out.pinHeight = clampNum(num, 0, 200);
        break;
      case 'scale':
        if (!SCALES.includes(value)) throw new Error(`${what}: style.scale must be "fit", "world" or "screen"`);
        out.scale = value;
        break;
      case 'minScreenSize':
        if (!Number.isFinite(num)) throw new Error(`${what}: style.minScreenSize must be a number from 0.1 to 1`);
        out.minScreenSize = clampNum(num, 0.1, 1);
        break;
      default:
        throw new Error(`${what}: style has no field "${key}" (color, font, titleSize, textSize, pinHeight, scale, minScreenSize)`);
    }
  }
  return out;
}

// An entity id hash as the game API passes it: a decimal string, or 0x hex.
function hashOf(v) {
  const s = String(v ?? '').trim();
  if (!/^(\d{1,20}|0x[0-9a-fA-F]{1,16})$/.test(s) || /^0+$/.test(s) || /^0x0+$/i.test(s)) return null;
  return BigInt(s).toString();
}

// `at`: a place { x, y, z }, an entity { hash } (or its hash as a string) whose place the pin
// follows, or both, the place being where it is until the plugin finds it.
function atOf(at) {
  const entity = typeof at === 'string' || typeof at === 'number' ? hashOf(at) : at && typeof at === 'object' && 'hash' in at ? hashOf(at.hash) : null;
  if ((typeof at === 'string' || (at && typeof at === 'object' && 'hash' in at)) && !entity) throw new Error('world.pin: at.hash is not an entity id');
  const x = Number(at?.x), y = Number(at?.y), z = Number(at?.z);
  const place = [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  if (!entity && !place) throw new Error('world.pin needs at: a place { x, y, z } in metres, or an entity id { hash } to follow');
  return { entity, place };
}

function createPins({ sendJson, log, openAtlas, closeAtlas, atlasWindow, toPage }) {
  const pins = new Map(); // id -> pin
  const defaults = new Map(); // owner (null: tools) -> the style its pins start from
  let nextId = 1;
  let camera = null; // { pos: [x, y, z] }
  let layout = null; // the page's last measured rectangles
  let shown = ''; // the labels the page shows now, to send again only on a change
  let fullLogged = false;

  const styleFor = (p) => ({ ...BASE, ...(defaults.get(p.owner) ?? {}), ...p.style });
  const distanceOf = (p) => {
    if (!camera || !p.at) return null;
    const [x, y, z] = camera.pos;
    return Math.hypot(p.at.x - x, p.at.y - y, p.at.z - z);
  };
  const rounded = (d) => (d === null ? null : d < 100 ? Math.round(d) : d < 1000 ? Math.round(d / 10) * 10 : Math.round(d / 100) * 100);

  function labels() {
    return [...pins.values()].map((p) => {
      const s = styleFor(p);
      return { id: p.id, title: p.title, text: p.text, distance: rounded(distanceOf(p)), color: s.color, font: s.font, titleSize: s.titleSize, textSize: s.textSize };
    });
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
    if (json === shown) {
      toPlugin(); // a change the labels do not show (a place, a scale): the plugin only
      return;
    }
    shown = json;
    const w = atlasWindow();
    if (w) toPage(w, { event: 'pins', pins: list });
  }

  function toPlugin() {
    const w = atlasWindow();
    if (!w || !layout || !pins.size) return;
    const colors = Object.keys(layout.styles);
    const styles = colors.map((c) => layout.styles[c]);
    const out = [];
    for (const p of pins.values()) {
      const label = layout.labels[p.id];
      if (!label) continue;
      const s = styleFor(p);
      const index = colors.indexOf(s.color);
      out.push({
        id: p.id,
        ...(p.at ? { at: [p.at.x, p.at.y, p.at.z] } : {}),
        ...(p.entity ? { entity: p.entity } : {}),
        height: s.pinHeight,
        label,
        style: index < 0 ? 0 : index,
        scale: s.scale,
        min: s.minScreenSize,
      });
    }
    sendJson({ cmd: 'pins.set', window: w.id, fov: 'vertical', margin: 28, postMin: 36, postMax: 420, styles, pins: out });
  }

  const entryOf = (p) => ({
    id: p.id,
    owner: p.owner,
    at: p.at ? { ...p.at } : null,
    entity: p.entity ? { hash: p.entity } : null,
    title: p.title,
    text: p.text,
    style: styleFor(p),
    color: styleFor(p).color,
    height: styleFor(p).pinHeight,
    distance: distanceOf(p),
  });

  return {
    count: () => pins.size,

    /** A package's new pin. Answers its id. */
    add(owner, options) {
      if (pins.size >= MAX_PINS) throw new Error(`world.pin: at most ${MAX_PINS} pins at once`);
      const title = String(options?.title ?? '').slice(0, 80);
      if (!title) throw new Error('world.pin needs a title');
      const { entity, place } = atOf(options?.at);
      const style = styleOf(options?.style, 'world.pin');
      // WP1's color and height, kept as shortcuts.
      if (options?.color !== undefined && style.color === undefined) Object.assign(style, styleOf({ color: options.color }, 'world.pin'));
      if (options?.height !== undefined && style.pinHeight === undefined) Object.assign(style, styleOf({ pinHeight: options.height }, 'world.pin'));
      const pin = { id: nextId++, owner, at: place, entity, title, text: options?.text ? String(options.text).slice(0, 160) : '', style };
      pins.set(pin.id, pin);
      if (pins.size === 1) log(`Pins: ${owner ?? 'a tool'} dropped the first pin`);
      refresh(); // the plugin hears of it once the page has laid it out
      return pin.id;
    },

    remove(owner, id) {
      const pin = pins.get(Number(id));
      if (!pin) return false;
      if (owner && pin.owner !== owner) throw new Error(`pin ${id} belongs to ${pin.owner ?? 'an assistant'}`);
      pins.delete(pin.id);
      refresh();
      return true;
    },

    /**
     * Restyles one pin (id), or with no id sets the style every pin of the package starts from,
     * for its pins now and later. Answers how many pins changed.
     */
    restyle(owner, id, style) {
      const s = styleOf(style, 'world.pinStyle');
      if (id === undefined || id === null) {
        defaults.set(owner, { ...(defaults.get(owner) ?? {}), ...s });
        const n = [...pins.values()].filter((p) => p.owner === owner).length;
        if (n) refresh();
        return n;
      }
      const pin = pins.get(Number(id));
      if (!pin) return 0;
      if (owner && pin.owner !== owner) throw new Error(`pin ${id} belongs to ${pin.owner ?? 'an assistant'}`);
      pin.style = { ...pin.style, ...s };
      refresh();
      return 1;
    },

    list(owner) {
      return [...pins.values()].filter((p) => owner === undefined || owner === null || p.owner === owner).map(entryOf);
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
      if (owner) defaults.delete(owner);
      if (n) log(`Pins: removed ${n} pin(s) of ${owner ?? 'every package'} (${why})`);
    },

    /** The plugin's pins.camera: the distances change, and followed pins move. */
    camera(m) {
      if (!Array.isArray(m.pos) || m.pos.length < 3) return;
      camera = { pos: m.pos.map(Number) };
      if (Array.isArray(m.follow)) {
        for (const f of m.follow) {
          const p = Array.isArray(f) ? pins.get(Number(f[0])) : null;
          const [x, y, z] = Array.isArray(f) ? f.slice(1, 4).map(Number) : [];
          if (p && [x, y, z].every(Number.isFinite)) p.at = { x, y, z };
        }
      }
      if (!pins.size) return;
      // Only the labels: the plugin already knows where its followed pins are.
      const list = labels();
      const json = JSON.stringify(list);
      if (json === shown) return;
      shown = json;
      const w = atlasWindow();
      if (w) toPage(w, { event: 'pins', pins: list });
    },

    /** The page measured its pieces. */
    layout(l) {
      if (!l || typeof l !== 'object' || !l.labels) return;
      // WP1's page sent one post and one set of arrows.
      const styles = l.styles && typeof l.styles === 'object' ? l.styles : { [BASE.color]: { post: l.post, arrows: l.arrows ?? {} } };
      layout = { styles, labels: l.labels };
      const left = Array.isArray(l.full) ? l.full.length : 0;
      if (left && !fullLogged) {
        fullLogged = true;
        log(`Pins: the labels' page is full; ${left} label(s) are not drawn until others go`);
      } else if (!left) fullLogged = false;
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

module.exports = { createPins, styleOf, BASE };
