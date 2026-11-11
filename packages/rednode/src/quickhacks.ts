/**
 * Functions on quickhacks (#42, asked for by EDGEhack): a scan check that decides, per enemy, whether
 * a quickhack shows usable or disabled, and a function that runs when it lands, for damage or logic the
 * game's records cannot express. Open to any mod. People only for now: devices build their list
 * elsewhere.
 *
 * How the scan check works: the game builds the list in one go and cannot wait for a Node mod, so the
 * hack shows locked with "Checking" while REDnode asks your `canUse`, remembers the answer per enemy
 * and hack, and rebuilds the list. "Checking" stays up for one second the first time V scans an enemy
 * (`hold`), so it can be read; later scans of that enemy show the answer at once. With no answer within
 * about a second (the mod is off, `canUse` threw or hung), the game's own result stands and the mod log
 * says why. A `canUse` that reads only `target` answers fastest: each game call costs about a frame.
 *
 * `onLand` runs a frame or two after the upload completes on a living enemy. It adds to what the hack
 * does and cannot cancel it: use `canUse` for a hack that should not land at all.
 *
 * When the package stops, its functions go and every hack is the game's own again. They are set again
 * after each save load by themselves.
 *
 * @module
 */

import { api } from "./api.js";
import { game, type GameEvent } from "./game.js";
import { pkg } from "./pkg.js";
import { tweakdb } from "./tweakdb.js";

/** The enemy a quickhack function is about, as it was when the game asked. */
export interface QuickhackTarget {
  /** The enemy's entity ID hash, as a string (the same as {@link GameEvent.entityId}). */
  id: string;
  /** Its level. */
  level: number;
  /** Its health in points. */
  health: number;
  /** Its health in percent, 0 to 100. */
  healthPercent: number;
  isHuman: boolean;
  isBoss: boolean;
  isMechanical: boolean;
  isDrone: boolean;
  isAndroid: boolean;
  isElite: boolean;
  isCivilian: boolean;
  /**
   * Lowers its health by `amount` points, with V as the one who did it. No damage type: for typed damage,
   * {@link addEffect} with a damage status effect, as the game's own hacks do. Whether a kill this way
   * counts as V's is unverified. Resolves false when the enemy is gone.
   */
  damage(amount: number): Promise<boolean>;
  /** Puts a status effect on it with V as the one who applied it, such as `"BaseStatusEffect.Burning"`. Resolves false when the enemy is gone. */
  addEffect(effect: string): Promise<boolean>;
}

/** Which quickhack it is. */
export interface QuickhackUse {
  /** The hack's action record, such as `"QuickHack.OverheatLvl2Hack"`. */
  action: string;
  /** The first item in the list given to {@link quickhacks.define} that has this hack. */
  item: string;
  /** That item's place in the list, from 1: list a family's items lowest tier first, and this is the tier. */
  tier: number;
  /** For `onLand`: the hack reached this enemy by spreading from another one (its `…Spread` action). */
  spread: boolean;
  /** For `onLand`: V uploaded it (false for a hack someone else used, unverified whether that happens). */
  byV: boolean;
}

/** What {@link quickhacks.define} takes. */
export interface QuickhackFunctions {
  /** Whether the hack shows usable on this enemy. Asked when V scans it, and again while the list is open. */
  canUse?(target: QuickhackTarget, hack: QuickhackUse): boolean | Promise<boolean>;
  /** Runs when the hack lands on a living enemy. */
  onLand?(target: QuickhackTarget, hack: QuickhackUse): void | Promise<void>;
  /** What a disabled hack says on the wheel. Default `"Not on this target"`. */
  disabledText?: string;
  /** Seconds "Checking" stays up the first time V scans an enemy, whatever the answer. Default 1. */
  hold?: number;
}

/** A defined quickhack, as {@link quickhacks.defined} lists it. */
export interface QuickhackDefine {
  items: string[];
  actions: string[];
}

interface Def {
  items: string[];
  fns: QuickhackFunctions;
  hacks: { action: string; item: string; tier: number; spread: boolean }[];
  keys: number[];
  live: boolean;
}

const defs = new Set<Def>();
const byKey = new Map<number, { def: Def; hack: Def["hacks"][number] }>();
let listening = false;

const QUICKHACK = "ObjectActionType.PuppetQuickHack";

async function script(fn: string, ...args: unknown[]): Promise<unknown> {
  return api.$static("REDnodeQuickhacks", fn, ...args);
}

// The hacks of a list of items: each item's quickhack actions (Boss and Chimera ones included), in
// the order given, and each one's spread action when the game has one.
async function hacksOf(items: string[]): Promise<Def["hacks"]> {
  const hacks: Def["hacks"] = [];
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    const actions = await tweakdb.get<string[]>(`${item}.objectActions`);
    if (!Array.isArray(actions)) throw new Error(`quickhacks.define: ${item} is not an item with object actions`);
    for (const action of actions) {
      if (seen.has(action)) continue;
      if ((await tweakdb.get<string>(`${action}.objectActionType`)) !== QUICKHACK) continue;
      seen.add(action);
      hacks.push({ action, item, tier: i + 1, spread: false });
      const spread = `${action}Spread`;
      if (!seen.has(spread) && (await tweakdb.type(spread))) {
        seen.add(spread);
        hacks.push({ action: spread, item, tier: i + 1, spread: true });
      }
    }
  }
  if (!hacks.length) throw new Error(`quickhacks.define: ${items.join(", ")} ${items.length === 1 ? "has" : "have"} no quickhack actions`);
  return hacks;
}

// Sends a define's hacks to the game's script; again after each save load, which makes a new script
// system and new keys. With no script system yet (the main menu), it waits for the next load.
async function attach(def: Def): Promise<void> {
  for (const key of def.keys) byKey.delete(key);
  def.keys = [];
  const text = def.fns.disabledText ?? "Not on this target";
  const hold = def.fns.hold ?? 1;
  for (const hack of def.hacks) {
    const check = !!def.fns.canUse && !hack.spread;
    const land = !!def.fns.onLand;
    if (!check && !land) continue;
    const key = Number(await script("Define", pkg.id, hack.action, check, land, text, hold));
    if (key < 0) {
      const owner = String(await script("OwnerOf", hack.action));
      if (!owner && String(await script("Counts")) === "no quickhacks system") return;
      throw new Error(`quickhacks.define: ${hack.action} is defined by ${owner || "another package"} already`);
    }
    def.keys.push(key);
    byKey.set(key, { def, hack });
  }
}

function targetOf(e: GameEvent): { target: QuickhackTarget; key: number; byV: boolean } | null {
  const parts = (e.text ?? "").split("|");
  const key = Number(parts[0]);
  if (!e.entityId || !Number.isFinite(key)) return null;
  const kind = parts[4] ?? "";
  const flag = (i: number): boolean => kind[i] === "1";
  const id = e.entityId;
  const target: QuickhackTarget = {
    id,
    level: Number(parts[1]) || 0,
    health: Number(parts[2]) || 0,
    healthPercent: Number(parts[3]) || 0,
    isHuman: flag(0),
    isBoss: flag(1),
    isMechanical: flag(2),
    isDrone: flag(3),
    isAndroid: flag(4),
    isElite: flag(5),
    isCivilian: flag(6),
    async damage(amount: number) {
      return (await script("Damage", { hash: id }, Number(amount))) === true;
    },
    async addEffect(effect: string) {
      return (await script("AddEffect", { hash: id }, effect)) === true;
    },
  };
  return { target, key, byV: parts[5] === "V" };
}

function listen(): void {
  if (listening) return;
  listening = true;
  game.on("quickhacks.scan", async (e: GameEvent) => {
    const t = targetOf(e);
    const found = t && byKey.get(t.key);
    if (!t || !found?.def.live || !found.def.fns.canUse) return;
    const { hack } = found;
    let usable: boolean;
    try {
      usable = !!(await found.def.fns.canUse(t.target, { ...hack, byV: true }));
    } catch (err) {
      console.error(`quickhacks: canUse for ${hack.action} threw, so the game's own result stands: ${(err as Error).message}`);
      return;
    }
    try {
      await script("Answer", { hash: t.target.id }, t.key, usable);
    } catch {
      // the game is loading or gone: the next scan asks again
    }
  });
  game.on("quickhacks.land", async (e: GameEvent) => {
    const t = targetOf(e);
    const found = t && byKey.get(t.key);
    if (!t || !found?.def.live || !found.def.fns.onLand) return;
    try {
      await found.def.fns.onLand(t.target, { ...found.hack, byV: t.byV });
    } catch (err) {
      console.error(`quickhacks: onLand for ${found.hack.action} threw: ${(err as Error).message}`);
    }
  });
  game.on("PlayerPuppet.OnGameAttached", async () => {
    for (const def of defs) {
      if (!def.live) continue;
      try {
        await attach(def);
      } catch (err) {
        console.error(`quickhacks: could not set ${def.items.join(", ")} again after the load: ${(err as Error).message}`);
      }
    }
  });
}

/**
 * Functions on quickhacks: a scan check and an on-land function per quickhack.
 *
 * @example
 * ```ts
 * import { quickhacks } from "rednode";
 *
 * // Overheat is usable only on people, and lands harder on the wounded.
 * await quickhacks.define("Items.OverheatLvl4Program", {
 *   canUse: (target) => target.isHuman,
 *   disabledText: "People only",
 *   async onLand(target, hack) {
 *     if (target.healthPercent < 50) await target.damage(40 * hack.tier);
 *   },
 * });
 * ```
 */
export const quickhacks = {
  /**
   * Gives one quickhack, or a family of them, a scan check, an on-land function, or both. `items` is
   * one quickhack item record, or a family's items lowest tier first (then `hack.tier` is the tier).
   * REDnode finds the items' hacks, Boss and Chimera versions and spread included. A hack already
   * defined, by another package or by another define of this one, is refused. Resolves to a function
   * that takes the define away.
   *
   * It can be called at the main menu: the functions then start with the next save load.
   */
  async define(items: string | string[], fns: QuickhackFunctions): Promise<() => Promise<void>> {
    const list = (Array.isArray(items) ? items : [items]).map(String);
    if (!list.length) throw new Error("quickhacks.define: name at least one quickhack item");
    if (!fns || (!fns.canUse && !fns.onLand)) throw new Error("quickhacks.define: give canUse, onLand or both");
    const def: Def = { items: list, fns, hacks: await hacksOf(list), keys: [], live: true };
    // The script lets a package replace its own define, so a clash inside one package is refused here.
    for (const other of defs) {
      const taken = def.hacks.find((h) => other.hacks.some((o) => o.action === h.action));
      if (taken) throw new Error(`quickhacks.define: ${taken.action} is defined by this package already (for ${other.items.join(", ")}): take that define away first`);
    }
    listen();
    try {
      await attach(def);
    } catch (err) {
      for (const key of def.keys) await script("Remove", key).catch(() => {});
      for (const key of def.keys) byKey.delete(key);
      if (/no game class "REDnodeQuickhacks"|has no static function/.test((err as Error).message))
        throw new Error("quickhacks.define needs REDnode's scripts in the game (REDnodeQuickhacks.reds): reinstall REDnode");
      throw err;
    }
    defs.add(def);
    return async () => {
      if (!def.live) return;
      def.live = false;
      defs.delete(def);
      for (const key of def.keys) {
        byKey.delete(key);
        await script("Remove", key).catch(() => {});
      }
      def.keys = [];
    };
  },

  /** This package's defines. */
  defined(): QuickhackDefine[] {
    return [...defs].map((d) => ({ items: [...d.items], actions: d.hacks.map((h) => h.action) }));
  },

  /** The script's counters (defines, list rebuilds, asks, answers given up on, landings), for tests. */
  async counts(): Promise<string> {
    return String(await script("Counts"));
  },
};
