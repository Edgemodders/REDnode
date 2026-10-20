// A stand-in for the rednode package and the REDnode host, for the example previews
// on the docs site (docs/examples, made by tools/examples/build.mjs).
//
// There is no game in a web page, so this module plays one: V walks about, a save can
// be loaded, menus open and close, and the game API, TweakDB, the world, sounds,
// REDbridge and REDagent answer with made-up values in the shapes the real ones use.
// Error messages are the plugin's own, so a mod's error handling shows as in the game.
//
// HTML apps import it as "rednode" (the build points their import map here), and
// page.js builds window.rednode on it. Node mods run in a worker (worker.js), which
// sends every call here through runner.js.

const post = (m) => {
  try {
    parent.postMessage({ rednodeExample: true, ...m }, '*');
  } catch {
    // not in a frame
  }
};

/** A line for the docs page's Mod log. */
export function log(level, text, source = 'page') {
  post({ t: 'log', level, text: String(text), source });
}

// ---------- the simulated game ----------

const sim = {
  connected: true,
  menu: false,
  photoMode: false,
  scene: false,
  sceneTier: -1,
  mainMenu: false,
  overlay: 'interactive',
  focused: true,
  solo: false,
  frame: 4000,
  generation: 1, // raised by every save load: game object references from before stop working
  pos: { x: -1439.7, y: 1304.3, z: 119.1 },
  yaw: 0.6,
  health: 380,
  healthMax: 400,
  level: 23,
  money: 12450,
};

const listeners = new Set();
/** Host events, as window.rednode.on gets them. */
export function onHostEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(m) {
  for (const fn of [...listeners]) {
    try {
      fn(m);
    } catch (err) {
      log('error', err?.stack || err);
    }
  }
}

export function gameState() {
  return {
    connected: sim.connected,
    menu: sim.menu,
    photoMode: sim.photoMode,
    scene: sim.scene,
    mainMenu: sim.mainMenu,
    overlay: sim.overlay,
  };
}
function stateChanged() {
  emit({ event: 'game-state', ...gameState() });
  emit({ event: 'ui-state', menu: sim.menu, photoMode: sim.photoMode, scene: sim.scene, sceneTier: sim.sceneTier, mainMenu: sim.mainMenu });
  post({ t: 'sim', state: { ...gameState(), solo: sim.solo } });
  audioPause();
}

// The game's clock and V's walk. Nothing moves while a menu is open.
setInterval(() => {
  if (!sim.menu && !sim.mainMenu) sim.frame += 1;
}, 1000 / 60);
setInterval(() => {
  if (sim.menu || sim.mainMenu || sim.photoMode) return;
  sim.yaw += (Math.random() - 0.5) * 0.5;
  sim.pos.x += Math.cos(sim.yaw) * 0.6;
  sim.pos.y += Math.sin(sim.yaw) * 0.6;
  sim.pos.z = 119.1 + Math.sin(sim.frame / 300) * 0.4;
  if (sim.health < sim.healthMax) sim.health = Math.min(sim.healthMax, sim.health + 1);
}, 250);

// The docs page's buttons: load a save, open a menu and so on.
const controls = {
  load() {
    sim.generation += 1;
    sim.mainMenu = false;
    sim.menu = false;
    sim.health = Math.round(sim.healthMax * 0.8);
    stateChanged();
    log('info', 'Save loaded: PlayerPuppet.OnGameAttached', 'game');
    emit({ event: 'game', name: 'PlayerPuppet.OnGameAttached', value: sim.generation, frame: sim.frame });
  },
  menu() {
    sim.menu = !sim.menu;
    stateChanged();
  },
  photo() {
    sim.photoMode = !sim.photoMode;
    stateChanged();
  },
  scene() {
    sim.scene = !sim.scene;
    sim.sceneTier = sim.scene ? 4 : -1;
    stateChanged();
  },
  overlay() {
    sim.overlay = { passive: 'interactive', interactive: 'hidden', hidden: 'passive' }[sim.overlay];
    stateChanged();
    emit({ event: 'overlay', mode: sim.overlay });
    emit({ event: 'state', state: { overlay: sim.overlay } });
  },
  hurt() {
    sim.health = Math.max(1, sim.health - 120);
  },
};
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m?.rednodeExample && m.t === 'control') controls[m.action]?.();
});

// The host's first events, as a page gets them when the game is linked.
setTimeout(() => {
  emit({ event: 'link', connected: true });
  emit({ event: 'hello', plugin: 'REDnode (docs simulation)', mode: sim.overlay });
  stateChanged();
}, 50);

// Frame rates and costs for the Perf app, once a second.
setInterval(() => {
  const jitter = (n, k) => n + (Math.random() - 0.5) * k;
  emit({
    event: 'perf',
    game: {
      fps: jitter(sim.menu ? 60 : 72, 6),
      cpuMs: jitter(0.21, 0.08),
      cpuMsMax: jitter(0.6, 0.3),
      gpuMs: jitter(0.12, 0.04),
      gpuMsMax: jitter(0.3, 0.1),
      uploadsPerSec: 0,
      uploadMBps: 0,
      sharedPerSec: jitter(24, 6),
    },
    host: {
      renderPath: 'gpu',
      memoryMB: Math.round(jitter(410, 20)),
      processes: 7,
      cpuPercent: Math.round(jitter(3, 2)),
      sentMBps: 0,
      windows: [{ id: 'perf', fps: 1 }, { id: 'launcher', fps: 0 }],
    },
  });
}, 1000);

// ---------- game objects ----------

const objects = new Map(); // ref -> Remote
let nextRef = 1;
const GONE = 'that game object no longer exists (references are dropped when a save loads)';

/**
 * A game object with methods, as the game API returns it. Method calls are async,
 * like the real ones. A reference from before a save load stops working.
 */
export class Remote {
  constructor(type, methods, { persistent = false, fields = {} } = {}) {
    this.$ref = nextRef++;
    this.$type = type;
    this.$fields = fields;
    this.methods = methods;
    this.generation = persistent ? 0 : sim.generation;
    objects.set(this.$ref, this);
    // Any method name works on a game object; the game decides which exist.
    return new Proxy(this, {
      get(target, name) {
        if (name in target || typeof name === 'symbol') return target[name];
        if (name in target.$fields) return target.$fields[name];
        if (name === 'then') return undefined;
        return (...args) => target.invoke(String(name), args);
      },
    });
  }

  async invoke(name, args) {
    if (this.generation && this.generation !== sim.generation) throw new Error(GONE);
    const fn = this.methods[name];
    if (!fn) throw new Error(`${this.$type} has no method "${name}" in the docs simulation (in the game it may exist)`);
    return fn(...args);
  }
}
export const remoteByRef = (ref) => objects.get(ref);

// The game instance, the first argument of many game functions.
const instance = Object.freeze({});

function player() {
  if (sim.mainMenu) return null;
  return new Remote('PlayerPuppet', {
    GetEntityID: () => ({ hash: '1' }),
    GetWorldPosition: () => ({ X: sim.pos.x, Y: sim.pos.y, Z: sim.pos.z, W: 1 }),
    GetWorldForward: () => ({ X: Math.cos(sim.yaw), Y: Math.sin(sim.yaw), Z: 0, W: 0 }),
    GetTimeDilationValue: () => 1,
    IsIgnoringGlobalTimeDilation: () => false,
  });
}

const needStatsId = (v, k, name) => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error(`argument ${k} (${name}, gameStatsObjectID): gameStatsObjectID needs an object`);
};
const systems = {
  GetStatPoolsSystem: () =>
    new Remote('gameStatPoolsSystem', {
      GetStatPoolValue: (id, pool) => {
        needStatsId(id, 1, 'objID');
        if (pool !== 'Health') return 100;
        return sim.health;
      },
    }),
  GetStatsSystem: () =>
    new Remote('gameStatsSystem', {
      GetStatValue: (id, stat) => {
        needStatsId(id, 1, 'objID');
        return stat === 'Level' ? sim.level : 0;
      },
    }),
  GetTransactionSystem: () =>
    new Remote('gameTransactionSystem', {
      GetItemQuantity: (_who, item) => (item?.id === 'Items.money' ? sim.money : 0),
      GiveItem: (_who, item, n) => {
        if (item?.id !== 'Items.money') return false;
        sim.money += Number(n) || 0;
        return true;
      },
    }),
  GetTimeSystem: () =>
    new Remote('gameTimeSystem', {
      GetActiveTimeDilation: () => (sim.menu ? 0 : 1),
    }),
};

const notSimulated = (name) =>
  new Error(`"${name}" is not simulated on this page. In the game, it calls the real game function.`);

// api.Name(...), api.Class.Name(...), api.$call(fullName, ...), api.$new(class, props)
const apiImpl = {
  GetPlayer: () => player(),
  $call: (fullName, ...args) => {
    if (fullName === 'Cast;EntityID;StatsObjectID') return { entityID: args[0] };
    throw notSimulated(fullName);
  },
  $new: (cls, props = {}) => new Remote(cls, {}, { persistent: true, fields: { ...props } }),
  'GameInstance.*': (name) => systems[name],
  'MarketSystem.Money': () => ({ id: 'Items.money', rngSeed: 0 }),
};
function apiPath(path) {
  return new Proxy(() => {}, {
    get(_t, name) {
      if (name === 'then' || typeof name === 'symbol') return undefined;
      return apiPath([...path, String(name)]);
    },
    apply(_t, _this, args) {
      const key = path.join('.');
      const fn = apiImpl[key] ?? (path.length === 2 && apiImpl[`${path[0]}.*`]?.(path[1]));
      if (!fn) return Promise.reject(notSimulated(key));
      try {
        return Promise.resolve(fn(...args));
      } catch (err) {
        return Promise.reject(err);
      }
    },
  });
}
export const api = apiPath([]);

// ---------- game ----------

const gameListeners = new Map(); // event name -> Set
onHostEvent((m) => {
  if (m.event === 'game') for (const fn of gameListeners.get(m.name) ?? []) fn({ name: m.name, value: m.value, frame: m.frame });
});

export const game = {
  instance,
  player: {
    async position() {
      if (sim.mainMenu) throw new Error('No player. Load a save first.');
      return { x: sim.pos.x, y: sim.pos.y, z: sim.pos.z };
    },
    async getHealth() {
      return sim.health;
    },
    async setHealth(v) {
      sim.health = Math.max(0, Math.min(sim.healthMax, Number(v)));
    },
  },
  audio: {
    async play(name) {
      blip();
      log('info', `game.audio.play("${name}"): the game's own sound events only play in the game; this page plays a tone`, 'sim');
    },
  },
  async state() {
    return gameState();
  },
  on(name, fn) {
    if (!gameListeners.has(name)) gameListeners.set(name, new Set());
    gameListeners.get(name).add(fn);
    return () => gameListeners.get(name).delete(fn);
  },
  onState(fn) {
    return onHostEvent((m) => {
      if (m.event === 'game-state') fn(gameState());
    });
  },
};

// ---------- TweakDB ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** A TweakDB id, worked out the way the game does: the path's CRC32 and length. */
export function tweakId(path) {
  if (path.startsWith('0x')) return path;
  const bytes = new TextEncoder().encode(path);
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  const v = (BigInt(bytes.length) << 32n) | BigInt((c ^ 0xffffffff) >>> 0);
  return `0x${v.toString(16).toUpperCase().padStart(16, '0')}`;
}

// A few made-up records in the shapes the real ones have.
const id = (p) => ({ type: 'TweakDBID', value: tweakId(p) });
const records = new Map(
  Object.entries({
    'Items.Preset_Lexington_Default': {
      type: 'gamedataWeaponItem_Record',
      flats: {
        quality: id('Quality.Common'),
        itemType: id('ItemType.Wea_Handgun'),
        friendlyName: { type: 'String', value: 'w_handgun_militech_lexington' },
        tags: { type: 'array:CName', value: ['Weapon', 'Handgun', 'Power'] },
        iconPath: { type: 'String', value: 'w_handgun__lexington' },
      },
    },
    'Items.money': {
      type: 'gamedataItem_Record',
      flats: {
        quality: id('Quality.Common'),
        itemType: id('ItemType.Gen_Misc'),
        friendlyName: { type: 'String', value: 'money' },
        tags: { type: 'array:CName', value: ['Currency'] },
      },
    },
    ...Object.fromEntries(
      [
        'v_sport2_quadra_type66_player',
        'v_sport1_rayfield_caliburn_player',
        'v_standard2_archer_hella_player',
        'v_sportbike2_arch_player',
        'v_standard25_mahir_supron_player',
        'v_sport2_mizutani_shion_player',
        'v_standard3_chevalier_emperor_player',
        'v_utility4_thorton_mackinaw_player',
      ].map((n) => [`Vehicle.${n}`, { type: 'gamedataVehicle_Record', flats: { displayName: { type: 'gamedataLocKeyWrapper', value: { key: '0' } } } }]),
    ),
  }),
);
const unnamedVehicles = ['0x0000002A4E1F09C3', '0x00000027B95C40E1', '0x0000002C1A773D50'];
const journal = []; // changes to undo when the package stops: [path, previous value or undefined]

function splitFlat(path) {
  const dot = path.lastIndexOf('.');
  return [path.slice(0, dot), path.slice(dot + 1)];
}

export const tweakdb = {
  id: tweakId,
  name: (v) => (records.has(v) ? v : null),
  learn() {},
  async type(path) {
    return records.get(path)?.type ?? null;
  },
  async flat(path) {
    const [rec, name] = splitFlat(path);
    return records.get(rec)?.flats[name] ?? null;
  },
  async get(path) {
    return (await tweakdb.flat(path))?.value ?? null;
  },
  async record(path) {
    const r = records.get(path);
    if (!r) return null;
    const val = (n) => r.flats[n]?.value ?? null;
    return new Remote(r.type, {
      FriendlyName: () => val('friendlyName'),
      DisplayName: () => (path.startsWith('Items.Preset_Lexington') ? 'Lexington' : path.split('.').pop()),
      Quality: () => new Remote('gamedataQuality_Record', {}, { persistent: true }),
    }, { persistent: true });
  },
  async records(type) {
    const want = type.startsWith('gamedata') ? type : `gamedata${type.replace(/_Record$/, '')}_Record`;
    const named = [...records].filter(([, r]) => r.type === want).map(([p]) => p);
    return want === 'gamedataVehicle_Record' ? [...named, ...unnamedVehicles] : named;
  },
  async set(path, value) {
    const [rec, name] = splitFlat(path);
    const r = records.get(rec);
    if (!r) throw new Error(`No record "${rec}"`);
    journal.push([path, r.flats[name] ? { ...r.flats[name] } : undefined]);
    r.flats[name] = { type: r.flats[name]?.type ?? (typeof value === 'string' ? 'String' : 'Float'), value };
    log('info', `tweakdb.set ${path}: the simulation keeps it until this example restarts (in the game, TweakXL writes it)`, 'sim');
    return true;
  },
  async clone(path, base) {
    const r = records.get(base);
    if (!r) throw new Error(`No record "${base}"`);
    records.set(path, { type: r.type, flats: structuredClone(r.flats) });
    journal.push([path, null]);
    return true;
  },
  async create(path, type) {
    records.set(path, { type, flats: {} });
    journal.push([path, null]);
    return true;
  },
  async update() {
    return true;
  },
};

/** Undoes the package's TweakDB changes, as REDnode does when a package stops. */
export function undoTweaks() {
  if (!journal.length) return;
  for (const [path, before] of journal.reverse()) {
    if (before === null) {
      records.delete(path);
      continue;
    }
    const [rec, name] = splitFlat(path);
    const r = records.get(rec);
    if (!r) continue;
    if (before === undefined) delete r.flats[name];
    else r.flats[name] = before;
  }
  log('info', `Undid ${journal.length} TweakDB change(s): the package stopped`, 'host');
  journal.length = 0;
}

// ---------- the world ----------

const worldListeners = new Map(); // event name -> Set
const entities = new Map();
function worldEvent(name, e) {
  for (const fn of worldListeners.get(name) ?? []) fn({ name, ...e });
}
// The game's next frame. Calls waiting when a frame starts all run in that frame, so
// they share one tick (a timer, not requestAnimationFrame, which stops in background tabs).
let frameTick = null;
const nextFrame = () =>
  (frameTick ??= new Promise((r) =>
    setTimeout(() => {
      frameTick = null;
      r();
    }, 1000 / 60),
  ));

export const world = {
  async available() {
    return !sim.mainMenu;
  },
  async spawn(options) {
    if (sim.mainMenu) throw new Error('No world yet: load a save first');
    await nextFrame();
    const hash = String(2n ** 40n + BigInt(Math.floor(Math.random() * 1e9)));
    const e = { entityId: hash, entityType: 'entEntity' };
    entities.set(hash, { ...options });
    setTimeout(() => worldEvent('Entity/Initialize', e), 30);
    setTimeout(() => worldEvent('Entity/AfterAttach', e), 90);
    return { id: { hash }, entity: new Remote('entEntity', {}) };
  },
  async move(id) {
    const hash = typeof id === 'string' ? id : id?.hash;
    if (!entities.has(hash)) return false;
    await nextFrame(); // calls waiting when a frame starts run in that frame
    return true;
  },
  async remove(id) {
    const hash = typeof id === 'string' ? id : id?.hash;
    if (!entities.delete(hash)) return false;
    await nextFrame();
    worldEvent('Entity/Detach', { entityId: hash, entityType: 'entEntity' });
    return true;
  },
  async watch() {
    return true;
  },
  async entity() {
    return null;
  },
  on(name, fn) {
    if (!worldListeners.has(name)) worldListeners.set(name, new Set());
    worldListeners.get(name).add(fn);
    return () => worldListeners.get(name).delete(fn);
  },
};

// ---------- sounds ----------

let ctx = null;
const audioCtx = () => (ctx ??= new AudioContext());
function audioPause() {
  if (!ctx) return;
  if (sim.menu) ctx.suspend();
  else ctx.resume();
}
/** A short tone, in place of a game sound event. */
export function blip() {
  const c = audioCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.12);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.13);
}

let manifest = { sounds: {} };
let manifestBase = location.href;
/** The package's manifest, for its sounds and requirements. */
export function useManifest(m, base) {
  manifest = m ?? manifest;
  manifestBase = base ?? manifestBase;
}

const buffers = new Map();
async function buffer(file) {
  if (!buffers.has(file)) {
    buffers.set(
      file,
      fetch(new URL(file, manifestBase))
        .then((r) => {
          if (!r.ok) throw new Error(`${file}: not found`);
          return r.arrayBuffer();
        })
        .then((b) => audioCtx().decodeAudioData(b)),
    );
  }
  return buffers.get(file);
}

const sounds = new Map(); // id -> { info, source, gain, done }
let nextSound = 1;

export const audio = {
  async play(name, options = {}) {
    const def = manifest.sounds?.[name];
    if (!def) throw new Error(`No sound "${name}" in rednode-app.json`);
    const d = typeof def === 'string' ? { file: def } : def;
    const c = audioCtx();
    const id = nextSound++;
    const info = { id, file: d.file, category: d.category ?? 'sfx', state: 'loading', position: 0, length: 0 };
    let resolveEnd;
    const ended = new Promise((r) => (resolveEnd = r));
    const entry = { info, ended, done: false };
    sounds.set(id, entry);
    const finish = (why, error) => {
      if (entry.done) return;
      entry.done = true;
      info.state = 'done';
      sounds.delete(id);
      resolveEnd(error ? { why, error } : { why });
    };
    try {
      const buf = await buffer(d.file);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = !!(options.loop ?? d.loop);
      if (options.semitones) src.playbackRate.value = 2 ** (options.semitones / 12);
      if (options.rate) src.playbackRate.value = options.rate;
      const gain = c.createGain();
      const volume = (options.volume ?? d.volume ?? 1) * 0.8;
      const fadeIn = (options.fadeIn ?? d.fadeIn ?? 0) / 1000;
      const at = c.currentTime + (options.delay ?? 0) / 1000;
      gain.gain.setValueAtTime(fadeIn ? 0.0001 : volume, at);
      if (fadeIn) gain.gain.linearRampToValueAtTime(volume, at + fadeIn);
      const pan = c.createStereoPanner();
      pan.pan.value = options.pan ?? 0;
      src.connect(gain).connect(pan).connect(c.destination);
      src.onended = () => finish(entry.stopped ? 'stopped' : 'ended');
      src.start(at);
      Object.assign(entry, { src, gain, pan, startedAt: at });
      info.length = buf.duration;
      info.state = 'playing';
    } catch (err) {
      finish('error', err.message);
    }
    return new Remote('Sound', {
      async stop(o = {}) {
        await stopSound(entry, o.fadeOut);
      },
      async set(o = {}) {
        if (!entry.gain) return;
        const now = c.currentTime;
        if (o.volume !== undefined) entry.gain.gain.setValueAtTime(o.volume * 0.8, now);
        if (o.pan !== undefined) entry.pan.pan.value = o.pan;
        if (o.rate !== undefined) entry.src.playbackRate.value = o.rate;
        if (o.fadeTo) {
          entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
          entry.gain.gain.linearRampToValueAtTime(o.fadeTo.volume * 0.8, now + o.fadeTo.ms / 1000);
        }
      },
    }, { persistent: true, fields: { id, ended } });
  },
  async playing() {
    const c = ctx;
    return [...sounds.values()].map(({ info, startedAt, src }) => {
      if (c && src && info.length) {
        const t = Math.max(0, c.currentTime - startedAt) * src.playbackRate.value;
        info.position = src.loop ? t % info.length : Math.min(t, info.length);
      }
      if (sim.menu && info.state === 'playing') return { ...info, state: 'paused' };
      return { ...info };
    });
  },
  async stopAll(o = {}) {
    await Promise.all([...sounds.values()].map((e) => stopSound(e, o.fadeOut)));
  },
  // The game's own sounds live in the game's archives: this page plays a tone instead.
  async playGame(sound) {
    if (!Number.isInteger(sound) || sound < 0) throw new Error('A sound id is a whole number from 0 to 4294967295');
    if (!SIM_SOUNDS.has(sound)) throw new Error(`Sound ${sound} is not in the game's sound index (audio_2_soundbanks.archive)`);
    blip();
    log('info', `audio.playGame(${sound}): the game's sounds play only in the game; this page plays a tone`, 'sim');
    const seconds = SIM_SOUNDS.get(sound);
    const ended = new Promise((r) => setTimeout(() => r({ why: 'ended' }), seconds * 1000));
    return new Remote('Sound', { async stop() {}, async set() {} }, { persistent: true, fields: { id: nextSound++, ended, seconds } });
  },
  async event(name) {
    blip();
    log('info', `audio.event("${name}"): game sound events play only in the game; this page plays a tone`, 'sim');
  },
  // Made-up batches in the shape the plugin sends: posts of a few named events, and loads.
  async trace(onTrace) {
    log('info', 'audio.trace: the docs page makes up the game\'s sounds; in the game the plugin hooks its audio engine', 'sim');
    const t0 = Date.now();
    const timer = setInterval(() => {
      const ms = Date.now() - t0;
      const posts = [];
      const loads = [];
      for (const [name, every] of SIM_EVENTS) {
        if (Math.random() < every) posts.push({ ms, event: wwiseHash(name), object: Math.random() < 0.5 ? '18446744073709551615' : '7340032', playing: 1000 + Math.floor(ms / 10) });
      }
      if (Math.random() < 0.3) loads.push({ ms, sound: [...SIM_SOUNDS.keys()][Math.floor(Math.random() * SIM_SOUNDS.size)], found: true });
      onTrace({ posts, loads, dropped: 0 });
    }, 100);
    return async () => clearInterval(timer);
  },
};
// Wwise's id for a name: FNV-1 32 over the lower-case name.
function wwiseHash(name) {
  let h = 2166136261;
  for (const ch of name.toLowerCase()) h = (Math.imul(h, 16777619) ^ ch.charCodeAt(0)) >>> 0;
  return h;
}
const SIM_EVENTS = [['amb_int_custom_megabuilding_01_ventilation', 0.2], ['w_melee_katana_draw', 0.05], ['v_foley_walk_concrete', 0.6], ['ui_menu_onpress', 0.05], ['dev_vending_machine_can_falls', 0.02]];
const SIM_SOUNDS = new Map([[746693166, 1.87], [123456789, 0.5], [99887766, 2.4]]);
async function stopSound(entry, fadeOut = 0) {
  if (!entry.src || entry.done) return;
  entry.stopped = true;
  entry.info.state = 'stopping';
  const c = audioCtx();
  const now = c.currentTime;
  entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
  entry.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut / 1000);
  entry.src.stop(now + fadeOut / 1000 + 0.01);
}

// ---------- the package, REDbridge, REDagent ----------

const INSTALLED = { codeware: '1.20.3', archivexl: '1.26.8', tweakxl: '1.11.4', redbridge: '0.10.0', redhottools: '1.3.0', red4ext: '1.30.0', redscript: '0.5.30' };
const atLeast = (have, want) => {
  const a = have.split('.').map(Number);
  const b = want.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

const ARCHIVES = [
  ['basegame_1_engine.archive', 21730],
  ['basegame_2_mainmenu.archive', 6904],
  ['basegame_3_nightcity.archive', 79215],
  ['basegame_4_animation.archive', 36108],
  ['basegame_4_appearance.archive', 102341],
  ['basegame_4_gamedata.archive', 51772],
  ['ep1_1_nightcity.archive', 24876],
];
const DEPOT = [
  'base\\characters\\common\\player_base_bodies\\player_man_average\\t0_000_ma_base__full.mesh',
  'base\\characters\\appearances\\player\\player_ma_tpp.app',
  'base\\characters\\entities\\player\\player_ma_tpp.ent',
  'base\\characters\\entities\\player\\player_ma_tpp_cutscene.ent',
  'base\\animations\\player\\player_ma_tpp_locomotion.anims',
  'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh',
  'base\\environment\\ld_kit\\marker.mesh',
  'base\\gameplay\\gui\\common\\buttons\\generic_button.inkwidget',
  'base\\vehicles\\sport\\v_sport2_quadra_type66\\entities\\v_sport2_quadra_type66.ent',
];

export const kernel = {
  async requirements() {
    return Object.entries(manifest.requires ?? {}).map(([name, wants]) => {
      const found = INSTALLED[name] ?? null;
      const min = String(wants).replace(/^>=\s*/, '');
      const ok = !!found && (wants === '*' || atLeast(found, min));
      return { name, wants, found, installed: !!found, ok, kind: null, note: found ? (ok ? '' : `needs ${wants}`) : 'not installed' };
    });
  },
  async bridge() {
    log('info', 'kernel.bridge(): the docs page answers for REDbridge with a few made-up files', 'sim');
    return new Remote('KernelBridge', {
      async call(method, params = {}) {
        if (method === 'bridge.info') return { version: '0.10.0', archives: ARCHIVES.length, files: ARCHIVES.reduce((n, [, f]) => n + f, 0) };
        if (method === 'archive.archives') return ARCHIVES.map(([name, files]) => ({ name, files }));
        if (method === 'sound.events') {
          const events = SIM_EVENTS.slice(0, 4).map(([name]) => ({ name, hash: wwiseHash(name), tags: [] }));
          return { gameVersion: '1.6', count: events.length, events };
        }
        if (method === 'archive.search') {
          const q = String(params.query ?? '').toLowerCase();
          const items = DEPOT.filter((p) => p.toLowerCase().includes(q)).map((name) => ({ name }));
          return { total: items.length, items: items.slice(0, params.limit ?? 20) };
        }
        throw new Error(`REDbridge: no method "${method}" in the docs simulation`);
      },
    }, { persistent: true, fields: { version: '0.10.0', source: 'REDnode' } });
  },
  async mcp() {
    throw new Error('kernel.mcp(): the MCP server runs in the REDnode host, not on this page');
  },
};

// archives.reload: the checks the host makes, and a swap that changes nothing on this page.
const MOD_ARCHIVES = ['Plain.archive', 'MyJacket.archive'];
let swapping = Promise.resolve();
export const archives = {
  reload(files) {
    const run = swapping.then(() => swapArchives(files));
    swapping = run.catch(() => {});
    return run;
  },
  // A made-up index and open paks; sound 123456789 is in pak 42, held once.
  async soundState(sounds = []) {
    const paks = [0, 3, 42].map((pak, slot) => ({ slot, index: 0, pak, flag: 0, serial: slot, row: -1, refs: 1, reader: `0x${(0x7f001000 + slot * 0x40).toString(16)}` }));
    const found = sounds.map((id) => (id === 123456789 ? { id, found: true, index: 0, row: 1200, pak: 42, offset: 81920, length: 5400, headerSize: 40, decodedBytes: 48000, held: 1 } : { id, found: false }));
    const summary = `1 index of 41000 sounds, checksum 0x9e3779b97f4a7c15; ${paks.length} paks open: ${paks.map((p) => `${p.pak} (1)`).join(', ')}; 57 sounds held${found.filter((s) => s.found).map((s) => `; sound ${s.id} in pak ${s.pak} at ${s.offset}, held (1 reference)`).join('')}`;
    log('info', 'archives.soundState: the docs page makes up an index; in the game the plugin reads the game\'s own', 'sim');
    return { infoHash: '0x0', infoPathOk: true, indexes: [{ sounds: 41000, second: 900, bytes: 823600, at: '0x7f000000', checksum: '0x9e3779b97f4a7c15' }], paks, held: 57, sounds: found, summary };
  },
};
async function swapArchives(files) {
  const list = typeof files === 'string' ? [files] : files;
  if (!Array.isArray(list) || !list.length) throw new Error('archives.reload needs a file, or a list of files');
  if (!(manifest.permissions ?? []).includes('archives')) {
    throw new Error('This package does not ask for the "archives" permission in its rednode-app.json');
  }
  for (const name of list.map((f) => String(f).trim().replace(/^"(.*)"$/, '$1').trim())) {
    const bare = !/[\\/]/.test(name);
    if (!/\.(archive|xl|ya?ml)$/i.test(name)) throw new Error(`${name}: RED Hot Tools swaps .archive, .xl and .yaml files`);
    if (bare && !MOD_ARCHIVES.includes(name)) throw new Error(`${name} was not found in archive/pc/mod`);
  }
  if (sim.mainMenu) throw new Error('Load a save first: REDnode swaps archives only in a loaded game');
  const ms = 280 + Math.round(Math.random() * 60);
  await new Promise((resolve) => setTimeout(resolve, ms));
  log('info', `archives.reload: the docs page pretends to swap ${list.join(', ')}; in the game RED Hot Tools swaps them in. The page's archive/pc/mod holds ${MOD_ARCHIVES.join(' and ')}`, 'sim');
  return { reloaded: list.map(String), failed: [], via: 'red-hot-tools', ms };
}

export const pkg = {
  get id() {
    return manifest.id;
  },
  get version() {
    return manifest.version;
  },
};
const secretStore = new Map();
export const secrets = {
  async get(n) {
    return secretStore.get(n) ?? null;
  },
  async set(n, v) {
    secretStore.set(n, v);
  },
  async delete(n) {
    secretStore.delete(n);
  },
};
export const channel = { post() {}, on: () => () => {} };

const ANSWER =
  'This is the docs page, so REDagent is not here to answer. In the game, your question goes to REDagent (powered by Claude) with the context this mod sends, and the answer streams into this window the way this text does.';
export const agent = {
  async ask(question, options = {}) {
    let text = '';
    const words = ANSWER.split(' ');
    for (const w of words) {
      if (options.signal?.aborted) throw new Error('Stopped');
      await new Promise((r) => setTimeout(r, 45));
      const piece = (text ? ' ' : '') + w;
      text += piece;
      options.onText?.(piece);
    }
    log('info', `agent.ask("${String(question).slice(0, 60)}"): answered by the docs simulation`, 'sim');
    return { text, cost: 0 };
  },
  serve() {
    return () => {};
  },
};
// ---------- ui (overlay apps) ----------

export const ui = {
  window() {
    throw new Error('rednode: ui.window is for Node mods. Overlay apps write HTML with the UI kit.');
  },
  async solo(on) {
    sim.solo = !!on;
    emit({ event: 'solo', on: sim.solo });
    post({ t: 'sim', state: { ...gameState(), solo: sim.solo } });
  },
  onSolo(fn) {
    return onHostEvent((m) => {
      if (m.event === 'solo') fn(!!m.on);
    });
  },
};

// window.rednode.call(method): the host's own methods that pages call.
export async function hostCall(method, params = {}) {
  switch (method) {
    case 'game.info':
      return { frame: sim.frame };
    case 'player.position':
      return game.player.position();
    case 'audio.play':
      blip();
      log('info', `audio.play("${params.name}"): game sound events only play in the game; this page plays a tone`, 'sim');
      return true;
    default:
      throw new Error(`${method}: not simulated on this page`);
  }
}
export const hostState = () => ({ connected: sim.connected, mode: sim.overlay, overlay: sim.overlay, windowed: false });
