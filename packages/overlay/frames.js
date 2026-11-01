// Input for frames in another process (#31).
//
// The host gives a window its mouse and keys with webContents.sendInputEvent, which reaches
// only the main frame's widget: a frame from another address (or a sandboxed one) runs in a
// process of its own, and Chromium does not route injected input on into it. For a window
// that has such a frame, this sends the input through DevTools instead: the window's debugger
// attaches every frame target (Target.setAutoAttach, flatten), a press finds the frame under
// the point (DOM.getNodeForLocation, then the frame's content box with its transforms) and
// gets Input.dispatchMouseEvent on that frame's own session, at the point mapped into it.
// Input there is real input (isTrusted): hover, focus, selection and pointer capture work.
//
// A window with no frame in another process is never touched: its input stays on
// sendInputEvent. Everything for a window with one goes through one queue, so the order holds;
// moves waiting in it are merged into the newest.

'use strict';

const NESTING = 4; // frame levels followed into
const CACHE_MS = 400; // how long a move reuses the last frame found under the cursor
const BUTTON_BITS = { left: 1, right: 2, middle: 4 };
// Key names as DevTools wants them, by Windows virtual key.
const KEYS = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Control', 18: 'Alt', 27: 'Escape', 32: ' ',
  33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
  46: 'Delete',
};

/** True when a window's page has a frame running in another process than its own. */
function hasRemoteFrames(wc) {
  try {
    const main = wc.mainFrame;
    return main.framesInSubtree.some((f) => f !== main && f.processId !== main.processId);
  } catch {
    return false;
  }
}

/** The frame point for a page point: the frame's content quad (four corners, clockwise from top-left) onto its viewport. */
function mapper(quad, width, height) {
  const [x0, y0, x1, y1, , , x3, y3] = quad;
  const ex = [x1 - x0, y1 - y0];
  const ey = [x3 - x0, y3 - y0];
  const lx = ex[0] * ex[0] + ex[1] * ex[1] || 1;
  const ly = ey[0] * ey[0] + ey[1] * ey[1] || 1;
  const uv = (x, y) => [((x - x0) * ex[0] + (y - y0) * ex[1]) / lx, ((x - x0) * ey[0] + (y - y0) * ey[1]) / ly];
  return {
    inside: (x, y) => {
      const [u, v] = uv(x, y);
      return u >= 0 && u <= 1 && v >= 0 && v <= 1;
    },
    map: (x, y) => {
      const [u, v] = uv(x, y);
      return [u * width, v * height];
    },
  };
}

/**
 * The router for one window. `log` writes to the host log.
 * Returns null when the window has no frame in another process.
 */
function createRouter(wc, log) {
  const dbg = wc.debugger;
  const sessions = new Map(); // frame (target) id -> session id
  let attached = false;
  let failed = false;
  let queue = Promise.resolve();
  let pendingMove = null; // a move waiting in the queue, replaced by newer ones
  let press = null; // the frame target a button went down in, until it comes up
  let hover = null; // the frame target under the cursor, with the time it was found
  let focus = null; // the frame target that gets keys: the one clicked last

  const send = (method, params, sessionId) => dbg.sendCommand(method, params ?? {}, sessionId);

  function onMessage(_event, method, params, sessionId) {
    if (method === 'Target.attachedToTarget') {
      const info = params.targetInfo ?? {};
      sessions.set(info.targetId, params.sessionId);
      // Frames inside that frame are attached too.
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, params.sessionId).catch(() => {});
    } else if (method === 'Target.detachedFromTarget') {
      for (const [id, s] of sessions) if (s === params.sessionId) sessions.delete(id);
      for (const t of [press, hover, focus]) if (t && t.session === params.sessionId) t.gone = true;
    }
    void sessionId;
  }

  async function attach() {
    if (attached || failed) return attached;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      dbg.on('message', onMessage);
      dbg.on('detach', () => {
        attached = false;
        sessions.clear();
      });
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      attached = true;
      log(`Frames: this window has a frame in another process; its input goes through DevTools (#31)`);
    } catch (err) {
      failed = true;
      log(`Frames: could not attach DevTools for input into frames, so they get none: ${err.message}`);
    }
    return attached;
  }

  // The innermost frame in another process under a page point, with the mapping from page
  // points to that frame's points; null over the page itself (or a frame in its process).
  async function locate(x, y) {
    let session;
    let px = x;
    let py = y;
    const maps = [];
    let outer = null;
    for (let depth = 0; depth < NESTING; depth++) {
      // No node there (off the document, or a page still loading): whoever holds the point so far gets it.
      const hit = await send('DOM.getNodeForLocation', { x: Math.round(px), y: Math.round(py), ignorePointerEventsNone: true }, session).catch(() => null);
      if (!hit) break;
      const { node } = await send('DOM.describeNode', { backendNodeId: hit.backendNodeId }, session);
      if (!node || !/^(IFRAME|FRAME)$/i.test(node.nodeName) || !node.frameId) break;
      const child = sessions.get(node.frameId);
      if (!child) break; // a frame in the same process: sendInputEvent reaches it
      const { model } = await send('DOM.getBoxModel', { backendNodeId: hit.backendNodeId }, session);
      const metrics = await send('Page.getLayoutMetrics', {}, child);
      const vp = metrics.cssLayoutViewport ?? metrics.layoutViewport;
      const m = mapper(model.content, vp.clientWidth, vp.clientHeight);
      if (!outer) outer = m;
      maps.push(m);
      [px, py] = m.map(px, py);
      session = child;
    }
    if (!session) return null;
    return {
      session,
      outer,
      at: Date.now(),
      map: (x2, y2) => maps.reduce(([a, b], m) => m.map(a, b), [x2, y2]),
    };
  }

  async function target(x, y) {
    if (hover && !hover.gone && Date.now() - hover.at < CACHE_MS && hover.outer.inside(x, y)) return hover;
    return locate(x, y);
  }

  function mouseEvent(t, type, m, buttons, extra) {
    const [x, y] = t.map(m.x, m.y);
    return send('Input.dispatchMouseEvent', { type, x, y, buttons, ...extra }, t.session);
  }

  const bits = (held) => [...held].reduce((sum, b) => sum | (BUTTON_BITS[b] ?? 0), 0);
  // A move names the button held, as a real one does: with "none", Chromium starts no drag (a slider's thumb stays).
  const moveButton = (held) => [...held][0] ?? 'none';

  // A move that leaves a frame: one more move to it, outside its viewport, so it sees the cursor go.
  async function leave(t) {
    if (!t || t.gone) return;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -1, y: -1, buttons: 0 }, t.session).catch(() => {});
  }

  /**
   * One mouse event. True when it went to a frame; false when the page itself should get it
   * (by sendInputEvent). `held` is the window's set of held buttons, already updated.
   */
  async function mouse(m, held) {
    if (!(await attach())) return false;
    const buttons = bits(held);
    if (m.type === 'mouseDown') {
      const t = await locate(m.x, m.y);
      press = t;
      focus = t;
      if (!t) return false;
      await mouseEvent(t, 'mousePressed', m, buttons, { button: m.button, clickCount: 1 });
      return true;
    }
    if (press && !press.gone && (m.type === 'mouseMove' || m.type === 'mouseUp')) {
      const t = press;
      if (m.type === 'mouseUp') {
        if (held.size === 0) press = null;
        await mouseEvent(t, 'mouseReleased', m, buttons, { button: m.button, clickCount: 1 });
      } else {
        await mouseEvent(t, 'mouseMoved', m, buttons, { button: moveButton(held) });
      }
      return true;
    }
    if (m.type === 'mouseUp') {
      press = null;
      return false;
    }
    if (m.type === 'mouseLeave') {
      await leave(hover);
      hover = null;
      return false;
    }
    if (m.type === 'mouseMove' || m.type === 'mouseWheel') {
      const t = await target(m.x, m.y);
      if (hover && (!t || hover.session !== t.session)) await leave(hover);
      hover = t;
      if (!t) return false;
      if (m.type === 'mouseWheel') {
        // The plugin's delta is Windows': positive for a turn away from the player, which scrolls up.
        await mouseEvent(t, 'mouseWheel', m, buttons, { button: 'none', deltaX: 0, deltaY: -Number(m.delta || 0) });
      } else {
        await mouseEvent(t, 'mouseMoved', m, buttons, { button: 'none' });
      }
      return true;
    }
    return false;
  }

  /** A key for the frame clicked last; false when there is none (the page gets it). */
  async function key(type, vk, modifiers) {
    if (!focus || focus.gone || !attached) return false;
    const name = KEYS[vk] ?? (vk >= 0x30 && vk <= 0x5a ? String.fromCharCode(vk).toLowerCase() : '');
    const mods = (modifiers.includes('alt') ? 1 : 0) | (modifiers.includes('control') ? 2 : 0) | (modifiers.includes('shift') ? 8 : 0);
    const params = { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, key: name, modifiers: mods };
    if (type === 'keyDown') {
      // Enter needs its text to submit or break a line; other keys type through char.
      if (vk === 13) await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...params }, focus.session);
      else await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params }, focus.session);
    } else {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }, focus.session);
    }
    return true;
  }

  /** A typed character for the frame clicked last; false when there is none. */
  async function char(code) {
    if (!focus || focus.gone || !attached) return false;
    const text = String.fromCharCode(code);
    await send('Input.dispatchKeyEvent', { type: 'char', text, unmodifiedText: text }, focus.session);
    return true;
  }

  /** Queues one input message; `run` handles it (and may call mouse, key and char above). */
  function push(m, run) {
    if (m.type === 'mouseMove' && pendingMove) {
      pendingMove.m = m; // merged: only the newest position matters
      return;
    }
    const item = { m };
    if (m.type === 'mouseMove') pendingMove = item;
    queue = queue
      .then(() => {
        if (pendingMove === item) pendingMove = null;
        return run(item.m);
      })
      .catch((err) => log(`Frames: input failed: ${err.message}`));
  }

  function dispose() {
    try {
      dbg.off('message', onMessage);
      if (attached && dbg.isAttached()) dbg.detach();
    } catch {
      // the window is gone
    }
  }

  return { mouse, key, char, push, dispose, active: () => !failed };
}

module.exports = { hasRemoteFrames, createRouter, mapper };
