# REDnode Admin Tools changelog

What changed in each release of the Admin Tools pack, for its Nexus page and its GitHub release. The same rules as REDnode's own changelog (`docs/changelog.md`): a line under **Unreleased** with each change a player would notice, grouped **New**, **Changed**, **Fixed**, **Other**; before a release, rename **Unreleased** to `## <version> (<date>)`, with the version from `pack.json`. `npm run release:pack` stops if that version has no section.

## Unreleased

## 0.1.0 (2026-10-24)

The first release, for REDnode 0.37.0 on game version 2.31.

**New**

- **Task Manager**: every running package with its CPU, memory, its thread's load and heap, game calls and service calls. **End task** stops one, even one stuck in an endless loop, and **Restart** starts it again. Built into REDnode 0.34.0 to 0.36.0; now in this pack.
- **Tools Manager**: every tool an AI assistant can see through REDnode, REDnode's own and each mod's, with what it does and whether it asks first. Switch any tool or mod off for every assistant (kept across starts), or start new mods' tools off; see which assistants connected and their recent calls. Built into REDnode 0.36.0; now in this pack.
- Both ask for the **admin** permission (allow it in the Mod Manager) and **front**, so they stay above other packages' windows.
