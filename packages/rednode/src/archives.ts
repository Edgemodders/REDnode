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
   * RED Hot Tools is not loaded, or when a file is missing. A file that could not be
   * swapped is in `failed`, not thrown.
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
};
