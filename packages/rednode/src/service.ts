/**
 * Mod services: packages calling each other's functions through the REDnode host.
 *
 * A package offers a service by naming a **service file** in its rednode-app.json
 * (`"service": "service.mjs"`). Every function that file exports can be called by other
 * packages, by the package's id. The file runs in the package's own Node mod, beside its
 * `main`, so it shares the mod's state. Calls carry plain JSON-like values (numbers,
 * strings, booleans, arrays, plain objects, entity ids), not game references.
 *
 * Callers can be Node mods or overlay pages; only a Node mod offers a service. See the
 * [Mod services](https://edgemodders.github.io/REDnode/services.html) page.
 *
 * @example
 * ```js
 * // counter/service.mjs, named in its rednode-app.json as "service": "service.mjs"
 * import { service } from "rednode";
 * let count = 0;
 * export function get() { return count; }
 * export function add(n = 1) {
 *   count += n;
 *   service.emit("changed", { count });
 *   return count;
 * }
 *
 * // Another package
 * import { service } from "rednode";
 * const counter = await service.connect("counter");
 * await counter.add(5);
 * counter.$on("changed", (e) => console.log(e.count));
 * ```
 *
 * @module
 */

import { cleanError, transport } from "./transport.js";
import type { EventDescriptor, FunctionDescriptor } from "./describe.js";

export type { EventDescriptor, FunctionDescriptor, ParamDescriptor, Schema } from "./describe.js";

/** A service described, as {@link service.describe} answers: each function's JSDoc as the host read it. */
export interface ServiceDescription {
  id: string;
  name: string;
  version: string;
  /** Every exported function, by name: its description, parameters (with JSON Schema), return value and marks. */
  functions: Record<string, FunctionDescriptor>;
  /** The events its JSDoc names with `@event`. */
  events: Record<string, EventDescriptor>;
}

/** What a provider offers, as {@link service.connect} or {@link use} found it. */
export interface ServiceInfo {
  /** The package's id. */
  id: string;
  /** The role it was found by, with {@link use}; absent for {@link service.connect}. */
  role?: string;
  /** The package's name, for people. */
  name: string;
  /** The package's version, from its rednode-app.json. */
  version: string;
  /** The functions its service file exports. */
  functions: string[];
}

/** Who is calling a service function: a package, or (from SV3) an assistant through MCP. */
export interface ServiceCaller {
  /** The calling package's id. */
  id?: string;
  /** The calling package's name; `"editor:<tool>"` when a tool calls through the editor channel. */
  name?: string;
  /** The assistant's MCP client name, when an assistant calls. */
  assistant?: string;
  /**
   * The tool's name, such as `"EDGEdir"`, when a tool on the player's PC calls through the
   * editor channel's `service.call` (the player allowed that tool to call this package).
   */
  editor?: string;
}

/** Options for calls made through {@link ServiceHandle.$with}. */
export interface ServiceCallOptions {
  /** How long to wait for the answer. Default 30 seconds. */
  timeoutMs?: number;
  /** Stops waiting, and aborts the provider's {@link service.signal}, when it fires. */
  signal?: AbortSignal;
}

/**
 * A connected service. Each function the provider exports is a method that returns a
 * promise of its result. Names starting with `$` are this handle's own.
 */
export type ServiceHandle<T = Record<string, (...args: any[]) => any>> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
} & {
  /** What the provider offers. */
  readonly $info: ServiceInfo;
  /** Calls a function by name: for names that clash with the handle's own, or names known only at run time. */
  $call(fn: string, ...args: unknown[]): Promise<any>;
  /** The same service, with a timeout or an AbortSignal for its calls. */
  $with(options: ServiceCallOptions): ServiceHandle<T>;
  /** Calls the handler with each event of this name the provider sends. Returns a function that stops it. */
  $on(name: string, handler: (data: any) => void): () => void;
};

interface ServiceTransport {
  service?(msg: Record<string, unknown>): Promise<unknown>;
}

function send(msg: Record<string, unknown>): Promise<unknown> {
  const fromMod = transport() as ServiceTransport;
  const fromPage = (globalThis as Record<string, unknown>).rednode as ServiceTransport | undefined;
  const t = fromMod.service ? fromMod : fromPage;
  if (!t?.service) throw new Error("rednode: services need REDnode 0.34.0 or later");
  return t.service(msg).catch((err) => {
    throw cleanError(err);
  });
}

interface Context {
  caller: ServiceCaller;
  signal: AbortSignal;
}

// The worker that runs a service file keeps each call's caller and signal here.
function context(): Context | null {
  const store = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("rednode.serviceContext")] as
    | { getStore(): Context | undefined }
    | undefined;
  return store?.getStore() ?? null;
}

let nextCid = 1;
type EventHandler = (data: any) => void;
const handlers = new Map<string, Set<EventHandler>>(); // `${provider} ${name}` -> handlers
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "service") return;
    for (const h of handlers.get(`${m.provider} ${m.name}`) ?? []) {
      try {
        h(m.data);
      } catch (err) {
        console.error(err);
      }
    }
  });
}

function handle<T>(info: ServiceInfo, options: ServiceCallOptions): ServiceHandle<T> {
  const call = async (fn: string, args: unknown[]): Promise<unknown> => {
    const cid = nextCid++;
    const { signal } = options;
    if (signal?.aborted) throw new Error("Stopped");
    const onAbort = () => {
      send({ op: "cancel", cid }).catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await send({ op: "call", provider: info.id, fn, args, cid, timeoutMs: options.timeoutMs });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };
  const own: Record<string, unknown> = {
    $info: info,
    $call: (fn: string, ...args: unknown[]) => call(fn, args),
    $with: (more: ServiceCallOptions) => handle<T>(info, { ...options, ...more }),
    $on: (name: string, handler: EventHandler) => {
      listen();
      const key = `${info.id} ${name}`;
      const set = handlers.get(key) ?? new Set();
      set.add(handler);
      handlers.set(key, set);
      return () => set.delete(handler);
    },
  };
  return new Proxy(own, {
    get(target, k) {
      if (typeof k !== "string" || k === "then") return undefined;
      if (k in target) return target[k];
      if (k.startsWith("$")) return undefined;
      return (...args: unknown[]) => call(k, args);
    },
  }) as ServiceHandle<T>;
}

/**
 * Connects to the package that provides a **role**, such as `"voice"`, rather than to a
 * package by its id (REDnode 0.44.0 or later). A provider says so in its rednode-app.json
 * with `"provides": ["voice"]` and answers with its service file, as for
 * {@link service.connect}; the handle is the same.
 *
 * Which package answers: the only one installed; or, with several, the one the player
 * chose in the Mod Manager (its Provides section), else the only one switched on. With
 * several and no choice, `use` rejects with their names, so the player decides which
 * service (and whose bill) a mod uses. A handle keeps its provider: after the player
 * chooses another, call `use` again to reach it.
 *
 * Rejects when no installed package provides the role, or as {@link service.connect} does.
 * Pass the interface you expect for typed calls; the provider's docs say what it offers.
 *
 * @example
 * ```js
 * import { use } from "rednode";
 *
 * const voice = await use("voice"); // EDGEwave's edgewave-voice, or another provider
 * const line = await voice.speak("Choom, you look like hell.", "judy");
 * voice.$on("ended", (e) => { if (e.id === line.id) console.log("done"); });
 * console.log(`${voice.$info.name} speaks`);
 * ```
 */
export async function use<T = Record<string, (...args: any[]) => any>>(role: string): Promise<ServiceHandle<T>> {
  const info = (await send({ op: "use", role })) as ServiceInfo;
  return handle<T>(info, {});
}

/** A package that provides a role, as {@link service.providers} lists it. */
export interface ProviderInfo {
  id: string;
  name: string;
  version: string | null;
  /** The folder REDnode loaded it from (a development folder's copy wins over the apps folder's). */
  dir: string;
  /** Switched on in the Mod Manager. */
  enabled: boolean;
  /** Its service is ready now. */
  running: boolean;
  /** Its rednode-app.json as read, so a role can define a block of its own in it. */
  manifest: Record<string, unknown>;
}

/**
 * Other packages' services, and the tools to offer one.
 */
export const service = {
  /**
   * Connects to a package's service, by the package's id. Resolves once the provider runs
   * (it waits up to 10 seconds for one that is starting); rejects with the reason when the
   * package is not installed, offers no service, or is switched off. Add the package to
   * your rednode-app.json's `requires`, such as `{ "edgebuilder": ">=0.4" }`, so the Mod
   * Manager shows it as missing before your package runs.
   *
   * @example
   * ```js
   * const builder = await service.connect("edgebuilder");
   * console.log(builder.$info.functions);
   * const places = await builder.$with({ timeoutMs: 60000 }).load("my_alley");
   * ```
   */
  async connect<T = Record<string, (...args: any[]) => any>>(id: string): Promise<ServiceHandle<T>> {
    const info = (await send({ op: "connect", provider: id })) as ServiceInfo;
    return handle<T>(info, {});
  },

  /**
   * What a package's service offers, described from its JSDoc (REDnode 0.35.0 or later):
   * each function's description, its parameters with their types as JSON Schema, what it
   * returns, and whether it is a `@tool` or `@readonly`. Waits for a provider that is starting.
   *
   * @example
   * ```js
   * const d = await service.describe("counter-service");
   * for (const f of Object.values(d.functions)) console.log(f.name, f.description);
   * ```
   */
  async describe(id: string): Promise<ServiceDescription> {
    return (await send({ op: "describe", provider: id })) as ServiceDescription;
  },

  /**
   * Every installed package that provides a role, switched on or not, sorted by name, without
   * the caller itself (#58; REDnode 0.71.0 or later). Unlike {@link use}, nothing is chosen and
   * nothing is called: it is for a package that shows something for each provider, such as a
   * button per tool. `enabled` says whether the player switched it on, `running` whether its
   * service answers now, and `manifest` is its rednode-app.json, so a role can define its own
   * block there.
   *
   * @example
   * ```js
   * import { service } from "rednode";
   *
   * for (const p of await service.providers("edgebuilder-tool")) {
   *   console.log(p.name, p.enabled ? "on" : "off", p.manifest.edgebuilderTool);
   * }
   * ```
   */
  async providers(role: string): Promise<ProviderInfo[]> {
    return (await send({ op: "providers", role })) as ProviderInfo[];
  },

  /**
   * Calls the handler with the whole list from {@link service.providers} whenever it changes:
   * a provider installed or removed, switched on or off, its service starting or stopping, or
   * its manifest changed by a hot reload. It is called once at the start with the list as it
   * is, and then within a second of each change. Returns a function that stops it.
   *
   * @example
   * ```js
   * const stop = service.onProviders("edgebuilder-tool", (list) => drawTools(list));
   * ```
   */
  onProviders(role: string, handler: (list: ProviderInfo[]) => void): () => void {
    listen();
    const key = `$providers ${role}`;
    const set = handlers.get(key) ?? new Set();
    const wrapped: EventHandler = (data) => handler(data as ProviderInfo[]);
    set.add(wrapped);
    handlers.set(key, set);
    send({ op: "providers", role, watch: true })
      .then((list) => {
        if (set.has(wrapped)) wrapped(list);
      })
      .catch((err) => console.error(err));
    return () => {
      set.delete(wrapped);
    };
  },

  /**
   * Inside a service function: who is calling. Null outside a service call, and in pages.
   *
   * @example
   * ```js
   * export function reset() {
   *   if (service.caller()?.id !== "my-panel") throw new Error("Only My panel may reset");
   *   count = 0;
   * }
   * ```
   */
  caller(): ServiceCaller | null {
    return context()?.caller ?? null;
  },

  /**
   * Inside a service function: a signal that aborts when the caller gives up (its own
   * AbortSignal, or its timeout). Pass it on to long work, such as `fetch`.
   */
  signal(): AbortSignal | null {
    return context()?.signal ?? null;
  },

  /**
   * Sends an event to every package that connected to this package's service. Node mods
   * with a service file only. Data must be plain JSON-like values.
   *
   * @example
   * ```js
   * service.emit("scene-changed", { name: "my_alley", objects: 12 });
   * ```
   */
  emit(name: string, data?: unknown): void {
    send({ op: "emit", name, data }).catch((err) => console.error(`service.emit("${name}"): ${(err as Error).message}`));
  },
};
