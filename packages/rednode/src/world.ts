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
  /** How long to wait for the entity to be in the world. Default 10 seconds. */
  timeoutMs?: number;
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
export interface SpawnedEntry {
  id: EntityId;
  options: SpawnOptions;
  /** The scene it belongs to, when {@link world.load} spawned it. */
  scene?: string;
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

// A bare entity with no components or appearances, for a mesh on its own (W1's World test).
const BARE_TEMPLATE = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
// How long a person holds their place, in seconds (H2c-a used an hour; unverified beyond it).
const HOLD_SECONDS = 86400;

// This package's spawns, by id hash: what they were spawned with, so a swap can spawn them
// again (the host sends "world-refresh" with the ones that use a swapped file).
const mine = new Map<string, SpawnedEntry>();
const scenes = new Map<string, string[]>(); // scene name -> id hashes
const respawnHandlers = new Set<(before: EntityId, after: EntityId) => void>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "world-refresh" || !Array.isArray(m.entities)) return;
    for (const hash of m.entities as string[]) {
      const entry = mine.get(String(hash));
      if (entry) respawn(entry).catch(() => {});
    }
  });
}

// Removes the entity and spawns it again with the same options: it loads its files anew.
async function respawn(entry: SpawnedEntry): Promise<void> {
  await world.remove(entry.id).catch(() => false);
  const { id } = await world.spawn(entry.options);
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
      const timeout = options.timeoutMs ?? 10000;
      const until = Date.now() + timeout;
      while (!attached.has(id.hash)) {
        const left = until - Date.now();
        if (left <= 0) throw new Error(`world.spawn: the entity was created but not in the world after ${timeout} ms (it may be out of view or still loading)`);
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, Math.min(left, 250));
        });
      }
      mine.set(id.hash, { id, options });
      const entity = await world.entity(id);
      if (entity && isPerson(options)) await settlePerson(entity, options);
      return { id, entity };
    } finally {
      stop();
    }
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
   * scene of the same name again replaces it.
   *
   * @example
   * ```ts
   * const r = await world.load("scenes/my_alley.scene.json");
   * // later
   * await world.unload(r.name);
   * ```
   */
  async load(scene: Scene | string, options: { name?: string } = {}): Promise<LoadResult> {
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
        const { id } = await world.spawn(planOptions(plan));
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

  /** Places an entity. Cheap enough for once a frame, while the player drags it. */
  async move(id: EntityId | string, position: WorldPoint, orientation?: WorldRotation, yaw?: number): Promise<boolean> {
    return (await script("Move", idOf(id), vector(position), rotation(orientation, yaw))) === true;
  },

  /** Removes an entity spawned with {@link world.spawn}. */
  async remove(id: EntityId | string): Promise<boolean> {
    mine.delete(idOf(id).hash);
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
