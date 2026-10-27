# REDswap changelog

What changed in each release of REDswap, for its Nexus page (mod 36172) and the GitHub release it is attached to. REDswap has its own version, in `native/redswap/redswap.json`, apart from REDnode's. The same rules as REDnode's own changelog (`docs/changelog.md`): a line under **Unreleased** with each change a player or modder would notice, grouped **New**, **Changed**, **Fixed**, **Other**; before a release, raise the version in `redswap.json` and rename **Unreleased** to `## <version> (<date>)`. `npm run release:redswap` stops if that version has no section, or if anything is left under **Unreleased**.

## Unreleased

## 1.0.0 (2026-10-27)

The first release, for game version 2.5 (RED4ext 1.31 or later). Also installed by REDnode 0.41.0 and later.

**New**

- Swaps `.archive` files into the running game: a new archive is added, one the game already loaded is replaced, and the resources it holds are dropped from the game's loader, so what loads them next gets the new version. About 50 ms on the game thread.
- ArchiveXL's `.xl` and `.yaml` files are swapped too, and ArchiveXL is asked to reload after each swap.
- Checks the game before touching anything: every game function is looked up first, the archive loader and the file cache must look as REDswap knows them on this game version, and a swap is refused with a reason instead of crashing the game when they do not.
- Callable from scripts and other plugins: `REDswap_Version()`, `REDswap_Check()` (empty when it can swap) and `REDswap_Swap(files)` (absolute paths joined by `|`, answering JSON with what each file became).
- Its swap is ported from RED Hot Tools' archive loader (MIT, by psiberx), which has no build for game 2.5 yet; its license ships with REDswap.
