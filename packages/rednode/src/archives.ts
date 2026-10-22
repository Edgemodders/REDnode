/**
 * Archives: swapping a changed `.archive` into the running game, so a new mesh,
 * material or texture shows without restarting it (hot-loading).
 *
 * [RED Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) does the swap,
 * so the player needs it installed; list it in your manifest with
 * `"requires": { "redhottools": ">=1.3" }` so the Mod Manager shows the need. Swapping
 * replaces files in the game's mod folder, so the package must also ask for the
 * `archives` permission (`"permissions": ["archives"]` in `rednode-app.json`), and the
 * player allows it in the launcher.
 *
 * Good to know:
 *
 * - The new archive replaces the mounted archive of the same name, wherever it is,
 *   and stays installed. One the game has not mounted is added to `archive/pc/mod`.
 * - Objects already in the world keep the old asset until they load it again: respawn
 *   them, or apply their appearance again.
 * - Swap only in a loaded save. A broken archive, or a mod whose other parts are
 *   missing, can crash the game at the swap even if it loaded at start.
 *
 * @module
 */

import { cleanError, transport } from "./transport.js";

/** What {@link archives.reload} did. */
export interface ReloadResult {
  /** The files swapped in, as you named them. */
  reloaded: string[];
  /** The files that were not, and why. */
  failed: { file: string; why: string }[];
  /** What did the swap. */
  via: "red-hot-tools";
  /** How long the swap took, in milliseconds. */
  ms: number;
  /**
   * Only when an archive with the game's sound paks was swapped: whether the game's sound
   * index was loaded again (`"reloaded"`: the new sounds play), and what to know about it.
   * A sound that played just before the swap may keep its old version until the game loads
   * it again (for a weapon, equip it again).
   */
  sound?: { index: "reloaded" | "failed" | "not reloaded"; note: string };
  /**
   * The clothing V wears whose appearance was applied again after the swap, so it shows the
   * new version: each item's attachment slot (such as `"AttachmentSlots.Legs"`, or
   * Equipment-EX's `"OutfitSlots.LegsMiddle"`) and appearance. Absent with `refresh: false`.
   */
  refreshed?: { slot: string; appearance: string }[];
}

/** Options for {@link archives.reload}. */
export interface ReloadOptions {
  /**
   * After the swap, apply the appearance of the clothing V wears again, so it shows the
   * swapped version without being taken off (REDnode 0.26.20 or later). Base-game slots and
   * Equipment-EX's slots; items Equipment-EX hides stay hidden. Default `true`.
   */
  refresh?: boolean;
}

/**
 * What {@link archives.soundState} read: the game's sound pak index and the paks it has
 * open. Experimental: a diagnostic for the research into swapping sound paks (H1c), so
 * its shape may change. The sound fields follow the index file's columns (0.26.8's
 * `"at"` in a game run matched the decoded size of the katana sound in the game's archive,
 * so the names moved in 0.26.9); the pak fields past `pak` are guesses from the game's code.
 */
export interface SoundState {
  /** One line for logs, as the plugin log has it. */
  summary: string;
  /** The resource path hash the game loads its index from, as hex. */
  infoHash: string;
  /** Whether that hash is `base\sound\soundbanks\sfx_container.opusinfo`'s. */
  infoPathOk: boolean;
  /** The loaded index: one entry once the game has started. */
  indexes: {
    /** Sounds in the index. */
    sounds: number;
    /** Entries of its second table. */
    second: number;
    /** The size of its tables in memory. */
    bytes: number;
    /** Where its tables are, as hex. */
    at: string;
    /** A checksum of its tables, as hex: it changes when the index is read again from a new file. */
    checksum: string | null;
  }[];
  /** The paks the game has open: `pak` is the n of `sfx_container_<n>.opuspak`. */
  paks: {
    slot: number;
    index: number;
    pak: number;
    flag: number;
    serial: number;
    row: number;
    /** How many users hold it open. */
    refs: number;
    /** The game's reader for the file, as hex: a new one means the pak was opened again. */
    reader: string;
  }[];
  /**
   * How many sounds the game holds loaded (in memory, with references), or null when
   * REDnode does not know this game version's table of them. A held sound keeps the data
   * it was loaded with until the game lets it go, even after the index is read again.
   */
  held: number | null;
  /**
   * The sound ids asked for, where the index puts each, and how many references hold it loaded
   * (0: not loaded). `offset` is where the sound starts in its pak, `headerSize` the size of its
   * RIFF header (the Ogg Opus stream follows it), `length` its size in the pak with the header,
   * and `decodedBytes` its size decoded.
   */
  sounds: (
    | { id: number; found: false }
    | {
        id: number;
        found: true;
        index: number;
        row: number;
        pak: number;
        offset: number;
        length: number;
        headerSize: number;
        decodedBytes: number;
        held: number | null;
      }
  )[];
}

/** Hot-loading archives into the running game. */
export const archives = {
  /**
   * Swaps archives into the running game and waits until the swap is done. One swap
   * runs at a time; calls made meanwhile wait their turn.
   *
   * Name each file by a path: absolute, or in your package's folder. A name alone,
   * such as `"MyMod.archive"`, is an archive already in `archive/pc/mod`, reloaded as
   * it is. `.archive` files and ArchiveXL's `.xl` and `.yaml` files are accepted.
   *
   * An archive that changes the game's sound paks (`.opuspak`, `.opusinfo`, such as
   * EDGEwave's sound overrides) is swapped with the game paused and its audio held, and
   * then the game's sound index is loaded again, so the new sounds play; `sound` in the
   * answer says how it went. A sound that played just before the swap may keep its old
   * version until the game loads it again (for a weapon, equip it again).
   *
   * Then the clothing V wears applies its appearance again, so it shows the new version
   * while staying worn (`refreshed` in the answer lists it; `{ refresh: false }` skips it).
   * Other things already in the world keep the old version until they load it again.
   *
   * Throws when the package lacks the `archives` permission, at the main menu, when
   * RED Hot Tools is not loaded, or when a file is missing; also for a sound archive on a
   * game version whose sound tables REDnode does not know (install it and restart
   * instead). A file that could not be swapped is in `failed`, not thrown.
   *
   * @example
   * ```ts
   * import { archives } from "rednode";
   *
   * const r = await archives.reload(["C:/Projects/MyJacket/packed/archive/pc/mod/MyJacket.archive"]);
   * console.log(`${r.reloaded.length} swapped in ${r.ms} ms`, r.failed, r.refreshed);
   * ```
   */
  async reload(files: string | string[], options: ReloadOptions = {}): Promise<ReloadResult> {
    try {
      return (await transport().call("archives.reload", { files, refresh: options.refresh })) as ReloadResult;
    } catch (err) {
      throw cleanError(err);
    }
  },

  /**
   * Reads the game's sound pak index and the paks it has open, without changing them.
   * Experimental: a diagnostic for the research into swapping sound paks (H1c); see
   * {@link SoundState}. Give sound ids (the 32-bit ids an opusinfo lists) to see where
   * the index puts them. Needs no permission. Throws when REDnode does not know this
   * game version's sound tables.
   *
   * @example
   * ```ts
   * import { archives } from "rednode";
   *
   * const s = await archives.soundState([123456789]);
   * console.log(s.summary); // "1 index of ... sounds, checksum 0x...; 12 paks open: ..."
   * ```
   */
  async soundState(sounds: number[] = []): Promise<SoundState> {
    try {
      return (await transport().call("archives.soundState", { sounds })) as SoundState;
    } catch (err) {
      throw cleanError(err);
    }
  },
};
