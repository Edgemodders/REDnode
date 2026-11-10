# Changelog

What changed in each REDnode release, for players and modders. Each release takes its notes from its section here: the GitHub release (written by the release workflow) and the version's changelog on the Nexus Mods page (pasted by hand). Test builds between releases (like 0.26.0) are folded into the next release.

How to keep it:

- With each change a player or modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line. Leave out what only the tests see, such as the test apps that are not in the player zip.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The release workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub and Nexus.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints plain lines for Nexus's changelog field, one per change.

## Unreleased

**New**

- World pins (https://github.com/Edgemodders/REDnode/issues/43): a pin can follow an entity (`world.pin({ at: id, ... })`), and takes a `style`: its colour, font, title and text sizes, post height, and `scale`. `"fit"` (the default) shrinks with distance down to a smallest size and is dimmed behind walls; `"world"` has a real size and hides behind walls; `"screen"` keeps one size and shows through walls. REDnode tells walls apart with the game's own ray casts. `world.pinStyle` restyles one pin or sets the style for all of a package's pins.
- `label` on `world.spawn` pins what it spawns: the pin follows the entity and goes when it is removed. `world.load(scene, { label: true })` labels every object of a scene with its id.
- MCP tools `world_pin`, `world_unpin` and `world_pins`: assistants can drop pins at a place or on an entity. They only draw, so they do not ask first.

**Changed**

- Each pin colour now has its own post and edge arrow (they were always the HUD's cyan).

## 0.59.1 (2026-11-10)

For game version 2.5.

**New**

- World pins, experimental (https://github.com/Edgemodders/REDnode/issues/43): `world.pin({ at, title, text?, color?, height? })` drops a glowing post with a label (its title, a line of text and the distance) that can be seen from any distance and through walls; out of view, the label waits at the screen's edge with an arrow to turn toward. `world.unpin`, `world.pins` and `world.clearPins` go with it. REDnode's overlay draws them, placed each frame where the pin is, so they change nothing in the game. A package's pins go when it stops, and every pin goes when the game session ends.

**Fixed**

- F10 showed only the cursor, with no launcher or apps, when the game was started from VS Code (EDGEdeck's Run game, a terminal or a Claude session): the game passed VS Code's `ELECTRON_RUN_AS_NODE` setting on to REDnode's overlay host, which then quit at once without a log. The plugin now starts the host without it.
- REDnode's overlay host now ends as soon as the game starts to quit, instead of with the game's process. When a quit stalled and left the game's process open, the host stayed too and kept its files locked, so a mod manager could not deploy over REDnode (its error named `host\resources\app.asar`) until the stuck game was ended in Task Manager.

## 0.58.0 (2026-11-05)

For game version 2.5.

**New**

- Title-bar buttons for Node mod windows (https://github.com/Edgemodders/REDnode/issues/38): `ui.window({ titleButtons: [{ id, label, icon, onClick }] })` puts buttons of the mod's own beside close, with an icon from the UI kit (`key`, `settings`, `back`, `refresh`, `help`, `pin`...) or the label as text, and `on: true` for a lit switch. The window's own actions move into its ⋯ menu when there are more than three. Page apps get the same with the UI kit's `rn-window` `titleButtons` property.
- `win.set({ title, titleButtons, children })` changes an open Node mod window in place, with the same place and size and no flicker, so one window can hold several views (https://github.com/Edgemodders/REDnode/issues/38). Nodes taken out keep their state.
- `world.spawn` and `world.load` take `alwaysSpawned: true`, and the MCP tool `world_spawn` takes it too: it asks the game to keep an object spawned wherever V is, for objects far from V such as around an editor camera (https://github.com/Edgemodders/REDnode/issues/41).
- A sample, **Views mod**: one window with two views, swapped with `win.set`, and three title-bar buttons.

**Changed**

- EDGEmat's tools for in-game assistants use REDnode's own REDbridge instead of starting a second one beside it (https://github.com/Edgemodders/REDnode/issues/40), so one REDbridge runs while you play. It needs an EDGEmat newer than 0.3.1. This release still carries 0.3.1, so nothing changes yet: a later REDnode release with the newer EDGEmat turns it on. `"edgematBridge": "own"` in the host's settings gives EDGEmat its own again.

**Fixed**

- When another program holds REDnode's MCP port (41820) as the game starts, REDnode now tries again every 10 seconds instead of giving up for the session, and the launcher's Settings say which program holds it. Before, an assistant signing in reached that other program, and no Connect window showed in the game.

**Other**

- Port 41820 is kept for the game's REDnode: a host run from the repo or started by a test uses 41821 (`--mcp-port=<n>` for another).

## 0.56.1 (2026-11-03)

For game version 2.5. With it, the first release of the [UI Tools](https://www.nexusmods.com/cyberpunk2077/mods/36958) pack: the UI Workbench inspects the game's own UI and builds native UI of your own.

**New**

- Ink markup: a native HUD panel can be written as an `.ink.html` file, with REDnode's ink tags as HTML (`<column gap="10">`, `<text style="label">{title}</text>`, `<list items="contracts" key="id">`), and put on the game's UI with `ink.load("board.ink.html", handlers, data)` or `ink.parse(source)`. `{name}` reads named data and a list item's fields; `view.set(data)` sends only what reads the changed data. A mistake is refused with its file, line and column. The first step of UI Tools. See https://edgemodders.github.io/REDnode/ink.html#ut1-build-rednode-0510
- A sample, **Ink markup**: a HUD panel with a health bar and a list of contracts from `board.ink.html`. Also in the player zip.
- Esc for a page that asks for it (https://github.com/Edgemodders/REDnode/issues/34): with the web's Keyboard Lock API, `navigator.keyboard.lock(["Escape"])`, Esc comes to the focused page as a key instead of leaving interactive mode, so an editor can cancel a drag or a move with it; `navigator.keyboard.unlock()` gives it back. F10 always leaves. See https://edgemodders.github.io/REDnode/overlay-apps.html#keys-and-modifiers
- A test sample, **Input test**: modifiers on clicks, a page's own edit keys beside a text field's, and Take Esc.
- Reading the game's own UI (needs Codeware): `ink.layers()` lists the game's ink layers and HUD pieces, `ink.read()` reads a tree of widgets in one call (class, name, visibility, box on screen, controller, text), `ink.inspect(id)` gives one widget in full (path, its parents, controllers, the `.inkwidget` file it came from, every property, and an `api` reference), `ink.at(x, y)` finds the visible widgets under a point, and `ink.boxes()` gives every visible widget's box in one call, for a page that highlights what is under the cursor as it moves. Reads only. They are what REDnode UI Tools' UI Workbench is built on. See https://edgemodders.github.io/REDnode/ink.html#ut2-build-rednode-0530

- For admin pages: `admin.setOpen(id, open)` switches a package on or off, as the launcher's switch does, and `admin.projectsFolder(name)` makes a folder under `Documents\REDnode` and watches it as a development folder. `ink.check(source)` checks ink markup without putting it on the game's UI, and answers the first mistake with its line and column. A package's own page may now connect to its own service. What the UI Tools pack's editor is built on.
- `world.spawn({ ..., wait: false })` resolves as soon as the entity is created, without waiting for it to be in the world (far from V, or still streaming in), and keeps it as the package's spawn: move, remove, the respawn after a swap and the clean-up at stop all work. `world.spawned()` says whether each one is in the world (`attached`), and `world.load(scene, { wait: false })` loads a far scene in full (https://github.com/Edgemodders/REDnode/issues/35).

- `ui.image(src, { width, alt, onClick })` in the UI builder: a picture in a Node mod's window, from a file in the package's folder or its data folder (`pkg.dataDir`), a `data:` URL or the picture's bytes. `set({ src })` shows another one, or the same file again after the mod wrote over it; a picture that cannot be shown says why. For a mod that makes or fetches pictures, such as a before and after (https://github.com/Edgemodders/REDnode/issues/37). See https://edgemodders.github.io/REDnode/overlay-apps.html
- A sample, **Image mod**: pictures from the package, from bytes and drawn into the data folder, a larger view on click, and two that cannot be shown.

- On a page that covers the game view (`"fill": "screen"`), an `rn-window` with `resizable` resizes inside the page by its corner grip, with `min-width` and `min-height`, its size kept for the page and **Reset position and size** in its title bar. See https://edgemodders.github.io/REDnode/overlay-apps.html
- `ui.slider(label, onChange, { live: true })` in the UI builder: `onChange` also gets the value while the player drags, about 20 times a second, not only when they let go. For a slider that drives something the player watches move.
- `ink.read(from, { props: true })` gives each widget's layout and look as well (anchor, margins, size, tint, opacity, a text's font size, weight, case and alignment, an image's atlas and part), with texts whole: what ink markup needs to copy a piece of the game's UI.
- `ink.try(id, prop, value)` changes one property of one of the game's own widgets, live (`visible`, `opacity`, `tint`, `size`, `margin`, `padding`, `translation`, a text's `text` and `fontSize`), and keeps the value it had; `ink.reset()` puts it back, and REDnode puts everything back when the package stops. For packages the player allowed `admin`, such as the UI Workbench.
- The UI kit's `rn-input` takes `clearable`: a ✕ inside the field while it holds text empties it, sending `input` and `change` as typing it away would.

**Changed**

- Keys knows **Tripo** (`tripo`, the 3D service EDGEmat's Wardrobe Designer uses), so a player can set its key before any tool asks for it (https://github.com/Edgemodders/REDnode/issues/23).
- The **Mod Manager**'s details are 300 wide (were 262), and the edge between them and the table drags to make them wider or narrower; the width is kept, and a double-click puts back 300.
- The **Mod Manager**'s search puts the strongest matches first: names that start with what you typed, then names with a word that starts with it, then names that hold it, then matches by id, author or description. The column's sort orders each group. Its search box has a ✕ that clears it.
- Ctrl+Z, Ctrl+Y, Ctrl+A, Ctrl+C, Ctrl+V and Ctrl+X reach the page as keys (https://github.com/Edgemodders/REDnode/issues/33): a text field edits as before, and a page with its own undo or copy hears them and takes them with `preventDefault()`. Before, the overlay ran the editing command itself and the page never heard the key.

**Fixed**

- The **Mod Manager**'s details cut 26 pixels off on the right: their padding and border were added to a width the drawer around them did not have.
- A double-click reaches pages in the game: every press went to the page as a single click, so a page never heard `dblclick` (a text field's double-click on a word, a page's own double-click actions). Presses of the same button within 450 ms and 6 px now count up, as the title bar's double-click does.
- A name passed to the game as a CName (through `api`, or the ink driver's own) now reads back as text: it was only hashed, so the game knew it by number alone, and the ink driver's mounts had no readable name.
- A `world.spawn` that times out before the entity is in the world now removes the entity before it throws, so a failed spawn leaves nothing behind. Before, the entity stayed in the game with no id given back, and showed up when V got near (https://github.com/Edgemodders/REDnode/issues/35).
- Clicks, moves and the wheel in overlay windows now carry Ctrl, Shift and Alt (`ctrlKey`, `shiftKey`, `altKey`), read from Windows at each event, so Ctrl+click, Shift+drag and Alt+click work (https://github.com/Edgemodders/REDnode/issues/33).

## 0.50.2 (2026-11-01)

**New**

- A page that covers the whole game view at any aspect ratio (https://github.com/Edgemodders/REDnode/issues/32): `"fill": "screen"` in `rednode-app.json` makes the page 1080 high and as wide as the view (1920 at 16:9, 2580 at 21:9, 3840 at 32:9), at the top-left, and resizes it when the game's resolution changes. For an editor's see-through canvas over the world, such as EDGEbuilder's. See https://edgemodders.github.io/REDnode/overlay-apps.html#a-page-that-covers-the-whole-game-view
- Frames from another address get the mouse and keys (https://github.com/Edgemodders/REDnode/issues/31): a page that shows a page from `http://127.0.0.1:<port>`, another site or a sandboxed frame in an `<iframe>` can now be used in the game. Clicks, the wheel, hover, drags and typing reach the frame, through CSS transforms and frames inside frames, as real input. See https://edgemodders.github.io/REDnode/overlay-apps.html#frames-from-another-address
- Two test samples: **Fill test** and **Frame test**.
- On a page that covers the game view, a draggable window (`<rn-window draggable>`) moves inside the page, its place kept across starts, with **Reset position** in its title bar. The page and whatever else it draws stay put.

**Fixed**

- Dragging the **Layers test**'s window moved its full-screen tint with it. It now covers the game view with `"fill": "screen"`, so the tint stays and only the window moves.

## 0.49.5 (2026-10-31)

**New**

- The **Console**, built into REDnode: a command line for the game, like a browser's developer console, opened from the launcher. Type JavaScript with the whole `rednode` package ready (`game`, `api`, `tweakdb`, `world` and the rest, no imports), and Enter runs it: top-level `await`, variables kept between entries, results you can fold open, game objects you can call from the next entry (`$1`, `$_`), errors in red, history with Up and Down, Tab completion. Shortcuts for routine jobs: `addItem("Items.Pants_01_basic_01")`, `removeItem`, `pos()`, `tp(x, y, z)`; `help()` lists them. The code runs in the Console's own Node mod, so an endless loop stops only the Console: **Stop** starts it again. No Cyber Engine Tweaks needed.
- The editor channel (https://github.com/Edgemodders/REDnode/issues/17): tools on the player's PC, such as EDGEwave in VS Code, can play a game sound event in the running game, and stop it, with the game's own mix. While REDnode runs it writes `%LOCALAPPDATA%\REDnode\editor.json` with a local port and a token made new each run; the calls are `POST /editor/sound.play`, `/editor/sound.stop` and `GET /editor/info`. Local only, refused to web pages; `"editorChannel": "off"` in REDnode's settings turns it off. See the Overlay apps guide, "Editor tools".
- `game.player.addItem(id, count?)` and `game.player.removeItem(id, count?)` put items in V's inventory, or take them out, by their TweakDB id, as Cyber Engine Tweaks' `Game.AddToInventory` does. `addItem` refuses an id with no record, so a typo is not given as an empty item.
- `api.$null` passes no object on purpose, for an object parameter the game does not mark optional (MCP: `{"$null": true}`).
- Roles (https://github.com/Edgemodders/REDnode/issues/20): a package can provide a role, such as `"provides": ["voice"]`, answered by its service file, and any mod reaches it with `use("voice")` without knowing which package that is. When two installed packages provide a role, the player picks the one that answers in the Mod Manager's new **Provides** section.
- `audio.play` plays a file from the package's data folder (`pkg.dataDir`) by its full path, for sounds a package makes while it runs, such as spoken lines.
- `ui.input({ password: true })`: a text field that shows dots, for a key or a password.
- The **Roles test** sample checks all three.
- **Keys** in the launcher's Settings, a panel that slides out beside them (https://github.com/Edgemodders/REDnode/issues/23): the player's AI service keys (Anthropic, Google Gemini, OpenAI, ElevenLabs, or any other by its id), set once in the game and read by every EDGE tool on the PC. Each line shows only the key's last 4 characters and which tools have used it, with **Set**, **Replace** and **Remove**; an Anthropic or OpenAI key that does not start the right way is refused. Keys are kept encrypted for the Windows user in `%APPDATA%\Edgemodders\keys`. See https://edgemodders.github.io/REDnode/keys.html
- EDGEmat's material tools for in-game assistants: REDnode now ships EDGEmat's MCP server (`@edgemodders/edgemat-mcp` 0.3.1) and runs it when an in-game assistant such as REDagent first needs it, with REDnode's own Node, the game folder and REDbridge. Its tools are listed as `edgemat__mat_*`: searches and descriptions run without asking, edits and new materials ask the player first, and the Tools Manager switches them. Desktop assistants such as Claude Code get EDGEmat through EDGEchat instead (`"edgematTools": "all"` in REDnode's settings lists them there too). See https://edgemodders.github.io/REDnode/mcp.html#edgemats-tools-e1
- `game.state().world` (https://github.com/Edgemodders/REDnode/issues/25): true only while V is in the world, false while the game starts, at the main menu and from the start of every load, the pause menu's too, sent through `game.onState` as it changes. Mods read the world's systems (time, weather, districts) only while it is true.
- `loc.text(key)` (https://github.com/Edgemodders/REDnode/issues/26): the game's own text for a LocKey, such as a district's or an item's name, in the player's language: `await loc.text("LocKey#10963")` gives "Little China" in English. An array of keys is read in one round trip, and an unknown key gives `null`. `loc.language()` gives the language.
- Packages can use the player's shared keys (https://github.com/Edgemodders/REDnode/issues/23): list `"keys:anthropic"` (or any other service) in `permissions`, read it with `secrets.shared("anthropic")`, and ask for it with `secrets.askShared("anthropic", { reason, offer })`, which opens REDnode's own **Key request** window: the player allows the package and, when no key is saved, pastes one, or moves the key the package kept itself. The package never sees the window's box, and never writes the store. The Mod Manager shows and withdraws the permission. See https://edgemodders.github.io/REDnode/keys.html
- The **Keys test** sample checks shared keys with a made-up service.
- `api` calls take `script_ref` parameters: pass the value itself, as in `api.GetLocalizedText("LocKey#10947")`.
- Resizable windows: `"resizable": true` in a package's `rednode-app.json` (with `minWidth` and `minHeight`) gives its `rn-window` a grip in the bottom-right corner. REDnode keeps the size with the window's position, and **Reset position and size** in the title bar goes back to the manifest's. See https://edgemodders.github.io/REDnode/overlay-apps.html#resizable-windows
- The Mod Manager is resizable, its table shows as many rows a page as fit, and its columns are resized by dragging the edges in the header. The details beside the table slide shut to the right, and open again, with the tab between them. Column widths and the shut details are kept for the next visit.
- The Mod log has a close button.

**Changed**

- An archive swap with the inventory open refreshes the inventory's preview of V on its own (https://github.com/Edgemodders/REDnode/issues/28). With V's clothes in the base slots, the game hides V's own items while the inventory shows, so the preview was skipped and kept the old look until the item was taken off and put on again.
- `world.move` keeps the new place of the package's own spawns, and a respawn after an archive swap reads where the entity is now, so an entity moved since its spawn (by `world.move`, physics or a script) comes back there, not where it was first spawned (https://github.com/Edgemodders/REDnode/issues/27). Assistants' spawns through MCP do the same.

- The launcher's window is wider (1040 pixels, was 690) to make room for Keys beside Settings; its empty parts stay see-through and click through to the game. A launcher you moved goes back to its corner once.
- While V is not in the world, `api` refuses the game's global and static functions that take a `GameInstance` (the gates to the world's systems, such as `GameInstance.GetWeatherSystem`) with "V is not in the world yet", where some crashed the game (https://github.com/Edgemodders/REDnode/issues/25). `GetPlayer` and `GetSettingsSystem` stay allowed: they answer safely without a world.
- Until the game first says what it shows, `game.state()` reports the main menu, so a mod linked while the game starts never takes it for a loaded save.
- Keys: while a key is encrypted and saved (about a second), its line says "Encrypting the key…" in place of the box, and "Removing the key…" while one is removed.
- Keys: **Other service id** refuses what looks like a key (long, a key's prefix such as `sk-` or `AIza`, a long run of digits) and clears the box, so a key pasted there by mistake never becomes a file name or a log line. Service ids are now 1 to 24 characters.
- Counter service 0.3.0 provides the `counter` role.
- A plain `null` for an object parameter the game does not mark optional is refused with an error naming the parameter, instead of being passed as an empty object: many game functions use such a parameter without checking it, and `GetItemName` with a null item data crashed the game (https://github.com/Edgemodders/REDnode/issues/18). The game API's types no longer allow `null` there.

**Fixed**

- An archive swap through REDswap that replaces an archive with one holding fewer files now lets the files it left out load from the game, or another mod, again (https://github.com/Edgemodders/REDnode/issues/29). Before, they kept the old archive's version until the game restarted, so a mod could not restore the game's own look by swapping its file out. Comes with REDswap 1.0.3.
- A drag inside an overlay page now holds on when the cursor leaves the element it started on: mouse moves tell the page which button is held (`buttons` is 1 while the left button is down), so `setPointerCapture` works. Before, a page's own drags, such as a resize grip, stopped after a few pixels.
- The Console showed only `Uncaught:` for an error whose first line is longer than 80 characters, such as "V is not in the world yet: ...": the whole message shows now.
- A static function's full name now works with `class` (`api.$static("UIItemsHelper", "GetItemName;TweakDBIDgameItemData", ...)`, or the MCP tools' `class` and `fn`), with or without the class in front.
- The MCP tool `api_read` accepts a full name that starts with its class, such as `gameUIItemsHelper::GetItemName;TweakDBIDgameItemData`.

**Other**

- The Nexus release tool (`tools/nexus/nexus.mjs`) takes an optional `"tag"` in `nexus.json`, the prefix of a page's own release tags, such as `"wardrobe-designer-v"`, for a page released apart from its repo's `v<version>` tags (https://github.com/Edgemodders/REDnode/issues/30).
- Shared keys, first part (https://github.com/Edgemodders/REDnode/issues/23): one store for the player's AI service keys that every EDGE tool on the PC can read, `%APPDATA%\Edgemodders\keys\<service>.txt` encrypted for the Windows user, and a small MIT library for tools to copy, `tools/keys/keys.mjs`. Packages reach it with `secrets.shared` and `secrets.askShared` (above). See https://edgemodders.github.io/REDnode/keys.html

## 0.41.0 (2026-10-27)

**New**

- REDswap, a plugin installed with REDnode (`red4ext/plugins/REDswap`), swaps archives into the running game on game 2.5, so `archives.reload` and the MCP tool `archives_reload` no longer need RED Hot Tools, which has no 2.5 build. Its swap is ported from RED Hot Tools (MIT, by psiberx). The answer says `via: "redswap"`. RED Hot Tools is still used when REDswap is not loaded. REDswap has its own version (1.0.0), changelog, docs page (https://edgemodders.github.io/REDnode/redswap.html) and Nexus page (https://www.nexusmods.com/cyberpunk2077/mods/36172), and its own zip beside REDnode's in each release.

**Fixed**

- A game function with overloads of the same name can be called by the plain name when that is one overload's full name (such as `DelaySystem.DelayEventNextFrame`); it was refused as ambiguous, though the error said to use the full name.
- After an archive swap, the inventory's preview of V now shows the new version of what V wears too, with the inventory open or closed (it kept the old look until the item was put on again). The answer of `archives.reload` lists it in `preview`. Needs Codeware.

## 0.40.1 (2026-10-26)

**New**

- `world.spawn({ mesh })` spawns a prop from a mesh alone, and a `Character.*` record now stands where it was placed and stays friendly to V. `keep: true` keeps a spawn in the save.
- `world.load()` and `world.unload()` load an [EDGEbuilder scene file](https://edgemodders.github.io/EDGEbuilder/scene.html) into the running game: its meshes, entities and NPCs (lights not yet).
- `world.near()` lists the entities near V with the files each one uses, read in the game in one call; `world.files()` reads one entity's files; `world.spawned()` lists your package's spawns.
- What a package spawns is removed when the package stops.
- After an archive swap (`archives.reload`), your spawns that use a swapped file are spawned again (`world.onRespawn` tells you their new ID), and the game's entities within 30 m of V that use one switch appearance and back, so they show the new version. The answer lists them in `world`. Untested in game until RED Hot Tools supports game 2.5.
- MCP tools `world_near` and `world_spawned` (read), and `world_spawn`, `world_remove` and `world_load` (ask first).
- Connect Claude Code (or another MCP client) without copying a token: it asks to connect, your browser shows a code, and REDnode shows the same code in the game with **Allow** and **Deny**. The connection stays across restarts; the launcher lists connected assistants with **Revoke** ([#19](https://github.com/Edgemodders/REDnode/issues/19)). **Copy setup** still works for clients without sign-in.

**Fixed**

- A Node mod's window with a `ui.list()` log and more controls than fit no longer squeezes the log to nothing: the log keeps at least 160 px and the window scrolls to reach it.

## 0.38.1 (2026-10-25)

**The first release for game version 2.5.** It needs RED4ext 1.31 or later. For game 2.31, use REDnode 0.37.0.

**Changed**

- REDnode moves to game version 2.5: it needs RED4ext 1.31 or later and no longer loads on 2.31 (REDnode 0.37.0 is the last for 2.31).
- On 2.5, sound archive swaps and the Sound Tracer find the game's audio code again (the Tracer's hook on Wwise's PostEvent needed a new pattern).
- The `api` types and the [game API reference](https://edgemodders.github.io/REDnode/game/) now come from game 2.5. 2.5 adds optional parameters to some functions (such as `EquipmentSystem.GetActiveItem`, for dual wielding) and renumbers some enums, which `api` passes by name, so calls written for 2.31 keep working.
- Hot swaps of archives (`archives.reload`, the MCP tool `archives_reload`, the Hot swap app) wait for a RED Hot Tools release for 2.5.

**Fixed**

- UI kit: typing in an `rn-input` or moving an `rn-slider` sent a page two `input` events, one of them the browser's own with no `detail`, so handlers reading `e.detail.value` threw (seen in Sound Tracer and Sound Search).

## 0.37.0 (2026-10-24)

**The last release for game version 2.31.** Game version 2.5 is not supported yet: RED4ext will not load this REDnode on 2.5. The next release moves REDnode to 2.5, as soon as RED4ext, redscript and Codeware support it.

**New**

- **Development folders**: in the launcher's Settings drawer, with Developer mode on, add folders from your own projects. Their packages run from there, with hot reload, instead of their installed copies, so a mod can be developed outside the game folder. The Mod Manager marks such a package **DEV** and names the copy it hides. A folder can be one package or hold several. See [Development folders](https://edgemodders.github.io/REDnode/overlay-apps.html#development-folders).
- **Mod services**: a package names a service file in its manifest (`"service": "service.mjs"`), and every function it exports can be called by other packages through REDnode with `service.connect("<package id>")`, with timeouts, Stop, the caller's name and events (`service.emit`, `$on`). Overlay pages can call too. `requires` takes other REDnode packages by id. Samples: **Counter service** and **Counter panel**. See [Calling other packages](https://edgemodders.github.io/REDnode/overlay-apps.html#calling-other-packages).
- **Service descriptions**: the JSDoc above a service's functions describes them. REDnode checks each call's arguments against it before the function runs, the Mod Manager lists a package's functions, `service.describe(id)` answers it, and `@tool`, `@readonly`, `@timeout` and `@event` mark what an assistant may call, what only reads, a longer timeout and the events. `rednode describe` writes `service.json` from the source for bundled and TypeScript packages. See [Describing a service](https://edgemodders.github.io/REDnode/overlay-apps.html#describing-a-service).
- **Mods' tools for AI assistants**: each service function marked `@tool` is offered to every assistant on REDnode's MCP server (Claude Code, REDagent) as `<package>__<function>`, with the author's description; `@readonly` ones run without asking, the rest ask the player first. `mod_services`, `mod_read` and `mod_call` reach tools of mods started later. See [Mods' tools and the Tools Manager](https://edgemodders.github.io/REDnode/mcp.html#mods-tools-and-the-tools-manager).
- **Tools Manager**, in the new optional **REDnode Admin Tools** pack (its own zip): every tool an assistant can see through REDnode, REDnode's own and each mod's, with what it does and whether it asks first; switch any tool or mod off for every assistant (kept across starts), or start new mods' tools off; see which assistants connected and their recent calls.
- **Task Manager**, in the Admin Tools pack too: every running package with its CPU, memory, its thread's load and heap, game calls and service calls; **End task** stops one, even one stuck in an endless loop, and **Restart** starts it again.
- The **admin** permission: a package that asks for it, once the player allows it in the Mod Manager (with a warning), may see what every package costs, end or restart any package, and switch AI assistants' tools on and off, through `admin` in the `rednode` package. The Admin Tools pack's apps use it. See [Admin Tools](https://edgemodders.github.io/REDnode/admin-tools.html).
- The UI kit's `rn-window` takes `drawer`: a panel that belongs to the page's main window, such as a settings drawer beside it. It has no title-bar actions but close, which only hides it, and the main window keeps its space, pin and reset actions.

**Changed**

- A package can be a Node mod with only a service file and no `main`.
- The launcher's settings (GPU sharing, Hot reload, MCP server, Developer mode, Open at start, Tooltips) moved to a **Settings** drawer beside it, opened with the gear at the right of the Theme row, one setting a row with a line on what it does. The launcher's title is now just **REDNODE**, so it no longer gets cut off. Its version line reads "Version 0.32.3" rather than repeating the name.

**Fixed**

- The docs site's example previews load again: since 0.32.0 every preview stopped at a script error.

**Other**

- The player zip's README says to switch the samples on in the Mod Manager. The docs correct several out-of-date pages: sound archives do swap (since 0.26.8), TweakDB writes exist, the manifest table lists every permission and field, and permissions are allowed in the Mod Manager.

## 0.32.1 (2026-10-23)

**For game version 2.31 only.** Game version 2.5 is not supported yet: RED4ext will not load this REDnode on 2.5. REDnode moves to 2.5 as soon as RED4ext, redscript and Codeware support it.

**New**

- The `ink` API (experimental, needs Codeware): Node mods build trees of the game's own UI widgets on the HUD (`ink.mount`, `ink.column`, `ink.text` and the rest), drawn by the game rather than the overlay. REDnode builds them again after a save load and removes them when the mod stops. The game look comes from the game's own style sheet: a text `style` (`title`, `label`, `value` and the rest) or a `tone` (`normal`, `accent`, `danger` and the rest) gives the game's exact sizes and colors with no styling by hand. Layout with `gap`, `pad`, `align` and `grow`; the game's icons by TweakDB record. Game values bound to texts and bars (`bind: "player.health"`, `ink.bar`), read by the plugin every frame with no update code in the mod; lists from data (`ink.list`, `mount.update`) that send only what changed. See [Native game UI](https://edgemodders.github.io/REDnode/ink.html). Text in the player's language: an ink text set to `"LocKey#…"` shows the game's own translation, and `t()` takes a package's own text from `locales/<language>.json`, with parameters, plurals and V's gender, and follows a language change. `game.language()` and the `language` event give the game's language. Samples: **Ink Coords**, **Ink vitals**, **Ink styles**, **Ink list** and **Ink language**.
- Swapping an archive now shows the new version on the clothing V wears at once, without taking it off: `archives.reload` applies the worn items' appearance again after the swap, in the base game's slots and Equipment-EX's (with Equipment-EX in use only its slots, so items it hides stay hidden). `{ refresh: false }` skips it; the answer's `refreshed` lists what was refreshed. The MCP tool `archives_reload` takes `refresh` too.
- A package's `requires` can name `rednode` with a version, for app packs that need a REDnode new enough. The overlay host answers with its own version.
- Each release on GitHub also carries the app packs' zips, such as REDnode Sound Tools, each as its own file.
- The MCP tool `api_read` reads from the game without asking: it runs functions named like reads (`Get`, `Is`, `Has`, `Can`, `Find`) and a TweakDB record's methods, and refuses the rest. See [the MCP server](https://edgemodders.github.io/REDnode/mcp.html).
- The Quest API, for testing a quest in the running game: `quests.fact`, `quests.facts` and `quests.setFact` read and set the game's quest facts, `quests.watch` hears each change of named facts as the game makes it (with no polling, kept across save loads), `journal.entry`, `journal.setState`, `journal.track` and `journal.tracked` read and change journal entries, and `game.player.teleport` moves V to a position or a world node. MCP tools for assistants: `game_facts` and `game_journal` read without asking; `game_facts_set`, `game_journal_set` and `game_teleport` ask first. See [Quest API](https://edgemodders.github.io/REDnode/quests.html). Sample: **Quest test**.
- New samples in the download, off until you switch them on: **Ink Coords** and **Ink vitals** (the game's own UI, need Codeware) and **Quest test**.
- The **Test timer** is now a sample in the download, off until you switch it on: a stopwatch whose **Mark** writes the step and the time to the Mod log and `red4ext/logs/rednode-mods.log`, to match log lines to what you did while testing a mod.

**Changed**

- Claude Code now asks you before every call of the MCP tools `api_call` and `archives_reload`, in every permission mode, auto mode included. Reads go through the new `api_read`, which never asks.

**Fixed**

- The MCP tool `api_read` no longer refuses reads whose names hold a word like `Equip`, `Start` or `Open` as a noun, such as `GetItemInEquipSlot` or `IsQuickHackPanelOpen`, which then went through `api_call` and asked you first. It refuses only reads that also change something, such as `GetOrCreate…`.
- Sending many game calls at once (more than 256 in one frame) no longer leaves the extra ones unanswered until they time out after 5 seconds: the plugin runs 256 a frame and carries the rest to the next frames, and refuses past 4096 waiting with a message.
- The game no longer crashes when quitting after a Node mod held objects made by another plugin, such as Codeware's: REDnode lets go of every object it holds when the game stops, while the other plugins are still loaded.
- `api.$new` with properties on a class written in redscript no longer breaks the object it makes (and crashes the game at its next use): script fields are now set where the game keeps them, as `$get` and `$set` already did.
- `archives.reload` and the MCP tool `archives_reload` refuse, with a message, a swap that the official RED Hot Tools would get wrong and end the game with: replacing an archive in a mod folder with both upper- and lowercase names. The [Edgemodders build of RED Hot Tools](https://github.com/CyberbuildsAI/cp2077-red-hot-tools/releases) fixes it, and with it REDnode swaps as before.

**Other**

- REDnode's own native calls into the game remember the functions they find, so reading game values every frame costs less.
- REDnode's scripts keep the root widgets of a few HUD and menu screens (`REDnodeInk.reds`), the first part of the coming ink API for the game's own UI. Nothing changes on screen.
- During an archive swap, `red4ext/logs/rednode-faults.log` now also names whatever ends the game (TerminateProcess, ExitProcess or a fail-fast), with its status, its stack and the game engine's last error message, for crashes that leave no crash report.

## 0.26.15 (2026-10-20)

Folds in 0.26.2, which was not released on its own.

**New**

- Swapping sound into the running game: `archives.reload` and the MCP tool `archives_reload` now swap archives that change the game's sound paks (`.opuspak`, `.opusinfo`, such as EDGEwave's sound overrides). The swap runs with the game paused and its audio held, then REDnode loads the game's sound index again, so the new sounds play without a restart. A sound that played just before the swap may keep its old version until the game loads it again (for a weapon, equip it again). The answer's `sound` field says how it went.
- `ui.list()` in the UI builder: a list of lines that scrolls on its own, for a log or a live feed in a Node mod's window. It keeps its newest lines, follows the newest one unless the player scrolls up, and fills the window's free height, so the window itself never scrolls. See the new **Live log mod** sample.
- `ui.copy(text)` in the `rednode` package puts text on the Windows clipboard, from a Node mod or an overlay app.
- Experimental, for the coming REDnode Sound Tools: `audio.trace(onTrace)` lists the events the game posts to its audio engine, named where REDnode knows the name, and the sounds it loads, as they happen; every one is also written to `red4ext/logs/rednode-sound-trace.log`.
- Experimental: `audio.playGame(id)` plays one of the game's own recordings by its sound id through REDnode's engine; `audio.playGame({ event })` plays an event's recordings in turn, heard wherever the sound is in the game; `audio.eventSounds(event)` lists them.
- Experimental: `audio.searchSounds(query)` searches the game's sound events by words of their name or tags, by event id, or by sound id (the events that play it).
- Experimental: `audio.event(name)` posts a game sound event through the game, on V so positional sounds are heard (`{ on: "none" }` for none), and returns `stop()`. When a package stops, REDnode stops the events it posted.

**Fixed**

- The overlay's arrow could vanish in the game after a save loaded on some NVIDIA setups, while the windows still showed. It is now drawn from a texture, the same way as the windows.

**Changed**

- The Welcome window warns that F9, right beside F10, is the game's Quick Load.

**Other**

- The plugin watches for faults, and breakpoints (a failed assert in the game), around each archive swap and writes what it finds to `red4ext/logs/rednode-faults.log`, for bug reports.
- The host log of the last game session is kept as `red4ext/logs/rednode-overlay.prev.log`, so a crash's log survives the next start.
- `archives.soundState()` in the `rednode` package reads the game's sound pak index, the paks it has open and the sounds it holds loaded, without changing them (a sound's fields are `offset`, `headerSize`, `length` and `decodedBytes`): an experimental diagnostic. See [swapping archives](https://edgemodders.github.io/REDnode/overlay-apps.html#swapping-archives-in-the-running-game).

## 0.26.1 (2026-10-19)

**New**

- Hot-loading archives: `archives.reload()` in the `rednode` package swaps `.archive`, `.xl` and `.yaml` files into the running game through [RED Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools), with checks and a queue around it. A package needs the new `archives` permission, which the player allows in the launcher. Also the MCP tool `archives_reload`. See [hot-loading archives](https://edgemodders.github.io/REDnode/world.html).
- A Welcome window at the first start that teaches F10. It shows once.

**Fixed**

- An archive path pasted from Windows' **Copy as path**, with its double quotes, is accepted.

**Other**

- The plugin log reports the overlay's cursor every 5 seconds in interactive mode, for bug reports. If the overlay's arrow blinks with DLSS on, update the GPU driver: an older NVIDIA driver caused it on one laptop.

## 0.25.0 (2026-10-17)

**New**

- **Get REDbridge** in the Mod Manager fetches REDbridge and .NET 10 for the current user, so players no longer need VS Code for packages that read the game's archives. A manifest can list `"redbridge"` in `requires`.
- A **Tooltips** switch in the launcher.

**Changed**

- REDnode finds REDbridge in EDGEdeck's storage (`edgemodders.edgedeck`), no longer REDdeck's.

**Fixed**

- Tooltips show in overlay windows: inside the UI kit's controls and on the title-bar icons.
- HUD widgets no longer show on the loading screen at boot.

## 0.24.3 (2026-10-16)

**Fixed**

- REDnode finds REDbridge under REDcode's store id since REDcode 0.8.2, `edgemodders.redcode-cyberpunk`.

## 0.24.2 (2026-10-16)

The first release. The RED4ext plugin, the HTML overlay host and six samples (Hello mod, Ask mod, UI kit, Vitals, Coords, Perf).

- HTML overlay windows, apps with manifests, HUD widgets, a launcher, a Mod Manager and spaces (named sets of windows), drawn into the game. F10 cycles passive, interactive and hidden.
- Node mods: each package runs in its own process with the `rednode` package, a `ui` builder and hot reload.
- The game API: call game functions and read properties, with generated types; the World API to build objects; TweakDB reads and writes (through TweakXL); REDnode's own sound engine; pointer lock.
- An MCP server so Claude Code can see and drive the overlay and the game.
