# REDnode Admin Tools on Nexus Mods

The source of the Admin Tools pack's own Nexus Mods page, beside REDnode's (`nexus/` at the repo root) and the Sound Tools pack's. **Live at [mod 35793](https://www.nexusmods.com/cyberpunk2077/mods/35793)** since 2026-10-24 (0.1.0, with REDnode 0.37.0). Its in-game test passed on 2026-10-24 (docs/admin-tools.md, "Admin Tools test: results").

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Paste the whole file into the description field (the editor's source mode, or switch to BBCode) |
| `brand/banner.png` | 2560 x 640, at the top of the description (loaded from GitHub) |
| `brand/social.png` | 1280 x 640, for links shared on social sites |
| `brand/nexus.png` | 1280 x 640, the page's primary image: the social layout moved down 55 px, with the top left empty for the EDGEmodders header, which the owner adds by hand (as on REDnode's own Nexus image). Drawing it again clears the header: add it again after |
| `brand/icon.png` | 256 x 256 |
| `brand/source.html` | What the images are drawn from (below) |
| `README.md` | This page |

## Before posting: the placeholders

| In `description.bbcode` | Replace with |
|---|---|
| `REDNODE_VERSION` (two places, now 0.37.0) | The REDnode the pack needs, from `packs/admin-tools/pack.json`, when it changes |
| `Screenshot 1` to `Screenshot 3` (cyan italics) | Upload each picture to the page's Images tab, then replace its line with `[img]<the image's Nexus URL>[/img]` and a one-line caption. Pictures from the mock game are in `docs/assets/admin-tools/` until there are pictures from the game |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | REDnode Admin Tools |
| Version | The pack's version, from `packs/admin-tools/pack.json` (0.1.0) |
| Category | Utilities |
| Brief overview | See what every REDnode mod costs, end one that misbehaves, and choose which tools AI assistants may use. A Task Manager and a Tools Manager over the game, as an app pack for REDnode. (255 characters at most; this is 182) |
| Author | Edgemodders |
| Language | English |
| Primary image | `brand/nexus.png`. The banner is already at the top of the description |
| Requirements | REDnode (its Nexus page; note: "the version named on this page or later") |
| Permissions | MIT, as REDnode |
| Tags | Utility, modders resource |

## The download

One main file: `REDnode-Admin-Tools-<version>.zip`, laid out like the game folder, so Vortex and an extract by hand put it in the same place. It holds only the pack's apps, so it never overwrites REDnode's files:

```
red4ext/plugins/REDnode/apps/
  taskmanager/
  toolsmanager/
```

Each app's manifest asks for `"requires": { "rednode": ">=<version>" }`, the REDnode in `packs/admin-tools/pack.json`, and for the `admin` and `front` permissions. `npm run release:pack -- admin-tools` builds the zip into `native/build/release/` (each app off at start, with a `LICENSE.txt`); it stops if `packs/admin-tools/changelog.md` has no section for the version, and `--draft` builds a test zip without that check.

### File description on Nexus

> REDnode Admin Tools &lt;version&gt;: Task Manager and Tools Manager. Needs REDnode &lt;version&gt; or later.

## The images

`brand/source.html` draws all four in REDnode's style (the docs site's fonts and colours), with a CPU meter where the Sound Tools images have a sound wave: low bars and one mod stuck at 100 % in red. To draw them again after a change, from the repo root (one image per run; Electron fails on a second page in the same run):

```bash
unset ELECTRON_RUN_AS_NODE
for j in banner=2560x640 social=1280x640 nexus=1280x640 icon=256x256; do
  node_modules/electron/dist/electron.exe tools/brand/render.cjs packs/admin-tools/nexus/brand/source.html packs/admin-tools/nexus/brand $j
done
```

The fonts come from Google Fonts, so drawing needs the internet.

## Updating the page

1. Edit `description.bbcode` here, commit, push.
2. Check it: `node tools/check-bbcode.mjs packs/admin-tools/nexus/description.bbcode`.
3. Paste the whole file into the description field on Nexus and save.
4. For a new version: the release gate first (every in-game test of what goes in has passed, docs/testing.md), then raise `version` in `pack.json` (and `rednode` with each app's `requires`, if the pack needs a newer REDnode), rename **Unreleased** in the pack's changelog to `## <version> (<date>)`, run `npm run release:pack -- admin-tools`, upload the zip as the main file, and paste that changelog section into the page's changelog for the version. The next REDnode release carries the zip on GitHub: the Release zip workflow builds every pack and stops when a pack's changelog has changes under **Unreleased**, so release the pack's changelog before REDnode's.
