/**
 * Sound: your package's own audio files, played in the game by REDnode's audio
 * engine beside the game's. WAV, OGG, MP3 and FLAC.
 *
 * A sound plays in a category that follows the game's volume sliders: `"sfx"`
 * (effects, the default), `"dialogue"` or `"music"`, all under master volume. It
 * pauses while a game menu is open, and everything mutes while the game is in the
 * background when the player's "mute in background" setting is on. A package's
 * sounds stop when the package stops.
 *
 * Name a sound by a file in your package's folder, or by an id you declare in
 * `rednode-app.json` with its settings:
 *
 * ```json
 * "sounds": {
 *   "alarm": { "file": "sounds/alarm.ogg", "volume": 0.8 },
 *   "theme": { "file": "sounds/theme.ogg", "category": "music", "loop": true }
 * }
 * ```
 *
 * @module
 */

import { cleanError, transport } from "./transport.js";

/** Where a sound's volume comes from: the game slider it follows. */
export type SoundCategory = "sfx" | "dialogue" | "music";

/** Settings for {@link audio.play}. They override the ones in the manifest. */
export interface PlayOptions {
  /** The slider it follows. Default `"sfx"`. */
  category?: SoundCategory;
  /** Volume, 1 as recorded. Default 1. */
  volume?: number;
  /** Repeat from `start` to `end` until stopped. Default false. */
  loop?: boolean;
  /** Wait this many milliseconds before starting. */
  delay?: number;
  /** Start this many seconds into the file. A loop repeats from here. */
  start?: number;
  /** Stop, or loop back, this many seconds into the file. Default: the file's end. */
  end?: number;
  /** Playback speed: 2 plays twice as fast and an octave higher. Default 1. */
  rate?: number;
  /** Pitch shift in semitones, as a speed: 12 is `rate: 2`. Combines with `rate`. */
  semitones?: number;
  /** Stereo position, -1 left to 1 right. Default 0. */
  pan?: number;
  /** Fade in over this many milliseconds. */
  fadeIn?: number;
  /** Read the file as it plays instead of loading it first. Default true for music, false otherwise. */
  stream?: boolean;
  /** Pause while a game menu is open. Default true. */
  pauseInMenu?: boolean;
}

/** Why a sound ended. */
export interface SoundEnd {
  /** `"ended"` at the end of the file, `"stopped"` by `stop()` or because the package stopped, `"error"` when it could not play. */
  why: "ended" | "stopped" | "error";
  /** What went wrong, for `"error"`. */
  error?: string;
}

/** A playing sound. */
export interface Sound {
  /** Its id in the engine. */
  readonly id: number;
  /** Settles when the sound ends, however it ends. */
  readonly ended: Promise<SoundEnd>;
  /** Stops it, fading out over `fadeOut` milliseconds. */
  stop(options?: { fadeOut?: number }): Promise<void>;
  /**
   * Changes it while it plays. `fadeTo` moves the volume there over `ms`
   * milliseconds instead of at once.
   */
  set(options: { volume?: number; rate?: number; pan?: number; fadeTo?: { volume: number; ms: number } }): Promise<void>;
}

/** A sound of your package, as {@link audio.playing} lists it. */
export interface SoundInfo {
  id: number;
  file: string;
  category: SoundCategory;
  state: "loading" | "playing" | "paused" | "stopping" | "done";
  /** Seconds played. */
  position: number;
  /** The file's length in seconds, 0 while loading. */
  length: number;
}

const endings = new Map<number, (end: SoundEnd) => void>();
const early = new Map<number, SoundEnd>(); // ends that arrived before play() returned
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "sound-end" || typeof m.sound !== "number") return;
    const end: SoundEnd = { why: (m.why as SoundEnd["why"]) ?? "ended" };
    if (typeof m.error === "string") end.error = m.error;
    const resolve = endings.get(m.sound);
    if (resolve) {
      endings.delete(m.sound);
      resolve(end);
    } else {
      early.set(m.sound, end);
      if (early.size > 256) early.delete(early.keys().next().value as number);
    }
  });
}

async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await transport().call(method, params);
  } catch (err) {
    throw cleanError(err);
  }
}

function handle(id: number): Sound {
  const ended = new Promise<SoundEnd>((resolve) => {
    const already = early.get(id);
    if (already) {
      early.delete(id);
      resolve(already);
    } else {
      endings.set(id, resolve);
    }
  });
  return {
    id,
    ended,
    async stop(options) {
      await call("sound.stop", { id, fadeOut: options?.fadeOut ?? 0 });
    },
    async set(options) {
      await call("sound.set", { id, ...options });
    },
  };
}

/**
 * Sound for packages: play your own audio files in the game.
 *
 * @example
 * ```ts
 * import { audio } from "rednode";
 *
 * const alarm = await audio.play("sounds/alarm.ogg", { loop: true, fadeIn: 500 });
 * setTimeout(() => alarm.stop({ fadeOut: 1000 }), 5000);
 * const { why } = await alarm.ended; // "stopped"
 * ```
 */
export const audio = {
  /**
   * Plays a sound: an id from the manifest's `"sounds"`, or a file's path in your
   * package's folder. Resolves once the engine has it, with a {@link Sound}; the file
   * loads in the background and starts as soon as it is ready.
   */
  async play(sound: string, options?: PlayOptions): Promise<Sound> {
    listen();
    const r = (await call("sound.play", { sound, ...options })) as { id: number };
    return handle(r.id);
  },

  /** Stops every sound of your package, fading out over `fadeOut` milliseconds. */
  async stopAll(options?: { fadeOut?: number }): Promise<void> {
    await call("sound.stop", { fadeOut: options?.fadeOut ?? 0 });
  },

  /** Your package's sounds that are loading or playing. */
  async playing(): Promise<SoundInfo[]> {
    const list = (await call("sound.list", {})) as (SoundInfo & { owner?: string })[];
    return list.map(({ owner: _owner, ...info }) => info);
  },

  /**
   * Plays one of the game's own sound effects through REDnode's engine like a file of your
   * package: the raw recording, without the game's effects or position, so you hear it
   * wherever the sound happens in the game. The game's archives store it as Opus; it is
   * decoded on first use. An archive in `archive/pc/mod` that carries the sound index wins
   * over the game's own, so a hot-swapped sound plays its new version.
   *
   * Give a sound id (one variation, as the game's `sfx_container.opusinfo` lists it), or
   * `{ event }` with an event's name or Wwise id to play one of that event's recordings:
   * `variation` (from 0) picks one, otherwise they come in turn. Stop events, and events
   * whose sound lives in a Wwise bank, have no recordings there and reject.
   *
   * Experimental (Sound Tools): its shape may change.
   *
   * @example
   * ```ts
   * import { audio } from "rednode";
   *
   * const s = await audio.playGame(746693166); // a katana sound
   * await s.ended;
   * const step = await audio.playGame({ event: "lcm_fs_bare_feet_concrete_walk" });
   * console.log(`variation ${step.variation + 1} of ${step.variations}`);
   * ```
   */
  async playGame(
    sound: number | { event: string | number; variation?: number },
    options?: PlayOptions,
  ): Promise<GameSound> {
    listen();
    const which = typeof sound === "number" ? { sound } : { event: sound.event, variation: sound.variation };
    const r = (await call("sound.playGame", { ...which, ...options })) as {
      id: number;
      sound: number;
      seconds: number;
      event?: number;
      variation?: number;
      variations?: number;
    };
    return Object.assign(handle(r.id), {
      seconds: r.seconds,
      sound: r.sound,
      ...(r.event !== undefined ? { event: r.event, variation: r.variation!, variations: r.variations! } : {}),
    });
  },

  /**
   * The sound ids of an event's recordings (its variations), by its name or Wwise id, from
   * the game's sound index: what {@link audio.playGame} picks from with `{ event }`. Empty
   * for a stop event, or one whose sound lives in a Wwise bank.
   *
   * Experimental (Sound Tools): its shape may change.
   *
   * @example
   * ```ts
   * import { audio } from "rednode";
   *
   * const { sounds } = await audio.eventSounds("lcm_fs_bare_feet_concrete_walk");
   * console.log(`${sounds.length} footstep variations`);
   * ```
   */
  async eventSounds(event: string | number): Promise<{ event: number; sounds: number[] }> {
    return (await call("sound.eventSounds", { event })) as { event: number; sounds: number[] };
  },

  /**
   * Searches the game's sound events: words of a name (all must appear in the event's name
   * or tags, in any order), an event id, or a sound id (the events that play that
   * recording). The catalogue holds every event the game's sound index has recordings for
   * and every event REDbridge's list names (WolvenKit's, game 1.6); names arrive a few
   * seconds after the first search while REDbridge starts, so `names` says `"loading"`
   * until then, and `"none"` without REDbridge, when only ids match.
   *
   * Experimental (Sound Tools, SP3): its shape may change.
   *
   * @example
   * ```ts
   * import { audio } from "rednode";
   *
   * const { results, total } = await audio.searchSounds("katana draw");
   * for (const e of results) console.log(`${e.name ?? e.event}: ${e.sounds.length} recordings`);
   * ```
   */
  async searchSounds(query: string, options: { limit?: number } = {}): Promise<SoundSearch> {
    return (await call("sound.search", { query, limit: options.limit })) as SoundSearch;
  },

  /**
   * Posts one of the game's sound events by name through the game's `AudioSystem.Play`: the
   * game plays it through its own mix, with the event's own logic (variations, effects). The
   * game must know the name; an unknown one plays nothing.
   *
   * By default the event plays on V, so a positional sound (footsteps, a weapon, a door) is
   * heard where the player stands. `{ on: "none" }` posts it with no entity, as the game
   * plays UI sounds. Some events loop until stopped: call `stop()` on what this returns.
   *
   * Experimental (Sound Tools): its shape may change.
   *
   * @example
   * ```ts
   * import { audio } from "rednode";
   *
   * const e = await audio.event("amb_int_custom_megabuilding_01_ventilation");
   * setTimeout(() => e.stop(), 5000);
   * ```
   */
  async event(name: string, options: { on?: "player" | "none" } = {}): Promise<PostedEvent> {
    const on = options.on ?? "player";
    const r = (await call("sound.event", { name, on })) as { on?: "player" | "none" } | undefined;
    return {
      name,
      on: r?.on ?? on,
      stop: async () => {
        await call("sound.stopEvent", { name, on });
      },
    };
  },

  /**
   * Listens to the game's sounds: `onTrace` gets, about ten times a second, the events the
   * game posted to its audio engine (Wwise) and the sounds it loaded. Resolves once the trace
   * runs, with a function that stops it. The trace also stops when your package stops.
   *
   * Experimental (Sound Tools, SP1): its shape may change.
   *
   * @example
   * ```ts
   * import { audio } from "rednode";
   *
   * const stop = await audio.trace(({ posts, loads }) => {
   *   for (const p of posts) console.log(`event ${p.name ?? p.event} on object ${p.object}`);
   *   for (const l of loads) console.log(`sound ${l.sound} loaded`);
   * });
   * setTimeout(stop, 10_000);
   * ```
   */
  async trace(onTrace: (batch: TraceBatch) => void): Promise<() => Promise<void>> {
    const off = transport().listen((m) => {
      if (m.event !== "sound-trace") return;
      const names = (m.names as Record<string, string> | undefined) ?? {};
      const recordings = (m.recordings as Record<string, number> | undefined) ?? {};
      const posts = ((m.posts as [number, number, string, number][]) ?? []).map(([ms, event, object, playing]) => ({
        ms,
        event,
        name: names[event],
        recordings: recordings[event],
        object,
        playing,
      }));
      const loads = ((m.loads as [number, number, boolean][]) ?? []).map(([ms, sound, found]) => ({ ms, sound, found }));
      onTrace({ posts, loads, dropped: Number(m.dropped ?? 0) });
    });
    try {
      await call("sound.trace", { on: true });
    } catch (err) {
      off();
      throw err;
    }
    return async () => {
      off();
      await call("sound.trace", { on: false });
    };
  },
};

/** What {@link audio.searchSounds} finds. */
export interface SoundSearch {
  /** How many events matched; `results` holds the first `limit` (200 by default). */
  total: number;
  results: SoundEventInfo[];
  /** Whether the names have loaded: until `"ready"`, only ids match. */
  names: "ready" | "loading" | "none";
  /** Events in the catalogue, and how many of them have recordings in the game's sound index. */
  events: number;
  recorded: number;
}

/** One game sound event, as {@link audio.searchSounds} lists it. */
export interface SoundEventInfo {
  /** Its Wwise id. */
  event: number;
  /** Its name, when REDbridge's list has it. */
  name: string | null;
  /** The list's tags for it, such as a category or a weapon. */
  tags: string[];
  /** The sound ids of its recordings, which {@link audio.playGame} plays with `{ event }`. */
  sounds: number[];
  /** What matched: words of its name or tags, its event id, or one of its sound ids (`sound`). */
  match: "name" | "event" | "sound";
  sound?: number;
}

/** A game sound playing through REDnode's engine, from {@link audio.playGame}. */
export type GameSound = Sound & {
  /** Its length in seconds. */
  seconds: number;
  /** Its sound id. */
  sound: number;
  /** With `{ event }`: the event's Wwise id, which recording this is (from 0), and how many it has. */
  event?: number;
  variation?: number;
  variations?: number;
};

/** A game sound event posted by {@link audio.event}. */
export interface PostedEvent {
  /** The event's name. */
  name: string;
  /** Where it played: on V (`"player"`), or with no entity (`"none"`, also when no save is loaded). */
  on: "player" | "none";
  /** Stops the event through the game's `AudioSystem.Stop`, on the same entity. */
  stop(): Promise<void>;
}

/** What {@link audio.trace} hands over each time. */
export interface TraceBatch {
  /**
   * Events the game posted to Wwise: `ms` since the trace started, the event's Wwise id (FNV-1
   * of its lower-case name), its name when REDnode knows it, the Wwise game object it was
   * posted on (a 64-bit number, as a string), and the playing id Wwise gave it (0: the post
   * failed).
   *
   * Names come from REDbridge's list of events (WolvenKit's, from game 1.6), which the host
   * loads when a trace starts; your package needs no permission for them. Events newer than
   * the list, or traced before the list has loaded, have no name. A Wwise game object is not
   * an entity id (Sound Tools SP1).
   *
   * `recordings` counts the event's recordings in the game's sound index, which
   * {@link audio.playGame} plays with `{ event }`: 0 for a stop event, or one whose sound
   * lives in a Wwise bank.
   */
  posts: { ms: number; event: number; name?: string; recordings?: number; object: string; playing: number }[];
  /** Sounds the game loaded: `ms`, the sound id, and whether the index had it. */
  loads: { ms: number; sound: number; found: boolean }[];
  /** Records lost since the last batch because too many came at once. */
  dropped: number;
}
