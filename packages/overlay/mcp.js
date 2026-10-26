// The kernel MCP server: REDnode's tools for AI agents, served by the overlay
// host on localhost. Claude Code on the desktop uses it while the game runs, and
// REDagent, the in-game assistant, will use the same tools.
//
//   http://127.0.0.1:41820/mcp   Streamable HTTP, stateless; every request needs
//                                Authorization: Bearer <token> (see the launcher)
//
// Tools: logs, apps, game_state, perf, gameapi_lookup, window_text, window_image,
// window_console, game_image, api_read, api_call, api_get, tweakdb, archives_reload,
// the quest tools, and (SV3, docs/services.md) every package's @tool functions as
// <package>__<function>, with mod_services, mod_read and mod_call. The player switches any
// of them off in the Tools Manager. See docs/mcp.md.

'use strict';

const http = require('node:http');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const INSTRUCTIONS = `These tools reach REDnode, a Node.js modding runtime for Cyberpunk 2077, while the game runs.
REDnode runs overlay apps (web pages drawn on top of the game) and Node mods (Node code in the REDnode host, outside the game), both installed as packages in the apps folder and both using the "rednode" package: game (events, state, the player), ui (windows built from Node), and api (any game function, typed from the game's own data).
- logs: what Node mods printed, and their crashes.
- apps: the installed apps and mods, their state and memory; open, close, restart.
- game_state, perf: what the game shows, and what the overlay costs.
- gameapi_lookup: game types and functions with the exact signatures api uses. Look before calling.
- window_text, window_image: what an overlay window shows. window_console: what its page logged.
- game_image: the game's screen as the player sees it, with or without the overlay.
- tweakdb: TweakDB flats and records, read from the running game.
- archives_reload: swaps changed archives into the running game through RED Hot Tools, for seeing an asset change without a restart. Afterwards what V wears, REDnode's spawns and the game's entities within 30 m of V that use a swapped file show the new version. Archives that change the game's sound paks are swapped with the game paused and its sound index loaded again; a sound that just played may keep its old version until the game loads it again (for a weapon, equip it again).
- world_near, world_spawned: the entities near V (with the files they use), and what REDnode spawned. world_spawn, world_remove and world_load (EDGEbuilder scene files) place things in the world, and ask first.
- api_read, api_call, api_get: live calls into the game. Game objects come back as {"$ref": n, "$type": "..."}; pass {"$ref": n} back as self. Most functions take the game instance first: pass {}. 64-bit numbers are strings. References die when a save loads.
For a quest: game_facts and game_journal read facts and journal entries; game_facts_set, game_journal_set and game_teleport change the player's save or move V, and ask first.
Use api_read for reads: it runs functions named like reads (Get, Is, Has, Can, Find) and a TweakDB record's methods, and refuses the rest. api_call runs any function and can change the player's game, such as their money or health; archives_reload replaces files in the game's mod folder. Both ask the player before every call.
Installed mods offer tools of their own, named <package>__<function>, described by the mod's author: those marked read-only run without asking, the rest ask the player first. mod_services lists every mod's tools, including ones started after this list was read; mod_read and mod_call call them by package and function.
Guide: https://edgemodders.github.io/REDnode/overlay-apps.html`;

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const READ = { readOnlyHint: true, openWorldHint: false };
// Claude Code asks the player before every call of a tool with this, in every permission mode.
const ASK_FIRST = { 'anthropic/requiresUserInteraction': true };

// api_read's rule. The game's own const flag cannot tell reads from changes (in 2.31, 1,865
// const functions are not getters, such as SetAIRole, and two thirds of the getters are not
// const), so the name decides: a read starts with one of READ_START, unless a change word is
// joined to it with Or, And or Then (GetOrCreate..., GetOrAdd...). A change word elsewhere is
// most often a noun (GetItemInEquipSlot, GetStartTime, IsQuickHackPanelOpen): refusing those
// sent 543 of 2.31's 9,504 read names to api_call; this refuses 7, all of them changes.
// TweakDB records' methods only read flats.
const READ_START = /^(Get|Is|Has|Can|Find)(?=[A-Z0-9_]|$)/;
const CHANGE_WORDS =
  /(Or|And|Then)(Create|Spawn|Set|Add|Remove|Apply|Request|Give|Take|Kill|Destroy|Delete|Clear|Reset|Start|Stop|Trigger|Send|Queue|Register|Unregister|Activate|Deactivate|Enable|Disable|Toggle|Load|Unload|Equip|Unequip|Consume|Drop|Teleport|Push|Pop|Change|Modify|Update|Increment|Decrement|Init|Initialize|Release|Acquire|Lock|Unlock|Play|Fire|Notify|Commit|Save|Spend|Award|Grant|Force|Kick|Open|Close|Show|Hide)(?=[A-Z0-9_]|$)/;
const RECORD_TYPE = /^gamedata\w*_Record$/;

/** Whether api_read may run fn; selfType is the $type of self when known. */
function isRead(fn, selfType) {
  const name = String(fn).split(';')[0];
  if (selfType && RECORD_TYPE.test(selfType)) return true;
  const m = READ_START.exec(name);
  return !!m && !CHANGE_WORDS.test(name.slice(m[0].length));
}

// A JSON Schema from a service description (describe.js's subset) as zod, which the MCP SDK
// takes for a tool's input.
function zodOf(s = {}) {
  let out;
  if (s.anyOf?.length) out = s.anyOf.length === 1 ? zodOf(s.anyOf[0]) : z.union(s.anyOf.map(zodOf));
  else if (s.enum?.length) {
    out = s.enum.every((v) => typeof v === 'string')
      ? z.enum(s.enum)
      : s.enum.length === 1
        ? z.literal(s.enum[0])
        : z.union(s.enum.map((v) => z.literal(v)));
  } else {
    switch (s.type) {
      case 'string':
        out = z.string();
        break;
      case 'number':
        out = z.number();
        break;
      case 'integer':
        out = z.number().int();
        break;
      case 'boolean':
        out = z.boolean();
        break;
      case 'null':
        out = z.null();
        break;
      case 'array':
        out = z.array(s.items ? zodOf(s.items) : z.unknown());
        break;
      case 'object':
        if (s.properties) {
          const shape = {};
          for (const [k, v] of Object.entries(s.properties)) shape[k] = s.required?.includes(k) ? zodOf(v) : zodOf(v).optional();
          out = z.object(shape).passthrough();
        } else out = z.record(z.string(), z.unknown());
        break;
      default:
        out = z.unknown();
    }
  }
  return s.description ? out.describe(s.description) : out;
}

/** The input shape of a service function as an MCP tool: its parameters by name. */
function toolInput(fn) {
  const shape = {};
  for (const p of fn.params ?? []) {
    const described = { ...p.schema, description: [p.description, p.default !== undefined ? `Default: ${p.default}.` : ''].filter(Boolean).join(' ') || undefined };
    shape[p.name] = p.optional ? zodOf(described).optional() : zodOf(described);
  }
  return shape;
}

/** A package function's MCP tool name: <package>__<function>, letters, digits and _ only, 64 at most. */
const modToolName = (pkg, fn) => `${pkg}__${fn}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);

/**
 * @param {object} host  functions from main.js: log, version, logs, apps, setOpen, restart,
 *                       state, perf, lookup, webContentsOf, consoleOf, captureGame, call,
 *                       reloadArchives; for SV3: modTools, callModTool, toolOff, seen
 */
function createMcp(host) {
  let server = null;
  let current = { enabled: false, port: 0, token: '' };
  // The $type of each object reference the tools handed out, so api_read knows a TweakDB record.
  const refTypes = new Map();

  function noteRefs(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return;
    if (typeof value.$ref === 'number' && typeof value.$type === 'string') {
      refTypes.set(value.$ref, value.$type);
      if (refTypes.size > 5000) refTypes.delete(refTypes.keys().next().value);
    }
    for (const v of Array.isArray(value) ? value : Object.values(value)) noteRefs(v, depth + 1);
  }

  async function gameCall({ fn, class: cls, self, args }) {
    const params = { fn, args: args ?? [] };
    if (cls) params.class = cls;
    if (self !== undefined) params.self = { $ref: self };
    const r = await host.call('rtti.call', params);
    noteRefs(r);
    return r;
  }

  const CALL_INPUT = {
    fn: z.string().describe('The function name, or its full name for overloads, such as "Cast;EntityID;StatsObjectID"'),
    class: z.string().optional().describe('For a static function: the class, such as "GameInstance"'),
    self: z.number().int().optional().describe('For a method: the object reference number ($ref)'),
    args: z.array(z.unknown()).optional().describe('The arguments. The game instance is {}; 64-bit numbers are strings; enums are member names'),
  };

  // who: the assistant making this request, { name, kind }, from its token (SV3). With
  // all, REDnode's own tools are built even when switched off: the Tools Manager lists them.
  function build(who = { name: 'An assistant', kind: 'unknown' }, all = false) {
    const mcp = new McpServer({ name: 'rednode', version: host.version }, { instructions: INSTRUCTIONS });
    // The player's switches in the Tools Manager: a REDnode tool switched off is not offered.
    const registerTool = mcp.registerTool.bind(mcp);
    mcp.registerTool = (name, ...rest) => (!all && host.toolOff?.(`rednode:${name}`) ? null : registerTool(name, ...rest));

    mcp.registerTool(
      'logs',
      {
        title: 'Mod log',
        description: 'What REDnode Node mods printed, newest last, as the Mod log app shows it. Crashes keep only the stack lines in the mod\'s own code.',
        inputSchema: {
          mod: z.string().optional().describe('Only this mod id'),
          errorsOnly: z.boolean().optional().describe('Only errors and crashes'),
          limit: z.number().int().min(1).max(500).optional().describe('How many lines, newest last. Default 100'),
        },
        annotations: READ,
      },
      async ({ mod, errorsOnly, limit }) => {
        const lines = host
          .logs()
          .filter((e) => (!mod || e.id === mod) && (!errorsOnly || e.level === 'error'))
          .slice(-(limit ?? 100))
          .map((e) => `${e.time} [${e.id}]${e.level === 'error' ? ' ERROR' : ''} ${e.text}`);
        return text(lines.length ? lines.join('\n') : 'No lines.');
      },
    );

    mcp.registerTool(
      'apps',
      {
        title: 'Apps and mods',
        description:
          'Lists the installed overlay apps and Node mods: open or running, a mod\'s state (running, crashed, not-responding), process and memory, and its last error. ' +
          'With an action, opens, closes or restarts one, or pins it to the launcher or the HUD, as the launcher and Mod Manager do. Window ids for window_text and window_image are listed too.',
        inputSchema: {
          action: z
            .enum(['list', 'open', 'close', 'restart', 'pin-launcher', 'unpin-launcher', 'pin-hud', 'unpin-hud'])
            .optional()
            .describe('Default list. pin-launcher lists a package in the launcher; pin-hud keeps its windows on screen during gameplay'),
          id: z.string().optional().describe('The app or mod id, for every action but list'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ action = 'list', id }) => {
        if (action !== 'list') {
          if (!id) return fail(`${action} needs an id`);
          try {
            if (action === 'restart') host.restart(id);
            else if (action.endsWith('-launcher') || action.endsWith('-hud')) {
              host.setPin(id, action.endsWith('-hud') ? 'hud' : 'launcher', action.startsWith('pin'));
            } else host.setOpen(id, action === 'open');
          } catch (err) {
            return fail(err.message);
          }
        }
        return text(host.apps());
      },
    );

    mcp.registerTool(
      'game_state',
      {
        title: 'Game state',
        description: 'Whether REDnode is linked to the game, what the game shows (a menu, photo mode, a scene, the main menu) and the overlay mode (passive, interactive, hidden).',
        annotations: READ,
      },
      async () => text(host.state()),
    );

    mcp.registerTool(
      'perf',
      {
        title: 'Performance',
        description: 'The game\'s frame rate and what the overlay costs per game frame, the host\'s memory and CPU, and each mod process\'s memory. Updated every second while the game runs.',
        annotations: READ,
      },
      async () => text(host.perf()),
    );

    mcp.registerTool(
      'gameapi_lookup',
      {
        title: 'Game API lookup',
        description:
          'Looks up Cyberpunk 2077 game types and functions, with the TypeScript signatures that `api` in the rednode package uses, and REDnode\'s notes. ' +
          'Give an exact type name (native, such as gameStatsSystem, or script, such as StatsSystem) for its full declaration, or part of a name to search.',
        inputSchema: {
          query: z.string().describe('A type or function name, or part of one'),
          member: z.string().optional().describe('With an exact type: only members whose name contains this'),
        },
        annotations: READ,
      },
      async ({ query, member }) => {
        try {
          return text(host.lookup(query, member));
        } catch (err) {
          return fail(`The game API types are not available: ${err.message}`);
        }
      },
    );

    mcp.registerTool(
      'window_text',
      {
        title: 'Window text',
        description: 'The text an overlay window shows, including inside UI kit components and the values of input fields. Use apps to find window ids.',
        inputSchema: { id: z.string().describe('The app id, or a mod window id such as "hello-mod~main"') },
        annotations: READ,
      },
      async ({ id }) => {
        const wc = host.webContentsOf(id);
        if (!wc) return fail(`No open window "${id}". Use apps to list them.`);
        try {
          return text(await wc.executeJavaScript(WINDOW_TEXT, true));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'window_image',
      {
        title: 'Window image',
        description: 'A picture of an overlay window: its own pixels, as drawn before REDnode places it on the game. It does not show the game behind it, its place on screen, or the cursor.',
        inputSchema: { id: z.string().describe('The app id, or a mod window id such as "hello-mod~main"') },
        annotations: READ,
      },
      async ({ id }) => {
        const wc = host.webContentsOf(id);
        if (!wc) return fail(`No open window "${id}". Use apps to list them.`);
        try {
          const image = await wc.capturePage();
          if (image.isEmpty()) return fail('The window gave an empty picture.');
          return { content: [{ type: 'image', data: image.toPNG().toString('base64'), mimeType: 'image/png' }] };
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'window_console',
      {
        title: 'Window console',
        description:
          "What an overlay window's page logged with console.log, console.error and the like, and its uncaught errors: " +
          'the last 200 messages since the window opened, oldest first. (Node mods log to logs instead.)',
        inputSchema: {
          id: z.string().describe('The app id, or a mod window id such as "hello-mod~main"'),
          level: z.enum(['debug', 'info', 'warning', 'error']).optional().describe('Only this level and above'),
          limit: z.number().int().min(1).max(200).optional().describe('The newest this many. Default 50'),
        },
        annotations: READ,
      },
      async ({ id, level, limit }) => {
        const all = host.consoleOf(id);
        if (!all) return fail(`No open window "${id}". Use apps to list them.`);
        const order = ['debug', 'info', 'warning', 'error'];
        const min = level ? order.indexOf(level) : 0;
        const picked = all.filter((m) => order.indexOf(m.level) >= min).slice(-(limit ?? 50));
        if (!picked.length) return text(`No console messages from "${id}"${level ? ` at ${level} or above` : ''}.`);
        return text(
          picked
            .map((m) => {
              const where = m.source ? ` (${String(m.source).split('/').pop()}:${m.line})` : '';
              const d = new Date(m.time); // local time, as in the host log
              const time = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
              return `${time} ${m.level}: ${m.message}${where}`;
            })
            .join('\n'),
        );
      },
    );

    mcp.registerTool(
      'game_image',
      {
        title: 'Game screen',
        description:
          "A picture of the game's screen now. By default the game alone, as it draws its frame; with overlay true, " +
          "REDnode's overlay windows and the cursor on top, as the player sees it. Scaled to at most maxWidth pixels wide. " +
          'HDR is converted to SDR, so its colors are approximate. Fails while the game is loading or minimized.',
        inputSchema: {
          overlay: z.boolean().optional().describe("Include REDnode's overlay windows and the cursor. Default false"),
          maxWidth: z.number().int().min(320).max(1920).optional().describe('Default 1280'),
        },
        annotations: READ,
      },
      async ({ overlay, maxWidth }) => {
        try {
          const c = await host.captureGame({ overlay, maxWidth: maxWidth ?? 1280 });
          return {
            content: [
              { type: 'image', data: c.image.toJPEG(85).toString('base64'), mimeType: 'image/jpeg' },
              {
                type: 'text',
                text: `${c.width} x ${c.height}, scaled from ${c.sourceWidth} x ${c.sourceHeight}; ${c.overlay ? 'with' : 'without'} the overlay${c.hdr ? '; HDR converted to SDR' : ''}.`,
              },
            ],
          };
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'api_read',
      {
        title: 'Read from the game',
        description:
          'Calls a game function that reads, as api_call does, without asking the player: one named like a read ' +
          '(starting with Get, Is, Has, Can or Find, but not one that also changes, such as GetOrCreate...), ' +
          'or any method of a TweakDB record (a gamedata..._Record from tweakdb or another call). Refuses the rest: use api_call for those. ' +
          'Game objects come back as {"$ref": n, "$type": "..."}. Functions with out parameters return {result, out}.',
        inputSchema: CALL_INPUT,
        annotations: READ,
      },
      async (input) => {
        const selfType = input.self !== undefined ? refTypes.get(input.self) : undefined;
        if (!isRead(input.fn, selfType)) {
          return fail(
            `${input.fn} does not look like a read: api_read runs functions starting with Get, Is, Has, Can or Find ` +
              '(but not one that also changes, such as GetOrCreate...) and the methods of TweakDB records. ' +
              'Use api_call, which asks the player first.',
          );
        }
        try {
          return text(await gameCall(input));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'api_call',
      {
        title: 'Call the game',
        description:
          'Calls a game function, as `api` in the rednode package does: a global function by name, a static function with class (script or native name), or a method with self. ' +
          'Arguments are checked against the game\'s types first. Game objects come back as {"$ref": n, "$type": "..."}. Functions with out parameters return {result, out}. ' +
          'This can change the player\'s game, so the player is asked before every call: use api_read for reads.',
        inputSchema: CALL_INPUT,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async (input) => {
        try {
          return text(await gameCall(input));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'api_get',
      {
        title: 'Read a property',
        description: 'Reads a property of a game object by its reference number.',
        inputSchema: {
          self: z.number().int().describe('The object reference number ($ref)'),
          prop: z.string().describe('The property name'),
        },
        annotations: READ,
      },
      async ({ self, prop }) => {
        try {
          const r = await host.call('rtti.get', { self: { $ref: self }, prop });
          noteRefs(r);
          return text(r);
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'tweakdb',
      {
        title: 'TweakDB',
        description:
          "Reads TweakDB, the game's tuning database, from the running game. op 'get': a flat's type and value " +
          "(path such as 'Items.Preset_Lexington_Default.magazineCapacity'). op 'record': the record as a game " +
          "object reference, to read its methods with api_read (path such as 'Items.money'). op 'records': the ids " +
          "of every record of a type (type such as 'Vehicle' or 'gamedataVehicle_Record'). Ids are hashes shown as " +
          '"0x..."; the game keeps no names. Record types and their methods are in gameapi_lookup.',
        inputSchema: {
          op: z.enum(['get', 'record', 'records']),
          path: z.string().optional().describe("A record or flat path, or an id as '0x...' (get, record)"),
          type: z.string().optional().describe('A record type (records)'),
          limit: z.number().int().min(1).max(5000).optional().describe('records: the most ids to list. Default 500'),
        },
        annotations: READ,
      },
      async ({ op, path, type, limit }) => {
        try {
          if (op === 'records') {
            const r = await host.call('tweakdb.records', { type });
            const max = limit ?? 500;
            return text({ type: r.type, count: r.ids.length, ids: r.ids.slice(0, max), more: Math.max(0, r.ids.length - max) });
          }
          const r = await host.call(op === 'get' ? 'tweakdb.get' : 'tweakdb.record', { path });
          noteRefs(r);
          return text(r ?? `TweakDB has no ${op === 'get' ? 'flat' : 'record'} "${path}"`);
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'archives_reload',
      {
        title: 'Swap archives',
        description:
          'Swaps archives into the running game, so a changed mesh, material or texture is used without a restart. ' +
          'Each file is a full path to an .archive (or an ArchiveXL .xl or .yaml), which replaces the mounted archive ' +
          'of the same name or is added to archive/pc/mod, or the name of an archive already in archive/pc/mod, ' +
          'reloaded as it is. Needs RED Hot Tools in the game and a loaded save. Afterwards everything that uses a swapped file ' +
          'shows the new version: the clothing V wears applies its appearance again, REDnode\'s spawns are spawned again (new ids), ' +
          'and the game\'s entities within 30 m of V switch appearance and back (refresh: false skips all of it). Entities farther ' +
          'away load the new version when the game builds them again. An archive with the game\'s sound paks ' +
          '(.opuspak, .opusinfo) is swapped with the game paused and its sound index loaded again; a sound that just played ' +
          'may keep its old version until the game loads it again (for a weapon, equip it again). A broken archive can crash the game. ' +
          'The player is asked before every call.',
        inputSchema: {
          files: z.array(z.string()).min(1).describe('Full paths, or names of archives in archive/pc/mod'),
          refresh: z.boolean().optional().describe('Refresh what uses the swapped files (what V wears, spawns, entities near V). Default true'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async ({ files, refresh }) => {
        try {
          return text(await host.reloadArchives(files, refresh));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    // ---------- the world near V, and spawning (H2c-b) ----------

    const POINT = z.object({ x: z.number(), y: z.number(), z: z.number() });

    mcp.registerTool(
      'world_near',
      {
        title: 'Entities near V',
        description:
          'Lists the entities near V, nearest first: their game class, id, distance in metres and appearance. With files, each one\'s files ' +
          '(template and component resources, as path hashes); with uses, only the entities that use one of those files (depot paths or hashes), ' +
          'such as the meshes of an archive about to be swapped. The game objects come back as references for api_read.',
        inputSchema: {
          radius: z.number().positive().max(200).optional().describe('Metres from V. Default 15'),
          files: z.boolean().optional(),
          uses: z.array(z.string()).optional().describe('Depot paths or path hashes'),
        },
        annotations: READ,
      },
      async ({ radius, files, uses }) => {
        try {
          return text(await host.call('world.near', { radius: radius ?? 15, files: !!files, ...(uses ? { hashes: uses } : {}) }));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'world_spawned',
      {
        title: 'What REDnode spawned',
        description: 'Lists the entities REDnode packages and assistants spawned that are still listed: their package ("mcp" for assistants), id and, for assistants, the scene.',
        inputSchema: {},
        annotations: READ,
      },
      async () => text(host.worldSpawned()),
    );

    mcp.registerTool(
      'world_spawn',
      {
        title: 'Spawn in the world',
        description:
          'Spawns one entity: a mesh (a prop on its own), an entity template (.ent) or a TweakDB record (a Character.* record is a person, who stands ' +
          'where placed and stays friendly to V). Without a position it stands 3 m in front of V, facing V. It stays until world_remove, a save load, ' +
          'or the game closes; after an archive swap that changes a file it uses, it is spawned again (a new id). The player is asked before every call.',
        inputSchema: {
          mesh: z.string().optional().describe('A .mesh depot path'),
          meshAppearance: z.string().optional().describe('The mesh appearance, default "default"'),
          template: z.string().optional().describe('An .ent depot path'),
          record: z.string().optional().describe('A TweakDB record, such as Character.CitizenRichFemale'),
          appearance: z.string().optional().describe('The entity appearance'),
          position: POINT.optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async (input) => {
        try {
          return text(await host.worldSpawn(input));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'world_remove',
      {
        title: 'Remove a spawn',
        description: 'Removes an entity an assistant spawned with world_spawn or world_load, by the id it answered. The player is asked before every call.',
        inputSchema: { id: z.string() },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async ({ id }) => {
        try {
          return text({ removed: await host.worldRemove(id) });
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'world_load',
      {
        title: 'Load a scene',
        description:
          'Loads an EDGEbuilder scene file (.scene.json, a full path) into the running game: its meshes, entities and npc objects (lights are not spawned yet). ' +
          'People stand where placed and stay friendly to V. Loading a scene of the same name again replaces it; unload removes it. The player is asked before every call.',
        inputSchema: {
          file: z.string().optional().describe('The scene file, a full path. Not needed for unload'),
          name: z.string().optional().describe('The scene name; default the file\'s own'),
          unload: z.boolean().optional().describe('Remove the scene of this name instead'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async ({ file, name, unload }) => {
        try {
          if (unload) {
            if (!name) return fail('Give the name of the scene to unload');
            return text(await host.worldUnload(name));
          }
          if (!file) return fail('Give the scene file');
          return text(await host.worldLoad(file, name));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    // ---------- quest facts, the journal and moving V (Q-A, asked for by EDGEquest) ----------

    // Runs game calls with the references they hand out let go after.
    async function withRefs(fn) {
      const refs = [];
      const call = async (params) => {
        const r = await host.call('rtti.call', { args: [], ...params });
        if (r && typeof r === 'object' && typeof r.$ref === 'number') refs.push(r.$ref);
        return r;
      };
      try {
        return await fn(call);
      } finally {
        if (refs.length) host.call('rtti.release', { refs }).catch(() => {});
      }
    }
    const system = (call, getter) => call({ class: 'GameInstance', fn: getter, args: [{}] });
    const JOURNAL_KINDS = {
      quest: 'gameJournalQuest',
      phase: 'gameJournalQuestPhase',
      objective: 'gameJournalQuestObjective',
      subobjective: 'gameJournalQuestSubObjective',
      mappin: 'gameJournalQuestMapPin',
    };
    const kindOf = (kind) => JOURNAL_KINDS[kind ?? 'objective'] ?? kind;
    const KIND_INPUT = z.string().optional().describe('quest, phase, objective (default), subobjective, mappin, or the game\'s class name');

    mcp.registerTool(
      'game_facts',
      {
        title: 'Read quest facts',
        description: 'Reads the game\'s quest facts by name (an unset fact reads 0). Needs a loaded save.',
        inputSchema: { names: z.array(z.string()).min(1).describe('Fact names') },
        annotations: READ,
      },
      async ({ names }) => {
        try {
          return text(
            await withRefs(async (call) => {
              const qs = await system(call, 'GetQuestsSystem');
              if (!qs) throw new Error('No quests system: load a save first');
              const values = await Promise.all(names.map((n) => call({ self: { $ref: qs.$ref }, fn: 'GetFact', args: [n] })));
              return Object.fromEntries(names.map((n, i) => [n, values[i]]));
            }),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'game_facts_set',
      {
        title: 'Set quest facts',
        description: 'Sets the game\'s quest facts. This changes the player\'s save, so the player is asked before every call.',
        inputSchema: { facts: z.record(z.string(), z.number().int()).describe('Fact names and their new values') },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async ({ facts }) => {
        try {
          return text(
            await withRefs(async (call) => {
              const qs = await system(call, 'GetQuestsSystem');
              if (!qs) throw new Error('No quests system: load a save first');
              for (const [name, value] of Object.entries(facts)) await call({ self: { $ref: qs.$ref }, fn: 'SetFact', args: [name, value] });
              const now = await Promise.all(Object.keys(facts).map((n) => call({ self: { $ref: qs.$ref }, fn: 'GetFact', args: [n] })));
              return Object.fromEntries(Object.keys(facts).map((n, i) => [n, now[i]]));
            }),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'game_journal',
      {
        title: 'Read the journal',
        description:
          'Reads journal entries by path: each one\'s state (Inactive, Active, Succeeded, Failed) and whether it is tracked, or null when the path is not in the journal. ' +
          'With no paths, answers the tracked entry and its path (built from its parents\' ids; unverified for every kind). Needs a loaded save.',
        inputSchema: { paths: z.array(z.string()).optional().describe('Journal paths'), kind: KIND_INPUT },
        annotations: READ,
      },
      async ({ paths, kind }) => {
        try {
          return text(
            await withRefs(async (call) => {
              const j = await system(call, 'GetJournalManager');
              if (!j) throw new Error('No journal: load a save first');
              const on = (fn, args) => call({ self: { $ref: j.$ref }, fn, args });
              if (!paths?.length) {
                const tracked = await on('GetTrackedEntry', []);
                if (!tracked) return { tracked: null };
                const ids = [];
                for (let e = tracked; e && ids.length < 12; e = await on('GetParentEntry', [{ $ref: e.$ref }])) {
                  const id = await call({ self: { $ref: e.$ref }, fn: 'GetId' });
                  if (id) ids.unshift(id);
                }
                return { tracked: { path: ids.join('/'), state: await on('GetEntryState', [{ $ref: tracked.$ref }]) } };
              }
              const out = {};
              for (const path of paths) {
                const e = await on('GetEntryByString', [path, kindOf(kind)]);
                out[path] = e
                  ? { state: await on('GetEntryState', [{ $ref: e.$ref }]), tracked: await on('IsEntryTracked', [{ $ref: e.$ref }]) }
                  : null;
              }
              return out;
            }),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'game_journal_set',
      {
        title: 'Change a journal entry',
        description: 'Changes a journal entry\'s state (with the game\'s notification), or tracks it. This changes the player\'s save, so the player is asked before every call.',
        inputSchema: {
          path: z.string().describe('The journal path'),
          state: z.enum(['Inactive', 'Active', 'Succeeded', 'Failed']).optional().describe('The new state'),
          track: z.boolean().optional().describe('Track the entry'),
          kind: KIND_INPUT,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async ({ path, state, track, kind }) => {
        try {
          return text(
            await withRefs(async (call) => {
              const j = await system(call, 'GetJournalManager');
              if (!j) throw new Error('No journal: load a save first');
              const on = (fn, args) => call({ self: { $ref: j.$ref }, fn, args });
              const done = {};
              if (state) done.changed = await on('ChangeEntryState', [path, kindOf(kind), state, 'Notify']);
              if (track) {
                const e = await on('GetEntryByString', [path, kindOf(kind)]);
                if (e) await on('TrackEntry', [{ $ref: e.$ref }]);
                done.tracked = !!e;
              }
              return done;
            }),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'game_teleport',
      {
        title: 'Move V',
        description: 'Moves V to a position (yaw in degrees) or to a world node by its reference ("$/…", or its hash; unverified which the game takes). The player is asked before every call.',
        inputSchema: {
          x: z.number().optional(),
          y: z.number().optional(),
          z: z.number().optional(),
          yaw: z.number().optional(),
          nodeRef: z.string().optional().describe('A node reference instead of a position'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: ASK_FIRST,
      },
      async ({ x, y, z: zz, yaw, nodeRef }) => {
        try {
          if (!nodeRef && [x, y, zz].some((v) => typeof v !== 'number')) return fail('Give x, y and z, or nodeRef');
          return text(
            await withRefs(async (call) => {
              const facility = await system(call, 'GetTeleportationFacility');
              const player = await call({ fn: 'GetPlayer', args: [{}] });
              if (!facility || !player) throw new Error('No player: load a save first');
              if (nodeRef) await call({ self: { $ref: facility.$ref }, fn: 'TeleportToNode', args: [{ $ref: player.$ref }, nodeRef] });
              else
                await call({
                  self: { $ref: facility.$ref },
                  fn: 'Teleport',
                  args: [{ $ref: player.$ref }, { X: x, Y: y, Z: zz, W: 1 }, { Roll: 0, Pitch: 0, Yaw: yaw ?? 0 }],
                });
              return { moved: true };
            }),
          );
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    // ---------- packages' tools (SV3) ----------

    // Calls a package function for this assistant, logs it, and answers as a tool.
    const runModTool = async (pkg, fn, input) => {
      try {
        return text(await host.callModTool(who, pkg, fn, input ?? {}));
      } catch (err) {
        return fail(err.message);
      }
    };

    if (host.modTools) {
      for (const t of host.modTools()) {
        registerTool(
          modToolName(t.pkg, t.fn.name),
          {
            title: `${t.pkgName}: ${t.fn.name}`,
            description: `${t.fn.description || `${t.fn.name}, from ${t.pkgName}.`} (From the ${t.pkgName} mod, described by its author.${t.fn.readonly ? ' It only reads.' : ' The player is asked before every call.'})`,
            inputSchema: toolInput(t.fn),
            annotations: t.fn.readonly ? READ : { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
            ...(t.fn.readonly ? {} : { _meta: ASK_FIRST }),
          },
          async (input) => runModTool(t.pkg, t.fn.name, input),
        );
      }

      mcp.registerTool(
        'mod_services',
        {
          title: 'Mods\' tools',
          description:
            'Every running mod that offers tools to assistants: each tool\'s package, function, description, parameters (JSON Schema), and whether it only reads. ' +
            'Includes mods started after your tool list was read; call those with mod_read or mod_call.',
          annotations: READ,
        },
        async () =>
          text(
            host.modTools().map((t) => ({
              tool: modToolName(t.pkg, t.fn.name),
              package: t.pkg,
              function: t.fn.name,
              description: t.fn.description,
              readonly: t.fn.readonly,
              params: t.fn.params.map((p) => ({ name: p.name, type: p.type, optional: p.optional, description: p.description, schema: p.schema })),
              returns: t.fn.returns?.type ?? null,
            })),
          ),
      );

      const MOD_CALL_INPUT = {
        package: z.string().describe('The package id, as mod_services lists it'),
        function: z.string().describe('The function name'),
        args: z.record(z.string(), z.unknown()).optional().describe('The arguments by parameter name'),
      };
      const findTool = (pkg, fn) => host.modTools().find((t) => t.pkg === pkg && t.fn.name === fn);

      mcp.registerTool(
        'mod_read',
        {
          title: 'Call a mod\'s read tool',
          description: 'Calls a mod\'s tool that only reads (readonly in mod_services), by package and function, without asking the player. Refuses tools that change something: use mod_call for those.',
          inputSchema: MOD_CALL_INPUT,
          annotations: READ,
        },
        async ({ package: pkg, function: fn, args }) => {
          const t = findTool(pkg, fn);
          if (!t) return fail(`${pkg} offers no tool "${fn}" now: see mod_services`);
          if (!t.fn.readonly) return fail(`${fn} can change the game, so mod_read refuses it: use mod_call, which asks the player`);
          return runModTool(pkg, fn, args);
        },
      );

      mcp.registerTool(
        'mod_call',
        {
          title: 'Call a mod\'s tool',
          description: 'Calls any mod\'s tool by package and function, such as one started after your tool list was read. The player is asked before every call.',
          inputSchema: MOD_CALL_INPUT,
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
          _meta: ASK_FIRST,
        },
        async ({ package: pkg, function: fn, args }) => {
          if (!findTool(pkg, fn)) return fail(`${pkg} offers no tool "${fn}" now: see mod_services`);
          return runModTool(pkg, fn, args);
        },
      );
    }

    return mcp;
  }

  // REDnode's own tools as the Tools Manager lists them: name, title, description, input
  // (JSON Schema), whether it only reads, and whether it asks the player first.
  function ownTools() {
    const mcp = build(undefined, true);
    const tools = mcp._registeredTools ?? {};
    const out = [];
    for (const [name, t] of Object.entries(tools)) {
      if (name.includes('__')) continue; // packages' own tools are listed per package
      let input = null;
      try {
        input = t.inputSchema ? z.toJSONSchema(t.inputSchema) : null;
      } catch {
        input = null;
      }
      out.push({
        name,
        title: t.title ?? name,
        description: t.description ?? '',
        input,
        readonly: !!t.annotations?.readOnlyHint,
        asks: !!t._meta?.['anthropic/requiresUserInteraction'],
      });
    }
    mcp.close();
    return out;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const ok = (current.external && token === current.token) || current.internal?.has(token);
    if (!token || !ok) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'A valid token is required' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end(); // stateless: no server-sent stream, no sessions
      return;
    }
    // The body, read here to learn the assistant's name from its initialize request.
    let body;
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    } catch {
      res.writeHead(400).end();
      return;
    }
    for (const m of Array.isArray(body) ? body : [body]) {
      if (m?.method === 'initialize') host.seen?.(token, m.params?.clientInfo?.name ?? null);
    }
    const who = host.seen?.(token) ?? { name: 'An assistant', kind: 'unknown' };
    const mcp = build(who);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${current.port}`, `localhost:${current.port}`],
    });
    res.on('close', () => {
      transport.close();
      mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      host.log(`MCP request failed: ${err.message}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  }

  function stop() {
    if (!server) return;
    server.close();
    server.closeAllConnections?.();
    server = null;
  }

  return {
    /** Starts, stops or moves the server to match aConfig: { enabled, external, port, token, internal }. */
    configure(aConfig) {
      const same = server && current.port === aConfig.port;
      current = { ...aConfig };
      if (!current.enabled) {
        if (server) host.log('MCP server stopped');
        stop();
        return;
      }
      if (same) return;
      stop();
      server = http.createServer((req, res) => {
        handle(req, res);
      });
      server.on('error', (err) => {
        host.log(`MCP server could not start on port ${current.port}: ${err.message}`);
        server = null;
      });
      server.listen(current.port, '127.0.0.1', () => host.log(`MCP server on http://127.0.0.1:${current.port}/mcp`));
    },
    stop,
    /** REDnode's own tools, for the Tools Manager. */
    ownTools,
    /** Whether the server runs, and on which port. */
    status: () => ({ enabled: !!server && current.enabled, port: current.port, external: !!current.external }),
  };
}

// Collects a page's visible text, including inside shadow roots and slots.
const WINDOW_TEXT = `(() => {
  const out = [];
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\\s+/g, ' ').trim();
        if (t) out.push(t);
      } else if (c.nodeType === 1) {
        if (!visible(c) || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
        if ((c.tagName === 'INPUT' || c.tagName === 'TEXTAREA') && c.value) out.push('[' + c.value + ']');
        if (c.tagName === 'SLOT') { for (const a of c.assignedNodes({ flatten: true })) walk({ childNodes: [a] }); continue; }
        if (c.shadowRoot) walk(c.shadowRoot); else walk(c);
      }
    }
  };
  walk(document.body);
  return out.join('\\n');
})()`;

module.exports = { createMcp, isRead, modToolName };
