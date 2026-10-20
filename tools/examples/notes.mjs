// What the docs' example pages say about each app in packages/overlay/apps
// (tools/examples/build.mjs). The code comes from the apps themselves; this is the
// text around it: a summary, what it teaches, how it works and something to try.
// An app missing here still gets a page, with its manifest's description.

/** The groups on the examples index, in order. */
export const GROUPS = [
  ['start', 'Start here', 'Small, complete examples of each kind of package.'],
  ['overlay', 'Overlay apps', 'Web pages drawn over the game: the UI kit, custom shapes, input and window layers.'],
  ['hud', 'HUD widgets', 'Pages that sit on the HUD, never take input, and hide with the game\'s menus.'],
  ['mods', 'Node mods', 'Mods that run in Node, outside the game, with or without a window.'],
  ['game', 'Game APIs', 'The game API, TweakDB, the world, sounds, REDbridge and REDagent.'],
  ['tests', 'Tests and tools', 'What REDnode\'s own phases were tested with. Useful to read, rarely to copy.'],
];

export const NOTES = {
  'hello-mod': {
    group: 'start',
    summary: 'The smallest useful Node mod: a window built with the ui builder that follows V, plays a sound and counts save loads.',
    teaches: ['ui.window', 'ui.text', 'ui.button', 'ui.toggle', 'node.set', 'game.player.position', 'game.onState', 'game.on', 'game.audio.play'],
    how: [
      'A Node mod is a JavaScript module named by `main` in its manifest. REDnode runs it in Node beside the game, so it can use npm packages, files and timers, and a mistake in it cannot crash the game.',
      'The window is a tree of nodes. `ui.text(...)` makes a node and returns it; keep the ones that change, then call `set()` on them. REDnode draws the tree with the UI kit and sends clicks back to your handlers.',
      'Every half second the mod asks for V\'s position and shows it. `game.onState` reports menus, photo mode and scenes; `game.on("PlayerPuppet.OnGameAttached")` fires on each save load.',
    ],
    tryThis: ['Change `VERSION` and save: with hot reload on, the mod restarts and the window shows the new text.', 'Add a `ui.slider` that sets how often the position updates.'],
  },
  kit: {
    group: 'start',
    summary: 'Every control in the REDnode UI kit on one page: buttons, toggles, sliders, inputs, progress bars, lists, menus, tabs, tooltips and notifications.',
    teaches: ['rn-window', 'rn-tabs', 'rn-button', 'rn-toggle', 'rn-slider', 'rn-input', 'rn-progress', 'rn-list', 'rn-menu', 'rn-tooltip', 'RednodeUI.notify', 'theme'],
    how: [
      'An overlay app is a web page. Load the kit with `<script src="rednode://ui/rednode-ui.js">` and write its custom elements as markup; they look like REDnode and play the game\'s UI sounds.',
      'The page is transparent: only `rn-window` draws a frame, and the game shows everywhere else. Clicks on transparent areas pass through to the game.',
      'app.js only wires events: each control sends a DOM event (`click`, `change`, `input`, `select`, `submit`) with its value in `e.detail`.',
    ],
    tryThis: ['Switch on "Game theme" to see the game\'s own look.', 'Add an `rn-tab` of your own with a few controls.'],
    preview: 'The Sound tab plays a tone instead of the game\'s sound events, which only exist in the game.',
  },
  coords: {
    group: 'start',
    summary: 'A HUD widget: V\'s coordinates in a strip at the top of the screen, read from a web page with the rednode package.',
    teaches: ['kind: "hud"', 'import map', 'game.player.position'],
    how: [
      'With `"kind": "hud"` in the manifest, the page never takes input, and REDnode hides it in menus, photo mode, scenes and the main menu.',
      'A page can import the rednode package by name, like a Node mod: the import map points `rednode` at REDnode\'s copy.',
    ],
    tryThis: ['Show V\'s heading too: the Game API mod reads `GetWorldForward()`.'],
    preview: 'Press Menu or Photo mode below: in the game, the plugin hides HUD widgets then. The preview keeps showing it.',
  },
  timer: {
    group: 'start',
    summary: 'The Test timer: a stopwatch whose marks go to the Mod log with the time, used to match log lines to test steps.',
    teaches: ['ui.heading', 'ui.row', 'ui.input', 'onSubmit', 'props.value', 'console.log', '"front" permission'],
    how: [
      'Everything a Node mod prints with `console.log` goes to the Mod log and to `red4ext/logs/rednode-mods.log`, tagged with the package id.',
      'State lives in plain variables; `show()` writes it into the nodes. There is no framework to learn: change a node with `set()` whenever your data changes.',
      'The manifest asks for the `front` permission, so the timer stays above other packages\' windows.',
      'A field keeps what the player typed in `props.value`, so **Mark** can send a note that was typed without pressing Enter.',
    ],
    tryThis: ['Add a Lap button that logs the time since the last mark.'],
  },
  native: {
    group: 'overlay',
    summary: 'A button and menu with no window around them, styled like the game, so they look like part of its UI.',
    teaches: ['theme="hud"', 'rn-menu', 'data-rednode-drag', 'RednodeUI.notify'],
    how: [
      'Without `rn-window`, only what you draw shows. `data-rednode-drag` makes any element a handle that moves the overlay window.',
      'This is HTML, not the game\'s own UI (ink). The design for native ink UI is in the design doc, section 06.',
    ],
    tryThis: ['Add a menu item that shows a notification with `type: "success"`.'],
  },
  signal: {
    group: 'overlay',
    summary: 'A round widget drawn with SVG: a ring that sweeps once a minute, a clock, and a Ping button that times a call to the game.',
    teaches: ['SVG', 'window.rednode.call', 'window.rednode.on', 'click-through'],
    how: [
      'The hole in the middle and everything outside the ring is transparent, so clicks there reach the game. Any shape works.',
      '`window.rednode.call("game.info")` asks the plugin for the game\'s frame number; the time it takes is the round trip to the game.',
      'Pages get host events with `window.rednode.on`: `link` when the game connects, `focus` when the overlay gains or loses focus.',
    ],
    tryThis: ['Turn the ring red while the game is not linked.'],
  },
  demo: {
    group: 'overlay',
    summary: 'The overlay\'s proof of concept: live drawing, input, calls to the game and events from it, each in a tile.',
    teaches: ['requestAnimationFrame', 'window.rednode.call', 'window.rednode.state', 'window.rednode.on'],
    how: [
      'The first tile redraws every frame, the second takes clicks and keys, the third calls the game and the fourth lists events. It was the first page REDnode drew in the game.',
      'It uses plain HTML and CSS, no UI kit, to show that any web page works.',
    ],
    tryThis: ['Load a save below and watch OnGameAttached arrive in tile 04.'],
  },
  state: {
    group: 'overlay',
    summary: 'A table of what the game is doing: menu, photo mode, scene and its tier, main menu, with a short log of changes.',
    teaches: ['ui-state event', 'window.rednode.on'],
    how: [
      'The plugin sends a `ui-state` event whenever the game\'s UI state changes. HUD widgets are hidden from the same data.',
    ],
    tryThis: ['Press Menu, Photo mode and Scene below and watch the log.'],
  },
  perf: {
    group: 'overlay',
    summary: 'REDnode\'s cost each second: the game\'s frame rate, the overlay\'s CPU and GPU time per frame, and the host\'s memory.',
    teaches: ['perf event', 'window.rednode.on'],
    how: ['The plugin and the host measure themselves and send a `perf` event every second to pages that listen.'],
    preview: 'The numbers are made up, in the range REDnode measured in game.',
  },
  'layers-test': {
    group: 'tests',
    summary: 'A page covering the whole screen that takes the mouse everywhere, and solo mode, which hides every other package.',
    teaches: ['ui.solo', 'ui.onSolo', '"solo" permission'],
    how: [
      'Solo mode is for full-screen tools such as editors: other packages hide while it is on, and REDnode\'s own tool windows stay above.',
      'The page is 1920 by 1080; the preview shrinks it to fit.',
    ],
  },
  'pointer-test': {
    group: 'tests',
    summary: 'A camera turned by raw mouse movement while the right button is held, with the web\'s Pointer Lock API.',
    teaches: ['requestPointerLock', 'movementX', 'pointerlockchange'],
    how: ['In the game the plugin holds the cursor in place, the way games do for a camera. On this page your browser does it.'],
    tryThis: ['Hold the right mouse button on the pad and move the mouse.'],
  },
  stress: {
    group: 'tests',
    summary: 'The worst case for the overlay: a large canvas where every pixel changes every frame.',
    teaches: ['canvas', 'requestAnimationFrame'],
    how: ['Used with Perf to measure what a fully animated window costs the game.'],
  },
  'ticker-mod': {
    group: 'mods',
    summary: 'A Node mod with no window: it logs V\'s position every ten seconds, each game event and each state change.',
    teaches: ['console.log', 'game.player.position', 'game.on', 'game.onState'],
    how: ['A mod does not need a window. Its log lines show in the Mod log and in `red4ext/logs/rednode-mods.log`.'],
    tryThis: ['Load a save below and watch the event line.'],
  },
  'ask-mod': {
    group: 'game',
    summary: 'Ask REDagent, the in-game assistant powered by Claude, a question from your own mod, and stream the answer into a window.',
    teaches: ['agent.ask', 'onText', 'AbortController', '"agent" permission'],
    how: [
      '`agent.ask` sends a question with context only your mod knows, here V\'s position. The answer streams through `onText`, and `signal` stops it.',
      'The `agent` permission needs the player\'s OK in the Mod Manager, because each answer costs the player a little.',
    ],
    preview: 'On this page a fixed text streams back. In the game, REDagent answers.',
  },
  'crash-mod': {
    group: 'mods',
    summary: 'Four ways for a mod to fail: a thrown error, an endless loop, process.exit and a killed process. Other mods keep running.',
    teaches: ['crash handling', 'restart', 'not responding'],
    how: [
      'Each Node mod runs on its own worker thread. A thrown error or an exit stops only that mod, and REDnode restarts it, at most three times a minute.',
      'An endless loop never answers REDnode\'s pings: after ten seconds the mod shows as not responding, and the player can restart it.',
    ],
    tryThis: ['Press Throw an error, then watch the Mod log and the status: the mod restarts.', 'Press Hang forever and wait ten seconds, then press Restart.'],
    preview: 'The preview runs the mod in a Web Worker, so the endless loop cannot freeze this page, and it restarts it the way REDnode does.',
  },
  'api-mod': {
    group: 'game',
    summary: 'V\'s health, level and money read through the generic game API, eddies given with TransactionSystem, and what happens to old references after a load.',
    teaches: ['api.GetPlayer', 'api.GameInstance', 'api.$call', 'api.MarketSystem', 'game.instance', 'references'],
    how: [
      '`api` calls any game function by name, typed from the game\'s own type data. The calls are the ones redscript makes, written in JavaScript, and each one is async.',
      'Game objects come back as references. A save load drops them all: a reference from before the load fails cleanly, with a message, rather than crashing the game.',
      'Wrong argument types are refused by REDnode before they reach the game.',
    ],
    tryThis: ['Press Give 100 eddies.', 'Press Load a save below, then Use the player from before.'],
  },
  'tweakdb-test': {
    group: 'game',
    summary: 'Read any TweakDB record, its flats and a method, list every vehicle, and change or clone records through TweakXL.',
    teaches: ['tweakdb.type', 'tweakdb.flat', 'tweakdb.record', 'tweakdb.records', 'tweakdb.id', 'tweakdb.set', 'tweakdb.clone'],
    how: [
      'Reading needs nothing but REDnode. Writing goes through TweakXL, listed in the manifest\'s `requires`.',
      'REDnode keeps a journal of each package\'s changes and undoes them when the package stops, so switching a mod off really switches it off.',
      'An id is the path\'s CRC32 and length, the way the game makes it, so `tweakdb.id()` answers at once.',
    ],
    tryThis: ['Press Change, then Read: the name changed. Press Restart below: it is back.'],
    preview: 'The preview\'s TweakDB holds a few made-up records. In the game it is the game\'s own database.',
  },
  'world-test': {
    group: 'game',
    summary: 'Spawn an entity in front of V with a mesh component built by api.$new, move it in a circle as fast as the game allows, and remove it.',
    teaches: ['world.spawn', 'world.move', 'world.remove', 'world.on', 'api.$new', 'world.available'],
    how: [
      '`api.$new` builds a game object, here a mesh component with its mesh set by a depot path. `world.spawn` places an entity with it.',
      'Calls waiting when a game frame starts run in that frame, so ten moves at once take one frame, not ten.',
    ],
    preview: 'Nothing is drawn: the entity exists only in the simulation, but the events and the move rates behave the same way.',
  },
  'sound-test': {
    group: 'game',
    summary: 'Play the package\'s own OGG, WAV, FLAC and MP3 files: music on a loop, effects, a voice, with pan, delay, pitch and fades.',
    teaches: ['audio.play', 'sound.set', 'sound.stop', 'sound.ended', 'audio.playing', 'audio.stopAll', 'manifest sounds'],
    how: [
      'Sounds are named in the manifest\'s `sounds`, with their category: music, effects or dialogue follow the game\'s matching volume sliders.',
      'Every sound pauses while a game menu is open and ends with a reason: ended, stopped or error.',
    ],
    tryThis: ['Play the music, then press Menu below: it pauses.'],
    preview: 'These are the real files, played by your browser.',
  },
  'packaging-test': {
    group: 'game',
    summary: 'A manifest that requires other mods (Codeware, ArchiveXL, REDbridge and one that does not exist), and REDbridge reading the game\'s archives.',
    teaches: ['requires', 'kernel.requirements', 'kernel.bridge', '"bridge" permission'],
    how: [
      '`requires` lists other mods with a version. The Mod Manager checks them against the game folder and shows what is missing.',
      'REDbridge is WolvenKit\'s engine. `kernel.bridge()` starts it once and shares it, so a package can list and search the game\'s archives.',
    ],
    preview: 'The preview\'s REDbridge knows a few made-up files.',
  },
  'hot-test': {
    group: 'game',
    summary: 'Swap an archive into the running game, so a changed mesh, material or texture shows without a restart, and read what happened.',
    teaches: ['archives.reload', 'archives.soundState', '"archives" permission', 'requires', 'kernel.requirements'],
    how: [
      'RED Hot Tools does the swap. REDnode copies the file into its hot folder, has it swap the archive in, and answers with what was swapped and what failed.',
      'Swapping changes files in the game\'s mod folder, so the package asks for the `archives` permission and the player allows it in the launcher.',
      'Objects already in the world keep the old asset until they load it again: respawn them, or apply their appearance again.',
      'An archive with the game\'s sound paks swaps too: the host pauses the game, holds its audio thread, and loads the game\'s sound index again afterwards. A sound that just played may keep its old version until the game loads it again.',
      'Sound state reads the game\'s sound pak index and the paks it has open, without changing them: an experimental diagnostic from the research into swapping sound.',
    ],
    tryThis: [
      'Type Plain.archive and press Swap.',
      'Type Nope.archive and press Swap: the host refuses a file it cannot find.',
      'Type 123456789 in the sound ids box and press Sound state: the summary says which pak holds it.',
    ],
    preview: 'Nothing is swapped on this page: it checks what the host checks and pretends. Its mod folder holds Plain.archive and MyJacket.archive.',
  },
  'sound-spike': {
    group: 'game',
    summary: 'Listen to the game\'s sounds as they play, then play one again: an event by name, or a single sound by its id.',
    teaches: ['audio.trace', 'audio.event', 'audio.playGame', 'kernel.bridge', '"bridge" permission'],
    how: [
      'audio.trace hooks the game\'s audio engine: every event the game posts (with its Wwise id and the game object it plays on) and every sound it loads (by sound id) arrive in batches, about ten a second.',
      'Event ids are hashes of their names. REDbridge\'s sound.events gives the names WolvenKit knows, so the app shows names where it can.',
      'audio.event posts an event by name through the game, with the game\'s own mix and effects; audio.playGame plays one recording by its sound id through REDnode\'s engine, raw.',
      'The test app of Sound Tools\' first phase (SP1): Stop trace writes a summary to the Mod log.',
    ],
    tryThis: [
      'Press Start trace and watch the counts, then Stop trace.',
      'Type ui_menu_onpress and press Play event.',
      'Type 746693166 and press Play sound; then 1, which is not in the index.',
    ],
    preview: 'The sounds on this page are made up and play as a tone: in the game the plugin hooks its audio engine and plays the real recordings.',
  },
  vitals: {
    group: 'hud',
    summary: 'A HUD widget with V\'s health, level and money, read through the generic game API from a web page.',
    teaches: ['kind: "hud"', 'api.GetPlayer', 'api.GameInstance', 'api.$call'],
    how: ['The same calls as the Game API mod, from a page instead of Node: the rednode package works in both.'],
    tryThis: ['Press Hurt V below and watch HP refill.'],
  },
};
