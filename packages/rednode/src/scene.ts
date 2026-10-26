/**
 * EDGEbuilder's scene files, read into what {@link world.load} spawns. Pure: no game
 * calls, so the host uses it too (the MCP server's `world_load`).
 *
 * The format is EDGEbuilder's ([scene format](https://edgemodders.github.io/EDGEbuilder/scene.html)):
 * format 1, plus format 2's draft `npc` kind.
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

/**
 * Reads a scene (parsed JSON) into spawn plans. Throws when it is not a scene.
 *
 * @example
 * ```ts
 * const { plans, skipped } = readScene(JSON.parse(text));
 * ```
 */
export function readScene(scene: unknown): SceneRead {
  const s = scene as Scene;
  if (!s || typeof s !== "object" || !Array.isArray(s.objects)) throw new Error("not a scene: it has no objects list");
  if (typeof s.format === "number" && s.format > 2) throw new Error(`scene format ${s.format} is newer than REDnode reads (1 and 2)`);
  const plans: ScenePlan[] = [];
  const skipped: { object: string; why: string }[] = [];
  const notes: string[] = [];
  for (const o of s.objects) {
    const object = String(o?.id ?? `#${plans.length + skipped.length}`);
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
  return { name: String(s.name ?? "scene"), plans, skipped, notes };
}
