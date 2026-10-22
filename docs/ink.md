# Native game UI (ink)

Status: **I1 passed in game on 2026-10-22** (REDnode 0.27.2, [third run](#i1-test-third-run-0272)), after a crash in the first run (0.27.0) and one at quit in the second (0.27.1), both REDnode bugs, fixed. What it means for I2: [I1: what it decides](#i1-what-it-decides). Decided by the owner the same day: the `ink` API requires Codeware. **I2a passed in game on 2026-10-22** (REDnode 0.28.0, [results](#i2a-test-results)). **I2b is built in REDnode 0.29.0** and awaits its in-game test ([I2b test](#i2b-test)); placement across resolutions is left for later, as agreed. The design, the tags and the phases I1 to I6 are in the design doc, [section 06](design.html#ink). Order agreed with the owner on 2026-10-21: H2 `world.refresh`, then this API from I1, then the Sound API's S2. H2 stopped after H2b on 2026-10-22; H2c (NPCs, props, with EDGEbuilder) comes after this API.

The game draws its own UI with **ink**, a tree of widgets with logic controllers. REDnode's overlay apps and the `ui` builder draw in Chromium over the game; the game's UI never sees them. The `ink` API lets JavaScript and TypeScript mods build into the game's own UI, drawn by the engine, the way redscript mods do.

## I1 Spike: plan

I1 answers the questions the design leaves open, so I2 builds the driver on facts. It adds no modder API. The tools:

- A test app, **Ink test** (`packages/overlay/apps/ink-test`), that does everything through the `api` in the `rednode` package, like the Refresh test did for H2.
- A small script, `native/scripts/REDnodeInk.reds`: the root hooks and a listener class. It ships with the plugin, so the spike is a REDnode build (0.27.0).

### What I1 answers

| # | Question | How the spike answers it |
|---|---|---|
| 1 | A root on the HUD, **without Codeware** | The script wraps the `OnInitialize` of a scripted HUD controller that lives for the whole session and keeps its root (`GetRootCompoundWidget()`, a weak handle). `REDnodeInk.HudRoot()` returns it. Which controller is picked from the dump while building; that it lives for the whole session is unverified |
| 2 | A root on the HUD, **with Codeware** | `GameInstance.GetInkSystem().GetLayer(n"inkHUDLayer").GetVirtualWindow()` through `api` (Codeware's functions are in the game's type data at run time, so `rtti.call` should reach them: unverified) |
| 3 | A root **in a menu** | The script also keeps the roots of the hub (`MenuHubGameController`) and the pause menu while they are open, cleared in `OnUninitialize`. With Codeware, its menu layer too |
| 4 | **Building** widgets | `AddChild(n"inkText")` and `AddChild(n"inkRectangle")` on a root, then text, font, size, tint, anchor and margin. `AddChild` returns a weak handle (the 0.24.5 lesson): check that the parent keeps the widget alive and that the `api` does not take a strong hold of it |
| 5 | **Events** | `REDnodeInkListener` (an `IScriptable` with an id) registered with `RegisterToCallback(n"OnRelease", listener, n"OnRelease")`, and the same for hover. Its handlers call `REDnode_Emit("ink.release", id)`, which reaches the app as a game event. Tried on the menu layer, where the game shows its cursor |
| 6 | **Speed** | Time a round trip of one `SetText`, and how many changes fit in one frame (the bridge runs every queued call each frame, up to 256). This decides how I2's driver batches |
| 7 | **Lifetime** | What happens to the widgets when the HUD hides, when a menu closes and when a save loads. **Clean up** removes everything the app added |
| 8 | **Opening a game screen** | `StartHubMenuEvent.SetStartMenu(n"inventory_screen")` queued with `UISystem.QueueEvent`; then the other hub menus by name |
| 9 | **A menu entry for new screens** | Read only: find the menu resources by name through REDbridge (`archive.search` for `.inkmenu` and `.inklayers`), load them through Codeware's `ResourceDepot` and list their entries and scenarios. Adding the `rednode_screen` entry needs a widget library for it, so it moves to the start of I5 |
| 10 | **Reading a live screen** (for Dump source, below) | Walk the open screen's tree from its root: each widget's class, name, children and main properties (size, anchor, margin, tint, text, image part), and which controllers it carries. Count the widgets and time the walk on a big screen, such as the perks screen. Find whether a widget records the library item it was spawned from (unverified) |

The script is checked with redscript-cli against a copy of `r6/cache/final.redscripts`, with and without Codeware's scripts, before it reaches the game: one compile error stops every script in the game.

### The Ink test app

One window, a button per step, each answer written to the window and the Mod log:

| Button | Does |
|---|---|
| Roots | Reports which roots it found: the script's HUD root, the menu roots, Codeware's layers |
| HUD text | A text and a rectangle on the HUD root (the script's, or Codeware's if chosen) |
| Menu button | A rectangle with a label on the open menu's root, with the listener; pressing and hovering it log events |
| Speed | 1, 50 and 200 `SetText` calls, timed |
| Open inventory | The `StartHubMenuEvent` |
| Menu entries | Lists the loaded menu resource's entries, if found |
| Read screen | Walks a root's tree (the open screen's, with a `menu.` root) and writes it, with the count and the time, to a file in the app's data folder, named in the log (local only: it is game data) |
| Clean up | Removes every widget the app added |

### Dump source (idea, 2026-10-22)

Proposed by the owner: a **Dump source** button. A modder opens a game screen, such as the perks screen, presses it, and gets that screen written as REDnode's ink tags, or as code that builds it, to start their own screen from. RED Hot Tools' Ink Inspector shows such a tree is readable at run time; I1's item 10 checks REDnode can read it too, and how fast.

| Part of the screen | What the dump gives |
|---|---|
| Containers, text, images, shapes | The matching tags (`vbox`, `text`, `image` and the rest) with their properties, in REDnode's layout words where they fit |
| A widget no tag covers | The `widget` escape hatch with its class and raw properties |
| A game library item (a button, a perk tile) | A `library` tag with its resource and item, if the widget records where it came from (unverified); otherwise its widgets spelled out |
| Controllers | Named in a comment. Their behavior is game script and is not translated |
| Text and data | As shown at that moment: names and numbers the game's scripts filled in become plain strings, or `LocKey#` keys where the widget holds one |

The dump is a snapshot of the look, not the screen's logic. It is game data: the modder keeps it locally, and REDnode never ships or commits one.

When: I1 tests the reading. The generator needs the tags, so a first version that writes primitives can come with I2, and the full one, with library items and composites, with I4. Where the button lives (the O9 window debugger, the MCP server for REDagent, or its own tool window) is decided then.

### After I1

The results decide, for I2:

| Decision | Options |
|---|---|
| The HUD root | REDnode's own hook (base game only), Codeware's layers (`requires` Codeware for `ink`), or both with the hook as the fallback |
| Batching | Changes per frame and the budget, from the speed numbers |
| Rebuild | What the driver must rebuild, and when, from the lifetime answers |
| Cursor | Interactive ink only in menus for I3, or more (the open question in the design) |
| Screens | Whether the menu entry can be added in memory, or needs an archive |

## I1 build (REDnode 0.27.0)

Built on 2026-10-22, as planned:

| Part | What it is |
|---|---|
| `native/scripts/REDnodeInk.reds` | A script system, `REDnodeInk`, keeping the roots of five controllers: `hud.healthbar` (healthbarWidgetGameController), `hud.minimap` (MinimapContainerController), `hud.quests` (QuestTrackerGameController), `menu.hub` (MenuHubGameController) and `menu.pause` (PauseMenuGameController). `REDnodeInk.Names()` and `REDnodeInk.Root(name)` for the `api`. `REDnodeInkListener` sends `REDnodeInk.press`, `.release`, `.hoverOver` and `.hoverOut` with its id. No Codeware needed |
| `packages/overlay/apps/ink-test` | The Ink test app (0.1.0), through `api` only. Not in the player zip |

Checked: the scripts compile with redscript-cli (v1.0.0-preview.22) against the game's `final.redscripts`, without Codeware (no errors) and with Codeware's scripts (errors only in Codeware's own files, which redscript-cli is stricter about, as before). The app's buttons ran against a stand-in for the `rednode` package with a fake widget tree, without and with Codeware, with script and native class names. Nothing ran in the game yet: which root suits a mod, which class names `AddChild` takes, whether clicks arrive and the speeds are all unverified.

## I1 test

On the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.27.2 (update zip over 0.27.1), Ink test 0.1.1, with Codeware. Each button writes its answer to the Ink test's window and the Mod log.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Make sure **Ink test** is switched on in the launcher. Load a save. **F10**, press **Roots**. **Mark**.
2. Type `cw.inkHUDLayer` in the root field and press **HUD text**. Close the overlay (**F10**): is a dark box with "REDnode ink" in the upper left? **Mark**.
3. Open the overlay, press **Speed** and wait for its line in the log (a few seconds), then press **Check**. **Mark**.
4. Press **Esc** for the pause menu. Open the overlay, type `menu.pause` in the root field, press **Roots**, then **Menu button** (not HUD text). Close the overlay: is a red "Ink button 3" in the pause menu? Hover it, then click it with the game's cursor. **Mark**.
5. Open the overlay: does the log show "ink hoverOver", "ink press" and "ink release" lines? **Mark**.
6. Leave the pause menu. Open the overlay, press **Check**. **Mark**.
7. Type `new_perks` in the screen field and press **Open screen**: does the perks screen open? **Mark**.
8. With the perks screen open, open the overlay, type `cw.inkMenuLayer` in the root field and press **Read screen**. Wait for its line, then type `menu.hub` and press **Read screen** again. **Mark**.
9. Leave the perks screen and close the hub. Quit the game from the menu. Send `rednode-mods.log`, `red4ext/logs/rednode-*.log` of this run, and the two dump files Read screen named (they stay on your PC otherwise: they are game data). Does the game quit without a crash report?

## I1 test: first run (0.27.0)

2026-10-22 at about 16:37, on the laptop, with Codeware. Steps 1 to 4 ran. The player's notes:

| Step | Seen |
|---|---|
| 2, HUD text on `hud.healthbar` | Nothing on screen |
| 3, HUD text on `cw.inkHUDLayer` (Codeware's HUD layer) | "REDnode ink" showed |
| 5, Menu button | **The game crashed** at the press |

The crash report: an access violation in `REDnode.dll+0x2fd30`, reading `0x7FF70000000D`. Read from the dump: the plugin was converting `RegisterToCallback`'s `object` argument (a `handle:IScriptable`), the `REDnodeInkListener` the app had just made with `api.$new("REDnodeInkListener", { id })`. The object was alive (its reference counter held 2 strong references, and its `ref` field pointed at itself), but the low half of its vtable pointer read `5`: the listener's `id`, which was 5 at that point in the test. The plugin's `rtti.new` wrote the properties it was given at each property's offset in the object. A script class (one written in redscript) keeps its own fields in a value holder beside the object, so `id` went over the vtable, and the next virtual call on the object crashed. `rtti.get` and `rtti.set` already found script fields correctly (the SDK's `GetValuePtr`); only `rtti.new`'s properties did not. W1's `$new` calls built native classes, which keep their fields in the object, so this never showed before.

Fixed in REDnode 0.27.1: `rtti.new` finds each property through `GetValuePtr`, as `rtti.get` and `rtti.set` do, for every class; structs keep their plain offsets.

Step 2's empty screen is unverified. A likely reason: the health bar's root fades out of combat with the rest of the health bar, and widgets added into it fade with it. The retest's Roots line shows each root's size and visibility.

## I1 test: second run (0.27.1)

2026-10-22 at 16:48 to 16:55, on the laptop, REDnode 0.27.1, Ink test 0.1.0, with Codeware. Steps 1 to 10 ran; at step 5 **HUD text** was pressed rather than **Menu button**, so clicks are still untested. The game crashed when the player quit.

| # | Question | Answer |
|---|---|---|
| 1 | HUD root without Codeware | The script's hooks work: `hud.healthbar`, `hud.minimap` and `hud.quests` were kept at every load. None suits a mod. `hud.healthbar`'s root is an 8x8 `inkVerticalPanelWidget`, **hidden** out of combat, which is why step 2 showed nothing in both runs. `hud.minimap` (450x450) and `hud.quests` (680x210) are visible but are their own corners of the screen. A full-screen HUD root without Codeware needs another hook (open) |
| 2 | HUD root with Codeware | Works. `cw.inkHUDLayer` is an `inkVirtualWindow` of 2560x1440; the text and box showed in its upper left. Codeware lists 13 layers |
| 3 | Root in a menu | `menu.pause` is a full-screen canvas (3840x2160, 17 children). The text and box showed in the pause menu's upper left. `menu.hub` was kept while the hub was open |
| 4 | Building | `AddChild` takes the script names `inkText` and `inkRectangle`. A rectangle and a text, about 12 calls one after another, took 290 to 400 ms: about one frame per call |
| 5 | Events | Not tested (Menu button not pressed) |
| 6 | Speed | Failed: "The game did not answer within 5 seconds". The plugin dropped every call past 256 waiting in one frame, so the 600 at once never got answers. Fixed in 0.27.2 (below) |
| 7 | Lifetime | Widgets on a menu's root die with the menu (gone once the pause menu closed). A save load rebuilds the HUD: `cw.inkHUDLayer` went from 3 children back to 1, so the driver must build its trees again after each load |
| 8 | Opening a game screen | Works: `StartHubMenuEvent` with `new_perks` opened the perks screen |
| 9 | Menu entries | Read through REDbridge and Codeware. `base\gameplay\gui\fullscreen\menu.inkmenu`: 57 entries (`pause_menu`, `hub_menu`, `inventory_screen`, `new_perks`, `world_map`, `wardrobe` and the rest) and 22 scenarios (`MenuScenario_HubMenu`, `MenuScenario_PauseMenu` and the rest). `main_menu\pregame_menu.inkmenu`: 30 entries, 17 scenarios. `ui_game.inklayers` names the menu layer's resource by hash. Adding an entry stays for I5 |
| 10 | Reading a live screen | `menu.hub`: 359 widgets in 16.6 s. The hub's root holds the hub's own frame (the tab buttons, level, street cred, weight, money, the time panel), not the perks screen, which is a menu of its own. 0.1.0 fetched each widget's children one widget at a time; 0.1.1 fetches a whole level at once. About 60 widgets read nothing (empty name, no size), unverified why. Names, sizes, visibility, controller counts and texts read well, including localized text and a format string (`{VALUE,time,short}`) |

**The crash at quit.** The crash report: an access violation in `REDnode.dll+0x243cc`, a handle's destructor calling the object's `CanBeDestructed` through its vtable, which pointed into memory no longer loaded. REDnode's table of the objects Node mods hold is a global, so its destructor ran when the DLL unloaded, after the other plugins had gone. The objects held then included Codeware's (the resource token and layer objects from Menu entries and Roots), whose code was already unloaded. Fixed in 0.27.2: the table is cleared when the game's Running state ends, while everything is loaded, and is never destroyed at unload.

**Fixed in REDnode 0.27.2:**

| Fix | Where |
|---|---|
| The bridge keeps up to 4096 waiting calls and runs 256 a frame, carrying the rest to the next frames; past 4096 a call is refused at once with a message. Before, calls past 256 were dropped and each timed out after 5 s | `native/src/overlay/bridge.cpp` |
| The references Node mods hold are let go when the game's Running state ends, and the table is never destroyed at DLL unload | `native/src/main.cpp`, `native/src/overlay/reflect.cpp` |
| Ink test 0.1.1: Check counts only what exists (it said "6 of 6 exist" when none did); Speed logs each line as it goes and adds 2000 at once; Read screen fetches a whole level at once | `packages/overlay/apps/ink-test` |

## I1 test: third run (0.27.2)

2026-10-22 at 17:07 to 17:14, on the laptop, REDnode 0.27.2, Ink test 0.1.1, with Codeware. **Passed**: every step, and the game quit with no crash report (the plugin log ends with the pump stopping and the host disconnecting).

| Step | Result |
|---|---|
| 1, Roots | As in the second run. The owner's note: the health bar is switched off in their HUD settings, which matches `hud.healthbar`'s root reading hidden |
| 2, HUD text on `cw.inkHUDLayer` | Showed |
| 3, Speed | 1 change 22.5 ms; 50 in a row 1235 ms (24.7 ms each, about one frame each at the game's 40 fps); 200 at once 38 ms; 600 at once 78 ms; **2000 at once 239 ms**, none failed. The 256-a-frame queue works |
| 4 and 5, Menu button | Showed in the pause menu. Hover and click reached Node: `hoverOver`, `hoverOut`, `press`, `release`. **Each click arrived 12 to 14 times** as press and as release: one per input action bound to the mouse button, likely (unverified). Hover arrived once |
| 6, Check | The HUD widgets existed; the pause menu's widgets had gone with the menu |
| 7, Open screen | `new_perks` opened the perks screen |
| 8, Read screen | `cw.inkMenuLayer`: **4138 widgets in 1994 ms**: the perks screen (its own root, with the perk tooltips, `hitToOpenPerksScreen`, `attributes_canvas` and the attribute buttons) and the hub's frame beside it. `menu.hub`: **958 widgets in 564 ms**, none unreadable (the second run's unreadable widgets were the calls the plugin dropped past 256) |
| 9, Quit | No crash |

## I1: what it decides

The decisions the plan left to I1, with what the runs showed. The recommendations are for the owner to agree before I2.

| Decision | What I1 showed | Recommendation for I2 |
|---|---|---|
| The HUD root | REDnode's own hooks work but give no full-screen HUD root: the health bar's is 8x8 and hidden when the bar is off or out of combat, the minimap's and quest tracker's are their own corners. Codeware's `inkHUDLayer` window is full-screen (2560x1440 on the laptop) and worked every time | Use Codeware's layers for `ink.mount("hud")`, so the `ink` API `requires` Codeware (EDGEbuilder's world features already do). Keep REDnode's menu hooks; look for a full-screen base-game HUD root later only if a modder needs `ink` without Codeware |
| Batching | One call after another costs about one frame each (25 ms at 40 fps): a 40-widget panel at about 8 calls a widget would take 8 s. Calls sent together run 256 a frame: 2000 took 239 ms | The driver in the plugin, as the design says: a tree or a batch of changes goes in **one** bridge call and is applied natively on the game thread. Never one bridge call per property |
| Rebuild | A save load rebuilds the HUD and drops every added widget. A menu's widgets die when the menu closes | The driver keeps each package's tree and builds it again after each load (`OnGameAttached`) and each time its menu opens |
| Events | Hover and click reach Node through a listener class in REDnode's scripts. One click fires press and release 12 to 14 times | I3: the listener passes on only the `click` action (`inkPointerEvent.IsAction`), and the event carries the widget's id and the action name. The cursor: interactive ink in menus first, where the game's cursor works |
| Screens | `StartHubMenuEvent` opens a game screen by its menu name. The game's menu list (`menu.inkmenu`, 57 entries, 22 scenarios) is readable through REDbridge and Codeware | `ink.screens.open(name)` with the 57 names; adding `rednode_screen` stays for I5 |
| Dump source | A whole open screen reads in about 2 s (4138 widgets), with names, classes, sizes, visibility, controller counts and texts | Feasible. A first version with I2's tags; the read itself moves into the plugin's driver (one call for a whole tree) |
| Class names | `AddChild` takes the script names (`inkText`, `inkRectangle`) | The tags map to them in one table |

## I2: plan

Decided by the owner on 2026-10-22, after I1: **the `ink` API requires Codeware** ("a foundational mod that most people have already"). A package that uses `ink` lists it in `requires`, and `ink` calls fail with a message naming Codeware when it is missing.

The design's I2 row is large: the driver, the primitives, layout and theme words, bindings, data-driven trees and localization. Proposed: three steps, each with its own in-game test, so the driver is proven before anything is built on it.

| Step | What | Sample |
|---|---|---|
| **I2a Driver** | The ink driver in the plugin and the first `ink` API: mount a tree on the HUD, change it, remove it, rebuilt after a save load, cleaned up when the package stops | **Ink Coords**, an ink version of Coords HUD |
| **I2b Layout and look** | The layout words (`row`, `column`, `gap`, `pad`, `align`, sizes such as `fill`), theme words (`style`, `tone`, the game's palette by name), images (atlas parts, TweakDB icons), fonts | A small HUD panel in the game's style |
| **I2c Data** | `bind` (game values the plugin reads each frame, no round trip), trees from data (`update(tree)` diffs and sends only what changed), `LocKey#` text and `t()` with package locale files (L1 of [Localization](localization.md)) | A list built from data, in two languages |

Agreed by the owner on 2026-10-22: build I2a.

### The game look (owner, 2026-10-22)

Proposed by the owner with I2a's go-ahead: modders can build any ink they like (a button with a border or without, any font and size), but they should not have to work out how to make a button look like the game's own (the red ones with angular borders, their hover glow and sounds). REDnode gives a clear marker that means "look like the game", and the piece then looks and behaves like the game's.

| Kind of tag | Default | The marker |
|---|---|---|
| Ready pieces: `button`, `toggle`, `slider`, `panel`, `tabs`, `dialog`, `tooltip`, `progress`, `keyhint`, `list` | **The game's look**: the game's own library items where one exists (spawned from its `.inkwidget` libraries, with their controllers, states, animations and sounds), otherwise a REDnode composite drawn to match | `look: "plain"` gives a bare one to style by hand |
| Primitives: `text`, `rect`, `image`, `border`, the containers | Plain | `look: "game"` applies the game's font, colors and sizes for that tag; `style` picks one of the game's text styles (`title`, `label`, `value`, `small`) and `tone` one of its palette roles (`normal`, `accent`, `danger`, `dim`) |

So `ink.button("Track", onClick)` is a game button with no styling written, and `ink.button("Track", onClick, { look: "plain", color: "#ffffff" })` is the modder's own. The same names work in overlay windows: the UI kit (`packages/ui`) gets a matching game look for its HTML elements (`rn-button` and the rest, through a `look="game"` attribute and a `game` theme), so an HTML app and an ink screen can look the same. Which library items the game has, and their paths, come from I1's Read screen and REDbridge, kept in one table behind the tags (the design's open question about paths changing with a patch).

When: the theme words and `look: "game"` on primitives in I2b; the game's library items and the ready pieces in I4 (the design's "Game look" phase); the UI kit's game look beside I4. Unverified until then: whether every piece has a library item that spawns cleanly outside its own screen.

### I2a Driver

**In the plugin** (`native/src/overlay/ink.cpp`):

| Part | What it does |
|---|---|
| One bridge call for a batch | `ink.apply {package, ops}`: each op creates a widget (`{op:"add", id, parent, tag, props}`), changes one (`set`), or removes one (`remove`). The whole batch runs on the game thread in the frame it arrives, with no round trip per property. I1 measured one call per change at a frame each |
| The kept tree | Per package and mount: each widget's id, tag, parent and current properties, and a weak handle to the live widget |
| Mounts | `hud` only in I2a: a full-size canvas of REDnode's own (`rednode:<package>:<mount>`) under Codeware's `inkHUDLayer` window, so a package's widgets live in one place and leave together |
| Rebuild | Each frame, a cheap check that each mount's canvas is alive. When it is not (a save load, a HUD rebuild) and the HUD layer is back, the driver builds the kept tree again. No help from Node |
| Cleanup | `ink.clear {package}` removes its mounts; the host sends it when a package stops or reloads |
| Tags to ink | One table: `canvas` to `inkCanvas`, `column` to `inkVerticalPanel`, `row` to `inkHorizontalPanel`, `text` to `inkText`, `rect` to `inkRectangle`, `image` to `inkImage`, `circle` to `inkCircle`, `border` to `inkBorder`; a property to its setter (`text` to `SetText`, `color` to `SetTintColor` and so on), through the plugin's existing call machinery |
| Limits | A cap on widgets per package (proposed 2000) and on ops per frame, with a message past them |

**In the `rednode` package** (`packages/rednode/src/ink.ts`), the same style as the `ui` builder, so modders learn one way:

```js
import { game, ink } from 'rednode';

const where = ink.text('', { size: 28, color: 'cyan' });
const board = ink.mount('hud', { anchor: 'top-right', x: -40, y: 120 },
  ink.column({ gap: 4 }, ink.text('REDnode', { size: 20 }), where));

setInterval(async () => {
  const p = await game.player.position();
  where.set({ text: `${p.x.toFixed(1)}  ${p.y.toFixed(1)}  ${p.z.toFixed(1)}` });
}, 250);

board.unmount(); // or let REDnode clean up when the mod stops
```

| Piece | What it is |
|---|---|
| Tags | `ink.canvas`, `ink.column`, `ink.row`, `ink.text`, `ink.rect`, `ink.image` (an atlas path and part), `ink.circle`, `ink.border`, and `ink.widget(className, props)` as the escape hatch |
| Props in I2a | `id`, `x`, `y`, `width`, `height`, `anchor` (`top-left` to `bottom-right`, `center`, `fill`), `margin`, `color` (`#rrggbb`, `[r, g, b]` or a palette name), `opacity`, `visible`, and per tag `text`, `size`, `font`. More in I2b |
| Nodes | Each tag returns a node; `node.set(props)` sends only the props given, batched with every other change in the same tick into one `ink.apply` |
| Mounts | `ink.mount(layer, options, ...children)` returns a mount with `unmount()` and `get(id)` |
| Hot reload | A package that reloads starts clean: the host clears its old mounts first |

**In the host**: `ink.apply` passes through with the sender's package id (a package can only touch its own widgets); `ink.clear` when a package stops; a missing Codeware answers with a message.

**The docs simulation** draws ink trees as plain HTML in the examples, so Ink Coords gets a live preview like the other samples.

**Not in I2a:** menus as mounts and events (I3), library items and the game's styles (I4), screens (I5), bindings and localization (I2c).

### I2a build (REDnode 0.28.0)

Built on 2026-10-22, as planned:

| Part | Where |
|---|---|
| The driver: `ink.apply`, `ink.clear`, `ink.state`; the kept trees; a check every 30 frames that each mount is on screen, and a rebuild when it is not and a save is loaded; a mount per package as its own full-size canvas on Codeware's `inkHUDLayer`; every package's mounts removed when the host leaves | `native/src/overlay/ink.cpp` |
| `CallNative`: the same argument conversion as `rtti.call`, for REDnode's own native code, with the answer kept as a game object rather than a reference (`Invoke` now shares `Run` with it) | `native/src/overlay/reflect.cpp` |
| `ink` in the package: `mount`, `canvas`, `column`, `row`, `text`, `rect`, `circle`, `image`, `widget`; `set` batches every change of a tick into one `ink.apply`; anchors and `x`/`y` become an anchor, a pivot and a translation; `gap` becomes the children's margins; colors by name, hex or numbers; columns, rows and texts fit their content | `packages/rednode/src/ink.ts` |
| The host: `ink.apply` and `ink.clear` carry the sender's package; a package's ink is cleared when it stops | `packages/overlay/main.js` |
| Ink Coords 0.1.0, the sample | `packages/overlay/apps/ink-coords` |
| The docs simulation draws ink trees in a small HUD box | `docs/assets/examples/sim/worker.js`, `runner.js` |

Checked: the plugin builds and its tests pass; the package builds; Ink Coords' docs preview draws its two lines at the top right of the box and updates them. Not checked anywhere yet: the driver in the game.

### I2a test

On the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.28.0 (update zip over 0.27.2), with Codeware.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Switch off **Ink test**, switch on **Ink Coords** in the launcher. Load a save. Close the overlay: is "REDNODE // WHERE" in red with V's position in cyan under it, at the top right, below the minimap? Walk a few steps: does the position follow? **Mark**.
2. Open the pause menu, then the hub (inventory), then photo mode, and come back each time: does Ink Coords hide with the HUD in each, and come back? **Mark**.
3. Load the same save again. Wait a few seconds after the load: are the coordinates back without doing anything? **Mark**.
4. Open the overlay, switch **Ink Coords** off in the launcher: do they go? Switch it on again: do they come back, once (not twice)? **Mark**.
5. Quit the game from the menu. Send `rednode-mods.log` and this run's `red4ext/logs/rednode-*.log` (the `Ink:` lines). Did the game quit without a crash report?

## I2a test: results

2026-10-22 at 17:53 to 17:59, on the laptop, REDnode 0.28.0, with Codeware. **Passed**: every step, and the game quit with no crash report.

| Step | Result | The plugin log |
|---|---|---|
| 1, Ink Coords on | The two lines showed at the top right and followed V. Not entirely below the minimap: the position is in the layer's units, and the laptop's HUD layer is 2560x1440 | "mount m1 on hud: 0 of 0 widgets built (build 1)": the mount is built before its widgets arrive, which are then added one by one |
| 2, menus and photo mode | Hid with the HUD in the pause menu, the hub and photo mode, and came back | |
| 3, a save load | Back with no action | "3 of 3 widgets built (build 2)", 2 s after the load |
| 4, off and on | Gone when switched off, back once when switched on | The mod stopped, a new mount m1 was built |
| 5, quit | No crash | |

Found, to fix with I2b:

| What | Why | Fix |
|---|---|---|
| After quitting to the main menu, the driver tried once to rebuild there and logged "Codeware has no layer inkHUDLayer" | Its check for a loaded save is `GetPlayer`, and the game makes a player at the main menu too (as the Vitals widget found on the boot loading screen) | Also wait for the plugin's own main-menu state to be off |
| At quit, the mod's last update got "The game did not answer within 5 seconds" in the Mod log | The game had stopped running the pump | The package stays quiet about `ink.apply` timeouts while the game is closing |

**Open, raised by the owner:** placement that holds across screen resolutions and aspect ratios, and placement relative to the game's own HUD pieces (below the minimap, beside the health bar). To discuss with the owner as part of I2b's layout words.

## I2b: build (REDnode 0.29.0)

Agreed with the owner on 2026-10-22: I2b now, without the placement question (resolutions, and placement beside the game's HUD pieces), which comes when its time comes.

**The game look, from the game's own style sheet.** Read from the game's archives with REDbridge on the dev PC (nothing from the game is committed): the game's widgets take their colors from `base\gameplay\gui\common\main_colors.inkstyle`, by binding a property to a name in it (`tintColor` to `MainColors.Red`; the quest tracker's widget file binds `tintColor`, `opacity` and `textureAtlas` this way). The sheet holds the game's colors (`MainColors.Red`, `Blue`, `Yellow`, `Green`, `Grey`, `White`, `Warning`, `ActiveRed`, the fullscreen backgrounds and about 140 more), its readable text sizes (`ReadableXSmall` 30, `ReadableSmall` 38, `ReadableMedium` 42, `ReadableFontSize` 50, `SubtitleHeader` 60, `TitleHeader` 70, `FluffFontSize` 25) and weights (`HeaderFontWeight` Semi-Bold, `BodyFontWeight` Medium). Bound colors stay exact: HDR values, and the colorblind themes the game swaps in (unverified in game). No font binding was found in the widget files read, so text sizes and weights are set from the sheet's values rather than bound.

| Word | What it does | In the plugin |
|---|---|---|
| `tone` | `normal`, `accent`, `highlight`, `success`, `warning`, `danger`, `dim`, `white`, `background`: one of the game's colors by role | `styleSheet` the sheet, `bind {tintColor: "MainColors.…"}` |
| `style` (text) | `title`, `subtitle`, `heading`, `body`, `label`, `value`, `small`, `fluff`: the sheet's size, weight, case and tone | font, size, `letterCase`, bound tint (and opacity for `fluff`) |
| `look` | `"game"` takes the game look (a tone or a text style means it too); `"plain"` is styled by its props only | |
| `color: "MainColors.Yellow"` | Any of the game's color names, bound | `bind` |
| `align` | In a `column`, children left, center, right or fill; in a `row`, top, center, bottom or fill. On a child, for itself | `hAlign`, `vAlign` |
| `grow` | A child's share of the space left in a sized `column` or `row` | `sizeRule Stretch`, `sizeCoefficient` |
| `pad` | Space inside a container | `padding` |
| `case`, `textAlign`, `weight` | A text's letter case, alignment within its width, and font weight (I2a's `style` for the weight is now `weight`) | `letterCase`, `textAlign`, `font` |
| `icon` | `ink.image({ icon: "UIIcon.…" })`: the record's `atlasResourcePath` and `atlasPartName`, read from TweakDB (6225 `UIIcon` records in 2.31) | `atlas`, `part` |

The driver applies a node's props in the order ink needs: the style sheet, then the bindings being untied, then the other props, then the new bindings, so a `color` set after a `tone` stays. Bindings add up across changes, and a rebuild after a save load applies the current ones.

**The two fixes from I2a:** the driver waits for the plugin's main-menu state to be off before it builds (`InMainMenu` in gamestate.cpp); an `ink.apply` that times out (the game closing or loading) leaves one quiet line in the Mod log instead of an error.

**Samples:** Ink Coords 0.2.0 uses the `label` and `value` styles; **Ink styles** 0.1.0 (`packages/overlay/apps/ink-styles`) is the test: a gallery on the HUD with buttons that change it while it shows.

Checked: the plugin builds and its tests pass; the package builds; in the mock game Ink styles sent its gallery in one call, a tone change as one binding, and a color over a tone as the tint with the tint's binding untied; the docs preview of Ink Coords shows the label and value styles. Not checked in the game: whether the bindings take the game's colors, whether the sheet sets on a widget REDnode made, the icons, align and grow.

## I2b test

On the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.29.0 (update zip over 0.28.0), with Codeware.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Keep **Ink Coords** on and switch on **Ink styles**. Load a save. Close the overlay: is Ink Coords now a red upper-case "REDNODE // WHERE" over cyan numbers, both right-aligned, like the game's own HUD text? **Mark**.
2. Open the overlay, press **Show** in the Ink styles window, close the overlay. At the left: the title, then eight text styles, each smaller than the one before (fluff faded), then eight tone words in different colors? **Mark**.
3. Under them: "plain look" white, "game look" red, "a game color" yellow, "#ff00ff" magenta? Then the changing line, the three lines in a 700-wide column, a bar of three boxes (blue, red twice as long, yellow 100 wide), three small boxes, and five icons? **Mark**.
4. Open the overlay, press **Next tone** a few times, then **White over tone**, then **Next tone** again: does the line change color each time, and go white then back to a tone? **Mark**.
5. Press **Next align** three times: do the column's three lines move left, center, right? Press **Next gap** twice: do the three small boxes spread apart? **Mark**.
6. Type `UIIcon.Assault_Area_02_Perk_1` in the field and press **Show this icon**: does the last icon change? **Mark**.
7. Load the same save again and wait a few seconds: are Ink Coords and the gallery back, in the same colors? Then quit to the main menu and wait a few seconds there, and quit the game. **Mark** before quitting if you can.
8. Send `rednode-mods.log` and this run's `red4ext/logs/rednode-*.log`. Was there an "Ink:" line at the main menu (there should be none now), and did the game quit with no crash report?

