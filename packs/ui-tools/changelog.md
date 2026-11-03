# REDnode UI Tools changelog

What changed in each release of the UI Tools pack, for its Nexus page and its GitHub release. The same rules as REDnode's own changelog (`docs/changelog.md`): a line under **Unreleased** with each change a player would notice, grouped **New**, **Changed**, **Fixed**, **Other**; before a release, rename **Unreleased** to `## <version> (<date>)`, with the version from `pack.json`. `npm run release:pack` stops if that version has no section.

## Unreleased

## 0.1.0 (2026-11-03)

The first release, for REDnode 0.56.0 or later and Codeware 1.16 or later, on game version 2.5. One app, the **UI Workbench**, opened from REDnode's launcher (F10) once switched on in the Mod Manager. Inspect works at once; To source, Try, Edit and Projects ask for the `admin` permission.

**New**

- **Inspect**: the game's ink layers and HUD pieces as a tree, and a widget's class, path, box on screen, controllers, the `.inkwidget` file it came from and every property, in parts that fold. **Pick** outlines and names the widget under the cursor as you move, and a click opens the tree to it; a right-click sets the widget on top aside, and **Pick inside** picks only among the selected widget's children. The tree and the properties have filters with a ✕ that clears them. HUD pieces the game has not spawned yet are listed and say so.
- **Try**: change a picked widget live, its visibility, opacity (a slider), tint, size, margin, padding, place, or a text's text and font size, to find what controls a look. **Reset** and **Reset all** put it back, and switching the Workbench off puts back everything: nothing is kept.
- **To source**: a picked widget and everything under it, copied into a new project as ink markup (panels, texts with their size, weight, case and colour, images with their atlas and part), which runs beside the original. Hidden widgets are left out, and what markup cannot say is listed in the file's first comment.
- **Projects** in `Documents\REDnode\UI projects`, each one a mod of its own: **New** starts from a small working example (a slider in its own window drives a HUD panel while it is dragged), **Rename**, **Delete** (to the folder's `.trash`).
- **Edit**: the markup and the script side by side, with highlighting, completion of the markup's tags and attributes, every mistake shown at its line as you type, and a splitter between them. **Run** shows the project in the game, **Save** (Ctrl+S) while it runs shows each change, **Stop** takes it away; its output and crashes are in the Mod log.
- **Export**: a project as a zip in `Documents\REDnode\UI exports`, laid out as the game folder with a README, that installs as a mod of its own.
- The Workbench covers the game view; its window resizes by the grip in its bottom-right corner and keeps its size and place, with **Reset position and size** in its title bar. A status line cut short shows its whole text as a tooltip.
