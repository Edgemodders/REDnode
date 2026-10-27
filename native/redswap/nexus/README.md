# REDswap on Nexus Mods

The source of REDswap's own Nexus Mods page, [mod 36172](https://www.nexusmods.com/cyberpunk2077/mods/36172), beside REDnode's (`nexus/` at the repo root) and the app packs'. REDswap's source is `native/redswap/`; its docs page is `docs/redswap.md`.

| File | What it is |
|---|---|
| `nexus.json` | The page (36172), how the zip is uploaded, and what the last pull saw (`tools/nexus/nexus.mjs`) |
| `description.bbcode` | The page's description. The release workflow pushes it when it changed; never edit it on Nexus without pulling after |
| `brand/banner.png` | 2560 x 640, at the top of the description (loaded from GitHub) |
| `brand/social.png` | 1280 x 640, for links shared on social sites |
| `brand/nexus.png` | 1280 x 640, the page's primary image: the social layout moved down 55 px, with the top left empty for the EDGEmodders header, which the owner adds by hand. Drawing it again clears the header: add it again after |
| `brand/icon.png` | 256 x 256 |
| `brand/source.html` | What the images are drawn from (below) |

## Releasing

REDswap has its own version (`native/redswap/redswap.json`) and changelog (`native/redswap/changelog.md`), and is released by REDnode's **Release zip** workflow:

| Step | What happens |
|---|---|
| Every run | `npm run release:redswap` builds `REDswap-<version>.zip` (`red4ext/plugins/REDswap/` with the DLL, its licenses and a README). It stops if the changelog has no section for the version, or has changes under **Unreleased** |
| **Make a release** | The zip is attached to REDnode's GitHub release, with a line in its notes |
| **Update Nexus Mods** | `tools/nexus/nexus.mjs release native/redswap/nexus`: uploads the zip as the main file's new version when that version is not on Nexus yet (the first release creates the main file), adds the changelog section, and pushes `description.bbcode` when it differs. With the version already on Nexus, only the description is pushed. It checks first and stops before building if the description changed on Nexus since the last pull |

To release a change to REDswap: add its line under **Unreleased**, raise `version` in `redswap.json`, rename **Unreleased** to `## <version> (<date>)`, and run the workflow with REDnode's next release.

After an edit made on Nexus: `node tools/nexus/nexus.mjs pull native/redswap/nexus`, check the diff, commit. `node tools/nexus/nexus.mjs status native/redswap/nexus` shows the page's state.

## The Nexus form (by hand)

| Field | Value |
|---|---|
| Mod name | REDswap |
| Version | Set by each release |
| Category | Modders resources / Utilities |
| Brief overview | Swap archives into the running game: see a new mesh, material or texture without a restart. A RED4ext plugin for game 2.5, used by REDnode and callable by any tool. |
| Author | Edgemodders |
| Primary image | `brand/nexus.png`, with the EDGEmodders header added |
| Requirements | RED4ext. Optional: ArchiveXL |
| Permissions | MIT (with RED Hot Tools' MIT notice for the ported swap) |
| Credits | psiberx, for RED Hot Tools |

## The images

`brand/source.html` draws all four in REDnode's style: two versions of an archive with a swap arrow between them. To draw them again after a change, from the repo root (one image per run):

```bash
unset ELECTRON_RUN_AS_NODE
for j in banner=2560x640 social=1280x640 nexus=1280x640 icon=256x256; do
  node_modules/electron/dist/electron.exe tools/brand/render.cjs native/redswap/nexus/brand/source.html native/redswap/nexus/brand $j
done
```
