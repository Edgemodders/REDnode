# Native game UI (ink)

Status: **I1 spike planned on 2026-10-22**, awaiting the owner's agreement. The design, the tags and the phases I1 to I6 are in the design doc, [section 06](design.html#ink). Order agreed with the owner on 2026-10-21: H2 `world.refresh`, then this API from I1, then the Sound API's S2. H2 stopped after H2b on 2026-10-22; H2c (NPCs, props, with EDGEbuilder) comes after this API.

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
| 9 | **A menu entry for new screens** | Read only first: find the loaded menu resource (`inkMenuResource`) and list its entries. Adding the `rednode_screen` entry is tried only if reading works; otherwise it moves to the start of I5 |

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
| Clean up | Removes every widget the app added |

### After I1

The results decide, for I2:

| Decision | Options |
|---|---|
| The HUD root | REDnode's own hook (base game only), Codeware's layers (`requires` Codeware for `ink`), or both with the hook as the fallback |
| Batching | Changes per frame and the budget, from the speed numbers |
| Rebuild | What the driver must rebuild, and when, from the lifetime answers |
| Cursor | Interactive ink only in menus for I3, or more (the open question in the design) |
| Screens | Whether the menu entry can be added in memory, or needs an archive |

The in-game test steps are written when the build is ready.
