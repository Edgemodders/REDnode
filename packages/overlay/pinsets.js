// World pins (#43, WP3): sets of pins kept in .pins.json files.
//
// A file holds one named set: places, titles and looks, never entity ids (those change from one
// session to the next, so a pin that follows an entity is saved at the place it had).
//
//   { "format": "rednode-pins", "version": 1, "name": "Scene spots",
//     "pins": [{ "title": "Stairs", "text": "the drums", "at": { "x": 1, "y": 2, "z": 3 }, "style": { "color": "#ffcf3f" } }] }
//
// The player's own sets are listed in the Pins window: settings.pinSets keeps their files, which
// are shown, which one Drop a pin here adds to, and the window's switches. A set the player made
// lives in the host's data folder ("pins"); one opened from elsewhere (a mod project, EDGEbuilder's
// scene folder) stays where it is. Their pins belong to "set:<file>" and stay when a session ends.
// Packages keep their own sets with world.pinSet, through the same file format.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { styleOf } = require('./pins');

const EXT = '.pins.json';
const MAX_SET = 200;

const nameFromFile = (file) => path.basename(file).slice(0, -EXT.length) || 'Pins';

/** A set's file, read and checked. Answers { name, pins: [{ title, text, at, style }] }. */
function readPinFile(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(err.code === 'ENOENT' ? `${file} was not found` : `${path.basename(file)} is not valid JSON: ${err.message}`);
  }
  if (!data || data.format !== 'rednode-pins' || !Array.isArray(data.pins)) {
    throw new Error(`${path.basename(file)} is not a pin set (no "format": "rednode-pins")`);
  }
  const pins = [];
  for (const [i, p] of data.pins.slice(0, MAX_SET).entries()) {
    const at = p?.at;
    const place = at && ['x', 'y', 'z'].every((k) => Number.isFinite(Number(at[k]))) ? { x: Number(at.x), y: Number(at.y), z: Number(at.z) } : null;
    const title = String(p?.title ?? '').slice(0, 80);
    if (!place || !title) throw new Error(`${path.basename(file)}: pin ${i + 1} needs a title and at { x, y, z }`);
    pins.push({ title, text: p.text ? String(p.text).slice(0, 160) : '', at: place, style: styleOf(p.style, `${path.basename(file)}: pin ${i + 1}`) });
  }
  return { name: String(data.name ?? '').slice(0, 80) || nameFromFile(file), pins };
}

/** Writes a set's file, through a temp file so a crash never leaves half of one. */
function writePinFile(file, name, pins) {
  const data = {
    format: 'rednode-pins',
    version: 1,
    name,
    pins: pins.map((p) => ({
      title: p.title,
      ...(p.text ? { text: p.text } : {}),
      at: { x: round(p.at.x), y: round(p.at.y), z: round(p.at.z) },
      ...(p.style && Object.keys(p.style).length ? { style: p.style } : {}),
    })),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const round = (n) => Math.round(n * 1000) / 1000;

/** A file name a caller gave: quotes from Windows' Copy as path taken off, .pins.json required. */
function pinFileOf(file, baseDir) {
  const name = String(file ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!name.toLowerCase().endsWith(EXT)) throw new Error(`${name || 'The file'}: a pin set's file ends in ${EXT}`);
  if (path.isAbsolute(name)) return path.normalize(name);
  if (!baseDir) throw new Error(`${name}: give a full path`);
  const full = path.resolve(baseDir, name);
  if (!full.startsWith(path.resolve(baseDir) + path.sep)) throw new Error(`${name}: stays inside the package's data folder`);
  return full;
}

// ---------- the player's sets, for the Pins window ----------

function createPinSets({ pinsHost, dir, getSettings, save, log }) {
  const sets = new Map(); // file -> { name, pins: [{ title, text, at, style }], ids: [pin id] | null, error }
  const conf = () => {
    const settings = getSettings();
    settings.pinSets ??= { files: [], current: null, clicks: false, hideAll: false };
    settings.pinSets.files ??= [];
    return settings.pinSets;
  };
  const owner = (file) => `set:${file}`;
  const entry = (file) => conf().files.find((f) => same(f.file, file));
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  function read(file) {
    try {
      const s = readPinFile(file);
      sets.set(file, { ...s, ids: null, error: null });
    } catch (err) {
      sets.set(file, { name: nameFromFile(file), pins: [], ids: null, error: err.message });
    }
    return sets.get(file);
  }

  function show(file) {
    const s = sets.get(file) ?? read(file);
    hide(file);
    s.ids = s.pins.map((p) => {
      try {
        return pinsHost.add(owner(file), { title: p.title, text: p.text, at: p.at, style: p.style });
      } catch (err) {
        log(`Pins: ${s.name}: ${err.message}`);
        return null;
      }
    });
  }

  function hide(file) {
    const s = sets.get(file);
    if (!s?.ids) return;
    pinsHost.clear(owner(file));
    s.ids = null;
  }

  function write(file) {
    const s = sets.get(file);
    writePinFile(file, s.name, s.pins);
  }

  // A new set's file in the data folder, with a name no other file has.
  function newFile(name) {
    const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'Pins';
    let file = path.join(dir, `${safe}${EXT}`);
    for (let n = 2; fs.existsSync(file) || entry(file); n++) file = path.join(dir, `${safe} ${n}${EXT}`);
    return file;
  }

  function currentFile() {
    const c = conf();
    if (c.current && entry(c.current)) return c.current;
    return c.files[0]?.file ?? null;
  }

  const api = {
    /** At the host's start: the player's shown sets come back. */
    start() {
      pinsHost.options({ clicks: !!conf().clicks, hideAll: !!conf().hideAll });
      for (const f of conf().files) {
        read(f.file);
        if (f.shown) show(f.file);
      }
      const n = conf().files.filter((f) => f.shown).length;
      if (n) log(`Pins: ${n} of the player's pin set(s) shown`);
    },

    state() {
      const c = conf();
      const current = currentFile();
      return {
        clicks: !!c.clicks,
        hideAll: !!c.hideAll,
        sets: c.files.map((f) => {
          const s = sets.get(f.file) ?? read(f.file);
          return { file: f.file, name: s.name, count: s.pins.length, shown: !!f.shown, current: current !== null && same(current, f.file), error: s.error, own: same(path.dirname(f.file), dir) };
        }),
      };
    },

    /** Drop a pin here: a pin at V's place, added to the current set (made if there is none). */
    drop(place, { title, text, file } = {}) {
      let target = file ? conf().files.find((f) => same(f.file, file))?.file : currentFile();
      if (!target) target = api.create('My pins').file;
      const s = sets.get(target) ?? read(target);
      if (s.error) throw new Error(`${s.name}: ${s.error}`);
      if (s.pins.length >= MAX_SET) throw new Error(`${s.name} has ${MAX_SET} pins, the most a set holds`);
      const pin = { title: String(title ?? '').trim().slice(0, 80) || `Pin ${s.pins.length + 1}`, text: String(text ?? '').trim().slice(0, 160), at: place, style: {} };
      s.pins.push(pin);
      write(target);
      const e = entry(target);
      if (!e.shown) {
        e.shown = true;
        save();
        show(target);
      } else if (s.ids) {
        // Only the new pin: the set's other pins keep their ids.
        s.ids.push(pinsHost.add(owner(target), { title: pin.title, text: pin.text, at: pin.at, style: pin.style }));
      } else show(target);
      log(`Pins: dropped "${pin.title}" in ${s.name} at ${place.x.toFixed(1)}, ${place.y.toFixed(1)}, ${place.z.toFixed(1)}`);
      return { file: target, title: pin.title };
    },

    /** Removes one of a set's pins (by its shown pin's id) from the set and its file. */
    removePin(id) {
      for (const [file, s] of sets) {
        const i = s.ids ? s.ids.indexOf(Number(id)) : -1;
        if (i < 0) continue;
        s.pins.splice(i, 1);
        s.ids.splice(i, 1);
        write(file);
        pinsHost.remove(owner(file), Number(id));
        return true;
      }
      return false;
    },

    setShown(file, on) {
      const e = entry(file);
      if (!e) throw new Error(`${file} is not in the list`);
      e.shown = !!on;
      save();
      if (on) show(e.file);
      else hide(e.file);
    },

    /** A new, empty set in the data folder; it becomes the one Drop a pin here adds to. */
    create(name) {
      const file = newFile(name || 'My pins');
      sets.set(file, { name: String(name || 'My pins').trim().slice(0, 80) || 'My pins', pins: [], ids: null, error: null });
      write(file);
      conf().files.push({ file, shown: true });
      conf().current = file;
      save();
      return { file };
    },

    /** Opens a set's file from anywhere and shows it. */
    open(file) {
      const full = pinFileOf(file);
      if (entry(full)) {
        api.setShown(full, true);
        return { file: full, already: true };
      }
      const s = read(full);
      if (s.error) throw new Error(s.error);
      conf().files.push({ file: full, shown: true });
      save();
      show(full);
      return { file: full, count: s.pins.length };
    },

    /** Takes a set off the list (its file stays). */
    forget(file) {
      const c = conf();
      const e = entry(file);
      if (!e) return false;
      hide(e.file);
      sets.delete(e.file);
      c.files = c.files.filter((f) => f !== e);
      if (c.current && same(c.current, e.file)) c.current = null;
      save();
      return true;
    },

    setCurrent(file) {
      const e = entry(file);
      if (!e) throw new Error(`${file} is not in the list`);
      conf().current = e.file;
      save();
    },

    options({ clicks, hideAll }) {
      const c = conf();
      if (clicks !== undefined) c.clicks = !!clicks;
      if (hideAll !== undefined) c.hideAll = !!hideAll;
      save();
      pinsHost.options({ clicks: c.clicks, hideAll: c.hideAll });
    },

    clicksOn: () => !!conf().clicks,

    /** A set's name from a pin owner ("set:<file>"), for the window's list. */
    nameOf(ownerId) {
      const file = String(ownerId).slice(4);
      return sets.get(file)?.name ?? nameFromFile(file);
    },
  };
  return api;
}

module.exports = { createPinSets, readPinFile, writePinFile, pinFileOf, EXT };
