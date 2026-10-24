{% raw %}
# Mod services

Status: **agreed with the owner on 2026-10-24**, with the recommendations at the end of this page and two companion apps the owner added, the **Task Manager** and the **Tools Manager**. Scheduled after H2c-b and before I3: SV1, SV2, SV3, each with an in-game test. Asked for by the owner the same day: every mod needs a way to reach another and call it, and AI assistants should reach mods the same way. The owner's idea, adopted below: a mod describes its functions in JSDoc comments, and those comments become both the descriptions other mods see and the MCP tools an assistant calls.

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
| **The player's say** | Each package's details in the Mod Manager list its functions and tools. The **Tools Manager** (below) switches tools off for every assistant, a whole package or one tool at a time. Mod-to-mod calls need no switch, as an npm dependency needs none; a provider limits its callers with `service.caller()` |
| **The agent broker** | Stays as it is. Later it can become a service of REDagent's (`redagent.ask`), so one router carries everything |

## Answers to the owner's idea

| Question | View |
|---|---|
| Is JSDoc the right source? | Yes. It is where a JavaScript author already writes this, it needs no extra syntax, editors show it, and REDnode's own package already lives by TSDoc. The two catches are covered above: bundlers drop comments (`service.json` at build time), and JSDoc types are loose (a fixed subset turns into JSON Schema; anything else is accepted as any value with a warning) |
| Through the agent broker? | Through the same host, but the direction differs. The agent broker carries a package's question **to** the assistant. Mod tools carry the assistant's call **to** a package, and assistants already reach the host through the kernel MCP server, so the tools belong there. Both share the host's router, so REDagent and Claude Code get the same tools with no new connection |
| Opt in or every export? | Every export is callable by other mods; only `@tool` exports reach assistants. A mod author chooses what an assistant may touch, function by function |
| Safety | An assistant asks the player before any change (the ask flag, as for `api_call`), the player can switch off any tool or package in the Tools Manager, and every call is written to the Mod log with its caller. Whether REDagent (Agent SDK) honours the ask flag is still unverified, and SV3 tests it |

## Companion apps

Asked for by the owner on 2026-10-24, to go with services. Both are built-in tool windows like the Mod Manager (the tool layer, opened from the launcher), so they stay reachable when a package misbehaves.

### Task Manager

What each running package costs, and a way to end it.

| Shows | From |
|---|---|
| Each running Node mod: its process (own or shared), status (running, restarting, crashed, not responding), uptime | The host's mod runtime |
| CPU and memory per process | Electron's `app.getAppMetrics()`, which the host already reads for the `Mod processes` log line every 10 s |
| For mods sharing a process: each mod's JavaScript heap and how busy its event loop is | Asked of each mod worker (`v8.getHeapStatistics()`, `performance.eventLoopUtilization()`), since the operating system sees only the shared process. **Unverified:** the cost of asking every second |
| Game calls a second and their time on the game thread, per package | The host's bridge, which already counts game calls a frame for the `Perf` line; per package is new |
| Service calls a second, in and out, per package (from SV1) | The host's router |
| Each package's overlay windows: their renderer process's CPU and memory | `app.getAppMetrics()` by window |

| Action | Does |
|---|---|
| **End task** | Stops the package's mod, as switching it off does, and closes its windows. A mod in the shared process is stopped alone; one that does not stop within 2 s has its process ended, and the other mods in that process restart, as the host does for a crash today. The package stays switched on, so its next start brings it back |
| **Restart** | Ends and starts it again |
| Sort, and a 1 s or 5 s refresh | |

Built in **SV1**, where service calls become one of its columns. The rest of it needs nothing from services, so it can be built first within SV1.

### Tools Manager

Every MCP tool an assistant can see, and the player's switch for each.

| Shows | |
|---|---|
| Tools grouped by where they come from: REDnode's own (`api_read`, `api_call`, `archives_reload`, `game_facts`, ...) and each package's `@tool` functions | The kernel MCP server's live list |
| Each tool's name, description and parameters, as an assistant sees them | The descriptors |
| Whether it runs without asking (`@readonly`, or REDnode's read tools) or asks first | |
| Its recent calls: when, by which assistant, and the result or error | The MCP server's call log |
| Which assistants are connected now (Claude Code, REDagent, others by their client name) | The MCP sessions |

| Action | Does |
|---|---|
| A switch per tool, and one per group | A switched-off tool leaves every assistant's tool list at once (`tools/list_changed`) and refuses a call already under way to it. Kept in the host's settings across starts, by package id and tool name |
| **Off for new packages** | Off by default: a package's tools show when it is installed, as agreed. On, a new package's tools start switched off until the player turns them on |

REDnode's own tools can be switched off too. Switching off `api_read` or `api_call` takes the game API away from every assistant, REDagent included; the Tools Manager says so beside them.

Built in **SV3**, with the tools it manages. It replaces the per-package **Assistants can use** switch first planned for the Mod Manager.

## Phases

| Phase | Builds | Its test shows |
|---|---|---|
| **SV1 Calls** | The host's router; the service file; `service.connect`, `caller`, `emit`, `on`; package ids in `requires`; calls and errors in the Mod log; two samples (a Counter service and a Counter panel that calls it); the **Task Manager** | One mod calls another and hears its events; a stopped provider gives a clear error; hot reload of the provider keeps the caller working. The Task Manager shows each mod's CPU, memory and calls, and **End task** stops a busy mod (the Crash mod's endless loop) without stopping the others |
| **SV2 Descriptions** | The JSDoc reader and JSON Schema; `npx rednode describe` and `service.json`; argument checks; `service.describe(id)`; the functions listed in the Mod Manager; the samples documented this way; the docs simulation | A bad call is refused before the provider sees it; a bundled mod is described from its `service.json` |
| **SV3 Assistants** | `@tool` exports as MCP tools, `tools/list_changed`, `mod_services` and `mod_call`, ask first unless `@readonly`; the **Tools Manager** | Claude Code and REDagent list the sample's tools, read without asking, ask before a change; a tool switched off in the Tools Manager leaves both lists and refuses its calls, and stays off after a restart |

Each phase raises REDnode's version and ends with an in-game test, as every phase does.

## Agreed with the owner (2026-10-24)

| Question | Decision |
|---|---|
| Order | After H2c-b, before I3: H2c-b's `world.load` is REDnode's own, so it does not wait for services, and EDGEbuilder's and EDGEquest's next steps both gain from services soon after |
| A package's tools shown to assistants by default? | Yes, with every change asked first. The player switches tools off in the Tools Manager |
| Start a provider on demand when it is switched off? | Not in SV1. A clear error first; decide after real use |
| Companion apps | The Task Manager in SV1, the Tools Manager in SV3 |

## SV1: built

Built on 2026-10-24 in **REDnode 0.34.0**, while the owner was away (agreed: the three phases built back to back, each tested in game in order afterwards).

| Piece | Where |
|---|---|
| The router: connect, call, cancel, emit, waiting for a starting provider, timeouts, counters | `packages/overlay/services.js` |
| The service file in the mod worker: loaded after `main`, each call run with its caller and an `AbortSignal` in an `AsyncLocalStorage` | `packages/overlay/runtime/worker.js` |
| Messages between workers and the router; `end` (End task), `stats`, `toWorker`, `state` | `packages/overlay/mods.js`, `runtime/runner.js` (each thread's event loop load, heap and CPU time, read from outside it so a stuck mod still answers) |
| `"service"` in the manifest; a package with only a service runs as a Node mod; REDnode package ids in `requires` (kind `package`); pages' calls (`rednode:service`); game calls counted per package; the Task Manager's calls | `packages/overlay/main.js`, `preload.js` |
| `service.connect`, `caller`, `signal`, `emit`; the handle's `$info`, `$call`, `$with`, `$on` | `packages/rednode/src/service.ts` |
| The Task Manager | `packages/overlay/tasks` (built in, `taskmanager`) |
| Samples | `apps/counter-service` (a service and nothing else), `apps/counter-panel` |
| Docs | [Overlay apps: Calling other packages](overlay-apps.md#calling-other-packages) and [The Task Manager](overlay-apps.md#the-task-manager); the examples' previews run the provider's service file beside the caller |

What changed from the plan while building:

| Plan | Built | Why |
|---|---|---|
| `on(name)` on the handle, `service.abortable` | `$on`, `$with({ timeoutMs, signal })`, `$call` | A provider may export a function called `on`; the handle's own names start with `$`, so every other name is a call |
| Calls and errors in the Mod log | Connections and failed calls in the caller's Mod log; each call counted, not logged | A panel calling 60 times a second would flood the log. SV3 logs each assistant's call |
| Game calls' time on the game thread, per package | Game calls a second and their round trip from the host, per package | The game-thread time is measured by the plugin for all packages together; per package needs a plugin change, left for later |
| — | A package with a service and no `main` | The plan allowed it; the Counter service sample is one |

Checked before the game, in the mock game with two scratch packages:

| Check | Result |
|---|---|
| 17 service cases (connect, calls, events with the caller's name, `$call`, a timeout, an abort, the provider's error, an unknown function, a bad argument, a package with no service, one not installed, connecting to oneself, `caller()` outside a call, `requires` naming a package) | All passed |
| A call while the provider hot-reloads | It waited for the provider and answered |
| End task on a mod stuck in an endless loop in the shared process | Stopped in under a second; the two other mods in that process kept running; Restart brought it back; a built-in app is refused |
| The Task Manager's table | Shows each package's CPU, memory, thread load (the stuck mod at 100 %), heap and calls |

## SV1 test

Before: REDnode 0.34.0 deployed. Load a save.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. F10, Mod Manager: switch on **Counter service** and **Counter panel**. Counter panel's log says "Connected to Counter service 0.1.0: add, fail, get, reset, wait", and Counter service has no window. **Mark**.
2. Press **+1** three times and **+10** once: the count reads 13 and the log shows a `changed` event after each. **Mark**.
3. Press **Wait 3 s**: the answer comes after about 3 s. Press **Wait 40 s**: after 30 s it fails with "did not answer wait within 30 s". **Mark**.
4. Press **Wait, then Stop**, then **Stop** within 20 s: the call fails with "Stopped", and the Mod log has Counter service's line "wait(20000) stopped: the caller gave up". **Mark**.
5. Press **Fail** and **Unknown function**: each fails with its reason. **Mark**.
6. In the Mod Manager, switch **Counter service** off, then press **Read** in Counter panel: it fails with "Counter service is off: switch it on in the Mod Manager". Switch it on again and press **Reconnect**, then **Read**: 0 (a new start). **Mark**.
7. Open the **Task Manager** from the launcher. Counter panel and Counter service are listed with CPU, memory, Thread, Heap and Up. Press **+1** a few times quickly: the Service column shows calls in and out. **Mark**.
8. Switch on **Crash mod** in the Mod Manager, and press its **Hang forever**. In the Task Manager its Thread reads about 100 %. Select it and press **End task**: it stops within 2 s and its window closes, and the game and other mods go on. **Mark**.
9. Select Crash mod again and press **Restart**: it runs again with its window. **Mark**.
10. Quit the game. Send `rednode-mods.log` and `rednode-overlay.log`.

### SV1 test: results

2026-10-24, REDnode 0.36.0 (all three phases on one build), the 2.31 backup folder: **pass**, every step.

| Step | Seen in the logs |
|---|---|
| 1 | Counter panel, switched on first, said "Counter service is off"; with the service on, "Connected to Counter service 0.2.0: add, fail, get, reset, wait" |
| 2 | add(1) three times and add(10): 13, each answered in about 1 ms |
| 3 | wait(3000) answered after 3003 ms; wait(40000) failed at 30 s, and the service logged "wait(40000) stopped: the caller gave up" |
| 4 | Stop: "Stopped", and the service's signal aborted at once |
| 5 | fail() and nothing() failed with their reasons |
| 6 | Off: "Counter service is off: switch it on in the Mod Manager"; on again, get() answered 0 |
| 7 | The Task Manager showed the calls (eight add(1) in two seconds) |
| 8 | End task on Crash mod stuck in its endless loop (in the shared process with the Hello mod): stopped in the same second, its window closed, the Hello mod ran on |
| 9 | Restart brought Crash mod back with its window |

## SV2: built

Built on 2026-10-24 in **REDnode 0.35.0**, right after SV1.

| Piece | Where |
|---|---|
| The JSDoc reader: exported functions (`export function`, `export const f = (...) =>`, `export { a }`), their JSDoc, their parameter lists with TypeScript types and defaults, the type subset to JSON Schema, argument checks, MCP's input schema for SV3 | `packages/rednode/src/describe.ts` (no Node imports, so the host, the command and later a browser can use it) |
| `rednode describe <source> [--out <file>]`, writing `service.json` beside the nearest `rednode-app.json` | `packages/rednode/bin/rednode.mjs` (the package's `bin`) |
| The host: reads `service.json` or the service file when a service loads, logs what it could not read, checks each call before the provider sees it, uses `@timeout`, answers `describe` | `packages/overlay/services.js`, `main.js` (`describeService`, `serviceSummary`; mods start once the reader has loaded) |
| `service.describe(id)` and the description types | `packages/rednode/src/service.ts` |
| The Mod Manager's **Service** section: each function with its parameters, TOOL or TOOL · READS, its description, the events | `packages/overlay/manager` |
| Samples | Counter service 0.2.0 (an `@event`), Counter panel 0.2.0 (**Describe**, **Bad call**) |

Checked before the game, in plain Node and in the mock game:

| Check | Result |
|---|---|
| The reader on Counter service and on harder sources (object, enum and array parameters, a `@timeout`, `@event`, `Promise<>` results, a file comment that is not a function's, TypeScript-only types, an arrow function, `export { a as b }`, `@deprecated`) | 29 cases passed |
| The mock game: SV1's 17 cases again, plus a call refused by the host from the JSDoc, too many arguments, `describe` (parameters, tool, readonly, event), a bundled package whose comment-free file is described by `service.json` made from its TypeScript source, and a bad call to it | 26 cases passed |
| The Mod Manager's details for Counter service | Its Service section lists the five functions, their marks and descriptions, and the event |

## SV2 test

Before: REDnode 0.35.0 or later deployed (SV1's test can run first on the same build). Load a save.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Mod Manager: switch on **Counter service** and **Counter panel**. Select **Counter service**: its details have a **Service** section listing `add([by])` TOOL, `fail()`, `get()` TOOL · READS, `reset()` TOOL and `wait(ms)`, each with its description, and "Events: changed". **Mark**.
2. In Counter panel press **Describe**: the log lists the five functions with their parameters and types, their marks, and the `changed` event. **Mark**.
3. Press **Bad call**: it fails with `add: "by" must be a number, not a string`, and Counter service's log has no line for it (the host refused it before the service saw it). **Mark**.
4. Quit the game. Send `rednode-mods.log`.

### SV2 test: results

2026-10-24, REDnode 0.36.0: **pass**. The Mod Manager's Service section listed the functions; **Describe** logged "Described 5 functions"; **Bad call** failed with `add: "by" must be a number, not a string`, and the service logged nothing for it.

## SV3: built

Built on 2026-10-24 in **REDnode 0.36.0**, right after SV2.

| Piece | Where |
|---|---|
| Each `@tool` function as the MCP tool `<package>__<function>`: the author's description, the parameters as the tool's input (the JSON Schema turned into zod for the MCP SDK), `readOnlyHint` for `@readonly`, the ask flag for the rest; named arguments put in order for the call | `packages/overlay/mcp.js` (`zodOf`, `toolInput`, `modToolName`) |
| `mod_services`, `mod_read` (read-only tools, no asking), `mod_call` (asks) | `mcp.js` |
| Which assistant calls: the desktop token named by its `initialize` request (Claude Code sends "claude-code", seen in game), a package's token by the package's name; `service.caller()` gives `{ assistant }` | `mcp.js` (`handle` reads the body), `main.js` (`seenToken`) |
| The switches: `settings.mcpTools` (`off`, `offPackages`, `newOff`, `known`); a switched-off REDnode tool is not built; a switched-off mod tool is left out and refused by `mod_call` | `main.js` (`allModTools`, `callModTool`, `toolsList`, `rednode:tools:*`) |
| The Tools Manager | `packages/overlay/toolsmanager` (built in, `toolsmanager`) |
| Each assistant call in the mod's own log and the Tools Manager's recent calls | `main.js` |

What changed from the plan while building:

| Plan | Built | Why |
|---|---|---|
| Tools added and removed with `tools/list_changed` | The tool list is built fresh for every request; no notice is sent | The kernel MCP server is stateless (no session, no stream to send a notice on). `mod_services` and `mod_call` reach tools started after a client read its list |
| `mod_services` and `mod_call` | Also `mod_read` | As `api_read` beside `api_call`: a read-only tool started late can be read without asking |
| REDagent lists the tools | REDagent 0.3.1 allows mod tools: read-only ones without asking, the rest after asking the player | REDagent refused every kernel tool it did not know |

Checked before the game, in the mock game, as an MCP client over HTTP and through the Tools Manager's page:

| Check | Result |
|---|---|
| 23 cases: the tool list (mod tools, not the functions without `@tool`, readonly and ask marks, input schema, JSDoc description), calls by name, a bad input refused, `mod_read` and its refusal, `mod_call`, `mod_services`, the Tools Manager's groups, assistant and recent calls, a tool switched off (gone, refused), a package off, one tool on inside an off package, a REDnode tool off, the switches saved | All passed |

## SV3 test

Before: REDnode 0.36.0 deployed, with REDagent 0.3.1. In the launcher's settings, **MCP server** on; in Claude Code, the `rednode` server set up (the launcher's **Copy setup**). Load a save.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Mod Manager: switch on **Counter service**. Open the **Tools Manager** from the launcher: REDnode's tools, then **Counter service** with `counter_service__add`, `counter_service__get` (READS) and `counter_service__reset`. Select `counter_service__add`: its description and the parameter `by?: number`. **Mark**.
2. Start a **new** Claude Code session and ask: "What is the count in Counter service?" It uses `counter_service__get` without asking. **Mark**.
3. Ask it to add 5 to the count. It uses `counter_service__add`, and Claude Code asks you first; allow it. The Tools Manager's recent calls and Counter service's lines in the Mod log show both calls, by Claude Code. **Mark**.
4. In the Tools Manager, switch `counter_service__add` off. Ask Claude Code to add 1 again: the call fails or the tool is gone, and `mod_call` is refused with "switched ... off". Switch it on again. **Mark**.
5. In REDagent's chat, ask "What is the count in Counter service?": it reads it without asking. Ask it to reset the count: REDagent asks you first; allow it. **Mark**.
6. Quit the game. Send `rednode-mods.log` and `rednode-overlay.log`.

### SV3 test: first run

2026-10-24, REDnode 0.36.0. Claude Code names itself **claude-code** in its `initialize` request, so the logs and the Tools Manager show it by that name.

| Step | Result |
|---|---|
| 1 Tools Manager | Pass |
| 2 Read without asking | Pass: "claude-code called get as a tool" |
| 3 Add 5, asked first | Open: no call of `add` reached REDnode |
| 4 Switch off and on | Pass: the switch was logged off and on; no call of `add` went through while off |
| 5 REDagent | Not run: the REDagent on that install has no Agent SDK yet ("the window offers to get it") |

### SV3 test: second run (steps 3 and 5)

2026-10-24, the same build: **pass**, so SV3 passed. Claude Code asked before `add` and the call went through ("claude-code called add as a tool"). REDagent 0.3.1 fetched its Agent SDK in 2.8 s, read the count with `get` without asking, asked before `reset` (the call came 7 s into the turn, after the player allowed it), and read 0 after it. Each call is in Counter service's log by the assistant's name.
{% endraw %}
