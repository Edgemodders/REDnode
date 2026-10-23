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
 * **Status:** phase I2a: the `hud` layer, containers, text, shapes and images. Layout
 * and theme words, the game's look, bindings, menus and events come in later phases
 * (see the Native game UI page).
 *
 * @module
 */

import { LocalText, onTextChange } from "./i18n.js";
import { cleanError, transport } from "./transport.js";

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
};
