// The kernel MCP server: REDnode's tools for AI agents, served by the overlay
// host on localhost. Claude Code on the desktop uses it while the game runs, and
// REDagent, the in-game assistant, will use the same tools.
//
//   http://127.0.0.1:41820/mcp   Streamable HTTP, stateless; every request needs
//                                Authorization: Bearer <token> (see the launcher)
//
// Tools: logs, apps, game_state, perf, gameapi_lookup, window_text, window_image,
// window_console, game_image, api_read, api_call, api_get, tweakdb, archives_reload.
// See docs/mcp.md.

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
- archives_reload: swaps changed archives into the running game through RED Hot Tools, for seeing an asset change without a restart. Archives that change the game's sound paks are swapped with the game paused and its sound index loaded again; a sound that just played may keep its old version until the game loads it again (for a weapon, equip it again).
- api_read, api_call, api_get: live calls into the game. Game objects come back as {"$ref": n, "$type": "..."}; pass {"$ref": n} back as self. Most functions take the game instance first: pass {}. 64-bit numbers are strings. References die when a save loads.
For a quest: game_facts and game_journal read facts and journal entries; game_facts_set, game_journal_set and game_teleport change the player's save or move V, and ask first.
Use api_read for reads: it runs functions named like reads (Get, Is, Has, Can, Find) and a TweakDB record's methods, and refuses the rest. api_call runs any function and can change the player's game, such as their money or health; archives_reload replaces files in the game's mod folder. Both ask the player before every call.
Guide: https://edgemodders.github.io/REDnode/overlay-apps.html`;

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const READ = { readOnlyHint: true, openWorldHint: false };
// Claude Code asks the player before every call of a tool with this, in every permission mode.
const ASK_FIRST = { 'anthropic/requiresUserInteraction': true };

// api_read's rule. The game's own const flag cannot tell reads from changes (in 2.31, 1,865
// const functions are not getters, such as SetAIRole, and two thirds of the getters are not
// const), so the name decides: a read starts with one of READ_START and has none of
// CHANGE_WORDS as a word after it (GetOrCreate...). TweakDB records' methods only read flats.
const READ_START = /^(Get|Is|Has|Can|Find)(?=[A-Z0-9_]|$)/;
const CHANGE_WORDS =
  /(^|[a-z0-9_])(Create|Spawn|Set|Add|Remove|Apply|Request|Give|Take|Kill|Destroy|Delete|Clear|Reset|Start|Stop|Trigger|Send|Queue|Register|Unregister|Activate|Deactivate|Enable|Disable|Toggle|Load|Unload|Equip|Unequip|Consume|Drop|Teleport|Push|Pop|Change|Modify|Update|Increment|Decrement|Init|Initialize|Release|Acquire|Lock|Unlock|Play|Fire|Notify|Commit|Save|Spend|Award|Grant|Force|Kick|Open|Close|Show|Hide)(?=[A-Z0-9_]|$)/;
const RECORD_TYPE = /^gamedata\w*_Record$/;

/** Whether api_read may run fn; selfType is the $type of self when known. */
function isRead(fn, selfType) {
  const name = String(fn).split(';')[0];
  if (selfType && RECORD_TYPE.test(selfType)) return true;
  const m = READ_START.exec(name);
  return !!m && !CHANGE_WORDS.test(name.slice(m[0].length));
}

/**
 * @param {object} host  functions from main.js: log, version, logs, apps, setOpen, restart,
 *                       state, perf, lookup, webContentsOf, consoleOf, captureGame, call,
 *                       reloadArchives
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

  function build() {
    const mcp = new McpServer({ name: 'rednode', version: host.version }, { instructions: INSTRUCTIONS });

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
          '(starting with Get, Is, Has, Can or Find, with no word such as Create, Set, Add or Remove after it), ' +
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
              '(with no word such as Create, Set, Add or Remove after it) and the methods of TweakDB records. ' +
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
          'reloaded as it is. Needs RED Hot Tools in the game and a loaded save. Afterwards the clothing V wears applies its ' +
          'appearance again, so it shows the new version (refresh: false skips it). Other objects already in the world keep ' +
          'the old asset until they load it again (respawn, or re-apply the appearance). An archive with the game\'s sound paks ' +
          '(.opuspak, .opusinfo) is swapped with the game paused and its sound index loaded again; a sound that just played ' +
          'may keep its old version until the game loads it again (for a weapon, equip it again). A broken archive can crash the game. ' +
          'The player is asked before every call.',
        inputSchema: {
          files: z.array(z.string()).min(1).describe('Full paths, or names of archives in archive/pc/mod'),
          refresh: z.boolean().optional().describe('Apply the appearance of what V wears again after the swap. Default true'),
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

    return mcp;
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
    const mcp = build();
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
      await transport.handleRequest(req, res);
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

module.exports = { createMcp, isRead };
