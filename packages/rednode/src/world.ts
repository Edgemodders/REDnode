/**
 * Placing entities in the world: spawn one with components attached, move it,
 * remove it, and hear its lifecycle. Uses Codeware (1.14 or later) in the game,
 * through REDnode's own script part; without Codeware these calls reject and say so.
 *
 * @module
 */

import { api, invoke, type GameRef } from "./api.js";
import { game, type GameEvent } from "./game.js";
import { readScene, type Scene, type ScenePlan, type SceneRead } from "./scene.js";
import { cleanError, transport } from "./transport.js";

/** An entity's ID, as the game API passes it: its 64-bit hash as a string. */
export interface EntityId {
  hash: string;
}

/** A position in the world, in metres. */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** A rotation as a quaternion, the game's own form. */
export interface WorldRotation {
  i: number;
  j: number;
  k: number;
  r: number;
}

/** What {@link world.spawn} places. */
export interface SpawnOptions {
  /** An entity template's depot path (`.ent`), or its hash. One of `template`, `record` and `mesh`. */
  template?: string;
  /** A TweakDB record, such as `"Character.Panam"`. One of `template`, `record` and `mesh`. */
  record?: string;
  /**
   * A mesh's depot path (`.mesh`): a prop with just that mesh, on a bare entity. One of
   * `template`, `record` and `mesh`; with `template`, the mesh is added to it.
   */
  mesh?: string;
  /** The mesh's own appearance, for `mesh`. Default `"default"`. */
  meshAppearance?: string;
  /** The mesh's size, for `mesh`. Default 1 on each axis. */
  scale?: WorldPoint;
  /** The appearance to use. */
  appearance?: string;
  /**
   * For a person: stand where placed (a hold command) and stay friendly to V. On by
   * default for a `Character.*` record; `false` leaves the game's own behaviour.
   */
  npc?: boolean | { hold?: boolean; friendly?: boolean };
  /** Keep it in the save: it comes back when that save loads (about 8 s after). Default `false`. */
  keep?: boolean;
  position: WorldPoint;
  /** A quaternion; or use `yaw`. Default: facing north. */
  orientation?: WorldRotation;
  /** Turn around the vertical axis, in degrees, when `orientation` is not given. */
  yaw?: number;
  /** Components to attach while the entity assembles, made with `api.$new`. */
  components?: GameRef[];
  /** More tags for the entity, for your own bookkeeping. */
  tags?: string[];
  /**
   * How long to wait for the entity to be in the world. Default 10 seconds. If it is not in
   * by then, it is removed and `world.spawn` throws: nothing was spawned.
   */
  timeoutMs?: number;
  /**
   * `false` resolves as soon as the entity is created, with `entity: null`, without waiting
   * for it to be in the world (far from V, or still streaming in). It is this package's spawn
   * all the same: {@link world.move}, {@link world.remove}, the respawn after an archive swap
   * and the clean-up when the package stops all work. {@link world.spawned} says when it is
   * in (`attached`), and so does `world.on("Entity/AfterAttach")`. A person is made to hold
   * their place and stay friendly once they attach. Default `true`.
   */
  wait?: boolean;
  /**
   * Ask the game to keep it spawned for the whole session, wherever V is, instead of only while
   * V is around (Codeware's `DynamicEntitySpec.alwaysSpawned`). For objects far from V, such as
   * around an editor camera; use it with `wait: false`. It then stays for the session until
   * removed, wherever V goes, so remove what you no longer show. Default `false`.
   */
  alwaysSpawned?: boolean;
  /**
   * Pins the entity with a label (#43): a title, or a {@link PinLabel}. The pin follows the
   * entity, is spawned again with it after an archive swap, and goes when it is removed.
   */
  label?: string | PinLabel;
}

/** A spawned entity. */
export interface Spawned {
  id: EntityId;
  /** The entity itself, or null if it is gone again. */
  entity: GameRef | null;
}

/** The entity events REDnode passes on. `Entity/Attached` is Codeware's old name for `Entity/AfterAttach`. */
export type EntityEventName = "Entity/Initialize" | "Entity/AfterAttach" | "Entity/Attached" | "Entity/Detach";

/** An entity near V, as {@link world.near} finds it. */
export interface NearEntity {
  entity: GameRef;
  id: EntityId;
  /** Its game class, such as `"NPCPuppet"` or `"VendingMachine"`. */
  type: string;
  /** Metres from V. */
  distance: number;
  /** Its current appearance name. */
  appearance: string;
  /** With `files` or `uses`: the path hashes of the files it uses ("0x..."). */
  files?: string[];
  /** With `uses`: which of those it uses. */
  matches?: string[];
}

/** Options for {@link world.near}. */
export interface NearOptions {
  /** Metres from V. Default 15. */
  radius?: number;
  /** Also read the files each entity uses. */
  files?: boolean;
  /** Only entities that use one of these files: depot paths or path hashes. */
  uses?: string[];
}

/** The files an entity uses, as {@link world.files} reads them. */
export interface EntityFiles {
  /** Its template's path hash, or null. */
  template: string | null;
  /** How many components it has. */
  components: number;
  /** The path hashes of its template and every resource its components name ("0x..."). */
  files: string[];
}

/** One of this package's spawns, as {@link world.spawned} lists them. */
/**
 * How a pin looks (#43). Every field is optional; a pin starts from the HUD style, then from
 * the style {@link world.pinStyle} set for all of this package's pins, then its own.
 */
export interface PinStyle {
  /** The label's border and title, the post and the edge arrow, as `#rrggbb`. The HUD's cyan by default. */
  color?: string;
  /** The label's font family, such as `"Rajdhani"` (the default) or `"Segoe UI"`. */
  font?: string;
  /** The title's size in pixels at full size, 10 to 48. Default 18. */
  titleSize?: number;
  /** The text line's size in pixels at full size, 8 to 36. Default 14; the distance is a pixel smaller. */
  textSize?: number;
  /** The post's height in metres; the label sits on top of it. Default 3. */
  pinHeight?: number;
  /**
   * How the pin's size follows distance, and what a wall between does:
   *
   * - `"fit"` (default): full size up to 15 m, then shrinks with distance down to
   *   `minScreenSize`, and stays. Behind a wall it is still drawn, dimmed.
   * - `"world"`: a real size, shrinking with distance, too small to see from far away.
   *   Hidden behind a wall.
   * - `"screen"`: the same size on screen at any distance, seen through walls.
   */
  scale?: "fit" | "world" | "screen";
  /** For `"fit"`: the smallest it gets, from 0.1 to 1 of its full size. Default 0.45. */
  minScreenSize?: number;
}

/** What {@link world.pin} takes (#43). */
export interface PinOptions {
  /**
   * Where the post stands: a place in world metres (its foot), or an entity's id, which the pin
   * follows wherever it goes (its foot at the entity's position). With an entity id, `x`, `y`
   * and `z` beside `hash` are where it is drawn until REDnode finds the entity.
   */
  at: WorldPoint | EntityId | (EntityId & WorldPoint);
  /** The label's first line, up to 80 characters. */
  title: string;
  /** An optional second line, up to 160 characters. */
  text?: string;
  /** How it looks: colour, font, sizes, the post's height and its scale. */
  style?: PinStyle;
  /** WP1's name for `style.color`, still read. */
  color?: string;
  /** WP1's name for `style.pinHeight`, still read. */
  height?: number;
}

/** A pin, as {@link world.pins} lists it. */
export interface PinEntry {
  id: number;
  /** The package that dropped it. */
  owner: string | null;
  /** Where it is: its own place, or where the entity it follows was last seen. Null for an entity not found yet. */
  at: WorldPoint | null;
  /** The entity it follows, or null. */
  entity: EntityId | null;
  title: string;
  text: string;
  /** Its whole style, with every default filled in. */
  style: Required<Omit<PinStyle, "font">> & { font: string | null };
  /** `style.color`, as WP1 listed it. */
  color: string;
  /** `style.pinHeight`, as WP1 listed it. */
  height: number;
  /** Metres from the camera, or null before REDnode has read the camera. */
  distance: number | null;
}

/** A label for what {@link world.spawn} or {@link world.load} spawns: a pin that goes with the entity. */
export interface PinLabel {
  title: string;
  text?: string;
  style?: PinStyle;
}

export interface SpawnedEntry {
  id: EntityId;
  options: SpawnOptions;
  /** True while the entity is in the world (it attached, and has not detached since). */
  attached: boolean;
  /** The scene it belongs to, when {@link world.load} spawned it. */
  scene?: string;
  /** The id of its label's pin, with `label`. */
  pin?: number;
}

/** What {@link world.load} did. */
export interface LoadResult {
  name: string;
  /** Each scene object spawned, by its id in the scene. */
  spawned: { object: string; id: EntityId }[];
  /** Objects not spawned, and why. */
  skipped: { object: string; why: string }[];
  notes: string[];
  ms: number;
}

const NEEDS_CODEWARE = "needs Codeware 1.14 or later in the game (REDnode's world support compiles only with it)";

// Calls REDnode's script part; a missing class means Codeware is not installed.
async function script(fn: string, ...args: unknown[]): Promise<unknown> {
  try {
    return await api.$static("REDnodeWorld", fn, ...args);
  } catch (err) {
    const message = (err as Error).message;
    if (/no game class "REDnodeWorld"|has no static function/.test(message)) throw new Error(`world.${fn.toLowerCase()} ${NEEDS_CODEWARE}`);
    throw err;
  }
}

const vector = (p: WorldPoint) => ({ X: p.x, Y: p.y, Z: p.z, W: 1 });
function rotation(o?: WorldRotation, yaw?: number): WorldRotation {
  if (o) return o;
  const half = (((yaw ?? 0) * Math.PI) / 180) / 2;
  return { i: 0, j: 0, k: Math.sin(half), r: Math.cos(half) };
}
const idOf = (id: EntityId | string) => (typeof id === "string" ? { hash: id } : { hash: String(id.hash) });

// A spawn's label as a pin on the entity, drawn at its spawn place until REDnode finds it.
async function pinSpawn(id: EntityId, options: SpawnOptions): Promise<number | undefined> {
  if (!options.label) return undefined;
  const label: PinLabel = typeof options.label === "string" ? { title: options.label } : options.label;
  return world.pin({ at: { hash: id.hash, ...options.position }, title: label.title, text: label.text, style: label.style });
}

// A bare entity with no components or appearances, for a mesh on its own (W1's World test).
const BARE_TEMPLATE = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
// How long a person holds their place, in seconds (H2c-a used an hour; unverified beyond it).
const HOLD_SECONDS = 86400;

// This package's spawns, by id hash: what they were spawned with, so a swap can spawn them
// again (the host sends "world-refresh" with the ones that use a swapped file).
const mine = new Map<string, SpawnedEntry>();
const scenes = new Map<string, string[]>(); // scene name -> id hashes
const respawnHandlers = new Set<(before: EntityId, after: EntityId) => void>();
const unsettled = new Set<string>(); // people spawned with wait: false, settled once they attach
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  // Whether each spawn is in the world, for spawned() and for people spawned with wait: false.
  game.on<GameEvent>("Entity/AfterAttach", (e) => {
    const entry = e.entityId ? mine.get(String(e.entityId)) : undefined;
    if (!entry) return;
    entry.attached = true;
    if (unsettled.delete(entry.id.hash)) settleLater(entry);
  });
  game.on<GameEvent>("Entity/Detach", (e) => {
    const entry = e.entityId ? mine.get(String(e.entityId)) : undefined;
    if (entry) entry.attached = false;
  });
  transport().listen((m) => {
    if (m.event !== "world-refresh" || !Array.isArray(m.entities)) return;
    for (const hash of m.entities as string[]) {
      const entry = mine.get(String(hash));
      if (entry) respawn(entry).catch(() => {});
    }
  });
}

// Where an entity is now, read in the game: moved by world.move, physics or a script.
async function placeOf(id: EntityId): Promise<{ position: WorldPoint; orientation: WorldRotation } | null> {
  const entity = (await world.entity(id).catch(() => null)) as Record<string, () => Promise<unknown>> | null;
  if (!entity) return null;
  const p = (await entity.GetWorldPosition().catch(() => null)) as { X?: number; Y?: number; Z?: number } | null;
  const o = (await entity.GetWorldOrientation().catch(() => null)) as Partial<WorldRotation> | null;
  const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!p || !o || ![p.X, p.Y, p.Z, o.i, o.j, o.k, o.r].every(ok)) return null;
  return { position: { x: p.X!, y: p.Y!, z: p.Z! }, orientation: { i: o.i!, j: o.j!, k: o.k!, r: o.r! } };
}

// Removes the entity and spawns it again with the same options, where it is now (#27):
// it loads its files anew.
async function respawn(entry: SpawnedEntry): Promise<void> {
  const place = await placeOf(entry.id);
  const options: SpawnOptions = place ? { ...entry.options, ...place, yaw: undefined } : entry.options;
  await world.remove(entry.id).catch(() => false);
  const { id } = await world.spawn(options);
  const after = mine.get(id.hash);
  if (after && entry.scene) {
    after.scene = entry.scene;
    const list = scenes.get(entry.scene);
    if (list) list.splice(list.indexOf(entry.id.hash), 1, id.hash);
  }
  for (const h of respawnHandlers) h(entry.id, id);
}

function isPerson(options: SpawnOptions): boolean {
  if (options.npc === false) return false;
  return !!options.npc || (options.record ?? "").startsWith("Character.");
}

// Stand still and stay friendly to V: the calls H2c-a tried (AIHoldPositionCommand through
// the AI controller, AIA_Friendly through the attitude agents).
async function settlePerson(entity: GameRef, options: SpawnOptions): Promise<void> {
  const want = typeof options.npc === "object" ? options.npc : {};
  const e = entity as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  if (want.hold !== false) {
    const ai = (await e.GetAIControllerComponent().catch(() => null)) as Record<string, (...a: unknown[]) => Promise<unknown>> | null;
    if (ai) await ai.SendCommand(await api.$new("AIHoldPositionCommand", { duration: HOLD_SECONDS })).catch(() => {});
  }
  if (want.friendly !== false) {
    const agent = (await e.GetAttitudeAgent().catch(() => null)) as Record<string, (...a: unknown[]) => Promise<unknown>> | null;
    const player = (await api.$call("GetPlayer", game.instance).catch(() => null)) as Record<string, (...a: unknown[]) => Promise<unknown>> | null;
    const vAgent = player ? await player.GetAttitudeAgent().catch(() => null) : null;
    if (agent && vAgent) await agent.SetAttitudeTowards(vAgent, "AIA_Friendly").catch(() => {});
  }
}

// A person spawned with wait: false, once in the world: hold and stay friendly, as spawn does.
function settleLater(entry: SpawnedEntry): void {
  world
    .entity(entry.id)
    .then((entity) => (entity ? settlePerson(entity, entry.options) : undefined))
    .catch(() => {});
}

function planOptions(p: ScenePlan): SpawnOptions {
  return {
    ...(p.template ? { template: p.template } : {}),
    ...(p.record ? { record: p.record } : {}),
    ...(p.mesh ? { mesh: p.mesh, ...(p.appearance ? { meshAppearance: p.appearance } : {}), ...(p.scale ? { scale: p.scale } : {}) } : {}),
    ...(p.appearance && !p.mesh ? { appearance: p.appearance } : {}),
    position: p.position,
    orientation: p.orientation,
    ...(p.npc ? { npc: p.npc } : {}),
  };
}

/**
 * Entities in the world, for builders and anything that places things.
 *
 * @example
 * ```ts
 * import { api, world } from "rednode";
 *
 * const mesh = await api.$new("entMeshComponent", {
 *   name: "crate",
 *   mesh: "base\\environment\\props\\crate_a.mesh",
 *   meshAppearance: "default",
 * });
 * const { id } = await world.spawn({
 *   template: "base\\spawner\\empty_entity.ent",
 *   position: { x: -1234, y: 987, z: 12 },
 *   components: [mesh as GameRef],
 * });
 * await world.move(id, { x: -1234, y: 988, z: 12 }, undefined, 90);
 * await world.remove(id);
 * ```
 */
export const world = {
  /** True when REDnode's world support runs: Codeware is installed and a game is loaded. */
  async available(): Promise<boolean> {
    try {
      return (await api.$static("REDnodeWorld", "Ready")) === true;
    } catch {
      return false;
    }
  },

  /**
   * Spawns an entity and resolves once it is in the world (Codeware's
   * `Entity/AfterAttach`). Components are attached while it assembles, before the
   * game gathers its components, the moment Codeware documents for it.
   *
   * If it is not in the world within `timeoutMs`, it is removed and the call throws, so a
   * failed spawn leaves nothing behind. With `wait: false` it resolves at once, `entity`
   * null, and the entity comes in when the game streams it in (far from V, for example).
   *
   * @example
   * ```ts
   * // A preview far from V: kept, and shown once V gets near.
   * const { id } = await world.spawn({ mesh: "base\\environment\\props\\crate_a.mesh", position: far, wait: false });
   * world.spawned().find((s) => s.id.hash === id.hash)?.attached; // false until it comes in
   * ```
   */
  async spawn(options: SpawnOptions): Promise<Spawned> {
    if ((options.template ? 1 : 0) + (options.record ? 1 : 0) + (options.mesh && !options.template ? 1 : 0) !== 1) {
      throw new Error("world.spawn needs one of template, record and mesh");
    }
    listen();
    const components = [...(options.components ?? [])];
    if (options.mesh) {
      const s = options.scale ?? { x: 1, y: 1, z: 1 };
      components.push(
        (await api.$new("entMeshComponent", {
          name: "rednode_mesh",
          mesh: options.mesh,
          meshAppearance: options.meshAppearance ?? "default",
          visualScale: { X: s.x, Y: s.y, Z: s.z },
        })) as GameRef,
      );
    }
    const template = options.template ?? (options.mesh ? BARE_TEMPLATE : undefined);
    const spec = await api.$new("DynamicEntitySpec", {
      ...(template ? { templatePath: template } : { recordID: options.record }),
      ...(options.appearance ? { appearanceName: options.appearance } : {}),
      position: vector(options.position),
      orientation: rotation(options.orientation, options.yaw),
      spawnInView: true,
      active: true,
      tags: options.tags ?? [],
      ...(options.keep ? { persistState: true, persistSpawn: true } : {}),
      ...(options.alwaysSpawned ? { alwaysSpawned: true } : {}),
    });
    // Listen before spawning: the events can come before the ID does.
    const attached = new Set<string>();
    let wake: (() => void) | null = null;
    const stop = game.on<GameEvent>("Entity/AfterAttach", (e) => {
      if (e.entityId) attached.add(e.entityId);
      wake?.();
    });
    try {
      const id = (await script("Spawn", spec, components)) as EntityId | null;
      if (!id || id.hash === "0") throw new Error(`world.spawn failed: no entity was created (${NEEDS_CODEWARE}, and a loaded game)`);
      if (options.wait === false) {
        // Listed now, so it can be moved and removed; the listener in listen() follows it from here.
        const entry: SpawnedEntry = { id, options, attached: attached.has(id.hash) };
        mine.set(id.hash, entry);
        entry.pin = await pinSpawn(id, options).catch(() => undefined);
        if (isPerson(options)) {
          if (entry.attached) settleLater(entry);
          else unsettled.add(id.hash);
        }
        return { id, entity: null };
      }
      const timeout = options.timeoutMs ?? 10000;
      const until = Date.now() + timeout;
      while (!attached.has(id.hash)) {
        const left = until - Date.now();
        if (left <= 0) {
          // Created but not in: removed, so a failed spawn leaves nothing behind (#35).
          await script("Delete", id).catch(() => false);
          throw new Error(
            `world.spawn: the entity was created but not in the world after ${timeout} ms (it may be out of view or still loading), so it was removed. Pass wait: false to keep it until it comes in`,
          );
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, Math.min(left, 250));
        });
      }
      const entry: SpawnedEntry = { id, options, attached: true };
      mine.set(id.hash, entry);
      entry.pin = await pinSpawn(id, options).catch(() => undefined);
      const entity = await world.entity(id);
      if (entity && isPerson(options)) await settlePerson(entity, options);
      return { id, entity };
    } finally {
      stop();
    }
  },

  /**
   * Drops a pin in the world (#43): a glowing post at `at` with a label above it (the title, an
   * optional line of text, and the distance from the camera), found again from far away. Out of
   * view, the label waits at the screen's edge with an arrow to turn toward. REDnode's overlay
   * draws it, so it changes nothing in the game and needs no permission.
   *
   * `at` is a place, or an entity's id: the pin then follows the entity. `style` sets its look
   * and how its size follows distance ({@link PinStyle}).
   *
   * Answers the pin's id. A package's pins go when it stops, and every pin goes when the game
   * session ends. Pins hide with the game's menus, in photo mode and in the overlay's hidden mode.
   *
   * @example
   * ```ts
   * const here = await game.player.position();
   * const id = await world.pin({ at: here, title: "Scene 3", text: "the drums by the stairs" });
   * await world.pin({ at: { x: here.x, y: here.y + 200, z: here.z }, title: "Far", style: { color: "#ff4fd8", scale: "screen" } });
   * await world.unpin(id);
   * ```
   *
   * @example
   * ```ts
   * // A pin that follows what you spawned (or use world.spawn's label).
   * const { id } = await world.spawn({ record: "Character.Judy", position: here });
   * await world.pin({ at: id, title: "Judy" });
   * ```
   */
  async pin(options: PinOptions): Promise<number> {
    return (await transport().call("pins.add", options)) as number;
  },

  /** Removes one of this package's pins. Answers false when there was none with that id. */
  async unpin(id: number): Promise<boolean> {
    return (await transport().call("pins.remove", { id })) as boolean;
  },

  /**
   * Restyles a pin, or with no id sets the style every pin of this package starts from, its
   * pins now and later (each pin's own style still wins). Answers how many pins changed.
   *
   * @example
   * ```ts
   * await world.pinStyle({ scale: "screen", color: "#ffcf3f" }); // all of this package's pins
   * await world.pinStyle(id, { titleSize: 26 });                 // one
   * ```
   */
  async pinStyle(idOrStyle: number | PinStyle, style?: PinStyle): Promise<number> {
    const params = typeof idOrStyle === "number" ? { id: idOrStyle, style: style ?? {} } : { style: idOrStyle };
    return (await transport().call("pins.style", params)) as number;
  },

  /** This package's pins, with each one's distance from the camera in metres (null until known). */
  async pins(): Promise<PinEntry[]> {
    return (await transport().call("pins.list", {})) as PinEntry[];
  },

  /** Removes every pin of this package. Answers how many there were. */
  async clearPins(): Promise<number> {
    return (await transport().call("pins.clear", {})) as number;
  },

  /** This package's spawns that are still listed: what each was spawned with, and its scene. */
  spawned(): SpawnedEntry[] {
    return [...mine.values()].map((e) => ({ ...e, options: { ...e.options } }));
  },

  /**
   * Calls the handler when REDnode spawned one of this package's entities again, with its
   * old and new id. It does so after an archive swap that changed a file the entity uses,
   * so the entity shows the new version (see `archives.reload`). Returns a function that stops it.
   */
  onRespawn(handler: (before: EntityId, after: EntityId) => void): () => void {
    listen();
    respawnHandlers.add(handler);
    return () => respawnHandlers.delete(handler);
  },

  /**
   * The entities near V, nearest first, read in the game in one call. With `files`, each
   * one's files; with `uses`, only the ones that use one of the given files.
   *
   * @example
   * ```ts
   * const users = await world.near({ radius: 30, uses: ["base\\environment\\decoration\\containers\\cages\\vending_machine_cage\\vending_machine_cage_b.mesh"] });
   * ```
   */
  async near(options: NearOptions = {}): Promise<NearEntity[]> {
    const r = (await invoke("world.near", {
      radius: options.radius ?? 15,
      files: !!options.files,
      ...(options.uses ? { hashes: options.uses } : {}),
    })) as { entities: (Omit<NearEntity, "id"> & { id: string | null })[] };
    return r.entities.map((e) => ({ ...e, id: { hash: String(e.id ?? "0") } }));
  },

  /** The files an entity uses: its template and every resource its components name, as path hashes. Needs Codeware. */
  async files(entity: GameRef | EntityId | string): Promise<EntityFiles> {
    const self = typeof entity === "object" && "$ref" in entity ? entity : null;
    return (await invoke("world.files", self ? { self } : { id: idOf(entity as EntityId | string).hash })) as EntityFiles;
  },

  /**
   * Loads an EDGEbuilder scene into the running game: its meshes, entities and NPCs (lights
   * are not spawned yet). Pass the scene, or a `.scene.json` file's path (absolute, or in
   * your package's folder). People stand where placed and stay friendly to V. Loading a
   * scene of the same name again replaces it. With `wait: false`, objects are spawned without
   * waiting for each to be in the world, as {@link world.spawn} does with it, so a scene far
   * from V loads in full and shows once V gets near. `alwaysSpawned` asks for every object what
   * {@link world.spawn}'s option of that name asks for one. `label: true` pins every object with
   * its id in the scene (a function picks each label, or null for none), as `world.spawn`'s
   * `label` does.
   *
   * @example
   * ```ts
   * const r = await world.load("scenes/my_alley.scene.json");
   * // later
   * await world.unload(r.name);
   * ```
   */
  async load(
    scene: Scene | string,
    options: { name?: string; wait?: boolean; alwaysSpawned?: boolean; label?: boolean | ((object: string) => string | PinLabel | null) } = {},
  ): Promise<LoadResult> {
    const started = Date.now();
    let read: SceneRead;
    try {
      const data = typeof scene === "string" ? await transport().call("world.scene", { file: scene }) : scene;
      read = readScene(data);
    } catch (err) {
      throw cleanError(err);
    }
    const name = options.name ?? read.name;
    if (scenes.has(name)) await world.unload(name);
    const ids: string[] = [];
    scenes.set(name, ids);
    const spawned: LoadResult["spawned"] = [];
    const skipped = [...read.skipped];
    for (const plan of read.plans) {
      try {
        const label = options.label === true ? plan.object : typeof options.label === "function" ? options.label(plan.object) : null;
        const { id } = await world.spawn({
          ...planOptions(plan),
          ...(options.wait === false ? { wait: false } : {}),
          ...(options.alwaysSpawned ? { alwaysSpawned: true } : {}),
          ...(label ? { label } : {}),
        });
        ids.push(id.hash);
        const entry = mine.get(id.hash);
        if (entry) entry.scene = name;
        spawned.push({ object: plan.object, id });
      } catch (err) {
        skipped.push({ object: plan.object, why: (err as Error).message });
      }
    }
    return { name, spawned, skipped, notes: read.notes, ms: Date.now() - started };
  },

  /** Removes what {@link world.load} spawned for that scene. Resolves with how many were removed. */
  async unload(name: string): Promise<number> {
    const ids = scenes.get(name) ?? [];
    scenes.delete(name);
    let n = 0;
    for (const hash of ids) if (await world.remove(hash).catch(() => false)) n += 1;
    return n;
  },

  /**
   * Places an entity. Cheap enough for once a frame, while the player drags it. For this
   * package's own spawns it also keeps the new place, so a respawn after an archive swap
   * puts the entity where it was moved to.
   */
  async move(id: EntityId | string, position: WorldPoint, orientation?: WorldRotation, yaw?: number): Promise<boolean> {
    const turn = rotation(orientation, yaw);
    const moved = (await script("Move", idOf(id), vector(position), turn)) === true;
    const entry = moved ? mine.get(idOf(id).hash) : undefined;
    if (entry) entry.options = { ...entry.options, position: { ...position }, orientation: turn, yaw: undefined };
    return moved;
  },

  /** Removes an entity spawned with {@link world.spawn}. */
  async remove(id: EntityId | string): Promise<boolean> {
    const pin = mine.get(idOf(id).hash)?.pin;
    if (pin !== undefined) await world.unpin(pin).catch(() => false);
    mine.delete(idOf(id).hash);
    unsettled.delete(idOf(id).hash);
    return (await script("Delete", idOf(id))) === true;
  },

  /** Entity events for an entity spawned elsewhere (by its ID), as {@link world.on} delivers them. */
  async watch(id: EntityId | string): Promise<boolean> {
    return (await script("Watch", idOf(id))) === true;
  },

  /** The entity with this ID, or null if it is not in the world. */
  async entity(id: EntityId | string): Promise<GameRef | null> {
    return (await api.$static("GameInstance", "FindEntityByID", game.instance, idOf(id))) as GameRef | null;
  },

  /**
   * Calls the handler for an entity event of REDnode's entities and watched ones.
   * The event has `entityId` and `entityType`. Returns a function that stops it.
   */
  on(name: EntityEventName, handler: (event: GameEvent) => void): () => void {
    return game.on<GameEvent>(name === "Entity/Attached" ? "Entity/AfterAttach" : name, handler);
  },
};
