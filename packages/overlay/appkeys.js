// Apps' keys: a key the player gives an app in its title bar, which shows only that app with the
// cursor, or hides it again (main.js). This file holds what does not need Electron: the names of
// keys, the game's own key bindings, and the rules for a key the player picks.
//
// The game's bindings come from its own files, read only: r6/config/inputUserMappings.xml (and
// the other input files there), mods' files in r6/input (Input Loader), and the player's
// changes in %LOCALAPPDATA%\CD Projekt Red\Cyberpunk 2077\UserSettings.json, whose
// /key_bindings/* options name the key of each rebindable action ("overridableUI").

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CTRL = 1;
const SHIFT = 2;
const ALT = 4;

// Windows virtual-key codes and the names the player sees.
const VK_NAMES = new Map([
  [0x08, 'Backspace'], [0x09, 'Tab'], [0x0d, 'Enter'], [0x13, 'Pause'], [0x14, 'Caps Lock'], [0x1b, 'Esc'],
  [0x20, 'Space'], [0x21, 'Page Up'], [0x22, 'Page Down'], [0x23, 'End'], [0x24, 'Home'],
  [0x25, 'Left'], [0x26, 'Up'], [0x27, 'Right'], [0x28, 'Down'], [0x2c, 'Print Screen'], [0x2d, 'Insert'], [0x2e, 'Delete'],
  [0x6a, 'Num *'], [0x6b, 'Num +'], [0x6d, 'Num -'], [0x6e, 'Num .'], [0x6f, 'Num /'], [0x90, 'Num Lock'], [0x91, 'Scroll Lock'],
  [0xba, ';'], [0xbb, '='], [0xbc, ','], [0xbd, '-'], [0xbe, '.'], [0xbf, '/'], [0xc0, '`'], [0xdb, '['], [0xdc, '\\'], [0xdd, ']'], [0xde, "'"],
]);
for (let i = 0; i < 26; i++) VK_NAMES.set(0x41 + i, String.fromCharCode(65 + i));
for (let i = 0; i < 10; i++) VK_NAMES.set(0x30 + i, String(i));
for (let i = 0; i < 10; i++) VK_NAMES.set(0x60 + i, `Num ${i}`);
for (let i = 1; i <= 24; i++) VK_NAMES.set(0x6f + i, `F${i}`);

// Modifier keys, and keys a binding never uses on their own (the Windows keys).
const MODIFIER_VKS = new Set([0x10, 0x11, 0x12, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c, 0x5d]);

// The game's key names (IK_*) to virtual keys. Unknown names are ignored.
const IK = new Map([
  ['IK_Backspace', 0x08], ['IK_Tab', 0x09], ['IK_Enter', 0x0d], ['IK_Pause', 0x13], ['IK_CapsLock', 0x14], ['IK_Escape', 0x1b],
  ['IK_Space', 0x20], ['IK_PageUp', 0x21], ['IK_PageDown', 0x22], ['IK_End', 0x23], ['IK_Home', 0x24],
  ['IK_Left', 0x25], ['IK_Up', 0x26], ['IK_Right', 0x27], ['IK_Down', 0x28], ['IK_Insert', 0x2d], ['IK_Delete', 0x2e],
  ['IK_NumStar', 0x6a], ['IK_NumPlus', 0x6b], ['IK_NumMinus', 0x6d], ['IK_NumPeriod', 0x6e], ['IK_NumSlash', 0x6f],
  ['IK_NumLock', 0x90], ['IK_ScrollLock', 0x91],
  ['IK_Shift', 0x10], ['IK_LShift', 0x10], ['IK_RShift', 0x10],
  ['IK_Ctrl', 0x11], ['IK_Control', 0x11], ['IK_LControl', 0x11], ['IK_RControl', 0x11],
  ['IK_Alt', 0x12], ['IK_LAlt', 0x12], ['IK_RAlt', 0x12],
  ['IK_Semicolon', 0xba], ['IK_Equals', 0xbb], ['IK_Comma', 0xbc], ['IK_Minus', 0xbd], ['IK_Period', 0xbe], ['IK_Slash', 0xbf],
  ['IK_Tilde', 0xc0], ['IK_LeftBracket', 0xdb], ['IK_Backslash', 0xdc], ['IK_RightBracket', 0xdd], ['IK_SingleQuote', 0xde],
]);
for (let i = 0; i < 26; i++) IK.set(`IK_${String.fromCharCode(65 + i)}`, 0x41 + i);
for (let i = 0; i < 10; i++) IK.set(`IK_${i}`, 0x30 + i);
for (let i = 0; i < 10; i++) {
  IK.set(`IK_NumPad${i}`, 0x60 + i);
  IK.set(`IK_NumPad_${i}`, 0x60 + i);
}
for (let i = 1; i <= 24; i++) IK.set(`IK_F${i}`, 0x6f + i);

function keyName(key) {
  if (!key) return '';
  const parts = [];
  if (key.mods & CTRL) parts.push('Ctrl');
  if (key.mods & SHIFT) parts.push('Shift');
  if (key.mods & ALT) parts.push('Alt');
  parts.push(VK_NAMES.get(key.vk) ?? `Key ${key.vk}`);
  return parts.join('+');
}

// "crouchHold" -> "crouch hold"; "Crouch_Button" -> "crouch".
function actionName(raw) {
  return String(raw)
    .replace(/_(Button|Axis|Hold|Press|Release)$/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

// ---------- the game's key bindings ----------

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function xmlFiles(dir, out = [], depth = 0) {
  let list;
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) xmlFiles(p, out, depth + 1);
    else if (e.isFile() && /\.xml$/i.test(e.name)) out.push(p);
  }
  return out;
}

function userSettingsFile() {
  const local = process.env.LOCALAPPDATA;
  return local ? path.join(local, 'CD Projekt Red', 'Cyberpunk 2077', 'UserSettings.json') : null;
}

// overridableUI name -> the key the player set (IK_* name), from UserSettings.json.
function playerBindings(file) {
  const text = file && readText(file);
  const out = new Map();
  if (!text) return out;
  try {
    for (const g of JSON.parse(text).data ?? []) {
      if (!String(g.group_name ?? '').startsWith('/key_bindings/')) continue;
      for (const o of g.options ?? []) if (o?.name && typeof o.value === 'string') out.set(o.name, o.value);
    }
  } catch {
    // an unreadable file: the defaults stand
  }
  return out;
}

let cache = null;

// virtual key -> Set of game actions on it; null without a game folder. Cached by the files' times.
function gameBindings(gameDir) {
  if (!gameDir) return null;
  const files = [
    ...['inputUserMappings.xml', 'inputContexts.xml', 'uiInputActions.xml'].map((f) => path.join(gameDir, 'r6', 'config', f)),
    ...xmlFiles(path.join(gameDir, 'r6', 'input')),
  ];
  const settingsFile = userSettingsFile();
  const stamp = [...files, settingsFile]
    .map((f) => {
      try {
        return `${f}:${fs.statSync(f).mtimeMs}`;
      } catch {
        return `${f}:-`;
      }
    })
    .join('|');
  if (cache?.stamp === stamp) return cache.map;
  const player = playerBindings(settingsFile);
  const map = new Map();
  const add = (ik, action) => {
    const vk = IK.get(ik);
    if (vk === undefined) return;
    if (!map.has(vk)) map.set(vk, new Set());
    map.get(vk).add(actionName(action));
  };
  let found = 0;
  for (const file of files) {
    const text = readText(file);
    if (!text) continue;
    found++;
    // Each <mapping name="..."> ... </mapping> (or <context>, <action>): its buttons.
    const blocks = text.split(/<(?:mapping|action|context)\s/i);
    for (const block of blocks) {
      const name = /^[^>]*name="([^"]+)"/.exec(block)?.[1] ?? 'a game action';
      for (const b of block.matchAll(/<button\b([^>]*)>/gi)) {
        const attrs = b[1];
        const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
        if (!id) continue;
        const over = /\boverridableUI="([^"]+)"/.exec(attrs)?.[1];
        // A rebindable action: the player's own key wins over the file's default.
        add(over && player.has(over) ? player.get(over) : id, over ?? name);
      }
    }
  }
  const result = found ? map : null;
  cache = { stamp, map: result };
  return result;
}

// ---------- the rules ----------

const isTyping = (vk) =>
  (vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a) || (vk >= 0x60 && vk <= 0x6f) || (vk >= 0xba && vk <= 0xe2) ||
  [0x08, 0x09, 0x0d, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2e].includes(vk);
const EDIT_LETTERS = new Set([0x41, 0x43, 0x56, 0x58, 0x59, 0x5a]); // A C V X Y Z

/**
 * Checks a key the player picked for an app.
 * @param {{vk: number, mods: number}} key
 * @param {{gameDir?: string|null, others?: {id: string, name: string, key: {vk: number, mods: number}}[]}} o
 * @returns {{name: string, ok: boolean, problem: string|null, notes: string[]}}
 */
function checkAppKey(key, { gameDir = null, others = [] } = {}) {
  const vk = Number(key?.vk) | 0;
  const mods = (Number(key?.mods) | 0) & 7;
  const name = keyName({ vk, mods });
  const refuse = (problem) => ({ name, ok: false, problem, notes: [] });
  if (!vk || MODIFIER_VKS.has(vk)) return refuse('Press a key, holding Ctrl, Shift or Alt with it if you like');
  if (vk === 0x79) return refuse('F10 opens and closes the overlay');
  if (vk === 0x1b) return refuse('Esc gives the game its input back');
  if ((mods & ALT && [0x09, 0x73, 0x1b, 0x20].includes(vk)) || (mods & CTRL && vk === 0x1b)) return refuse(`Windows uses ${name}`);
  if (vk === 0x2c) return refuse('Windows uses Print Screen');
  if (mods & CTRL && vk >= 0x31 && vk <= 0x39) return refuse('Ctrl+1 to 9 switch the overlay\'s spaces');
  if (mods & CTRL && !(mods & ALT) && EDIT_LETTERS.has(vk)) return refuse(`${name} copies, pastes or undoes in text boxes`);
  if (!(mods & (CTRL | ALT)) && isTyping(vk)) {
    return refuse(mods & SHIFT ? `Shift with ${VK_NAMES.get(vk) ?? 'this key'} types text: hold Ctrl or Alt instead` : `${VK_NAMES.get(vk) ?? 'This key'} is needed for typing: hold Ctrl or Alt with it, or pick an F key`);
  }
  const other = others.find((o) => o.key && o.key.vk === vk && ((o.key.mods | 0) & 7) === mods);
  if (other) return refuse(`${name} is already the key of ${other.name}`);
  const game = gameBindings(gameDir);
  const notes = [];
  if (game) {
    const taken = game.get(vk);
    if (taken?.size) return refuse(`The game uses ${VK_NAMES.get(vk) ?? name} for ${[...taken].slice(0, 3).join(', ')}`);
    // The game hears a held Ctrl, Shift or Alt before the key arrives, so it does that too.
    for (const [bit, mvk, label] of [[CTRL, 0x11, 'Ctrl'], [SHIFT, 0x10, 'Shift'], [ALT, 0x12, 'Alt']]) {
      const on = mods & bit ? game.get(mvk) : null;
      if (on?.size) notes.push(`${label} is also ${[...on].slice(0, 2).join(', ')} in the game: holding it does that first`);
    }
  } else {
    notes.push('The game\'s own key bindings could not be read, so they were not checked');
  }
  return { name, ok: true, problem: null, notes };
}

module.exports = { CTRL, SHIFT, ALT, MODIFIER_VKS, keyName, checkAppKey, gameBindings };
