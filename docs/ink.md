# Native game UI (ink)

Status: **I1 spike built on 2026-10-22**. Its first run (0.27.0) crashed at step 5 ([results](#i1-test-first-run-0270)); REDnode 0.27.1 fixes the cause and awaits the retest ([I1 test](#i1-test)). The design, the tags and the phases I1 to I6 are in the design doc, [section 06](design.html#ink). Order agreed with the owner on 2026-10-21: H2 `world.refresh`, then this API from I1, then the Sound API's S2. H2 stopped after H2b on 2026-10-22; H2c (NPCs, props, with EDGEbuilder) comes after this API.

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

On the laptop, `Cyberpunk 2077 - Copy`, REDnode 0.27.1 (update zip over 0.27.0 or 0.26.21), with Codeware. Each button writes its answer to the Ink test's window and the Mod log.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Type what you saw into its note before each **Mark**.
1. Switch on **Ink test** in the launcher (it asks for the bridge permission: allow it). Load a save. **F10**, press **Roots**. **Mark**.
2. Press **HUD text**. Close the overlay (**F10**): is a dark box with "REDnode ink" on screen, and where? **Mark**.
3. Open the overlay, type `cw.inkHUDLayer` in the root field, press **HUD text** again. Close the overlay: where is the second one? **Mark**.
4. Open the overlay, press **Speed**, then **Check**. **Mark**.
5. Press **Esc** for the pause menu. Open the overlay, type `menu.pause` in the root field, press **Roots**, then **Menu button**. Close the overlay: is a red "Ink button" in the pause menu? Hover it and click it with the game's cursor. **Mark**.
6. Leave the pause menu. Open the overlay, press **Check**: what still exists? **Mark**.
7. Type `new_perks` in the screen field and press **Open screen**: does the perks screen open? **Mark**.
8. With the perks screen open, open the overlay, type `menu.hub` in the root field and press **Read screen**. **Mark**.
9. Press **Menu entries**. **Mark**.
10. Leave the perks screen. Load the same save again (a save load), then open the overlay and press **Check**, then **Roots**. **Mark**.
11. Press **Clean up**. Quit. Send `rednode-mods.log`, and the dump file Read screen named (in the app's data folder; it stays on your PC, it is game data).

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

