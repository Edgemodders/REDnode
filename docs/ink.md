# Native game UI (ink)

Status: **I1 passed in game on 2026-10-22** (REDnode 0.27.2, [third run](#i1-test-third-run-0272)), after a crash in the first run (0.27.0) and one at quit in the second (0.27.1), both REDnode bugs, fixed. What it means for I2: [I1: what it decides](#i1-what-it-decides). Decided by the owner the same day: the `ink` API requires Codeware. **I2a passed in game on 2026-10-22** (REDnode 0.28.0, [results](#i2a-test-results)). **I2b passed in game on 2026-10-22** (REDnode 0.29.0, [results](#i2b-test-results)); placement across resolutions is left for later, as agreed. I2c's plan was agreed on 2026-10-22, with the language split off as I2d. **I2c passed in game on 2026-10-22** (REDnode 0.30.1, [retest results](#i2c-retest-results), after a [first run](#i2c-test-first-run-0300) on 0.30.0 whose list moves failed). I2d's plan was agreed on 2026-10-22. **I2d passed in game on 2026-10-22** (REDnode 0.31.0, [results](#i2d-test-results)): **phase I2 is done.** The design, the tags and the phases I1 to I6 are in the design doc, [section 06](design.html#ink). Order agreed with the owner on 2026-10-21: H2 `world.refresh`, then this API from I1, then the Sound API's S2. H2 stopped after H2b on 2026-10-22; H2c (NPCs, props, with EDGEbuilder) comes after this API.

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

## I2b test: results

2026-10-22 at 19:09 to 19:19, on the laptop, REDnode 0.29.0, with Codeware. **Passed**: every step, and the game quit with no crash report.

| Step | Result |
|---|---|
| 1, Ink Coords | Red upper-case label over cyan numbers, right-aligned: the game look from the game's own style sheet works on widgets REDnode made |
| 2, text styles and tones | Each style smaller than the one before, fluff faded; the eight tones in their colors |
| 3, looks, colors, layout, icons | Plain white, game red, a game color yellow, magenta; the column, the grow bar and the small boxes; **four of the five icons**. The second, `UIIcon.Assault_Area_01_Perk_1`, showed nothing |
| 4, tones live | Each tone change showed, white over a tone, then back to tones |
| 5, align and gap live | Left, center, right; the small boxes spread and padded |
| 6, an icon typed in | `UIIcon.Assault_Area_02_Perk_1` showed |
| 7, a save load, the main menu, quit | Both mounts rebuilt ("3 of 3", "43 of 43 widgets built (build 2)"); no `Ink:` line at the main menu (the I2a fix holds); no crash |

**The missing icon is the game's data, not REDnode.** Read with REDbridge: `UIIcon.Assault_Area_01_Perk_1` names the part `assault_area_01_perk1` in `perks_icons.inkatlas`, and that atlas (376 parts) has no such part, while `assault_area_01_perk2` and `assault_area_02_perk1` are there: a record left from the perks before 2.0, likely. So some `UIIcon` records point at parts that no longer exist, and an image shows nothing for them. Ink styles 0.1.1 uses `UIIcon.Assault_Area_01_Perk_2` instead. A later build could warn about a missing part (unverified how to ask the atlas at run time).

The I2a fix for timeouts showed twice in the Mod log as one quiet line ("the game did not answer (closing or loading?)"), at the first start before a save and at quit, instead of errors.

## I2c: plan

The I2 plan gave I2c three things: bindings (game values the plugin reads each frame), trees from data, and text in the player's language. Proposed: **I2c is the data, and the language becomes I2d.** The language is most of the [Localization](localization.md) plan's L1 (the game's language in the plugin, `t()` with package locale files, plurals, V's gender forms), which serves the whole of REDnode, not only ink, and has its own unknowns (how the plugin reads the game's language). Kept apart, each test stays small.

### Bindings: game values with no round trip

A node names a game value; the plugin reads it each frame and changes the widget only when the shown result changes. Node is not involved, so a health bar follows every hit.

```js
ink.text('', { style: 'value', bind: 'player.health', format: '{value} HP' });
ink.bar({ bind: 'player.health', of: 'player.healthMax', width: 300, height: 8, tone: 'normal' });
```

| Source | What | How the plugin reads it (as the Vitals sample does through `api`) |
|---|---|---|
| `player.health`, `player.healthMax` | Health points now and at most | `StatPoolsSystem.GetStatPoolValue(V's stats id, Health, false)`, and its max (unverified which call) |
| `player.stamina`, `player.memory` | Stamina and RAM, from 0 to 100 | `GetStatPoolValue(…, Stamina / Memory, true)` |
| `player.money` | Eddies | `TransactionSystem.GetItemQuantity(V, MarketSystem.Money())` |
| `player.level`, `player.streetCred` | Levels | `StatsSystem.GetStatValue(V's stats id, Level / StreetCred)` |
| `player.x`, `player.y`, `player.z` | V's position | The plugin's own `player.position` |
| `game.hour`, `game.minute` | The game's clock | `TimeSystem.GetGameTime` (unverified which getter) |

| Target | Prop | What the plugin does |
|---|---|---|
| A text | `bind`, with `format` (`{value}`) and `decimals` (0 by default) | Sets the text when the formatted string changes |
| A bar | `ink.bar({ bind, of })`: a new tag, a track and a fill | Scales the fill from 0 to 1 (`value / of`; `of` a number or a source), from its left edge, so the layout does not move |

Each source is read at most once a frame, and only while a node binds it. The cost per source is a few game calls on the game thread (measured in the test; the perf line shows it). A mod can still `set` a text at its own rate, as Ink Coords does; bindings are for values that change often.

### Trees from data

```js
const board = ink.list({ gap: 6 }, contracts, (c) => ink.row({ gap: 12 },
  ink.text(c.name, { style: 'body' }), ink.text(`${c.reward} €$`, { style: 'value' })), (c) => c.id);
board.set({ items: nextContracts }); // only what changed goes to the game
```

| Piece | What |
|---|---|
| `ink.list(props, items, render, key)` | A column (or `direction: "row"`) of one rendered node per item, keyed by `key(item)` |
| `list.set({ items })` | A keyed diff: new keys are added at their place, gone keys removed, moved keys moved, and kept keys rendered again and **patched**: the new node is compared with the old one, same tag and shape, and only changed props are sent; a different shape is replaced |
| `mount.update(...children)` | The same patch for a whole mount's tree, for a mod that rebuilds its tree from data each time |

In the plugin: `add` takes an `index` (ink's `ReorderChild` after `AddChild`), a new `move` op, and each node keeps its children in order, so a rebuild after a load puts them back in the same order.

### Samples and test

| Sample | What it shows |
|---|---|
| **Ink vitals** | Health, RAM and money on the HUD, bound: a health bar and numbers that follow every hit with no update code in the mod |
| **Ink list** (a test app) | A list of contracts from data, with buttons to add, remove, move and rename them, and to rebuild it whole with `mount.update` |

The test: take damage and watch the bar and the numbers; spend money; let the RAM refill after a quickhack; add, remove, move and rename list items, and check that only those change (the plugin log counts the ops); a save load puts both back in order; the plugin's perf line with several bindings on.

### I2d: language (after I2c)

The game's language in the plugin and a change event; `LocKey#` and secondary keys in ink texts (`SetLocalizedText`, so the engine follows a language change by itself) and in the `ui` builder; `t()` with a package's `locales/<language>.json`, `{name}` parameters, plurals (`Intl.PluralRules`) and V's gender forms; missing keys logged once. That is L1's core and L3 of the Localization plan; the UI kit's `data-t`, manifest names, `fmt` and REDnode's own text (L1's rest and L2) stay in the Localization plan's order.

## I2c: build (REDnode 0.30.0)

Agreed with the owner on 2026-10-22, as planned, with the language split off as I2d.

| Part | Where |
|---|---|
| Bindings: a node's `binding` prop names a source; each frame the plugin reads the sources some node binds (each at most once a frame, from game objects found again every 2 s or after a load), and changes a text or a fill's scale only when what shows changes. A perf line every 1800 frames: bindings, sources and microseconds a frame | `native/src/overlay/ink.cpp` (`UpdateBindings`, `Source`) |
| `CallNativeValue`: the plain-value side of `CallNative`, so the driver chains game calls (V's entity id to its stats id) | `native/src/overlay/reflect.cpp` |
| Children in order: each node keeps its children's order, `add` takes an `index` (ink's `ReorderChild` after `AddChild`), a new `move` op, and a rebuild after a load puts them back in order. A batch that adds, removes or moves widgets is logged with its counts | `native/src/overlay/ink.cpp` |
| `bind`, `format`, `decimals` on texts; `ink.bar({ bind, of, value, track })`; `ink.list(props, render, key)` with `set({ items })`; `mount.update(...)`; patching: the same tag keeps its widget and sends only changed props, children matched by place or by key | `packages/rednode/src/ink.ts` |
| A panel's children always send their margin, so a child that becomes the first loses its gap | `packages/rednode/src/ink.ts` |
| The docs previews run the package's real ink module, compiled by the examples build into `docs/examples/sdk`, and the page draws the plugin's props; bindings read the simulated game | `tools/examples/build.mjs`, `docs/assets/examples/sim/` |
| Samples: **Ink vitals** 0.1.0 (health and RAM bars, money, all bound) and **Ink list** 0.1.0 (the test of lists and `mount.update`) | `packages/overlay/apps/ink-vitals`, `ink-list` |

Checked: the plugin builds and its tests pass; the package builds; the built ink module, driven with a stand-in transport, sends one `add` with an `index` for an item added at the top, one `remove`, one `move`, one `set` for a rename, only the new text for a grown tree, and margins fixed after a removal and a reversal; in the mock game Ink list's buttons sent only their changes; the docs previews of Ink vitals (bound values and bars from the simulated game) and Ink Coords draw. Not checked in the game: every source (which calls answer, and with what), the bars' scale from the left edge, `ReorderChild`, and the bindings' cost a frame.

## I2c test

On the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.30.0 (update zip over 0.29.0), with Codeware.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Switch on **Ink vitals** (Ink Coords may stay on; Ink styles off). Load a save. At the bottom left: "VITALS", an HP bar with its number, a RAM bar with a percentage, and your money? Do the numbers match the game's own HUD? **Mark**.
2. Take some damage (a fall, or a fight): do the HP bar and number drop at once and climb back as health returns? **Mark**.
3. Use a quickhack, then wait: does the RAM bar drop and refill? Buy or sell something: does the money change? **Mark**.
4. Switch on **Ink list**, open the overlay and press **Show**. Close the overlay: "CONTRACTS" and "3 contracts" at the left, and three contracts under them (#1 Watson, #2 Kabuki, #3 Japantown, each with a reward)? **Mark**.
5. Open the overlay and press, looking at the list after each: **Add** (a 4th at the bottom), **Add at top** (a new first), **Remove first**, **Last to top**, **Rename second** ("prime"), **Shuffle** (the order reversed). Does each show as its log line says, with even gaps? **Mark**.
6. Press **Update header** three times: does the title change (Open gigs, Fixer board, Contracts)? **Mark**.
7. Load the same save again and wait a few seconds: are the vitals and the list back, the list in its last order? **Mark**.
8. Quit. Send `rednode-mods.log` and this run's `red4ext/logs/rednode-*.log` (its `Ink:` lines: each list change's counts, and the bindings' cost a frame).

## I2c test: first run (0.30.0)

2026-10-22 at 19:54 to 20:06, on the laptop, REDnode 0.30.0, with Codeware.

| Step | Result |
|---|---|
| 1 to 3, Ink vitals | **Passed**: the HP and RAM bars and numbers and the money showed and followed damage, a quickhack's RAM and a purchase |
| 4, Ink list shown | Passed: "16 add" in one batch |
| 5, list changes | **Failed** except **Add**: Add at top added at the bottom, Last to top and Shuffle did not move anything, and the screen no longer matched the list |
| 6, Update header | Passed |
| 7, a save load | Passed, and the list showed **in the right order**: the plugin's own order was right all along |

**Why:** every op that needed a place failed in the plugin log with "k56: argument 2 (newIndex, Int32): Int32 needs a whole number". The driver's number helper wrote the index as text, `"0.000000"`, and the plugin's Int32 conversion reads the text (to keep 64-bit values exact), so `ReorderChild` never ran. Adds at the end and removes need no place, so they worked; the rebuild after the load adds the children in the plugin's order, so it was right.

**The bindings' cost:** 5 bindings over 4 sources, about 0.25 to 0.37 ms a frame (one first reading of 21 ms covered the first frames after the load, when the game objects are found). Most of a read was finding the game function by name each time.

**Fixed in REDnode 0.30.1:** whole numbers are written whole (`ReorderChild` takes the index); the functions the driver calls are found once and remembered (`FindNative` in reflect.cpp), for every native call, bindings included.

## I2c retest

On the laptop, REDnode 0.30.1 (update zip over 0.30.0), with Codeware; Ink vitals and Ink list on.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Load a save. Ink vitals at the bottom left as before? Take a little damage: do the bar and number follow? **Mark**.
2. Open the overlay, press **Show** in the Ink list window, close the overlay: three contracts? **Mark**.
3. Open the overlay and press, looking at the list after each: **Add at top** (a new first), **Last to top**, **Remove first**, **Rename second**, **Shuffle** (the order reversed), **Add** (a new last). Does each match its log line, with even gaps? **Mark**.
4. Load the same save again: the list back in its last order? **Mark**.
5. Quit. Send `rednode-mods.log` and this run's `red4ext/logs/rednode-*.log` (no "Int32" errors now, and the bindings' cost a frame).

## I2c retest: results

2026-10-22 at 20:15 to 20:23, on the laptop, REDnode 0.30.1, with Codeware. **Passed**: every step, no errors in the plugin log, and the game quit cleanly.

| Change | The plugin log | On screen |
|---|---|---|
| Show | 16 add (two mounts) | Three contracts and the header |
| Add at top | 4 add, 1 set (the old first's gap) | A new first |
| Last to top | 1 move, 2 set (the gaps of the two that changed place) | The last on top |
| Remove first | 1 remove, 1 set | The first gone, the new first without a gap |
| Shuffle (reverse) | 2 move, 2 set | The order reversed |
| Add | 4 add | A new last |
| A save load | 17 of 17 and 3 of 3 widgets built | The list in its last order |

**The bindings' cost** with the remembered functions: 5 bindings over 4 sources, **0.13 to 0.17 ms a frame**, against 0.25 to 0.37 ms on 0.30.0. The first reading after each load (14.6 ms) covers the first frames, when the driver finds V and the game systems again: one short hitch at a load, not a cost each frame. A later build could find them before the first bound frame.

I2c is done. Next in the plan: I2d, the language (L1's core and L3 of the [Localization](localization.md) plan).

## I2d: plan

Text in the player's language, for ink first and for Node mods in general: the core of the [Localization](localization.md) plan's L1, and its L3 (ink).

### What the game gives

Read from the game's scripts and the API dump:

| Piece | What it is |
|---|---|
| The language | A setting: group `/language`, `OnScreen` (the interface; also `VoiceOver` and `Subtitles`), a `ConfigVarListName` whose value is the game's own name, such as `en-us`, `fr-fr`, `ar-ar`. The settings screen reads it this way (`settingsMain.swift`), and so can REDnode, as it reads `/audio/volume` |
| A change | The settings screen's own widgets get `inkLocalizationChangedEvent` when the language changes. Whether the change applies at once or after a restart is unverified. The Language group shows only before a save is loaded (the settings screen passes `IsPreGame` when it lists its groups; the pause menu's Settings has none, seen in the I2d test): the language cannot change during play |
| The game's text | `"LocKey#12345"` and secondary keys (`"UI-…"`). A text widget shows one in the player's language with `SetLocalizedText`, and the engine follows a language change by itself (unverified) |

### What I2d builds

| Piece | What |
|---|---|
| The language in the plugin | Reads `/language` `OnScreen` at each save load and every 2 s, and sends a `language` event when it changes. No Codeware needed |
| `game.language()` and `game.on("language")` | In the `rednode` package, for Node mods and pages: the game's name (`fr-fr`) and its standard tag (`fr-FR`) for `Intl` |
| Game keys in ink | A text whose text is `"LocKey#…"` or `"UI-…"` (or `key: "…"`) goes through `SetLocalizedText`, so the game draws its own translation |
| `t(key, params)` | The package's own text from `locales/<language>.json` in its folder: `{name}` parameters; plurals by `count` with the language's categories (`one`, `few`, `many`, `other`, from `Intl.PluralRules`); `m` and `f` forms by V's gender (body or voice: unverified, the test checks). A missing key falls back to the same language's other region (`es-mx` to `es-es`), then English, then the key itself, and is logged once per key and language |
| Live in ink | `t()` gives a text that remembers its key: an ink node showing one is sent again in the new language when the language changes. Game keys need nothing, the engine does it |
| Elsewhere | `t()` works as a plain string in the `ui` builder and in code; following a change there (and the UI kit's `data-t`, `fmt`, manifest names, REDnode's own text) stays in the Localization plan's L1 rest and L2 |

### Sample and test

**Ink language** (a test app): an ink panel with a game key (the game's own word for a menu, found with REDbridge's `loc.search`), a `t()` text with a parameter, a plural in three counts, a gendered line, and a key the package lacks; with `locales/en-us.json` and `locales/fr-fr.json`. The test: English first; switch the game to French in its settings (and back) and see which texts follow at once; the Mod log lists the missing key once; `game.language()` in the window.

Open, for the test to settle: whether the language changes live, and which gender the game's own gendered text follows.

## I2d: build (REDnode 0.31.0)

Agreed with the owner on 2026-10-22, as planned. The owner's reminder the same day: never start the game on the dev PC, which would update it to 2.5 (a 2.31 backup is kept); every in-game test runs on the laptop.

| Part | Where |
|---|---|
| The language: the plugin reads `/language` `OnScreen` through the settings system at the start and every 120 frames, and sends a game event `language` (with `language`) when it changes, the first reading included; the bridge method `game.language` answers the current one | `native/src/overlay/ink.cpp` (`ReadLanguage`, `UpdateLanguage`) |
| Game keys in ink: `locKey`, set with `SetLocalizedText` | `native/src/overlay/ink.cpp` |
| `t(key, params)`, `LocalText`, `languageTag`; locale files read from a Node mod's folder or beside a page; the fallback chain (the player's language, its other regions, English, the key) with one log line per missing key; plurals with `Intl.PluralRules`; `m`/`f` forms by V's body gender (`GetResolvedGenderName`; whether the game's gendered text follows the body or the voice is unverified) | `packages/rednode/src/i18n.ts` |
| `game.language()`, the `language` field on game events | `packages/rednode/src/game.ts` |
| Ink texts take `"LocKey#…"` or `key: "UI-…"` (the game's text) and `t()`'s texts, sent again when the language or the loaded text changes | `packages/rednode/src/ink.ts` |
| The docs previews compile and use `i18n` too; game keys show their English word | `tools/examples/build.mjs`, `docs/assets/examples/sim/` |
| **Ink language** 0.1.0, the test, with `locales/en-us.json` and `locales/fr-fr.json` | `packages/overlay/apps/ink-language` |

The game's text key for "Inventory", found with REDbridge's `loc.search`: `LocKey#15396`, secondary key `UI-ResourceExports-Inventory`. Each game text has a female and a male form in its files.

Checked: the plugin builds and its tests pass; the package builds; the built modules with a stand-in transport answering `fr-fr`: French text, plurals 1 and 5, the female form, the English fallback and the key fallback each logged once, game keys passed through as `locKey`, and a switch to English sending only the `t()` text again; in the mock game the real host read the package's `locales` folder; the docs preview shows the English panel. Not checked in the game: the language read and its event, `SetLocalizedText` and its following a change, V's gender.

## I2d test

On the laptop, REDnode 0.31.0 (update zip over 0.30.1), with Codeware; the game in English to start.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Switch on **Ink language** (others may stay on). Load a save. At the left: "LANGUAGE TEST", a line `en-us (en-US) 1,234,567.89`, "The game's own word, by key: Inventory", "Inventory", "Reward: 500 €$", "1 contract found", "2 contracts found", "5 contracts found", a thanks line, and two small lines (the last reads "nowhere")? Does the thanks line match V's body (mister or miss)? **Mark**.
2. The Language settings are not in the pause menu's Settings (found in this test: the settings screen shows some groups only before a save is loaded, `IsPreGame`). Quit to the main menu, open **Settings**, **Language**, and set the on-screen language to French (Français); apply. If the game asks for a restart, restart it. If the main menu has no Language settings either, set the game's language in Steam instead (the game's Properties, General, Language), which needs a restart. Then load the save. Is the panel in French? Did both "Inventory" lines turn into French? Does the Ink language window's log show "The language changed to fr-fr" (only when no restart was needed)? **Mark**.
3. With French on: "Récompense : 500 €$", "1 contrat trouvé", "5 contrats trouvés", "Merci, monsieur." or "madame.", the number written `1 234 567,89`; the line French lacks still in English? **Mark**.
4. Set the language back to English, as in step 2, and load the save. Does everything come back to English? **Mark**.
5. Quit. Send `rednode-mods.log` and this run's `red4ext/logs/rednode-*.log` (its "Ink: the game's language is …" lines).

## I2d test: results

2026-10-22 at 21:21 to 21:31, on the laptop, REDnode 0.31.0, with Codeware. **Passed**: every step, and the game quit cleanly.

| Step | Result |
|---|---|
| 1, English | The panel as expected: the game's word "Inventory" by `LocKey#` and by secondary key, the package's text, plurals 1, 2 and 5, and "Thanks, miss." for the owner's V (the body gender read works). The key no file has was logged once |
| 2, French | The Language settings are only at the main menu (as found before the run). The change applied **with no restart**: the plugin saw it within a second ("the game's language is fr-fr"), and loading the save rebuilt the panels in French, the game's keys included |
| 3, French text | The package's French text, plurals, gender and number format; the key French lacks in English, logged once |
| 4, back to English | Everything back in English |

Found, for a later build:

| What | Fix |
|---|---|
| Moving through the language selector counted as changes: the plugin reported `es-es` on the way from English to French, 0.6 s apart, and the package logged six missing keys for a language the player never chose | Report a new language only once it has read the same twice |
| On a change, the mod's own handler ran before the new file was read, so its log line used the old text (the panel was right: ink sends `t()`'s texts again once the file is read) | `game.language()` waits for the file of the language it answers |

The bindings cost 0.10 to 0.19 ms a frame in this run (5 bindings, 4 sources).

**Phase I2 is done:** the driver (I2a), layout and the game look (I2b), bound values and lists from data (I2c), and the language (I2d). Next in the design's order: I3 Input (buttons, sliders, lists and text input in menus, with the game's cursor), I4 the game look's ready pieces, I5 Screens, I6 frame drawing. The order with the other work (H2c with EDGEbuilder, the Sound API's S2, a release) is to agree with the owner.

## UI Tools: plan

Asked for by the owner on 2026-10-29: carry native UI on to where modders build ink widgets and screens from REDnode's own HTML-style tags, plus a **UI Workbench** app to inspect the game's UI, write ink, run it live and save it. Everything below is *proposed*, to agree with the owner.

**UI Tools** is an optional app pack, like Sound Tools and Admin Tools. Its source lives in this repo in `packs/ui-tools/`, outside the REDnode build, with its own zip, version, changelog and Nexus page, and it installs into `red4ext/plugins/REDnode/apps/`. The **UI Workbench** is its first app, and more can join it. What the apps need from the game (reading trees, picking, the markup) goes into REDnode itself, so any mod can use it.

### What the owner asked for

| # | Ask | Proposal |
|---|---|---|
| 1 | Click on the game's UI elements, visible or not, and get their information and their tree, like RED Hot Tools' Ink Inspector | An **Inspect** tab: a tree of every ink layer, and a **Pick** mode that selects the widget under the cursor. Invisible widgets are picked from the tree, since they cannot be clicked |
| 2 | Maybe edit what is picked | A few properties of a game widget, tried live and not kept: visible, opacity, color, text, size, margin. That is enough to find what controls a look; anything more belongs in the modder's own copy |
| 3 | Turn what was clicked into REDnode source, in the editor | **To source** on any picked widget or subtree: the [Dump source](#dump-source-idea-2026-10-22) generator writes it as REDnode tags into the editor |
| 4 | Write tags or code directly, and **Run** them live on screen | An **Edit** tab: a markup pane and a script pane, with Run, Stop, and run again on save |
| 5 | Write the callbacks in REDnode JavaScript | The script pane is a module. The markup names its functions: `<button label="Track" onclick="track" />` calls `export function track()` |
| 6 | Save as a project, and export the source for a mod | Each project is a REDnode package in a folder of its own (below). **Export** writes its files, or a zip, ready to drop into a mod |
| 7 | Screens too | Once I5 builds screens, a project can be a screen, and Run opens it |

### The markup: REDnode's tags as HTML

The design already gives one tree format, written three ways: JSX in `.tsx`, a tagged template, or the functions. The workbench needs a fourth that is a plain file: **ink markup**, an `.ink.html` file with the same tags, and their properties as attributes.

```html
<!-- bounty.ink.html -->
<mount layer="hud" anchor="top-right" x="-40" y="120">
  <column gap="6">
    <text style="title">Bounty board</text>
    <text bind="player.health" style="value" />
    <list items="contracts" key="id">
      <text style="body">{name}</text>
    </list>
  </column>
</mount>
```

```js
// mod.mjs
import { ink } from 'rednode';
import * as handlers from './bounty.mjs';

const board = await ink.load('bounty.ink.html', handlers, { contracts: [] });
board.set({ contracts: await fetchContracts() });
```

| Piece | Proposal |
|---|---|
| `ink.parse(source, handlers?, data?)` and `ink.load(file, …)` | In the `rednode` package. They give the same nodes as the functions, so `set`, `update` and lists work the same. No new driver in the plugin |
| Tags and attributes | I2's tag table and props, by the same names. A number, color or style word is written as text. Unknown tags and attributes are refused with their line and column |
| Events | `on<event>="name"` names an export of the handlers module. No code goes inside the markup, so the markup stays data that a tool can read and write |
| Data | `{name}` inside a list item, and named data the mod passes in. Nothing more: no expressions |
| Where it is used | Mods, the workbench, To source's output, and the docs simulation's previews |

### UI Workbench

A tool window with three tabs. It has the `admin` permission, like the Admin Tools, and the root flag that keeps tool windows above other packages.

| Tab | What |
|---|---|
| **Inspect** | Layers and their trees, live. In Pick mode the overlay lets the mouse through, and the widget under the cursor is outlined and selected. For the selected widget: class, name, path, size and place on screen, visibility, every property, its controllers, the library item it was spawned from, and its bindings. Buttons for **To source** and **Try** (the few live edits) |
| **Edit** | Markup and script panes in a code editor (CodeMirror 6, MIT, with completion from the tag table and the generated types), with errors shown in place. Also a plain preview drawn in the window, like the docs simulation's, for work with no game running. **Run** mounts the tree in the game; **Stop** removes it |
| **Projects** | New, open, rename, duplicate, delete. **Export** to a folder or a zip |

**A project is a package.** Each project is a folder with a `rednode-app.json`, its `.ink.html` and its script, kept in a development folder (from Developer mode) or the apps folder. Run starts that package, and saving restarts it through REDnode's own hot reload. So the modder's code runs as it will in their mod: in its own Node mod, with its own permissions and its own cleanup, and a crash in it does not touch the workbench. Export is then nothing more than copying its files.

### What REDnode gains for it

| Part | Where |
|---|---|
| `ink.parse` and `ink.load` | `packages/rednode/src/ink.ts` |
| **Reading a tree in one call**: a layer's or a widget's tree with its geometry, properties, controllers and spawn info. I1 read 4138 widgets in 2 s through `api`, one call at a time | The plugin's ink driver, `ink.read` |
| **Layers**: every ink layer and its windows | The plugin, `ink.layers` |
| **Pick**: the widgets under a point on screen, each with its drawn box | The plugin, `ink.at(x, y)`. The overlay lets the mouse through while the workbench picks |
| **Spawn info**: the library and item a widget came from | The plugin. To source then writes a `library` tag instead of spelling out the widgets |
| **Outline**: a box drawn around a widget, over the game | The overlay, from the drawn box |
| **Try**: setting a property on a widget REDnode did not make | The plugin, only for packages with the `admin` permission, never kept |

**How RED Hot Tools does it.** RED Hot Tools is MIT-licensed: we read it for REDswap, and may port from it with its licence kept, as REDswap does. Its native code collects the layers, the widgets under the pointer and a widget's spawn info. It gets a widget's drawn box from its draw context (`inkDrawArea::GetBoundingRect`, a raw game address), and draws its window with CET. REDnode would port the collection and draw the window in the overlay. The raw addresses are game-version specific, so each needs a hash or a byte pattern for 2.5, as REDswap's archive loader did (*unverified*).

### Phases

| Phase | What | Needs | Test |
|---|---|---|---|
| **UT1 Ink markup** | `ink.parse`, `ink.load`, events by export name, list data, errors with line and column. The I2 samples rewritten in markup; the docs simulation previews markup | I2 (done) | A HUD panel and a list from markup, in game |
| **UT2 Read and pick** | `ink.layers`, `ink.read` in one call, `ink.at`, spawn info, the outline. The Inspect tab with the tree and Pick | UT1, for To source | Pick widgets on the HUD and in menus, open invisible ones from the tree, time a read of the perks screen |
| **UT3 Workbench** | The Edit and Projects tabs, Run and Stop, To source into the editor, Try, Export. The pack's zip and docs page. The first release of UI Tools comes after this | UT1, UT2 | Pick a game panel, To source, change it, Run it, save it, export it, and run the export from a mod of its own |
| **I3 Input** (the design's phase) | Buttons, sliders, lists, toggles and text input on the `menu` layer, with the game's cursor. Clicks reach the markup's handlers | | |
| **UT4 Interactive** | Projects on the `menu` layer with working callbacks. The workbench's Run opens the menu they mount on | I3 | |
| **I4 Game look**, **I5 Screens** (the design's phases) | The game's library items and composites; new screens | | |
| **UT5 Screens** | A project can be a screen: Run opens it, Back closes it. To source on a whole game screen gives the modder a screen to start from | I4, I5 | |

### Open questions

| Question | Recommendation |
|---|---|
| Where UI Tools goes in the order, after the in-game tests now waiting (#17, #20, H3b) | UT1 right after those tests, then UT2 and UT3, then I3 and UT4. S2 Space, and H2c's refresh after a swap, stay where they are |
| The file extension | `.ink.html`, so editors colour it as HTML |
| `column` and `row`, or the design's `vbox` and `hbox`, in the docs | `column` and `row`, which the samples already use. `vbox` and `hbox` work too |
| Is Try on game widgets worth having? | Yes, but only the few properties above, and only for `admin` packages |
| The code editor: CodeMirror 6 or Monaco | CodeMirror 6: it is smaller, and it should work in an offscreen window. Monaco's workers there are unverified |

