/**
 * Quest facts and the journal, for testing a quest in the running game (Q-A, asked for by
 * EDGEquest). Facts are the game's named counters that quests read and set; the journal holds
 * the quests, phases and objectives the player sees.
 *
 * Setting a fact or a journal state changes the player's save.
 *
 * @module
 */

import { api, type GameRef } from "./api.js";
import { game } from "./game.js";

/** A fact's new value, as {@link quests.watch} hears it. */
export interface FactChange {
  name: string;
  value: number;
}

/** A journal entry's state. */
export type JournalState = "Inactive" | "Active" | "Succeeded" | "Failed";

/** A journal entry, as {@link journal.entry} reads it. */
export interface JournalEntry {
  path: string;
  state: JournalState | "Undefined";
  tracked: boolean;
}

/** What kind of entry a journal path names, or the game's class name for it. */
export type JournalKind = "quest" | "phase" | "objective" | "subobjective" | "mappin" | (string & {});

const KINDS: Record<string, string> = {
  quest: "gameJournalQuest",
  phase: "gameJournalQuestPhase",
  objective: "gameJournalQuestObjective",
  subobjective: "gameJournalQuestSubObjective",
  mappin: "gameJournalQuestMapPin",
};

type Any = GameRef & Record<string, (...args: unknown[]) => Promise<unknown>>;

async function questsSystem(): Promise<Any> {
  const qs = (await api.GameInstance.GetQuestsSystem(game.instance)) as unknown as Any | null;
  if (!qs) throw new Error("quests: no quests system: load a save first");
  return qs;
}

async function journalManager(): Promise<Any> {
  const j = (await api.GameInstance.GetJournalManager(game.instance)) as unknown as Any | null;
  if (!j) throw new Error("journal: no journal: load a save first");
  return j;
}

interface Watch {
  names: string[];
  handler: (change: FactChange) => void;
  listeners: { name: string; listener: GameRef; id: number }[];
  stops: (() => void)[];
  live: boolean;
}

const watches = new Set<Watch>();
let reattaching = false;

// Registers a watch's listeners with the quests system (again after a save load, which makes
// a new quests system and drops every object reference).
async function attach(w: Watch): Promise<void> {
  const qs = await questsSystem();
  w.listeners = [];
  for (const name of w.names) {
    const listener = (await api.$new("REDnodeFactListener", { fact: name })) as GameRef;
    const id = Number(await qs.RegisterListener(name, listener, "OnFact"));
    w.listeners.push({ name, listener, id });
  }
}

function followLoads(): void {
  if (reattaching) return;
  reattaching = true;
  game.on("PlayerPuppet.OnGameAttached", async () => {
    for (const w of watches) {
      if (!w.live) continue;
      try {
        await attach(w);
      } catch {
        // at the main menu: no quests system; the next load attaches them
      }
    }
  });
}

/**
 * The game's quest facts: named counters the quests read and set. An unset fact reads 0.
 *
 * @example
 * ```ts
 * import { quests } from "rednode";
 *
 * const stop = await quests.watch(["sq030_dam_meetup_done"], ({ name, value }) => console.log(name, value));
 * await quests.setFact("sq030_dam_meetup_done", 1); // the watcher logs it
 * ```
 */
export const quests = {
  /** One fact's value. */
  async fact(name: string): Promise<number> {
    return Number(await (await questsSystem()).GetFact(name));
  },
  /** Several facts at once, by name. */
  async facts(names: string[]): Promise<Record<string, number>> {
    const qs = await questsSystem();
    const values = await Promise.all(names.map((n) => qs.GetFact(n)));
    return Object.fromEntries(names.map((n, i) => [n, Number(values[i])]));
  },
  /** Sets a fact. It changes the player's save. */
  async setFact(name: string, value: number): Promise<void> {
    await (await questsSystem()).SetFact(name, Math.trunc(value));
  },
  /**
   * Calls `handler` with each change of the named facts, as the game makes it: no polling.
   * Kept across save loads. Resolves with a function that stops watching.
   */
  async watch(names: string[], handler: (change: FactChange) => void): Promise<() => Promise<void>> {
    const w: Watch = { names: [...new Set(names)], handler, listeners: [], stops: [], live: true };
    for (const name of w.names) {
      w.stops.push(game.on(`quests.fact:${name}`, (e) => handler({ name, value: Number((e as { value: number }).value) })));
    }
    watches.add(w);
    followLoads();
    await attach(w);
    return async () => {
      if (!w.live) return;
      w.live = false;
      watches.delete(w);
      for (const stop of w.stops) stop();
      try {
        const qs = await questsSystem();
        await Promise.all(w.listeners.map((l) => qs.UnregisterListener(l.name, l.id)));
      } catch {
        // the game is gone or at the main menu: nothing to unregister
      }
      w.listeners = [];
    };
  },
};

async function entryOf(j: Any, path: string, kind: JournalKind): Promise<GameRef | null> {
  return (await j.GetEntryByString(path, KINDS[kind] ?? kind)) as GameRef | null;
}

/**
 * The journal: the quests, phases and objectives the player sees, by their path.
 *
 * @example
 * ```ts
 * import { journal } from "rednode";
 *
 * const e = await journal.entry("quests/side_quests/sq030/...", "objective");
 * if (e?.state === "Active") await journal.setState(e.path, "Succeeded");
 * ```
 */
export const journal = {
  /** An entry's state and whether it is tracked, or `null` when the path is not in the journal. */
  async entry(path: string, kind: JournalKind = "objective"): Promise<JournalEntry | null> {
    const j = await journalManager();
    const entry = await entryOf(j, path, kind);
    if (!entry) return null;
    const [state, tracked] = await Promise.all([j.GetEntryState(entry), j.IsEntryTracked(entry)]);
    return { path, state: String(state) as JournalEntry["state"], tracked: Boolean(tracked) };
  },
  /** Changes an entry's state, with the game's notification. It changes the player's save. */
  async setState(path: string, state: JournalState, kind: JournalKind = "objective"): Promise<boolean> {
    const j = await journalManager();
    return Boolean(await j.ChangeEntryState(path, KINDS[kind] ?? kind, state, "Notify"));
  },
  /** Tracks an entry, as the player does in the journal. */
  async track(path: string, kind: JournalKind = "objective"): Promise<boolean> {
    const j = await journalManager();
    const entry = await entryOf(j, path, kind);
    if (!entry) return false;
    await j.TrackEntry(entry);
    return true;
  },
  /**
   * The tracked entry: its path, built from its id and its parents' (`quests/…/objective`;
   * unverified that it matches every path the journal takes), and its hash. `null` when
   * nothing is tracked.
   */
  async tracked(): Promise<{ path: string; hash: number } | null> {
    const j = await journalManager();
    const entry = (await j.GetTrackedEntry()) as Any | null;
    if (!entry) return null;
    const ids: string[] = [];
    for (let e: Any | null = entry; e && ids.length < 12; e = (await j.GetParentEntry(e)) as Any | null) {
      const id = String(await e.GetId());
      if (id) ids.unshift(id);
    }
    return { path: ids.join("/"), hash: Number(await j.GetEntryHash(entry)) };
  },
};
