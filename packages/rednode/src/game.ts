/**
 * Tier 2 API: asynchronous mods and overlay apps.
 *
 * Events flow out of the game, queries and commands flow in. Nothing here
 * blocks the game thread: a query is answered on the game thread between
 * frames, and the promise resolves after that.
 *
 * The same calls work in a Node mod and in an overlay app, and give the same
 * answers.
 *
 * @module
 */

import { api } from "./api.js";
import { currentLanguage, startText, type Language } from "./i18n.js";
import { cleanError, transport, type HostMessage } from "./transport.js";
import { tweakdb } from "./tweakdb.js";

/** Stops a subscription made with {@link Game.on} or {@link Game.onState}. */
export type Unsubscribe = () => void;

/**
 * Handles one game event. May be async: the game never waits for it.
 *
 * @typeParam T - The event payload.
 */
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

/** A position in the game world, in meters. */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** A game event, as sent by the REDnode plugin. */
export interface GameEvent {
  /** The event name, for example `"PlayerPuppet.OnGameAttached"`. */
  name: string;
  /** A number sent with the event. */
  value: number;
  /** The plugin's frame counter when the event was sent. */
  frame: number;
  /** For entity events (see {@link world}): the entity's ID hash, as a string. */
  entityId?: string;
  /** For entity events: the entity's class, for example `"gameObject"`. */
  entityType?: string;
  /** For the `"language"` event: the game's new interface language, such as `"fr-fr"`. */
  language?: string;
}

/** What the game is showing, and whether REDnode is linked to it. */
export interface GameState {
  /** True while the overlay host is linked to the game. All other fields are false when it is not. */
  connected: boolean;
  /** A game menu is open: inventory, map, pause menu and so on. */
  menu: boolean;
  /** Photo mode is on. */
  photoMode: boolean;
  /** A scene that takes control of V, such as a cutscene. The threshold is unverified. */
  scene: boolean;
  /** The main menu, before a save is loaded. */
  mainMenu: boolean;
  /**
   * V is in the world: a save has loaded and no other load has started. False while the
   * game starts, at the main menu and from the moment a load starts, from the pause menu
   * too. Call the game's world systems (time, weather, districts, quests) only while it
   * is true: {@link api} refuses them while it is false, since some crash the game before
   * the world exists. {@link Game.onState} tells when it changes. From REDnode 0.47.0.
   */
  world: boolean;
  /** The overlay's input mode, switched with F10. */
  overlay: "passive" | "interactive" | "hidden";
}

/** The player character, V. */
export interface Player {
  /**
   * Reads V's position in the world.
   *
   * Rejects at the main menu and while a save loads, when there is no player.
   *
   * @example
   * ```ts
   * const { x, y, z } = await game.player.position();
   * console.log(`V is at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
   * ```
   */
  position(): Promise<Vector3>;

  /**
   * Reads V's health, in health points. Built on {@link api}: the stat pools
   * system's `Health` pool.
   *
   * @example
   * ```ts
   * const hp = await game.player.getHealth();
   * ```
   */
  getHealth(): Promise<number>;

  /**
   * Sets V's health, in health points. Applied by the game on its next update.
   *
   * @param value - New health points. The game caps it at V's maximum.
   *
   * @example
   * ```ts
   * await game.player.setHealth(1); // one hit from death
   * ```
   */
  setHealth(value: number): Promise<void>;

  /**
   * Moves V: to a position (`yaw` in degrees, 0 by default), or to a world node by its
   * reference (`"$/…"`, or its hash as a string; unverified which forms the game takes).
   *
   * @example
   * ```ts
   * const here = await game.player.position();
   * await game.player.teleport({ ...here, z: here.z + 20 }); // a drop from 20 m
   * ```
   */
  teleport(to: { x: number; y: number; z: number; yaw?: number } | { nodeRef: string }): Promise<void>;

  /**
   * Puts items in V's inventory by their TweakDB id, as Cyber Engine Tweaks'
   * `Game.AddToInventory` does. Built on the transaction system's `GiveItemByTDBID`.
   * Rejects when there is no such record, so a typo is not given as an empty item.
   *
   * @param id - The item's record, such as `"Items.Pants_01_basic_01"`.
   * @param count - How many, 1 by default.
   *
   * @example
   * ```ts
   * await game.player.addItem("Items.Pants_01_basic_01");
   * await game.player.addItem("Items.money", 5000); // eddies
   * ```
   */
  addItem(id: string, count?: number): Promise<void>;

  /**
   * Takes items out of V's inventory by their TweakDB id. Resolves with whether the
   * game took any. Built on the transaction system's `RemoveItemByTDBID`.
   *
   * @param id - The item's record, such as `"Items.Pants_01_basic_01"`.
   * @param count - How many, 1 by default.
   *
   * @example
   * ```ts
   * await game.player.removeItem("Items.money", 100);
   * ```
   */
  removeItem(id: string, count?: number): Promise<boolean>;
}

/** The game's audio. */
export interface Audio {
  /**
   * Plays a game sound event, the way the game plays its UI sounds.
   *
   * Sound event names are listed in the game's audio data. These are tested:
   * `ui_menu_onpress`, `ui_menu_hover`, `ui_loot_take_all`. The Overlay apps guide lists more.
   *
   * @param name - The sound event name.
   *
   * @example
   * ```ts
   * await game.audio.play("ui_menu_onpress");
   * ```
   */
  play(name: string): Promise<void>;
}

/** Entry point for Tier 2 mods and overlay apps. Use the {@link game} instance. */
export interface Game {
  /**
   * Subscribes to a game event.
   *
   * Events are named by the game class and method that raise them. Today the
   * plugin sends `"PlayerPuppet.OnGameAttached"`, at the main menu and on every
   * save load. Events from any hooked game function arrive with phase P2.
   *
   * @typeParam T - The event payload.
   * @param name - Event name, for example `"PlayerPuppet.OnGameAttached"`.
   * @param handler - Called for every occurrence. The game does not wait for it.
   * @returns A function that stops the subscription.
   *
   * @example
   * ```ts
   * const stop = game.on("PlayerPuppet.OnGameAttached", async () => {
   *   console.log("A save was loaded");
   * });
   * ```
   */
  on<T = GameEvent>(name: string, handler: EventHandler<T>): Unsubscribe;

  /**
   * The interface language the player chose in the game: its own name (`"fr-fr"`) and the
   * standard tag (`"fr-FR"`) for `Intl`. `game.on("language", …)` hears a change, with the new
   * name in the event's `language`.
   *
   * @example
   * ```ts
   * const { tag } = await game.language();
   * const eddies = new Intl.NumberFormat(tag).format(123456);
   * ```
   */
  language(): Promise<Language>;

  /**
   * Reads what the game is showing: menus, photo mode, scenes, the main menu.
   *
   * @example
   * ```ts
   * const s = await game.state();
   * if (s.world) console.log("V is in the world");
   * ```
   */
  state(): Promise<GameState>;

  /**
   * Calls a handler whenever the game state changes, and once at the start
   * with the current state.
   *
   * @example
   * ```ts
   * game.onState((s) => console.log(s.menu ? "menu open" : "menu closed"));
   *
   * // Read the world only while V is in it.
   * let reading: ReturnType<typeof setInterval> | undefined;
   * game.onState((s) => {
   *   if (s.world && !reading) reading = setInterval(readWeather, 1000);
   *   if (!s.world && reading) {
   *     clearInterval(reading);
   *     reading = undefined;
   *   }
   * });
   * ```
   */
  onState(handler: EventHandler<GameState>): Unsubscribe;

  /**
   * Calls a bridge method by name. The typed calls such as
   * {@link Player.position} are built on it.
   *
   * @typeParam T - The result type.
   * @param method - For example `"player.position"`.
   * @param params - The method's parameters, if any.
   *
   * @example
   * ```ts
   * const info = await game.call<{ frame: number }>("game.info");
   * ```
   */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

  /** The player character. */
  readonly player: Player;

  /** The game's audio. */
  readonly audio: Audio;

  /**
   * The game instance, for the many game functions whose first argument is a
   * `GameInstance`.
   *
   * @example
   * ```ts
   * const stats = await api.GameInstance.GetStatsSystem(game.instance);
   * ```
   */
  readonly instance: Record<string, never>;
}

const instance: Record<string, never> = Object.freeze({}) as Record<string, never>;

async function player() {
  const p = await api.GetPlayer(instance);
  if (!p) throw new Error("No player. Load a save first.");
  return p;
}

// The player's id for stat systems: Cast<StatsObjectID>(player.GetEntityID()).
async function playerStatsId() {
  const id = await (await player()).GetEntityID();
  return (await api.$call("Cast;EntityID;StatsObjectID", id)) as Record<string, unknown>;
}

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  try {
    return (await transport().call(method, params)) as T;
  } catch (err) {
    throw cleanError(err);
  }
}

function toState(raw: Record<string, unknown> | undefined): GameState {
  const s = (raw ?? {}) as Partial<GameState>;
  const connected = !!s.connected;
  return {
    connected,
    menu: connected && !!s.menu,
    photoMode: connected && !!s.photoMode,
    scene: connected && !!s.scene,
    mainMenu: connected && !!s.mainMenu,
    world: connected && !!s.world,
    overlay: s.overlay ?? "passive",
  };
}

function listen(fn: (m: HostMessage) => void): Unsubscribe {
  return transport().listen(fn);
}

/**
 * The running game, as seen from a Tier 2 mod or an overlay app.
 *
 * @example
 * ```ts
 * import { game } from "rednode";
 *
 * game.on("PlayerPuppet.OnGameAttached", async () => {
 *   const p = await game.player.position();
 *   console.log("Loaded at", p);
 * });
 * ```
 */
export const game: Game = {
  on<T>(name: string, handler: EventHandler<T>) {
    return listen((m) => {
      if (m.event === "game" && m.name === name) {
        const e: GameEvent = { name: String(m.name), value: Number(m.value), frame: Number(m.frame) };
        if (typeof m.entityId === "string") e.entityId = m.entityId;
        if (typeof m.entityType === "string") e.entityType = m.entityType;
        if (typeof m.language === "string") e.language = m.language;
        void handler(e as T);
      }
    });
  },
  async language() {
    await startText();
    return currentLanguage();
  },
  async state() {
    const s = await transport().state();
    return toState(s.game as Record<string, unknown>);
  },
  onState(handler) {
    let stopped = false;
    let last = "";
    const deliver = (s: GameState) => {
      const key = JSON.stringify(s);
      if (stopped || key === last) return;
      last = key;
      void handler(s);
    };
    const stop = listen((m) => {
      if (m.event === "state") deliver(toState(m.state as Record<string, unknown>));
    });
    void game.state().then(deliver);
    return () => {
      stopped = true;
      stop();
    };
  },
  call,
  instance,
  player: {
    async position() {
      const v = await (await player()).GetWorldPosition();
      return { x: v.X, y: v.Y, z: v.Z };
    },
    async getHealth() {
      const pools = await api.GameInstance.GetStatPoolsSystem(instance);
      return pools!.GetStatPoolValue(await playerStatsId(), "Health", false);
    },
    async setHealth(value: number) {
      const pools = await api.GameInstance.GetStatPoolsSystem(instance);
      await pools!.RequestSettingStatPoolValue(await playerStatsId(), "Health", value, api.$null, false); // no instigator, as the game's scripts do
    },
    async teleport(to) {
      const facility = (await api.GameInstance.GetTeleportationFacility(instance)) as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      > | null;
      if (!facility) throw new Error("teleport: no teleportation facility: load a save first");
      const p = await player();
      if ("nodeRef" in to) await facility.TeleportToNode(p, to.nodeRef);
      else await facility.Teleport(p, { X: to.x, Y: to.y, Z: to.z, W: 1 }, { Roll: 0, Pitch: 0, Yaw: to.yaw ?? 0 });
    },
    async addItem(id, count = 1) {
      if (!(await tweakdb.record(id))) throw new Error(`addItem: no record "${id}" in TweakDB`);
      const shop = await api.GameInstance.GetTransactionSystem(instance);
      const ok = await shop!.GiveItemByTDBID(await player(), id, count);
      if (!ok) throw new Error(`addItem: the game did not give "${id}"`);
    },
    async removeItem(id, count = 1) {
      const shop = await api.GameInstance.GetTransactionSystem(instance);
      return shop!.RemoveItemByTDBID(await player(), id, count);
    },
  },
  audio: {
    async play(name: string) {
      const audio = await api.GameInstance.GetAudioSystem(instance);
      await audio!.Play(name);
    },
  },
};
