# UI Tools

**REDnode UI Tools** is an optional app pack for UI modders: read the game's own interface, the ink widgets the engine draws, and build native UI of your own. It is its own download on [Nexus Mods](https://www.nexusmods.com/cyberpunk2077/mods/36958) and the GitHub release, beside REDnode, and its source lives in this repo at [`packs/ui-tools/`](https://github.com/Edgemodders/REDnode/tree/main/packs/ui-tools).

> **Not released yet.** The pack's first release comes with the UI Workbench's editor (phase UT3, in [Native game UI](ink.md#ui-tools-plan)). The Inspect tab below passed in game on 2026-11-02 (REDnode 0.53.7).

| App | What it does |
|---|---|
| [UI Workbench](#ui-workbench) | **Inspect:** the game's ink layers and HUD pieces as a tree, Pick under the cursor, a widget's details and properties. **Edit** (coming with UT3): ink markup and a script, run live in the game, saved as projects and exported |

More UI apps can join the pack later.

## Install

| Needs | Why |
|---|---|
| REDnode 0.53.7 or later ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/35419), [GitHub](https://github.com/Edgemodders/REDnode/releases/latest)) | The reads the Workbench uses (`ink.layers`, `ink.read`, `ink.inspect`, `ink.at`, `ink.boxes`) and their fixes from the Inspect tab's tests |
| [Codeware](https://www.nexusmods.com/cyberpunk2077/mods/7780) 1.16 or later | The game's ink layers reach REDnode through it |
| Game version 2.5 | As REDnode |

1. Install the zip with Vortex, or extract it into the game folder: the app lands in `red4ext/plugins/REDnode/apps/ui-workbench`.
2. In the game, press **F10** and open the **Mod Manager** from the launcher. Switch **UI Workbench** on. It asks for no permission: everything it does reads the game's UI.

To uninstall, remove it in your mod manager or delete that folder. REDnode stays.

## UI Workbench

The Workbench covers the game view (a page with `"fill": "screen"`) and is see-through, so the game takes the mouse wherever it draws nothing. Its window moves inside the page.

### The tree

Every ink layer the game has, in its order, with its window: the HUD, the menus, notifications and the rest. Open a row to read its children, a level at a time. The HUD layer lists its **HUD entries**, each piece of the HUD (the health bar, the minimap, the quest tracker...) with its game controller; a piece the game has not spawned yet (a boss health bar, a car's HUD) says **not spawned**, and selecting it shows what the game knows of it.

The **filter** at the top of the tree keeps the rows whose name, class, controller or text matches, with the rows above them open; it searches what has been read so far.

### Pick

Press **Pick** and point at the HUD or a menu. The widget under the cursor is outlined and named in a tip beside it as you move; click to pick it. The tree opens down to the picked widget and selects its row, and **Under the cursor** lists everything there.

| What Pick offers | Why |
|---|---|
| Only widgets the game draws on the screen | A widget whose opacity, with its parents', comes to 0 is left out with its children, and so are the layers drawn onto surfaces in the world (signs, adverts, screens) |
| The smallest box first, then the deepest | The most particular widget under the cursor, not a full-screen container |

Two ways to reach a widget under others:

| How | What |
|---|---|
| **Right-click** while picking | Sets the widget under the cursor aside until the pick ends, so the one beneath it shows. Right-click again for the next |
| **Pick inside** | With a widget selected, pick only among its children and theirs |

Esc leaves Pick.

### Details

The selected widget's class and its parents' classes, path, box on screen, visibility, text, controllers, its layer and HUD entry, the `.inkwidget` file it was spawned from (as a path hash), and every property, with a filter. Each part folds, and stays as you left it. **Path** and **JSON** copy it; **Read all** reads every widget under it in one call and says how long it took; **Parent** selects its parent.

## For mod makers

Everything the Workbench reads is in the `rednode` package, for your own mods and apps ([Native game UI](ink.md), and the [API reference](api/)):

| Call | What it gives |
|---|---|
| `ink.layers()` | The game's layers and the HUD's entries |
| `ink.read(from, { depth, max })` | A tree of widgets in one call: class, name, visibility, box, controller, text |
| `ink.inspect(id)` | One widget in full, with its parents and every property, and an `api` reference to it |
| `ink.at(x, y)` | The drawn widgets under a point, smallest first |
| `ink.boxes()` | Every drawn widget's box in one call, to find what is under the cursor on each move |

```ts
import { ink } from "rednode";

const { hits } = await ink.at(200, 900);
const w = await ink.inspect(hits[0].id);
console.log(w.path, w.controllers, w.properties.opacity);
```

Native UI of your own is written with `ink.load` and `ink.parse` in [ink markup](ink.md#ut1-build-rednode-0510), or with the `ink` functions.
