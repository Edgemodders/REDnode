// The editor channel (#17): how tools on the player's PC, such as EDGEwave in VS Code,
// reach the running game without the MCP server or a token the player copies.
//
// While the host runs it serves a few calls on its own port, on 127.0.0.1 only, and
// writes %LOCALAPPDATA%\REDnode\editor.json with { port, token, version, pid }. A tool
// reads that file (only the player's own processes can) and sends the token with each
// call. The token is new each run. The host removes the file when it quits by itself;
// when the game ends, Windows ends the host at once (the plugin's job object) and the
// file stays, so a tool checks that `pid` runs, or takes a refused connection as no game.
//
//   GET  /editor/info          { version, connected }
//   POST /editor/sound.play    { name, on? }        -> { ok, playingId, on, note }
//   POST /editor/sound.stop    { playingId? }       -> { ok, stopped }   (all when none)
//
// Try Live (#44), for a tool that changes the game while the player plays, such as EDGEhack.
// `editor` names the tool as the player sees it. Its first change waits for the player's Allow
// in REDnode's Editor request window (up to 5 minutes); Allow and Deny last until the host
// restarts. Its TweakDB changes are undone by tweakdb.reset, and when the host stops.
//
//   POST /editor/tweakdb.apply     { editor, label?, ops }  -> { ok, applied, failed?: { index, reason } }
//        ops in order: { clone, base } | { create, type } | { set, value, type? } | { append, values }
//   POST /editor/tweakdb.reset     { editor }               -> { ok, restored }
//   POST /editor/quickhacks.refresh { editor }              -> { ok }   V's cached quickhack list cleared
//   POST /editor/player.give       { editor, item, count? } -> { ok }
//
// Errors answer { ok: false, reason }. The sound calls cannot change the game's files or its
// state; the Try Live calls change TweakDB (never a file) once the player allows it.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MAX_BODY = 16 * 1024;
// tweakdb.apply carries a quickhack's records: a few hundred flats.
const MAX_APPLY_BODY = 2 * 1024 * 1024;

/**
 * @param {object} host
 * @param {(...args: string[]) => void} host.log
 * @param {string} host.version
 * @param {() => boolean} host.connected                  whether the game is linked
 * @param {(method: string, params: object) => Promise<any>} host.bridgeCall
 * @param {string} [host.file]                            where editor.json goes
 * @param {object} [host.tryLive]                         Try Live (#44): ask, apply, reset, refreshQuickhacks, give
 */
function createEditor(host) {
  const file = host.file ?? path.join(process.env.LOCALAPPDATA ?? path.join(require('node:os').homedir(), 'AppData', 'Local'), 'REDnode', 'editor.json');
  const token = crypto.randomBytes(24).toString('base64url');
  let server = null;
  let port = 0;
  let nextId = 1;
  const playing = new Map(); // playingId -> { name, on }

  const send = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const fail = (res, status, reason) => send(res, status, { ok: false, reason });

  async function readBody(req, max = MAX_BODY) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > max) throw new Error('The request is too large');
      chunks.push(c);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }

  async function play(params) {
    const name = String(params.name ?? '').trim();
    if (!name) return [400, { ok: false, reason: 'Name a sound event, such as "ui_menu_onpress"' }];
    // On V by default, so positional sounds are heard; the plugin falls back to none
    // when there is no player (the main menu).
    const on = params.on === 'none' ? 'none' : 'player';
    const r = await host.bridgeCall('audio.play', { name, on });
    const playingId = nextId++;
    playing.set(playingId, { name, on: r?.on ?? on });
    host.log(`Editor: played the sound event ${name} (${r?.on ?? on})`);
    return [200, { ok: true, playingId, on: r?.on ?? on, note: 'The game plays nothing for a name it does not know, and does not say so' }];
  }

  async function stop(params) {
    const ids = params.playingId === undefined ? [...playing.keys()] : [Number(params.playingId)];
    let stopped = 0;
    for (const id of ids) {
      const p = playing.get(id);
      if (!p) continue;
      playing.delete(id);
      await host.bridgeCall('audio.stopEvent', { name: p.name, on: p.on });
      stopped++;
    }
    if (params.playingId !== undefined && !stopped) return [404, { ok: false, reason: `No sound playing with id ${params.playingId}` }];
    return [200, { ok: true, stopped }];
  }

  // Try Live (#44): each call names its editor, which the player must have allowed.
  const editorOf = (params) => {
    const name = String(params.editor ?? '').trim();
    if (!name || name.length > 40) throw new Error('Name your tool in "editor", such as "EDGEhack"');
    return name;
  };
  const live = (fn) => async (params) => {
    if (!host.tryLive) return [404, { ok: false, reason: 'Try Live is not available in this REDnode' }];
    let editor;
    try {
      editor = editorOf(params);
    } catch (err) {
      return [400, { ok: false, reason: err.message }];
    }
    const refused = await host.tryLive.ask(editor, typeof params.label === 'string' ? params.label.slice(0, 80) : '');
    if (refused) return [403, { ok: false, reason: refused }];
    return fn(editor, params);
  };
  const apply = live(async (editor, params) => {
    if (!Array.isArray(params.ops) || !params.ops.length) return [400, { ok: false, reason: 'Send the changes in "ops", a list' }];
    const r = await host.tryLive.apply(editor, params.ops);
    return [r.ok ? 200 : 422, r];
  });
  const reset = live(async (editor) => [200, await host.tryLive.reset(editor)]);
  const refresh = live(async () => [200, await host.tryLive.refreshQuickhacks()]);
  const give = live(async (editor, params) => {
    const item = String(params.item ?? '').trim();
    if (!item) return [400, { ok: false, reason: 'Name the item in "item", such as "Items.OverheatLvl2Program"' }];
    const count = Math.max(1, Math.min(100, Math.trunc(Number(params.count ?? 1)) || 1));
    return [200, await host.tryLive.give(editor, item, count)];
  });

  async function handle(req, res) {
    // Only this server's own name, and no web page: a browser sends an Origin.
    const here = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!here.includes(req.headers.host ?? '') || req.headers.origin) return fail(res, 403, 'Not allowed');
    const url = new URL(req.url, 'http://localhost');
    const auth = req.headers.authorization ?? '';
    const given = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    const wanted = Buffer.from(token);
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
      return fail(res, 401, 'Send the token from editor.json as "Authorization: Bearer <token>"');
    }
    if (url.pathname === '/editor/info' && req.method === 'GET') {
      return send(res, 200, { ok: true, version: host.version, connected: host.connected() });
    }
    const call = {
      '/editor/sound.play': play,
      '/editor/sound.stop': stop,
      '/editor/tweakdb.apply': apply,
      '/editor/tweakdb.reset': reset,
      '/editor/quickhacks.refresh': refresh,
      '/editor/player.give': give,
    }[url.pathname];
    if (!call) return fail(res, 404, `No call ${url.pathname}`);
    if (req.method !== 'POST') return fail(res, 405, 'Use POST');
    let params;
    try {
      params = await readBody(req, url.pathname === '/editor/tweakdb.apply' ? MAX_APPLY_BODY : MAX_BODY);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('The body is a JSON object');
    } catch (err) {
      return fail(res, 400, err.message);
    }
    if (!host.connected()) return fail(res, 409, 'The game is not running with REDnode');
    try {
      const [status, body] = await call(params);
      send(res, status, body);
    } catch (err) {
      fail(res, 500, err.message);
    }
  }

  function writeFile() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ port, token, version: host.version, pid: process.pid }, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      host.log(`Editor: could not write ${file}: ${err.message}`);
    }
  }

  return {
    file,
    /** Serves the calls on a free port and writes editor.json. */
    start() {
      if (server) return;
      server = http.createServer((req, res) => {
        handle(req, res).catch((err) => {
          if (!res.headersSent) fail(res, 500, err.message);
        });
      });
      server.on('error', (err) => {
        host.log(`Editor channel could not start: ${err.message}`);
        server = null;
      });
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        writeFile();
        host.log(`Editor channel on http://127.0.0.1:${port}/editor (${file})`);
      });
    },
    /** Stops what editors started, the server, and removes editor.json if it is still this run's. */
    stop() {
      if (host.connected()) for (const p of playing.values()) host.bridgeCall('audio.stopEvent', { name: p.name, on: p.on }).catch(() => {});
      playing.clear();
      server?.close();
      server = null;
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.rmSync(file);
      } catch {
        // gone already, or another host's
      }
    },
  };
}

module.exports = { createEditor };
