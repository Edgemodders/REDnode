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
}

/**
 * What {@link archives.soundState} read: the game's sound pak index and the paks it has
 * open. Experimental: a diagnostic for the research into swapping sound paks (H1c), so
 * its shape may change. Field names past `pak` are guesses from the game's code.
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
  /** The sound ids asked for, and where the index puts each. */
  sounds: (
    | { id: number; found: false }
    | { id: number; found: true; index: number; row: number; pak: number; offset: number; size: number; headerSize: number; x10: number }
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
   * Throws when the package lacks the `archives` permission, at the main menu, when
   * RED Hot Tools is not loaded, or when a file is missing. Also throws for an archive
   * that changes the game's sound paks (`.opuspak`, `.opusinfo`): swapping those into a
   * running game crashes it, so install it and restart instead. A file that could not
   * be swapped is in `failed`, not thrown.
   *
   * @example
   * ```ts
   * import { archives } from "rednode";
   *
   * const r = await archives.reload(["C:/Projects/MyJacket/packed/archive/pc/mod/MyJacket.archive"]);
   * console.log(`${r.reloaded.length} swapped in ${r.ms} ms`, r.failed);
   * ```
   */
  async reload(files: string | string[]): Promise<ReloadResult> {
    try {
      return (await transport().call("archives.reload", { files })) as ReloadResult;
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
