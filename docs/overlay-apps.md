# Overlay apps

Overlay apps are small web apps drawn on top of the game: HTML, CSS and JavaScript. They talk to the game through the `rednode` package and can play the game's own UI sounds. [Node mods](#node-mods) use the same package from Node, and can open windows without writing HTML. Every example on this page was tested in game on Cyberpunk 2077 2.31, each with the REDnode version its section names; the sample apps passed again on game 2.5 with REDnode 0.38.1.

Status: **developer preview.** See the [overlay design](overlay.md) for how it works and what is planned.

## How an app runs

| Part | What it does for your app |
|---|---|
| Overlay host (Electron, outside the game) | Renders your page off-screen and streams it to the game. Gives your page `window.rednode` |
| REDnode plugin (inside the game) | Draws your window, moves it when dragged, and sends you mouse and keyboard input |
| Bridge | Runs your game calls on the game thread and returns the answer as a promise |

In the game, **F10** cycles three modes: passive (your window is drawn, the game gets input), interactive (your window gets input) and hidden. **Esc**, or a click on empty screen, returns input to the game.

> **Careful with F9.** It sits right beside F10 and is the game's Quick Load: pressed by mistake, it loads the last save, and what the player did since is lost. The Welcome window warns players too.

The player decides where your package shows, in the built-in **Mod Manager** (opened from the launcher):

| Pin | What it means |
|---|---|
| **Pin to launcher** | Your package is listed in the launcher. Every package is listed in the Mod Manager anyway |
| **Pin to HUD** | Your windows stay on screen during gameplay (passive mode). Unpinned, they show only while the player interacts (F10). HUD widgets are always on the HUD |

A package installed after REDnode 0.14.0 starts with neither pin, and the launcher counts it as new until the player has seen it in the Mod Manager. Tell your players to pin it if it should stay on screen.

## Your first app

An app is a folder with a manifest and a page. Put it in the apps folder: `packages/overlay/apps/` in the repo, or `red4ext/plugins/REDnode/apps/` in the game folder.

`hello/rednode-app.json`:

```json
{
  "id": "hello",
  "name": "Hello Night City",
  "version": "0.1.0",
  "author": "you",
  "description": "Shows where V is.",
  "entry": "index.html",
  "width": 360,
  "height": 200,
  "anchor": "top-left",
  "x": 100,
  "y": 100
}
```

`hello/index.html`:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="rednode://ui/rednode-ui.js"></script>
<style>
  html, body { margin: 0; width: 360px; height: 200px; background: transparent; }
  rn-window { position: absolute; inset: 6px; }
</style>
</head>
<body>
  <rn-window title="Hello Night City" draggable>
    <rn-button id="where">Where am I?</rn-button>
    <p id="out"></p>
  </rn-window>
  <script>
    document.getElementById('where').addEventListener('click', async () => {
      const p = await window.rednode.call('player.position');
      document.getElementById('out').textContent = `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}`;
    });
  </script>
</body>
</html>
```

Start the game, press F10, open the **REDNODE** launcher tab at the lower left, open the **Mod Manager**, find **Hello Night City** and switch it on (pin it to the launcher to find it there next time). Load a save and click the button. All manifest fields are listed in the [overlay host README](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay#apps-and-manifests).

| Rule | Why |
|---|---|
| Keep the page background **transparent** | Transparent pixels show the game, and clicks on them pass through to whatever is behind |
| Give the page the window's **fixed size** | Pages are drawn 1:1 at 1080p and scaled with the screen height: 2x at 4K |
| **Don't draw a cursor** | The plugin draws it, at the game's frame rate |

## A titled window from markup

The [UI kit](https://github.com/Edgemodders/REDnode/tree/main/packages/ui) turns markup into widgets. This is the test app [`apps/kit`](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/kit), cut down:

```html
<rn-window id="win" title="UI kit // O2" draggable>
  <rn-toggle id="theme" slot="status" label="Game theme"></rn-toggle>
  <rn-tabs>
    <rn-tab label="Controls">
      <rn-panel title="Settings">
        <rn-toggle label="Freeze time" checked></rn-toggle>
        <rn-slider id="rain" label="Rain" min="0" max="100" value="35" unit="%"></rn-slider>
        <rn-input id="name" label="Call sign" placeholder="Type here"></rn-input>
        <rn-progress id="progress" label="Upload" value="35"></rn-progress>
      </rn-panel>
    </rn-tab>
    <rn-tab label="Lists">
      <rn-list id="list">
        <rn-item value="arasaka" selected>Arasaka <span slot="end">corp</span></rn-item>
        <rn-item value="militech">Militech <span slot="end">corp</span></rn-item>
      </rn-list>
    </rn-tab>
  </rn-tabs>
</rn-window>
```

The script only wires events:

```js
document.getElementById('theme').addEventListener('change', (e) => {
  document.getElementById('win').setAttribute('theme', e.detail.checked ? 'game' : 'rednode');
});
document.getElementById('rain').addEventListener('input', (e) => {
  document.getElementById('progress').setAttribute('value', e.detail.value);
});
document.getElementById('list').addEventListener('select', (e) => {
  RednodeUI.notify(`Selected ${e.detail.value}`, { title: 'List' });
});
```

| `theme="rednode"` | `theme="hud"` |
|---|---|
| ![The kit window in the REDnode theme](assets/overlay/kit-rednode-theme.png) | ![The kit window in the HUD red theme](assets/overlay/kit-game-theme.png) |

A third theme, `theme="edge"` (EDGE), has solid yellow title bars. The player picks one theme for every window in the launcher; an app that sets its own keeps it. (`hud` and `edge` were called `game` and `yellow` before REDnode 0.16.1; the old names still work.)

The grey checkerboard in these captures is the transparent part of the page. In game, the game shows there.

## A native-looking button

No window frame at all: a borderless page with one game-style button and its menu. The rest of the page is transparent, so it looks like part of the game's UI. From [`apps/native`](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/native):

```html
<body theme="hud">
  <rn-menu id="menu" title="Stash" hidden>
    <rn-menu-item value="sell">Sell junk <span slot="end">12</span></rn-menu-item>
    <rn-menu-item value="sort">Sort by value</rn-menu-item>
    <rn-menu-item value="close">Close</rn-menu-item>
  </rn-menu>
  <div class="grip" data-rednode-drag></div>
  <rn-button id="open" sound="ui_menu_onpress">Open stash</rn-button>
</body>
```

```js
const menu = document.getElementById('menu');
document.getElementById('open').addEventListener('click', () => { menu.hidden = !menu.hidden; });
menu.addEventListener('select', (e) => {
  menu.hidden = true;
  if (e.detail.value !== 'close') RednodeUI.notify(`Picked ${e.detail.value}`, { title: 'Stash', theme: 'game' });
});
```

![The native-style button with a game-themed notification](assets/overlay/native-button.png)

Any element with `data-rednode-drag` is a drag handle; here, a small striped grip. `<rn-window draggable>` makes its title area the handle.

## A HUD widget

A HUD widget is drawn over the game but never takes input, like the game's own HUD. Set `"kind": "hud"` in the manifest, and list in `"hideWith"` when the game should hide it. From [`apps/coords`](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/coords):

```json
{
  "id": "coords",
  "name": "Coords HUD",
  "entry": "index.html",
  "kind": "hud",
  "hideWith": ["menu", "photo-mode", "scene", "main-menu"],
  "width": 520,
  "height": 72,
  "anchor": "top",
  "x": 0,
  "y": 14
}
```

| `hideWith` value | Hidden while |
|---|---|
| `menu` | A game menu is open: inventory, map, pause and so on |
| `photo-mode` | Photo mode is on |
| `scene` | A cinematic scene plays (the game's scene tier 4 or higher; unverified) |
| `main-menu` | There is no player: the main menu and loading screens |

The REDnode plugin does the hiding, in the same frame the game changes state. To react in the page as well, listen for `ui-state`:

```js
window.rednode.on((m) => {
  if (m.event === 'ui-state') console.log(m.menu, m.photoMode, m.scene, m.mainMenu, m.sceneTier);
});
```

## Playing game sounds

Sounds play through the game's own audio system, so they mix with the game and follow its volume settings. The bridge call `audio.play` runs the game's native `AudioSystem.Play` with no entity, the way the game plays its 2D UI sounds.

Three ways, from simplest to most control:

```html
<!-- 1. An attribute on a UI kit widget: plays on press -->
<rn-button sound="ui_menu_onpress" hover-sound="ui_menu_hover">Apply</rn-button>
```

```js
// 2. The kit's helper. Never throws; silently skipped outside the game.
RednodeUI.playSound('ui_jingle_quest_success');

// Or set a default for every press in the app:
RednodeUI.sounds.press = 'ui_menu_onpress';

// 3. The bridge call itself. Resolves when the game has played it.
await window.rednode.call('audio.play', { name: 'ui_loot_take_all' });
```

Sound event names confirmed in game on 2026-10-11:

| Name | Use |
|---|---|
| `ui_menu_onpress` | Button press |
| `ui_menu_hover` | Hover |
| `ui_menu_tutorial_close` | Closing a panel |
| `ui_loot_take_all` | Taking items |
| `ui_menu_item_bought` | A purchase |
| `ui_jingle_quest_success` | A success jingle |

The game has many more. An unknown name plays nothing and is not an error, so the kit app's **Sound** tab is the quickest way to try one. The same call from redscript is in the game API reference: [AudioSystem.Play](game/t/gameGameAudioSystem.html#Play).

## Your own sounds

A package can play its own audio files: WAV, OGG, MP3 and FLAC. They play through REDnode's audio engine in the plugin, beside the game's sound, so no soundbank or REDmod is needed. Each sound follows one of the game's volume sliders, under master volume:

| Category | Slider | Default for |
|---|---|---|
| `sfx` | Sound effects | Every sound without a category |
| `dialogue` | Dialogue | Voice lines |
| `music` | Music | Music; read as it plays instead of loaded first |

Sounds pause while a game menu is open and go on when it closes; one started in a menu begins when the menu closes. REDnode mixes in stereo and plays on the front left and right speakers, also on a surround device. When the player's **Mute in background** setting is on, they mute while the game is in the background. A package's sounds stop when the package stops: switched off, restarted or hot reloaded.

Name a sound by its file in your package's folder, or declare it in `rednode-app.json` with its settings and play it by that name:

```json
"sounds": {
  "alarm": { "file": "sounds/alarm.ogg", "volume": 0.8 },
  "theme": { "file": "sounds/theme.ogg", "category": "music", "loop": true, "fadeIn": 2000 },
  "click": "sounds/click.wav"
}
```

```js
import { audio } from 'rednode';

const theme = await audio.play('theme');                    // the manifest's settings
const ping = await audio.play('sounds/ping.wav', { pan: -1 }); // a file, with settings
await theme.set({ fadeTo: { volume: 0.3, ms: 1000 } });     // quieter, over a second
await theme.stop({ fadeOut: 2000 });
const { why } = await ping.ended;                           // "ended", "stopped" or "error"
```

Settings, in the manifest or in the call (the call's win):

| Setting | Meaning |
|---|---|
| `category` | `sfx`, `dialogue` or `music` |
| `volume` | 1 as recorded |
| `loop` | Repeat until stopped |
| `delay` | Milliseconds to wait before it starts |
| `start`, `end` | Seconds into the file to start and to end; a loop repeats between them |
| `rate`, `semitones` | Speed and pitch together: `rate: 2` or `semitones: 12` is an octave up and twice as fast |
| `pan` | -1 left to 1 right |
| `fadeIn` | Milliseconds to fade in |
| `stream` | Read the file as it plays instead of loading it first; on by default for music |
| `pauseInMenu` | Pause while a game menu is open; on by default |

A sound your package makes while it runs, such as a spoken line from a speech service, goes in your data folder: write the file into `pkg.dataDir` and play it by its full path (REDnode 0.44.0 and later), `audio.play(path.join(pkg.dataDir, 'line-1.wav'), { category: 'dialogue' })`. Not into your package's folder: hot reload watches it. The engine reads the file at each play, so a file written again plays its new sound.

`audio.playing()` lists your sounds with their position, and `audio.stopAll()` stops them. The file loads in the background, so `audio.play` returns at once and the sound starts when it is ready. The same works from an overlay app's page. The [Sound API page](sound.md) has the plan: sound on entities and positions comes next.

## Talking to the game

Import the `rednode` package, the same one Node mods use. An import map lets the page import it by name; the host serves it at `rednode://sdk/index.js`. This is the [Coords HUD](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/coords) app:

```html
<script type="importmap">{ "imports": { "rednode": "rednode://sdk/index.js" } }</script>
<script type="module">
  import { game } from 'rednode';

  setInterval(async () => {
    try {
      const p = await game.player.position();   // { x, y, z }; fails at the main menu
      document.getElementById('x').textContent = p.x.toFixed(1);
    } catch {
      // no player yet
    }
  }, 500);
</script>
```

| Call | What it does |
|---|---|
| `game.player.position()` | V's world position. Rejects at the main menu, where there is no player |
| `game.player.addItem(id, count?)`, `game.player.removeItem(id, count?)` | Puts items in V's inventory, or takes them out, by TweakDB id: `addItem("Items.Pants_01_basic_01")`. `addItem` rejects an id with no record (REDnode 0.42.0) |
| `game.audio.play(name)` | Plays a game sound event |
| `game.on(name, handler)` | A game event: `"PlayerPuppet.OnGameAttached"` (at the main menu and on every save load), `"language"` (the player changed the game's language), and the `quests.fact:<name>` events that [`quests.watch`](quests.md) uses |
| `game.state()`, `game.onState(handler)` | Whether a menu, photo mode, a scene or the main menu is showing, whether V is in the world (`world`), the overlay mode, and whether the game is linked |
| `loc.text(key)` | The game's own text for a LocKey, in the player's language: `loc.text("LocKey#10963")` gives "Little China" in English. An array of keys reads them all in one round trip; `null` for a key the game does not know (REDnode 0.47.0) |
| `game.call(method, params)` | Any bridge method by name, for example `"game.info"` |

### When the world exists

The game's world systems (time, weather, districts, quests, the journal) exist only while V is in the world. A mod linked while the game starts, at the main menu or during a load must not call them: some crash the game. `game.state().world` says when they exist (REDnode 0.47.0):

| The game | `mainMenu` | `world` |
|---|---|---|
| Starting, before the main menu | true | false |
| Main menu | true | false |
| Loading a save, from the main menu or the pause menu | true once the old world is gone (unverified) | false from the start of the load |
| V in the world | false | true |

```js
import { api, game } from 'rednode';

let timer;
game.onState((s) => {
  if (s.world && !timer) timer = setInterval(readWeather, 1000); // V arrived
  if (!s.world && timer) { clearInterval(timer); timer = undefined; } // a load started, or the main menu
});
```

While `world` is false, `api` refuses the game's global and static functions that take a `GameInstance`, such as `api.GameInstance.GetWeatherSystem`, with "V is not in the world yet". Two answer safely without a world and stay allowed: `GetPlayer` (it gives `null`) and `GetSettingsSystem`. Methods of game objects you already hold are not checked: get fresh ones after each load.

The full list, with examples, is in the [API reference](api/). For anything else in the game, use the [game API](#the-game-api).

The older `window.rednode` calls still work, and the overlay events `focus` and `overlay` come only through it:

```js
window.rednode.on((m) => {
  if (m.event === 'focus') console.log('focused:', m.focused); // dim your title when false
  if (m.event === 'overlay') console.log('mode:', m.mode);   // passive, interactive or hidden
});
```

## Node mods

A Node mod is Node code that runs in the REDnode host, outside the game: full Node and npm, `await` anywhere, and the game never waits for it. It is a folder with a manifest that has `main` instead of `entry`:

```json
{
  "id": "hello-mod",
  "name": "Hello mod",
  "version": "0.1.0",
  "author": "Edgemodders",
  "description": "A Node mod with a window built by the rednode ui builder.",
  "main": "mod.mjs",
  "open": true
}
```

A mod opens windows with the **ui builder**: a tree of nodes, rendered by the host with the UI kit. No HTML. This is the [Hello mod](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/hello-mod), shortened:

```js
import { game, ui } from 'rednode';

const where = ui.text('Waiting for the game...');

ui.window({
  title: 'Hello mod',
  anchor: 'right',
  x: -40,
  children: [
    ui.heading('Where is V'),
    where,
    ui.row(
      ui.button('Play sound', () => game.audio.play('ui_menu_onpress')),
      ui.toggle('Follow', (on) => console.log('Follow', on), { checked: true }),
    ),
  ],
});

setInterval(async () => {
  try {
    const p = await game.player.position();
    where.set({ text: `X ${p.x.toFixed(1)}   Y ${p.y.toFixed(1)}   Z ${p.z.toFixed(1)}` });
  } catch (err) {
    where.set({ text: err.message, tone: 'dim' });
  }
}, 500);

game.on('PlayerPuppet.OnGameAttached', () => console.log('A save was loaded'));
```

| Node | Makes |
|---|---|
| `ui.text(text, { tone })`, `ui.heading(text)` | Text. `tone` is `dim`, `accent` or `danger` |
| `ui.button(label, onClick, { variant, sound })` | A button. `variant` is `ghost` or `danger` |
| `ui.toggle(label, onChange, { checked })` | An on and off switch |
| `ui.slider(label, onChange, { min, max, step, value, unit })` | A slider |
| `ui.input({ label, placeholder, value, password, onChange, onSubmit })` | A text field; `password: true` shows dots (0.44.0), for a key you keep with `secrets` |
| `ui.progress(value, { label, max })` | A progress bar |
| `ui.list({ lines, keep, height, follow })` | A list of lines that scrolls on its own, for a log or a live feed. `push(...lines)` adds at the bottom (only the new lines travel to the window) and `clear()` empties it. It keeps the newest `keep` lines (500 by default, up to 5,000) and follows the newest one unless the player has scrolled up. Without `height` it fills the space the other nodes leave, at least 160 px; when they leave less, the window scrolls |
| `ui.row(...nodes)`, `ui.column(...nodes)` | Layout |
| `ui.window({ title, width, height, anchor, x, y, children, onClose })` | Opens the window. The player can drag it in interactive mode, and its position is saved. A saved position applies only while the window keeps the size it was saved with; after a size change it opens at its anchor again |

Every node has `set(props)`, which updates the open window at once.

| Good to know | |
|---|---|
| Output | `console.log` goes to `red4ext/logs/rednode-mods.log`, tagged with the mod id. Open the built-in **Mod log** app from the launcher to watch it live in game; **Copy** puts the lines shown on the clipboard, ready to paste into a bug report. A crash shows only the stack lines in your own code |
| Isolation | Each mod runs on its own thread in a mod process. A thrown error, an endless loop or `process.exit()` stops only your mod. The launcher shows it as **CRASHED** or **NOT RESPONDING** with a **Restart** button |
| Memory | A mod process costs about 80 MB. Players can put mods in one **shared process** with the launcher; three mods then took about 92 MB in total. A native crash in the shared process stops every mod in it, so a mod with native addons should set `"isolation": "process"` |
| Hot reload | With **Hot reload** on in the launcher's settings (the gear at the right of the Theme row), saving a mod's file restarts the mod, and saving an app's file reloads its page |
| New and removed packages | The host watches the apps folders while it runs. A new package folder starts (if its manifest has `"open": true`), a changed manifest restarts its package, and a removed folder stops it. A package whose manifest names a file that does not exist yet is skipped, and looked at again when any of its files changes |
| Developing outside the game folder | Add your project's folder as a [development folder](#development-folders): the package runs from there, with hot reload, instead of its installed copy |
| `.mjs` | Use the `.mjs` extension for `import` syntax, or add a `package.json` with `"type": "module"` |

### Development folders

A package can live in your own project, for example `E:\Modding\MyMod\`, and still run in the game with hot reload. You copy it into the game's apps folder only when you install it for real. REDnode 0.33.0 or later.

1. Press **F10**, open the launcher and its settings (the gear at the right of the Theme row), and switch on **Developer mode**.
2. Under **Development folders**, paste the folder's full path and press **Enter**. Its packages start at once.

| Good to know | |
|---|---|
| What a folder holds | Either one package (the folder has its own `rednode-app.json`) or packages in subfolders, as the apps folder does |
| A package in two places | The development copy runs. The installed copy is skipped, and the Mod Manager shows the package as **DEV** with the copy it hides. Remove the folder, or change the copy's `id`, and the installed copy runs again |
| `pkg.dir` | The folder the package runs from. `pkg.dataDir` stays the same, so a development copy and the installed copy share their settings and saved data |
| `pkg.appsDirs` | Holds the development folders too, before the apps folder. REDagent writes only inside these folders, so it can work on your project's packages, still showing you each change first |
| Where it is kept | In the overlay host's `settings.json`, as `devFolders`. Each folder is kept until you press **Remove**, also when Developer mode is off, but the list shows only with Developer mode on |

## Data, secrets and the kernel

| Call | Gives | Where |
|---|---|---|
| `pkg.id`, `pkg.dir`, `pkg.dataDir` | This package's id, its folder in the apps folder, and a data folder of its own outside it, which survives updates. Write files to `dataDir`, never to `dir`: hot reload watches `dir` | Node mods |
| `secrets.get(name)`, `secrets.set(name, value)`, `secrets.delete(name)` | Secrets such as an API key, encrypted with the player's Windows account and kept by the host. A package reads only its own. A secret that cannot be decrypted, for example one saved under another Windows account, reads as `null` | Node mods and apps |
| `secrets.shared(service)`, `secrets.askShared(service, { reason, offer })` | One of the player's [shared keys](keys.md) (Anthropic, Google Gemini, OpenAI, ElevenLabs or any other), typed once and read by every EDGE tool on the PC. List `"keys:<service>"` in the manifest's `permissions`, such as `"keys:gemini"`. `shared` gives the key, or `null` until the player allows it or while none is set; `askShared` opens REDnode's own **Key request** window when needed, where the player allows the package and pastes a missing key, and gives the key or `null`. The package never writes the store. REDnode 0.48.0 | Node mods and apps |
| `kernel.mcp()` | The address and a token for the [kernel MCP server](mcp.md), for an AI agent in the package. The package must list `"permissions": ["mcp"]` in its manifest, and the player must allow it in the Mod Manager | Node mods and apps |
| `channel.post(data)`, `channel.on(handler)` | Messages between a package's pages and its own Node mod: a web UI with a Node backend | Node mods and apps |
| `kernel.requirements()` | The package's `requires`, checked against the game folder (see [Requirements](#requirements)) | Node mods and apps |
| `tweakdb` | TweakDB's records and flats, read from the running game (see [TweakDB](#tweakdb)) | Node mods and apps |
| `kernel.bridge()` | REDbridge, WolvenKit's engine, for the game's archives and files (see [The game's files through REDbridge](#the-games-files-through-redbridge)). Needs `"permissions": ["bridge"]` and the player's OK | Node mods and apps |
| `archives.reload(files)` | Swaps changed archives into the running game (see [Swapping archives in the running game](#swapping-archives-in-the-running-game)). Needs `"permissions": ["archives"]` and the player's OK | Node mods and apps |

```js
import { pkg, secrets, kernel } from 'rednode';

await secrets.set('api-key', key);
const { url, headers } = await kernel.mcp(); // rejects until the player allows it

// rednode-app.json: "permissions": ["keys:gemini"]
const gemini = (await secrets.shared('gemini')) ?? (await secrets.askShared('gemini', { reason: 'To make your textures' }));
```

A package that kept a key in its own `secrets` before can offer it to the shared keys: `askShared` with `offer` shows the player only its last 4 characters, and moves it when the player allows. Then delete the package's own copy:

```js
const mine = await secrets.get('api-key');
const key = (await secrets.shared('anthropic')) ?? (await secrets.askShared('anthropic', { offer: mine ?? undefined }));
if (key && mine) await secrets.delete('api-key');
```

## Requirements

A package that needs other mods says so in its manifest. REDnode checks the game folder, the Mod Manager marks a package that misses something (**NEEDS** in the table, the list under **Requires** in its details), the launcher says what is missing, and a Node mod's log gets a line when it starts. The package still runs: it can check for itself and explain.

```json
"requires": {
  "codeware": ">=1.16",
  "archivexl": ">=1.23"
}
```

| What a name can be | Version from |
|---|---|
| A RED4ext plugin: its folder in `red4ext/plugins`, or its DLL's name. A folder without a DLL is not a plugin (uninstalls leave such folders behind) | The DLL's file version, when it has one (Codeware, ArchiveXL, TweakXL). Otherwise the version the plugin reported to RED4ext the last time the game loaded it, from RED4ext's newest log, if the DLL has not changed since. Else "version unknown", which still counts as installed |
| A redscript module: a folder or `.reds` file in `r6/scripts` | None: installed or not |
| A Cyber Engine Tweaks mod: a folder in `bin/x64/plugins/cyber_engine_tweaks/mods` | None |
| `red4ext`, `cet` (or `cyber engine tweaks`), `redscript` | RED4ext's and CET's file versions; redscript has none |
| `redbridge`: not in the game folder, but a package may need it (see [The game's files through REDbridge](#the-games-files-through-redbridge)) | The version of the copy REDnode uses. When it is missing, the Mod Manager shows **Get REDbridge** |

Names match without regard to case, spaces, dashes or underscores. Ranges: `>=1.16`, `>1`, `<2`, `<=1.2`, `1.20` (any 1.20.x), `=1.20.3`, `^1.16` (1.16 or later, before 2), `~1.16` (1.16.x), `*` (any version); several separated by spaces must all hold, and `||` gives alternatives.

```js
import { kernel } from 'rednode';

const missing = (await kernel.requirements()).filter((r) => !r.ok);
// [{ name: 'Codeware', wants: '>=1.16', found: null, installed: false, ok: false, note: 'not installed' }]
```

## The game's files through REDbridge

[REDbridge](https://github.com/Edgemodders/REDbridge) runs WolvenKit's engine and answers JSON-RPC: the game's archives (list, search, extract), CR2W files as JSON and back, textures as PNG, hashes. REDnode does not ship it (it is GPL-3.0, its own program). Where a package needs it and none is found, the Mod Manager shows a **Get REDbridge** button: it downloads the newest release from GitHub into `%LOCALAPPDATA%\REDnode\bridge`, checked against GitHub's SHA-256, and the .NET 10 runtime for that Windows user if the PC has none, with no admin rights. REDnode also uses a copy [EDGEdeck](https://github.com/Edgemodders/EDGEdeck) or REDcode fetched, or one set with the `REDBRIDGE_EXE` environment variable; the newest wins. Once a session, after the first call, REDnode asks GitHub for a newer REDbridge and the Mod Manager offers **Update REDbridge**; it never updates by itself. One REDbridge serves every package: it starts on the first call, loads the game's archive index in about three seconds, and stops after 10 minutes without calls.

Add `"permissions": ["bridge"]` to the manifest; the player allows it in the Mod Manager, which also says where REDbridge was found. Add `"requires": { "redbridge": ">=0.10" }` too, so the Mod Manager marks the package and shows the button before it runs.

```js
import { kernel } from 'rednode';

const bridge = await kernel.bridge(); // rejects until allowed, or when REDbridge is not installed
const archives = await bridge.call('archive.archives');
const found = await bridge.call('archive.search', { query: 'player_ma_tpp', limit: 5 });
await bridge.call('archive.extract', { path: found.items[0].name, outFile: 'C:/temp/player.ent' });
```

Parameters go by name, as REDbridge's [method list](https://edgemodders.github.io/REDbridge/) gives them. The [Packaging test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/packaging-test) sample lists and searches the archives.

## Swapping archives in the running game

A tool that builds assets, such as a material or mesh editor, can show its result in the game without a restart. `archives.reload` swaps an `.archive` into the running game and waits until the swap is done:

```js
import { archives } from 'rednode';

const r = await archives.reload(['C:/Projects/MyJacket/packed/archive/pc/mod/MyJacket.archive']);
console.log(`${r.reloaded.length} swapped in ${r.ms} ms`, r.failed);
```

| Detail | |
|---|---|
| Files | A path, absolute or in the package's folder, to an `.archive` or to ArchiveXL's `.xl` or `.yaml`. A name alone, such as `"MyMod.archive"`, is an archive already in `archive/pc/mod`, reloaded as it is |
| Where it goes | It replaces the mounted archive of the same name, wherever it is, and stays installed. One the game has not mounted is added to `archive/pc/mod` |
| Needs | `"permissions": ["archives"]`, which the player allows in the launcher. [REDswap](redswap.md), a plugin installed with REDnode (0.41.0 or later), does the swap. Before it, [RED Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) did (`"requires": { "redhottools": ">=1.3" }`), and REDnode still uses it when REDswap is not loaded. The official RED Hot Tools can end the game when it replaces an archive in a folder with both upper- and lowercase names; the [Edgemodders build](https://github.com/CyberbuildsAI/cp2077-red-hot-tools/releases) fixes it, and with the official one REDnode refuses such a swap with a message instead (REDnode 0.26.19 or later) |
| When | In a loaded save. At the main menu it is refused |
| One at a time | Calls made during a swap wait their turn |
| Sound | An archive that changes the game's sound paks (`.opuspak`, `.opusinfo`, such as EDGEwave's sound overrides) is swapped with the game paused and its audio held for the swap, then REDnode loads the game's sound index again, so the new sounds play. A sound that played just before the swap may keep its old version until the game loads it again (for a weapon, equip it again). On a game version whose sound tables REDnode does not know, such an archive is refused: install it and restart the game |
| What V wears | After the swap, the clothing V wears applies its appearance again, so it shows the new version while staying worn (base-game slots and Equipment-EX's; items Equipment-EX hides stay hidden). `archives.reload(files, { refresh: false })` skips it. Other things already in the world keep the old version until they load it again (REDnode 0.26.20 or later) |
| The answer | `{ reloaded, failed, via: "redswap", ms, refreshed, preview, world }` (`refreshed`: what V wears, applied again; `preview`: the same slots on the inventory's preview of V; `world`: spawns and entities near V), plus `sound: { index, note }` when sound paks were swapped (`index` is `"reloaded"` when the new sounds play). A file that could not be swapped is in `failed` with the reason. A missing file, a missing permission, the main menu, sound paks on an unknown game version, RED Hot Tools not loaded, or a replace the official RED Hot Tools would get wrong throw |

`archives.soundState(soundIds?)` reads the game's sound pak index and the paks it has open, without changing them, and where the index puts the sound ids given. It also says how many sounds the game holds loaded. It is a diagnostic from the research into swapping sound ([H1c](world.md#h1c-how-the-game-loads-its-sound-paks-research)); its shape may change.

What the game shows after a swap: objects already in the world keep the old asset until they load it again. Respawn them, or apply their appearance again. A broken archive, or a mod whose other parts are missing, can crash the game at the swap even if it loaded at start.

AI agents have the same as the [MCP tool](mcp.md) `archives_reload`.

## Spaces and the title bar

Players can sort windows into **spaces**, like virtual desktops: the launcher's **Space** row makes them, the tab switches them, and so does Ctrl+1 to 9 while the overlay is open. Only the current space's windows show; REDnode's own tools show in all. A package needs nothing to take part: its windows join the space the player is in, and the player moves them from the title bar or the Mod Manager.

An `rn-window` title bar shows close and up to three action icons, right to left: move to space (once there is a second space), roll up, pin to HUD, reset position (after the window was moved), and debug in Developer mode. More than three: ⋯ on the far left holds the rest. The overlay-window actions (space, pin, reset) show only on a page's only `rn-window`, since they act on the whole page. To leave one out for a window, add `no-space`, `no-rollup` or `no-debug`. A panel that belongs to the main window, such as a settings drawer beside it, takes `drawer`: it does not count as a second window, has no actions but close, and closing it only hides it.

```html
<rn-window title="Speedometer" draggable no-rollup>...</rn-window>
```

## Pointer lock

A page can hold the cursor in place and get the mouse's raw movement, as a 3D editor's camera or a game's view needs. Use the web's own Pointer Lock API; REDnode's plugin does the holding in the game.

```js
pad.addEventListener('pointerdown', (e) => {
  if (e.button === 2) pad.requestPointerLock(); // rejects if the overlay is not interactive
});
document.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === pad) turnCamera(e.movementX, e.movementY);
});
addEventListener('pointerup', (e) => {
  if (e.button === 2) document.exitPointerLock();
});
```

While locked, the cursor stays where the lock began and is hidden, and every mouse movement arrives as `pointermove` (and `mousemove`) on the locked element, with `movementX` and `movementY`. Buttons and the wheel work as usual, the middle button included. The lock ends with `document.exitPointerLock()`, Esc, leaving interactive mode (F10), or the window closing; `pointerlockchange` tells the page each time. Only the window the player is using may take the lock. The [Pointer lock test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/pointer-test) sample turns a camera with it.

## Staying on top and solo mode

REDnode's own windows (the launcher tab, Mod log, Mod Manager, debuggers) live in a **tool layer**, above every package's windows: a full-screen package cannot cover them. A package can ask to join them with `"permissions": ["front"]`; the player allows it in the Mod Manager. The Test timer does this.

A package that needs the screen to itself, such as an editing viewport, can ask for **solo mode**: every other package's windows and HUD widgets are hidden until it ends. Tool windows stay. Add `"permissions": ["solo"]` to the manifest; the player allows it in the Mod Manager.

```js
import { ui } from 'rednode';

ui.onSolo((on) => console.log(on ? 'solo on' : 'solo off'));
await ui.solo(true);  // rejects until the player allows it
await ui.solo(false);
```

Solo ends when the package turns it off, stops or crashes, another package takes it, or the player presses **End** beside the launcher tab, which shows "SOLO" and the package's name. `ui.onSolo` hears every end, so a package can keep its own button in step. The [Layers test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/layers-test) sample shows both.

## Editor tools: the editor channel

A tool on the player's PC, such as a VS Code extension, can ask the running game to play a sound event, so a modder picking a music cue or a sound hears it with the game's own mix. No MCP server and no token to copy: while REDnode runs, it writes `%LOCALAPPDATA%\REDnode\editor.json` with its port and a token made new each run, and only the player's own programs can read it. REDnode 0.43.0 ([#17](https://github.com/Edgemodders/REDnode/issues/17)).

```js
// In a VS Code extension (Node): play a game sound event in the running game.
const fs = require('node:fs');
const path = require('node:path');

async function rednode(call, body) {
  const file = path.join(process.env.LOCALAPPDATA, 'REDnode', 'editor.json');
  try {
    const { port, token } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const res = await fetch(`http://127.0.0.1:${port}/editor/${call}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, reason: 'Start the game with REDnode to hear this' };
  }
}

const played = await rednode('sound.play', { name: 'ui_menu_onpress' }); // { ok, playingId, on }
await rednode('sound.stop', { playingId: played.playingId });             // { ok, stopped }
```

| Call | Body | Answer |
|---|---|---|
| `GET /editor/info` | | `{ ok, version, connected }` |
| `POST /editor/sound.play` | `{ name, on? }`: `on` is `"player"` (the default: on V, so positional sounds are heard; no entity at the main menu) or `"none"` | `{ ok, playingId, on }`. The game plays nothing for a name it does not know, and does not say so |
| `POST /editor/sound.stop` | `{ playingId }`, or `{}` for every sound the channel started | `{ ok, stopped }` |

An error answers `{ ok: false, reason }`: 401 without the right token, 409 while the game is not linked, 400 for a bad body. The channel listens on 127.0.0.1 only and refuses requests from web pages (any `Origin` header) and under another host name, so call it from the extension's Node side, not from a webview. When the game ends, Windows ends REDnode at once and `editor.json` stays behind: a refused connection, or a `pid` that no longer runs, means no game. Players can turn the channel off with `"editorChannel": "off"` in `%APPDATA%\@rednode\overlay\settings.json`. More calls, such as hot-loading an archive after an in-game Allow, come later.

## Calling other packages

A package can offer functions to every other package, and call theirs: a quest mod asks a world builder for a scene's places, a HUD widget asks a stats mod for its numbers. REDnode 0.34.0 and later; descriptions from JSDoc come with 0.35.0 and AI assistants calling them as tools with 0.36.0. The design and its tests are on the [Mod services](services.md) page.

To offer some, name a **service file** in the manifest. Every function it exports can be called by other packages, by your package's id:

```json
{ "id": "counter-service", "name": "Counter service", "version": "0.1.0", "service": "service.mjs" }
```

```js
// service.mjs
import { service } from 'rednode';

let count = 0;

/**
 * Adds to the count, and tells every connected package.
 * @param {number} [by=1] How much to add.
 * @returns {number} The new count.
 */
export function add(by = 1) {
  count += by;
  service.emit('changed', { count, from: service.caller()?.name });
  return count;
}
```

To call one, connect by the package's id; each function it exports is then a method that returns a promise:

```js
import { service } from 'rednode';

const counter = await service.connect('counter-service');
await counter.add(5);                                        // 5
counter.$on('changed', (e) => console.log(e.count));         // its events
await counter.$with({ timeoutMs: 60000 }).add(1);            // a longer timeout, or { signal }
```

| Rule | Detail |
|---|---|
| Where it runs | The service file runs in your package's Node mod, after `main`, so the two share their state (import one from the other). A package with a service and no `main` is fine |
| What crosses | Plain JSON-like values: numbers, strings, booleans, arrays, plain objects, entity ids. Not game references: each package's references are its own |
| Errors | What your function throws reaches the caller as an error with your message. A call fails at once when the package is not installed, offers no service, is switched off or crashed, or has no such function, with that reason |
| Waiting | `connect` and calls wait up to 10 seconds for a package that is starting or hot-reloading. A call times out after 30 seconds; `$with({ timeoutMs })` changes it |
| Who calls | Inside your function, `service.caller()` is `{ id, name }` of the calling package. Refuse callers you do not want by throwing |
| Stopping | `$with({ signal })` gives a call an `AbortSignal`. Inside your function, `service.signal()` aborts when the caller gives up or the call times out: pass it on to long work |
| Events | `service.emit(name, data)` reaches every package that connected to yours, its Node mod and its pages; `$on(name, handler)` hears them |
| Names | Methods starting with `$` belong to the handle. Call a function with such a name, or one known only at run time, with `$call(name, ...args)` |
| Pages | An overlay page can connect and call too. Only a Node mod offers a service |
| Requirements | Add the other package to `requires` with a version range, such as `"requires": { "counter-service": ">=0.1" }`: the Mod Manager shows it as missing before your package runs |
| Cost | The Task Manager shows each package's service calls a second, in and out |

The [Counter service](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/counter-service) and [Counter panel](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/counter-panel) samples show both sides, with a timeout, Stop and errors.

### Roles: a service found by what it does

Sometimes a mod wants a kind of service, not one package: a voice that speaks its lines, whichever voice package the player has. The provider names a **role** in its manifest, and callers ask for the role with `use` (REDnode 0.44.0 and later):

```json
{ "id": "edgewave-voice", "name": "EDGEwave voice", "version": "0.1.0", "service": "service.mjs", "provides": ["voice"] }
```

```js
import { use } from 'rednode';

const voice = await use('voice');           // the same handle as service.connect
await voice.speak('Choom, you look like hell.', 'judy');
console.log(`${voice.$info.name} answers "${voice.$info.role}"`);
```

| Rule | Detail |
|---|---|
| Role names | Lowercase letters, digits and `-`, such as `voice` or `quest-log`. A package may provide several. The provider answers with its service file, so `"provides"` needs `"service"`. `agent` is REDagent's and is reached with `agent.ask` |
| Which package answers | The only one installed. When more than one provides a role, the one the player chose in the Mod Manager's **Provides** section, else the only one switched on. With several and no choice, `use` fails with their names, so the player decides which service, and whose bill, a mod uses |
| Changing it | A handle keeps the provider it found. After the player chooses another, call `use` again to reach it |
| What it offers | Whatever the provider's service exports; agree the functions in the provider's docs. `use<Voice>('voice')` types the handle in TypeScript |
| Errors | "No installed package provides ..." when none does; otherwise as `service.connect` (switched off, crashed, not answering) |

The [Roles test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/roles-test) sample finds Counter service by its role, `counter`.

### Describing a service

The JSDoc above each exported function is its description (REDnode 0.35.0 and later). The host reads it when the service loads and uses it three ways: it checks every call's arguments before your function sees them, the Mod Manager lists your functions in the package's details, and `service.describe(id)` hands it to other packages. From 0.36.0, functions marked `@tool` also become tools an AI assistant can call.

```js
/**
 * Loads a saved scene into the world, near V unless it has its own place.
 * @tool
 * @param {string} name The scene's name, as `scenes` lists it.
 * @param {{ x: number, y: number, z: number }} [at] Where to put it.
 * @param {'idle' | 'walk'} [mode='idle'] What its people do.
 * @returns {{ placed: number, missing: string[] }} What was placed, and any asset not found.
 * @timeout 60000
 */
export async function load(name, at, mode = 'idle') { /* ... */ }

/** @event scene-changed {{ name: string, objects: number }} A scene was saved. */
```

| Tag | Means |
|---|---|
| The text before the first tag | What the function does, in a sentence or two. An assistant reads it to decide when to call it |
| `@param {type} name text` | One parameter, in order. `[name]` or `[name=default]` makes it optional. In TypeScript the type may come from the parameter list instead |
| `@returns {type} text` | What it answers |
| `@tool` | An AI assistant may call it (0.36.0). Without it, only other packages can |
| `@readonly` | It changes nothing: an assistant calls it without asking the player. Every other tool asks first |
| `@timeout ms` | How long a call may take before it fails, instead of 30 seconds |
| `@deprecated text` | Still works; the Mod Manager marks it |
| `@event name {type} text` | An event your service sends with `service.emit`, in any JSDoc block |

| Types the host understands | Becomes |
|---|---|
| `string`, `number`, `integer`, `boolean`, `null`, `object`, `any` | That JSON type |
| `'a' \| 'b'`, `1 \| 2`, `true` | A choice of those values |
| `A \| B` | Either |
| `T[]`, `Array<T>` | An array of T |
| `{ x: number, label?: string }` (in JSDoc, inside the tag's braces: `{{ x: number }}`) | An object with those members, the ones without `?` required |

Anything else is accepted as any value, and the Mod log says which type it could not read when the service starts. A function with no JSDoc can still be called, but its calls are not checked.

**Tools for AI assistants (REDnode 0.36.0 and later):** each function marked `@tool` is offered to every assistant connected to REDnode's MCP server (Claude Code on the desktop, REDagent in the game) as the tool `<package>__<function>`, with your description and parameters. Write the description for someone who has never seen your mod: what it does, and when to use it. Mark functions that change nothing `@readonly`: they run without asking; every other tool asks the player before each call, and you cannot turn that off. `service.caller()` is `{ assistant: "<its name>" }` when an assistant calls. The player can switch any tool off in the **Tools Manager**.

**Bundled or TypeScript packages:** a bundler removes comments, so describe the service from its source when you build, with the `rednode` command in the `rednode` package:

```
npx rednode describe src/service.ts
```

It writes `service.json` beside your `rednode-app.json`; ship it with the package. The host uses `service.json` when it is there, and the service file's own JSDoc otherwise. From the REDnode repo, the same command is `node packages/rednode/bin/rednode.mjs describe <file>`.

## The Task Manager

The **Task Manager**, in the optional [Admin Tools](admin-tools.md) pack, lists every running package and what it costs, refreshed every second or five: CPU and memory (a Node mod's process with its windows), how busy the mod's own thread is and its heap, game calls a second with their round trip, and service calls in and out. A mod in the shared process shows the whole process's CPU and memory, since Windows sees no finer; its Thread and Heap columns are its own. **End task** stops a package now, also one stuck in an endless loop, and closes its windows; it stays switched on, so it runs again with the next game or with **Restart**. It was built into REDnode 0.34.0 to 0.36.0.

To write an admin tool of your own, ask for the `admin` permission and use `admin` from the `rednode` package in a page: see [The admin permission](admin-tools.md#the-admin-permission).

## Asking the AI assistant

A package can ask the AI assistant (REDagent) a question and show the answer: a build suggestion, an explanation of an error, a summary of the game state. Add `"permissions": ["agent"]` to the manifest; the player allows it in the Mod Manager, and REDagent must be installed and on.

```js
import { agent, ui } from 'rednode';

const out = ui.text('');
let text = '';
const { cost } = await agent.ask('Suggest a build for a netrunner at level 12.', {
  context: { level: 12, attributes: { intelligence: 9 } }, // sent as JSON with the question
  onText: (t) => out.set({ text: (text += t) }),            // the answer as it streams
});
```

| Rule | Why |
|---|---|
| Every answer costs the player | Ask when the player wants it, never on a timer. REDagent gives each package a daily limit ($0.25 unless the player changes it) and the player can pause it; past the limit, `ask` rejects and says so |
| The assistant only reads | It may look at logs, the game state, the game API and the apps folders, but never changes files or the game. Pictures of windows and the screen only if the player switches them on for your package |
| Send what it needs | Put your mod's state in `context`, so the assistant does not spend tool calls finding it |
| `signal` stops a question | Pass an `AbortSignal` to let the player cancel |

The [Ask mod](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/ask-mod) sample asks whatever the player types and streams the answer into its window. The answering side is `agent.serve`, for a package that says `"provides": ["agent"]` in its manifest; REDagent is one.

## The game API

`api` calls any game function by name: global functions, the static functions of a class, and the methods of game objects. It is typed from the game's own type data, the same data as the [game API reference](game/), so an editor completes every class, method and enum member. It works the same in Node mods and in apps.

This is the [Vitals](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/vitals) app, which shows V's health, level and money. The [Game API mod](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/api-mod) reads the same from Node:

```js
import { api, game } from 'rednode';

const player = await api.GetPlayer(game.instance);                  // GetPlayer(GameInstance)
const statsId = await api.$call('Cast;EntityID;StatsObjectID', await player.GetEntityID());
const pools = await api.GameInstance.GetStatPoolsSystem(game.instance);
const stats = await api.GameInstance.GetStatsSystem(game.instance);
const shop = await api.GameInstance.GetTransactionSystem(game.instance);

const health = await pools.GetStatPoolValue(statsId, 'Health', false);
const level = await stats.GetStatValue(statsId, 'Level');
const eddies = await shop.GetItemQuantity(player, await api.MarketSystem.Money());

await shop.GiveItem(player, await api.MarketSystem.Money(), 100);   // a change: 100 eddies
```

| Call | Means |
|---|---|
| `api.GetPlayer(...)` | A global function, by name |
| `api.GameInstance.GetStatsSystem(...)` | A static function, under its class's script name |
| `player.GetEntityID()` | A method of a game object |
| `api.$call('Cast;EntityID;StatsObjectID', ...)` | A global function by its full name: operators, and overloads that share a name |
| `api.$static('UIItemsHelper', 'GetItemName;TweakDBIDgameItemData', ...)` | A static function by its full name, with or without the class in front |
| `api.$null` | No object, on purpose, for an object parameter the game does not mark optional (see Game objects below) |
| `obj.$get('propertyName')` | A property of a game object |
| `obj.$set('propertyName', value)` | Writes a property, with the same type checks as arguments |
| `api.$new('entMeshComponent', { ... })` | Builds a game object by class name, with properties set first. Nothing in the game holds it yet, so its reference keeps it alive until released (or a save loads). A struct comes back as its value |
| `game.instance` | The `GameInstance` argument that many functions take first |

| Game type | In JavaScript |
|---|---|
| Bool, Int8 to Int32, Uint8 to Uint32, Float, Double | `boolean`, `number` |
| Int64, Uint64 | `string`: JavaScript numbers lose precision above 2^53 |
| CName, String | `string` |
| TweakDBID | `"0x..."`. As an argument, a record path such as `"Items.money"` works too |
| Variant | `{ "$type": "Float", "value": 1.5 }`: a value with its type's name, such as `Int32`, `CName` or `array:CName` |
| Enums | The member's name, such as `"Health"` |
| Structs, such as Vector4 or ItemID | Plain objects. As arguments, missing properties keep their default, and `null` is the default value |
| Game objects | References: call their methods with `await`. `null` when there is none. As an argument, `null` works only where the game marks the parameter optional: many functions use an object without checking it, and an empty one can crash the game, so REDnode refuses it. Pass real data, as the game's scripts do, or `api.$null` to pass none on purpose (from REDnode 0.41.1) |
| Arrays | Arrays |
| Resource references (`rRef`, `raRef`, `ResRef`) | A depot path such as `"base\\environment\\ld_kit\\marker.mesh"`, or its hash as a string. Read back as the hash: turning a hash into a path needs an asset index, such as REDbridge's |

| Good to know | |
|---|---|
| Every call is a round trip | It runs on the game thread between frames and answers a frame or two later. Keep the number of calls per second modest |
| References | A game object comes back as a reference that points at it weakly. When the game deletes the object, or a save loads, calls on it fail with "that game object no longer exists". Get a fresh one after each `PlayerPuppet.OnGameAttached` |
| Wrong arguments | The arguments are checked against the function's types before the call. A wrong one fails with the argument's name and type, and the game is not touched |
| Out parameters | A function with out parameters returns `{ result, out }` |
| `script_ref` parameters | Pass the value itself: `api.GetLocalizedText("LocKey#10963")`. The plugin keeps it beside the call and points the game at it; `api.$out` in its place reads back what the game left there (REDnode 0.47.0) |
| Before V is in the world | Global and static functions that take a `GameInstance` are refused while `game.state().world` is false (see [When the world exists](#when-the-world-exists)) |
| Risk | The checks catch wrong types, not wrong values. Calling a function the game does not expect to be called at that moment can still crash it, as with any script mod |

## TweakDB

TweakDB is the game's database of tuning data: items, weapons, vehicles, characters, perks. A **record** is one thing (`Items.Preset_Lexington_Default`, a `gamedataWeaponItem_Record`); a **flat** is one value in it (`Items.Preset_Lexington_Default.quality`). `tweakdb` reads them from the running game and needs nothing else installed. Changing them needs TweakXL: see [Changing TweakDB](#changing-tweakdb) below.

```js
import { tweakdb } from 'rednode';

await tweakdb.get('Items.Preset_Lexington_Default.friendlyName');   // 'w_handgun_militech_lexington'
await tweakdb.flat('Items.Preset_Lexington_Default.quality');       // { type: 'TweakDBID', value: '0x...' }
tweakdb.learn(['Quality.Common', 'Quality.Rare']);
await tweakdb.get('Items.Preset_Lexington_Default.quality');        // 'Quality.Common', now that the name is known
const gun = await tweakdb.record('Items.Preset_Lexington_Default', 'WeaponItem');
await gun?.FriendlyName();                                          // a typed method of the record
await tweakdb.records('Vehicle');                                   // every vehicle record's id
```

| Call | Gives |
|---|---|
| `tweakdb.get(path)` | A flat's value, or `null` |
| `tweakdb.flat(path)` | The value with its type, such as `Float`, `TweakDBID` or `array:CName` |
| `tweakdb.record(path, type?)` | The record as a game object, or `null`. The type (`WeaponItem`, `gamedataVehicle_Record`) only types its methods |
| `tweakdb.records(type)` | The ids of every record of a type |
| `tweakdb.type(path)` | A record's type, or `null` |
| `tweakdb.id(path)` | The game's id of a path, `"0x..."`, computed without the game |
| `tweakdb.name(id)`, `tweakdb.learn(paths)` | The path of an id when known; tell REDnode more names |

**Names.** TweakDB ids are hashes and the game keeps no names. A path your package passed in is remembered, so it comes back as that path; any other id comes back as `"0x..."`. Both forms work as input everywhere. The record types and their methods are in the [game API reference](game/).

### Changing TweakDB

Changes go through [TweakXL](https://github.com/psiberx/cp2077-tweak-xl), the community's standard for TweakDB edits, so they work beside every other TweakXL mod. List it in your manifest, so a player without it sees what is missing:

```json
"requires": { "tweakxl": ">=1.10" }
```

```js
import { tweakdb } from 'rednode';

await tweakdb.set('Items.Preset_Lexington_Default.friendlyName', "REDnode's Lexington");
await tweakdb.clone('Items.MyMod_Lexington', 'Items.Preset_Lexington_Default');
await Promise.all([
  tweakdb.set('Items.MyMod_Lexington.quality', 'Quality.Legendary'),
  tweakdb.set('Items.MyMod_Lexington.tags', ['Weapon', 'MyMod'], { type: 'array:CName' }),
]);
```

| Call | Does |
|---|---|
| `tweakdb.set(path, value, { type? })` | Changes a flat and applies it to its record. The flat keeps its own type; a new flat needs `type` |
| `tweakdb.clone(path, base)` | A new record copied from another one |
| `tweakdb.create(path, type)` | A new, empty record of a type |
| `tweakdb.update(path)` | Applies changed flats to a record; `set` does it already |

**Undone when your package stops.** REDnode remembers each flat's value from before your package first changed it, and puts it back when the package stops: switched off, restarted, hot reloaded or crashed. So a mod sets its values every time it starts, and switching it off really takes its changes away. Records it cloned or created, and flats it added, stay until the game closes, since TweakDB cannot remove them.

Changes made at once, with `Promise.all`, run in the same game frame. Objects already in the game, such as an item in V's inventory, may keep values they copied when they were made: **unverified** which ones.

## Placing things in the world

`world` in the `rednode` package spawns entities with components attached, moves them, removes them, and passes on their lifecycle events. It uses [Codeware](https://github.com/psiberx/cp2077-codeware) 1.14 or later in the game; without it, these calls reject and say so. See [World API](world.md) for how it works.

```js
import { world } from 'rednode';

// A prop: a mesh on its own.
const { id } = await world.spawn({
  mesh: 'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh',
  position: { x: -1234, y: 987, z: 12 },
  yaw: 90,
});
// A person: stands where placed and stays friendly to V.
await world.spawn({ record: 'Character.CitizenRichFemale', position: { x: -1233, y: 987, z: 12 } });

await world.move(id, { x: -1234, y: 988, z: 12 });
await world.remove(id);

// An EDGEbuilder scene, from a file in your package's folder.
const scene = await world.load('scenes/my_alley.scene.json');
await world.unload(scene.name);
```

| Call | What it does |
|---|---|
| `world.spawn(options)` | Spawns an entity from a template (`template`), a TweakDB record (`record`) or a mesh alone (`mesh`, with `meshAppearance` and `scale`), and resolves once it is in the world, with its ID and the entity. A `Character.*` record stands where placed and stays friendly to V (`npc: false` leaves the game's behaviour). `keep: true` keeps it in the save. `components` are attached while it assembles |
| `world.load(scene)`, `world.unload(name)` | Loads an [EDGEbuilder scene](https://edgemodders.github.io/EDGEbuilder/scene.html) (a `.scene.json` path or the scene itself): its meshes, entities and NPCs; lights are not spawned yet. Unload removes them |
| `world.near({ radius, files, uses })` | The entities near V, nearest first, with their class, distance and appearance; `files` adds the files each one uses, `uses` keeps only those that use one of the given files |
| `world.files(entity)` | The files an entity uses: its template and every resource its components name, as path hashes |
| `world.spawned()` | This package's spawns, with what each was spawned with |
| `world.onRespawn(handler)` | Called with the old and new ID when REDnode spawned one of yours again after an archive swap, so it shows the new version |
| `world.move(id, position, orientation?, yaw?)` | Places it |
| `world.remove(id)` | Removes it |
| `world.watch(id)` | Lifecycle events for an entity spawned some other way |
| `world.on(name, handler)` | `Entity/Initialize`, `Entity/AfterAttach` (or Codeware's old name `Entity/Attached`) and `Entity/Detach`, with the entity's `entityId` and `entityType` |
| `world.entity(id)` | The entity, or `null` once it is gone |
| `world.available()` | True when Codeware is installed and a game is loaded |

What a package spawns is removed when it stops (switched off, restarted, hot reloaded or crashed). After an archive swap (`archives.reload`), your spawns that use a swapped file are spawned again with a new ID, and the game's own entities within 30 m of V that use one switch appearance and back, so they show the new version.

The [World test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/world-test) sample spawns a box in front of V, spins it and removes it. The [World objects test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/world-objects-test) tries every other call.

## The Console

REDnode's **Console** (built in, switched on from the launcher) is a command line for the game, like a browser's developer console: type JavaScript at the bottom, press Enter, and the answer shows above. The whole `rednode` package is ready without imports, so it is the quickest way to try a call before putting it in an app:

```js
addItem("Items.Pants_01_basic_01")              // a shortcut for game.player.addItem
const stats = await api.GameInstance.GetStatsSystem(game.instance)
await tweakdb.get("Items.money.price")
await api.GetPlayer(game.instance)           // PlayerPuppet #12, kept as $3 and $_
await $_.GetDisplayName()                    // call it from the next entry
```

Top-level `await` works, a returned promise is waited for, and variables stay between entries. Shift+Enter adds a line, Up and Down go through history, Tab completes, `help()` lists the shortcuts (`addItem`, `removeItem`, `pos`, `tp`, `clear`). The code runs in the Console's own Node mod, so Node's modules (`fs`, `path`) work too, and **Stop** ends a loop that never returns by starting the Console again. REDnode 0.42.0.

## Debugging

Turn on **Developer mode** in the launcher's settings (the gear at the right of the Theme row). Every window built with the UI kit's `rn-window` then shows a debug button next to its close button. It opens Chromium's DevTools for that window's page, drawn in the game as an overlay window: elements, styles, the console, sources and breakpoints. The Mod Manager's details also open it, in the game or on the desktop (**Window debugger**). Add `no-debug` to an `rn-window` that should never show the button.

A Node mod has a **Debug (Node inspector)** switch in the Mod Manager. On, the mod restarts alone in its own process with Node's inspector, and the Mod Manager shows the inspector's address:

| Way to debug | How |
|---|---|
| In the game | **Node debugger: In the game** opens Chromium's DevTools for Node as an overlay window. Its console runs in the mod's own thread. In **Sources**, Ctrl+P finds the mod's files; set breakpoints there |
| On the desktop | **On the desktop** opens the same DevTools in a desktop window. Switch to it with Alt+Tab |
| VS Code or REDcode | **Copy** the address, then attach with a `node` launch configuration of type `attach` and `"websocketAddress"` set to it |

The inspector does not wait for a debugger, so the mod's first lines have already run when you attach: set breakpoints in code that runs later, such as an event handler or a button's callback. A restart gives the mod a new inspector address: the in-game debugger follows it by itself; reattach a desktop debugger or VS Code. While the mod is stopped at a breakpoint it does not answer: after 10 seconds the Mod Manager shows it as not responding, which is expected. The switch is not saved: the mod runs normally after REDnode restarts.

An AI agent can read a window's console through the kernel MCP server's `window_console` tool.

## More

| Where | What |
|---|---|
| [UI kit reference](https://github.com/Edgemodders/REDnode/tree/main/packages/ui) | Every component, attribute and event, themes, keyboard keys |
| [API reference](api/) | The `rednode` package: `game`, `ui` and every type, with examples |
| [Overlay host](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay) | Running the host, the app list, the demo apps and mods |
| [Overlay design](overlay.md) | How the overlay works, test results, and the plan |
