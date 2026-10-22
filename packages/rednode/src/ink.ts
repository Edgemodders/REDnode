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
 * A color: `"#rrggbb"` or `"#rrggbbaa"`, `[r, g, b]` or `[r, g, b, a]` from 0 to 255, or a
 * name: `white`, `black`, `red`, `cyan`, `yellow`, `green`, `blue`, `grey` (close to the
 * game's own; unverified against its styles).
 */
export type InkColor = string | readonly [number, number, number] | readonly [number, number, number, number];

/** What every tag takes. */
export interface InkProps {
  /** A name to find the node by with {@link InkMount.get}. */
  id?: string;
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

/** Properties of {@link ink.text}. */
export interface InkTextProps extends InkProps {
  text?: string;
  /** The font size, 32 if not given. */
  size?: number;
  /** A font family's depot path; the game's Rajdhani if not given. */
  font?: string;
  /** The font's style, such as `"Medium"` (the default), `"Semi-Bold"` or `"Bold"`. */
  style?: string;
}

/** Properties of {@link ink.column} and {@link ink.row}. */
export interface InkContainerProps extends InkProps {
  /** Space between the children. */
  gap?: number;
}

/** Properties of {@link ink.image}. */
export interface InkImageProps extends InkProps {
  /** An `.inkatlas` depot path. */
  atlas?: string;
  /** The part of the atlas to show. */
  part?: string;
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
  if (!hex) throw new Error(`ink: "${c}" is not a color: use "#rrggbb", [r, g, b] or a name such as "cyan"`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex[2] ? parseInt(hex[2], 16) : 255];
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
}

interface MountState {
  key: string;
  options: InkMountOptions;
  roots: State[];
  open: boolean;
}

let nextKey = 1;
let nextMount = 1;
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
    .catch((err) => console.warn(`ink: ${cleanError(err).message}`));
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function sides(m: number | readonly number[]): number[] {
  return typeof m === "number" ? [m, m, m, m] : [m[0], m[1], m[2], m[3]];
}

// The modder's props as the plugin's: anchors and offsets, colors as numbers, gaps as margins.
function wire(s: State): Record<string, unknown> {
  const p = s.props as InkTextProps & InkContainerProps & InkImageProps;
  const out: Record<string, unknown> = {};
  const parentTag = s.parent?.tag;
  const inPanel = parentTag === "column" || parentTag === "row";
  if (!inPanel) {
    const opts = s.parent ? {} : (s.mount?.options ?? {});
    const anchor = p.anchor ?? opts.anchor ?? "top-left";
    const a = ANCHORS[anchor];
    if (!a) throw new Error(`ink: "${anchor}" is not an anchor: use top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right or fill`);
    out.anchor = a[0];
    out.anchorPoint = [a[1], a[2]];
    out.translation = [p.x ?? opts.x ?? 0, p.y ?? opts.y ?? 0];
  }
  let margin = p.margin !== undefined ? sides(p.margin) : null;
  if (inPanel && margin === null && s.parent && s.parent.children.indexOf(s) > 0) {
    const gap = (s.parent.props as InkContainerProps).gap ?? 0;
    if (gap) margin = parentTag === "column" ? [0, gap, 0, 0] : [gap, 0, 0, 0];
  }
  if (margin) out.margin = margin;
  if (p.width !== undefined || p.height !== undefined) out.size = [p.width ?? 0, p.height ?? 0];
  // Panels and text with no size take their content's, so an anchor such as top-right
  // places them by their real size (a panel's own size reads 0x0 in the game).
  else if (s.tag === "column" || s.tag === "row" || s.tag === "text") out.fitToContent = true;
  if (p.color !== undefined) out.tint = inkColor(p.color);
  if (p.opacity !== undefined) out.opacity = p.opacity;
  if (p.visible !== undefined) out.visible = p.visible;
  if (s.tag === "text") {
    out.font = [p.font ?? FONT, p.style ?? "Medium"];
    out.fontSize = p.size ?? 32;
    out.text = p.text ?? "";
    if (p.color === undefined) out.tint = PALETTE.white.concat(255);
  }
  if (s.tag === "image") {
    if (p.atlas !== undefined) out.atlas = p.atlas;
    if (p.part !== undefined) out.part = p.part;
  }
  // ink.widget: capitalized props are the widget's own methods, passed as they are.
  for (const [k, v] of Object.entries(p)) if (/^[A-Z]/.test(k)) out[k] = v;
  if (p.id !== undefined) out.name = p.id;
  return out;
}

function add(s: State, mount: MountState): void {
  if (s.mount) throw new Error(`ink: a node is in one mount at a time (${s.tag} ${s.key} is mounted already)`);
  s.mount = mount;
  s.sent = wire(s);
  enqueue({ op: "add", mount: mount.key, key: s.key, parent: s.parent?.key ?? "", tag: s.tag, props: s.sent });
  for (const c of s.children) add(c, mount);
}

function detach(s: State): void {
  s.mount = null;
  s.sent = {};
  for (const c of s.children) detach(c);
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

function make<P extends InkProps>(tag: string, props: P, children: Child[] = []): InkNode<P> {
  const s: State = {
    key: `k${nextKey++}`,
    tag,
    props: { ...props } as Record<string, unknown>,
    children: [],
    parent: null,
    mount: null,
    sent: {},
    node: null as unknown as InkNode,
  };
  for (const c of children) {
    const cs = (c as unknown as Record<symbol, State>)[NODE];
    if (!cs) throw new Error(`ink: a child of ${tag} is not an ink node`);
    if (cs.parent) throw new Error(`ink: a node has one parent (${cs.tag} ${cs.key} has one already)`);
    cs.parent = s;
    s.children.push(cs);
  }
  const node: InkNode<P> = {
    key: s.key,
    tag,
    get props() {
      return s.props as Readonly<P>;
    },
    set(next: Partial<P>) {
      Object.assign(s.props, next);
      if (!s.mount?.open) return;
      // The gap of a panel is its children's margins: they change with it.
      const touched = [s, ...("gap" in next ? s.children : [])];
      for (const t of touched) {
        const now = wire(t);
        const changed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(now)) if (!same(t.sent[k], v)) changed[k] = v;
        if (!Object.keys(changed).length) continue;
        t.sent = now;
        enqueue({ op: "set", mount: t.mount!.key, key: t.key, props: changed });
      }
    },
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
      unmount() {
        if (!m.open) return;
        m.open = false;
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
  text(text: string, props: Omit<InkTextProps, "text"> = {}): InkNode<InkTextProps> {
    return make("text", { ...props, text });
  },
  /** A filled rectangle: give it `width`, `height` and `color`. */
  rect(props: InkProps = {}): InkNode<InkProps> {
    return make("rect", props);
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
