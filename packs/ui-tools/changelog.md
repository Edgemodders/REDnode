# REDnode UI Tools changelog

An optional app pack for REDnode. Its first release comes with the UI Workbench's editor (phase UT3 in [docs/ink.md](../../docs/ink.md#ui-tools-plan)); until then `pack.json` says `"unreleased": true` and REDnode's release run leaves it out.

## Unreleased

**New**

- **UI Workbench**, with its Inspect tab: the game's ink layers and HUD pieces as a tree, a widget's class, path, box, controllers, source file and every property, and **Pick**, which outlines and names the widget under the cursor as it moves and, on a click, lists the widgets there and selects the deepest. A pick opens the tree to the widget and selects it, and the smallest widget under the cursor comes first, leaving out what the game does not draw. The tree has its own filter. **Pick inside** picks only among the selected widget's children, and a right-click while picking sets the widget under the cursor aside, so the one beneath it can be picked. The details fold into three parts that stay as you left them. It waits for the game at the start and reads the layers again after each save load. Reads only. Needs REDnode 0.53.0 and Codeware.
