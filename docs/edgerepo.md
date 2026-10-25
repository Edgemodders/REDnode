---
title: EDGErepo
---

# EDGErepo: a base repo for the EDGE tools

**Status: might do, later.** Proposed by the user on 2026-10-25. Not scheduled. Nothing is built.

## The problem

Each EDGE repo was started by copying the files of an older one, and each copy has since changed on its own. On 2026-10-25, across the 14 EDGE repos checked out on the dev PC:

| File | Repos that have it | Identical copies |
|---|---|---|
| `docs/assets/css/hud.css` | 14 | none: all 14 differ |
| `docs/_layouts/default.html` | 14 | none: all 14 differ |
| `.github/workflows/pages.yml` | 14 | none: all 14 differ |
| `tools/brand/render.ps1` | 11 | 4 are the same, the other 7 all differ |
| `tools/nexus/` (the Nexus scripts) | 2 (REDnode, REDagent) | the same today, copied by hand |

Some of the differences are on purpose, like each tool's name and colours. Others are fixes made in one repo and never carried over. The Nexus scripts showed the cost on 2026-10-25: the fix for the upload signature had to be made in REDnode and in REDagent.

## The idea

One repo, **EDGErepo** (`Edgemodders/EDGErepo`), with two halves that are used in different ways:

| | Scaffolding | Shared release machinery |
|---|---|---|
| What | The README layout, the license, the docs site (HUD layout, `hud.css`, the Pages workflow), the brand sources and render script, the badges, a CLAUDE.md skeleton with the house conventions, `docs/changelog.md`, `docs/dev-setup.md` | The release steps every tool shares: release notes from the changelog, the GitHub release, the Nexus update (`tools/nexus/`) |
| How a repo uses it | Copied once when the repo is made; after that the files belong to that repo | Referenced, never copied, so a fix reaches every repo |
| GitHub feature | A template repository ("Use this template") | A reusable workflow (`on: workflow_call`) |

### Scaffolding

- EDGErepo is marked as a template repository. A new tool starts from it, then fills its placeholders: the name (EDGE… or RED…), the accent colour, the one-line description, the docs site's nav.
- The CLAUDE.md skeleton holds the conventions every repo repeats today: commits straight to `main`, the git identity per repo, the changelog rule, the release gate, the writing style, never committing game files, the docs site rules. Each repo then adds its own status and next steps.
- The template holds the best current copy of each file, gathered from the newest repos first. Existing repos are not rebuilt from it.

### Shared release machinery

- A reusable workflow, for example `.github/workflows/nexus.yml`, that a repo's own release workflow calls after it has built its zip:

  ```yaml
  nexus:
    needs: build
    uses: Edgemodders/EDGErepo/.github/workflows/nexus.yml@v1
    with:
      version: ${{ needs.build.outputs.version }}
      zip-artifact: release-zip
    secrets: inherit
  ```

- Each repo keeps its own build steps and its own `nexus/nexus.json` and `nexus/description.bbcode`. Only the steps every tool shares move.
- Repos call a tag (`@v1`), so a change in EDGErepo reaches them only when the tag moves: one place to fix, and no surprise in a release.
- On the dev PC, `nexus pull` and `nexus status` run from the EDGErepo checkout and are pointed at the repo's `nexus/` folder.

## Open questions

| Question | Note |
|---|---|
| Public or private | A private EDGErepo needs the organization's setting that lets its other repos use its workflows. Public needs nothing |
| How scripts reach the workflow | The reusable workflow checks out EDGErepo at the same tag, or the scripts become a small published package. The checkout is simpler |
| Which repos move first | REDnode and REDagent, since their Nexus update is live; then each tool as it gets Nexus automation (EDGEdeck, EDGEkit, EDGEmat, REDcode, EDGEwave, the app packs) |
| Shared docs styling | `hud.css` and the layout could also be referenced (a shared theme) rather than copied. Copying keeps each site free to change; decide when the template is built |

## Phases, if taken up

| Phase | What |
|---|---|
| R1 Nexus machinery | EDGErepo with `tools/nexus/` and the reusable Nexus workflow, tagged `v1`. REDnode and REDagent call it and drop their copies. Check with one release of each |
| R2 Template | The scaffolding, gathered from the newest repos, with placeholders and a short "Start a new tool" page |
| R3 Other tools | Each tool with a Nexus page moves its release to the shared workflow when it next releases |
