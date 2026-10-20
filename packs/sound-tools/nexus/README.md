# REDnode Sound Tools on Nexus Mods

The source of the Sound Tools pack's own Nexus Mods page, beside REDnode's (`nexus/` at the repo root). Not on Nexus yet: the page goes up with the pack's first release, after SP3 (Sound Search) and SP4 (the pack's zip) have passed in game and a REDnode release carries the APIs the apps use (docs/sound.md, "Sound Tools: SP1 to SP4").

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Paste the whole file into the description field (the editor's source mode, or switch to BBCode) |
| `brand/banner.png` | 2560 x 640, at the top of the description (loaded from GitHub) |
| `brand/social.png` | 1280 x 640, for links shared on social sites |
| `brand/nexus.png` | 1280 x 640, the page's primary image: the social image under the EDGEmodders header, after REDnode's own Nexus image |
| `brand/icon.png` | 256 x 256 |
| `brand/source.html` | What the images are drawn from (below) |
| `README.md` | This page |

## Before posting: the placeholders

| In `description.bbcode` | Replace with |
|---|---|
| `REDNODE_PAGE` (three links) | REDnode's Nexus mod id, once its page is up again |
| `(REDnode version: ...)` | The first REDnode release with the Sound Tools APIs, for example `0.27.0`, as plain text |
| `Screenshot 1` to `Screenshot 4` (cyan italics) | Upload each picture to the page's Images tab, then replace its line with `[img]<the image's Nexus URL>[/img]` and a one-line caption |
| The Sound Search section | Written from SP3's plan: check it against the app once SP3 has passed |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | REDnode Sound Tools |
| Version | The pack's version (its apps' `rednode-app.json`; set in SP4) |
| Category | Modders Resources and Tutorials |
| Brief overview | Hear what Cyberpunk 2077 plays: trace every game sound live, search all of its sound events, play any recording, and hot-swap sound mods into the running game. An app pack for REDnode. (255 characters at most; this is 184) |
| Author | Edgemodders |
| Language | English |
| Primary image | `brand/nexus.png`. The banner is already at the top of the description |
| Requirements | REDnode (its Nexus page; note: "the version named on this page or later"). RED Hot Tools (note: "For Hot swap only"). Optional, noted as such: REDbridge has no Nexus page; the description explains REDnode's Get REDbridge button |
| Permissions | MIT, as REDnode |
| Tags | Modders resource, utility, audio |

## The download

One main file: `REDnode-Sound-Tools-<version>.zip`, laid out like the game folder, so Vortex and an extract by hand put it in the same place. It holds only the pack's apps, so it never overwrites REDnode's files:

```
red4ext/plugins/REDnode/apps/
  sound-tracer/
  sound-search/
  hot-swap/
```

Each app's manifest has `"open": false` and asks for `"requires": { "rednode": ">=<version>" }` (unverified until SP4: whether `requires` reads REDnode's own DLL version). The command that builds the zip comes with SP4.

### File description on Nexus

> REDnode Sound Tools &lt;version&gt;: Sound Tracer, Sound Search and Hot swap. Needs REDnode &lt;version&gt; or later; Hot swap needs RED Hot Tools.

## The images

`brand/source.html` draws all four in REDnode's style (the docs site's fonts and colours). To draw them again after a change, from the repo root (one image per run; Electron fails on a second page in the same run):

```bash
unset ELECTRON_RUN_AS_NODE
for j in banner=2560x640 social=1280x640 nexus=1280x640 icon=256x256; do
  node_modules/electron/dist/electron.exe tools/brand/render.cjs packs/sound-tools/nexus/brand/source.html packs/sound-tools/nexus/brand $j
done
```

The fonts come from Google Fonts, so drawing needs the internet. The facts on the images (20,569 game events, the three apps) should follow the pack.

## Updating the page

1. Edit `description.bbcode` here, commit, push.
2. Check it: `node tools/check-bbcode.mjs packs/sound-tools/nexus/description.bbcode`.
3. Paste the whole file into the description field on Nexus and save.
4. For a new version: the release gate first (every in-game test of what goes in has passed, docs/testing.md), then the pack's changelog section, the zip, and the upload. The details come with SP4.
