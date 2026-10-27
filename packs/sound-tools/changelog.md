# REDnode Sound Tools changelog

What changed in each release of the Sound Tools pack, for its Nexus page and its GitHub release. The same rules as REDnode's own changelog (`docs/changelog.md`): a line under **Unreleased** with each change a player would notice, grouped **New**, **Changed**, **Fixed**, **Other**; before a release, rename **Unreleased** to `## <version> (<date>)`, with the version from `pack.json`. `npm run release:pack` stops if that version has no section.

## Unreleased

## 0.1.1 (2026-10-27)

For REDnode 0.41.0 on game version 2.5. On game 2.31, keep 0.1.0 with REDnode 0.37.0.

**Changed**

- **Hot swap** no longer needs RED Hot Tools: it swaps through REDswap, which REDnode 0.41.0 installs (RED Hot Tools has no build for game 2.5). REDswap's own page: https://www.nexusmods.com/cyberpunk2077/mods/36172
- The pack needs REDnode 0.41.0 or later.

**Other**

- Sound Search, Sound Tracer and Hot swap passed a check on game 2.5 on 2026-10-27. Sound swaps (archives with the game's sound) are untested on 2.5 so far.

## 0.1.0 (2026-10-20)

**New**

- **Sound Tracer**: every sound event the game posts and every sound it loads, live, in two columns. Play an event's recordings or a single sound, post an event through the game, filter, pause, copy, and paste any name or id to play it. Every row also goes to `red4ext/logs/rednode-sound-trace.log`.
- **Sound Search**: the game's sound events, over 23,000 of them, by words of their name or tags, by event id or by sound id. Play an event or any of its recordings, and keep what you find in the **Scratch** tab between sessions.
- **Hot swap**: swap an archive into the running game, sound mods included, through RED Hot Tools. Recent swaps are kept, to swap again in one press after your next build.
