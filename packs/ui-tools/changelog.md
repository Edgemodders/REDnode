# REDnode UI Tools changelog

An optional app pack for REDnode. Its first release comes with the UI Workbench's editor (phase UT3 in [docs/ink.md](../../docs/ink.md#ui-tools-plan)); until then `pack.json` says `"unreleased": true` and REDnode's release run leaves it out.

## Unreleased

**New**

- **UI Workbench**, with its Inspect tab: the game's ink layers and HUD pieces as a tree, a widget's class, path, box, controllers, source file and every property, and **Pick**, which outlines and names the widget under the cursor as it moves and, on a click, lists the widgets there and selects the deepest. A pick opens the tree to the widget and selects it, and the smallest widget under the cursor comes first, leaving out what the game does not draw. The tree has its own filter. **Pick inside** picks only among the selected widget's children, and a right-click while picking sets the widget under the cursor aside, so the one beneath it can be picked. The details fold into three parts that stay as you left them. It waits for the game at the start and reads the layers again after each save load. Reads only.
- The UI Workbench's **Edit** and **Projects** tabs: projects of ink markup and a script in `Documents\REDnode\UI projects`, written in an editor with errors shown at their line, and run live in the game (**Run**, **Stop**, and Save while it runs shows the change). These need the `admin` permission. Needs REDnode 0.54.0 and Codeware.
- The UI Workbench resizes by the grip in its bottom-right corner (760 x 420 at the smallest), keeps its size, and **Reset position and size** in its title bar puts it back. In **Edit**, the splitter between the markup and the script changes their widths; a double-click centres it. Needs REDnode 0.55.1.
- A new project's template is a small working example: a slider in its own window drives the HUD panel while it is dragged (a level, a bar, a tone that turns to warning and danger, and a count of the changes sent), to show how `view.set()` updates only what reads the data it changed. The tree's and the properties' filters have a ✕ that clears them. Needs REDnode 0.55.2.
- **To source**: the selected game widget and everything under it, copied into a new project as ink markup, opened in Edit; **Run** shows the copy beside the original. **Try**: change a game widget's visibility, opacity, tint, size, margin, padding, place, text or font size live, with **Reset** and **Reset all**; switching the Workbench off puts everything back. Needs REDnode 0.56.0.
- **Export**, on a project's row and in Edit: the project as a zip in `Documents\REDnode\UI exports`, laid out as the game folder with a README, that installs as a mod of its own.
- To source starts inside a HUD piece's own window, and never names a copy or a widget by the game's default name (`UNINITIALIZED_WIDGET`). **Run** saves only unsaved changes, so a project no longer starts twice.
- A status line cut at its end (a long project's path after Export) shows its whole text as a tooltip.
