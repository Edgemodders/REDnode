/**
 * Native game UI: trees of the game's own ink widgets, drawn by the game itself, on its
 * HUD. Overlay apps and the {@link ui} builder draw in REDnode's overlay, over the game;
 * `ink` builds into the game's UI, the way redscript mods do.
 *
 * A mod describes a tree with tags (`ink.column`, `ink.text` and the rest) and mounts it.
 * REDnode keeps the tree in the plugin and builds it again whenever the game removes it,
 * such as after a save load, and removes it when the mod stops. Change a node with
 * `set()`: every change in the same tick goes to the game in one call.
 *
 * **Needs Codeware** (decided after phase I1). A package that uses `ink` lists
 * `"codeware"` in its `requires`.
 *
 * A tree can also be written as **ink markup**, an `.ink.html` file with the same tags as
 * HTML ({@link ink.load}, {@link ink.parse}; UI Tools, phase UT1).
 *
 * **Status:** the `hud` layer: containers, text, shapes, images, bars and lists, the game's
 * look, game values bound in the plugin, and markup. Input and menus come in later phases
 * (see the Native game UI page).
 *
 * @module
 */

import { LocalText, onTextChange } from "./i18n.js";
import { cleanError, transport } from "./transport.js";
import { InkMarkupError, readMarkup, type MarkupElement, type MarkupPlace } from "./inkmarkup.js";

export { InkMarkupError } from "./inkmarkup.js";

/** Where a node sits in a canvas (a mount or `ink.canvas`); `x` and `y` move it from there. */
export type InkAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right"
  | "fill";

/**
 * A color: `"#rrggbb"` or `"#rrggbbaa"`, `[r, g, b]` or `[r, g, b, a]` from 0 to 255, a name
 * (`white`, `black`, `red`, `cyan`, `yellow`, `green`, `blue`, `grey`), or one of the game's
 * own color names, such as `"MainColors.Yellow"`, which the game keeps exact (HDR and the
 * colorblind themes included). For the usual ones, {@link InkProps.tone} is shorter.
 */
export type InkColor = string | readonly [number, number, number] | readonly [number, number, number, number];

/**
 * A color role of the game's UI, from its own style sheet (`main_colors.inkstyle`):
 *
 * | Tone | The game's color |
 * |---|---|
 * | `normal` | `MainColors.Red`, the game's red UI text |
 * | `accent` | `MainColors.Blue`, its cyan |
 * | `highlight` | `MainColors.Yellow` |
 * | `success` | `MainColors.Green` |
 * | `warning` | `MainColors.Warning` |
 * | `danger` | `MainColors.ActiveRed` |
 * | `dim` | `MainColors.Grey` |
 * | `white` | `MainColors.White` |
 * | `background` | `MainColors.Fullscreen_PrimaryBackgroundDarkest`, for boxes behind text |
 */
export type InkTone = "normal" | "accent" | "highlight" | "success" | "warning" | "danger" | "dim" | "white" | "background";

/**
 * A text style of the game's UI. Sizes and weights come from its style sheet:
 *
 * | Style | Size | Weight | Case | Tone |
 * |---|---|---|---|---|
 * | `title` | 70 | Semi-Bold | upper | normal |
 * | `subtitle` | 60 | Semi-Bold | upper | normal |
 * | `heading` | 50 | Semi-Bold | upper | normal |
 * | `body` | 42 | Medium | as written | normal |
 * | `label` | 38 | Medium | upper | normal |
 * | `value` | 42 | Semi-Bold | as written | accent |
 * | `small` | 30 | Medium | as written | normal |
 * | `fluff` | 25 | Medium | upper | normal, faded as the game's HUD decoration |
 */
export type InkTextStyle = "title" | "subtitle" | "heading" | "body" | "label" | "value" | "small" | "fluff";

/** What every tag takes. */
export interface InkProps {
  /** A name to find the node by with {@link InkMount.get}. */
  id?: string;
  /**
   * `"game"` takes the game's look: its style sheet, its colors and, for text, its fonts and
   * sizes. Giving a `tone` or a text `style` means `"game"` too. `"plain"` (the default for
   * these basic tags) is styled by its own props only.
   */
  look?: "game" | "plain";
  /** One of the game's color roles; see {@link InkTone}. A `color` given wins over it. */
  tone?: InkTone;
  /**
   * In a `column`: `"left"`, `"center"`, `"right"` or `"fill"` (the column's width). In a
   * `row`: `"top"`, `"center"`, `"bottom"` or `"fill"`. Wins over the container's `align`.
   */
  align?: InkAlign;
  /** In a `column` or `row` with a size of its own: takes this share of the space left. */
  grow?: number;
  /** Where the node sits in a canvas. Children of `column` and `row` are placed by them instead. */
  anchor?: InkAnchor;
  /** Moves the node from its anchor, in the layer's units, to the right. */
  x?: number;
  /** Moves the node from its anchor, in the layer's units, down. */
  y?: number;
  /** The node's width. Give `width` and `height` together. */
  width?: number;
  /** The node's height. */
  height?: number;
  /** Space around the node: one number for every side, or `[left, top, right, bottom]`. */
  margin?: number | readonly [number, number, number, number];
  /** Its color (a tint: text and shapes take it as their color). */
  color?: InkColor;
  /** From 0 (invisible) to 1. */
  opacity?: number;
  visible?: boolean;
}

/** How a child lines up across a `column` (left to right) or a `row` (top to bottom). */
export type InkAlign = "left" | "center" | "right" | "top" | "bottom" | "fill";

/**
 * A game value the plugin reads every frame for a bound node (I2c), with no round trip to
 * the mod: `player.health`, `player.healthMax`, `player.stamina` and `player.memory` (0 to 100),
 * `player.money`, `player.level`, `player.streetCred`, `player.x`, `player.y`, `player.z`,
 * `game.hour`, `game.minute`.
 */
export type InkSource =
  | "player.health"
  | "player.healthMax"
  | "player.stamina"
  | "player.memory"
  | "player.money"
  | "player.level"
  | "player.streetCred"
  | "player.x"
  | "player.y"
  | "player.z"
  | "game.hour"
  | "game.minute";

/** Properties of {@link ink.text}. */
export interface InkTextProps extends InkProps {
  /**
   * The text: a string; `"LocKey#12345"`, which the game shows in the player's language and
   * changes by itself with it; or {@link t}'s text, sent again when the language changes.
   */
  text?: string | LocalText;
  /** One of the game's own text keys, such as `"UI-ResourceExports-Inventory"`: the game shows its translation. */
  key?: string;
  /**
   * Shows a game value, read by the plugin every frame and changed on screen only when the
   * shown text changes. The mod sends nothing after this.
   *
   * @example
   * ```ts
   * ink.text("", { style: "value", bind: "player.health", format: "{value} HP" });
   * ```
   */
  bind?: InkSource;
  /** How a bound value shows: `{value}` stands for it. `"{value}"` if not given. */
  format?: string;
  /** Decimals of a bound value, 0 if not given. */
  decimals?: number;
  /** One of the game's text styles; see {@link InkTextStyle}. Its props win over the style's. */
  style?: InkTextStyle;
  /** The font size: the style's, or 32. */
  size?: number;
  /** A font family's depot path; the game's Rajdhani if not given. */
  font?: string;
  /** The font's weight, such as `"Medium"` (the default), `"Semi-Bold"` or `"Bold"`. */
  weight?: string;
  /** `"upper"`, `"lower"` or `"original"`. */
  case?: "upper" | "lower" | "original";
  /** Within the text's own width: `"left"`, `"center"` or `"right"`. */
  textAlign?: "left" | "center" | "right";
}

/** Properties of {@link ink.column}, {@link ink.row} and {@link ink.canvas}. */
export interface InkContainerProps extends InkProps {
  /** Space between the children (`column` and `row`). */
  gap?: number;
  /** Space inside, around the children: one number, or `[left, top, right, bottom]`. */
  pad?: number | readonly [number, number, number, number];
  /** How the children line up across the container, unless they say otherwise; see {@link InkAlign}. */
  align?: InkAlign;
}

/** Properties of {@link ink.image}. */
export interface InkImageProps extends InkProps {
  /** An `.inkatlas` depot path. */
  atlas?: string;
  /** The part of the atlas to show. */
  part?: string;
  /**
   * One of the game's icons, by its TweakDB record, such as a `UIIcon.*` record: REDnode
   * reads its atlas and part (`atlasResourcePath`, `atlasPartName`). Wins over `atlas` and `part`.
   */
  icon?: string;
}

/** Properties of {@link ink.bar}. */
export interface InkBarProps extends InkProps {
  /** The bar's length: 300 if not given. */
  width?: number;
  /** Its thickness: 8 if not given. */
  height?: number;
  /** How full it is, from 0 to 1, when it is not bound. */
  value?: number;
  /** A game value that fills it, read every frame by the plugin; see {@link InkSource}. */
  bind?: InkSource;
  /** What the bound value is out of: a number, or a source such as `"player.healthMax"`. 100 if not given. */
  of?: number | InkSource;
  /** The track's tone, behind the fill: `"background"` if not given. */
  track?: InkTone;
}

/** Properties of {@link ink.list}, besides its items. */
export interface InkListProps<T> extends InkContainerProps {
  /** `"column"` (the default) or `"row"`. */
  direction?: "column" | "row";
  /** The items to show, one node each. */
  items?: readonly T[];
}

/** One widget of a tree. */
export interface InkNode<P extends InkProps = InkProps> {
  /** Unique within the mod. */
  readonly key: string;
  /** The tag, such as `"text"`, or an ink class for {@link ink.widget}. */
  readonly tag: string;
  /** Its properties now. */
  readonly props: Readonly<P>;
  /**
   * Changes some properties. Changes made in the same tick go to the game together.
   *
   * @example
   * ```ts
   * const where = ink.text("");
   * where.set({ text: "Watson", color: "cyan" });
   * ```
   */
  set(props: Partial<P>): void;
}

/** Where a mount's top-level nodes sit, unless they say otherwise. */
export interface InkMountOptions {
  anchor?: InkAnchor;
  x?: number;
  y?: number;
}

/** A tree on a layer of the game's UI. */
export interface InkMount {
  readonly key: string;
  /** A node of this mount by its `id`. */
  get(id: string): InkNode | undefined;
  /**
   * Replaces the mount's tree with a new one built from data, sending only what changed:
   * nodes of the same tag and shape keep their widgets and get the changed props; others are
   * replaced.
   *
   * @example
   * ```ts
   * const draw = (s) => ink.column({ gap: 4 }, ...s.map((t) => ink.text(t, { style: "body" })));
   * const board = ink.mount("hud", { anchor: "left", x: 80 }, draw(["Watson", "Kabuki"]));
   * board.update(draw(["Watson", "Japantown"])); // one text changes
   * ```
   */
  update(...children: InkNode[]): void;
  /** Removes the tree from the game. REDnode also removes it when the mod stops. */
  unmount(): void;
}

const NODE = Symbol("rednode.ink.node");
const FONT = "base\\gameplay\\gui\\fonts\\raj\\raj.inkfontfamily";

const ANCHORS: Record<InkAnchor, [string, number, number]> = {
  "top-left": ["TopLeft", 0, 0],
  top: ["TopCenter", 0.5, 0],
  "top-right": ["TopRight", 1, 0],
  left: ["CenterLeft", 0, 0.5],
  center: ["Centered", 0.5, 0.5],
  right: ["CenterRight", 1, 0.5],
  "bottom-left": ["BottomLeft", 0, 1],
  bottom: ["BottomCenter", 0.5, 1],
  "bottom-right": ["BottomRight", 1, 1],
  fill: ["Fill", 0, 0],
};

const PALETTE: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 97, 88],
  cyan: [94, 246, 255],
  yellow: [252, 238, 10],
  green: [31, 209, 122],
  blue: [64, 140, 255],
  grey: [160, 160, 160],
};

/** @internal A color as [r, g, b, a], 0 to 255. */
export function inkColor(c: InkColor): [number, number, number, number] {
  if (Array.isArray(c)) return [c[0], c[1], c[2], c.length > 3 ? (c as number[])[3] : 255];
  const s = String(c).trim().toLowerCase();
  if (PALETTE[s]) return [...PALETTE[s], 255];
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (!hex) throw new Error(`ink: "${c}" is not a color: use "#rrggbb", [r, g, b], a name such as "cyan", or a game color such as "MainColors.Yellow"`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex[2] ? parseInt(hex[2], 16) : 255];
}

// The game look (I2b): the game's own style sheet, read from its archives with REDbridge
// (main_colors.inkstyle: the MainColors.* names, its text sizes and weights).
const STYLE_SHEET = "base\\gameplay\\gui\\common\\main_colors.inkstyle";

const TONES: Record<InkTone, string> = {
  normal: "MainColors.Red",
  accent: "MainColors.Blue",
  highlight: "MainColors.Yellow",
  success: "MainColors.Green",
  warning: "MainColors.Warning",
  danger: "MainColors.ActiveRed",
  dim: "MainColors.Grey",
  white: "MainColors.White",
  background: "MainColors.Fullscreen_PrimaryBackgroundDarkest",
};

const TEXT_STYLES: Record<InkTextStyle, { size: number; weight: string; upper: boolean; tone: InkTone; opacity?: string }> = {
  title: { size: 70, weight: "Semi-Bold", upper: true, tone: "normal" },
  subtitle: { size: 60, weight: "Semi-Bold", upper: true, tone: "normal" },
  heading: { size: 50, weight: "Semi-Bold", upper: true, tone: "normal" },
  body: { size: 42, weight: "Medium", upper: false, tone: "normal" },
  label: { size: 38, weight: "Medium", upper: true, tone: "normal" },
  value: { size: 42, weight: "Semi-Bold", upper: false, tone: "accent" },
  small: { size: 30, weight: "Medium", upper: false, tone: "normal" },
  fluff: { size: 25, weight: "Medium", upper: true, tone: "normal", opacity: "MainColors.hudFluffOpacity" },
};

const H_ALIGN: Record<string, string> = { left: "Left", center: "Center", right: "Right", fill: "Fill", top: "Left", bottom: "Right" };
const V_ALIGN: Record<string, string> = { top: "Top", center: "Center", bottom: "Bottom", fill: "Fill", left: "Top", right: "Bottom" };
const CASES: Record<string, string> = { upper: "UpperCase", lower: "LowerCase", original: "OriginalCase" };
const TEXT_ALIGN: Record<string, string> = { left: "Left", center: "Center", right: "Right" };

// Icons by TweakDB record: their atlas and part, read once per record.
const icons = new Map<string, Promise<{ atlas: string; part: string } | null>>();

function iconOf(record: string): Promise<{ atlas: string; part: string } | null> {
  let found = icons.get(record);
  if (!found) {
    const flat = (name: string) =>
      transport()
        .call("tweakdb.get", { path: `${record}.${name}` })
        .then((f) => (f as { value?: unknown } | null)?.value ?? null);
    found = Promise.all([flat("atlasResourcePath"), flat("atlasPartName")])
      .then(([atlas, part]) => (atlas && part ? { atlas: String(atlas), part: String(part) } : null))
      .catch(() => null);
    icons.set(record, found);
  }
  return found;
}

interface State {
  key: string;
  tag: string;
  props: Record<string, unknown>;
  children: State[];
  parent: State | null;
  mount: MountState | null;
  sent: Record<string, unknown>; // the wire props the game has
  node: InkNode;
  icon?: { record: string; atlas: string; part: string } | null; // an icon once read from TweakDB
  bar?: InkBarProps; // a bar's own props (ink.bar)
  list?: ListState<unknown>; // a list's renderer and its items by key (ink.list)
}

interface MountState {
  key: string;
  options: InkMountOptions;
  roots: State[];
  open: boolean;
}

let nextKey = 1;
let nextMount = 1;
const openMounts = new Set<MountState>();
let followingText = false;

// t()'s texts in ink follow the language: each one is sent again in the new language.
function followText(): void {
  if (followingText) return;
  followingText = true;
  onTextChange(() => {
    const walk = (list: State[]) => {
      for (const s of list) {
        if ((s.props as InkTextProps).text instanceof LocalText) send(s);
        walk(s.children);
      }
    };
    for (const m of openMounts) walk(m.roots);
  });
}
let queue: Record<string, unknown>[] = [];
let flushing = false;

function enqueue(op: Record<string, unknown>): void {
  queue.push(op);
  if (flushing) return;
  flushing = true;
  queueMicrotask(flush);
}

function flush(): void {
  flushing = false;
  const ops = queue;
  queue = [];
  if (!ops.length) return;
  transport()
    .call("ink.apply", { ops })
    .then((r) => {
      const errors = (r as { errors?: string[] } | null)?.errors ?? [];
      for (const e of errors) console.warn(`ink: ${e}`);
    })
    .catch((err) => {
      const message = cleanError(err).message;
      // The game stops answering while it closes or loads (seen at quit in I2a): one quiet
      // line, not an error. The driver builds the tree again once a save is loaded.
      if (/did not answer/i.test(message)) {
        if (!quietSince || Date.now() - quietSince > 60_000) console.info(`ink: the game did not answer (closing or loading?); changes made meanwhile may not show`);
        quietSince = Date.now();
        return;
      }
      console.warn(`ink: ${message}`);
    });
}
let quietSince = 0;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function sides(m: number | readonly number[]): number[] {
  return typeof m === "number" ? [m, m, m, m] : [m[0], m[1], m[2], m[3]];
}

// The modder's props as the plugin's: anchors and offsets, colors as numbers or the game's
// color names, gaps and alignment as the children's margins and alignment, the game look as
// its style sheet with bindings.
function wire(s: State): Record<string, unknown> {
  const p = s.props as InkTextProps & InkContainerProps & InkImageProps;
  const out: Record<string, unknown> = {};
  const parent = s.parent;
  const parentTag = parent?.tag;
  const inPanel = parentTag === "column" || parentTag === "row";
  if (!inPanel) {
    const opts = parent ? {} : (s.mount?.options ?? {});
    const anchor = p.anchor ?? opts.anchor ?? "top-left";
    const a = ANCHORS[anchor];
    if (!a) throw new Error(`ink: "${anchor}" is not an anchor: use top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right or fill`);
    out.anchor = a[0];
    out.anchorPoint = [a[1], a[2]];
    out.translation = [p.x ?? opts.x ?? 0, p.y ?? opts.y ?? 0];
  } else {
    // In a column, a child lines up across it (left to right); in a row, top to bottom.
    const pp = parent!.props as InkContainerProps;
    const align = p.align ?? pp.align;
    if (align !== undefined) {
      const table = parentTag === "column" ? H_ALIGN : V_ALIGN;
      if (!table[align]) throw new Error(`ink: "${align}" is not an align: use left, center, right, top, bottom or fill`);
      out[parentTag === "column" ? "hAlign" : "vAlign"] = table[align];
    }
    if (p.grow !== undefined) {
      out.sizeRule = p.grow > 0 ? "Stretch" : "Fixed";
      out.sizeCoefficient = p.grow;
    }
  }
  let margin = p.margin !== undefined ? sides(p.margin) : null;
  if (inPanel && margin === null && parent) {
    // Always sent in a panel, so a child that becomes the first loses its gap (I2c's lists).
    const gap = parent.children.indexOf(s) > 0 ? ((parent.props as InkContainerProps).gap ?? 0) : 0;
    margin = parentTag === "column" ? [0, gap, 0, 0] : [gap, 0, 0, 0];
  }
  if (margin) out.margin = margin;
  if (p.pad !== undefined) out.padding = sides(p.pad);
  if (p.width !== undefined || p.height !== undefined) out.size = [p.width ?? 0, p.height ?? 0];
  // Panels and text with no size take their content's, so an anchor such as top-right
  // places them by their real size (a panel's own size reads 0x0 in the game).
  else if (s.tag === "column" || s.tag === "row" || s.tag === "text") out.fitToContent = true;

  // The game look: asked for, or implied by a tone or a text style.
  const textStyle = s.tag === "text" && p.style !== undefined ? TEXT_STYLES[p.style] : undefined;
  if (s.tag === "text" && p.style !== undefined && !textStyle) {
    throw new Error(`ink: "${p.style}" is not a text style: use ${Object.keys(TEXT_STYLES).join(", ")}`);
  }
  const game = p.look === "game" || (p.look !== "plain" && (p.tone !== undefined || textStyle !== undefined));
  const bind: Record<string, string> = {};
  if (game) out.styleSheet = STYLE_SHEET;
  const gameColor = typeof p.color === "string" && /^[A-Za-z]+\.[A-Za-z0-9_.]+$/.test(p.color) ? p.color : undefined;
  if (gameColor) {
    out.styleSheet = STYLE_SHEET;
    bind.tintColor = gameColor;
  } else if (p.color !== undefined) {
    out.tint = inkColor(p.color);
  } else if (game) {
    const tone = p.tone ?? textStyle?.tone ?? (s.tag === "rect" || s.tag === "circle" ? "background" : "normal");
    if (!TONES[tone]) throw new Error(`ink: "${tone}" is not a tone: use ${Object.keys(TONES).join(", ")}`);
    bind.tintColor = TONES[tone];
  }
  if (textStyle?.opacity && p.opacity === undefined) bind.opacity = textStyle.opacity;
  if (Object.keys(bind).length) out.bind = bind;
  if (p.opacity !== undefined) out.opacity = p.opacity;
  if (p.visible !== undefined) out.visible = p.visible;

  if (s.tag === "text") {
    out.font = [p.font ?? FONT, p.weight ?? textStyle?.weight ?? "Medium"];
    out.fontSize = p.size ?? textStyle?.size ?? 32;
    // The game's own text by its key (I2d): the game draws it in the player's language.
    const gameKey = p.key ?? (typeof p.text === "string" && p.text.startsWith("LocKey#") ? p.text : undefined);
    if (gameKey !== undefined) out.locKey = gameKey;
    else out.text = p.text === undefined ? "" : String(p.text);
    const letterCase = p.case ?? (textStyle?.upper ? "upper" : undefined);
    if (letterCase !== undefined) out.letterCase = CASES[letterCase] ?? "OriginalCase";
    if (p.textAlign !== undefined) out.textAlign = TEXT_ALIGN[p.textAlign] ?? "Left";
    if (p.color === undefined && !game) out.tint = PALETTE.white.concat(255);
  }
  if (s.tag === "image") {
    const icon = p.icon !== undefined && s.icon?.record === p.icon ? s.icon : null;
    if (icon) {
      out.atlas = icon.atlas;
      out.part = icon.part;
    } else {
      if (p.atlas !== undefined) out.atlas = p.atlas;
      if (p.part !== undefined) out.part = p.part;
    }
  }
  if (s.tag === "text" && p.bind !== undefined) {
    out.binding = { source: p.bind, target: "text", format: p.format ?? "{value}", decimals: p.decimals ?? 0 };
  }
  // A bar's fill (internal props, set by ink.bar): scaled from its left edge.
  const internal = s.props as { $pivot?: number[]; $scale?: number[]; $binding?: unknown };
  if (internal.$pivot) out.pivot = internal.$pivot;
  if (internal.$scale) out.scale = internal.$scale;
  if (internal.$binding) out.binding = internal.$binding;
  // ink.widget: capitalized props are the widget's own methods, passed as they are.
  for (const [k, v] of Object.entries(p)) if (/^[A-Z]/.test(k)) out[k] = v;
  if (p.id !== undefined) out.name = p.id;
  return out;
}

// The props that changed since the game last had them. Bindings dropped since are sent as
// null, which unties them.
function changes(t: State, now: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(now)) if (!same(t.sent[k], v)) changed[k] = v;
  const before = (t.sent.bind ?? {}) as Record<string, string | null>;
  const after = (now.bind ?? {}) as Record<string, string | null>;
  const dropped = Object.keys(before).filter((k) => !(k in after));
  if (dropped.length || "bind" in changed) {
    changed.bind = { ...Object.fromEntries(dropped.map((k) => [k, null])), ...after };
  }
  if (t.sent.binding && !now.binding) changed.binding = null; // unbound: the plugin stops reading it
  return changed;
}

// Reads an image's icon from TweakDB, then sends its atlas and part.
function resolveIcon(s: State): void {
  const record = (s.props as InkImageProps).icon;
  if (s.tag !== "image" || !record || s.icon?.record === record) return;
  void iconOf(record).then((found) => {
    if ((s.props as InkImageProps).icon !== record) return; // changed since
    if (!found) {
      console.warn(`ink: no icon "${record}" in TweakDB (its atlasResourcePath and atlasPartName)`);
      return;
    }
    s.icon = { record, ...found };
    send(s);
  });
}

function send(t: State): void {
  if (!t.mount?.open) return;
  const now = wire(t);
  const changed = changes(t, now);
  t.sent = now;
  if (Object.keys(changed).length) enqueue({ op: "set", mount: t.mount.key, key: t.key, props: changed });
}

function add(s: State, mount: MountState, index?: number): void {
  if (s.mount) throw new Error(`ink: a node is in one mount at a time (${s.tag} ${s.key} is mounted already)`);
  s.mount = mount;
  s.sent = wire(s);
  const op: Record<string, unknown> = { op: "add", mount: mount.key, key: s.key, parent: s.parent?.key ?? "", tag: s.tag, props: s.sent };
  if (index !== undefined) op.index = index;
  enqueue(op);
  resolveIcon(s);
  for (const c of s.children) add(c, mount);
}

function detach(s: State): void {
  s.mount = null;
  s.sent = {};
  for (const c of s.children) detach(c);
}

function stateOf(n: unknown): State {
  const s = (n as Record<symbol, State> | null)?.[NODE];
  if (!s) throw new Error("ink: not an ink node");
  return s;
}

function siblingsOf(s: State, mount: MountState | null): State[] {
  return s.parent ? s.parent.children : (mount?.roots ?? []);
}

// A panel's children take their gap and alignment from their place: send them again after
// the children changed.
function resendChildren(list: State[]): void {
  for (const c of list) send(c);
}

// Puts a node at a place among a parent's children (or a mount's roots), on screen too.
function attach(s: State, parent: State | null, mount: MountState | null, index: number): void {
  if (s.parent || s.mount) throw new Error(`ink: ${s.tag} ${s.key} has a place already`);
  s.parent = parent;
  const list = parent ? parent.children : (mount?.roots ?? []);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, s);
  const m = parent ? parent.mount : mount;
  if (m?.open) add(s, m, at < list.length - 1 ? at : undefined);
}

// Takes a node off its parent and the screen.
function remove(s: State): void {
  const m = s.mount;
  const list = siblingsOf(s, m);
  const at = list.indexOf(s);
  if (at >= 0) list.splice(at, 1);
  if (m?.open) enqueue({ op: "remove", mount: m.key, key: s.key });
  detach(s);
  s.parent = null;
}

function move(s: State, index: number): void {
  const m = s.mount;
  const list = siblingsOf(s, m);
  const from = list.indexOf(s);
  if (from < 0 || from === index) return;
  list.splice(from, 1);
  list.splice(index, 0, s);
  if (m?.open) enqueue({ op: "move", mount: m.key, key: s.key, index });
}

// Brings a node in line with a freshly built one: the same tag and shape keep the widget and
// send only the props that changed; anything else is replaced. Returns the node that stays.
function patch(old: State, fresh: State): State {
  // The same tag keeps the widget; children are matched by place, and the extra ones added or
  // removed. Lists and bars keep their own children, so another of them is replaced.
  const sameShape =
    old.tag === fresh.tag &&
    old.list === undefined &&
    fresh.list === undefined &&
    (old.bar === undefined) === (fresh.bar === undefined);
  if (!sameShape) {
    const parent = old.parent;
    const m = old.mount;
    const at = siblingsOf(old, m).indexOf(old);
    remove(old);
    attach(fresh, parent, m, at);
    return fresh;
  }
  old.props = { ...fresh.props };
  old.bar = fresh.bar;
  if (old.mount?.open) {
    send(old);
    resolveIcon(old);
  }
  const freshChildren = fresh.children.slice();
  for (const extra of old.children.slice(freshChildren.length)) remove(extra);
  freshChildren.forEach((f, i) => {
    f.parent = null; // it joins old, or is patched into old's child
    if (i < old.children.length) {
      const kept = patch(old.children[i], f);
      if (kept !== old.children[i]) old.children[i] = kept;
    } else attach(f, old, old.mount, i);
  });
  if (old.tag === "column" || old.tag === "row") resendChildren(old.children);
  return old;
}

function find(list: State[], id: string): State | undefined {
  for (const s of list) {
    if ((s.props as InkProps).id === id) return s;
    const found = find(s.children, id);
    if (found) return found;
  }
  return undefined;
}

type Child = InkNode;

function isNode(v: unknown): v is InkNode {
  return !!v && typeof v === "object" && NODE in (v as object);
}

function newState(tag: string, props: Record<string, unknown>): State {
  return { key: `k${nextKey++}`, tag, props: { ...props }, children: [], parent: null, mount: null, sent: {}, node: null as unknown as InkNode };
}

function make<P extends InkProps>(tag: string, props: P, children: Child[] = []): InkNode<P> {
  const s = newState(tag, props as Record<string, unknown>);
  for (const c of children) {
    const cs = (c as unknown as Record<symbol, State>)[NODE];
    if (!cs) throw new Error(`ink: a child of ${tag} is not an ink node`);
    if (cs.parent) throw new Error(`ink: a node has one parent (${cs.tag} ${cs.key} has one already)`);
    cs.parent = s;
    s.children.push(cs);
  }
  return expose<P>(s, (next) => {
    Object.assign(s.props, next);
    if (!s.mount?.open) return;
    // A panel's gap and align are its children's margins and alignment: they change with it.
    const touched = [s, ...("gap" in next || "align" in next ? s.children : [])];
    for (const t of touched) send(t);
    if ("icon" in next) resolveIcon(s);
  });
}

function expose<P extends InkProps>(s: State, set: (next: Partial<P>) => void): InkNode<P> {
  const node: InkNode<P> = {
    key: s.key,
    tag: s.tag,
    get props() {
      return (s.bar ?? s.props) as Readonly<P>;
    },
    set,
  };
  Object.defineProperty(node, NODE, { value: s });
  s.node = node;
  return node;
}

// (props?, ...children) for containers: the props come first when given.
function container<P extends InkContainerProps>(tag: string, args: (P | Child)[]): InkNode<P> {
  const [first, ...rest] = args;
  if (first !== undefined && !isNode(first)) return make(tag, first as P, rest as Child[]);
  return make(tag, {} as P, args as Child[]);
}

// ink.bar: a canvas with a track and a fill, the fill scaled from its left edge.
function barParts(b: InkBarProps): { canvas: Record<string, unknown>; track: Record<string, unknown>; fill: Record<string, unknown> } {
  const { value, bind, of, track, tone, color, width, height, ...rest } = b;
  const canvas = { ...rest, width: width ?? 300, height: height ?? 8 };
  const fill: Record<string, unknown> = { anchor: "fill", $pivot: [0, 0.5] };
  if (color !== undefined) fill.color = color;
  else fill.tone = tone ?? "normal";
  if (bind !== undefined) fill.$binding = { source: bind, target: "scaleX", of: of ?? 100 };
  else fill.$scale = [Math.max(0, Math.min(1, value ?? 0)), 1];
  return { canvas, track: { anchor: "fill", tone: track ?? "background" }, fill };
}

function makeBar(b: InkBarProps): InkNode<InkBarProps> {
  const parts = barParts(b);
  const s = newState("canvas", parts.canvas);
  s.bar = { ...b };
  const trackState = newState("rect", parts.track);
  const fillState = newState("rect", parts.fill);
  for (const c of [trackState, fillState]) {
    c.parent = s;
    s.children.push(c);
    expose(c, () => {});
  }
  return expose<InkBarProps>(s, (next) => {
    s.bar = { ...s.bar, ...next };
    const now = barParts(s.bar as InkBarProps);
    s.props = now.canvas;
    s.children[0].props = now.track;
    s.children[1].props = now.fill;
    for (const t of [s, ...s.children]) send(t);
  });
}

// ink.list: a column or row of one node per item, by key.
interface ListState<T> {
  render: (item: T, index: number) => InkNode;
  key: (item: T, index: number) => string | number;
  entries: Map<string | number, State>;
}

function setItems<T>(s: State, items: readonly T[]): void {
  const list = s.list as ListState<T>;
  const keys = items.map((item, i) => list.key(item, i));
  if (new Set(keys).size !== keys.length) throw new Error("ink: ink.list's keys must be unique");
  for (const [k, st] of [...list.entries]) {
    if (!keys.includes(k)) {
      remove(st);
      list.entries.delete(k);
    }
  }
  items.forEach((item, i) => {
    const k = keys[i];
    const fresh = stateOf(list.render(item, i));
    const st = list.entries.get(k);
    if (!st) {
      attach(fresh, s, s.mount, i);
      list.entries.set(k, fresh);
      return;
    }
    move(st, i);
    const kept = patch(st, fresh);
    if (kept !== st) list.entries.set(k, kept);
  });
  resendChildren(s.children);
}

function makeList<T>(
  props: InkListProps<T>,
  render: (item: T, index: number) => InkNode,
  key: (item: T, index: number) => string | number,
): InkNode<InkListProps<T>> {
  const { direction, items, ...rest } = props;
  const s = newState(direction === "row" ? "row" : "column", rest as Record<string, unknown>);
  s.list = { render, key, entries: new Map() } as ListState<unknown>;
  setItems(s, items ?? []);
  return expose<InkListProps<T>>(s, (next) => {
    const { items: nextItems, direction: _d, ...other } = next;
    if (Object.keys(other).length) {
      Object.assign(s.props, other);
      for (const t of [s, ...("gap" in other || "align" in other ? s.children : [])]) send(t);
    }
    if (nextItems) setItems(s, nextItems);
  });
}

// ---------- ink markup (UT1) ----------
// An .ink.html file's tags are the tag functions' names, their attributes the props. The
// markup is read once into a template; a view builds the template's nodes with the tag
// functions, then follows the named data: set() sends only the props that read what changed.

/**
 * A tree written as ink markup and put on the game's UI, from {@link ink.parse} or
 * {@link ink.load}.
 */
export interface InkView {
  /** The mounts its `<mount>` tags made, in order. */
  readonly mounts: readonly InkMount[];
  /** The named data the markup reads (`{name}`), as now. */
  readonly data: Readonly<Record<string, unknown>>;
  /** A node by its `id`, in any of its mounts. */
  get(id: string): InkNode | undefined;
  /**
   * Changes some named data. Only the props and lists that read a changed name are sent again,
   * and a list sends only the items that changed.
   *
   * @example
   * ```ts
   * board.set({ contracts: await fetchContracts() });
   * ```
   */
  set(data: Record<string, unknown>): void;
  /** Removes its mounts from the game. REDnode also removes them when the mod stops. */
  unmount(): void;
}

// "json": a <widget> method's value, read as JSON when it looks like JSON (numbers, arrays).
// "data": a list's items, taken as they are.
type Kind = "number" | "boolean" | "sides" | "string" | "of" | "json" | "data" | readonly string[];

const SOURCES: readonly InkSource[] = [
  "player.health", "player.healthMax", "player.stamina", "player.memory", "player.money", "player.level",
  "player.streetCred", "player.x", "player.y", "player.z", "game.hour", "game.minute",
];
const KINDS: Record<string, Kind> = {
  id: "string", look: ["game", "plain"], tone: Object.keys(TONES), align: ["left", "center", "right", "top", "bottom", "fill"],
  grow: "number", anchor: Object.keys(ANCHORS), x: "number", y: "number", width: "number", height: "number",
  margin: "sides", color: "string", opacity: "number", visible: "boolean",
  gap: "number", pad: "sides",
  text: "string", key: "string", bind: SOURCES, format: "string", decimals: "number", style: Object.keys(TEXT_STYLES),
  size: "number", font: "string", weight: "string", case: ["upper", "lower", "original"], textAlign: ["left", "center", "right"],
  atlas: "string", part: "string", icon: "string",
  value: "number", of: "of", track: Object.keys(TONES),
  direction: ["column", "row"], items: "data",
  layer: ["hud"], class: "string",
};
const BASE_ATTRS = ["id", "look", "tone", "align", "grow", "anchor", "x", "y", "width", "height", "margin", "color", "opacity", "visible"];
const PANEL_ATTRS = [...BASE_ATTRS, "gap", "pad"];
// What each tag takes, and what may go inside it.
const MARKUP_TAGS: Record<string, { attrs: string[]; inside: "nodes" | "text" | "none" | "item" }> = {
  mount: { attrs: ["layer", "anchor", "x", "y"], inside: "nodes" },
  canvas: { attrs: PANEL_ATTRS, inside: "nodes" },
  column: { attrs: PANEL_ATTRS, inside: "nodes" },
  row: { attrs: PANEL_ATTRS, inside: "nodes" },
  text: { attrs: [...BASE_ATTRS, "text", "key", "bind", "format", "decimals", "style", "size", "font", "weight", "case", "textAlign"], inside: "text" },
  rect: { attrs: BASE_ATTRS, inside: "none" },
  circle: { attrs: BASE_ATTRS, inside: "none" },
  image: { attrs: [...BASE_ATTRS, "atlas", "part", "icon"], inside: "none" },
  bar: { attrs: [...BASE_ATTRS, "value", "bind", "of", "track"], inside: "none" },
  list: { attrs: [...PANEL_ATTRS, "direction", "items", "key"], inside: "item" },
  widget: { attrs: [...BASE_ATTRS, "class"], inside: "nodes" },
};
const ALIASES: Record<string, string> = { vbox: "column", hbox: "row" };

/** A value as written: plain, or with `{name}` parts read from the data. */
type Part = string | { path: string };
interface Value {
  parts: Part[];
  /** The value is one `{name}` alone: it takes the data's value as it is, not as text. */
  whole: boolean;
  names: string[];
  place: MarkupPlace;
}

interface Template {
  tag: string;
  place: MarkupPlace;
  props: Record<string, Value>;
  kinds: Record<string, Kind>;
  children: Template[];
  /** For `list`: the one node each item gets. */
  item?: Template;
  /** For `widget`: the ink class. */
  className?: string;
  events: { event: string; name: string; place: MarkupPlace }[];
  /** Every data name it, or anything inside it, reads. */
  names: Set<string>;
}

const PATH = /^(\.|\$index|[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*)$/;

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function splitValue(text: string, place: MarkupPlace, fail: (reason: string, at: MarkupPlace) => never): Value {
  const parts: Part[] = [];
  const names: string[] = [];
  let i = 0;
  let lit = "";
  while (i < text.length) {
    if (text.startsWith("{{", i) || text.startsWith("}}", i)) {
      lit += text[i];
      i += 2;
      continue;
    }
    if (text[i] === "}") fail('a "}" with no "{": write }} for the character', place);
    if (text[i] !== "{") {
      lit += text[i++];
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) fail(`"${text.slice(i, i + 20)}" is not closed with }`, place);
    const path = text.slice(i + 1, end).trim();
    if (!PATH.test(path)) fail(`{${path}} is not a data name: write {name}, {name.field}, {.} or {$index} (no expressions)`, place);
    if (lit) parts.push(lit);
    lit = "";
    parts.push({ path });
    if (path !== "." && path !== "$index") names.push(path.split(".")[0]);
    i = end + 1;
  }
  if (lit) parts.push(lit);
  return { parts, whole: parts.length === 1 && typeof parts[0] !== "string", names, place };
}

// One attribute's text as its prop's type, or a reason it is not.
function convert(kind: Kind, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (Array.isArray(kind)) {
    const s = String(value);
    return kind.includes(s) ? { ok: true, value: s } : { ok: false, reason: `"${s}" is not one of: ${kind.join(", ")}` };
  }
  switch (kind) {
    case "data":
      return { ok: true, value };
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      return Number.isFinite(n) && String(value).trim() !== "" ? { ok: true, value: n } : { ok: false, reason: `"${value}" is not a number` };
    }
    case "boolean":
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true" || value === "") return { ok: true, value: true };
      if (value === "false") return { ok: true, value: false };
      return { ok: false, reason: `"${value}" is not true or false` };
    case "sides": {
      if (typeof value === "number") return { ok: true, value };
      if (Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === "number")) return { ok: true, value };
      const nums = String(value).trim().split(/[\s,]+/).map(Number);
      if (nums.every(Number.isFinite) && nums.length === 1) return { ok: true, value: nums[0] };
      if (nums.every(Number.isFinite) && nums.length === 4) return { ok: true, value: nums };
      return { ok: false, reason: `"${value}" is not one number or four (left top right bottom)` };
    }
    case "of": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (Number.isFinite(n)) return { ok: true, value: n };
      return (SOURCES as readonly string[]).includes(String(value))
        ? { ok: true, value: String(value) }
        : { ok: false, reason: `"${value}" is not a number or a game value (${SOURCES.join(", ")})` };
    }
    default:
      return { ok: true, value: typeof value === "string" ? value : String(value) };
  }
}

function compileMarkup(source: string, handlers: Record<string, unknown> | undefined, file?: string): Template[] {
  function fail(reason: string, at: MarkupPlace): never {
    throw new InkMarkupError(reason, at.line, at.column, file);
  }
  const tagNames = Object.keys(MARKUP_TAGS).filter((t) => t !== "mount");

  const compile = (el: MarkupElement, parentTag: string): Template => {
    const tag = ALIASES[el.tag] ?? el.tag;
    const spec = MARKUP_TAGS[tag];
    if (!spec) fail(`<${el.tag}> is not an ink tag: use ${tagNames.join(", ")}`, el);
    if (tag === "mount" && parentTag !== "") fail("<mount> goes at the top of the file, not inside another tag", el);
    const t: Template = { tag, place: el, props: {}, kinds: {}, children: [], events: [], names: new Set() };
    for (const a of el.attributes) {
      const name = camel(a.name);
      if (/^on[A-Za-z]/.test(a.name)) {
        if (tag === "mount") fail(`<mount> takes no events`, a);
        if (a.value === true || !/^[A-Za-z_$][\w$]*$/.test(a.value)) fail(`${a.name} names a function of the handlers: ${a.name}="name"`, a);
        if (!handlers) fail(`${a.name}="${a.value}" needs handlers: pass the module or object with that function to ink.parse or ink.load`, a);
        if (typeof handlers[a.value] !== "function") {
          const offered = Object.keys(handlers).filter((k) => typeof handlers[k] === "function");
          fail(`${a.name}="${a.value}": the handlers have no function ${a.value}${offered.length ? ` (they have: ${offered.join(", ")})` : ""}`, a);
        }
        t.events.push({ event: a.name.slice(2).toLowerCase(), name: a.value, place: a });
        continue;
      }
      const capital = /^[A-Z]/.test(a.name);
      if (capital && tag !== "widget") fail(`${a.name}: a method call is for <widget> only`, a);
      if (!capital && !spec.attrs.includes(name)) fail(`<${el.tag}> takes no ${a.name}: it takes ${spec.attrs.join(", ")}`, a);
      if (tag === "widget" && name === "class") {
        if (typeof a.value !== "string" || !a.value) fail('class names the ink class: class="inkBorder"', a);
        t.className = a.value;
        continue;
      }
      const kind: Kind = capital ? "string" : KINDS[name];
      if (a.value === true) {
        if (kind !== "boolean") fail(`${a.name} needs a value: ${a.name}="..."`, a);
        t.props[name] = { parts: ["true"], whole: false, names: [], place: a };
        t.kinds[name] = kind;
        continue;
      }
      // items names the list's data: items="contracts", or items="{contracts}".
      const text = tag === "list" && name === "items" && !a.value.includes("{") ? `{${a.value}}` : a.value;
      const v = splitValue(text, a, fail);
      if (tag === "list" && name === "key") {
        if (!PATH.test(a.value) || a.value.includes("{")) fail('key names the field each item is known by: key="id"', a);
        v.parts = [a.value];
        v.names = [];
      }
      if ((tag === "mount" || (tag === "list" && name === "direction")) && v.names.length) fail(`${a.name} takes no data: write it as it is`, a);
      if (tag === "list" && name === "items" && !v.whole) fail('items names one piece of data: items="contracts"', a);
      if (!v.names.length && !v.parts.some((p) => typeof p !== "string")) {
        // Written as it is: checked now.
        const c = convert(kind, v.parts.join(""));
        if (!c.ok) fail(`${a.name}: ${c.reason}`, a);
      }
      t.props[name] = v;
      t.kinds[name] = capital && JSON_LIKE.test(v.parts.join("")) ? "json" : kind;
      for (const n of v.names) t.names.add(n);
    }
    const elements = el.children.filter((c): c is MarkupElement => c.type === "element");
    const text = el.children.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    if (spec.inside === "text") {
      if (elements.length) fail(`<text> holds text only, not <${elements[0].tag}>`, elements[0]);
      const content = text.replace(/\s+/g, " ").trim();
      if (content) {
        if (t.props.text) fail("<text> has its text twice: as text= and inside the tag", el);
        const v = splitValue(content, el.children.find((c) => c.type === "text") as MarkupPlace, fail);
        t.props.text = v;
        t.kinds.text = "string";
        for (const n of v.names) t.names.add(n);
      }
    } else {
      if (text.trim()) {
        const where = el.children.find((c) => c.type === "text" && c.text.trim()) as MarkupPlace;
        fail(`text inside <${el.tag}> goes in a <text> tag: <text>${text.trim().slice(0, 30)}</text>`, where);
      }
      if (spec.inside === "none" && elements.length) fail(`<${el.tag}> holds nothing: write <${el.tag} ... />`, elements[0]);
      if (spec.inside === "item") {
        if (elements.length !== 1) fail(`<list> holds the one tag each item gets (found ${elements.length}): wrap them in a <row> or <column>`, el);
        if (!t.props.items) fail('<list> needs items: items="contracts"', el);
        t.item = compile(elements[0], tag);
        for (const n of t.item.names) t.names.add(n);
      } else {
        t.children = elements.map((c) => compile(c, tag));
        for (const c of t.children) for (const n of c.names) t.names.add(n);
      }
    }
    if (tag === "widget" && !t.className) fail('<widget> needs class="..." naming the ink class', el);
    return t;
  };

  const roots = readMarkup(source, file);
  const out: Template[] = [];
  for (const c of roots) {
    if (c.type === "text") {
      if (c.text.trim()) fail("text goes inside a <mount>", c);
      continue;
    }
    if (c.tag !== "mount") fail(`the top of the file holds <mount> tags, not <${c.tag}>: <mount layer="hud" anchor="top-right">...</mount>`, c);
    out.push(compile(c, ""));
  }
  if (!out.length) fail('no <mount> in the markup: <mount layer="hud">...</mount>', { line: 1, column: 1 });
  return out;
}

const JSON_LIKE = /^\s*(\[.*\]|\{.*\}|-?\d+(\.\d+)?|true|false)\s*$/s;

interface Scope {
  data: Record<string, unknown>;
  item?: unknown;
  index?: number;
  parent?: Scope;
}

function lookup(path: string, scope: Scope): unknown {
  if (path === ".") return scope.item;
  if (path === "$index") return scope.index;
  const [head, ...rest] = path.split(".");
  let base: unknown;
  for (let s: Scope | undefined = scope; s; s = s.parent) {
    if (s.item !== null && typeof s.item === "object" && head in (s.item as object)) {
      base = (s.item as Record<string, unknown>)[head];
      break;
    }
    if (!s.parent) base = s.data[head];
  }
  return rest.reduce<unknown>((v, k) => (v === null || v === undefined ? undefined : (v as Record<string, unknown>)[k]), base);
}

function evaluate(t: Template, name: string, scope: Scope, file?: string): unknown {
  const v = t.props[name];
  const kind = t.kinds[name];
  let raw: unknown;
  if (v.whole) raw = lookup((v.parts[0] as { path: string }).path, scope);
  else {
    raw = v.parts.map((p) => (typeof p === "string" ? p : (lookup(p.path, scope) ?? ""))).join("");
  }
  if (kind === "json") {
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }
  const c = convert(kind, raw);
  if (!c.ok) throw new InkMarkupError(`${name}: ${c.reason} (from the data)`, v.place.line, v.place.column, file);
  return c.value;
}

interface Follow {
  node: InkNode;
  template: Template;
  scope: Scope;
  /** The props it reads data for, or "items" for a list. */
  props: string[];
}

function buildMarkup(t: Template, scope: Scope, follows: Follow[] | null, file?: string): InkNode {
  const props: Record<string, unknown> = {};
  for (const name of Object.keys(t.props)) {
    if (t.tag === "list" && (name === "items" || name === "key")) continue;
    const value = evaluate(t, name, scope, file);
    if (value !== undefined) props[name] = value;
  }
  const children = () => t.children.map((c) => buildMarkup(c, scope, follows, file));
  let node: InkNode;
  switch (t.tag) {
    case "text": {
      const { text, ...rest } = props as InkTextProps;
      node = ink.text(text ?? "", rest);
      break;
    }
    case "canvas":
    case "column":
    case "row":
      node = container(t.tag, [props as InkContainerProps, ...children()]);
      break;
    case "rect":
    case "circle":
    case "image":
      node = make(t.tag, props as InkProps);
      break;
    case "bar":
      node = makeBar(props as InkBarProps);
      break;
    case "widget":
      node = make(t.className!, props as InkProps, children());
      break;
    case "list": {
      const keyField = t.props.key ? (t.props.key.parts[0] as string) : undefined;
      const items = evaluate(t, "items", scope, file);
      if (items !== undefined && !Array.isArray(items)) {
        const v = t.props.items;
        throw new InkMarkupError(`items: the data's ${(v.parts[0] as { path: string }).path} is not an array`, v.place.line, v.place.column, file);
      }
      node = makeList<unknown>(
        { ...(props as InkListProps<unknown>), items: (items as unknown[] | undefined) ?? [] },
        (item, index) => buildMarkup(t.item!, { data: scope.data, item, index, parent: scope }, null, file),
        keyField ? (item, index) => (lookup(keyField, { data: {}, item, index }) as string | number) ?? index : (_item, index) => index,
      );
      break;
    }
    default:
      throw new Error(`ink: no tag ${t.tag}`);
  }
  if (follows) {
    const read = Object.keys(t.props).filter((n) => t.props[n].names.length && !(t.tag === "list" && n === "key"));
    if (t.tag === "list" && t.names.size) follows.push({ node, template: t, scope, props: ["items"] });
    else if (read.length) follows.push({ node, template: t, scope, props: read });
  }
  return node;
}

function markupView(source: string, handlers: Record<string, unknown> | undefined, initial: Record<string, unknown> | undefined, file?: string): InkView {
  const templates = compileMarkup(source, handlers, file);
  const data: Record<string, unknown> = { ...(initial ?? {}) };
  const scope: Scope = { data };
  const follows: Follow[] = [];
  const mounts = templates.map((m) => {
    const opts: InkMountOptions = {};
    for (const k of ["anchor", "x", "y"] as const) {
      if (m.props[k]) (opts as Record<string, unknown>)[k] = evaluate(m, k, scope, file);
    }
    const layer = (m.props.layer ? evaluate(m, "layer", scope, file) : "hud") as "hud";
    return ink.mount(layer, opts, ...m.children.map((c) => buildMarkup(c, scope, follows, file)));
  });
  return {
    mounts,
    get data() {
      return data;
    },
    get(id) {
      for (const m of mounts) {
        const found = m.get(id);
        if (found) return found;
      }
      return undefined;
    },
    set(next) {
      Object.assign(data, next);
      const changed = new Set(Object.keys(next));
      for (const f of follows) {
        if (![...(f.props[0] === "items" ? f.template.names : f.props.flatMap((p) => f.template.props[p].names))].some((n) => changed.has(n))) continue;
        if (f.props[0] === "items") {
          const items = evaluate(f.template, "items", f.scope, file);
          (f.node as InkNode<InkListProps<unknown>>).set({ items: Array.isArray(items) ? items : [] });
          continue;
        }
        const update: Record<string, unknown> = {};
        for (const p of f.props) if (f.template.props[p].names.some((n) => changed.has(n))) update[p] = evaluate(f.template, p, f.scope, file);
        f.node.set(update);
      }
    },
    unmount() {
      for (const m of mounts) m.unmount();
    },
  };
}

async function readPackageFile(file: string): Promise<{ text: string; name: string }> {
  const g = globalThis as Record<PropertyKey, unknown>;
  // The docs simulation reads a preview's files over HTTP.
  const read = g[Symbol.for("rednode.readFile")] as ((file: string) => Promise<string>) | undefined;
  if (read) return { text: await read(file), name: file };
  const info = g[Symbol.for("rednode.package")] as { dir?: string } | undefined;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const full = path.isAbsolute(file) ? file : path.resolve(info?.dir ?? process.cwd(), file);
  try {
    return { text: await fs.readFile(full, "utf8"), name: path.basename(full) };
  } catch (err) {
    throw new Error(`ink: cannot read ${file} (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}): a relative path starts at the package's folder`);
  }
}

/**
 * The game's own UI, drawn by the game. Needs Codeware.
 *
 * @example
 * ```ts
 * import { game, ink } from "rednode";
 *
 * const where = ink.text("", { size: 28, color: "cyan" });
 * ink.mount("hud", { anchor: "top-right", x: -40, y: 120 },
 *   ink.column({ gap: 4 }, ink.text("REDnode", { size: 20 }), where));
 *
 * setInterval(async () => {
 *   const p = await game.player.position();
 *   where.set({ text: `${p.x.toFixed(1)}  ${p.y.toFixed(1)}  ${p.z.toFixed(1)}` });
 * }, 250);
 * ```
 */
export const ink = {
  /**
   * Puts a tree on a layer of the game's UI. Layers: `"hud"`, which hides with the HUD.
   * REDnode builds it again after a save load, and removes it when the mod stops.
   */
  mount(layer: "hud", options: InkMountOptions, ...children: Child[]): InkMount {
    if (layer !== "hud") throw new Error(`ink: no layer "${layer}" yet: use "hud"`);
    const m: MountState = { key: `m${nextMount++}`, options: { ...options }, roots: [], open: true };
    openMounts.add(m);
    followText();
    enqueue({ op: "mount", mount: m.key, layer });
    for (const c of children) {
      const s = (c as unknown as Record<symbol, State>)[NODE];
      if (!s) throw new Error("ink: mount takes ink nodes");
      if (s.parent) throw new Error(`ink: ${s.tag} ${s.key} has a parent; mount its top node`);
      m.roots.push(s);
      add(s, m);
    }
    return {
      key: m.key,
      get: (id) => find(m.roots, id)?.node,
      update(...next) {
        if (!m.open) return;
        const fresh = next.map(stateOf);
        for (const s of m.roots.slice(fresh.length)) remove(s);
        fresh.forEach((f, i) => {
          if (i < m.roots.length) {
            const kept = patch(m.roots[i], f);
            if (kept !== m.roots[i]) m.roots[i] = kept;
          } else attach(f, null, m, i);
        });
      },
      unmount() {
        if (!m.open) return;
        m.open = false;
        openMounts.delete(m);
        enqueue({ op: "unmount", mount: m.key });
        for (const s of m.roots) detach(s);
      },
    };
  },

  /** A free canvas: its children sit by their `anchor`, `x` and `y`. */
  canvas(...args: (InkContainerProps | Child)[]): InkNode<InkContainerProps> {
    return container("canvas", args);
  },
  /** Children one under the other, `gap` apart. */
  column(...args: (InkContainerProps | Child)[]): InkNode<InkContainerProps> {
    return container("column", args);
  },
  /** Children side by side, `gap` apart. */
  row(...args: (InkContainerProps | Child)[]): InkNode<InkContainerProps> {
    return container("row", args);
  },
  /** A line of text, in the game's Rajdhani by default. */
  text(text: string | LocalText, props: Omit<InkTextProps, "text"> = {}): InkNode<InkTextProps> {
    return make("text", { ...props, text });
  },
  /** A filled rectangle: give it `width`, `height` and `color`. */
  rect(props: InkProps = {}): InkNode<InkProps> {
    return make("rect", props);
  },
  /**
   * A bar: a track and a fill from its left edge, `value` full (0 to 1), or bound to a game
   * value the plugin reads every frame.
   *
   * @example
   * ```ts
   * ink.bar({ bind: "player.health", of: "player.healthMax", width: 300, height: 8 });
   * ```
   */
  bar(props: InkBarProps = {}): InkNode<InkBarProps> {
    return makeBar(props);
  },
  /**
   * A column (or `direction: "row"`) of one node per item. Give it new `items` with `set`:
   * new keys are added at their place, gone ones removed, moved ones moved, and the others
   * patched, so only what changed goes to the game.
   *
   * @example
   * ```ts
   * const board = ink.list({ gap: 6, items: contracts },
   *   (c) => ink.row({ gap: 12 }, ink.text(c.name, { style: "body" }), ink.text(`${c.reward} €$`, { style: "value" })),
   *   (c) => c.id);
   * board.set({ items: next });
   * ```
   */
  list<T>(
    props: InkListProps<T>,
    render: (item: T, index: number) => InkNode,
    key: (item: T, index: number) => string | number = (_item, i) => i,
  ): InkNode<InkListProps<T>> {
    return makeList(props, render, key);
  },
  /** A filled circle. */
  circle(props: InkProps = {}): InkNode<InkProps> {
    return make("circle", props);
  },
  /** A part of an `.inkatlas`. */
  image(props: InkImageProps = {}): InkNode<InkImageProps> {
    return make("image", props);
  },
  /**
   * Any ink class by name, for what the tags do not cover. Capitalized props are the
   * widget's own methods, called with the value as their arguments.
   *
   * @example
   * ```ts
   * ink.widget("inkBorder", { width: 200, height: 40, color: "red", SetThickness: 2 });
   * ```
   */
  widget(className: string, props: InkProps & Record<string, unknown> = {}, ...children: Child[]): InkNode {
    return make(className, props, children);
  },

  /**
   * Puts ink markup on the game's UI: the tags of this module written as HTML, their props as
   * attributes. The top of the markup holds `<mount>` tags (`layer`, `anchor`, `x`, `y`).
   *
   * - **Tags:** `canvas`, `column`, `row` (also `vbox`, `hbox`), `text`, `rect`, `circle`,
   *   `image`, `bar`, `list`, and `widget class="inkBorder"` for any ink class, whose
   *   capitalized attributes are its methods. Attributes are the props by name;
   *   `text-align` is `textAlign`. `margin` and `pad` take one number or four.
   * - **Text:** inside `<text>...</text>`, or `text="..."`. `LocKey#...` and `key` show the
   *   game's own text.
   * - **Data:** `{name}` in text or an attribute reads the named data, `{name.field}` a
   *   field of it. An attribute that is one `{name}` alone takes the value as it is (a
   *   number, `true`). `{{` and `}}` are the characters. No expressions.
   * - **Lists:** `<list items="contracts" key="id">` holds the one tag each item gets; inside
   *   it `{name}` reads the item's field first, `{.}` is the item itself and `{$index}` its
   *   place.
   * - **Events:** `onclick="track"` names a function of `handlers`, checked now. Input on
   *   ink comes with phase I3: until then no event fires.
   *
   * A mistake throws an {@link InkMarkupError} with its line and column.
   *
   * @param source The markup.
   * @param handlers The functions its `on...` attributes name: a module (`import * as
   *   handlers from "./bounty.mjs"`) or an object.
   * @param data The named data it reads, changed later with {@link InkView.set}.
   *
   * @example
   * ```ts
   * const board = ink.parse(`
   *   <mount layer="hud" anchor="top-right" x="-40" y="120">
   *     <column gap="6">
   *       <text style="title">Bounty board</text>
   *       <list items="contracts" key="id" gap="4">
   *         <row gap="12">
   *           <text style="body">{name}</text>
   *           <text style="value">{reward} €$</text>
   *         </row>
   *       </list>
   *     </column>
   *   </mount>`, {}, { contracts: [] });
   *
   * board.set({ contracts: [{ id: 1, name: "Watson", reward: 1500 }] });
   * ```
   */
  parse(source: string, handlers?: Record<string, unknown>, data?: Record<string, unknown>): InkView {
    return markupView(source, handlers, data);
  },

  /**
   * Reads an ink markup file (`.ink.html`) and puts it on the game's UI, as
   * {@link ink.parse} does. A relative path starts at the package's folder. Mistakes name the
   * file, line and column.
   *
   * @example
   * ```ts
   * import { ink } from "rednode";
   * import * as handlers from "./bounty.mjs";
   *
   * const board = await ink.load("bounty.ink.html", handlers, { contracts: [] });
   * board.set({ contracts: await fetchContracts() });
   * ```
   */
  async load(file: string, handlers?: Record<string, unknown>, data?: Record<string, unknown>): Promise<InkView> {
    const { text, name } = await readPackageFile(file);
    return markupView(text, handlers, data, name);
  },

  /**
   * The game's own ink layers (needs Codeware), in their order, each with its window. The HUD
   * layer also lists its entries: each HUD piece the game spawned, with its root widget, its
   * game controller and the `.inkwidget` file it came from (a path hash). Reads only.
   *
   * @example
   * ```ts
   * const { layers } = await ink.layers();
   * const hud = layers.find((l) => l.name === "inkHUDLayer");
   * console.log(hud?.entries?.map((e) => e.name));
   * ```
   */
  async layers(): Promise<{ layers: InkLayerInfo[] }> {
    return (await transport().call("ink.layers", {}).catch(rethrow)) as { layers: InkLayerInfo[] };
  },

  /**
   * Reads a tree of the game's own widgets in one call: a layer's window, a widget by its id
   * from an earlier read, or an `api` reference. Each node has its class, name, visibility,
   * box on screen, controller and text; `children` stops at `depth` or `max` nodes (`count`
   * says how many it has). Reads only.
   *
   * @example
   * ```ts
   * const { root, nodes, ms } = await ink.read({ layer: "inkMenuLayer" }, { depth: 3 });
   * console.log(`${nodes} widgets in ${ms} ms`, root.children?.map((c) => c.name));
   * ```
   */
  async read(
    from: { id: string } | { layer: string } | { ref: { $ref: number } },
    options: { depth?: number; max?: number; boxes?: boolean } = {},
  ): Promise<InkReadResult> {
    return (await transport().call("ink.read", { ...from, ...options }).catch(rethrow)) as InkReadResult;
  },

  /**
   * One of the game's widgets in full: its class and parents' classes, path, box, controllers,
   * where it came from (layer, HUD entry, library file hash) and every property. `ref` is an
   * `api` reference to it, for calling its methods. Reads only.
   *
   * @example
   * ```ts
   * const w = await ink.inspect("w42");
   * console.log(w.path, w.controllers, w.properties.opacity);
   * ```
   */
  async inspect(id: string): Promise<InkWidgetInfo> {
    return (await transport().call("ink.inspect", { id }).catch(rethrow)) as InkWidgetInfo;
  },

  /**
   * The game's visible widgets under a point on screen, on every active layer, deepest first:
   * what an inspector's Pick finds. `x` and `y` are in the game's ink pixels (the layers'
   * `size`). Reads only.
   *
   * @example
   * ```ts
   * const { hits } = await ink.at(200, 900);
   * console.log(hits[0]?.path);
   * ```
   */
  async at(x: number, y: number): Promise<{ hits: InkHit[]; looked: number; ms: number }> {
    return (await transport().call("ink.at", { x, y }).catch(rethrow)) as { hits: InkHit[]; looked: number; ms: number };
  },

  /**
   * Every visible widget of the game with a box on screen, on every active layer, deepest
   * first, in one call (about 7 ms for 1,600 widgets in game 2.5). A page that highlights what
   * is under the cursor reads these once and tests each mouse move itself, instead of asking
   * the game on every move. Boxes are in ink pixels, as {@link ink.at}'s. Reads only.
   *
   * @example
   * ```ts
   * const { widgets } = await ink.boxes();
   * const under = (x: number, y: number) =>
   *   widgets.find((w) => w.box && x >= w.box[0] && y >= w.box[1] && x < w.box[0] + w.box[2] && y < w.box[1] + w.box[3]);
   * ```
   */
  async boxes(): Promise<{ widgets: Omit<InkHit, "path">[]; looked: number; ms: number }> {
    return (await transport().call("ink.boxes", {}).catch(rethrow)) as { widgets: Omit<InkHit, "path">[]; looked: number; ms: number };
  },
};

function rethrow(err: unknown): never {
  throw cleanError(err);
}

/** A widget's box on screen, `[x, y, width, height]` in ink pixels; null when it could not be read. */
export type InkBox = [number, number, number, number] | null;

/** An ink layer of the game, from {@link ink.layers}. */
export interface InkLayerInfo {
  /** Its class, such as `inkHUDLayer` or `inkMenuLayer`. */
  name: string;
  /** Null when the game's layer could not be reached from its window (then only name, window and size are known). */
  active: boolean | null;
  interactive: boolean | null;
  /** Its input context. */
  input: string | null;
  /** Its size in ink pixels. */
  size: [number, number];
  /** Its window's widget id, for {@link ink.read}. */
  window: string | null;
  children: number;
  /** The HUD layer's pieces. */
  entries?: {
    name: string;
    enabled: boolean;
    /** Its own window, when it is not in the layer's. */
    window: string | null;
    root: string | null;
    controller: string | null;
    /** The `.inkwidget` file it was spawned from, as a path hash. */
    library: string;
    /** With its own window: the slot on the HUD the game draws that window into. */
    slot?: InkBox;
    /** With its own window: the window's size, in ink pixels. */
    windowSize?: [number, number] | null;
    /** With its own window: the slot's size over the window's. */
    scale?: [number, number];
  }[];
}

/** A widget in a tree read by {@link ink.read}. */
export interface InkTreeNode {
  /** Its id, the same for as long as the widget lives. */
  id: string;
  class: string;
  name: string;
  visible: boolean;
  opacity: number;
  box?: InkBox;
  /** Its logic controller's class. */
  controller?: string;
  /** A text widget's text, cut at 120 characters. */
  text?: string;
  /** How many children it has. */
  count: number;
  /** Its children, unless the read stopped above them. */
  children?: InkTreeNode[];
}

/** What {@link ink.read} answers. */
export interface InkReadResult {
  root: InkTreeNode;
  nodes: number;
  /** True when `depth` or `max` left children out. */
  cut: boolean;
  ms: number;
}

/** One widget in full, from {@link ink.inspect}. */
export interface InkWidgetInfo {
  id: string;
  class: string;
  /** Its class and its parents' classes, nearest first. */
  classes: string[];
  name: string;
  /** Its parents' names and its own, from the window down. */
  path: string;
  depth: number;
  parent: string | null;
  children: string[];
  box: InkBox;
  visible: boolean;
  /** Its logic controller first, then the others. */
  controllers: string[];
  layer: string;
  /** The HUD entry it belongs to. */
  entry: string | null;
  /** The `.inkwidget` file it or a parent was spawned from, as a path hash. */
  library: string;
  /** Its parents, from its window down to its own parent, to open a tree to it. */
  ancestors: { id: string; name: string; class: string }[];
  /** An `api` reference to the widget. */
  ref: { $ref: number };
  text?: string;
  /** Every property, by name; objects as their class name. */
  properties: Record<string, unknown>;
}

/** A widget under a point, from {@link ink.at}. */
export interface InkHit {
  id: string;
  class: string;
  name: string;
  box: InkBox;
  layer: string;
  entry: string | null;
  depth: number;
  path: string;
}
