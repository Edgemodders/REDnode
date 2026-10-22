# Native game UI (ink)

Status: **I1 passed in game on 2026-10-22** (REDnode 0.27.2, [third run](#i1-test-third-run-0272)), after a crash in the first run (0.27.0) and one at quit in the second (0.27.1), both REDnode bugs, fixed. What it means for I2: [I1: what it decides](#i1-what-it-decides). I2's plan is next, to agree with the owner. The design, the tags and the phases I1 to I6 are in the design doc, [section 06](design.html#ink). Order agreed with the owner on 2026-10-21: H2 `world.refresh`, then this API from I1, then the Sound API's S2. H2 stopped after H2b on 2026-10-22; H2c (NPCs, props, with EDGEbuilder) comes after this API.

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

