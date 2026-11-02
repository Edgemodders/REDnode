# REDnode UI Tools on Nexus Mods

The source of the UI Tools pack's own Nexus Mods page, beside REDnode's (`nexus/` at the repo root). **The page is [mod 36958](https://www.nexusmods.com/cyberpunk2077/mods/36958)**, made by the owner on 2026-11-02 as "Native UI Tools for REDnode", with no file yet. REDnode's Release zip workflow keeps it through `nexus.json` here, like Sound Tools' page: its first release uploads the pack's zip as the main file and pushes `description.bbcode`.

**Not released yet.** `packs/ui-tools/pack.json` says `"unreleased": true` until the UI Workbench's editor (phase UT3, docs/ink.md) passes in game; until then `pack-zip.mjs --all` and the release workflow's Nexus steps leave the pack out. To release it: remove `"unreleased"`, rename **Unreleased** in `packs/ui-tools/changelog.md` to `## <version> (<date>)`, fill the placeholders below, and start the Release zip run with **Update Nexus Mods**.

| File | What it is |
|---|---|
| `nexus.json` | The page (36958), how the file is uploaded, and the ids `pull` added |
| `description.bbcode` | The page's description, in Nexus's BBCode. The release pushes it |
| `brand/banner.png` | 2560 x 640, at the top of the description (loaded from GitHub) |
| `brand/social.png` | 1280 x 640, for links shared on social sites |
| `brand/nexus.png` | 1280 x 640, the page's primary image: the social layout moved down 55 px, with the top left empty for the EDGEmodders header, which the owner adds by hand. Drawing it again clears the header: add it again after |
| `brand/icon.png` | 256 x 256 |
| `brand/source.html` | What the images are drawn from (below): the motif is the Workbench's Pick, nested widget boxes with one outlined and named |
| `README.md` | This page |

## Before the first release: the placeholders

| In `description.bbcode` | Replace with |
|---|---|
| `Screenshot 1` to `Screenshot 3` (cyan italics) | Upload each picture to the page's Images tab, then replace its line with `[img]<the image's Nexus URL>[/img]` |
| The **UI Workbench: Edit** section's cyan line | What the editor does, once UT3 is built |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | Native UI Tools for REDnode (as the owner named the page) |
| Version | The pack's version, from `packs/ui-tools/pack.json` |
| Category | Modders Resources and Tutorials |
| Brief overview | Read Cyberpunk 2077's own UI: pick any HUD or menu widget and see its tree, its box and every property, and build native UI of your own in ink markup. An app pack for REDnode. (255 characters at most) |
| Author | Edgemodders |
| Primary image | `brand/nexus.png`. The banner is already at the top of the description |
| Requirements | REDnode (its Nexus page; note: "the version named on this page or later") and Codeware |
| Permissions | MIT, as REDnode |
| Tags | Modders resource, utility, user interface |

## The download

One main file: `REDnode-UI-Tools-<version>.zip`, laid out like the game folder, so Vortex and an extract by hand put it in the same place. It holds only the pack's apps, so it never overwrites REDnode's files:

```
red4ext/plugins/REDnode/apps/
  ui-workbench/
```

Each app's manifest asks for `"requires": { "rednode": ">=<version>" }`, the REDnode in `packs/ui-tools/pack.json`. `npm run release:pack -- ui-tools` builds the zip into `native/build/release/`; `-- ui-tools --draft` builds a test zip without the changelog checks (and with the pack unreleased).

## The images

From the repo root, one image per run (Electron fails on a second page in the same run):

```bash
unset ELECTRON_RUN_AS_NODE
for j in banner=2560x640 social=1280x640 nexus=1280x640 icon=256x256; do
  node_modules/electron/dist/electron.exe tools/brand/render.cjs packs/ui-tools/nexus/brand/source.html packs/ui-tools/nexus/brand $j
done
```

## Updating the page

As every page the workflow keeps: `node tools/nexus/nexus.mjs status packs/ui-tools/nexus` shows the live version and whether the description matches; after an edit on Nexus, `node tools/nexus/nexus.mjs pull packs/ui-tools/nexus`, check the diff, commit. A release stops before uploading anything if the live description changed since the last pull.
