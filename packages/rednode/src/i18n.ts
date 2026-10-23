/**
 * Text in the player's language (phase I2d, the Localization plan's L1 core).
 *
 * A package keeps its text in `locales/<language>.json`, one file per language, named with
 * the game's language names (`en-us.json`, `fr-fr.json` and so on). {@link t} picks the
 * text for the language the player chose in the game:
 *
 * ```json
 * {
 *   "reward": "Reward: {amount} €$",
 *   "found": { "one": "{count} contract", "other": "{count} contracts" },
 *   "thanks": { "m": "Thanks, mister.", "f": "Thanks, miss." }
 * }
 * ```
 *
 * A missing key falls back to the same language's other region (`es-mx` to `es-es`), then
 * English, then the key itself, and is logged once per key and language. The game's own text
 * needs no file: put `"LocKey#12345"` (or `key: "UI-…"`) in an ink text, and the game shows
 * its translation.
 *
 * @module
 */

import { transport } from "./transport.js";

/** The language the player chose in the game: its own name (`fr-fr`) and the standard tag (`fr-FR`), for `Intl`. */
export interface Language {
  language: string;
  tag: string;
}

/** Values for a text's `{name}` placeholders. `count` also picks a plural form. */
export type TextParams = Record<string, string | number>;

// The game's language names, and the standard tags Intl knows them by.
const TAGS: Record<string, string> = {
  "en-us": "en-US",
  "ar-ar": "ar",
  "cz-cz": "cs-CZ",
  "de-de": "de-DE",
  "es-es": "es-ES",
  "es-mx": "es-MX",
  "fr-fr": "fr-FR",
  "hu-hu": "hu-HU",
  "it-it": "it-IT",
  "jp-jp": "ja-JP",
  "kr-kr": "ko-KR",
  "pl-pl": "pl-PL",
  "pt-br": "pt-BR",
  "ru-ru": "ru-RU",
  "th-th": "th-TH",
  "tr-tr": "tr-TR",
  "ua-ua": "uk-UA",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
};

/** The standard tag for one of the game's language names: `"fr-fr"` gives `"fr-FR"`. */
export function languageTag(language: string): string {
  return TAGS[language] ?? language;
}

type Entry = string | { [form: string]: Entry };

let current = "en-us";
let gender: "m" | "f" = "m";
const tables = new Map<string, Record<string, Entry> | null>(); // language -> its file, or null when the package has none
const missing = new Set<string>(); // "language\nkey" already logged
const changes = new Set<() => void>();
let started: Promise<void> | null = null;

/** @internal Called when the language or the loaded text changes, so ink can send its texts again. */
export function onTextChange(fn: () => void): () => void {
  changes.add(fn);
  return () => changes.delete(fn);
}

function changed(): void {
  for (const fn of [...changes]) {
    try {
      fn();
    } catch (err) {
      console.warn(`t: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// Where the package's files are: a Node mod's folder, or the page's (or a preview worker's) URL.
async function readLocale(language: string): Promise<Record<string, Entry> | null> {
  const info = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("rednode.package")] as { dir?: string } | undefined;
  try {
    if (info?.dir) {
      const fsName = "node:fs";
      const pathName = "node:path";
      const fs = (await import(fsName)) as { existsSync(p: string): boolean; readFileSync(p: string, e: string): string };
      const path = (await import(pathName)) as { join(...p: string[]): string };
      const file = path.join(info.dir, "locales", `${language}.json`);
      return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Entry>) : null;
    }
    const g = globalThis as { name?: string; location?: { href: string } };
    const base = typeof g.name === "string" && /^https?:|^file:/.test(g.name) ? g.name : g.location?.href;
    if (!base) return null;
    const r = await fetch(new URL(`locales/${language}.json`, base));
    return r.ok ? ((await r.json()) as Record<string, Entry>) : null;
  } catch (err) {
    console.warn(`t: locales/${language}.json could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// The languages a key is looked for in: the player's, the same language's other regions, English.
function chain(language: string): string[] {
  const prefix = language.split("-")[0];
  const others = Object.keys(TAGS).filter((l) => l !== language && l.split("-")[0] === prefix);
  return [...new Set([language, ...others, "en-us"])];
}

async function load(language: string): Promise<void> {
  await Promise.all(
    chain(language)
      .filter((l) => !tables.has(l))
      .map(async (l) => tables.set(l, await readLocale(l))),
  );
}

async function readGender(): Promise<void> {
  try {
    const t = transport();
    const player = (await t.call("rtti.call", { fn: "GetPlayer", args: [{}] })) as { $ref?: number } | null;
    if (!player?.$ref) return;
    const name = await t.call("rtti.call", { self: { $ref: player.$ref }, fn: "GetResolvedGenderName", args: [] });
    void t.call("rtti.release", { refs: [player.$ref] }).catch(() => {});
    const next = String(name).toLowerCase().startsWith("f") ? "f" : "m";
    if (next !== gender) {
      gender = next;
      changed();
    }
  } catch {
    // no player yet: at the main menu; read again at the next save load
  }
}

async function setLanguage(language: string): Promise<void> {
  if (!language || language === current) return;
  current = language;
  await load(language);
  changed();
}

/** @internal Starts following the game's language and V's gender (once). */
export function startText(): Promise<void> {
  if (started) return started;
  started = (async () => {
    let t;
    try {
      t = transport();
    } catch {
      return; // outside REDnode: English
    }
    t.listen((m) => {
      if (m.event !== "game") return;
      if (m.name === "language" && typeof m.language === "string") void setLanguage(m.language);
      if (m.name === "PlayerPuppet.OnGameAttached") void readGender();
    });
    try {
      const r = (await t.call("game.language")) as { language?: string } | null;
      if (r?.language) current = r.language;
    } catch {
      // the game has not said yet: English until its language event
    }
    await load(current);
    await readGender();
    changed();
  })();
  return started;
}

/** @internal The game's language now. */
export function currentLanguage(): Language {
  return { language: current, tag: languageTag(current) };
}

function pick(entry: Entry, params?: TextParams): string | undefined {
  let e: Entry | undefined = entry;
  if (e && typeof e === "object" && ("m" in e || "f" in e)) e = e[gender] ?? e.m ?? e.f;
  if (e && typeof e === "object") {
    const count = Number(params?.count);
    const form = Number.isFinite(count) ? new Intl.PluralRules(languageTag(current)).select(count) : "other";
    e = e[form] ?? e.other;
  }
  return typeof e === "string" ? e : undefined;
}

function resolve(key: string, params?: TextParams): string {
  let text: string | undefined;
  for (const language of chain(current)) {
    const entry = tables.get(language)?.[key];
    if (entry === undefined) continue;
    text = pick(entry, params);
    if (language !== current && !missing.has(`${current}\n${key}`) && tables.get(current) !== undefined) {
      missing.add(`${current}\n${key}`);
      console.warn(`t: no "${key}" in locales/${current}.json; shown from ${language}`);
    }
    break;
  }
  if (text === undefined) {
    if (!missing.has(`*\n${key}`) && tables.size) {
      missing.add(`*\n${key}`);
      console.warn(`t: no "${key}" in any locales file; shown as its key`);
    }
    text = key;
  }
  return params ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all)) : text;
}

/**
 * A text in the player's language that remembers its key: it shows as a string anywhere,
 * and an ink text showing one is sent again when the language changes.
 */
export class LocalText {
  constructor(
    readonly key: string,
    readonly params?: TextParams,
  ) {}
  toString(): string {
    return resolve(this.key, this.params);
  }
  toJSON(): string {
    return this.toString();
  }
}

/**
 * The package's own text in the player's language, from `locales/<language>.json`.
 * `{name}` placeholders take `params`; `count` picks a plural form (`one`, `few`, `many`,
 * `other`, as the language has them); `m` and `f` forms follow V's gender.
 *
 * Until the files are read, a text shows from English or as its key; `await t.ready` first
 * when the text is used once as a plain string. In ink, it is sent again by itself.
 *
 * @example
 * ```ts
 * import { ink, t } from "rednode";
 *
 * ink.mount("hud", { anchor: "top" }, ink.text(t("reward", { amount: 500 }), { style: "value" }));
 * ```
 */
export const t = Object.defineProperty(
  (key: string, params?: TextParams) => {
    void startText();
    return new LocalText(key, params);
  },
  "ready",
  { get: () => startText(), enumerable: true },
) as ((key: string, params?: TextParams) => LocalText) & { readonly ready: Promise<void> };
