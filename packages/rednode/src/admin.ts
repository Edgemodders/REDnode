/**
 * Managing REDnode itself, for admin packages such as the Admin Tools pack's Task
 * Manager and Tools Manager: what every running package costs, ending or restarting
 * one, and the switches that decide which tools AI assistants see.
 *
 * The package must ask for the `admin` permission in its rednode-app.json, and the
 * player must allow it in the Mod Manager, which warns them first; until then every
 * call rejects and says so. Overlay pages only: a Node mod gets an error.
 *
 * @module
 */

import { cleanError } from "./transport.js";

/** A running package's costs, one row of {@link admin.tasks}. */
export interface TaskRow {
  /** The package's id. */
  readonly id: string;
  /** Its name, from its rednode-app.json. */
  readonly name: string;
  readonly version: string;
  /** Part of REDnode (the Mod Manager, the Mod log): it cannot be ended. */
  readonly builtin: boolean;
  /**
   * Its Node mod, or `null` for a page app: `status` (`running`, `crashed`,
   * `not-responding`...), `ended`, its process (`process`: `own`, `shared` or `debug`;
   * `pid`, `cpuPercent`, `memoryMB`, `processMods`), its own thread (`load`, 0 to 1 of
   * one core; `heapMB`, `heapLimitMB`, `cpuMs`) and `uptimeMs`.
   */
  readonly mod: Record<string, any> | null;
  /** Its overlay windows, each with its renderer process's `cpuPercent` and `memoryMB`. */
  readonly windows: readonly { key: string; title: string; cpuPercent: number | null; memoryMB: number | null }[];
  /** Its service, if it has one: the functions it offers now, or `null` while it starts. */
  readonly service: { functions: readonly unknown[] | null } | null;
  /** Game calls a second over the last 5 seconds, and their average round trip. */
  readonly gameCallsPerSec: number;
  readonly gameCallMs: number | null;
  /** Service calls a second, to it and from it, over the last 5 seconds. */
  readonly serviceInPerSec: number;
  readonly serviceOutPerSec: number;
  readonly serviceErrors: number;
  readonly serviceMs: number | null;
}

/** What {@link admin.tasks} answers. */
export interface TaskList {
  /** When it was read, in ms since 1970. */
  readonly at: number;
  readonly rows: readonly TaskRow[];
  /** The host and every process it started: CPU, memory, process count, the host's own memory. */
  readonly total: { cpuPercent: number; memoryMB: number; processes: number; hostMB: number };
}

/** One tool in {@link ToolGroup.tools}. */
export interface ToolInfo {
  /** The switch's key: `rednode:<tool>` for REDnode's own, `<package>:<function>` for a mod's. */
  readonly key: string;
  /** The tool's name as an assistant sees it, such as `api_read` or `counter_service__add`. */
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  /** Runs without asking the player. */
  readonly readonly: boolean;
  /** Asks the player before every call. */
  readonly asks: boolean;
  /** Switched off: assistants do not see it. */
  readonly off: boolean;
  /** A mod's tool: its parameters. */
  readonly params?: readonly { name: string; type: string; optional: boolean; description?: string }[];
}

/** Tools by where they come from: REDnode's own (`id` `rednode`), then each package's. */
export interface ToolGroup {
  readonly id: string;
  readonly name: string;
  readonly builtin: boolean;
  /** The whole package switched off. */
  readonly off: boolean;
  readonly tools: readonly ToolInfo[];
}

/** What {@link admin.tools} answers. */
export interface ToolList {
  /** The MCP server's state: `enabled`, its `port`, and `external` (the desktop switch: outside access, such as Claude Code). */
  readonly mcp: Record<string, unknown>;
  /** A newly installed package's tools start switched off. */
  readonly newOff: boolean;
  readonly groups: readonly ToolGroup[];
  /** Assistants that have connected, the most recent first. */
  readonly assistants: readonly { name: string; kind: "desktop" | "package"; lastSeenMs: number }[];
  /** The newest 50 assistant calls of mods' tools, the newest first. */
  readonly recent: readonly { at: number; assistant: string; tool: string; pkg: string; fn: string; ok: boolean; ms: number; detail: string }[];
}

interface AdminBridge {
  tasks: { list(): Promise<TaskList>; end(id: string): Promise<unknown>; restart(id: string): Promise<unknown> };
  tools: { list(): Promise<ToolList>; set(what: string, id: string | null, on: boolean): Promise<ToolList> };
}

function bridge(): AdminBridge {
  const page = (globalThis as { rednode?: Partial<AdminBridge> }).rednode;
  if (!page?.tasks || !page?.tools) {
    throw new Error("rednode: admin works in overlay pages only, with the REDnode host");
  }
  return page as AdminBridge;
}

async function run<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    throw cleanError(err);
  }
}

/**
 * REDnode's admin calls. Needs the `admin` permission, allowed by the player.
 *
 * @example
 * ```ts
 * // rednode-app.json: "permissions": ["admin"]
 * import { admin } from "rednode";
 *
 * const { rows } = await admin.tasks();
 * const stuck = rows.find((r) => r.mod?.status === "not-responding");
 * if (stuck) await admin.endTask(stuck.id);
 * ```
 */
export const admin = {
  /** Every running package with what it costs now. Rates are over the last 5 seconds. */
  tasks(): Promise<TaskList> {
    return run(() => bridge().tasks.list());
  },

  /**
   * Stops a package now, even one stuck in an endless loop: its mod stops (its process
   * ends if it does not stop within 2 s) and its windows close. It stays switched on,
   * so the next start of the game brings it back; {@link admin.restartTask} brings it
   * back now. REDnode's own apps are refused.
   */
  endTask(id: string): Promise<void> {
    return run(async () => {
      await bridge().tasks.end(id);
    });
  },

  /** Starts a package's mod again, and opens its window if the player had it open. */
  restartTask(id: string): Promise<void> {
    return run(async () => {
      await bridge().tasks.restart(id);
    });
  },

  /** Every tool an assistant can see through REDnode's MCP server, with the player's switches. */
  tools(): Promise<ToolList> {
    return run(() => bridge().tools.list());
  },

  /**
   * Switches a tool on or off for every assistant, kept across starts. Answers the new list.
   *
   * @param what - `"tool"` (id is a {@link ToolInfo.key}), `"group"` (a package id, or
   *   `"rednode"` for REDnode's own tools), or `"new-off"` (id `null`: new packages'
   *   tools start off).
   *
   * @example
   * ```ts
   * await admin.setTool("tool", "counter-service:reset", false);
   * ```
   */
  setTool(what: "tool" | "group" | "new-off", id: string | null, on: boolean): Promise<ToolList> {
    return run(() => bridge().tools.set(what, id, on));
  },
};
