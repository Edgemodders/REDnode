# Localization

Status: **proposed** on 2026-10-18. L1's core (the game's language, `t()`, plurals, gender forms, game keys) and L3 (ink) are planned as the native game UI's phase I2d ([plan](ink.md#i2d-plan), 2026-10-22); the rest of L1 and L2 are not scheduled. Today every string REDnode shows is English: the launcher, the Mod Manager, the Welcome window and the UI kit's own words. Packages have no way to ship text in other languages. This page plans localization for all of REDnode: overlay windows, Node mods, manifests and the [native game UI](design.html#ink).

## Three sources

| Source | What it gives | How REDnode reads it |
|---|---|---|
| **The game** | The language the player chose in the game's settings. The game's own strings, by `LocKey#` number or secondary key, in that language, with forms for V's gender | From the plugin. Strings: `GetLocalizedText`, `GetLocalizedTextByKey`, `GetLocalizedTextGanderDepened`, `inkTextWidget.SetLocalizedText` (all in the 2.31 dump). Language: unverified; the settings system (as for `/audio/volume`) or the engine's `inkLocalizationChangedEvent` |
| **Windows**, through Electron | The player's real locale: the display languages in order and the regional format (numbers, dates, times) | `app.getPreferredSystemLanguages()` and `app.getSystemLocale()` in the host. On this PC: `["en-US"]` and `en-US` |
| **The browser engine** (Chromium and Node, with ICU) | Formatting rules for every locale: numbers, currency, dates, relative times, lists, plural categories, collation, language names | `Intl` in pages and in Node mods. Checked on 2026-10-18 in the host's Electron 44: full ICU data, so `new Intl.PluralRules("pl-PL").select(3)` gives `few` and French numbers read `1 234,5` |

Chromium can format any locale, but it knows no translations. Text comes from the game or from the package's own files.

`app.getLocale()` is the wrong call here. It gives Chromium's own UI language, and the packaged host keeps only `en-US.pak` (`tools/overlay/package-host.mjs`), so it would always say en-US.

## Which locale wins

| Use | Locale |
|---|---|
| Words (text) | The **game's** language. REDnode sits in the game, so it speaks the game's language even when Windows uses another |
| Before the game has said (the host's first second, the Welcome window at the boot screen) | The first Windows display language the game also has, then English |
| Numbers, dates, times | The **Windows** regional format, by default. A package can ask for the game's language instead |
| Missing text | English, then the key itself |

The game's language names are its own (`en-us`, `fr-fr`, `pl-pl`, `zh-cn` and so on). REDnode maps them to standard tags (`fr-FR`) for `Intl`.

## For package authors

```
my-mod/
  rednode-app.json
  locales/
    en-us.json
    fr-fr.json
```

```json
{
  "$name": "Bounty board",
  "$description": "Contracts from fixers, on the HUD.",
  "track": "Track",
  "reward": "Reward: {amount}",
  "found": { "one": "{count} contract", "other": "{count} contracts" },
  "thanks": { "m": "Thanks, mister.", "f": "Thanks, miss." }
}
```

| Feature | How |
|---|---|
| A string | `t("track")` |
| Parameters | `t("reward", { amount: fmt.money(500) })`: `{name}` placeholders |
| Plurals | `t("found", { count: 3 })`: the forms are the language's plural categories (`one`, `few`, `many`, `other`), picked by `Intl.PluralRules` |
| V's gender | `m` and `f` forms, picked by V's gender as the game's own text does (body or voice tone: unverified) |
| The game's strings | `"LocKey#12345"` anywhere a text goes, or `t("UI-…")` for a secondary key the package does not define. A record's name from TweakDB works as it is |
| Formats | `fmt.number`, `fmt.money` (the game's €$), `fmt.date`, `fmt.distance`, using the locale rules above |
| Language | `game.language()`, and a `language` event when the player changes it |
| Manifest | `$name` and `$description` in a locale file replace the manifest's `name` and `description` in the launcher and the Mod Manager |

Where it works:

| Place | How |
|---|---|
| Node mods and the `ui` builder | `t()` and `fmt` from the `rednode` package. Builder nodes take `t()` results and `LocKey#` strings, and update themselves when the language changes |
| Overlay apps (HTML) | The UI kit fills `data-t="key"` (text) and `data-t-title="key"` (tooltip) on any element, and updates them on a change. `RednodeUI.t()` and `RednodeUI.fmt` for script |
| Native game UI (ink) | The same `t()` and `LocKey#`; game keys go straight to the engine (design doc, [Localization](design.html#ink)) |
| Notifications | `title` and `text` take `t()` results and `LocKey#` strings |

Packages need neither ArchiveXL's localization files nor Codeware's `ModLocalizationPackage`. REDnode reads `locales/` itself, and hot reload covers locale files like any other file.

A missing key shows once per key and language in the Mod log. `npm run locales:check <package>` lists the keys each language lacks.

## REDnode's own text

The launcher, the Mod Manager, the Mod log, the Welcome window, the UI kit's built-in words (tooltips such as Close and Roll up, the debugger's labels) and the host's messages move into `locales/en-us.json` files, read the same way as a package's. English ships first. Other languages come as contributions, and a missing string shows in English.

Log lines stay in English, so logs read the same in every bug report.

## Phases (proposal)

| Phase | What |
|---|---|
| L1 Language and API | The game's language in the plugin and a `language` event; Windows' locale in the host; `t()`, `fmt`, plurals, gender forms and `LocKey#` lookups in the `rednode` package and the UI kit (`data-t`); `$name` and `$description`; missing-key logging. Sample: a package in English and French |
| L2 REDnode's own text | Every string in the launcher, the Mod Manager, the Mod log, the Welcome window and the UI kit into locale files; `locales:check` |
| L3 Ink | Comes with the native game UI's I2 phase: game keys through `SetLocalizedText`, package strings sent again on a change |

## Open questions

- How does the plugin read the game's language: the settings system, the engine's event, or both? Does a change in the settings reach REDnode without a restart?
- Right-to-left text (the game has Arabic): the UI kit needs `dir="rtl"` layouts. Does ink handle it for us?
- The UI kit's fonts (Rajdhani, Chakra Petch, JetBrains Mono) lack Chinese, Japanese, Korean and Thai glyphs. Fall back to Windows fonts, or ship a font?
- Should REDagent offer to translate a package's `locales/en-us.json` into the game's other languages?
