// REDnode overlay host and Tier 2 runtime. See docs/overlay.md and README.md.
//
// Finds packages (folders with a rednode-app.json manifest). A package can be
// an overlay app ("entry", an HTML page), a Node mod ("main", Node code), or
// both. Apps are rendered off-screen with Chromium and their frames streamed
// to the REDnode plugin in the game over a named pipe. The plugin owns window
// placement, focus and dragging; the host replays the plugin's input into the
// right page. Node mods run in mod processes (mods.js, runtime/). Apps and mods
// call the game through the same rednode package, served as rednode://sdk/.
//
// Developers:
//   npm run overlay                          # off-screen, streams to the game
//   npm run overlay -- --window              # normal desktop windows, without the game
//   npm run overlay -- --apps=demo,signal    # open exactly these apps this time
//   npm run overlay -- --hot-reload=off      # do not restart mods when their files change
//   npm run overlay -- --data-dir=<folder>   # settings and positions somewhere else, for tests
//   npm run overlay -- --mcp=on|off          # the kernel MCP server for AI agents (mcp.js)
// Players: the plugin starts the packaged host with the game:
//   REDnode-overlay.exe --apps-dir=<plugin>\apps --parent-pid=<game> --log=<file>

'use strict';

const { app, BrowserWindow, clipboard, ipcMain, nativeImage, protocol, safeStorage, utilityProcess } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { createMods } = require('./mods');
const { createMcp } = require('./mcp');
const { createServices } = require('./services');
const { scanGame, checkRequires, validRange, key: gamefilesKey } = require('./gamefiles');
const { createRedbridge, findRedbridge, compareVersions, NOT_INSTALLED } = require('./redbridge');
const bridgeInstall = require('./bridge-install');
const { createLookup } = require('./gameapi-lookup');
const { soundPaksIn, hotToolsLookupMisses } = require('./archive-index');
const { gameSoundWav, eventSounds, soundIndex: gameSoundIndex } = require('./game-sounds');
const crypto = require('node:crypto');

// REDNODE_OVERLAY_PIPE lets tests use a private pipe instead of the game's.
const PIPE = process.env.REDNODE_OVERLAY_PIPE || '\\\\.\\pipe\\rednode-overlay';
const FPS = 60;
const TYPE_FRAME = 1;
const TYPE_JSON = 2;
const TYPE_RECT = 4; // only the changed part of a window
const TYPE_SHARED = 5; // a GPU texture handle instead of pixels
const VERSION = require('./package.json').version;

// ---------- command line ----------

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const windowed = process.argv.includes('--window');
const chosenApps = arg('apps')?.split(',').filter(Boolean) ?? null;
const parentPid = Number(arg('parent-pid')) || null;
const logFile = arg('log') ?? null;
// Render path: 'gpu' shares Chromium's textures with the game, 'cpu' copies pixels.
// --render overrides the setting saved by the launcher.
const renderArg = arg('render');

// Where apps are found: the apps built into the host, the player's development folders,
// then the apps folder. Packaged, the plugin passes the game's apps folder; in the repo it
// is ./apps. Built-in apps may use host-only calls. The launcher is pinned: always open,
// not listed. The first copy of a package id found wins, so a development copy runs
// instead of the installed one.
const BUILTIN_ROOTS = [
  { dir: path.join(__dirname, 'launcher'), single: true, builtin: true, pinned: true },
  { dir: path.join(__dirname, 'modlog'), single: true, builtin: true },
  { dir: path.join(__dirname, 'manager'), single: true, builtin: true, manager: true },
  // The Welcome window: opened at the first start, until the player closes it once.
  { dir: path.join(__dirname, 'welcome'), single: true, builtin: true },
];
// --apps-dir may list several folders, separated by ";", for example REDnode's
// examples and another repo's packages during development.
const INSTALLED_ROOTS = (arg('apps-dir') ?? path.join(__dirname, 'apps'))
  .split(';')
  .filter(Boolean)
  .map((dir) => ({ dir }));
const APP_ROOTS = [...BUILTIN_ROOTS, ...INSTALLED_ROOTS];

// ---------- development folders (#16) ----------
//
// Folders in the modder's own projects that REDnode also scans and watches, with hot
// reload, kept in settings.devFolders. A folder is a package itself (it holds
// rednode-app.json) or holds packages, as the apps folder does. They are set from the
// launcher's Settings drawer (Developer mode) and take effect at once.

function devFolders() {
  return Array.isArray(settings.devFolders) ? settings.devFolders.filter((d) => typeof d === 'string') : [];
}

function setRoots() {
  APP_ROOTS.splice(0, APP_ROOTS.length, ...BUILTIN_ROOTS, ...devFolders().map((dir) => ({ dir, dev: true })), ...INSTALLED_ROOTS);
}

// The package folders a root holds: itself when it is a package, else its subfolders.
function packageDirsOf(root) {
  if (root.single) return [root.dir];
  if (!fs.existsSync(root.dir)) return [];
  if (fs.existsSync(path.join(root.dir, 'rednode-app.json'))) return [root.dir];
  return fs.readdirSync(root.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root.dir, d.name));
}

// Copies of a package that another copy hides: id -> [folders], for the Mod Manager.
const hiddenCopies = new Map();
const reportedHidden = new Set(); // "id|folder", so each is logged once
function noteHidden(id, dir, by) {
  if (!hiddenCopies.has(id)) hiddenCopies.set(id, []);
  if (!hiddenCopies.get(id).includes(dir)) hiddenCopies.get(id).push(dir);
  const key = `${id}|${dir}`;
  if (!reportedHidden.has(key)) {
    reportedHidden.add(key);
    log(`Skipped ${dir}: package "${id}" is already loaded from ${by}`);
  }
}

// Checks a folder the player adds: a full path to a folder that exists, not one REDnode
// already watches. Windows' Copy as path adds quotes; they are dropped.
function checkDevFolder(input) {
  const dir = path.resolve(String(input ?? '').trim().replace(/^"(.*)"$/, '$1'));
  if (!String(input ?? '').trim() || !path.isAbsolute(String(input).trim().replace(/^"(.*)"$/, '$1'))) {
    throw new Error('Give the full path of a folder, such as E:\\Modding\\MyMod');
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`No folder at ${dir}`);
  const same = (a, b) => path.relative(a, b) === '' || (!path.relative(a, b).startsWith('..') && !path.isAbsolute(path.relative(a, b)));
  for (const root of [...INSTALLED_ROOTS, ...devFolders().map((d) => ({ dir: d }))]) {
    if (same(root.dir, dir)) throw new Error(`REDnode already watches ${dir}${root.dir !== dir ? ` (it is inside ${root.dir})` : ''}`);
  }
  return dir;
}

function devFolderList() {
  return devFolders().map((dir) => {
    const exists = fs.existsSync(dir);
    const packages = exists ? packageDirsOf({ dir }).filter((d) => fs.existsSync(path.join(d, 'rednode-app.json'))).length : 0;
    return { dir, exists, packages };
  });
}

// Adds or removes a folder, then looks at every folder again: the packages there start,
// and a development copy takes over from its installed copy (or hands back to it).
function changeDevFolders(op, input) {
  const list = devFolders();
  if (op === 'add') {
    const dir = checkDevFolder(input);
    settings.devFolders = [...list, dir];
    log(`Development folder added: ${dir}`);
  } else if (op === 'remove') {
    const dir = String(input ?? '');
    if (!list.includes(dir)) throw new Error(`Not a development folder: ${dir}`);
    settings.devFolders = list.filter((d) => d !== dir);
    log(`Development folder removed: ${dir}`);
  } else return devFolderList();
  writeJson('settings.json', settings);
  setRoots();
  rewatchAppRoots();
  rescanApps();
  return devFolderList();
}
// What a package may ask for in its manifest's "permissions"; the player grants each in the launcher.
const PERMISSIONS = {
  mcp: "REDnode's tools for AI agents (the kernel MCP server)",
  agent: 'questions to the AI assistant (REDagent); each answer costs you a little',
  bridge: "REDbridge, WolvenKit's engine: reads the game's archives and files, and can write files where the package asks",
  front: "staying above other packages' windows, with REDnode's own tools",
  solo: "hiding every other package's windows while it asks (solo mode)",
  archives: "swapping archives in the game's mod folder while the game runs (hot-loading, through RED Hot Tools)",
  // The Admin Tools pack (Task Manager, Tools Manager) and other admin packages: the
  // host's tasks and tools calls (fromAdmin). The Mod Manager and launcher show a warning under it.
  admin: "managing REDnode: what every package costs, ending or restarting any package, and switching AI assistants' tools on and off",
};
// What a package may offer other packages in its manifest's "provides".
const PROVIDES = ['agent'];
// The UI kit, served to every app as rednode://ui/rednode-ui.js.
const UI_DIR = app.isPackaged ? path.join(__dirname, 'ui') : path.join(__dirname, '..', 'ui', 'src');
// The rednode package (built from packages/rednode), served to apps as rednode://sdk/index.js
// and loaded by mods for `import ... from "rednode"`. Packaged, it and the mod runtime sit
// outside app.asar, in resources/, so worker threads can load them as normal files.
const SDK_DIR = app.isPackaged ? path.join(process.resourcesPath, 'sdk') : path.join(__dirname, '..', 'rednode', 'dist');
const RUNTIME_DIR = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'runtime');
// The page that shows windows built by Node mods.
const BUILDER_DIR = path.join(__dirname, 'builder');
// Restart a mod, or reload an app's page, when its files change. On for developers;
// for players a launcher switch, off by default. --hot-reload=on|off overrides both.
const hotReloadArg = arg('hot-reload');
// The kernel MCP server (mcp.js): on for developers; for players a launcher switch,
// off by default. --mcp=on|off overrides both.
const mcpArg = arg('mcp');
const MCP_PORT = 41820;
// Game API types and notes for gameapi_lookup. Packaged, they sit in resources/gameapi.
const GAMEAPI_DIR = app.isPackaged ? path.join(process.resourcesPath, 'gameapi') : null;
const TYPES_FILE = GAMEAPI_DIR
  ? path.join(GAMEAPI_DIR, 'game.d.ts')
  : path.join(__dirname, '..', 'rednode', 'src', 'generated', 'game.d.ts');
const NOTES_DIR = GAMEAPI_DIR ? path.join(GAMEAPI_DIR, 'notes') : path.join(__dirname, '..', '..', 'gameapi', 'notes');

// ---------- logging ----------

function log(...args) {
  const line = `${new Date().toTimeString().slice(0, 8)} ${args.join(' ')}`; // local time, like the player's clock
  console.log(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${line}\n`);
    } catch {
      // the log is best effort
    }
  }
}

// ---------- one host at a time ----------

// --data-dir keeps settings, positions and the single-instance lock in another
// folder, so a test host can run beside a player's.
if (arg('data-dir')) app.setPath('userData', path.resolve(arg('data-dir')));

if (!app.requestSingleInstanceLock()) {
  log('Another REDnode overlay host is already running. Exiting.');
  app.exit(0);
  return; // CommonJS allows a top-level return: nothing below runs
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'rednode', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
// Page pixels must match frame pixels, whatever the desktop scaling is.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ---------- state ----------

let socket = null;
let connected = false;
let mode = 'passive';
let writable = true;
// window id -> { image, dirty } waiting for the pipe: the newest image and the
// union of every area that changed since the last send.
const pendingFrames = new Map();
let frames = 0;
let bytes = 0;

const pending = new Map(); // request id -> { resolve, reject, timer }
let nextRequestId = 1;

// What the game shows, from the plugin's ui-state events. Sent to apps and mods as
// {event: 'state'} whenever it, the link or the overlay mode changes.
let uiState = { menu: false, photoMode: false, scene: false, mainMenu: false };
let lastStateJson = '';

/** Node mods (mods.js), created when the app is ready. */
let mods = null;
let services = null; // the service router (SV1), services.js
/** The kernel MCP server (mcp.js), created when the app is ready. */
let mcp = null;
/** The plugin's newest perf report, for the MCP perf tool. */
let lastGamePerf = null;
/** Windows built by Node mods, by key '<mod id>~<window id>': { modId, win, spec } */
const built = new Map();
let hotReload = false;
const watchers = new Map(); // package id -> fs.FSWatcher

/** Installed apps by id: { manifest, dir, builtin, pinned } */
const apps = new Map();
/** Open windows by window id: { id, app, win, dragRegions } */
const windows = new Map();
/** Frames sent per window since the last perf report. */
const windowStats = new Map();
let nextWindowId = 1;

// ---------- settings and saved positions (in the host's user data folder) ----------

const dataFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}
const writers = new Map();
function writeJson(name, value) {
  clearTimeout(writers.get(name));
  writers.set(
    name,
    setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(dataFile(name)), { recursive: true });
        fs.writeFileSync(dataFile(name), JSON.stringify(value, null, 2));
      } catch (err) {
        log(`Could not save ${name}: ${err.message}`);
      }
    }, 300),
  );
}
let positions = {};
let settings = { apps: {} }; // apps: { [id]: { open, shared } }, renderPath: 'gpu' | 'cpu', hotReload, theme
// UI kit themes the player can pick in the launcher. Every page using the kit follows it.
const THEMES = ['rednode', 'hud', 'edge'];
// Renamed on 2026-10-13: "game" is now HUD red ("hud"), "yellow" is EDGE ("edge").
const OLD_THEMES = { game: 'hud', yellow: 'edge' };
const themeName = (name) => OLD_THEMES[name] ?? name;
const theme = () => (THEMES.includes(themeName(settings.theme)) ? themeName(settings.theme) : 'rednode');
let renderPath = 'gpu';

// GPU-shared frames the game has not finished with yet: frame id -> { texture, windowId, at }.
const sharedFrames = new Map();
let nextFrameId = 1;

// ---------- app discovery ----------

const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
// Game states a window can hide with (manifest hideWith). The plugin reads them from the game.
const HIDE_WITH = ['menu', 'photo-mode', 'scene', 'main-menu'];

// The audio files the Sound API plays (sound.play, a manifest's "sounds").
const SOUND_TYPES = new Set(['.wav', '.ogg', '.mp3', '.flac']);

function readManifest(dir) {
  const file = path.join(dir, 'rednode-app.json');
  if (!fs.existsSync(file)) return null;
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`);
  }
  const problems = [];
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(m.id)) problems.push('id must be lowercase letters, digits, - or _');
  if (m.entry === undefined && m.main === undefined && m.service === undefined) {
    problems.push('needs "entry" (an HTML page), "main" (Node code), "service" (functions for other packages) or more than one');
  }
  if (m.entry !== undefined && (typeof m.entry !== 'string' || !fs.existsSync(path.join(dir, m.entry)))) {
    problems.push(`entry "${m.entry}" not found`);
  }
  if (m.main !== undefined && (typeof m.main !== 'string' || !fs.existsSync(path.join(dir, m.main)))) {
    problems.push(`main "${m.main}" not found`);
  }
  if (m.service !== undefined) {
    if (typeof m.service !== 'string' || !fs.existsSync(path.join(dir, m.service))) problems.push(`service "${m.service}" not found`);
    else if (!/\.(mjs|js)$/i.test(m.service)) problems.push('service must be a .mjs or .js module');
  }
  if (m.entry !== undefined) {
    for (const k of ['width', 'height']) {
      if (!Number.isInteger(m[k]) || m[k] < 1 || m[k] > 4096) problems.push(`${k} must be a whole number from 1 to 4096`);
    }
  }
  if (m.isolation !== undefined && !['process', 'any'].includes(m.isolation)) problems.push('isolation must be process or any');
  if (m.permissions !== undefined && (!Array.isArray(m.permissions) || m.permissions.some((p) => !(p in PERMISSIONS)))) {
    problems.push(`permissions must be a list of ${Object.keys(PERMISSIONS).join(', ')}`);
  }
  if (m.provides !== undefined && (!Array.isArray(m.provides) || m.provides.some((p) => !PROVIDES.includes(p)))) {
    problems.push(`provides must be a list of ${PROVIDES.join(', ')}`);
  }
  if (m.anchor !== undefined && !ANCHORS.includes(m.anchor)) problems.push(`anchor must be one of ${ANCHORS.join(', ')}`);
  if (m.kind !== undefined && !['window', 'hud'].includes(m.kind)) problems.push('kind must be window or hud');
  if (m.hideWith !== undefined && (!Array.isArray(m.hideWith) || m.hideWith.some((h) => !HIDE_WITH.includes(h)))) {
    problems.push(`hideWith must be a list of ${HIDE_WITH.join(', ')}`);
  }
  if (m.requires !== undefined) {
    if (typeof m.requires !== 'object' || m.requires === null || Array.isArray(m.requires)) {
      problems.push('requires must be an object of names and version ranges, such as { "codeware": ">=1.16" }');
    } else {
      for (const [name, range] of Object.entries(m.requires)) {
        if (!validRange(range)) problems.push(`requires "${name}": "${range}" is not a version range (such as ">=1.16", "^1.2" or "*")`);
      }
    }
  }
  if (m.sounds !== undefined) {
    if (typeof m.sounds !== 'object' || m.sounds === null || Array.isArray(m.sounds)) {
      problems.push('sounds must be an object of names and files, such as { "alarm": "sounds/alarm.ogg" }');
    } else {
      for (const [name, s] of Object.entries(m.sounds)) {
        const f = typeof s === 'string' ? s : s?.file;
        if (typeof f !== 'string') problems.push(`sounds "${name}" needs a file`);
        else if (!SOUND_TYPES.has(path.extname(f).toLowerCase())) problems.push(`sounds "${name}": ${f} is not .wav, .ogg, .mp3 or .flac`);
        else if (!fs.existsSync(path.join(dir, f))) problems.push(`sounds "${name}": ${f} not found`);
      }
    }
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    version: typeof m.version === 'string' ? m.version : '',
    author: typeof m.author === 'string' ? m.author : '',
    description: typeof m.description === 'string' ? m.description : '',
    entry: m.entry ?? null,
    main: m.main ?? null,
    service: m.service ?? null,
    isolation: m.isolation ?? 'any',
    permissions: m.permissions ?? [],
    provides: m.provides ?? [],
    kind: m.kind ?? 'window',
    sounds: m.sounds ?? {},
    width: m.width,
    height: m.height,
    anchor: m.anchor ?? 'top-left',
    x: Number(m.x) || 0,
    y: Number(m.y) || 0,
    hideWith: m.hideWith ?? [],
    requires: m.requires ?? {},
    open: m.open !== false,
  };
}

/** What the Mod Manager shows of a package's service: each function, described (SV2). */
function serviceSummary(id, file) {
  const offer = services?.offer(id);
  if (!offer) return { file, ready: false, functions: [] };
  return {
    file,
    ready: true,
    functions: offer.functions.map((name) => {
      const f = offer.descriptor?.functions?.[name];
      return {
        name,
        description: f?.description ?? '',
        params: (f?.params ?? []).map((p) => ({ name: p.name, type: p.type, optional: p.optional, description: p.description })),
        returns: f?.returns?.type ?? null,
        tool: !!f?.tool,
        readonly: !!f?.readonly,
        checked: !!f?.checked,
        deprecated: f?.deprecated ?? null,
      };
    }),
    events: Object.keys(offer.descriptor?.events ?? {}),
  };
}

/** Whether a package runs a Node mod: it has a main, a service file (SV1) or both. */
const isMod = (m) => !!(m.main || m.service);

// ---------- what the game has installed (W2: "requires") ----------

// The game folder: the packaged host sits in <game>/red4ext/plugins/REDnode/host.
// Started by hand, --game=<folder> or REDNODE_GAME_DIR, else the default Steam path.
const GAME_DIR = (() => {
  const given = arg('game') ?? process.env.REDNODE_GAME_DIR;
  if (given) return given;
  if (app.isPackaged) {
    const dir = path.resolve(path.dirname(process.execPath), '..', '..', '..', '..');
    if (fs.existsSync(path.join(dir, 'red4ext'))) return dir;
  }
  const steam = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077';
  return fs.existsSync(steam) ? steam : null;
})();

// REDbridge, shared by the packages with the "bridge" permission (kernel.bridge()).
// "bridgeTest": "clean" in settings.json (set by hand, for the W3 test) sees only the copy
// REDnode fetched and only a per-user .NET, as on a PC without VS Code.
const redbridge = createRedbridge({
  log,
  gameDir: () => GAME_DIR,
  configured: () => settings.redbridge,
  clean: () => settings.bridgeTest === 'clean',
});

// ---------- getting REDbridge from the Mod Manager (W3) ----------

// An update made while REDbridge ran from the old copy left that copy behind; it goes
// now, before REDbridge starts. Only REDnode's own copies, never EDGEdeck's or REDcode's.
{
  const own = findRedbridge(undefined, true);
  if (own) bridgeInstall.removeOlder(path.basename(path.dirname(own.exe)), log);
}

let bridgeJob = null; // { step, version, received, total, error } while getting it, or its failure
let bridgeLatest = null; // the newest release on GitHub, once asked this session
let bridgeAsking = null;
let bridgeNotified = 0;
let bridgePeeked = false; // asked GitHub for the newest release's size, for the button's text

/** The newest REDbridge release, asked of GitHub once a session. */
function latestBridge() {
  bridgeAsking ??= bridgeInstall.latestRelease().then(
    (rel) => {
      bridgeLatest = rel;
      log(`REDbridge: the newest release is ${rel.version} (${rel.asset})`);
      notifyLauncher();
      return rel;
    },
    (err) => {
      bridgeAsking = null; // ask again next time
      throw err;
    },
  );
  return bridgeAsking;
}

/** REDbridge's state for the Mod Manager: where it is, its .NET, the newest release, a job. */
function bridgeInfo() {
  const s = redbridge.status();
  // The Mod Manager's text names the version and size before the player presses Get.
  if (!s.found && !bridgeLatest && !bridgePeeked) {
    bridgePeeked = true;
    latestBridge().catch((err) => log(`REDbridge: could not ask GitHub for the newest release: ${err.message}`));
  }
  const newer = bridgeLatest && s.found && s.version && compareVersions(bridgeLatest.version, s.version) > 0;
  return {
    ...s,
    latest: bridgeLatest ? { version: bridgeLatest.version, size: bridgeLatest.size } : null,
    update: newer ? bridgeLatest.version : null,
    job: bridgeJob,
  };
}

function bridgeProgress(patch) {
  bridgeJob = { ...bridgeJob, ...patch };
  // At most four refreshes a second while downloading.
  if (Date.now() - bridgeNotified > 250 || patch.step) {
    bridgeNotified = Date.now();
    notifyLauncher();
  }
}

/**
 * Gets REDbridge for the player (the Mod Manager's button): the newest release when none
 * is found or a newer one is out, and the .NET 10 runtime for this Windows user when the
 * machine has none. One job at a time; the Mod Manager shows its steps.
 */
async function getRedbridge() {
  if (bridgeJob && !bridgeJob.error) return bridgeInfo();
  bridgeJob = { step: 'Asking GitHub for the newest REDbridge', received: 0, total: 0 };
  notifyLauncher();
  try {
    const rel = await latestBridge();
    const before = redbridge.status();
    if (!before.found || (before.version && compareVersions(rel.version, before.version) > 0)) {
      bridgeProgress({ step: `Downloading REDbridge ${rel.version}`, version: rel.version, total: rel.size });
      await bridgeInstall.installRelease(rel, {
        log,
        progress: (received, total) => bridgeProgress({ received, total: total || rel.size }),
      });
    }
    if (!redbridge.status().dotnet) {
      bridgeProgress({ step: 'Installing the .NET 10 runtime for this Windows user', received: 0, total: 0 });
      await bridgeInstall.installDotnet({ log });
    }
    // Older copies of REDnode's own go, unless REDbridge runs from one; then at the next start.
    if (!redbridge.status().running) bridgeInstall.removeOlder(rel.tag, log);
    bridgeJob = null;
    installed = null; // "requires": { "redbridge": ... } is checked again
    const now = redbridge.status();
    log(`REDbridge: ready, ${now.version} from ${now.source}, .NET 10 ${now.dotnet === 'machine' ? 'for the machine' : 'for this Windows user'}`);
  } catch (err) {
    bridgeJob = { error: err.message };
    log(`REDbridge: could not get it: ${err.message}`);
  }
  notifyLauncher();
  return bridgeInfo();
}

ipcMain.handle('rednode:apps:get-bridge', (event) => {
  fromLauncher(event);
  return getRedbridge();
});

let installed = null;
let installedAt = 0;
// Scanning reads a few DLL headers; at most once every 30 seconds.
function installedNow() {
  if (!installed || Date.now() - installedAt > 30000) {
    installed = scanGame(GAME_DIR);
    installedAt = Date.now();
    // REDbridge is not in the game folder, but packages may require it (W3).
    const b = redbridge.status();
    if (b.found) installed.set('redbridge', { name: 'REDbridge', kind: 'tool', version: b.version, path: b.exe });
    // REDnode itself, for app packs that need a version of it: the host's own version,
    // which is REDnode's (one version for every part), whatever RED4ext has logged.
    installed.set('rednode', { name: 'REDnode', kind: 'red4ext', version: VERSION, path: __dirname });
  }
  return installed;
}

/** A package's requirements, checked: [{ name, wants, found, installed, ok, kind, note }]. */
function requirementsOf(id) {
  const entry = apps.get(id);
  if (!entry || !Object.keys(entry.manifest.requires ?? {}).length) return [];
  // Other REDnode packages count too (SV1), by id, with their manifest's version; a game
  // mod of the same name wins.
  const known = new Map(installedNow());
  known.leftovers = installedNow().leftovers;
  for (const [pid, a] of apps) {
    const k = gamefilesKey(pid);
    if (!known.has(k)) known.set(k, { name: a.manifest.name, kind: 'package', version: a.manifest.version || null, path: a.dir });
  }
  return checkRequires(entry.manifest.requires, known);
}

/** Whether a manifest's "requires" names REDbridge. */
const needsBridge = (m) => Object.keys(m.requires ?? {}).some((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'redbridge');

/** What a package is missing, in words, or null. */
function missingOf(id) {
  const missing = requirementsOf(id).filter((r) => !r.ok);
  if (!missing.length) return null;
  const wants = (r) => (r.wants && r.wants !== '*' ? ` ${r.wants}` : '');
  return missing.map((r) => `${r.name}${wants(r)} (${r.note})`).join(', ');
}

function discoverApps() {
  apps.clear();
  hiddenCopies.clear();
  for (const root of APP_ROOTS) {
    for (const dir of packageDirsOf(root)) {
      try {
        const manifest = readManifest(dir);
        if (!manifest) continue;
        if (apps.has(manifest.id)) {
          noteHidden(manifest.id, dir, apps.get(manifest.id).dir);
          continue;
        }
        apps.set(manifest.id, { manifest, dir, builtin: !!root.builtin, pinned: !!root.pinned, manager: !!root.manager, dev: !!root.dev });
      } catch (err) {
        log(`Skipped an app: ${err.message}`);
      }
    }
  }
  log(`Found ${apps.size} app(s): ${[...apps.keys()].join(', ')}`);
}

// ---------- pins: Pin to launcher and Pin to HUD (O8) ----------
//
// Only packages pinned to the launcher are listed there; the Mod Manager lists all.
// Only windows pinned to the HUD stay on screen during gameplay (passive mode);
// the others show while the player interacts. The packages installed when O8 first
// ran keep both pins, so nothing changes for them; packages found later start
// unpinned and count as new until the Mod Manager lists them. HUD widgets are
// always on the HUD. (In the code, "pinned" means a built-in that is always open.)

function seedPins() {
  if (settings.pinsSeeded) return;
  for (const [id, entry] of apps) {
    if (entry.manager) continue; // new with O8 itself
    settings.apps[id] = { inLauncher: true, onHud: true, seen: true, ...settings.apps[id] };
  }
  settings.pinsSeeded = true;
  writeJson('settings.json', settings);
}

const isInLauncher = (entry) => entry.builtin || !!settings.apps[entry.manifest.id]?.inLauncher;
const isOnHud = (entry) => entry.pinned || entry.manifest.kind === 'hud' || !!settings.apps[entry.manifest.id]?.onHud;
const isNew = (entry) => !entry.builtin && !settings.apps[entry.manifest.id]?.seen;

// The package a window belongs to: its app, or for a mod's window, the mod.
function ownerOf(w) {
  if (w.app.built) return apps.get(built.get(w.app.built)?.modId);
  return apps.get(w.app.manifest.id);
}
function windowOnHud(w) {
  if (w.app.pinned || w.app.manifest.kind === 'hud') return true;
  const owner = ownerOf(w);
  return owner ? isOnHud(owner) : true;
}

// Open at start (0.24.2): with the launcher's switch off, the game starts with REDnode
// closed. Until the player first opens the overlay (F10), only HUD widgets show in passive
// mode; windows pinned to the HUD, the launcher tab among them, wait for that F10.
let startHold = false;
// The Welcome window shows too: it is how a new player learns about F10.
const shownInPassive = (w) => (startHold ? w.app.manifest.kind === 'hud' || w.app.manifest.id === 'welcome' : windowOnHud(w));
function endStartHold() {
  if (!startHold) return;
  startHold = false;
  for (const w of windows.values()) sendJson({ cmd: 'window.hud', window: w.id, onHud: shownInPassive(w) });
  log('Open at start: the overlay was opened, so pinned windows show again');
}

// ---------- layers and solo mode (O10) ----------
//
// The tool layer is always above packages' windows: REDnode's own windows (launcher,
// Mod log, Mod Manager, debuggers) and packages the player let stay on top with the
// "front" permission, such as the Test timer. A full-screen package cannot cover them.
// Solo mode: a package with the "solo" permission asks to have the screen; every
// other package's window is hidden, the tool layer stays, until it ends.

function windowLayer(w) {
  // A mod's window is drawn by the built-in builder page, so ask about its mod, not the page.
  if (!w.app.built && (w.app.builtin || w.app.debugger)) return 'tool';
  const owner = ownerOf(w);
  return owner && isGranted(owner.manifest.id, 'front') ? 'tool' : 'app';
}

let soloOwner = null; // the package id in solo mode, or null

function soloHides(w) {
  return !!soloOwner && windowLayer(w) !== 'tool' && ownerOf(w)?.manifest.id !== soloOwner;
}

// Hidden by solo mode or by the current space. Solo wins: its package's windows show
// in every space while it lasts.
function windowHidden(w) {
  return soloOwner ? soloHides(w) : spaceHides(w);
}

function applySolo() {
  if (!connected) return;
  for (const w of windows.values()) sendJson({ cmd: 'window.hidden', window: w.id, hidden: windowHidden(w) });
}

// ---------- spaces (O11) ----------
//
// Named sets of windows, like virtual desktops. The player switches the space (the
// launcher tab, or Ctrl+1 to 9 in the overlay) and only its windows show. A window
// belongs to one space or to all of them ("*"); tool windows show in every space. A
// window with no space yet joins the one the player is in when it first opens. A
// package can be put in a space as a whole (the Mod Manager); a window's own choice
// (its title bar) wins over its package's.
// settings.spaces: { names: ['Main', ...], current: 'Main', of: { windowKey | packageId: name | '*' } }

const MAIN_SPACE = 'Main';

function spaces() {
  const s = settings.spaces ?? {};
  const names = Array.isArray(s.names) && s.names.length ? s.names : [MAIN_SPACE];
  const current = names.includes(s.current) ? s.current : names[0];
  settings.spaces = { names, current, of: s.of ?? {} };
  return settings.spaces;
}

const spaceKey = (w) => w.app.manifest.id;

function spaceOf(w) {
  const s = spaces();
  const own = s.of[spaceKey(w)];
  const pkg = ownerOf(w)?.manifest.id;
  const found = own ?? (pkg ? s.of[pkg] : undefined);
  return found === '*' || s.names.includes(found) ? found : null;
}

function spaceHides(w) {
  if (windowLayer(w) === 'tool') return false;
  const s = spaces();
  const of = spaceOf(w);
  return of !== null && of !== '*' && of !== s.current;
}

// A window opening for the first time joins the space the player is in.
function placeInSpace(w) {
  if (windowLayer(w) === 'tool' || spaceOf(w) !== null) return;
  const s = spaces();
  s.of[spaceKey(w)] = s.current;
  writeJson('settings.json', settings);
}

function spacesChanged(why) {
  writeJson('settings.json', settings);
  applySolo();
  for (const w of windows.values()) toPage(w, { event: 'window-info', info: windowInfo(w) });
  notifyLauncher();
  if (why) log(`Spaces: ${why}`);
}

function checkSpaceName(name, s) {
  const n = String(name ?? '').trim();
  if (!n || n.length > 24) throw new Error('A space name is 1 to 24 characters');
  if (n === '*') throw new Error('"*" means every space');
  if (s.names.some((x) => x.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a space "${n}"`);
  return n;
}

function switchSpace(name) {
  const s = spaces();
  if (!s.names.includes(name)) throw new Error(`No space "${name}"`);
  if (s.current === name) return s;
  s.current = name;
  spacesChanged(`now in ${name}`);
  return s;
}

function createSpace(name) {
  const s = spaces();
  const n = checkSpaceName(name, s);
  s.names.push(n);
  s.current = n;
  spacesChanged(`made ${n}, and switched to it`);
  return s;
}

function renameSpace(from, to) {
  const s = spaces();
  if (!s.names.includes(from)) throw new Error(`No space "${from}"`);
  const n = checkSpaceName(to, s);
  s.names = s.names.map((x) => (x === from ? n : x));
  if (s.current === from) s.current = n;
  for (const [k, v] of Object.entries(s.of)) if (v === from) s.of[k] = n;
  spacesChanged(`renamed ${from} to ${n}`);
  return s;
}

function deleteSpace(name) {
  const s = spaces();
  if (!s.names.includes(name)) throw new Error(`No space "${name}"`);
  if (s.names.length === 1) throw new Error('The last space cannot be deleted');
  s.names = s.names.filter((x) => x !== name);
  const to = s.names[0];
  for (const [k, v] of Object.entries(s.of)) if (v === name) s.of[k] = to; // its windows move, nothing is lost
  if (s.current === name) s.current = to;
  spacesChanged(`deleted ${name}; its windows moved to ${to}`);
  return s;
}

// Moves a window (its key) or a whole package (its id) to a space, or to every space ("*").
function moveToSpace(key, space) {
  const s = spaces();
  if (space !== '*' && !s.names.includes(space)) throw new Error(`No space "${space}"`);
  s.of[key] = space;
  // A package moved as a whole: its windows follow, whatever they chose before.
  if (apps.has(key)) for (const k of Object.keys(s.of)) if (k.startsWith(`${key}~`)) delete s.of[k];
  spacesChanged(`${key} to ${space === '*' ? 'every space' : space}`);
  return s;
}

// What a window's title bar needs: the spaces, its own, and whether its package is on the HUD.
function windowInfo(w) {
  const s = spaces();
  const owner = ownerOf(w);
  return {
    spaces: { names: [...s.names], current: s.current },
    space: spaceOf(w),
    tool: windowLayer(w) === 'tool',
    onHud: windowOnHud(w),
    canPin: !!owner && !owner.pinned && owner.manifest.kind !== 'hud',
    canReset: !!positions[spaceKey(w)],
  };
}

// Tells a package's pages and its mod that its solo mode started or ended.
function tellSolo(id, on) {
  for (const w of windowsOfPackage(id)) toPage(w, { event: 'solo', on });
  if (mods?.has(id)) mods.toMod(id, { event: 'solo', on });
}

function setSolo(id, on) {
  if (on) {
    if (!isGranted(id, 'solo')) {
      const entry = apps.get(id);
      throw new Error(
        entry?.manifest.permissions.includes('solo')
          ? `Allow "${entry.manifest.name}" to use solo mode in the Mod Manager first`
          : 'This package does not ask for the "solo" permission in its rednode-app.json',
      );
    }
    if (soloOwner === id) return;
    if (soloOwner) endSolo(`${apps.get(id)?.manifest.name ?? id} took it over`);
    soloOwner = id;
    log(`Solo mode: ${id}`);
  } else {
    if (soloOwner !== id) return;
    soloOwner = null;
    log(`Solo mode of ${id} ended by the package`);
  }
  applySolo();
  tellSolo(id, on);
  notifyLauncher();
}

function endSolo(why) {
  if (!soloOwner) return;
  const id = soloOwner;
  soloOwner = null;
  log(`Solo mode of ${id} ended: ${why}`);
  applySolo();
  tellSolo(id, false);
  notifyLauncher();
}

// Solo ends when its package stops: no window left, and no mod running. TweakDB changes
// of a stopped package are undone, and its sounds stopped, at the same moments.
function checkSolo() {
  checkTweaks();
  checkSounds();
  checkInk();
  if (!soloOwner) return;
  if (!packageRunning(soloOwner)) endSolo('the package stopped');
}

function setPin(id, where, on) {
  const entry = apps.get(id);
  if (!entry || entry.pinned) throw new Error(`No app or mod "${id}"`);
  if (where !== 'launcher' && where !== 'hud') throw new Error('A pin is "launcher" or "hud"');
  if (where === 'launcher' && entry.builtin) return; // built-ins are always in the launcher
  settings.apps[id] = { ...settings.apps[id], [where === 'launcher' ? 'inLauncher' : 'onHud']: !!on, seen: true };
  writeJson('settings.json', settings);
  if (where === 'hud') {
    for (const w of windows.values()) {
      if (ownerOf(w) === entry) sendJson({ cmd: 'window.hud', window: w.id, onHud: shownInPassive(w) });
    }
  }
  log(`${on ? 'Pinned' : 'Unpinned'} ${id} ${on ? 'to' : 'from'} the ${where === 'hud' ? 'HUD' : 'launcher'}`);
  if (where === 'hud') for (const w of windows.values()) if (ownerOf(w) === entry) toPage(w, { event: 'window-info', info: windowInfo(w) });
  notifyLauncher();
}

function markSeen(ids) {
  let changed = false;
  for (const id of ids) {
    const entry = apps.get(id);
    if (!entry || !isNew(entry)) continue;
    settings.apps[id] = { ...settings.apps[id], seen: true };
    changed = true;
  }
  if (changed) {
    writeJson('settings.json', settings);
    notifyLauncher();
  }
}

// ---------- packages added, changed or removed while the host runs ----------

// Starts a package found after startup, as if it had been there from the start.
function startPackage(entry) {
  if (hotReload && !entry.builtin) watchPackage(entry);
  if (shouldOpen(entry)) openApp(entry);
  if (isMod(entry.manifest)) mods.add(entry, { enabled: shouldOpen(entry), shared: settings.apps[entry.manifest.id]?.shared });
}

function stopPackage(id) {
  closeApp(id);
  if (mods.has(id)) mods.remove(id);
  watchers.get(id)?.close();
  watchers.delete(id);
}

// Looks at the apps folders again: new packages start, removed ones stop, and a
// changed manifest is applied. A package written while the game runs, for example
// by REDagent, works without a restart.
const lastManifestError = new Map(); // folder -> message, so an invalid manifest is logged once
function rescanApps() {
  const found = new Map(); // id -> { dir, manifest, dev }
  hiddenCopies.clear();
  for (const root of APP_ROOTS) {
    if (root.single) continue;
    for (const dir of packageDirsOf(root)) {
      try {
        const manifest = readManifest(dir);
        lastManifestError.delete(dir);
        if (!manifest) continue;
        if (apps.get(manifest.id)?.builtin) noteHidden(manifest.id, dir, apps.get(manifest.id).dir);
        else if (found.has(manifest.id)) noteHidden(manifest.id, dir, found.get(manifest.id).dir);
        else found.set(manifest.id, { dir, manifest, dev: !!root.dev });
      } catch (err) {
        if (lastManifestError.get(dir) !== err.message) log(`Skipped an app: ${err.message}`);
        lastManifestError.set(dir, err.message);
      }
    }
  }
  let changed = false;
  for (const [id, entry] of [...apps]) {
    if (entry.builtin) continue;
    const now = found.get(id);
    if (!now || now.dir !== entry.dir) {
      log(`Package removed: ${id}`);
      stopPackage(id);
      apps.delete(id);
      changed = true;
    } else if (JSON.stringify(now.manifest) !== JSON.stringify(entry.manifest)) {
      log(`Package changed: ${id}. Restarting it.`);
      stopPackage(id);
      entry.manifest = now.manifest;
      startPackage(entry);
      changed = true;
    }
  }
  for (const [id, now] of found) {
    if (apps.has(id)) continue;
    const entry = { manifest: now.manifest, dir: now.dir, builtin: false, pinned: false, dev: now.dev };
    apps.set(id, entry);
    log(`New package: ${id}${now.dev ? ` (development copy, from ${now.dir})` : ''}`);
    startPackage(entry);
    changed = true;
  }
  if (changed) {
    mcp?.configure(mcpConfig());
    notifyLauncher();
  }
}

// Watches each apps folder for new package folders and manifest changes.
const rootWatchers = [];
function watchAppRoots() {
  let timer = null;
  for (const root of APP_ROOTS) {
    if (root.single || !fs.existsSync(root.dir)) continue;
    try {
      const w = fs.watch(root.dir, { recursive: true }, (_type, file) => {
        const parts = String(file ?? '').split(/[\\/]/);
        // A development folder that is a package itself: only its manifest matters here.
        if (fs.existsSync(path.join(root.dir, 'rednode-app.json')) || parts[0] === 'rednode-app.json') {
          if (file && !(parts.length === 1 && parts[0] === 'rednode-app.json') && !lastManifestError.has(root.dir)) return;
          clearTimeout(timer);
          timer = setTimeout(rescanApps, 600);
          return;
        }
        // A package folder itself, its manifest, or any file of a package that was skipped
        // (its manifest named a file not written yet). Other files are hot reload's business.
        const skipped = lastManifestError.has(path.join(root.dir, parts[0]));
        if (file && !(parts.length === 1 || (parts.length === 2 && parts[1] === 'rednode-app.json') || skipped)) return;
        clearTimeout(timer);
        timer = setTimeout(rescanApps, 600);
      });
      w.on('error', () => {});
      rootWatchers.push(w);
    } catch (err) {
      log(`Cannot watch ${root.dir}: ${err.message}`);
    }
  }
}

// After the development folders changed: watch the folders as they are now.
function rewatchAppRoots() {
  for (const w of rootWatchers.splice(0)) w.close();
  watchAppRoots();
}

function shouldOpen(entry) {
  if (entry.pinned) return true;
  if (entry.builtin && entry.manifest.id === 'welcome' && !settings.welcomed) return true; // the first start
  if (chosenApps) return chosenApps.includes(entry.manifest.id);
  return settings.apps[entry.manifest.id]?.open ?? entry.manifest.open;
}

// ---------- game state for apps and mods ----------

function gameState() {
  return { connected, overlay: mode, ...(connected ? uiState : { menu: false, photoMode: false, scene: false, mainMenu: false }) };
}

// Tells apps and mods when the state changed.
function stateChanged() {
  const state = gameState();
  const json = JSON.stringify(state);
  if (json === lastStateJson) return;
  lastStateJson = json;
  const message = { event: 'state', state };
  toAllPages(message);
  mods?.broadcast(message);
}

// ---------- messages to pages ----------

function toPage(w, message) {
  if (!w.win.isDestroyed()) w.win.webContents.send('rednode:event', message);
}
function toAllPages(message) {
  for (const w of windows.values()) toPage(w, message);
}
function windowFor(webContents) {
  for (const w of windows.values()) if (w.win.webContents === webContents) return w;
  return null;
}
function windowOfApp(appId) {
  for (const w of windows.values()) if (w.app.manifest.id === appId) return w;
  return null;
}

// ---------- pipe ----------

function writeMessage(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(type, 0);
  header.writeUInt32LE(payload.length, 4);
  return socket.write(Buffer.concat([header, payload]));
}

function sendJson(object) {
  if (connected) writeMessage(TYPE_JSON, Buffer.from(JSON.stringify(object), 'utf8'));
}

function unionRect(a, b) {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

// Sends the changed part of a window's image. While the pipe is busy, changes
// are merged and only the newest image is kept.
function sendFrame(windowId, image, dirty) {
  if (!connected || !windows.has(windowId)) return;
  const size = image.getSize();
  const full = { x: 0, y: 0, width: size.width, height: size.height };
  const area = dirty && dirty.width > 0 && dirty.height > 0 ? dirty : full;
  if (!writable) {
    const queued = pendingFrames.get(windowId);
    pendingFrames.set(windowId, { image, dirty: unionRect(queued?.dirty, area) });
    return;
  }
  // Clip to the image, in whole pixels.
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const width = Math.min(size.width - x, Math.ceil(area.x + area.width) - x);
  const height = Math.min(size.height - y, Math.ceil(area.y + area.height) - y);
  if (width <= 0 || height <= 0) return;
  const isFull = width === size.width && height === size.height;
  const pixels = (isFull ? image : image.crop({ x, y, width, height })).toBitmap(); // BGRA, premultiplied
  const head = Buffer.alloc(28);
  [windowId, size.width, size.height, x, y, width, height].forEach((v, i) => head.writeUInt32LE(v, i * 4));
  writable = writeMessage(TYPE_RECT, Buffer.concat([head, pixels]));
  frames += 1;
  bytes += pixels.length;
  windowStats.get(windowId).frames += 1;
}

// Tells the plugin about a window. A saved position wins over the manifest's anchor,
// but only for a window of the size it was saved with: a package whose window changed
// size (a small panel that became a full-screen page) starts at its anchor again (#8).
// Positions saved before sizes were kept have none, and are ignored once.
function openInGame(w) {
  const m = w.app.manifest;
  const saved = positions[m.id];
  const fits = saved && saved.width === m.width && saved.height === m.height;
  const place = fits ? { anchor: 'top-left', x: saved.x, y: saved.y } : { anchor: m.anchor, x: m.x, y: m.y };
  sendJson({
    cmd: 'window.open',
    window: w.id,
    ...place,
    width: m.width,
    height: m.height,
    kind: m.kind,
    hideWith: m.hideWith,
    draggable: m.kind !== 'hud',
    onHud: shownInPassive(w),
    layer: windowLayer(w),
    hidden: windowHidden(w),
  });
  sendJson({ cmd: 'window.drag', window: w.id, regions: w.dragRegions });
  repaint(w.win.webContents); // send a full frame now
}

function connect() {
  let buffer = Buffer.alloc(0);
  socket = net.connect(PIPE);

  socket.on('connect', () => {
    connected = true;
    writable = true;
    log('Connected to the game');
    sendJson({ cmd: 'host', pid: process.pid }); // lets the plugin open our texture handles
    startHold = settings.openAtStart === false;
    if (startHold) log('Open at start is off: only HUD widgets show until the overlay is opened (F10)');
    for (const w of windows.values()) openInGame(w);
    toAllPages({ event: 'link', connected: true });
    stateChanged();
  });

  socket.on('drain', () => {
    writable = true;
    for (const [id, queued] of pendingFrames) {
      pendingFrames.delete(id);
      sendFrame(id, queued.image, queued.dirty);
      if (!writable) break;
    }
  });

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const type = buffer.readUInt32LE(0);
      const length = buffer.readUInt32LE(4);
      if (buffer.length < 8 + length) break;
      const payload = buffer.subarray(8, 8 + length);
      buffer = buffer.subarray(8 + length);
      if (type === TYPE_JSON) onGameMessage(JSON.parse(payload.toString('utf8')));
    }
  });

  socket.on('error', () => {}); // 'close' follows
  socket.on('close', () => {
    if (connected) {
      log('Disconnected from the game');
      toAllPages({ event: 'link', connected: false });
    }
    connected = false;
    stateChanged();
    pendingFrames.clear();
    // The plugin's sounds and volumes belong to that connection.
    soundOwners.clear();
    mixKnown = false;
    releaseSharedFrames(() => true);
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected from the game'));
      pending.delete(id);
    }
    setTimeout(connect, 2000); // the game may not be running yet
  });
}

// ---------- messages from the game ----------

const KEYS = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Control', 18: 'Alt', 27: 'Escape', 32: 'Space',
  33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 46: 'Delete',
};
function keyName(vk) {
  if (KEYS[vk]) return KEYS[vk];
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  return null;
}

let ctrlDown = false;
let shiftDown = false;
let swallowChar = false;
// Editing shortcuts, run by the host on the focused page.
const EDIT_KEYS = {
  V: (wc) => wc.paste(),
  C: (wc) => wc.copy(),
  X: (wc) => wc.cut(),
  A: (wc) => wc.selectAll(),
  Z: (wc) => (shiftDown ? wc.redo() : wc.undo()),
  Y: (wc) => wc.redo(),
};

function onInput(m) {
  const w = windows.get(m.window);
  if (!w || w.win.isDestroyed()) return;
  const wc = w.win.webContents;
  switch (m.type) {
    case 'mouseMove':
    case 'mouseLeave':
      // With the pointer locked, the raw movement is in dx, dy. Chromium drops movementX
      // and movementY from injected moves (found in testing), so the page's Pointer Lock
      // code in preload.js makes the pointermove itself.
      if (m.dx !== undefined) toPage(w, { event: 'pointer-move', dx: m.dx, dy: m.dy });
      else wc.sendInputEvent({ type: m.type, x: m.x, y: m.y });
      break;
    case 'mouseDown':
    case 'mouseUp':
      wc.sendInputEvent({ type: m.type, x: m.x, y: m.y, button: m.button, clickCount: 1 });
      break;
    case 'mouseWheel':
      wc.sendInputEvent({ type: 'mouseWheel', x: m.x, y: m.y, deltaX: 0, deltaY: m.delta });
      break;
    case 'keyDown':
    case 'keyUp': {
      // The plugin sends Ctrl and Shift as keys of their own; keep their state, so
      // shortcuts work: the editing ones are run directly, which is reliable.
      if (m.vk === 17) ctrlDown = m.type === 'keyDown';
      if (m.vk === 16) shiftDown = m.type === 'keyDown';
      // Ctrl+1 to 9: switch to that space. The key is not passed on, nor the digit it types.
      if (ctrlDown && m.vk >= 0x31 && m.vk <= 0x39) {
        if (m.type === 'keyDown') {
          const name = spaces().names[m.vk - 0x31];
          if (name) switchSpace(name);
          swallowChar = true;
        }
        break;
      }
      const keyCode = keyName(m.vk);
      if (m.type === 'keyDown' && ctrlDown && EDIT_KEYS[keyCode]) {
        EDIT_KEYS[keyCode](wc);
        break;
      }
      const modifiers = [ctrlDown && 'control', shiftDown && 'shift'].filter(Boolean);
      if (keyCode) wc.sendInputEvent({ type: m.type, keyCode, modifiers });
      break;
    }
    case 'char':
      if (swallowChar) {
        swallowChar = false; // the digit of a Ctrl+number space switch
        break;
      }
      // Control characters (Ctrl+V makes 0x16) would arrive as junk; real keys came as keyDown.
      if (m.code >= 32) wc.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(m.code) });
      break;
    default:
      break;
  }
}

function onFocus(windowId) {
  for (const w of windows.values()) {
    const focused = w.id === windowId;
    // Chromium only draws the text caret and :focus styles in a focused page.
    // focusOnWebView focuses the page without taking OS focus from the game.
    if (focused) w.win.focusOnWebView();
    else w.win.blurWebView();
    toPage(w, { event: 'focus', focused });
  }
}

function onGameMessage(m) {
  if (m.id !== undefined) {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
    return;
  }
  switch (m.event) {
    case 'input':
      onInput(m);
      return;
    case 'capture':
      onCapture(m);
      return;
    case 'focus':
      onFocus(m.window);
      return;
    case 'moved': {
      const w = windows.get(m.window);
      if (w) {
        const { width, height } = w.app.manifest;
        const first = !positions[w.app.manifest.id];
        positions[w.app.manifest.id] = { x: m.x, y: m.y, width, height };
        writeJson('window-positions.json', positions);
        if (first) toPage(w, { event: 'window-info', info: windowInfo(w) }); // Reset position is offered now
      }
      return;
    }
    case 'perf': {
      lastGamePerf = m;
      const host = hostPerf();
      toAllPages({ event: 'perf', game: m, host });
      logPerf(m, host);
      return;
    }
    case 'frame-done':
      for (const fid of m.frames ?? []) {
        const f = sharedFrames.get(fid);
        if (f) {
          f.texture.release();
          sharedFrames.delete(fid);
        }
      }
      return;
    case 'window-refused': {
      // The game draws at most m.limit windows at once; this one will not show.
      const w = windows.get(m.window);
      log(`The game refused the window of ${w ? w.app.manifest.id : `window ${m.window}`}: ${m.limit} windows are already open. Close some apps or mod windows.`);
      return;
    }
    case 'shared-failed':
      log(`The game could not use GPU sharing (${m.error}). Switching to the CPU path.`);
      setRenderPath('cpu', false);
      return;
    case 'hello':
    case 'overlay':
      mode = m.mode;
      log(m.event === 'hello' ? `Game says hello (${m.plugin}), mode ${mode}` : `Mode ${mode}`);
      if (mode === 'interactive') endStartHold();
      if (mode !== 'interactive') onFocus(0);
      // Windows not pinned to the HUD appear and disappear with the mode: give them a frame.
      if (m.event === 'overlay') for (const w of windows.values()) if (!w.win.isDestroyed()) repaint(w.win.webContents);
      toAllPages(m);
      stateChanged();
      return;
    case 'ui-state': {
      const next = { menu: !!m.menu, photoMode: !!m.photoMode, scene: !!m.scene, mainMenu: !!m.mainMenu };
      const changed = JSON.stringify(next) !== JSON.stringify(uiState);
      onUiStateForSound(uiState, next);
      uiState = next;
      // A window hidden with the game's UI loses its texture in the game. Repaint every
      // window, so one that is shown again gets a frame even if its page is idle.
      if (changed) for (const w of windows.values()) if (!w.win.isDestroyed()) repaint(w.win.webContents);
      toAllPages(m);
      stateChanged();
      return;
    }
    case 'game':
      toAllPages(m);
      mods?.broadcast(m);
      return;
    case 'sound-end':
      onSoundEnd(m);
      return;
    case 'sound-trace':
      onSoundTrace(m);
      return;
    case 'pointer-lock': {
      // The plugin began or ended a window's pointer lock: the page's Pointer Lock follows.
      const w = windows.get(m.window);
      if (w) toPage(w, { event: 'pointer-lock', locked: !!m.locked, why: m.why ?? null });
      if (!m.locked && m.why) log(`Pointer lock of ${w?.app.manifest.id ?? m.window} ended: ${m.why}`);
      return;
    }
    case 'title-dblclick': {
      // A double-click on a window's title bar: the page decides (rn-window rolls up).
      const w = windows.get(m.window);
      if (w) toPage(w, m);
      return;
    }
    case 'repaint': {
      // The game has started drawing and threw away the frames it got before, or
      // shows one window that has nothing to draw yet: send fresh frames.
      const target = m.window ? [windows.get(m.window)].filter(Boolean) : [...windows.values()];
      for (const w of target) if (!w.win.isDestroyed()) repaint(w.win.webContents);
      return;
    }
    default:
      break;
  }
  toAllPages(m);
}

// ---------- GPU sharing ----------

// Sends a GPU texture handle instead of pixels. The texture stays ours until
// the game answers frame-done, or a second has passed.
// Makes a page send a new frame. invalidate() alone sends nothing with GPU sharing
// when the page has not changed (seen in the C3 test: the launcher and REDagent
// stayed invisible), so a 1-pixel, almost transparent mark is drawn for two
// frames. Its alpha is below the plugin's click-through threshold.
const REPAINT_SCRIPT = `(() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:rgba(0,0,0,0.01);pointer-events:none;z-index:2147483647';
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => d.remove()));
})()`;
function repaint(wc) {
  wc.invalidate();
  wc.executeJavaScript(REPAINT_SCRIPT, true).catch(() => {});
}

function sendShared(windowId, texture) {
  const info = texture.textureInfo;
  const handle = info.handle?.ntHandle;
  if (!connected || !windows.has(windowId) || !handle) {
    texture.release();
    return;
  }
  const frameId = nextFrameId++;
  sharedFrames.set(frameId, { texture, windowId, at: Date.now() });
  const msg = Buffer.alloc(24);
  msg.writeUInt32LE(windowId, 0);
  msg.writeUInt32LE(info.codedSize.width, 4);
  msg.writeUInt32LE(info.codedSize.height, 8);
  msg.writeUInt32LE(frameId, 12);
  msg.writeBigUInt64LE(handle.readBigUInt64LE(0), 16);
  writable = writeMessage(TYPE_SHARED, msg);
  frames += 1;
  windowStats.get(windowId).frames += 1;
}

function releaseSharedFrames(test) {
  let n = 0;
  for (const [fid, f] of sharedFrames) {
    if (!test(f)) continue;
    f.texture.release();
    sharedFrames.delete(fid);
    n += 1;
  }
  return n;
}

// Switches between GPU sharing and the CPU path by reopening every window.
function setRenderPath(path, save = true) {
  if (renderPath === path) return;
  renderPath = path;
  if (save) {
    settings.renderPath = path;
    writeJson('settings.json', settings);
  }
  log(`Render path: ${path}`);
  const open = [...windows.values()].map((w) => w.app);
  for (const entry of open) closeApp(entry.manifest.id);
  releaseSharedFrames(() => true);
  for (const entry of open) openApp(entry);
  notifyLauncher();
}

// ---------- what the host costs ----------

// Writes a perf line to the log every 5 seconds, so a test run can be compared
// afterwards without reading numbers off the screen.
let perfLogAt = 0;
function logPerf(game, host) {
  if (Date.now() - perfLogAt < 5000) return;
  perfLogAt = Date.now();
  const open = [...windows.values()].map((w) => w.app.manifest.id);
  log(
    `Perf ${host.renderPath}${open.includes('stress') ? ' +stress' : ''}: game ${game.fps.toFixed(0)} fps; ` +
      `overlay CPU ${game.cpuMs.toFixed(2)} ms (worst ${game.cpuMsMax.toFixed(2)}; ` +
      `GPU wait ${(game.waitMs ?? 0).toFixed(2)}, opening ${(game.openMs ?? 0).toFixed(2)}), ` +
      `textures opened ${(game.opensPerSec ?? 0).toFixed(0)}/s, reused ${(game.reusedPerSec ?? 0).toFixed(0)}/s, ` +
      `GPU ${game.gpuMs.toFixed(2)} ms (worst ${game.gpuMsMax.toFixed(2)}); ` +
      `uploads ${game.uploadMBps.toFixed(1)} MB/s, shared ${(game.sharedPerSec ?? 0).toFixed(0)}/s; ` +
      `game calls ${(game.callsPerSec ?? 0).toFixed(0)}/s, ${(game.callMsPerFrame ?? 0).toFixed(2)} ms a frame (worst ${(game.callMsMax ?? 0).toFixed(2)}); ` +
      `host ${host.memoryMB} MB in ${host.processes} processes, CPU ${host.cpuPercent}%, sent ${host.sentMBps.toFixed(1)} MB/s`,
  );
}

let lastPerfAt = Date.now();
function takeBytes() {
  const b = bytes;
  bytes = 0;
  return b;
}
function hostPerf() {
  const now = Date.now();
  const seconds = Math.max(0.001, (now - lastPerfAt) / 1000);
  lastPerfAt = now;
  const metrics = app.getAppMetrics();
  const perWindow = [...windows.values()].map((w) => ({
    id: w.app.manifest.id,
    fps: Math.round((windowStats.get(w.id)?.frames ?? 0) / seconds),
  }));
  for (const s of windowStats.values()) s.frames = 0;
  return {
    memoryMB: Math.round(metrics.reduce((n, p) => n + (p.memory?.workingSetSize ?? 0), 0) / 1024),
    cpuPercent: Math.round(metrics.reduce((n, p) => n + (p.cpu?.percentCPUUsage ?? 0), 0)),
    processes: metrics.length,
    sentMBps: +(takeBytes() / 1048576 / seconds).toFixed(2),
    renderPath,
    sharedOutstanding: sharedFrames.size,
    windows: perWindow,
  };
}

// ---------- the bridge for apps ----------

// Calls a bridge method in the game. Apps and mods both come through here.
function bridgeCall(method, params, ms = 5000) {
  if (typeof method !== 'string') return Promise.reject(new Error('method must be a string'));
  if (!connected) return Promise.reject(new Error('Not connected to the game'));
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`The game did not answer within ${ms / 1000} seconds`));
    }, ms);
    pending.set(id, { resolve, reject, timer });
    sendJson({ id, method, params });
  });
}

function modLogFile() {
  return logFile ? path.join(path.dirname(logFile), 'rednode-mods.log') : dataFile('rednode-mods.log');
}

function hostState() {
  const solo = soloOwner ? { id: soloOwner, name: apps.get(soloOwner)?.manifest.name ?? soloOwner } : null;
  const s = spaces();
  return {
    connected, mode, windowed, version: VERSION, game: gameState(), theme: theme(), developer: !!settings.developer, solo,
    tooltips: settings.tooltips !== false,
    spaces: { names: [...s.names], current: s.current },
  };
}

// ---------- TweakDB changes per package (TweakDB API, T2) ----------
//
// The first time a package changes a flat, the host keeps the flat's value from before;
// when the package stops (switched off, restarted, hot reloaded, crashed) the host puts
// those values back, newest change first. Flats a package added cannot be removed from
// TweakDB, so they stay until the game closes, as do records it cloned or created.
// If two packages change the same flat, the one that stops first restores what it found.

const tweakJournal = new Map(); // package id -> Map(path -> { type, value } before its first change, or null)
const undoing = new Map(); // package id -> the promise of its undo in progress

// Game calls per package, counted for the Task Manager: id -> { calls, ms } since the last sample.
const gameCounts = new Map();

async function packageCall(id, method, params) {
  const started = performance.now();
  try {
    return await packageCallNow(id, method, params);
  } finally {
    if (id) {
      const c = gameCounts.get(id) ?? { calls: 0, ms: 0 };
      c.calls += 1;
      c.ms += performance.now() - started;
      gameCounts.set(id, c);
    }
  }
}

async function packageCallNow(id, method, params) {
  // A restarted package waits until its old changes are undone, so it never saves a
  // half-restored value as the original.
  if (id && undoing.has(id)) await undoing.get(id);
  if (typeof method === 'string' && method.startsWith('sound.')) return soundCall(id, method, params);
  // ui.copy: any package may write the clipboard (never read it).
  if (method === 'clipboard.write') {
    clipboard.writeText(String(params?.text ?? ''));
    return true;
  }
  if (method === 'archives.reload') return reloadArchives({ id }, params);
  // ink (I2a): a package touches only its own trees; the plugin keeps them per package.
  if (method === 'ink.apply' || method === 'ink.clear') {
    if (!id) throw new Error('ink is for packages');
    if (method === 'ink.apply') inkUsers.add(id);
    return bridgeCall(method, { ...params, package: id });
  }
  if (method === 'archives.soundState') return bridgeCall('opus.state', { sounds: Array.isArray(params?.sounds) ? params.sounds : [] });
  if (method === 'tweakdb.set' && id && params?.path) {
    const path = String(params.path);
    if (!tweakJournal.has(id)) tweakJournal.set(id, new Map());
    const journal = tweakJournal.get(id);
    if (!journal.has(path)) journal.set(path, await bridgeCall('tweakdb.get', { path }).catch(() => null));
  }
  return bridgeCall(method, params);
}

function undoTweaks(id, why) {
  const journal = tweakJournal.get(id);
  tweakJournal.delete(id);
  if (!journal?.size || !connected) return;
  const done = restoreTweaks(id, journal, why).finally(() => {
    if (undoing.get(id) === done) undoing.delete(id);
  });
  undoing.set(id, done);
}

async function restoreTweaks(id, journal, why) {
  let restored = 0;
  let kept = 0;
  for (const [path, before] of [...journal].reverse()) {
    if (!before) {
      kept += 1; // a flat the package added
      continue;
    }
    try {
      if ((await bridgeCall('tweakdb.set', { path, value: before.value, type: before.type })) === true) restored += 1;
    } catch (err) {
      log(`Could not restore TweakDB flat ${path} of ${id}: ${err.message}`);
    }
  }
  log(`Undid ${restored} TweakDB change(s) of ${id} (${why})${kept ? `; ${kept} flat(s) it added stay until the game closes` : ''}`);
}

// A package's changes are undone once it no longer runs: no window and no mod.
function packageRunning(id) {
  const status = mods?.has(id) ? mods.info(id, []).status : null;
  const running = status === 'running' || status === 'starting' || status === 'not-responding';
  return running || windowsOfPackage(id).length > 0;
}

function checkTweaks() {
  for (const id of [...tweakJournal.keys()]) if (!packageRunning(id)) undoTweaks(id, 'the package stopped');
}

// ---------- hot-loading archives (#12, H1) ----------
//
// A package with the "archives" permission, or an agent through the MCP server, swaps
// archives in the running game. RED Hot Tools does the swap: the host copies the files
// into archive/pc/hot and calls RedHotTools.ReloadArchives() on the game thread. That
// unloads the archives of the same name, moves the new files over them, loads them,
// drops their cached resources and reloads ArchiveXL's extensions, then returns, so the
// answer says what happened. RED Hot Tools' own folder watcher may start the same swap
// first; the two share a lock, and the call returns once both are done. One swap at a time.

// Archives with the game's sound paks (.opuspak, .opusinfo) crashed the game when swapped in
// plainly, and the game kept playing its old sound index (docs/world.md, H1b to H1c-3). So a
// sound swap runs with the game paused and its audio thread held at the end of a frame, and
// the plugin then loads the game's sound index again on that thread and frees the old one
// (opus.cpp, H1d). A game version whose sound tables REDnode does not know refuses them.
// settings.json can change it, for research:
//   "soundPakSwap": "refuse" refuse sound archives, as before 0.26.8
//   "soundPakSwap": "try"    swap them plainly, without the hold or the reload (it has crashed the game)
//   "soundIndexFree": "keep" keep the old index in memory after a reload (about 2.5 MB each)
//   "swapPause": "pause"     pause the game (TimeSystem.SetPausedState) around every swap
// Each swap also asks the plugin to watch for faults (red4ext/logs/rednode-faults.log).
// A sound swap let through logs the game's sound pak index and open paks (opus.state, H1c)
// before the swap, after it, after the reload and after the unpause, to see what changed.
const HOT_TYPES = new Set(['.archive', '.xl', '.yaml', '.yml']);
const PAUSE_SETTLE_MS = 500;
const SOUND_RELOAD_TIMEOUT = 3000;
// What a sound swap's answer says about sounds that played just before it (H1c-3).
const SOUND_SWAP_NOTE =
  'A sound that played just before the swap may keep its old version until the game loads it again (for a weapon, equip it again).';
const HOT_TIMEOUT = 60000;
const HOT_LOG = 'its log in red4ext/plugins/RedHotTools';
let hotQueue = Promise.resolve();

// H2b: what V wears shows a swapped archive's version once its appearance is applied again
// (TransactionSystem.ResetItemAppearance, which keeps the item worn; docs/world.md, "H2
// resumed"). The clothing slots: the base game's, and Equipment-EX's extra slots (its
// OutfitConfig, MIT, by psiberx). A slot the game does not have holds nothing, so the list
// costs nothing without Equipment-EX. Items Equipment-EX hides are left alone, so the refresh
// never shows them: with its slots in use the base slots are skipped, and any item wearing an
// empty_appearance_* is skipped.
const BASE_CLOTHING_SLOTS = ['Head', 'Eyes', 'Chest', 'Torso', 'Legs', 'Feet', 'Outfit', 'UnderwearTop', 'UnderwearBottom'];
const EQUIPMENT_EX_SLOTS = [
  'Head', 'Balaclava', 'Mask', 'Glasses', 'Eyes', 'EyeLeft', 'EyeRight', 'Wreath', 'EarLeft', 'EarRight',
  'Neckwear', 'NecklaceTight', 'NecklaceShort', 'NecklaceLong', 'TorsoUnder', 'TorsoInner', 'TorsoMiddle',
  'TorsoOuter', 'TorsoAux', 'Back', 'Waist', 'ShoulderLeft', 'ShoulderRight', 'ElbowLeft', 'ElbowRight',
  'WristLeft', 'WristRight', 'Hands', 'HandLeft', 'HandRight', 'HandPropLeft', 'HandPropRight', 'FingersLeft',
  'FingersRight', 'FingernailsLeft', 'FingernailsRight', 'LegsInner', 'LegsMiddle', 'LegsOuter', 'ThighLeft',
  'ThighRight', 'KneeLeft', 'KneeRight', 'AnkleLeft', 'AnkleRight', 'Feet', 'ToesLeft', 'ToesRight',
  'ToenailsLeft', 'ToenailsRight', 'BodyUnder', 'BodyInner', 'BodyMiddle', 'BodyOuter',
];
const CLOTHING_SLOTS = [
  ...BASE_CLOTHING_SLOTS.map((n) => `AttachmentSlots.${n}`),
  ...EQUIPMENT_EX_SLOTS.map((n) => `OutfitSlots.${n}`),
];

// Applies the appearance of every piece of clothing V wears again. Every game call of a
// step goes out at once, so the plugin runs them in the same frame: four steps, a few frames.
async function refreshWorn() {
  const started = Date.now();
  const refs = [];
  const call = async (params) => {
    const r = await bridgeCall('rtti.call', params);
    if (r && typeof r.$ref === 'number') refs.push(r.$ref);
    return r;
  };
  const quiet = (p) => p.catch(() => null);
  try {
    const v = await call({ fn: 'GetPlayer', args: [{}] });
    if (!v?.$ref) return { items: [], ms: Date.now() - started };
    const ts = await call({ class: 'GameInstance', fn: 'GetTransactionSystem', args: [{}] });
    const self = { $ref: ts.$ref };
    const held = (await Promise.all(
      CLOTHING_SLOTS.map((slot) => quiet(call({ self, fn: 'GetItemInSlot', args: [v, slot] })).then((item) => (item?.$ref ? { slot, item } : null))),
    )).filter(Boolean);
    const ids = await Promise.all(held.map((w) => quiet(call({ self: { $ref: w.item.$ref }, fn: 'GetItemID', args: [] }))));
    const looks = await Promise.all(held.map((w, i) => (ids[i] ? quiet(call({ self, fn: 'GetItemAppearance', args: [v, ids[i]] })) : null)));
    // With Equipment-EX in use, its slots carry what V shows and the base slots hold items it
    // hides: those are left out, since applying their appearance again could show them (H2b).
    const outfit = held.some((w) => w.slot.startsWith('OutfitSlots.'));
    const shown = held
      .map((w, i) => ({ slot: w.slot, itemID: ids[i], appearance: String(looks[i] ?? '') }))
      .filter((w) => !(outfit && w.slot.startsWith('AttachmentSlots.')))
      .filter((w) => w.itemID && w.appearance && w.appearance !== 'None' && !w.appearance.startsWith('empty_appearance'));
    await Promise.all(shown.map((w) => quiet(call({ self, fn: 'ResetItemAppearance', args: [v, w.itemID] }))));
    return { items: shown.map((w) => ({ slot: w.slot, appearance: w.appearance })), ms: Date.now() - started };
  } finally {
    if (refs.length) bridgeCall('rtti.release', { refs }).catch(() => {});
  }
}

function reloadArchives(caller, params) {
  const run = hotQueue.then(() => swapArchives(caller, params));
  hotQueue = run.catch(() => {});
  return run;
}

// A name alone is an archive already in archive/pc/mod, reloaded as it is; a path is
// absolute, or in the package's folder.
function hotFiles(entry, files) {
  const list = typeof files === 'string' ? [files] : files;
  if (!Array.isArray(list) || !list.length) throw new Error('archives.reload needs a file, or a list of files');
  if (!GAME_DIR) throw new Error('REDnode does not know the game folder');
  const modDir = path.join(GAME_DIR, 'archive', 'pc', 'mod');
  const seen = new Set();
  return list.map((given) => {
    // Windows' "Copy as path" puts the path in double quotes.
    const name = String(given).trim().replace(/^"(.*)"$/, '$1').trim();
    const bare = !/[\\/]/.test(name);
    let file;
    if (bare) file = path.join(modDir, name);
    else if (path.isAbsolute(name)) file = name;
    else if (entry) file = path.resolve(entry.dir, name);
    else throw new Error(`${name}: give a full path, or the name of an archive in archive/pc/mod`);
    if (!HOT_TYPES.has(path.extname(file).toLowerCase())) throw new Error(`${name}: RED Hot Tools swaps .archive, .xl and .yaml files, not "${path.extname(file) || 'no extension'}"`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${name} was not found${bare ? ' in archive/pc/mod' : ''}`);
    const base = path.basename(file).toLowerCase();
    if (seen.has(base)) throw new Error(`Two files are named ${path.basename(file)}: the game knows an archive by its name`);
    seen.add(base);
    return { given: name, file, name: path.basename(file) };
  });
}

async function swapArchives(caller, params) {
  const entry = caller.id ? apps.get(caller.id) : null;
  if (!caller.mcp) {
    if (!entry) throw new Error('Only a package can swap archives');
    if (!isGranted(caller.id, 'archives')) {
      throw new Error(
        entry.manifest.permissions.includes('archives')
          ? `Allow "${entry.manifest.name}" to swap archives in the REDnode launcher first`
          : 'This package does not ask for the "archives" permission in its rednode-app.json',
      );
    }
  }
  const who = caller.mcp ? 'an agent (MCP)' : caller.id;
  const files = hotFiles(entry, params?.files);
  if (!connected) throw new Error('Not connected to the game');
  if (uiState.mainMenu) throw new Error('Load a save first: REDnode swaps archives only in a loaded game');
  let version;
  try {
    version = await bridgeCall('rtti.call', { class: 'RedHotTools', fn: 'Version', args: [] });
  } catch (err) {
    throw new Error(
      'RED Hot Tools is not loaded in the game, and it does the swap: install it from ' +
        `https://github.com/psiberx/cp2077-red-hot-tools/releases and restart the game (${err.message})`,
    );
  }

  // RED Hot Tools before the Edgemodders build can miss a replaced archive and end the game.
  if (!String(version).includes('+edgemodders') && settings.hotToolsLookupCheck !== 'off') {
    const modDir = path.join(GAME_DIR, 'archive', 'pc', 'mod');
    let names = [];
    try {
      names = fs.readdirSync(modDir);
    } catch {
      // no mod folder: every archive is new
    }
    for (const f of files) {
      if (path.extname(f.name).toLowerCase() !== '.archive' || !hotToolsLookupMisses(names, f.name)) continue;
      log(`Archives: refused ${f.name}: RED Hot Tools ${version} would miss it among the mod archives`);
      throw new Error(
        `${f.name} was not swapped: RED Hot Tools ${version} cannot find it among the other archives in archive/pc/mod ` +
          '(a known bug: it searches names case-sensitively, the game sorts them case-insensitively), and the swap would end the game. ' +
          'Install the Edgemodders build of RED Hot Tools, which fixes it: ' +
          'https://github.com/CyberbuildsAI/cp2077-red-hot-tools/releases',
      );
    }
  }

  const soundMode = ['refuse', 'try', 'reload'].includes(settings.soundPakSwap) ? settings.soundPakSwap : 'reload';
  const soundReload = soundMode === 'reload';
  let soundSupport = null; // why REDnode cannot reload this game's sound index, once asked
  let sound = false;
  for (const f of files) {
    if (path.extname(f.file).toLowerCase() !== '.archive') continue;
    let paks;
    try {
      paks = soundPaksIn(f.file);
    } catch (err) {
      throw new Error(`${f.given}: ${err.message}`);
    }
    if (!paks.length) continue;
    const which = `${paks.length} sound pak${paks.length === 1 ? '' : 's'}, such as ${path.win32.basename(paks[0])}`;
    if (soundMode === 'refuse') {
      throw new Error(
        `${f.name} changes the game's sound (${which}), and "soundPakSwap": "refuse" is set. ` +
          'Install it and restart the game instead.',
      );
    }
    if (soundReload && soundSupport === null) {
      try {
        await bridgeCall('opus.state', {});
        soundSupport = '';
      } catch (err) {
        soundSupport = err.message;
      }
    }
    if (soundReload && soundSupport) {
      throw new Error(
        `${f.name} changes the game's sound (${which}), and REDnode cannot swap sound into this game version ` +
          `(${soundSupport}). Install it and restart the game instead.`,
      );
    }
    log(
      soundReload
        ? `Archives: ${f.name} changes ${which}; swapping it with the game paused, then reloading the game's sound index`
        : `Archives: ${f.name} changes ${which}; swapping it plainly, since "soundPakSwap": "try" is set (it has crashed the game)`,
    );
    sound = true;
  }

  const hotDir = path.join(GAME_DIR, 'archive', 'pc', 'hot');
  fs.mkdirSync(hotDir, { recursive: true });
  const names = files.map((f) => f.name).join(', ');
  log(`Archives: ${who} swaps ${names} (RED Hot Tools ${version})`);
  try {
    await bridgeCall('faults.watch', { seconds: 15, label: `swap of ${names}` });
  } catch (err) {
    log(`Archives: no fault watch (${err.message})`);
  }
  // A sound index reload always runs with the game paused.
  const pause = settings.swapPause === 'pause' || (sound && soundReload);
  if (sound) await logSoundState('before the swap', caller);
  if (pause) await pauseGame(true);
  // "reload": the audio thread waits at the end of a frame for the whole swap (H1c-2b), so
  // it reads no pak while RED Hot Tools changes the archives. No wait, no swap.
  const reloadSound = sound && soundReload;
  if (reloadSound && !(await parkAudio(caller))) {
    if (pause) await pauseGame(false);
    throw new Error(`${names} was not swapped: the game's audio thread did not wait for the swap (see the host log)`);
  }
  // Copied only now, so RED Hot Tools' folder watcher cannot start the swap before the pause
  // and the wait; and under another name first, so it never sees half a file.
  for (const f of files) {
    const into = path.join(hotDir, f.name);
    const part = `${into}.rednode-part`;
    fs.copyFileSync(f.file, part);
    fs.renameSync(part, into);
  }
  const started = Date.now();
  let error = null;
  try {
    await bridgeCall('rtti.call', { class: 'RedHotTools', fn: 'ReloadArchives', args: [] }, HOT_TIMEOUT);
  } catch (err) {
    // RED Hot Tools' folder watcher swaps the files on its own within a second: wait for it.
    error = err.message;
    log(`Archives: RedHotTools.ReloadArchives failed (${error}); waiting for its folder watcher`);
    const waitUntil = Date.now() + 10000;
    while (Date.now() < waitUntil && files.some((f) => fs.existsSync(path.join(hotDir, f.name)))) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const ms = Date.now() - started;
  if (sound) await logSoundState('after the swap', caller);
  let soundIndex = null; // 'reloaded' or 'failed', for the answer
  if (reloadSound) {
    if (files.some((f) => !fs.existsSync(path.join(hotDir, f.name)))) {
      soundIndex = await reloadSoundIndex(caller);
      await logSoundState('after the reload', caller);
    } else {
      await releaseAudio('nothing was swapped');
    }
  }
  if (pause) await pauseGame(false);
  if (sound && pause) await logSoundState('after the unpause', caller);
  const reloaded = [];
  const failed = [];
  for (const f of files) {
    const left = path.join(hotDir, f.name);
    if (!fs.existsSync(left)) {
      reloaded.push(f.given);
      continue;
    }
    // Left behind: removed, so RED Hot Tools does not swap it later on its own.
    try {
      fs.rmSync(left);
    } catch {
      // best effort
    }
    failed.push({ file: f.given, why: error ?? `RED Hot Tools did not take it; see ${HOT_LOG}` });
  }
  const summary = `${reloaded.length} reloaded${failed.length ? `, ${failed.length} failed` : ''} in ${ms} ms`;
  log(`Archives: ${summary}${error ? ` (${error})` : ''}`);
  if (caller.id) {
    const why = failed.length ? `: ${failed[0].why}` : '';
    mods?.log(caller.id, failed.length ? 'error' : 'info', `Archives: ${names}: ${summary}${why}`);
    if (soundIndex === 'reloaded') mods?.log(caller.id, 'info', `Archives: ${SOUND_SWAP_NOTE}`);
  }
  const answer = { reloaded, failed, via: 'red-hot-tools', ms };
  if (reloaded.length && params?.refresh !== false) {
    try {
      const r = await refreshWorn();
      answer.refreshed = r.items;
      log(`Archives: refreshed ${r.items.length} worn item${r.items.length === 1 ? '' : 's'} in ${r.ms} ms${r.items.length ? `: ${r.items.map((w) => w.slot).join(', ')}` : ''}`);
      if (caller.id && r.items.length) mods?.log(caller.id, 'info', `Archives: refreshed what V wears (${r.items.map((w) => w.slot).join(', ')})`);
    } catch (err) {
      answer.refreshed = [];
      log(`Archives: no refresh of what V wears (${err.message})`);
    }
  }
  if (sound && reloaded.length) {
    answer.sound = soundIndex === 'reloaded'
      ? { index: 'reloaded', note: SOUND_SWAP_NOTE }
      : { index: soundIndex === 'failed' ? 'failed' : 'not reloaded', note: 'The game still plays its old sound index: install the archive and restart the game to hear it.' };
  }
  return answer;
}

async function logSoundState(when, caller) {
  try {
    const state = await bridgeCall('opus.state', {});
    log(`Archives: sound ${when}: ${state.summary}`);
    if (caller.id) mods?.log(caller.id, 'info', `Sound ${when}: ${state.summary}`);
  } catch (err) {
    log(`Archives: no sound state ${when} (${err.message})`);
  }
}

// "soundPakSwap": "reload": before the swap the plugin holds the game's audio thread at the
// end of a frame (opus.park, at most AUDIO_PARK_CAP ms); after it, the audio thread loads
// the game's sound index again and goes on (opus.reload). The host polls each step.
const AUDIO_PARK_CAP = 3000;
const AUDIO_PARK_WAIT = 1000;

function swapReport(caller) {
  return (level, text) => {
    log(`Archives: ${text}`);
    if (caller.id) mods?.log(caller.id, level, `Archives: ${text}`);
  };
}

async function parkAudio(caller) {
  const report = swapReport(caller);
  try {
    await bridgeCall('opus.park', { capMs: AUDIO_PARK_CAP });
  } catch (err) {
    report('error', `the audio thread was not asked to wait (${err.message})`);
    return false;
  }
  const until = Date.now() + AUDIO_PARK_WAIT;
  for (;;) {
    let status;
    try {
      status = await bridgeCall('opus.reloadStatus', {});
    } catch (err) {
      report('error', `no audio thread status (${err.message})`);
      return false;
    }
    if (status.state === 'parked') {
      log(`Archives: the audio thread waits for the swap (asked ${status.ms} ms ago)`);
      return true;
    }
    if (Date.now() > until) {
      await releaseAudio('it did not stop in time');
      report('error', `the audio thread did not stop for the swap within ${AUDIO_PARK_WAIT} ms`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function releaseAudio(why) {
  try {
    await bridgeCall('opus.reloadStatus', { cancel: true });
    log(`Archives: the audio thread goes on without a reload (${why})`);
  } catch (err) {
    log(`Archives: could not let the audio thread go (${err.message}); it goes on by itself within ${AUDIO_PARK_CAP} ms`);
  }
}

// 'reloaded' or 'failed'.
async function reloadSoundIndex(caller) {
  const report = swapReport(caller);
  try {
    const before = await bridgeCall('opus.reloadStatus', {});
    if (before.state === 'idle' && before.expired) {
      report('error', `the swap took longer than ${AUDIO_PARK_CAP} ms, so the audio thread went on before the reload`);
    }
    await bridgeCall('opus.reload', { free: settings.soundIndexFree !== 'keep' });
  } catch (err) {
    report('error', `no sound index reload (${err.message})`);
    return 'failed';
  }
  const until = Date.now() + SOUND_RELOAD_TIMEOUT;
  for (;;) {
    let status;
    try {
      status = await bridgeCall('opus.reloadStatus', Date.now() > until ? { cancel: true } : {});
    } catch (err) {
      report('error', `no sound index reload status (${err.message})`);
      return 'failed';
    }
    if (status.state === 'done') {
      if (status.loaded) {
        const freed = status.freed ? `the old index freed (${Math.round(status.freedBytes / 1024)} KB)` : status.why || 'the old index kept in memory';
        report('info', `sound index reloaded in ${status.ms} ms (the audio thread waited ${status.parkedMs} ms): ${status.soundsBefore} sounds before, ${status.soundsAfter} after; ${status.retired} pak entries retired; ${freed}`);
        return 'reloaded';
      }
      report('error', `sound index reload failed: ${status.why}; ${status.restored ? 'the old index is back' : 'the old index could NOT be put back'}`);
      return 'failed';
    }
    if (status.state === 'cancelled' || status.state === 'idle') {
      report('error', `the audio thread did not run the sound index reload in ${SOUND_RELOAD_TIMEOUT} ms; cancelled`);
      return 'failed';
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The spike's "swapPause": "pause" setting: the game's own pause, then a moment for the
// audio engine to settle before the swap. Unverified whether it pauses the game's audio.
async function pauseGame(paused) {
  let time = null;
  try {
    time = await bridgeCall('rtti.call', { class: 'GameInstance', fn: 'GetTimeSystem', args: [{}] });
    await bridgeCall('rtti.call', { self: time, fn: 'SetPausedState', args: [paused, 'REDnode'] });
    const now = await bridgeCall('rtti.call', { self: time, fn: 'IsPausedState', args: [] });
    log(`Archives: game ${paused ? 'paused' : 'unpaused'} for the swap (IsPausedState ${now})`);
    if (paused) await new Promise((resolve) => setTimeout(resolve, PAUSE_SETTLE_MS));
  } catch (err) {
    log(`Archives: could not ${paused ? 'pause' : 'unpause'} the game (${err.message})`);
  } finally {
    if (time?.$ref) bridgeCall('rtti.release', { refs: [time.$ref] }).catch(() => {});
  }
}

// ---------- sound per package (Sound API, S1) ----------
//
// Packages play their own audio files through the plugin's engine (audio.cpp). The host
// finds the file (a name from the manifest's "sounds", or a path in the package's folder),
// remembers which package owns each sound, and stops a package's sounds when it stops.
// It also reads the game's volume sliders and sends them to the plugin (sound.mix).

const SOUND_CATEGORIES = ['sfx', 'dialogue', 'music'];
const PLAY_KEYS = ['category', 'volume', 'loop', 'delay', 'start', 'end', 'rate', 'semitones', 'pan', 'fadeIn', 'stream', 'pauseInMenu'];
const soundOwners = new Map(); // sound id -> package id, until the plugin says it ended

function soundFile(entry, name) {
  const file = path.resolve(entry.dir, name);
  const rel = path.relative(entry.dir, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${name} is outside the package's folder`);
  if (!SOUND_TYPES.has(path.extname(file).toLowerCase())) throw new Error(`${name}: REDnode plays .wav, .ogg, .mp3 and .flac files`);
  if (!fs.existsSync(file)) throw new Error(`${name} was not found in the package's folder`);
  return file;
}

async function soundCall(id, method, params) {
  const entry = id ? apps.get(id) : null;
  if (!entry) throw new Error('Only a package can play sounds');
  params = params ?? {};
  switch (method) {
    case 'sound.play': {
      const name = String(params.sound ?? '');
      if (!name) throw new Error('Name a sound: an id from the manifest\'s "sounds", or a file in the package');
      const declared = entry.manifest.sounds?.[name];
      const base = typeof declared === 'string' ? { file: declared } : (declared ?? { file: name });
      const opts = {};
      for (const k of PLAY_KEYS) {
        if (base[k] !== undefined) opts[k] = base[k];
        if (params[k] !== undefined) opts[k] = params[k];
      }
      if (opts.semitones !== undefined) {
        opts.rate = (Number(opts.rate) || 1) * 2 ** (Number(opts.semitones) / 12);
        delete opts.semitones;
      }
      if (opts.category !== undefined && !SOUND_CATEGORIES.includes(opts.category)) {
        throw new Error(`category must be ${SOUND_CATEGORIES.join(', ')}`);
      }
      const file = soundFile(entry, String(base.file ?? name));
      await ensureMix();
      const r = await bridgeCall('sound.play', { ...opts, file, owner: id });
      soundOwners.set(r.id, id);
      return r;
    }
    case 'sound.stop':
    case 'sound.set': {
      if (method === 'sound.stop' && params.id === undefined) return bridgeCall('sound.stop', { owner: id, fadeOut: params.fadeOut ?? 0 });
      const owner = soundOwners.get(params.id);
      if (owner === undefined) return method === 'sound.stop' ? { stopped: 0 } : false; // it has ended
      if (owner !== id) throw new Error('That sound belongs to another package');
      return bridgeCall(method, params);
    }
    case 'sound.list':
      return bridgeCall('sound.list', { owner: id });
    case 'sound.search':
      return searchSounds(params);
    case 'sound.eventSounds':
      // An event's recordings (its variations), from the game's sound index.
      return eventSounds(GAME_DIR, params.event);
    case 'sound.playGame': {
      // One of the game's own sounds by its id, decoded from its pak (game-sounds.js), played
      // by REDnode's engine like a package's file. With "event" instead of "sound", one of that
      // event's recordings: "variation" (from 0) picks one, else they come in turn per package.
      let sound = Number(params.sound);
      let picked = null;
      if (params.event !== undefined) {
        const { event, sounds } = eventSounds(GAME_DIR, params.event);
        if (!sounds.length) {
          throw new Error(`Event ${params.event} has no recordings in the game's sound index: a stop event, or one whose sound lives in a Wwise bank`);
        }
        const key = `${id}|${event}`;
        const at = Number.isInteger(params.variation) ? params.variation : variationTurn.get(key) ?? 0;
        if (at < 0 || at >= sounds.length) throw new Error(`Event ${params.event} has ${sounds.length} recordings: variation runs from 0 to ${sounds.length - 1}`);
        variationTurn.set(key, (at + 1) % sounds.length);
        sound = sounds[at];
        picked = { event, variation: at, variations: sounds.length };
      }
      const found = await gameSoundWav(GAME_DIR, sound);
      const opts = {};
      for (const k of PLAY_KEYS) if (params[k] !== undefined) opts[k] = params[k];
      if (opts.semitones !== undefined) {
        opts.rate = (Number(opts.rate) || 1) * 2 ** (Number(opts.semitones) / 12);
        delete opts.semitones;
      }
      await ensureMix();
      const r = await bridgeCall('sound.play', { ...opts, file: found.file, owner: id });
      soundOwners.set(r.id, id);
      return { id: r.id, sound, seconds: found.seconds, channels: found.channels, pak: found.pak, from: found.from, ...picked };
    }
    case 'sound.event':
    case 'sound.stopEvent': {
      // A game sound event by name, through the game's AudioSystem.Play or Stop: on V
      // ("on": "player") or with no entity ("none", as UI sounds play).
      const name = String(params.name ?? '').trim();
      if (!name) throw new Error('Name a sound event');
      const on = params.on === 'none' ? 'none' : 'player';
      const r = await bridgeCall(method === 'sound.event' ? 'audio.play' : 'audio.stopEvent', { name, on });
      const key = `${on}\n${name}`;
      if (method === 'sound.event') {
        if (!postedEvents.has(id)) postedEvents.set(id, new Set());
        postedEvents.get(id).add(key);
      } else postedEvents.get(id)?.delete(key);
      return r;
    }
    case 'sound.trace': {
      // The Sound Tracer's hooks (soundtrace.cpp): on while any package traces.
      if (params.on === false) {
        if (tracers.delete(id) && !tracers.size) return stopTrace(`${id} stopped it`);
        return { tracing: tracers.size > 0 };
      }
      const r = await bridgeCall('trace.start', {});
      if (!tracers.size) startTraceLog();
      tracers.add(id);
      loadEventNames();
      log(`Sound trace: ${id} traces (PostEvent ${r.postEvent}, lookup ${r.lookup}, hooks ${r.attached.join(', ')})`);
      return r;
    }
    default:
      throw new Error(`${method} is not available to packages`);
  }
}

// Packages tracing the game's sounds (sound.trace), and what the plugin sends them.
// Names for event ids come from REDbridge's list (WolvenKit's, game 1.6), loaded by the host
// when a trace starts, so a tracing package needs no bridge permission for them: each batch
// carries `names` for the events in it that have one. Every post and load also goes to
// rednode-sound-trace.log beside the mod log; the last session's file is kept as .prev.log.
const tracers = new Set();
const variationTurn = new Map(); // "package|event" -> the next variation sound.playGame plays
let eventNames = null; // Map(Wwise id -> event name), once loaded
let eventTags = new Map(); // Wwise id -> the list's tags for it (a category, a weapon...)
let eventNamesLoading = false;
let traceStarted = 0; // the clock time the plugin's trace started, for the log
let traceLogMoved = false;

function loadEventNames() {
  if (eventNames || eventNamesLoading) return;
  eventNamesLoading = true;
  redbridge
    .call('sound.events', {})
    .then((list) => {
      eventNames = new Map(list.events.map((e) => [e.hash >>> 0, e.name]));
      eventTags = new Map(list.events.map((e) => [e.hash >>> 0, e.tags ?? []]));
      log(`Sound trace: ${eventNames.size} event names from REDbridge (WolvenKit's list, game ${list.gameVersion ?? '?'})`);
    })
    .catch((err) => log(`Sound trace: no event names, only ids (${err.message})`))
    .finally(() => (eventNamesLoading = false));
}

// Sound Search (Sound Tools, SP3): every event the game's sound index has recordings for,
// and every event REDbridge's list names, searched by words of the name or its tags, by
// event id, or by sound id (the events that play that recording). Rebuilt when the index
// changes (a hot swap) or the names arrive.
let soundCatalog = null; // { index, named, events: [{ event, name, tags, sounds, text }], bySound }

function soundCatalogNow() {
  const index = gameSoundIndex(GAME_DIR);
  const named = eventNames?.size ?? 0;
  if (soundCatalog?.index === index && soundCatalog.named === named) return soundCatalog;
  const ids = new Set(index.events.keys());
  for (const id of eventNames?.keys() ?? []) ids.add(id);
  const events = [...ids].map((event) => {
    const name = eventNames?.get(event) ?? null;
    const tags = eventTags.get(event) ?? [];
    return { event, name, tags, sounds: index.events.get(event) ?? [], text: `${name ?? ''} ${tags.join(' ')}`.toLowerCase() };
  });
  const bySound = new Map();
  for (const e of events) {
    for (const s of e.sounds) {
      if (!bySound.has(s)) bySound.set(s, []);
      bySound.get(s).push(e);
    }
  }
  soundCatalog = { index, named, events, bySound };
  return soundCatalog;
}

function searchSounds(params) {
  loadEventNames();
  const query = String(params.query ?? '').trim().toLowerCase();
  const limit = Math.min(1000, Math.max(1, Math.floor(Number(params.limit) || 200)));
  const c = soundCatalogNow();
  let hits = [];
  if (/^#?\d+$/.test(query)) {
    const id = Number(query.replace('#', '')) >>> 0;
    hits = [
      ...c.events.filter((e) => e.event === id).map((e) => ({ ...e, match: 'event' })),
      ...(c.bySound.get(id) ?? []).map((e) => ({ ...e, match: 'sound', sound: id })),
    ];
  } else if (query) {
    const words = query.split(/\s+/);
    const first = words[0];
    hits = c.events.filter((e) => e.name && words.every((w) => e.text.includes(w)));
    // Names that start with the first word come first, then the shorter, then by name.
    const rank = (e) => (e.name.toLowerCase().startsWith(first) ? 0 : e.name.toLowerCase().includes(first) ? 1 : 2);
    hits.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name));
    hits = hits.map((e) => ({ ...e, match: 'name' }));
  }
  return {
    total: hits.length,
    results: hits.slice(0, limit).map(({ text: _text, ...e }) => e),
    names: eventNames ? 'ready' : eventNamesLoading ? 'loading' : 'none',
    events: c.events.length,
    recorded: c.index.events.size,
  };
}

function traceLogFile() {
  return path.join(path.dirname(modLogFile()), 'rednode-sound-trace.log');
}

function writeTraceLog(text) {
  try {
    fs.appendFileSync(traceLogFile(), text);
  } catch (err) {
    log(`Sound trace: could not write ${traceLogFile()}: ${err.message}`);
  }
}

function startTraceLog() {
  traceStarted = Date.now();
  if (!traceLogMoved) {
    traceLogMoved = true;
    const file = traceLogFile();
    try {
      if (fs.existsSync(file)) fs.renameSync(file, file.replace(/\.log$/, '.prev.log'));
    } catch (err) {
      log(`Sound trace: could not keep the last trace log: ${err.message}`);
    }
  }
  writeTraceLog(`\n---- Sound trace, ${new Date(traceStarted).toString()} ----\n`);
}

function stopTrace(why) {
  writeTraceLog(`---- stopped at ${clock(Date.now())}: ${why} ----\n`);
  return connected ? bridgeCall('trace.stop', {}) : { tracing: false };
}

function clock(t) {
  const d = new Date(t);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function logTraceBatch(m) {
  const rows = [];
  for (const [ms, event, object, playing] of m.posts ?? []) {
    const name = eventNames?.get(event >>> 0);
    rows.push([ms, `played ${name ?? `#${event}`}${name ? ` (${event})` : ''} on ${object}${playing ? '' : ', failed'}`]);
  }
  for (const [ms, sound, found] of m.loads ?? []) rows.push([ms, `loaded ${sound}${found ? '' : ' (not in the index)'}`]);
  rows.sort((a, b) => a[0] - b[0]);
  let text = rows.map(([ms, line]) => `${clock(traceStarted + ms)} ${line}\n`).join('');
  if (m.dropped) text += `${clock(Date.now())} ${m.dropped} dropped\n`;
  if (text) writeTraceLog(text);
}

function onSoundTrace(m) {
  if (m.posts?.length) {
    try {
      const events = gameSoundIndex(GAME_DIR).events;
      m.recordings = {};
      for (const [, event] of m.posts) m.recordings[event] = events.get(event >>> 0)?.length ?? 0;
    } catch {
      // no game folder or index: the batch goes without counts
    }
  }
  if (eventNames && m.posts?.length) {
    m.names = {};
    for (const [, event] of m.posts) {
      const name = eventNames.get(event >>> 0);
      if (name) m.names[event] = name;
    }
  }
  if (tracers.size) logTraceBatch(m);
  for (const id of tracers) {
    if (!packageRunning(id)) continue;
    mods?.toMod(id, m);
    for (const w of windowsOfPackage(id)) toPage(w, m);
  }
}

function checkTracers() {
  const before = tracers.size;
  for (const id of [...tracers]) if (!packageRunning(id)) tracers.delete(id);
  if (before && !tracers.size) Promise.resolve(stopTrace('its package stopped')).catch(() => {});
}

// Game sound events a package posted (sound.event), as "on\nname": the game plays them, so
// when the package stops the host stops them through AudioSystem.Stop, or a looping one
// (an ambience) would play on after the package is gone.
const postedEvents = new Map(); // package id -> Set

function stopSounds(id, fadeOut = 300) {
  const events = postedEvents.get(id);
  postedEvents.delete(id);
  if (!connected) return;
  for (const key of events ?? []) {
    const [on, name] = key.split('\n');
    bridgeCall('audio.stopEvent', { name, on }).catch(() => {});
  }
  if ([...soundOwners.values()].includes(id)) bridgeCall('sound.stop', { owner: id, fadeOut }).catch(() => {});
}

// ---------- ink (I2a) ----------
//
// The plugin keeps each package's ink trees and builds them again after a save load; the
// host removes them when the package stops (switched off, restarted, hot reloaded, crashed).

const inkUsers = new Set(); // package ids that mounted ink

function clearInk(id) {
  if (!inkUsers.delete(id) || !connected) return;
  bridgeCall('ink.clear', { package: id }).catch(() => {});
}

function checkInk() {
  for (const id of [...inkUsers]) if (!packageRunning(id)) clearInk(id);
}

function checkSounds() {
  for (const id of new Set([...soundOwners.values(), ...postedEvents.keys()])) if (!packageRunning(id)) stopSounds(id);
  if (tracers.size) checkTracers();
}

// The plugin announced that a sound ended: tell its package (its mod and its pages).
function onSoundEnd(m) {
  const owner = soundOwners.get(m.sound) ?? m.owner;
  soundOwners.delete(m.sound);
  if (!owner) return;
  mods?.toMod(owner, m);
  for (const w of windowsOfPackage(owner)) toPage(w, m);
}

// The game's volume sliders, read through its settings system. Read before the first
// sound, and again when the player leaves a menu or loads a save, since a slider may
// have moved.
let mixKnown = false; // the plugin has the sliders of this connection
let mixReading = null;
let lastMix = '';

async function readMix(why = 'before the first sound') {
  const refs = [];
  const call = async (params) => {
    const r = await bridgeCall('rtti.call', params);
    if (r && typeof r === 'object' && typeof r.$ref === 'number') refs.push(r.$ref);
    return r;
  };
  try {
    const settings = await call({ class: 'GameInstance', fn: 'GetSettingsSystem', args: [{}] });
    if (!settings) throw new Error('the game has no settings system yet');
    const groups = {};
    const read = async (group, name) => {
      if (!(group in groups)) groups[group] = await call({ self: { $ref: settings.$ref }, fn: 'GetGroup', args: [group] });
      if (!groups[group]) return undefined;
      const v = await call({ self: { $ref: groups[group].$ref }, fn: 'GetVar', args: [name] });
      return v ? bridgeCall('rtti.call', { self: { $ref: v.$ref }, fn: 'GetValue', args: [] }) : undefined;
    };
    const mix = {
      master: await read('/audio/volume', 'MasterVolume'),
      sfx: await read('/audio/volume', 'SfxVolume'),
      dialogue: await read('/audio/volume', 'DialogueVolume'),
      music: await read('/audio/volume', 'MusicVolume'),
      muteInBackground: await read('/audio/misc', 'MuteInBackground'),
    };
    for (const k of Object.keys(mix)) if (mix[k] === undefined || mix[k] === null) delete mix[k];
    await bridgeCall('sound.mix', mix);
    mixKnown = true;
    const text = `master ${mix.master}, effects ${mix.sfx}, dialogue ${mix.dialogue}, music ${mix.music}${mix.muteInBackground ? ', muted in the background' : ''}`;
    // Every read is logged, so a test can tell a read that saw no change from no read.
    log(`Sound: the game's volumes are ${text} (${why}${text === lastMix ? ', unchanged' : ''})`);
    lastMix = text;
  } finally {
    if (refs.length) bridgeCall('rtti.release', { refs }).catch(() => {});
  }
}

function ensureMix() {
  if (mixKnown) return Promise.resolve();
  if (!mixReading) {
    mixReading = readMix()
      .catch((err) => log(`Sound: could not read the game's volumes (${err.message}); playing at full volume`))
      .finally(() => {
        mixReading = null;
      });
  }
  return mixReading;
}

// Reads the volumes when a save loads, so they are known before the first sound, and
// after each menu once known (the player may have moved a slider). After a load the
// game takes a moment to answer (the S1 spike saw a timeout), so that read waits longer
// and tries twice.
function onUiStateForSound(before, after) {
  if (before.mainMenu && !after.mainMenu) setTimeout(() => readMixLogged('a save loaded', 2), 5000);
  else if (before.menu && !after.menu && mixKnown) setTimeout(() => readMixLogged('a menu closed', 1), 1500);
}
function readMixLogged(why, tries) {
  readMix(why).catch((err) => {
    if (tries > 1) setTimeout(() => readMixLogged(why, tries - 1), 5000);
    else log(`Sound: could not read the game's volumes after ${why} (${err.message})`);
  });
}

ipcMain.handle('rednode:call', (event, method, params) => {
  let id = null;
  try {
    id = packageOf(event);
  } catch {
    // not a package's page
  }
  return packageCall(id, method, params);
});

ipcMain.handle('rednode:state', () => hostState());

// Drag handles reported by preload.js: flat [x, y, w, h, ...] in page pixels.
ipcMain.on('rednode:drag-regions', (event, regions) => {
  const w = windowFor(event.sender);
  if (!w || !Array.isArray(regions) || w.app.debugger) return; // the debugger's title bar is the host's
  w.dragRegions = regions.map((n) => Math.round(Number(n) || 0));
  sendJson({ cmd: 'window.drag', window: w.id, regions: w.dragRegions });
});

// ---------- the launcher's app list (only the built-in launcher may use it) ----------

function fromLauncher(event) {
  const w = windowFor(event.sender);
  if (!w?.app.pinned && !w?.app.manager) throw new Error('Only the REDnode launcher and Mod Manager can manage apps');
}

// The tasks and tools calls: the launcher, the Mod Manager, or a package the player
// allowed "admin" (the Admin Tools pack's Task Manager and Tools Manager, or another's).
// Answers the caller's name, for the log.
function fromAdmin(event) {
  const w = windowFor(event.sender);
  if (w?.app.pinned || w?.app.manager) return w.app.manifest.name;
  const id = w && (w.app.built ? built.get(w.app.built)?.modId : w.app.manifest.id);
  const entry = id && apps.get(id);
  if (entry && isGranted(id, 'admin')) return entry.manifest.name;
  if (entry?.manifest.permissions.includes('admin')) {
    throw new Error(`${entry.manifest.name} needs the admin permission: allow it in the Mod Manager`);
  }
  throw new Error('Only a package that asks for the admin permission, once the player allows it, can manage other packages');
}

function isEnabled(entry) {
  const id = entry.manifest.id;
  return entry.manifest.entry ? !!windowOfApp(id) : mods.isEnabled(id);
}

function appList() {
  const metrics = app.getAppMetrics();
  return [...apps.values()]
    .filter((a) => !a.pinned)
    .map((entry) => {
      const m = entry.manifest;
      return {
        id: m.id,
        name: m.name,
        version: m.version,
        author: m.author,
        description: m.description,
        kind: m.kind,
        builtin: entry.builtin,
        // A development copy (#16), loaded from one of the player's development folders.
        dev: !!entry.dev,
        dir: entry.builtin ? null : entry.dir,
        hiddenCopies: hiddenCopies.get(m.id) ?? [],
        app: !!m.entry,
        open: isEnabled(entry),
        inLauncher: isInLauncher(entry),
        onHud: isOnHud(entry),
        isNew: isNew(entry),
        manager: !!entry.manager,
        // In the tool layer (the front permission): its windows show in every space.
        tool: isGranted(m.id, 'front'),
        mod: isMod(m) ? mods.info(m.id, metrics) : null,
        // Its service (SV1): the functions it offers other packages, once its service file has loaded.
        service: m.service ? serviceSummary(m.id, m.service) : null,
        closedWindows: [...playerClosed.values()].filter((c) => c.modId === m.id).map((c) => c.win),
        hasWindow: windowsOfPackage(m.id).length > 0,
        // Its space: set for the package, else the one its open windows share, else null.
        space: (() => {
          const s = spaces();
          if (s.of[m.id]) return s.of[m.id];
          const of = [...new Set(windowsOfPackage(m.id).map((w) => spaceOf(w)).filter(Boolean))];
          return of.length === 1 ? of[0] : of.length > 1 ? 'mixed' : null;
        })(),
        requires: requirementsOf(m.id),
        bridge: m.permissions.includes('bridge') || needsBridge(m) ? bridgeInfo() : null,
        permissions: m.permissions.map((name) => ({ name, what: PERMISSIONS[name], granted: isGranted(m.id, name) })),
      };
    });
}

ipcMain.handle('rednode:apps:list', (event) => {
  fromLauncher(event);
  return appList();
});

// Opens or closes an app, or starts or stops a mod, and remembers it. The launcher and the MCP server use it.
function setPackageOpen(id, open) {
  const entry = apps.get(id);
  if (!entry || entry.pinned) throw new Error(`No app or mod "${id}"`);
  const wasOn = isEnabled(entry);
  settings.apps[id] = { ...settings.apps[id], open: !!open };
  // Closed once, the Welcome window no longer opens by itself.
  if (id === 'welcome' && entry.builtin && !open && !settings.welcomed) {
    settings.welcomed = true;
    log('Welcome: closed; it opens again only from the launcher');
  }
  // Switching a mod on (from off) shows the windows the player had closed.
  if (open && !wasOn) settings.closedWindows = (settings.closedWindows ?? []).filter((k) => !k.startsWith(`${id}~`));
  writeJson('settings.json', settings);
  if (entry.manifest.entry) {
    if (open) openApp(entry);
    else closeApp(id);
  }
  if (isMod(entry.manifest)) mods.setEnabled(id, !!open);
  if (!open) services?.removed(id);
}

ipcMain.handle('rednode:apps:set-open', (event, id, open) => {
  fromLauncher(event);
  setPackageOpen(id, open);
  return appList();
});

// ---------- the debugger (O9) ----------
//
// Chromium's DevTools for an overlay app's page (a mod's builder window too): in the
// game, in the built-in Debugger window, whose webview receives the DevTools
// (setDevToolsWebContents); or on the desktop, in DevTools' own window, opened without
// taking focus from the game.

const DEBUGGER_BAR = 30; // the title bar the host adds above DevTools, in page pixels

// The windows of a package: its app window and its mod windows, never debuggers.
function windowsOfPackage(id) {
  return [...windows.values()].filter(
    (w) => !w.app.debugger && (w.app.manifest.id === id || w.app.manifest.id.startsWith(`${id}~`)),
  );
}

function openDebugger(target, where) {
  const wc = target.win.webContents;
  const name = target.app.manifest.name;
  if (where === 'desktop' || windowed) {
    wc.openDevTools({ mode: 'detach', activate: false });
    log(`Debugger for ${target.app.manifest.id} opened on the desktop`);
    return;
  }
  const key = `debugger~${target.id}`;
  if (windowOfApp(key)) return;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  openApp({
    manifest: {
      id: key, name: `Debugger: ${name}`, entry: 'devtools', kind: 'window', width: 1000, height: 620,
      anchor: 'center', x: 0, y: 0, hideWith: [], permissions: [], provides: [],
    },
    dir: __dirname,
    builtin: true,
    debugger: true,
    debugTarget: target.id,
  });
}

// ---------- Node mod debugging ----------
//
// A mod with its Debug switch on runs alone with Node's inspector (mods.js). Its DevTools
// is Chromium's own Node front end, loaded from the devtools:// scheme Electron serves.

function nodeDevToolsUrl(inspector) {
  return `devtools://devtools/bundled/js_app.html?ws=${encodeURIComponent(inspector.replace(/^ws:\/\//, ''))}`;
}

const nodeDebuggerKey = (id) => `debugger~node~${id}`;

function openNodeDebugger(id, where) {
  const info = mods.has(id) ? mods.info(id, []) : null;
  if (!info?.inspector) throw new Error(`"${id}" is not running with the debugger. Turn its Debug switch on first.`);
  const name = apps.get(id)?.manifest.name ?? id;
  if (where === 'desktop' && !windowed) {
    // A normal window on the desktop, shown without taking focus from the game.
    const win = new BrowserWindow({
      width: 1000,
      height: 640,
      show: false,
      title: `Node debugger: ${name}`,
      backgroundColor: '#08090d',
      // preload.js hides Node's "internal" console context here too.
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    win.loadURL(nodeDevToolsUrl(info.inspector));
    win.once('ready-to-show', () => win.showInactive());
    log(`Node debugger for ${id} opened on the desktop`);
    return;
  }
  const key = nodeDebuggerKey(id);
  const open = windowOfApp(key);
  if (open && open.app.inspector === info.inspector) return;
  if (open) closeApp(key); // the mod restarted: its inspector has a new address
  openApp({
    manifest: {
      id: key, name: `Node debugger: ${name}`, entry: 'devtools', kind: 'window', width: 1000, height: 620,
      anchor: 'center', x: 0, y: 0, hideWith: [], permissions: [], provides: [],
    },
    dir: __dirname,
    builtin: true,
    debugger: true,
    inspector: info.inspector,
  });
  log(`Node debugger for ${id} opened in the game`);
}

// A restarted mod has a new inspector address: its in-game debugger follows it, and
// closes when the Debug switch goes off.
function syncNodeDebuggers() {
  for (const w of [...windows.values()]) {
    if (!w.app.inspector) continue;
    const id = w.app.manifest.id.slice('debugger~node~'.length);
    const info = mods.has(id) ? mods.info(id, []) : null;
    if (!info?.debug) closeApp(w.app.manifest.id);
    else if (info.inspector && info.inspector !== w.app.inspector) openNodeDebugger(id, 'overlay');
  }
}

ipcMain.handle('rednode:mods:debug', (event, id, on) => {
  fromLauncher(event);
  if (!mods.has(id)) throw new Error(`No mod "${id}"`);
  mods.setDebug(id, !!on);
  if (!on) closeApp(nodeDebuggerKey(id));
  return appList();
});

ipcMain.handle('rednode:mods:inspect', (event, id, where) => {
  fromLauncher(event);
  openNodeDebugger(String(id), where === 'desktop' ? 'desktop' : 'overlay');
  return true;
});

ipcMain.handle('rednode:mods:copy-inspector', (event, id) => {
  fromLauncher(event);
  const inspector = mods.has(id) ? mods.info(id, []).inspector : null;
  if (!inspector) throw new Error(`"${id}" is not running with the debugger`);
  clipboard.writeText(inspector);
  return inspector;
});

// ---------- Developer mode ----------
//
// Off by default. On, every rn-window title bar shows a debug button next to close.

ipcMain.handle('rednode:host:developer', (event, on) => {
  fromLauncher(event);
  if (typeof on === 'boolean' && on !== !!settings.developer) {
    settings.developer = on;
    writeJson('settings.json', settings);
    log(`Developer mode: ${on ? 'on' : 'off'}`);
    toAllPages({ event: 'developer', on });
  }
  return !!settings.developer;
});

// A window's own debug button: the Node debugger for a mod window whose mod runs with
// the debugger, otherwise Chromium's DevTools for the page.
ipcMain.handle('rednode:app:debug', (event) => {
  if (!settings.developer) throw new Error('Developer mode is off');
  const w = windowFor(event.sender);
  if (!w || w.app.debugger) return false;
  const modId = w.app.built ? built.get(w.app.built)?.modId : null;
  if (modId && mods.has(modId) && mods.info(modId, []).inspector) openNodeDebugger(modId, 'overlay');
  else openDebugger(w, 'overlay');
  return true;
});

// DevTools runs in the debugger window's own page: the main page of an off-screen
// window is what REDnode draws and sends input to. (A webview inside a page, as in
// Electron's example, painted once and took no input off screen: found in the mock.)
function attachDevTools(w) {
  const target = windows.get(w.app.debugTarget);
  if (!target || target.win.isDestroyed()) return;
  const wc = w.win.webContents;
  target.win.webContents.setDevToolsWebContents(wc);
  // Undocked: DevTools fills the view, instead of leaving room for a page beside it.
  target.win.webContents.openDevTools({ mode: 'detach', activate: false });
  dressDebugger(w);
}

// The REDnode title bar above a DevTools page, with a close button and a drag area.
function dressDebugger(w) {
  const wc = w.win.webContents;
  w.dragRegions = [0, 0, w.app.manifest.width - DEBUGGER_BAR - 8, DEBUGGER_BAR];
  if (connected) sendJson({ cmd: 'window.drag', window: w.id, regions: w.dragRegions });
  wc.on('dom-ready', () => {
    const title = JSON.stringify(w.app.manifest.name.toUpperCase());
    wc.insertCSS(`
      html { background: #08090d !important; }
      body { position: fixed !important; top: ${DEBUGGER_BAR}px !important; left: 0 !important; right: 0 !important;
        bottom: 0 !important; width: auto !important; height: auto !important; }
      #rednode-bar { position: fixed; top: 0; left: 0; right: 0; height: ${DEBUGGER_BAR}px; z-index: 2147483647;
        display: flex; align-items: center; gap: 10px; padding: 0 6px 0 12px; box-sizing: border-box;
        font: 700 13px "Segoe UI", sans-serif; letter-spacing: .1em; }
      #rednode-bar i { width: 8px; height: 8px; }
      #rednode-bar span { flex: 1; }
      #rednode-bar button { width: 22px; height: 22px; padding: 0; background: transparent; font: 14px monospace; cursor: pointer; }`);
    themeDebuggerBar(w);
    wc.executeJavaScript(`(() => {
      if (document.getElementById('rednode-bar')) return;
      const bar = document.createElement('div');
      bar.id = 'rednode-bar';
      bar.innerHTML = '<i></i><span></span><button title="Close">\u2715</button>';
      bar.querySelector('span').textContent = ${title};
      bar.querySelector('button').addEventListener('click', () => console.log('${DEBUGGER_CLOSE}'));
      document.documentElement.appendChild(bar);
    })()`).catch(() => {});
  });
  // The close button reports through the console: DevTools' page has no rednode bridge.
  wc.on('console-message', ({ message }) => {
    if (message === DEBUGGER_CLOSE) closeApp(w.app.manifest.id);
  });
}
const DEBUGGER_CLOSE = '__rednode_close_debugger__';

// The debugger's title bar in the player's theme, as the UI kit's rn-window draws it.
const DEBUGGER_COLORS = {
  rednode: { bg: 'linear-gradient(90deg, rgba(252,238,10,.14), transparent 60%), #08090d', fg: '#e3e6ee', mark: '#fcee0a',
    line: '#262c3d', dim: '#8a93a8', hoverBg: '#fcee0a', hoverFg: '#08090d' },
  hud: { bg: 'linear-gradient(90deg, rgba(255,97,88,.14), transparent 60%), #0c0608', fg: '#f2e4e2', mark: '#ff6158',
    line: 'rgba(255,97,88,.38)', dim: '#c97670', hoverBg: '#ff6158', hoverFg: '#160708' },
  edge: { bg: '#fcee0a', fg: '#08090d', mark: '#08090d', line: 'rgba(8,9,13,.4)', dim: 'rgba(8,9,13,.62)',
    hoverBg: '#08090d', hoverFg: '#fcee0a' },
};

function themeDebuggerBar(w) {
  const wc = w.win.webContents;
  if (wc.isDestroyed()) return;
  const c = DEBUGGER_COLORS[theme()];
  const old = w.barCss;
  wc.insertCSS(`
    #rednode-bar { background: ${c.bg}; color: ${c.fg}; border-bottom: 1px solid ${c.line}; }
    #rednode-bar i { background: ${c.mark}; }
    #rednode-bar button { border: 1px solid ${c.line}; color: ${c.dim}; }
    #rednode-bar button:hover { background: ${c.hoverBg}; border-color: ${c.hoverBg}; color: ${c.hoverFg}; }`)
    .then((key) => {
      w.barCss = key;
      if (old) wc.removeInsertedCSS(old).catch(() => {});
    })
    .catch(() => {});
}

// Opens the debugger for a package's window (the first, or the one named).
function debugPackage(id, where = 'overlay', windowId) {
  const all = windowsOfPackage(id);
  const target = windowId ? all.find((w) => w.app.manifest.id === windowId) : all[0];
  if (!target) throw new Error(`"${id}" has no open window to debug`);
  openDebugger(target, where);
}

ipcMain.handle('rednode:apps:inspect', (event, id, where) => {
  fromLauncher(event);
  debugPackage(String(id), where === 'desktop' ? 'desktop' : 'overlay');
  return true;
});


ipcMain.handle('rednode:apps:pin', (event, id, where, on) => {
  fromLauncher(event);
  setPin(id, where, on);
  return appList();
});

ipcMain.handle('rednode:apps:seen', (event, ids) => {
  fromLauncher(event);
  markSeen(Array.isArray(ids) ? ids.map(String) : []);
  return appList();
});

// Shows a mod window the player closed again: the mod reopens it as it is now.
ipcMain.handle('rednode:apps:show-window', (event, id, win) => {
  fromLauncher(event);
  rememberClosed(builtKey(id, win), false);
  if (playerClosed.has(builtKey(id, win))) mods.toMod(id, { event: 'ui', window: String(win), type: 'show' });
  return appList();
});

// ---------- window actions and spaces (O11) ----------

// A window's own title bar: what it may offer, and its actions.
ipcMain.handle('rednode:app:info', (event) => {
  const w = windowFor(event.sender);
  return w ? windowInfo(w) : null;
});

ipcMain.handle('rednode:app:action', (event, action, arg) => {
  const w = windowFor(event.sender);
  if (!w) throw new Error('Unknown window');
  const key = spaceKey(w);
  if (action === 'space') {
    moveToSpace(key, String(arg));
  } else if (action === 'pin-hud') {
    const owner = ownerOf(w);
    if (!owner || owner.pinned) throw new Error('This window cannot be pinned');
    setPin(owner.manifest.id, 'hud', !!arg);
  } else if (action === 'reset') {
    delete positions[key];
    writeJson('window-positions.json', positions);
    if (connected) openInGame(w); // back to its anchor
    log(`Reset the position of ${key}`);
    toPage(w, { event: 'window-info', info: windowInfo(w) });
  } else {
    throw new Error(`Unknown window action "${action}"`);
  }
  return windowInfo(w);
});

// Pointer lock (#11): a page asks the plugin to hold the cursor for its window. The answer
// comes back as {event: 'pointer-lock', locked}; the page's Pointer Lock API follows it.
ipcMain.handle('rednode:app:pointer-lock', (event, on) => {
  const w = windowFor(event.sender);
  if (!w) throw new Error('Unknown window');
  if (!connected) throw new Error('Pointer lock needs the game');
  sendJson({ cmd: on ? 'pointer.lock' : 'pointer.unlock', window: w.id });
  return true;
});

// The launcher and the Mod Manager: list, switch, make, rename, delete, move.
ipcMain.handle('rednode:spaces', (event, op, a, b) => {
  fromLauncher(event);
  const s =
    op === 'switch' ? switchSpace(String(a))
    : op === 'create' ? createSpace(a)
    : op === 'rename' ? renameSpace(String(a), b)
    : op === 'delete' ? deleteSpace(String(a))
    : op === 'move' ? moveToSpace(String(a), String(b))
    : spaces();
  return { names: [...s.names], current: s.current };
});

// An app's own close button: the same as switching it off in the launcher.
ipcMain.on('rednode:app:close', (event) => {
  const w = windowFor(event.sender);
  if (w?.app.debugger) {
    closeApp(w.app.manifest.id);
    return;
  }
  if (!w || w.app.pinned || w.app.built || !apps.has(w.app.manifest.id)) return;
  setPackageOpen(w.app.manifest.id, false);
});

// ---------- the kernel MCP server ----------

// The external switch (Claude Code on the PC) and packages granted "mcp" each keep the server running.
// Packages get their own token, made each run, so the switch can stay off for them.
const packageTokens = new Map(); // package id -> token
function mcpConfig() {
  const external = mcpArg ? mcpArg !== 'off' : app.isPackaged ? !!settings.mcp?.enabled : true;
  const internal = new Set(
    [...packageTokens].filter(([id]) => isGranted(id, 'mcp') && apps.has(id)).map(([, token]) => token),
  );
  return {
    enabled: external || internal.size > 0,
    external,
    port: Number(settings.mcp?.port) || MCP_PORT,
    token: settings.mcp?.token,
    internal,
  };
}

function isGranted(id, permission) {
  const entry = apps.get(id);
  return !!entry && entry.manifest.permissions.includes(permission) && !!settings.apps[id]?.granted?.includes(permission);
}

// ---------- what a package may use: its data folder, its secrets, the kernel's tools ----------

/** A folder of the package's own, outside the apps folder, that survives updates. */
function dataDirOf(id) {
  const dir = path.join(app.getPath('userData'), 'packages', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Secrets, such as an API key, encrypted with the Windows account's key (safeStorage)
// and kept per package: a package reads only its own.
function readSecrets() {
  return readJson('secrets.json', {});
}
function secret(id, op, name, value) {
  if (typeof name !== 'string' || !/^[\w.-]{1,64}$/.test(name)) throw new Error('A secret name is 1 to 64 letters, digits, _ . or -');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption is not available on this PC');
  const all = readSecrets();
  const mine = all[id] ?? {};
  if (op === 'get') {
    if (!mine[name]) return null;
    try {
      return safeStorage.decryptString(Buffer.from(mine[name], 'base64'));
    } catch {
      // Saved under another Windows account or REDnode data folder: it counts as unset,
      // so the package asks for it again instead of failing.
      log(`[${id}] The secret ${name} could not be decrypted; it counts as unset`);
      return null;
    }
  }
  if (op === 'set') {
    if (typeof value !== 'string') throw new Error('A secret is a string');
    mine[name] = safeStorage.encryptString(value).toString('base64');
  } else if (op === 'delete') {
    delete mine[name];
  } else {
    throw new Error(`Unknown secret operation ${op}`);
  }
  all[id] = mine;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataFile('secrets.json'), JSON.stringify(all, null, 2));
  return null;
}

/** The kernel MCP server's address and a token for one package, if the player granted it. */
function mcpFor(id) {
  if (!isGranted(id, 'mcp')) {
    const entry = apps.get(id);
    throw new Error(
      entry?.manifest.permissions.includes('mcp')
        ? `Allow "${entry.manifest.name}" to use REDnode's tools in the REDnode launcher first`
        : 'This package does not ask for the "mcp" permission in its rednode-app.json',
    );
  }
  if (!packageTokens.has(id)) packageTokens.set(id, crypto.randomBytes(24).toString('base64url'));
  const c = mcpConfig();
  mcp.configure(c);
  return { url: `http://127.0.0.1:${c.port}/mcp`, headers: { Authorization: `Bearer ${packageTokens.get(id)}` } };
}

/**
 * REDbridge for one package, if the player allowed it: op "status" says whether it is
 * installed (and fails with how to get it when not); op "call" calls a method.
 */
async function bridgeFor(id, op, method, params) {
  if (!isGranted(id, 'bridge')) {
    const entry = apps.get(id);
    throw new Error(
      entry?.manifest.permissions.includes('bridge')
        ? `Allow "${entry.manifest.name}" to use REDbridge in the Mod Manager first`
        : 'This package does not ask for the "bridge" permission in its rednode-app.json',
    );
  }
  if (op === 'status') {
    const s = redbridge.status();
    if (!s.found) throw new Error(NOT_INSTALLED);
    return { version: s.version, source: s.source, running: s.running };
  }
  // The first call of a session also asks GitHub whether a newer REDbridge is out; the
  // Mod Manager then offers Update REDbridge. Never automatic.
  if (!bridgeLatest) latestBridge().catch((err) => log(`REDbridge: could not ask GitHub for a newer release: ${err.message}`));
  return redbridge.call(String(method), params ?? {});
}

ipcMain.handle('rednode:pkg:bridge', (event, op, method, params) => bridgeFor(packageOf(event), op, method, params));
ipcMain.handle('rednode:pkg:solo', (event, on) => setSolo(packageOf(event), !!on));
// The launcher's End solo button.
ipcMain.handle('rednode:host:end-solo', (event) => {
  fromLauncher(event);
  endSolo('the player ended it');
  return true;
});
ipcMain.handle('rednode:pkg:requires', (event) => requirementsOf(packageOf(event)));

// The package a page belongs to: its app, or the mod that built it.
function packageOf(event) {
  const w = windowFor(event.sender);
  if (!w) throw new Error('Unknown window');
  return w.app.built ? built.get(w.app.built)?.modId : w.app.manifest.id;
}

ipcMain.handle('rednode:pkg:secret', (event, op, name, value) => secret(packageOf(event), op, name, value));

// ---------- agent: packages asking the AI assistant (REDagent C5) ----------
//
// A package that asks for the "agent" permission, once the player allows it, can
// ask questions with agent.ask in the rednode package. The host passes each one to
// the package that "provides": ["agent"] and serves (REDagent), and streams its
// answer back to the asker. The provider decides the model, the tools and the
// spending limits.
//   asker -> host:    { op: 'ask', aid, prompt, context } or { op: 'cancel', aid }
//   host -> asker:    { event: 'agent', aid, type: 'text' | 'done' | 'error', text, cost, error }
//   provider -> host: { op: 'serve' } once, then { op: 'reply', rid, type, text, cost, error }
//   host -> provider: { event: 'agent-request', rid, from: { id, name }, prompt, context }
//                     and { event: 'agent-cancel', rid }

let agentProvider = null; // the package id that serves questions
let nextAgentAsk = 1;
const agentAsks = new Map(); // rid -> { from, aid, send, at }

function onAgent(id, msg, send) {
  const entry = apps.get(id);
  switch (msg?.op) {
    case 'serve':
      if (entry?.manifest.provides.includes('agent')) {
        agentProvider = id;
        log(`${id} answers agent questions`);
      } else {
        log(`${id} tried to answer agent questions, but its manifest does not say "provides": ["agent"]`);
      }
      return;
    case 'ask': {
      const fail = (error) => send({ event: 'agent', aid: msg.aid, type: 'error', error });
      if (!entry?.manifest.permissions.includes('agent')) {
        fail(`"${id}" must ask for the agent permission: "permissions": ["agent"] in its rednode-app.json`);
      } else if (!isGranted(id, 'agent')) {
        fail('The player has not allowed this package to ask the assistant yet. They can allow it in the launcher or the Mod Manager.');
      } else if (!agentProvider || !mods.isEnabled(agentProvider)) {
        fail('No assistant is running. Install REDagent and switch it on.');
      } else {
        const rid = nextAgentAsk++;
        agentAsks.set(rid, { from: id, aid: msg.aid, send, at: Date.now() });
        mods.toMod(agentProvider, {
          event: 'agent-request',
          rid,
          from: { id, name: entry.manifest.name },
          prompt: String(msg.prompt ?? '').slice(0, 20000),
          context: msg.context,
        });
      }
      return;
    }
    case 'cancel':
      for (const [rid, a] of agentAsks) {
        if (a.from === id && a.aid === msg.aid && agentProvider) mods.toMod(agentProvider, { event: 'agent-cancel', rid });
      }
      return;
    case 'reply': {
      if (id !== agentProvider) return;
      const a = agentAsks.get(msg.rid);
      if (!a) return;
      a.send({ event: 'agent', aid: a.aid, type: msg.type, text: msg.text, cost: msg.cost, error: msg.error });
      if (msg.type !== 'text') agentAsks.delete(msg.rid);
      return;
    }
    default:
      return;
  }
}

// A question the provider never finished (it stopped or crashed) fails after 5 minutes.
setInterval(() => {
  for (const [rid, a] of agentAsks) {
    if (Date.now() - a.at < 5 * 60 * 1000) continue;
    agentAsks.delete(rid);
    a.send({ event: 'agent', aid: a.aid, type: 'error', error: 'The assistant did not answer within 5 minutes.' });
  }
}, 30000);

// From overlay pages: the same messages, answered to the asking window.
ipcMain.on('rednode:agent', (event, msg) => {
  let id;
  try {
    id = packageOf(event);
  } catch {
    return;
  }
  const w = windowFor(event.sender);
  onAgent(id, msg, (m) => {
    if (w && !w.win.isDestroyed()) toPage(w, m);
  });
});

// ---------- services: packages calling each other (SV1, docs/services.md) ----------
//
// From a package's Node mod (through mods.js) or its pages (rednode:service):
//   { op: 'connect', provider }                    -> { id, name, version, functions }
//   { op: 'call', provider, fn, args, cid, timeoutMs } -> the result
//   { op: 'cancel', cid }                           a caller's AbortSignal fired
//   { op: 'emit', name, data }                      a provider's event (Node mods only)
// The router lives in services.js; this ties it to packages.

const callsByCid = new Map(); // `${caller}:${cid}` -> the router's sid, so a caller can cancel

// The JSDoc reader (SV2): the rednode package's describe.js, an ES module, loaded at start.
let describer = null;
const describerReady = import(require('node:url').pathToFileURL(path.join(SDK_DIR, 'describe.js')).href).then(
  (m) => (describer = m),
  (err) => log(`Service descriptions are off: ${err.message}`),
);

// A service's description: service.json beside the manifest when the author wrote one
// (a bundled or TypeScript package, whose built file has lost its comments), else the
// JSDoc in the service file itself.
function describeService(id, functions) {
  const entry = apps.get(id);
  if (!entry?.manifest.service || !describer) return null;
  const json = path.join(entry.dir, 'service.json');
  if (fs.existsSync(json)) {
    const d = JSON.parse(fs.readFileSync(json, 'utf8'));
    if (d?.format !== 1 || typeof d.functions !== 'object') throw new Error('service.json is not format 1 (make it with rednode describe)');
    const warnings = functions.filter((f) => !d.functions[f]).map((f) => `${f} is not in service.json; its calls are not checked`);
    return { ...d, warnings };
  }
  return describer.describeSource(fs.readFileSync(path.join(entry.dir, entry.manifest.service), 'utf8'), functions);
}

function onService(id, msg) {
  const entry = apps.get(id);
  if (!entry) throw new Error('Unknown package');
  const caller = { id, name: entry.manifest.name };
  switch (msg?.op) {
    case 'connect':
      return services.connect(id, String(msg.provider ?? ''));
    case 'call': {
      const key = `${id}:${msg.cid}`;
      return services
        .call(caller, String(msg.provider ?? ''), msg.fn, msg.args, {
          timeoutMs: msg.timeoutMs,
          onSid: (sid) => callsByCid.set(key, sid),
        })
        .finally(() => callsByCid.delete(key));
    }
    case 'cancel': {
      const sid = callsByCid.get(`${id}:${msg.cid}`);
      if (sid) services.cancel(sid);
      return null;
    }
    case 'emit':
      services.emit(id, msg.name, msg.data);
      return null;
    case 'describe':
      return services.describe(String(msg.provider ?? ''));
    default:
      throw new Error(`Unknown service request "${msg?.op}"`);
  }
}

// Pages call services too; only a Node mod can offer one (emit is refused here).
ipcMain.handle('rednode:service', async (event, msg) => {
  const id = packageOf(event);
  if (msg?.op === 'emit') throw new Error('Only a package\'s Node mod can send service events: emit from its service file or main');
  try {
    return await onService(id, msg);
  } catch (err) {
    throw new Error(err.message); // without Electron's remote-method wrapper, which cleanError strips anyway
  }
});

// ---------- the Task Manager (SV1) ----------
//
// Rates are sampled every second over the last 5 seconds, so any number of Task Manager
// windows read the same numbers: game calls and their round trip per package, and
// service calls in and out.

const RATE_SECONDS = 5;
const rateRing = []; // the last RATE_SECONDS samples: { game: { id: { calls, ms } }, svc: { id: { in, out, errors, ms } } }
setInterval(() => {
  rateRing.push({ game: Object.fromEntries(gameCounts), svc: services ? services.takeCounters() : {} });
  gameCounts.clear();
  if (rateRing.length > RATE_SECONDS) rateRing.shift();
}, 1000);

function ratesOf(id) {
  const n = rateRing.length || 1;
  let calls = 0, ms = 0, sin = 0, sout = 0, errors = 0, sms = 0;
  for (const r of rateRing) {
    calls += r.game[id]?.calls ?? 0;
    ms += r.game[id]?.ms ?? 0;
    sin += r.svc[id]?.in ?? 0;
    sout += r.svc[id]?.out ?? 0;
    errors += r.svc[id]?.errors ?? 0;
    sms += r.svc[id]?.ms ?? 0;
  }
  return {
    gameCallsPerSec: Math.round((calls / n) * 10) / 10,
    gameCallMs: calls ? Math.round((ms / calls) * 10) / 10 : null,
    serviceInPerSec: Math.round((sin / n) * 10) / 10,
    serviceOutPerSec: Math.round((sout / n) * 10) / 10,
    serviceErrors: errors,
    serviceMs: sin ? Math.round((sms / sin) * 10) / 10 : null,
  };
}

/** One row per running package: its mod (if any), its windows, its calls. */
async function taskList() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((x) => [x.pid, x]));
  const modRows = new Map((await mods.stats(metrics)).map((r) => [r.id, r]));
  const rows = [];
  for (const entry of apps.values()) {
    const m = entry.manifest;
    if (entry.pinned) continue; // the launcher
    const mod = modRows.get(m.id) ?? null;
    const wins = windowsOfPackage(m.id).map((w) => {
      let pid = null;
      try {
        pid = w.win.webContents.getOSProcessId();
      } catch {
        // a closing window
      }
      const x = pid && byPid.get(pid);
      return {
        key: w.app.manifest.id,
        title: w.app.manifest.name,
        cpuPercent: x ? Math.round(x.cpu.percentCPUUsage * 10) / 10 : null,
        memoryMB: x ? Math.round(x.memory.workingSetSize / 1024) : null,
      };
    });
    const running = mod?.process || wins.length;
    if (!running && !(mod && (mod.ended || mod.status === 'crashed' || mod.status === 'not-responding'))) continue;
    rows.push({
      id: m.id,
      name: m.name,
      version: m.version,
      builtin: entry.builtin,
      mod,
      windows: wins,
      service: m.service ? { functions: services.offer(m.id)?.functions ?? null } : null,
      ...ratesOf(m.id),
    });
  }
  const host = metrics.filter((x) => x.type === 'Browser' || x.type === 'GPU' || x.type === 'Utility' && !rows.some((r) => r.mod?.pid === x.pid));
  return {
    at: Date.now(),
    rows,
    total: {
      cpuPercent: Math.round(metrics.reduce((n, x) => n + (x.cpu?.percentCPUUsage ?? 0), 0) * 10) / 10,
      memoryMB: Math.round(metrics.reduce((n, x) => n + (x.memory?.workingSetSize ?? 0), 0) / 1024),
      processes: metrics.length,
      hostMB: Math.round(host.reduce((n, x) => n + (x.memory?.workingSetSize ?? 0), 0) / 1024),
    },
  };
}

ipcMain.handle('rednode:tasks:list', async (event) => {
  fromAdmin(event);
  return taskList();
});

ipcMain.handle('rednode:tasks:end', (event, id) => {
  const who = fromAdmin(event);
  const entry = apps.get(id);
  if (!entry || entry.pinned) throw new Error(`No package "${id}"`);
  if (entry.builtin) throw new Error(`${entry.manifest.name} is part of REDnode: close its window instead`);
  log(`End task: ${id}, by ${who}`);
  const ended = isMod(entry.manifest) ? mods.end(id) : false;
  services.removed(id);
  // A page app's window closes; a mod's windows close as it stops (not as the player's
  // closes, so they open again with it).
  if (entry.manifest.entry) closeApp(id);
  return ended || true;
});

ipcMain.handle('rednode:tasks:restart', (event, id) => {
  const who = fromAdmin(event);
  const entry = apps.get(id);
  if (!entry || entry.pinned) throw new Error(`No package "${id}"`);
  if (isMod(entry.manifest)) {
    if (!mods.isEnabled(id)) throw new Error(`${entry.manifest.name} is switched off: switch it on in the Mod Manager`);
    mods.restart(id, `Restarted by ${who}`);
  }
  if (entry.manifest.entry && settings.apps[id]?.open !== false) openApp(entry);
  return true;
});

// The channel between a package's pages and its own Node mod (channel in the rednode package).
ipcMain.on('rednode:pkg:post', (event, data) => {
  let id;
  try {
    id = packageOf(event);
  } catch {
    return;
  }
  mods?.toMod(id, { event: 'channel', data });
});
function postToPages(id, data) {
  for (const w of windows.values()) {
    const owner = w.app.built ? built.get(w.app.built)?.modId : w.app.manifest.id;
    if (owner === id) toPage(w, { event: 'channel', data });
  }
}
ipcMain.handle('rednode:pkg:mcp', (event) => mcpFor(packageOf(event)));

ipcMain.handle('rednode:apps:grant', (event, id, permission, granted) => {
  fromLauncher(event);
  const entry = apps.get(id);
  if (!entry || !entry.manifest.permissions.includes(permission)) throw new Error(`"${id}" does not ask for ${permission}`);
  const list = new Set(settings.apps[id]?.granted ?? []);
  if (granted) list.add(permission);
  else list.delete(permission);
  settings.apps[id] = { ...settings.apps[id], granted: [...list] };
  writeJson('settings.json', settings);
  log(`${granted ? 'Granted' : 'Withdrew'} ${permission} for ${id}`);
  mcp.configure(mcpConfig());
  if (permission === 'front' && connected) {
    for (const w of windowsOfPackage(id)) sendJson({ cmd: 'window.layer', window: w.id, layer: windowLayer(w) });
    applySolo();
  }
  if (permission === 'solo' && !granted && soloOwner === id) endSolo('the player withdrew the permission');
  return appList();
});

// The command that adds this server to Claude Code, for every project on this PC.
function mcpCommand() {
  const c = mcpConfig();
  return `claude mcp add --transport http --scope user rednode http://127.0.0.1:${c.port}/mcp --header "Authorization: Bearer ${c.token}"`;
}

// ---------- pictures of the game ----------

// The plugin copies the game's frame on the GPU and sends it back scaled down,
// as BGRA in base64: {"event":"capture","capture":id,...}.
let nextCapture = 1;
const captures = new Map(); // id -> { resolve, reject, timer }

/** A picture of the game: { image (nativeImage), width, height, sourceWidth, sourceHeight, hdr }. */
function captureGame({ overlay = false, maxWidth = 1280 } = {}) {
  if (!connected) return Promise.reject(new Error('The game is not linked to REDnode.'));
  const id = nextCapture++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      captures.delete(id);
      reject(new Error('The game sent no picture within 5 seconds. It may be loading, paused in the background or minimized.'));
    }, 5000);
    captures.set(id, { resolve, reject, timer });
    sendJson({ cmd: 'capture', id, overlay: !!overlay, maxWidth: Math.round(maxWidth) });
  });
}

function onCapture(m) {
  const c = captures.get(m.capture);
  if (!c) return;
  captures.delete(m.capture);
  clearTimeout(c.timer);
  if (m.error) {
    c.reject(new Error(`No picture: ${m.error}`));
    return;
  }
  const image = nativeImage.createFromBitmap(Buffer.from(m.bgra, 'base64'), { width: m.width, height: m.height });
  if (image.isEmpty()) {
    c.reject(new Error('The picture from the game was empty.'));
    return;
  }
  c.resolve({ image, width: m.width, height: m.height, sourceWidth: m.sourceWidth, sourceHeight: m.sourceHeight, overlay: !!m.overlay, hdr: !!m.hdr });
}

// ---------- assistants and packages' tools (SV3, docs/services.md) ----------
//
// A package's @tool functions are MCP tools, named <package>__<function>. The player switches
// tools off in the Tools Manager; settings.mcpTools keeps { off: [keys], offPackages: [ids],
// newOff, known: [package ids seen with tools] }. Keys: "rednode:<tool>" for REDnode's own,
// "<package>:<function>" for a package's.

const mcpToolSettings = () => {
  const t = settings.mcpTools ?? {};
  return { off: new Set(t.off ?? []), offPackages: new Set(t.offPackages ?? []), newOff: !!t.newOff, known: new Set(t.known ?? []) };
};
function saveToolSettings(t) {
  settings.mcpTools = { off: [...t.off], offPackages: [...t.offPackages], newOff: t.newOff, known: [...t.known] };
  writeJson('settings.json', settings);
}
const toolKeyOff = (key, t = mcpToolSettings()) => t.off.has(key) || t.offPackages.has(key.slice(0, key.indexOf(':')));

// Every package tool, switched on or not: [{ pkg, pkgName, fn (its descriptor), key, off }].
function allModTools() {
  const t = mcpToolSettings();
  const out = [];
  let learned = false;
  for (const { id } of services.providers()) {
    const entry = apps.get(id);
    const d = services.offer(id)?.descriptor;
    const fns = Object.values(d?.functions ?? {}).filter((f) => f.tool);
    if (!entry || !fns.length) continue;
    // The first time a package's tools show, "Off for new packages" switches them off.
    if (!t.known.has(id)) {
      t.known.add(id);
      if (t.newOff) t.offPackages.add(id);
      learned = true;
    }
    for (const fn of fns) out.push({ pkg: id, pkgName: entry.manifest.name, fn, key: `${id}:${fn.name}`, off: toolKeyOff(`${id}:${fn.name}`, t) });
  }
  if (learned) saveToolSettings(t);
  return out;
}

// Which assistant a token belongs to: the desktop token (Claude Code or another MCP client,
// named by its initialize request) or a package's, such as REDagent's.
const assistants = new Map(); // token -> { name, kind, lastSeen }
function seenToken(token, clientName) {
  let a = assistants.get(token);
  if (!a) {
    const pkg = [...packageTokens].find(([, t]) => t === token)?.[0];
    a = pkg ? { name: apps.get(pkg)?.manifest.name ?? pkg, kind: 'package', pkg } : { name: 'Desktop assistant', kind: 'desktop' };
    assistants.set(token, a);
  }
  if (clientName && a.kind === 'desktop') a.name = clientName;
  a.lastSeen = Date.now();
  return a;
}

const toolCalls = []; // the newest 200 assistant calls of packages' tools, for the Tools Manager
async function callModTool(who, pkg, fn, input) {
  const t = allModTools().find((x) => x.pkg === pkg && x.fn.name === fn);
  if (!t) throw new Error(`${pkg} offers no tool "${fn}" now`);
  if (t.off) throw new Error(`The player switched ${t.pkgName}'s ${fn} off for assistants (Tools Manager)`);
  // MCP passes arguments by name; the function takes them in order.
  const args = t.fn.params.map((p) => input?.[p.name]);
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const started = Date.now();
  const record = { at: started, assistant: who.name, tool: `${pkg}__${fn}`, pkg, fn, ok: false, ms: 0, detail: '' };
  toolCalls.push(record);
  if (toolCalls.length > 200) toolCalls.shift();
  mods.log(pkg, 'info', `${who.name} called ${fn} as a tool`);
  try {
    const result = await services.call({ assistant: who.name }, pkg, fn, args);
    record.ok = true;
    record.detail = JSON.stringify(result)?.slice(0, 200) ?? 'undefined';
    return result === undefined ? 'Done.' : result;
  } catch (err) {
    record.detail = err.message;
    throw err;
  } finally {
    record.ms = Date.now() - started;
  }
}

/** What the Tools Manager shows: every tool by where it comes from, the assistants, the recent calls. */
function toolsList() {
  const t = mcpToolSettings();
  const own = mcp.ownTools().map((x) => ({ key: `rednode:${x.name}`, name: x.name, title: x.title, description: x.description, input: x.input, readonly: x.readonly, asks: x.asks, off: t.off.has(`rednode:${x.name}`) }));
  const groups = [{ id: 'rednode', name: 'REDnode', builtin: true, off: false, tools: own }];
  const byPkg = new Map();
  for (const x of allModTools()) {
    if (!byPkg.has(x.pkg)) byPkg.set(x.pkg, { id: x.pkg, name: x.pkgName, builtin: false, off: t.offPackages.has(x.pkg), tools: [] });
    byPkg.get(x.pkg).tools.push({
      key: x.key,
      name: `${x.pkg}__${x.fn.name}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64),
      title: x.fn.name,
      description: x.fn.description,
      params: x.fn.params.map((p) => ({ name: p.name, type: p.type, optional: p.optional, description: p.description })),
      readonly: x.fn.readonly,
      asks: !x.fn.readonly,
      off: x.off,
    });
  }
  groups.push(...[...byPkg.values()].sort((a, b) => a.name.localeCompare(b.name)));
  return {
    mcp: mcp.status(),
    newOff: t.newOff,
    groups,
    assistants: [...assistants.values()].map((a) => ({ name: a.name, kind: a.kind, lastSeenMs: Date.now() - a.lastSeen })).sort((a, b) => a.lastSeenMs - b.lastSeenMs),
    recent: toolCalls.slice(-50).reverse(),
  };
}

ipcMain.handle('rednode:tools:list', (event) => {
  fromAdmin(event);
  return toolsList();
});

// A switch: one tool (key), or a whole package (group), or "Off for new packages".
ipcMain.handle('rednode:tools:set', (event, what, id, on) => {
  const who = fromAdmin(event);
  const t = mcpToolSettings();
  if (what === 'tool') {
    if (on) {
      t.off.delete(id);
      // A tool switched on in a package that is off as a whole: the package goes on, its other tools off.
      const pkg = id.slice(0, id.indexOf(':'));
      if (pkg !== 'rednode' && t.offPackages.has(pkg)) {
        t.offPackages.delete(pkg);
        for (const x of allModTools()) if (x.pkg === pkg && x.key !== id) t.off.add(x.key);
      }
    } else t.off.add(id);
  } else if (what === 'group') {
    if (id === 'rednode') {
      for (const x of mcp.ownTools()) (on ? t.off.delete(`rednode:${x.name}`) : t.off.add(`rednode:${x.name}`));
    } else if (on) {
      t.offPackages.delete(id);
      for (const k of [...t.off]) if (k.startsWith(`${id}:`)) t.off.delete(k);
    } else t.offPackages.add(id);
  } else if (what === 'new-off') t.newOff = !!on;
  else throw new Error(`Unknown switch "${what}"`);
  saveToolSettings(t);
  log(`Tools: ${what} ${id ?? ''} ${on ? 'on' : 'off'}, by ${who}`);
  return toolsList();
});

function mcpHost() {
  const lookup = createLookup(TYPES_FILE, NOTES_DIR);
  return {
    log,
    version: VERSION,
    // SV3: packages' tools that are switched on, their calls, REDnode's own switches, the assistants.
    modTools: () => allModTools().filter((x) => !x.off),
    callModTool,
    toolOff: (key) => toolKeyOff(key),
    seen: seenToken,
    logs: () => mods.recentLog(),
    apps: () =>
      appList().map((a) => ({
        ...a,
        windows: [...windows.values()]
          .filter((w) => w.app.manifest.id === a.id || w.app.manifest.id.startsWith(`${a.id}~`))
          .map((w) => w.app.manifest.id),
      })),
    setOpen: setPackageOpen,
    setPin,
    captureGame,
    restart: (id) => {
      if (!mods.has(id)) throw new Error(`No mod "${id}"`);
      mods.restart(id);
    },
    state: () => ({ ...hostState(), theme: undefined }),
    perf: () => {
      const metrics = app.getAppMetrics();
      return {
        game: lastGamePerf,
        host: {
          memoryMB: Math.round(metrics.reduce((n, p) => n + (p.memory?.workingSetSize ?? 0), 0) / 1024),
          cpuPercent: Math.round(metrics.reduce((n, p) => n + (p.cpu?.percentCPUUsage ?? 0), 0)),
          processes: metrics.length,
          renderPath,
        },
        modProcesses: mods.memorySummary(metrics) || 'none',
      };
    },
    lookup,
    webContentsOf: (id) => {
      const w = windowOfApp(id);
      return w && !w.win.isDestroyed() ? w.win.webContents : null;
    },
    consoleOf: (id) => windowOfApp(id)?.console ?? null,
    call: bridgeCall,
    reloadArchives: (files, refresh) => reloadArchives({ mcp: true }, { files, refresh }),
  };
}

ipcMain.handle('rednode:host:mcp', (event, on) => {
  fromLauncher(event);
  if (typeof on === 'boolean') {
    settings.mcp = { ...settings.mcp, enabled: on };
    writeJson('settings.json', settings);
    mcp.configure(mcpConfig());
  }
  return mcpConfig().external;
});

ipcMain.handle('rednode:host:mcp-command', (event) => {
  fromLauncher(event);
  clipboard.writeText(mcpCommand());
  return true;
});

ipcMain.handle('rednode:mods:set-shared', (event, id, shared) => {
  fromLauncher(event);
  if (!mods.has(id)) throw new Error(`No mod "${id}"`);
  mods.setShared(id, !!shared);
  settings.apps[id] = { ...settings.apps[id], shared: !!shared };
  writeJson('settings.json', settings);
  return appList();
});

ipcMain.handle('rednode:mods:restart', (event, id) => {
  fromLauncher(event);
  if (!mods.has(id)) throw new Error(`No mod "${id}"`);
  mods.restart(id);
  return appList();
});

ipcMain.handle('rednode:host:theme', (event, name) => {
  fromLauncher(event);
  name = themeName(name);
  if (THEMES.includes(name) && name !== theme()) {
    settings.theme = name;
    writeJson('settings.json', settings);
    log(`Theme: ${name}`);
    toAllPages({ event: 'theme', theme: name });
    for (const w of windows.values()) if (w.app.debugger) themeDebuggerBar(w);
  }
  return theme();
});

ipcMain.handle('rednode:host:hot-reload', (event, on) => {
  fromLauncher(event);
  if (typeof on === 'boolean') {
    settings.hotReload = on;
    writeJson('settings.json', settings);
    setHotReload(on);
  }
  return hotReload;
});

// Development folders (#16): the list, or add and remove one. The launcher's Settings drawer.
ipcMain.handle('rednode:host:dev-folders', (event, op, dir) => {
  fromLauncher(event);
  return changeDevFolders(op, dir);
});

// Tooltips (the UI kit's, for title attributes): on by default; the launcher's switch
// turns them off in every window, for players who know REDnode.
ipcMain.handle('rednode:host:tooltips', (event, on) => {
  fromLauncher(event);
  if (typeof on === 'boolean' && on !== (settings.tooltips !== false)) {
    settings.tooltips = on;
    writeJson('settings.json', settings);
    log(`Tooltips: ${on ? 'on' : 'off'}`);
    toAllPages({ event: 'tooltips', on });
  }
  return settings.tooltips !== false;
});

ipcMain.handle('rednode:host:open-at-start', (event, on) => {
  fromLauncher(event);
  if (typeof on === 'boolean' && on !== (settings.openAtStart !== false)) {
    settings.openAtStart = on;
    writeJson('settings.json', settings);
    log(`Open at start: ${on ? 'on' : 'off'}`);
  }
  return settings.openAtStart !== false;
});

ipcMain.handle('rednode:host:render-path', (event, path) => {
  fromLauncher(event);
  if (path === 'gpu' || path === 'cpu') setRenderPath(path);
  return renderPath;
});

let launcherQueued = false;
function notifyLauncher() {
  if (launcherQueued) return;
  launcherQueued = true;
  setImmediate(() => {
    launcherQueued = false;
    for (const w of windows.values()) if (w.app.pinned || w.app.manager) toPage(w, { event: 'apps' });
  });
}

// ---------- the mod log feed (built-in apps only) ----------

function fromBuiltin(event) {
  const w = windowFor(event.sender);
  if (!w?.app.builtin) throw new Error('Only apps built into REDnode can read the mod log');
}

// New lines go to built-in pages in batches, so a chatty mod cannot flood them.
let logBatch = [];
function onModLog(entry) {
  logBatch.push(entry);
  if (logBatch.length > 1) return;
  setTimeout(() => {
    const entries = logBatch;
    logBatch = [];
    for (const w of windows.values()) if (w.app.builtin) toPage(w, { event: 'mod-log', entries });
  }, 100);
}

ipcMain.handle('rednode:logs:recent', (event) => {
  fromBuiltin(event);
  return { entries: mods.recentLog(), file: modLogFile() };
});

ipcMain.handle('rednode:logs:copy', (event, text) => {
  fromBuiltin(event);
  clipboard.writeText(String(text));
  return true;
});

// ---------- windows built by Node mods (rednode's ui builder) ----------

const builtKey = (modId, win) => `${modId}~${win}`;
// Mod windows the player closed with their close button while the mod runs on.
// The launcher offers to show them again. key -> { modId, win }
const playerClosed = new Map();

// The same, kept across restarts in settings.closedWindows: a mod opens its windows at
// every start, and one the player closed stays closed until Show, or until the player
// switches the mod off and on again.
const closedForGood = (key) => (settings.closedWindows ?? []).includes(key);
function rememberClosed(key, closed) {
  const list = new Set(settings.closedWindows ?? []);
  if (closed ? list.has(key) : !list.has(key)) return;
  if (closed) list.add(key);
  else list.delete(key);
  settings.closedWindows = [...list];
  writeJson('settings.json', settings);
}

function findNode(spec, id) {
  if (spec.id === id) return spec;
  for (const c of spec.children ?? []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

const ui = {
  open(modId, win, spec) {
    const key = builtKey(modId, win);
    if (closedForGood(key)) {
      // Kept closed: the mod sees it closed, as if the player had just closed it.
      built.set(key, { modId, win, spec });
      playerClosed.set(key, { modId, win });
      mods.toMod(modId, { event: 'ui', window: win, type: 'close' });
      log(`Kept ${key} closed, as the player left it`);
      notifyLauncher();
      return;
    }
    closeApp(key);
    if (playerClosed.delete(key)) notifyLauncher();
    built.set(key, { modId, win, spec });
    const p = spec?.props ?? {};
    const size = (v, d) => (Number.isInteger(v) && v >= 1 && v <= 4096 ? v : d);
    openApp({
      dir: BUILDER_DIR,
      builtin: false,
      built: key,
      manifest: {
        id: key,
        name: String(p.title ?? win),
        entry: 'index.html',
        kind: 'window',
        width: size(p.width, 360),
        height: size(p.height, 320),
        anchor: ANCHORS.includes(p.anchor) ? p.anchor : 'center',
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        hideWith: [],
      },
    });
  },
  update(modId, win, node, props) {
    const b = built.get(builtKey(modId, win));
    const target = b && findNode(b.spec, node);
    if (!target) return;
    const { push, ...rest } = props;
    Object.assign(target.props, rest);
    if (Array.isArray(push) && target.type === 'list') {
      // ui.list's push: only the new lines travel; the kept copy drops the oldest past "keep".
      const keep = Math.min(5000, Math.max(1, Number(target.props.keep) || 500));
      target.props.lines = [...(target.props.lines ?? []), ...push.map(String)].slice(-keep);
    }
    const w = windowOfApp(builtKey(modId, win));
    if (w) toPage(w, { event: 'builder', op: 'update', node, props });
  },
  close(modId, win) {
    const key = builtKey(modId, win);
    built.delete(key);
    closeApp(key);
  },
  closeAll(modId) {
    for (const [key, b] of built) if (b.modId === modId) ui.close(modId, b.win);
    for (const [key, c] of playerClosed) if (c.modId === modId) playerClosed.delete(key);
  },
};

function builtFor(event) {
  const w = windowFor(event.sender);
  const b = w?.app.built && built.get(w.app.built);
  if (!b) throw new Error('Only the REDnode builder page can use this');
  return b;
}

ipcMain.handle('rednode:builder:spec', (event) => builtFor(event).spec);

ipcMain.on('rednode:builder:event', (event, e) => {
  let b;
  try {
    b = builtFor(event);
  } catch {
    return;
  }
  if (e?.type === 'close') {
    ui.close(b.modId, b.win);
    playerClosed.set(builtKey(b.modId, b.win), { modId: b.modId, win: b.win });
    rememberClosed(builtKey(b.modId, b.win), true);
    mods.toMod(b.modId, { event: 'ui', window: b.win, type: 'close' });
    notifyLauncher();
  } else {
    mods.toMod(b.modId, { event: 'ui', window: b.win, node: e?.node, type: e?.type, value: e?.value });
  }
});

// ---------- hot reload ----------

function watchPackage(entry) {
  const id = entry.manifest.id;
  if (watchers.has(id)) return;
  let timer = null;
  try {
    const watcher = fs.watch(entry.dir, { recursive: true }, (_type, file) => {
      if (file && /(^|[\\/])node_modules([\\/]|$)/.test(file) && !isMod(entry.manifest)) return;
      if (file && /(^|[\\/])\./.test(file)) return; // dot folders and files belong to tools, not to the package
      if (file && /(^|[\\/])rednode-app\.json$/.test(file)) return; // a manifest change: rescanApps applies it
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (watchers.get(id) !== watcher || apps.get(id) !== entry) return; // the package was removed or replaced
        log(`Changed: ${id}${file ? ` (${file})` : ''}. Reloading.`);
        if (isMod(entry.manifest) && mods.has(id)) mods.restart(id);
        const w = windowOfApp(id);
        if (w && !w.win.isDestroyed()) w.win.webContents.reloadIgnoringCache();
      }, 400);
    });
    watcher.on('error', () => watchers.delete(id));
    watchers.set(id, watcher);
  } catch (err) {
    log(`Cannot watch ${entry.dir}: ${err.message}`);
  }
}

function setHotReload(on) {
  hotReload = on;
  for (const w of watchers.values()) w.close();
  watchers.clear();
  if (on) for (const entry of apps.values()) if (!entry.builtin) watchPackage(entry);
  log(`Hot reload ${on ? 'on' : 'off'}`);
}

// ---------- windows ----------

function openApp(entry) {
  if (!entry.manifest.entry || windowOfApp(entry.manifest.id)) return;
  const m = entry.manifest;
  const id = nextWindowId++;
  const win = new BrowserWindow({
    width: m.width,
    height: m.height,
    x: windowed ? 60 + windows.size * 80 : undefined,
    y: windowed ? 60 + windows.size * 80 : undefined,
    show: windowed, // never show an off-screen window: that would take OS focus from the game
    frame: windowed,
    transparent: !windowed,
    backgroundColor: windowed ? '#08090d' : '#00000000',
    useContentSize: true,
    title: m.name,
    webPreferences: {
      offscreen: windowed ? false : renderPath === 'gpu' ? { useSharedTexture: true } : true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const w = { id, app: entry, win, dragRegions: [], console: [] };
  windows.set(id, w);
  windowStats.set(id, { frames: 0 });

  if (!windowed) {
    win.webContents.setFrameRate(FPS);
    win.webContents.on('paint', (event, dirty, image) => {
      if (event.texture) sendShared(id, event.texture);
      else sendFrame(id, image, dirty);
    });
  }
  win.on('closed', () => {
    windows.delete(id);
    windowStats.delete(id);
  });
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (entry.debugger) return; // DevTools' own messages, not the app's
    if (level === 'error') log(`[${m.id}] page error: ${message}`);
    // The last 200 messages, for the MCP server's window_console tool.
    w.console.push({ time: Date.now(), level, message, line: lineNumber, source: sourceId });
    if (w.console.length > 200) w.console.shift();
  });
  if (entry.debugTarget) attachDevTools(w);
  else if (entry.inspector) {
    dressDebugger(w);
    win.loadURL(nodeDevToolsUrl(entry.inspector));
  } else win.loadFile(path.join(entry.dir, m.entry), entry.query ? { query: entry.query } : undefined);
  placeInSpace(w);
  if (connected) openInGame(w);
  log(`Opened ${m.id}`);
  notifyLauncher();
}

function closeApp(appId) {
  const w = windowOfApp(appId);
  if (!w) return;
  // A window's debugger goes with it; a debugger closes its target's DevTools.
  const debuggerOf = windowOfApp(`debugger~${w.id}`);
  if (debuggerOf) closeApp(debuggerOf.app.manifest.id);
  if (w.app.debugTarget) {
    const target = windows.get(w.app.debugTarget);
    if (target && !target.win.isDestroyed() && target.win.webContents.isDevToolsOpened()) target.win.webContents.closeDevTools();
  }
  sendJson({ cmd: 'window.close', window: w.id });
  windows.delete(w.id);
  windowStats.delete(w.id);
  pendingFrames.delete(w.id);
  if (!w.win.isDestroyed()) w.win.destroy();
  log(`Closed ${appId}`);
  notifyLauncher();
  checkSolo();
}

// ---------- start ----------

app.whenReady().then(() => {
  // rednode://ui/  the UI kit; rednode://sdk/  the rednode package, as ES modules.
  protocol.handle('rednode', (request) => {
    const url = new URL(request.url);
    const root = { ui: UI_DIR, sdk: SDK_DIR }[url.host];
    const file = root && path.join(root, decodeURIComponent(url.pathname));
    if (!root || !file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      return new Response('Not found', { status: 404 });
    }
    // Read directly rather than fetch a file:// URL: packaged, the kit is inside app.asar.
    // Apps are file:// pages, so module imports from here need a CORS header.
    const type = file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': `${type}; charset=utf-8`, 'access-control-allow-origin': '*' },
    });
  });

  log(`REDnode overlay host ${VERSION}${app.isPackaged ? ' (packaged)' : ''}`);
  positions = readJson('window-positions.json', {});
  settings = { apps: {}, ...readJson('settings.json', {}) };
  setRoots();
  if (devFolders().length) log(`Development folders: ${devFolders().join('; ')}`);
  renderPath = ['gpu', 'cpu'].includes(renderArg) ? renderArg : settings.renderPath === 'cpu' ? 'cpu' : 'gpu';
  log(`Render path: ${renderPath}`);
  // Never hold a shared texture long: Chromium has only a few.
  setInterval(() => {
    const n = releaseSharedFrames((f) => Date.now() - f.at > 1000);
    if (n) log(`Released ${n} shared frame(s) the game did not answer`);
  }, 500);
  discoverApps();
  seedPins();
  // A token is made once and kept, so Claude Code's saved setup keeps working.
  if (!settings.mcp?.token) {
    settings.mcp = { ...settings.mcp, token: crypto.randomBytes(24).toString('base64url') };
    writeJson('settings.json', settings);
  }
  mcp = createMcp(mcpHost());
  mcp.configure(mcpConfig());
  // Mods start below; one may ask for the kernel's tools at once (mcpFor).
  services = createServices({
    entry: (id) => apps.get(id),
    describe: describeService,
    checkArgs: (fn, args) => describer?.checkArgs(fn, args) ?? null,
    modState: (id) => mods.state(id),
    toWorker: (id, message) => mods.toWorker(id, message),
    toPackage: (id, message) => {
      mods.toMod(id, message);
      for (const w of windowsOfPackage(id)) toPage(w, message);
    },
    modLog: (id, level, text) => mods.log(id, level, text),
  });
  mods = createMods({
    app,
    utilityProcess,
    services,
    service: (id, msg) => onService(id, msg),
    log,
    logFile: modLogFile(),
    runner: path.join(RUNTIME_DIR, 'runner.js'),
    sdk: path.join(SDK_DIR, 'index.js'),
    call: (method, params, id) => packageCall(id, method, params),
    state: hostState,
    dataDir: dataDirOf,
    get appsDirs() {
      return APP_ROOTS.filter((r) => !r.builtin).map((r) => r.dir);
    },
    secret,
    mcpFor,
    bridgeFor,
    requirementsOf,
    missingOf,
    post: postToPages,
    agent: (id, msg) => onAgent(id, msg, (m) => mods.toMod(id, m)),
    ui,
    changed: () => {
      notifyLauncher();
      syncNodeDebuggers();
      checkSolo();
    },
    soloFor: setSolo,
    // A mod's TweakDB changes are undone each time it stops, restarts and hot reloads included.
    // Its sounds stop too.
    stopped: (id) => {
      services.gone(id);
      undoTweaks(id, 'the mod stopped');
      stopSounds(id);
      clearInk(id);
      if (tracers.delete(id) && !tracers.size) Promise.resolve(stopTrace(`${id} stopped`)).catch(() => {});
    },
    onLog: onModLog,
  });
  if (!fs.existsSync(path.join(SDK_DIR, 'index.js'))) {
    log(`The rednode package is missing at ${SDK_DIR}. Build it with: npm run build --workspace rednode`);
  }
  for (const entry of apps.values()) {
    if (shouldOpen(entry)) openApp(entry);
  }
  // Node mods start once the JSDoc reader has loaded (a few ms), so the first services are described.
  describerReady.finally(() => {
    for (const entry of apps.values()) {
      if (isMod(entry.manifest)) mods.add(entry, { enabled: shouldOpen(entry), shared: settings.apps[entry.manifest.id]?.shared });
    }
  });
  setHotReload(hotReloadArg ? hotReloadArg !== 'off' : app.isPackaged ? !!settings.hotReload : true);
  watchAppRoots();
  // Mod memory, for comparing a process per mod with the shared group.
  setInterval(() => {
    const line = mods.memorySummary(app.getAppMetrics());
    if (line) log(`Mod processes: ${line}`);
  }, 10000);

  if (!windowed) {
    connect();
    setInterval(() => {
      if (frames) log(`${frames} frames, ${(bytes / 1048576).toFixed(1)} MB sent in the last 10 s`);
      frames = 0;
    }, 10000);
  }

  // Started by the game: exit with it. The plugin also puts the host in a job
  // object, so Windows ends it if the game crashes.
  if (parentPid) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        log('The game has exited. Closing.');
        app.quit();
      }
    }, 1000);
  }
  log(windowed ? 'Window mode: apps run on the desktop, not in the game' : `Waiting for the game on ${PIPE}`);
});

app.on('window-all-closed', () => {
  if (windowed) app.quit();
});

app.on('will-quit', () => {
  mods?.stopAll();
  mcp?.stop();
  redbridge.stop();
});
