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
  'hot-swap': {
    group: 'game',
    summary: 'Swap an archive into the running game, sound mods included: type its name or path, press Swap, and swap it again from the list next time you build it.',
    teaches: ['archives.reload', '"archives" permission', 'requires', 'kernel.requirements', 'localStorage in an app'],
    how: [
      'RED Hot Tools does the swap. REDnode copies the file into its hot folder, has it swap the archive in, and answers with what was swapped and what failed.',
      'An archive with the game\'s sound paks swaps too: REDnode pauses the game, holds its audio, and loads the game\'s sound index again afterwards. A sound that just played may keep its old version until the game loads it again.',
      'Swapping changes the game\'s archives, so the package asks for the `archives` permission and the player allows it in the Mod Manager. Its manifest also requires RED Hot Tools and a REDnode new enough, and the window says what is missing.',
      'Recent swaps are kept in the window\'s local storage, so ↻ swaps the same file again after your next build, in this session or the next.',
      'Part of REDnode Sound Tools.',
    ],
    tryThis: [
      'Type Plain.archive and press Swap.',
      'Type Nope.archive and press Swap: the host refuses a file it cannot find, and the list marks it failed.',
      'Press ↻ on Plain.archive to swap it again.',
    ],
    preview: 'Nothing is swapped on this page: it checks what the host checks and pretends. Its mod folder holds Plain.archive and MyJacket.archive.',
  },
  'ink-test': {
    group: 'tests',
    summary: 'The spike of the ink API: reach the game\'s own UI, add widgets to it, hear clicks, time changes, open a game screen and read a screen\'s widget tree.',
    teaches: ['api.$static', 'api.$new', 'inkCompoundWidget.AddChild', 'RegisterToCallback', 'StartHubMenuEvent', 'kernel.bridge', 'pkg.dataDir', 'game.on'],
    how: [
      'The game draws its own UI with ink, a tree of widgets. REDnode\'s script `REDnodeInk.reds` keeps the roots of a few HUD and menu controllers, and the app reaches them with `api.$static("REDnodeInk", "Root", name)`. With Codeware, its layers work too (`cw.inkHUDLayer`).',
      'HUD text and Menu button add widgets with `AddChild`, then set their font, text, size, margin and tint one call at a time. The button registers `REDnodeInkListener`, a script class whose handlers send game events the app hears with `game.on`.',
      'Speed times one change, 50 in a row, and 200 and 600 at once. Open screen queues a `StartHubMenuEvent`. Menu entries finds the game\'s menu resources through REDbridge and reads them through Codeware. Read screen walks a root\'s tree level by level and writes it to a file in the app\'s data folder.',
    ],
    tryThis: ['Load a save and press Roots, then HUD text.', 'Open the pause menu, close the overlay, and click the Ink button.'],
    preview: 'The preview has no game UI: the buttons log the calls they would make, and most of them fail with the simulated game\'s answer.',
  },
  'refresh-test': {
    group: 'tests',
    summary: 'Swap an archive, then try each way the game offers to load again what is already in the world: V\'s clothes, what V looks at, a spawned object.',
    teaches: ['archives.reload', 'api.GameInstance', 'TransactionSystem', 'tweakdb.records', 'TargetingSystem', 'world.spawn', 'world.entity', 'ui.list'],
    how: [
      'A swap replaces an archive, but what is already in the world keeps what it loaded. This is the spike of `world.refresh` (H2): each button calls the game through `api` and logs how long it took.',
      'V\'s clothes: **Scan** lists each attachment slot in TweakDB that holds an item (`tweakdb.records("AttachmentSlot")`, so slots a mod adds count too) and marks the clothing. The buttons then use `RefreshAttachment`, apply the item\'s appearance again, or take the items off and put them back. Type a slot name as Scan shows it to try one at a time.',
      'What V looks at: `TargetingSystem.GetLookAtObject` finds it, then `ScheduleAppearanceChange` applies its appearance again.',
      'A spawned object: spawned again in the same place, or its mesh component switched off and on.',
    ],
    tryThis: ['Press Scan, then Re-attach. Type Legs in the slots field and press Off and on.', 'Press Spawn, then Mesh off and on.'],
    preview: 'Nothing changes on screen here: the preview\'s V wears a jacket, trousers and boots, and looks at a vendor, so the log shows the calls each button makes.',
  },
  'list-mod': {
    group: 'mods',
    summary: 'A Node mod window built around a scrolling list: a live log that keeps its newest lines.',
    teaches: ['ui.list', 'list.push', 'list.clear', 'game.onState'],
    how: [
      'ui.list makes a list of lines that scrolls on its own. push adds lines at the bottom; only the new lines travel to the window, so feeding it often stays cheap.',
      'It keeps the newest lines only (keep, here 300) and follows the newest line unless the player has scrolled up.',
      'Without a height, the list fills the space the other nodes leave, so the window keeps its size and never scrolls: give it a height in pixels to fix it instead.',
    ],
    tryThis: ['Watch a line arrive every two seconds.', 'Scroll the list up: it stays put while lines arrive; scroll back down and it follows again.', 'Press Clear.'],
  },
  'sound-tracer': {
    group: 'game',
    summary: 'The game\'s sounds, live: every event it posts to its audio engine and every sound it loads, each with a button to play it again.',
    teaches: ['audio.trace', 'audio.event', 'audio.playGame', 'a window that never scrolls'],
    how: [
      'audio.trace hands over batches about ten times a second. Played rows are events, named when REDnode knows the name (REDbridge\'s list, loaded by the host, so no permission is needed). Loaded rows are sound ids.',
      'Each column is its own scrolling list that keeps the newest 2,000 rows; the window around them has a fixed size and never scrolls. Rows stick to the bottom unless you scroll up.',
      'Play on an event plays its own recordings in turn through REDnode\'s engine (audio.playGame with { event }), heard wherever the sound is in the game; it is greyed for an event with none, such as a stop event. G posts the event through the game on V instead, with the game\'s mix. Play on a Loaded row plays that one recording. Stop beside each stops it; Stop all stops everything the Tracer started.',
      'The host also writes every row to red4ext/logs/rednode-sound-trace.log, so nothing is lost when a column drops old rows.',
      'Part of REDnode Sound Tools.',
    ],
    tryThis: [
      'Press Start trace and watch both columns fill.',
      'Type katana in the filter.',
      'Press Pause, wait, then Resume: the rows that came in the meantime are added.',
      'Paste 746693166 in the box at the bottom and press Enter.',
    ],
    preview: 'The sounds on this page are made up and play as a tone: in the game the plugin hooks its audio engine and plays the real recordings.',
  },
  'sound-search': {
    group: 'game',
    summary: 'Search the game\'s sound events by name, tag, event id or sound id, play any of their recordings, and keep what you find in a Scratch tab.',
    teaches: ['audio.searchSounds', 'audio.playGame', 'audio.event', 'ui.copy', 'localStorage in an app'],
    how: [
      'audio.searchSounds asks the host, which keeps a catalogue of every event the game\'s sound index has recordings for and every event REDbridge\'s list names. All the words you type must appear in an event\'s name or tags; a number finds an event by its id, or the events that play that sound id.',
      'Names arrive a few seconds after the first search while REDbridge starts: the window searches again until they are in.',
      '▶ on an event plays its recordings in turn through REDnode\'s engine; ▸ lists them, each playable on its own. G posts the event through the game on V.',
      '☆ saves an event or a recording to Scratch. Scratch lives in the window\'s local storage, so it is still there in the next game session.',
      'Part of REDnode Sound Tools.',
    ],
    tryThis: ['Type katana.', 'Open w_melee_katana_equip with ▸ and play its recordings one by one.', 'Save one with ☆, then open the Scratch tab.', 'Search 746693166: the event that plays that sound opens with it marked.'],
    preview: 'The catalogue on this page is made up and plays a tone: in the game it holds over 23,000 events and plays the real recordings.',
  },
  vitals: {
    group: 'hud',
    summary: 'A HUD widget with V\'s health, level and money, read through the generic game API from a web page.',
    teaches: ['kind: "hud"', 'api.GetPlayer', 'api.GameInstance', 'api.$call'],
    how: ['The same calls as the Game API mod, from a page instead of Node: the rednode package works in both.'],
    tryThis: ['Press Hurt V below and watch HP refill.'],
  },
};
