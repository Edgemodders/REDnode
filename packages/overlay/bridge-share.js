// REDnode's REDbridge, shared with the MCP servers the host runs for in-game assistants (#40):
// EDGEmat's server (attached.js) sends its REDbridge calls here instead of starting a second
// REDbridge beside the one packages share through kernel.bridge(), so one REDbridge loads
// WolvenKit and the game's archive list while the player plays.
//
//   POST http://127.0.0.1:<port>/bridge   Authorization: Bearer <token>
//        { "method": "<REDbridge method>", "params": { ... } }
//   200  { "result": ... }   or   { "error": "<message>" }   (REDbridge's own error, or NOT_INSTALLED);
//        the headers come at once and spaces before the JSON keep a long call's line open
//
// The server listens on 127.0.0.1 only, on a free port, from the first grant until the host
// quits. Each attached server gets a token of its own at each start, in its environment
// (REDNODE_BRIDGE_URL, REDNODE_BRIDGE_TOKEN), never on a command line; a new start replaces
// the old token. A request must name this server in its Host header and carry no Origin, so a
// web page cannot reach it. Packages keep kernel.bridge() and its "bridge" permission.

'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

const MAX_BODY = 32 * 1024 * 1024;
const KEEP_MS = Number(process.env.REDNODE_BRIDGE_KEEP_MS) || 30 * 1000; // a space this often during a long call

/**
 * @param {object} host
 * @param {(method: string, params: object) => Promise<unknown>} host.call  redbridge.call
 * @param {(line: string) => void} host.log
 */
function createBridgeShare(host) {
  let server = null;
  let listening = null; // a promise of the port
  const tokens = new Map(); // token -> { name, calls }

  function listen() {
    if (listening) return listening;
    listening = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handle(req, res).catch((err) => {
          host.log(`Shared REDbridge: request failed: ${err.message}`);
          if (!res.headersSent) answer(res, 500, { error: err.message });
        });
      });
      server.on('error', (err) => {
        host.log(`Shared REDbridge: could not listen: ${err.message}`);
        server = null;
        listening = null;
        reject(err);
      });
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        host.log(`Shared REDbridge on http://127.0.0.1:${port}/bridge`);
        resolve(port);
      });
    });
    return listening;
  }

  function answer(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  async function handle(req, res) {
    const port = server.address().port;
    const here = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!here.includes(req.headers.host ?? '') || req.headers.origin !== undefined) return answer(res, 403, { error: 'Not allowed' });
    if (new URL(req.url, 'http://localhost').pathname !== '/bridge') return answer(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const auth = req.headers.authorization ?? '';
    const who = auth.startsWith('Bearer ') ? tokens.get(auth.slice(7)) : undefined;
    if (!who) return answer(res, 401, { error: 'A valid token is required' });
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return answer(res, 413, { error: 'The request is over 32 MB' });
      chunks.push(c);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return answer(res, 400, { error: 'The body must be JSON: { "method": "...", "params": { ... } }' });
    }
    const method = typeof body?.method === 'string' ? body.method : '';
    const params = body?.params && typeof body.params === 'object' ? body.params : {};
    if (!who.calls++) host.log(`Shared REDbridge: first call from ${who.name} (${method})`);
    // No time limit here: a library build or a mesh export runs for minutes. The headers go
    // at once and a space every 30 s (leading spaces are valid JSON), so the caller's fetch,
    // which gives up after 5 minutes with nothing coming, waits for the answer.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    res.on('error', () => {}); // the caller went away: the call still ends in REDbridge
    const keep = setInterval(() => !res.destroyed && res.write(' '), KEEP_MS);
    let out;
    try {
      out = { result: (await host.call(method, params)) ?? null };
    } catch (err) {
      // REDbridge's error, or the words kernel.bridge() gives when it is not installed.
      out = { error: err?.message ?? String(err) };
    } finally {
      clearInterval(keep);
    }
    if (!res.destroyed) res.end(JSON.stringify(out));
  }

  return {
    /**
     * A token for one start of an attached server, named for the log, and the address to call;
     * an earlier token for the same name stops working. Resolves with the variables for its
     * environment.
     */
    async grant(name) {
      const port = await listen();
      for (const [t, w] of tokens) if (w.name === name) tokens.delete(t);
      const token = crypto.randomBytes(24).toString('hex');
      tokens.set(token, { name, calls: 0 });
      return { REDNODE_BRIDGE_URL: `http://127.0.0.1:${port}/bridge`, REDNODE_BRIDGE_TOKEN: token };
    },
    /** Ends a name's token, when its server is stopped. */
    revoke(name) {
      for (const [t, w] of tokens) if (w.name === name) tokens.delete(t);
    },
    stop() {
      tokens.clear();
      server?.close();
      server?.closeAllConnections?.();
      server = null;
      listening = null;
    },
  };
}

module.exports = { createBridgeShare };
