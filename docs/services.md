# Mod services

Status: **proposed on 2026-10-24**, not yet agreed. Asked for by the owner the same day: every mod needs a way to reach another and call it, and AI assistants should reach mods the same way. The owner's idea, adopted below: a mod describes its functions in JSDoc comments, and those comments become both the descriptions other mods see and the MCP tools an assistant calls.

## The problem

Each Node mod runs in its own worker, often its own process. Mods share no JavaScript objects, and nothing in the `rednode` package lets one call another:

| What exists | Reaches | Limit |
|---|---|---|
| `channel` | A package's pages and its own Node mod | One package only |
| `agent.ask`, `agent.serve` | Any package asks; the one package that `"provides": ["agent"]` answers, through the host | Built for REDagent alone, text in and out |
| Quest facts (`quests.set`, `quests.watch`) | Any package | Integers only, and they go into the save |
| Game objects | Any package, by entity id | Only once the ids have been passed somehow |
| The kernel MCP server | Assistants (Claude Code, REDagent through `kernel.mcp()`) | REDnode's own tools only; nothing a mod does |

So EDGEquest cannot ask EDGEbuilder for a scene's places, a HUD widget cannot ask a stats mod for its numbers, and an assistant cannot press a mod's buttons except through raw `api_call` into the game.

## The idea

A package can have a **service file**: a plain module whose exported functions are what it offers. The JSDoc on each export says what it does, its parameters and what it returns. The host reads the comments once, and from them:

- other packages call the functions by name, through the host;
- the Mod Manager lists them on the package's details;
- the kernel MCP server lists the ones marked `@tool` as tools, so every assistant can call them.

One source of truth, written once, in the form JavaScript authors already use, and the same comments feed editors' hints and generated docs.

```js
// edgebuilder/service.mjs, named in rednode-app.json as "service": "service.mjs"

/**
 * The scenes saved in EDGEbuilder.
 * @tool
 * @readonly
 * @returns {{ name: string, objects: number }[]} Each scene's name and how many objects it holds.
 */
export async function scenes() { /* ... */ }

/**
 * Loads a saved scene into the world, near V unless it has its own place.
 * @tool
 * @param {string} name The scene's name, as `scenes` lists it.
 * @param {boolean} [preview=true] Spawn previews only, removed when EDGEbuilder stops.
 * @returns {{ placed: number, missing: string[] }} What was placed, and any asset not found.
 */
export async function load(name, preview = true) { /* ... */ }
```

```js
// Another package. Its rednode-app.json says "requires": { "edgebuilder": ">=0.4" }
import { service } from 'rednode';

const builder = await service.connect('edgebuilder');
const list = await builder.scenes();
const r = await builder.load('my_alley');
builder.on('scene-changed', (e) => console.log(e.name));
```

An assistant sees two tools, `edgebuilder__scenes` and `edgebuilder__load`, with the descriptions and parameter schemas from the comments.

## Design

| Part | Plan |
|---|---|
| **Service file** | `"service": "service.mjs"` in rednode-app.json. It runs in the package's own mod worker, beside `main`, so it shares the mod's state (import from the main module, or the other way round). Exports that are functions are the service; the rest are ignored. A package with only a service and no window is fine |
| **Who is called** | A package by its id. One provider per id, so no registry of service names to clash. `provides` keeps its meaning for roles the host knows (`agent`) |
| **Calls** | Positional arguments, as the function takes them. An assistant's named arguments (MCP sends an object) are put in order by the descriptor. Plain JSON-like values, entity ids and record ids cross; a game reference does not (each package's references are its own; the host may translate them later) |
| **Results and errors** | The return value, or the thrown error's message, back to the caller. A call times out after 30 s unless the descriptor says `@timeout`. A caller can pass an `AbortSignal` as the last argument (`service.abortable`) |
| **Who is calling** | `service.caller()` inside a function: `{ id, name }` of the calling package, or `{ assistant: "<client>" }`. A provider can refuse callers it does not want |
| **Events** | `service.emit(name, data)` in the provider; `on(name, handler)` on what `connect` returns. Described with `@event` in the service file |
| **Not running** | A call to an installed package that is switched off fails with "EDGEbuilder is off: switch it on in the Mod Manager". Starting providers on demand is a later choice |
| **Requirements** | `requires` takes REDnode package ids with a version range, checked against installed packages as it checks game mods today; the Mod Manager shows a missing one before the package runs |
| **Descriptions** | The host parses the service file's JSDoc when the package loads: `@param {type} name description` (with `[name=default]` for optional ones), `@returns`, `@tool`, `@readonly`, `@event`, `@timeout`, `@deprecated`. Types become JSON Schema: `string`, `number`, `boolean`, `object` shapes like `{{ x: number, y: number }}`, arrays `T[]`, literal unions `'a' \| 'b'` as enums. A type it cannot read becomes "any value" with a warning in the Mod log |
| **Bundled and TypeScript mods** | A bundler drops comments, so `npx rednode describe` (in the `rednode` package) writes `service.json` next to the manifest from the source at build time, reading TypeScript's own types when the source is TypeScript. The host uses `service.json` when it is there and parses the service file otherwise |
| **Validation** | The host checks every call's arguments against the schema before it reaches the provider, so a mod never sees a malformed call from an assistant |
| **MCP tools** | Only exports marked `@tool`. Named `<package>__<function>` (dashes become underscores, 64 characters at most). Added and removed as packages start and stop, with the protocol's `tools/list_changed`. Two fixed tools as well, `mod_services` (every package's descriptors) and `mod_call`, for clients that do not refresh their tool list or when there are too many tools |
| **Asking first** | A tool marked `@readonly` runs without asking. Every other tool carries `anthropic/requiresUserInteraction`, as `api_call` does, so Claude Code asks before each call. A provider cannot remove the ask; the `@readonly` mark is the author's promise, shown to the player in the Mod Manager |
| **The player's say** | Each package's details in the Mod Manager list its functions and tools. A switch, **Assistants can use**, hides a package's tools from every assistant. Mod-to-mod calls need no switch, as an npm dependency needs none; a provider limits its callers with `service.caller()` |
| **The agent broker** | Stays as it is. Later it can become a service of REDagent's (`redagent.ask`), so one router carries everything |

## Answers to the owner's idea

| Question | View |
|---|---|
| Is JSDoc the right source? | Yes. It is where a JavaScript author already writes this, it needs no extra syntax, editors show it, and REDnode's own package already lives by TSDoc. The two catches are covered above: bundlers drop comments (`service.json` at build time), and JSDoc types are loose (a fixed subset turns into JSON Schema; anything else is accepted as any value with a warning) |
| Through the agent broker? | Through the same host, but the direction differs. The agent broker carries a package's question **to** the assistant. Mod tools carry the assistant's call **to** a package, and assistants already reach the host through the kernel MCP server, so the tools belong there. Both share the host's router, so REDagent and Claude Code get the same tools with no new connection |
| Opt in or every export? | Every export is callable by other mods; only `@tool` exports reach assistants. A mod author chooses what an assistant may touch, function by function |
| Safety | An assistant asks the player before any change (the ask flag, as for `api_call`), the player can hide a package from assistants, and every call is written to the Mod log with its caller. Whether REDagent (Agent SDK) honours the ask flag is still unverified, and SV3 tests it |

## Phases

| Phase | Builds | Its test shows |
|---|---|---|
| **SV1 Calls** | The host's router; the service file; `service.connect`, `caller`, `emit`, `on`; package ids in `requires`; calls and errors in the Mod log; two samples (a Counter service and a Counter panel that calls it) | One mod calls another and hears its events; a stopped provider gives a clear error; hot reload of the provider keeps the caller working |
| **SV2 Descriptions** | The JSDoc reader and JSON Schema; `npx rednode describe` and `service.json`; argument checks; `service.describe(id)`; the functions listed in the Mod Manager; the samples documented this way; the docs simulation | A bad call is refused before the provider sees it; a bundled mod is described from its `service.json` |
| **SV3 Assistants** | `@tool` exports as MCP tools, `tools/list_changed`, `mod_services` and `mod_call`, ask first unless `@readonly`, **Assistants can use** in the Mod Manager | Claude Code and REDagent list the sample's tools, read without asking, ask before a change, and lose the tools when the package stops or the switch is off |

Each phase raises REDnode's version and ends with an in-game test, as every phase does.

## To agree with the owner

| Question | Recommendation |
|---|---|
| Order | After H2c-b, before I3: H2c-b's `world.load` is REDnode's own, so it does not wait for services, and EDGEbuilder's and EDGEquest's next steps both gain from services soon after |
| A package's tools shown to assistants by default? | Yes, with every change asked first. The player can switch a package off |
| Start a provider on demand when it is switched off? | Not in SV1. A clear error first; decide after real use |
