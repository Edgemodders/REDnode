/**
 * EDGEbuilder's scene files, read into what {@link world.load} spawns. Pure: no game
 * calls, so the host uses it too (the MCP server's `world_load`).
 *
 * The format is EDGEbuilder's ([scene format](https://edgemodders.github.io/EDGEbuilder/scene.html)):
 * format 1, plus format 2's draft `npc` kind, and format 3's draft `worldEdits` (#51), which are
 * read but not applied: each kind of edit left out is said in {@link SceneRead.notes}.
 *
 * @module
 */

/** One object of a scene file, as EDGEbuilder writes it. */
export interface SceneObject {
  id: string;
  kind: "mesh" | "entity" | "light" | "npc" | string;
  /** A mesh or an entity template's depot path. */
  resource?: string;
  /** An `npc`'s TweakDB record, such as `"Character.CitizenRichFemale"`. */
  record?: string;
  appearance?: string;
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
  props?: Record<string, unknown>;
}

/** A scene file. */
export interface Scene {
  format: number;
  name: string;
  objects: SceneObject[];
  [key: string]: unknown;
}

/** What one scene object becomes: the fields of a {@link world.spawn} call. */
export interface ScenePlan {
  /** The object's id in the scene. */
  object: string;
  kind: "mesh" | "entity" | "npc";
  template?: string;
  record?: string;
  mesh?: string;
  appearance?: string;
  position: { x: number; y: number; z: number };
  orientation: { i: number; j: number; k: number; r: number };
  scale?: { x: number; y: number; z: number };
  npc?: { hold: boolean; friendly: boolean };
}

/** The objects a scene spawns, and the ones it skips with the reason. */
export interface SceneRead {
  name: string;
  plans: ScenePlan[];
  skipped: { object: string; why: string }[];
  /** Objects spawned with less than the file asks for, such as an NPC behaviour other than idle. */
  notes: string[];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const gamePath = (p: string) => p.replace(/\//g, "\\");

/** The scene kinds {@link SceneFilter}'s `kinds` takes. Lights are not spawned yet. */
export const SCENE_KINDS = ["mesh", "entity", "npc", "light"] as const;

/** Which of a scene's objects to load (#48, #49). Both may be given; left out, every object loads. */
export interface SceneFilter {
  /** Only objects of these kinds, such as `["npc"]` for a baked scene's people. The others are skipped as `not in kinds`. */
  kinds?: readonly string[];
  /** Objects to leave out, by their id in the scene. They are skipped as `skipped by id`. */
  skip?: readonly string[];
}

/**
 * Reads a scene (parsed JSON) into spawn plans. Throws when it is not a scene, or when
 * `kinds` names a kind REDnode does not know.
 *
 * @example
 * ```ts
 * const { plans, skipped } = readScene(JSON.parse(text));
 * const people = readScene(JSON.parse(text), { kinds: ["npc"] });
 * ```
 */
export function readScene(scene: unknown, filter: SceneFilter = {}): SceneRead {
  const s = scene as Scene;
  if (!s || typeof s !== "object" || !Array.isArray(s.objects)) throw new Error("not a scene: it has no objects list");
  if (typeof s.format === "number" && s.format > 3) throw new Error(`scene format ${s.format} is newer than REDnode reads (1 to 3)`);
  const kinds = filter.kinds == null ? null : new Set(listOf(filter.kinds, "kinds"));
  for (const k of kinds ?? []) {
    if (!(SCENE_KINDS as readonly string[]).includes(k)) throw new Error(`kinds: "${k}" is not a scene kind. It takes ${SCENE_KINDS.join(", ")}`);
  }
  const skip = new Set(filter.skip == null ? [] : listOf(filter.skip, "skip"));
  const plans: ScenePlan[] = [];
  const skipped: { object: string; why: string }[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const o of s.objects) {
    const object = String(o?.id ?? `#${plans.length + skipped.length}`);
    seen.add(object);
    if (skip.has(object)) {
      skipped.push({ object, why: "skipped by id" });
      continue;
    }
    if (kinds && !kinds.has(String(o?.kind))) {
      skipped.push({ object, why: "not in kinds" });
      continue;
    }
    const t = o?.transform ?? {};
    const p = t.position ?? [];
    const r = t.rotation ?? [];
    const sc = t.scale ?? [];
    if (p.length < 3) {
      skipped.push({ object, why: "no position" });
      continue;
    }
    const base = {
      object,
      position: { x: num(p[0], 0), y: num(p[1], 0), z: num(p[2], 0) },
      orientation: { i: num(r[0], 0), j: num(r[1], 0), k: num(r[2], 0), r: num(r[3], 1) },
      ...(o.appearance ? { appearance: String(o.appearance) } : {}),
    };
    if (o.kind === "mesh") {
      if (!o.resource) {
        skipped.push({ object, why: "a mesh with no resource" });
        continue;
      }
      plans.push({ ...base, kind: "mesh", mesh: gamePath(o.resource), scale: { x: num(sc[0], 1), y: num(sc[1], 1), z: num(sc[2], 1) } });
    } else if (o.kind === "entity") {
      if (!o.resource) {
        skipped.push({ object, why: "an entity with no resource" });
        continue;
      }
      plans.push({ ...base, kind: "entity", template: gamePath(o.resource) });
    } else if (o.kind === "npc") {
      if (!o.record === !o.resource) {
        skipped.push({ object, why: "an npc needs one of record and resource" });
        continue;
      }
      const behaviour = String(o.props?.behaviour ?? "idle");
      if (behaviour !== "idle") notes.push(`${object}: behaviour "${behaviour}" is not supported yet, so it stands idle`);
      plans.push({
        ...base,
        kind: "npc",
        ...(o.record ? { record: String(o.record) } : { template: gamePath(String(o.resource)) }),
        npc: { hold: true, friendly: true },
      });
    } else if (o.kind === "light") {
      skipped.push({ object, why: "lights are not spawned yet" });
    } else {
      skipped.push({ object, why: `unknown kind "${o.kind}"` });
    }
  }
  const missing = [...skip].filter((id) => !seen.has(id));
  if (missing.length) notes.push(`skip names ${missing.map((id) => `"${id}"`).join(", ")}, which the scene has no object for`);
  const edits = worldEditsNote(s.worldEdits);
  if (edits) notes.push(edits);
  return { name: String(s.name ?? "scene"), plans, skipped, notes };
}

const EDIT_WORDS: Record<string, [string, string]> = {
  remove: ["removal of the game's own objects", "removals of the game's own objects"],
  door: ["door state", "door states"],
};

/** Format 3's world edits are not applied yet (#51 step 2): say how many, of which kinds. */
function worldEditsNote(edits: unknown): string | null {
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of edits) {
    const action = typeof (e as { action?: unknown })?.action === "string" ? String((e as { action: string }).action) : "unknown";
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  const parts = [...counts].map(([action, n]) => {
    const words = EDIT_WORDS[action];
    const what = words ? words[n === 1 ? 0 : 1] : `"${action}" edit${n === 1 ? "" : "s"}`;
    return counts.size === 1 ? what : `${n} ${what}`;
  });
  const n = edits.length;
  return `${n} world edit${n === 1 ? "" : "s"} not applied (${parts.join(", ")})`;
}

function listOf(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${what}: give a list of texts`);
  return v as string[];
}
