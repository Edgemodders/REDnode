# REDnode on Nexus Mods

The source of REDnode's Nexus Mods page lives here, so updates are edits in the repo, not in Nexus's text box. **Live at [mod 35419](https://www.nexusmods.com/cyberpunk2077/mods/35419)** (REDnode 0.37.0, posted from the owner's account; REDagent is [35670](https://www.nexusmods.com/cyberpunk2077/mods/35670), the Admin Tools pack [35793](https://www.nexusmods.com/cyberpunk2077/mods/35793)). The first pages, posted on 2026-10-16 from an Edgemodders account (REDnode 35355, REDdeck 35366, REDcode 35356), were taken down by Nexus because the owner already has a personal account. The images still load from the old page's `staticdelivery.nexusmods.com` URLs (checked 2026-10-18); upload them again if those stop working. Copies of them, in description order, are in `nexus/images/` (WebP, as Nexus serves them).

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Paste the whole file into the description field (the editor's source mode, or switch to BBCode) |
| `README.md` | This page: the other fields of the Nexus form, the download file, and how to update |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | REDnode |
| Version | REDnode's version, from `VERSION` (for example 0.24.2) |
| Category | Modders Resources and Tutorials, or Utilities (check the list for Cyberpunk 2077 when creating the page) |
| Brief overview | Mod Cyberpunk 2077 in JavaScript: Node.js mods beside the game, web pages drawn over it as windows and HUD widgets, the whole game API typed, and REDagent, an AI assistant that writes mods with you in the game. (255 characters at most; this is 210) |
| Author | Edgemodders |
| Language | English |
| Primary image | `docs/assets/brand/social.png` (1280 x 640). The banner (`docs/assets/brand/banner.png`) is already at the top of the description |
| Requirements | RED4ext and redscript (Nexus pages). Optional, noted as such: EDGEdeck (its new Nexus page; note: "Only for REDnode mods that read the game's archives. Open EDGEdeck once and press Get REDbridge. REDnode and its samples run without it."), Codeware, TweakXL, ArchiveXL (note: "Only for REDnode packages that ask for it; the Mod Manager tells you.") |
| Permissions | MIT: open source, free to modify and redistribute with the license notice. Bundled third-party parts keep their own licenses (`THIRD-PARTY-NOTICES.txt` in the zip) |
| Tags | Framework, modders resource, utility, user interface |

The description has screenshot placeholders in cyan italics (`[Screenshot N: ...]`). Upload each picture to the page's Images tab, then replace its placeholder line with `[img]<the image's Nexus URL>[/img]` and a one-line caption.

## The download

One main file: `REDnode-<version>.zip`, laid out like the game folder, so Vortex, EDGEdeck and an extract by hand all put it in the same place:

```
red4ext/plugins/REDnode/
  REDnode.dll                the plugin
  Scripts/                   its redscript parts
  host/                      the overlay host, with its own Electron
  apps/<id>/                 the samples, all off until the player switches them on
  LICENSE.txt, THIRD-PARTY-NOTICES.txt, README.txt
```

| What | Where it comes from |
|---|---|
| The samples | `SAMPLES` in `tools/release/player-zip.mjs`: Hello mod, Ask mod, UI kit, Vitals, Coords, Perf, Test timer (since 0.26.16). The other apps in `packages/overlay/apps` are tests and stay out. The zip's copies have `"open": false` |
| REDbridge | Not in the zip. REDnode runs without it; packages that use `kernel.bridge()` find the copy EDGEdeck or REDcode fetched. REDbridge is GPL-3.0 and 60 MB, and already reaches players through those two |
| REDagent | Not in the zip. It is its own download (its repo), installed into the same `apps` folder |

### Building it

On GitHub: the **Release zip** workflow (`.github/workflows/release.yml`).

| Trigger | Result |
|---|---|
| Actions tab, **Run workflow** | Builds the zip on a Windows runner and keeps it as the run's artifact, `REDnode-zip` |
| **Run workflow** with **Make a release** ticked, or `npm run release` (the gh CLI starts the same run on `main`) | The same, then tags the commit `v<VERSION>` and makes a GitHub release with the zip, its notes from the version's section of `docs/changelog.md`. It stops before building if that version is already released or has no section in the changelog |

On this machine, after the usual build:

```powershell
.\tools\build-native.ps1
npm run overlay:package
npm run release:zip      # native\build\release\REDnode-<version>.zip
```

### File description on Nexus

> REDnode &lt;version&gt;: the plugin, the overlay host and six samples. Install with Vortex or EDGEdeck, or extract into the game folder. Needs RED4ext and redscript.

## Updating the page

1. Edit `description.bbcode` here, commit, push.
2. Check it: `node tools/check-bbcode.mjs nexus/description.bbcode`.
3. Paste the whole file into the description field on Nexus and save.
4. For a new version, first the release gate: every in-game test of the builds since the last release has passed (docs/testing.md). Untested or failed means no release. Then:
   1. In `docs/changelog.md`, rename **Unreleased** to `## <version> (<date>)`, start a new empty **Unreleased** above it, commit and push.
   2. Run the workflow with **Make a release** ticked. The GitHub release takes its notes from that section.
   3. Download the zip from the release, and upload it on Nexus as the main file with the version from `VERSION`. Archive the old file.
   4. In the page's changelog for that version (Manage files, or the Changelogs tab), paste the lines from `npm run release:notes -- --nexus`, one entry per line.

Under the tagline, a line links the latest GitHub release and the changelog page. It names no version, so it never needs updating.

Keep these in step with the repo's status (README, docs/index.md):

| Where in the description | Update when |
|---|---|
| The STATUS box near the top | The API is declared stable, or the tested game version changes |
| "Highlights" | A phase adds something a player or modder would notice |
| "What is in the download" | `SAMPLES` changes |
| "Requirements" | A required mod or its minimum version changes |
| The roadmap list | Each phase; the next one is marked in cyan (`[color=#19f3ff]Next:[/color]`) |

## BBCode used

Nexus's BBCode has no tables or Markdown, so the page uses only: `[b]`, `[i]`, `[size=2..5]`, `[color=#hex]`, `[center]`, `[quote]`, `[code]`, `[line]`, `[list]` with `[*]`, `[url=...]` and `[img]`. The banner is linked from this repo's `main` branch on GitHub, so it must stay at its path. The colours are the house palette: yellow `#fcee0a` for headings, cyan `#19f3ff` for highlights.
