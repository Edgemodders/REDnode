// world.writeWorkspot (#46, for EDGEdir): a workspot of a package's own for one actor's clips,
// written through REDbridge from one of the game's workspots on the player's PC, packed into the
// package's own archive and swapped into the running game with REDswap. The recipe is what the
// Director spike found in game on 2026-11-16 (docs/world.md, "A written workspot (#46)"):
//
//   - each clip is a sequence whose idle is the clip, looping until a jump (loopInfinitely);
//   - only the clips and a fast exit (the game's own entries, reactions and exits take over);
//   - the animation setup's hash made new from its sets: the engine finds a workspot's animation
//     setup by that hash, so one kept from the template plays only the template's sets;
//   - jumps are instant (SendJumpCommandEnt by entry id): they go at once, blended by the game.
//
// Nothing from the game is in this file or the package: the template is read on the player's PC.

import { archives, type ReloadResult } from "./archives.js";
import { kernel, pkg } from "./pkg.js";

/** The game workspot a written one starts from: its compiled graph and settings are kept, its entries replaced. */
const TEMPLATE = "base\\workspots\\common\\ground\\generic__stand_ground_arms_crossed__stand_around__02.workspot";
const MALE_RIG = "base\\characters\\base_entities\\man_base\\man_base.rig";

/** One clip of a written workspot. */
export interface WorkspotClip {
  /** The animation set (`.anims`) the clip is in, a depot path. */
  set: string;
  /** The animation's name in that set. */
  anim: string;
  /** The name to jump to it by, with {@link world.jumpWorkspot}. Default: `anim`. Names are unique in a workspot. */
  name?: string;
  /** Loop the clip until a jump (the default). `false` plays it once, then the next clip in the list follows. */
  loop?: boolean;
}

/** What {@link world.writeWorkspot} takes. */
export interface WriteWorkspotOptions {
  /** The clips, in order. The first is what the person plays when the workspot starts. */
  clips: WorkspotClip[];
  /**
   * The rig the clips are for, a depot path. Default: the male rig, `man_base.rig`. A clip only
   * plays on a person whose body has that rig: a woman's clips need `woman_base.rig` and a woman.
   */
  rig?: string;
  /** Swap the package's workspots into the running game once written (the default). `false` only writes and packs. */
  swap?: boolean;
}

/** One entry of a written workspot: a clip and the id to jump to it by. */
export interface WorkspotEntry {
  name: string;
  anim: string;
  set: string;
  /** The entry id, for {@link world.jumpWorkspot} or the game's `SendJumpCommandEnt`. */
  entry: number;
}

/** What {@link world.writeWorkspot} answers. */
export interface WrittenWorkspot {
  /** The workspot's depot path, for `world.spawn({ workspot })` and `world.useWorkspot`. */
  path: string;
  /** Its entries, in the order of the clips. */
  entries: WorkspotEntry[];
  /** The package's archive of written workspots, on disk. */
  archive: string;
  /** How long writing, packing and swapping took, in milliseconds. */
  ms: number;
  /** The swap's answer, when it swapped. */
  swap?: ReloadResult;
}

// Every workspot this package wrote in this run, by depot path: its entries by name.
const written = new Map<string, Map<string, WorkspotEntry>>();
let template: any = null;

/** The entries of a workspot this package wrote, by name; undefined for any other workspot. */
export function writtenEntries(path: string): Map<string, WorkspotEntry> | undefined {
  return written.get(path.toLowerCase());
}

// FNV-1a 64 of a text, as a decimal string (WolvenKit JSON's Uint64).
function fnv64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(text)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString();
}

const cname = (v: string) => ({ $type: "CName", $storage: "string", $value: v });
const resPath = (p: string) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: p }, Flags: "Default" });

function folders(): { work: string; tree: string; packed: string; id: string } {
  const id = pkg.id.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const work = `${pkg.dataDir}\\workspots`;
  return { work, tree: `${work}\\archive`, packed: `${work}\\packed`, id };
}

export async function writeWorkspot(name: string, options: WriteWorkspotOptions): Promise<WrittenWorkspot> {
  const started = Date.now();
  if (!/^[a-z0-9_]{1,64}$/.test(name)) throw new Error("world.writeWorkspot: the name is 1 to 64 of a to z, 0 to 9 and _");
  const clips = options?.clips ?? [];
  if (clips.length === 0) throw new Error("world.writeWorkspot needs at least one clip");
  const names = new Set<string>();
  for (const c of clips) {
    if (!c?.set || !c?.anim) throw new Error("world.writeWorkspot: each clip needs set (an .anims path) and anim (its name)");
    const n = c.name ?? c.anim;
    if (names.has(n)) throw new Error(`world.writeWorkspot: two clips are named "${n}"; give each a name`);
    names.add(n);
  }
  const bridge = await kernel.bridge();
  if (!template) {
    await bridge.call("archive.extract", { path: TEMPLATE, outFile: `${folders().work}\\template.workspot` });
    const json = await bridge.call<{ json: string }>("cr2w.fileToJson", { file: `${folders().work}\\template.workspot` });
    template = JSON.parse(json.json);
  }
  const doc = structuredClone(template);
  const tree = doc.Data.RootChunk.workspotTree.Data;
  let next = Number(tree.idCounter);
  let handle = 200000;
  const entries: WorkspotEntry[] = [];
  const sequences = clips.map((c) => {
    const seq = ++next;
    const clip = ++next;
    entries.push({ name: c.name ?? c.anim, anim: c.anim, set: c.set, entry: seq });
    return {
      HandleId: String(++handle),
      Data: {
        $type: "workSequence", category: "Any", disableAutoTransition: 0, flags: 0,
        id: { $type: "workWorkEntryId", id: seq },
        idleAnim: cname(c.anim), loopInfinitely: c.loop === false ? 0 : 1, previousLoopInfinitely: 0,
        list: [{ HandleId: String(++handle), Data: { $type: "workAnimClip", animName: cname(c.anim), blendOutTime: 0.5, flags: 2, id: { $type: "workWorkEntryId", id: clip } } }],
      },
    };
  });
  const root = tree.rootEntry.Data;
  root.list = [...sequences, ...root.list.filter((e: any) => e.Data.$type === "workFastExit")];
  tree.idCounter = next + 1;
  const rig = options.rig ?? MALE_RIG;
  const sets = [...new Set(clips.map((c) => c.set))];
  const setup = structuredClone(tree.finalAnimsets[0]);
  setup.rig = { DepotPath: { $type: "ResourcePath", $storage: "string", $value: rig }, Flags: "Soft" };
  setup.animations.cinematics = sets.map((s) => ({ $type: "animAnimSetupEntry", animSet: resPath(s), priority: 200, variableNames: [] }));
  setup.animations.gameplay = [];
  // A hash of its own: the engine finds an animation setup by it (round 4 of the Director spike).
  setup.animations.hash = fnv64(`${rig}|${sets.join("|")}`);
  setup.loadingHandles = sets.map(resPath);
  tree.finalAnimsets = [setup];
  tree.customTransitionAnims = [];

  const f = folders();
  const path = `rednode\\workspots\\${f.id}\\${name}.workspot`;
  await bridge.call("cr2w.fromJson", { outFile: `${f.tree}\\${path}`, json: JSON.stringify(doc) });
  const packed = await bridge.call<{ archive: string }>("project.pack", { dir: f.tree, outDir: f.packed, modName: `zzz_rednode_ws_${f.id}` });
  written.set(path.toLowerCase(), new Map(entries.map((e) => [e.name, e])));
  const result: WrittenWorkspot = { path, entries, archive: packed.archive, ms: 0 };
  if (options.swap !== false) {
    result.swap = await archives.reload([packed.archive]);
    if (result.swap.failed?.length) throw new Error(`world.writeWorkspot: written, but the swap failed: ${result.swap.failed.map((x) => x.why).join("; ")}`);
  }
  result.ms = Date.now() - started;
  return result;
}
