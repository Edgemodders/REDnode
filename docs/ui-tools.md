# UI Tools

**REDnode UI Tools** is an optional app pack for UI modders: read the game's own interface, the ink widgets the engine draws, and build native UI of your own. It is its own download on [Nexus Mods](https://www.nexusmods.com/cyberpunk2077/mods/36958) and the GitHub release, beside REDnode, and its source lives in this repo at [`packs/ui-tools/`](https://github.com/Edgemodders/REDnode/tree/main/packs/ui-tools).

> **Released:** UI Tools 0.1.0, on 2026-11-03, with REDnode 0.56.1. Every part below passed in game (phases UT1 to UT3, in [Native game UI](ink.md#ui-tools-plan)). The EDGEmodders wiki has a user's manual with walkthroughs: [edgemodders.ai/wiki](https://edgemodders.ai/wiki/).

| App | What it does |
|---|---|
| [UI Workbench](#ui-workbench) | **Inspect:** the game's ink layers and HUD pieces as a tree, Pick under the cursor, a widget's details and properties. **Try:** change a game widget live, put back with Reset. **To source:** copy a game widget into a project as ink markup. **Edit** and **Projects:** ink markup and a script, run live in the game, saved as projects and exported as mods |

More UI apps can join the pack later.

## Install

| Needs | Why |
|---|---|
| REDnode 0.56.0 or later ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/35419), [GitHub](https://github.com/Edgemodders/REDnode/releases/latest)) | The reads the Workbench uses (`ink.layers`, `ink.read` with props, `ink.inspect`, `ink.at`, `ink.boxes`), `ink.try` and `ink.reset`, and the host's projects folder |
| [Codeware](https://www.nexusmods.com/cyberpunk2077/mods/7780) 1.16 or later | The game's ink layers reach REDnode through it |
| Game version 2.5 | As REDnode |

1. Install the zip with Vortex, or extract it into the game folder: the app lands in `red4ext/plugins/REDnode/apps/ui-workbench`.
2. In the game, press **F10** and open the **Mod Manager** from the launcher. Switch **UI Workbench** on.
3. Inspect works at once. **Try**, **To source**, **Edit** and **Projects** need the Workbench's `admin` permission, because they start and stop your projects and change the game's widgets: allow it in the Mod Manager's details for UI Workbench, under Permissions. Without it, those parts say so.

## Quick start

A first native panel in five minutes, from a save in the game with the overlay open (F10):

1. **Look at the game's own UI.** In **Inspect**, press **Pick** and point at the quest tracker at the right of the HUD: the widget under the cursor is outlined and named. Click it, and the tree opens down to it with its details beside. Esc leaves Pick.
2. **Try a change.** In the details, open **Try**, type a new text in **text** and press Enter: the game's own tracker shows it. Drag **opacity** down and up. Press **Reset**: it is back as it was.
3. **Copy it.** Press **Parent** until the box covers the whole tracker, then **To source**: a new project opens in **Edit**, the tracker written as ink markup. Press **Run** and close the overlay (F10): a still copy shows beside the original.
4. **Make your own.** In **Projects**, type a name and press **New**. Its template is a small working example: **Run** it, then drag the slider in its controls window and watch the panel on the HUD follow. Change a `<text>` in the markup and press **Save** (Ctrl+S): the panel shows the change at once.
5. **Share it.** Press **Export**: the project becomes a zip in `Documents\REDnode\UI exports`, ready to install as a mod of its own.

The panel's markup reads its data by name, and the script changes the data:

```html
<mount layer="hud" anchor="left" x="80" y="-60">
  <column gap="10">
    <text style="label">{title}</text>
    <row gap="12" align="center">
      <bar value="{fill}" tone="{tone}" track="dim" width="240" height="8" />
      <text style="value" tone="{tone}">{level}%</text>
    </row>
  </column>
</mount>
```

```js
import { ink, ui } from 'rednode';

const data = (level) => ({ level, fill: level / 100, tone: level >= 70 ? 'warning' : 'accent' });
const view = await ink.load('panel.ink.html', {}, { title: 'My panel', ...data(50) });

ui.window({
  title: 'My panel: controls',
  children: [ui.slider('Level', (v) => view.set(data(v)), { min: 0, max: 100, value: 50, live: true })],
});
```

`view.set()` sends the game only what reads the names it changed. Every tag and attribute of the markup is in [Native game UI](ink.md#ut1-build-rednode-0510).

To uninstall, remove it in your mod manager or delete that folder. REDnode stays.

## UI Workbench

The Workbench covers the game view (a page with `"fill": "screen"`) and is see-through, so the game takes the mouse wherever it draws nothing. Its window moves inside the page by its title bar and resizes by the grip in its bottom-right corner; it keeps its place and size, and **Reset position and size** in the title bar puts them back.

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

### Projects and Edit

These two tabs need the `admin` permission (the Mod Manager, the Workbench's **Permissions**): they start and stop packages.

A project is a REDnode package of its own in `Documents\REDnode\UI projects`, which REDnode watches as a development folder: `rednode-app.json`, `panel.ink.html` (the markup) and `mod.mjs` (its script: `ink.load` with the handlers and the data). **New** makes one from a small working example (a slider in its own window drives the HUD panel while it is dragged, to show how `view.set()` updates it), **Rename** changes its name, **Delete** moves it to the folder's `.trash`.

**Export** (on a project's row, or in **Edit**) writes the project as a zip in `Documents\REDnode\UI exports`, named by its id and version, with its files laid out as in the game folder (`red4ext\plugins\REDnode\apps\<id>\`) and a README. Extract it into the game folder, or add it to a mod manager, and it runs as a mod of its own, switched on in the launcher or the Mod Manager; it needs REDnode and Codeware, which its manifest names. Unsaved changes are saved first, and the zip's path is copied. Before you install an export on the same PC, delete the project or move its folder out of `UI projects`: a development copy wins over the installed one (the Mod Manager's DEV tag), and **Rename** keeps the project's id, so it does not help.

In **Edit**, the markup and the script are side by side, with highlighting, completion of the markup's tags and attributes, and each mistake shown at its line as you type. Drag the splitter between them to give one more width; a double-click centres it. **Run** saves and runs the project as a mod of its own, so its panel shows in the game; **Save** (Ctrl+S) while it runs shows the change; **Stop** takes it away. Its output and any crash are in the Mod log.

### Details

The selected widget's class and its parents' classes, path, box on screen, visibility, text, controllers, its layer and HUD entry, the `.inkwidget` file it was spawned from (as a path hash), and every property, with a filter. Each part folds, and stays as you left it. **Path** and **JSON** copy it; **Read all** reads every widget under it in one call and says how long it took; **Parent** selects its parent.

### To source

**To source** copies the selected widget and everything under it into a new project, as ink markup (a HUD piece's own window is skipped: it starts from what the window holds): panels as `column` and `row`, canvases, texts with their size, weight, case and colour, images with their atlas and part, any other class as `<widget class="...">`. The project opens in **Edit**, and **Run** shows the copy on the HUD beside the original, a start for a panel of your own that looks like the game's. The copy is still: the game's own controller is what fills and moves the original. Hidden widgets are left out, and what markup cannot say (an anchor that fills one way only, a colour brighter than white) is listed in the markup's first comment. Needs the `admin` permission, as Projects does.

### Try

**Try**, in the details, changes the selected game widget live, to find what controls a look: visible, opacity (a slider), tint, size, margin, padding, place (x y), and a text's text and font size. Type a value and press Enter; the line under the fields says the value now and the one before. Nothing is kept: **Reset** puts the widget back, **Reset all** puts back every widget tried, and switching the Workbench off puts back whatever is left. Needs the `admin` permission.

## For mod makers

Everything the Workbench reads is in the `rednode` package, for your own mods and apps ([Native game UI](ink.md), and the [API reference](api/)):

| Call | What it gives |
|---|---|
| `ink.layers()` | The game's layers and the HUD's entries |
| `ink.read(from, { depth, max })` | A tree of widgets in one call: class, name, visibility, box, controller, text |
| `ink.inspect(id)` | One widget in full, with its parents and every property, and an `api` reference to it |
| `ink.at(x, y)` | The drawn widgets under a point, smallest first |
| `ink.boxes()` | Every drawn widget's box in one call, to find what is under the cursor on each move |
| `ink.read(from, { props: true })` | Each widget's layout and look as well, with texts whole: what To source turns into markup |
| `ink.try(id, prop, value)`, `ink.reset()` | Change one property of a game widget, and put it back (packages allowed `admin` only) |

```ts
import { ink } from "rednode";

const { hits } = await ink.at(200, 900);
const w = await ink.inspect(hits[0].id);
console.log(w.path, w.controllers, w.properties.opacity);
```

Native UI of your own is written with `ink.load` and `ink.parse` in [ink markup](ink.md#ut1-build-rednode-0510), or with the `ink` functions.
