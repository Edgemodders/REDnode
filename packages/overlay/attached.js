// MCP servers REDnode runs for in-game assistants (E1, docs/mcp.md, "EDGEmat's tools"): an
// MCP server that speaks over stdio, started by the host on the first request that needs it,
// with Electron's own Node (ELECTRON_RUN_AS_NODE), so players need no Node.js. Its tools are
// listed by the kernel MCP server beside the packages' own, as <id>__<tool>, and the Tools
// Manager switches them like a package's.
//
// The first is EDGEmat's (@edgemodders/edgemat-mcp, MIT, shipped with REDnode in
// host/resources/edgemat). It gets the game folder and the REDbridge REDnode found, and
// none of the player's keys: from #23 on it reads them from the shared store itself.

'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const MAX_STARTS = 3; // per host session: a server that keeps ending stays off
const CALL_MS = 10 * 60 * 1000; // a library build takes a minute or two; generating an image, longer

/**
 * @param {object} spec
 * @param {string} spec.id      the tools' prefix and the Tools Manager group, such as "edgemat"
 * @param {string} spec.name    the name players see, such as "EDGEmat"
 * @param {() => string | null} spec.script  the server's .cjs file, or null when not shipped
 * @param {() => object} spec.env  variables for the server, beside the MCP SDK's safe defaults
 * @param {Set<string>} spec.reads  the tools that only read; every other tool asks the player
 * @param {string} spec.version  the shipped version, for the log
 * @param {(line: string) => void} spec.log
 */
function createAttached(spec) {
  let client = null;
  let starting = null;
  let tools = []; // [{ name, description, inputSchema }]
  let starts = 0;
  let missingLogged = false;

  async function start() {
    const script = spec.script();
    if (!script || !fs.existsSync(script)) {
      if (!missingLogged) spec.log(`${spec.name} tools: not shipped with this build (${script ?? 'no path'})`);
      missingLogged = true;
      return;
    }
    if (starts >= MAX_STARTS) return;
    starts++;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [script],
      env: { ...spec.env(), ELECTRON_RUN_AS_NODE: '1' },
      stderr: 'pipe',
    });
    const c = new Client({ name: 'rednode', version: spec.version });
    c.onclose = () => {
      if (client === c) {
        client = null;
        tools = [];
        spec.log(`${spec.name} tools: the server ended`);
      }
    };
    const started = Date.now();
    await c.connect(transport);
    if (transport.stderr) readline.createInterface({ input: transport.stderr }).on('line', (line) => spec.log(`[${spec.name}] ${line}`));
    const list = await c.listTools();
    client = c;
    tools = list.tools.map((t) => ({ name: t.name, title: t.title, description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object' } }));
    const v = c.getServerVersion();
    spec.log(`${spec.name} tools: ${v?.name ?? 'server'} ${v?.version ?? ''} started in ${Date.now() - started} ms, ${tools.length} tools`.replace('  ', ' '));
  }

  /** Starts the server if needed and waits for its tool list, at most waitMs. */
  async function ready(waitMs = 4000) {
    if (client) return true;
    if (!starting) {
      starting = start()
        .catch((err) => spec.log(`${spec.name} tools: could not start: ${err.message}`))
        .finally(() => {
          starting = null;
        });
    }
    let timer;
    await Promise.race([starting, new Promise((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
    return !!client;
  }

  /**
   * The tools as the kernel lists packages' functions: { name, description, readonly, params }
   * with params from the tool's JSON Schema, by property.
   */
  function functions() {
    return tools.map((t) => {
      const required = new Set(t.inputSchema.required ?? []);
      return {
        name: t.name,
        description: t.description,
        readonly: spec.reads.has(t.name),
        params: Object.entries(t.inputSchema.properties ?? {}).map(([name, schema]) => ({
          name,
          type: Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'unknown'),
          optional: !required.has(name),
          description: schema.description,
          default: schema.default,
          schema,
        })),
      };
    });
  }

  /** Calls a tool with its arguments by name; resolves with the server's own CallToolResult. */
  async function call(name, args) {
    if (!(await ready())) throw new Error(`${spec.name}'s tools are not running: see REDnode's host log`);
    if (!tools.some((t) => t.name === name)) throw new Error(`${spec.name} has no tool "${name}"`);
    return client.callTool({ name, arguments: args ?? {} }, undefined, { timeout: CALL_MS, resetTimeoutOnProgress: true });
  }

  async function stop() {
    const c = client;
    client = null;
    tools = [];
    if (c) await c.close().catch(() => {});
  }

  return { id: spec.id, name: spec.name, ready, functions, call, stop, running: () => !!client };
}

module.exports = { createAttached };
