/**
 * The UI builder: overlay windows from a Node mod, without writing HTML.
 *
 * A mod describes its window as a tree of nodes. The overlay host renders it
 * with the REDnode UI kit, the same components overlay apps use in their
 * markup, and sends clicks and changes back to the mod's handlers.
 *
 * Only Node mods use the builder. Overlay apps write HTML instead.
 *
 * @module
 */

import { cleanError, transport, type Transport } from "./transport.js";

/** Where a window sits on the screen. The x and y offsets are measured from this point. */
export type Anchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/** One piece of a built window: text, a button, a row and so on. */
export interface UiNode<Props extends object = Record<string, unknown>> {
  /** Unique within the mod. */
  readonly id: string;
  /** The node's type, for example `"button"`. */
  readonly type: string;
  /** The node's current properties. */
  readonly props: Readonly<Props>;
  /**
   * Changes some properties. The window updates at once if it is open.
   *
   * @example
   * ```ts
   * const status = ui.text("Waiting");
   * status.set({ text: "Ready" });
   * ```
   */
  set(props: Partial<Props>): void;
}

/** Properties of {@link ui.text} and {@link ui.heading}. */
export interface TextProps {
  text: string;
  /** `"dim"` for secondary text, `"accent"` to stand out, `"danger"` for errors. */
  tone?: "normal" | "dim" | "accent" | "danger";
}
/** Properties of {@link ui.button}. */
export interface ButtonProps {
  label: string;
  /** `"ghost"` for a quieter button, `"danger"` for a destructive one. */
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  /** A game sound event played on press. The UI kit's default is used when not set. */
  sound?: string;
}
/** Properties of {@link ui.toggle}. */
export interface ToggleProps {
  label: string;
  checked?: boolean;
  disabled?: boolean;
}
/** Properties of {@link ui.slider}. */
export interface SliderProps {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  /** Shown after the value, for example `"%"`. */
  unit?: string;
  /**
   * `onChange` also gets the value while the player drags, about 20 times a second, not only
   * when they let go. Needs REDnode 0.55.2 or later.
   */
  live?: boolean;
}
/** Properties of {@link ui.input}. */
export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  /** Hide what is typed, for a key or a password (REDnode 0.44.0 or later). Keep the value with `secrets`, not in a file. */
  password?: boolean;
}
/** Properties of {@link ui.progress}. */
export interface ProgressProps {
  label?: string;
  value: number;
  max?: number;
}

/** Properties of {@link ui.image}. */
export interface ImageProps {
  /**
   * The picture: a PNG, JPEG, WebP or GIF file, or a `data:image/...;base64,` URL. A relative
   * path is in the package's folder; a full path must be in the package's folder or its data
   * folder (`pkg.dataDir`), where a mod writes the pictures it makes. Setting the same path
   * again shows the file as it is now, so a mod can write a new picture over the old one.
   */
  src: string;
  /** Width in pixels; the height follows the picture's shape. Scaled down to fit the window when wider. Without it, the picture's own width. */
  width?: number;
  /** Words for the picture, shown while it loads or when it cannot be shown. */
  alt?: string;
  /** Changes the picture's address without changing `src`, to show a file again by hand. Rarely needed: setting `src` does it. */
  version?: number;
}

/** What {@link UiImage.set} takes: `src` may also be the picture's bytes. */
export type ImageSetProps = Omit<ImageProps, "src"> & { src: string | Uint8Array };

/** A picture, from {@link ui.image}. `set({ src })` shows another one, or the same file again. */
export interface UiImage extends Omit<UiNode<ImageProps>, "set"> {
  set(props: Partial<ImageSetProps>): void;
}

/** Properties of {@link ui.list}. */
export interface ListProps {
  /** The lines shown, oldest first. Add to them with {@link UiList.push}. */
  lines: string[];
  /** How many lines the list keeps; older ones drop off the top. 1 to 5,000; 500 by default. */
  keep?: number;
  /** A fixed height in pixels. Without it the list fills the window's free height, at least 160 px (the window scrolls when the other nodes leave less). */
  height?: number;
  /** Scroll to each new line while the player is at the bottom (`true`, the default). Scrolled up, the list stays put either way. */
  follow?: boolean;
}

/** A scrolling list of lines, from {@link ui.list}. */
export interface UiList extends UiNode<ListProps> {
  /**
   * Adds lines at the bottom. Only the new lines go to the window, so a list fed many
   * times a second stays cheap; the oldest drop off past `keep`.
   */
  push(...lines: string[]): void;
  /** Empties the list. */
  clear(): void;
}

/** Options of {@link ui.window}. */
export interface WindowOptions {
  /** Names the window within the mod, so its saved position is found again. Defaults to `"main"`. */
  id?: string;
  /** The title bar text. */
  title: string;
  /** Width in page pixels at 1080p. Defaults to 360. */
  width?: number;
  /** Height in page pixels at 1080p. Defaults to 320. Space the content does not use is transparent and clicks through. */
  height?: number;
  /** Defaults to `"center"`. A saved position wins after the player has moved the window. */
  anchor?: Anchor;
  x?: number;
  y?: number;
  /** Shows a close button. Defaults to true. */
  closable?: boolean;
  /**
   * Buttons of the mod's own in the title bar, beside close: the first next to close. They
   * count toward the three icons there, so the window's own actions (roll up, reset
   * position, debug) move into its ⋯ menu. Needs REDnode 0.57.0 or later.
   */
  titleButtons?: TitleButton[];
  /** The window's content, top to bottom. */
  children: UiNode[];
  /** Called when the player closes the window. The mod keeps running, and the launcher can show the window again. */
  onClose?: () => void;
}

/** A button in a window's title bar, given in {@link WindowOptions.titleButtons}. */
export interface TitleButton {
  /** Names the button within the window. */
  id: string;
  /** The tooltip, or the button's text when it has no icon. */
  label: string;
  /**
   * One of the UI kit's icons: `key`, `settings`, `back`, `refresh`, `help`, `info`, `add`,
   * `edit`, `search`, `list`, `home`, `pin`, `reset`, `space`. Without one, the label shows.
   */
  icon?: TitleIcon;
  /** Shows the button lit, for a switch that is on. */
  on?: boolean;
  /** Runs in the mod when the player presses it. */
  onClick?: () => void;
}

/** The icons a {@link TitleButton} can show. */
export type TitleIcon = "key" | "settings" | "back" | "refresh" | "help" | "info" | "add" | "edit" | "search" | "list" | "home" | "pin" | "reset" | "space";

/** What {@link UiWindow.set} changes. */
export interface WindowChanges {
  /** A new title bar text. */
  title?: string;
  /** New title-bar buttons, in place of the old ones; `[]` takes them away. */
  titleButtons?: TitleButton[];
  /** New content, in place of the old: the same window, place and size. */
  children?: UiNode[];
}

/** A window opened with {@link ui.window}. */
export interface UiWindow {
  /** The window's id within the mod. */
  readonly id: string;
  /** True after {@link UiWindow.close}, or after the player closed it. */
  readonly closed: boolean;
  /**
   * Changes the open window in place: its title, its title-bar buttons, its content. The
   * window keeps its place and size, with no flicker, so one window can show several
   * views. The new content's nodes work as in a new window; nodes taken out keep their
   * state and can be shown again later. A closed window takes the changes too, and shows
   * them when the player opens it again. Needs REDnode 0.57.0 or later.
   *
   * @example
   * ```ts
   * import { ui } from "rednode";
   *
   * const main = [ui.text("The main view")];
   * const keys = [ui.text("Your keys"), ui.button("Done", () => showMain())];
   * const win = ui.window({
   *   title: "Designer",
   *   titleButtons: [{ id: "keys", label: "Keys", icon: "key", onClick: () => showKeys() }],
   *   children: main,
   * });
   * function showKeys() {
   *   win.set({ title: "Designer: your keys", titleButtons: [], children: keys });
   * }
   * function showMain() {
   *   win.set({ title: "Designer", titleButtons: [{ id: "keys", label: "Keys", icon: "key", onClick: showKeys }], children: main });
   * }
   * ```
   */
  set(changes: WindowChanges): void;
  /** Closes the window. */
  close(): void;
}

type Handler = (value: unknown) => void;

interface Spec {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: Spec[];
}

interface NodeState {
  spec: Spec;
  window: string | null;
}

let nextNode = 1;
const nodes = new Map<string, NodeState>(); // node id -> state
const handlers = new Map<string, Map<string, Handler>>(); // node id -> event type -> handler
interface WindowState {
  onClose?: () => void;
  closed: boolean;
  nodes: string[];
  root: Spec;
  buttons: Map<string, () => void>;
}
const windows = new Map<string, WindowState>();

// The title-bar buttons as the host and page get them, with their handlers kept here.
function titleButtons(state: WindowState, list: TitleButton[] | undefined): Record<string, unknown>[] {
  state.buttons.clear();
  return (list ?? []).map((b) => {
    if (b.onClick) state.buttons.set(String(b.id), b.onClick);
    return { id: String(b.id), label: String(b.label ?? b.id), icon: b.icon ?? null, on: !!b.on };
  });
}
let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "ui") return;
    const win = String(m.window);
    if (m.type === "close") {
      const w = windows.get(win);
      if (w && !w.closed) {
        forget(win);
        w.onClose?.();
      }
      return;
    }
    if (m.type === "show") {
      // The player asked the launcher to show a window they closed: open it again as it is now.
      const w = windows.get(win);
      if (w && w.closed) {
        w.closed = false;
        for (const id of w.nodes) {
          const n = nodes.get(id);
          if (n) n.window = win;
        }
        transport().ui?.open(win, w.root);
      }
      return;
    }
    if (m.type === "title") {
      // A title-bar button: the window node's event, with the button's id.
      windows.get(win)?.buttons.get(String(m.value))?.();
      return;
    }
    const handler = handlers.get(String(m.node))?.get(String(m.type));
    if (handler) handler(m.value);
  });
}

function forget(win: string): void {
  const w = windows.get(win);
  if (!w) return;
  w.closed = true;
  for (const id of w.nodes) {
    const n = nodes.get(id);
    if (n) n.window = null;
  }
}

function node<P extends object>(type: string, props: P, on?: Record<string, Handler | undefined>, children?: UiNode[]): UiNode<P> {
  const id = `n${nextNode++}`;
  const spec: Spec = { id, type, props: { ...props } as Record<string, unknown> };
  if (children) spec.children = children.map((c) => nodes.get(c.id)!.spec);
  const state: NodeState = { spec, window: null };
  nodes.set(id, state);
  const events = new Map<string, Handler>();
  for (const [k, fn] of Object.entries(on ?? {})) if (fn) events.set(k, fn);
  if (events.size) handlers.set(id, events);
  return {
    id,
    type,
    get props() {
      return spec.props as Readonly<P>;
    },
    set(next: Partial<P>) {
      Object.assign(spec.props, next);
      if (state.window) transport().ui?.update(state.window, id, next as Record<string, unknown>);
    },
  };
}

// ui.image's source as text: a path or a data: URL as given, bytes as a data: URL of their type.
function imageSource(src: string | Uint8Array): string {
  if (typeof src === "string") return src;
  if (!(src instanceof Uint8Array)) throw new Error("rednode: ui.image takes a file path, a data: URL or the picture's bytes");
  const b = src;
  const type =
    b[0] === 0x89 && b[1] === 0x50 ? "png" : b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : b[0] === 0x47 && b[1] === 0x49 ? "gif" : b[8] === 0x57 && b[9] === 0x45 ? "webp" : null;
  if (!type) throw new Error("rednode: ui.image's bytes are not a PNG, JPEG, WebP or GIF picture");
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  let base64: string;
  if (B) base64 = B.from(b).toString("base64");
  else {
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    base64 = btoa(s);
  }
  return `data:image/${type};base64,${base64}`;
}

function collect(spec: Spec, out: string[]): void {
  out.push(spec.id);
  for (const c of spec.children ?? []) collect(c, out);
}

/**
 * Builds overlay windows from a Node mod.
 *
 * @example
 * ```ts
 * import { game, ui } from "rednode";
 *
 * const where = ui.text("Waiting for the game");
 * ui.window({
 *   title: "Where am I",
 *   children: [
 *     where,
 *     ui.button("Update", async () => {
 *       const p = await game.player.position();
 *       where.set({ text: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` });
 *     }),
 *   ],
 * });
 * ```
 */
export const ui = {
  /** A line of text. Update it with `set({ text })`. */
  text(text: string, options: Omit<TextProps, "text"> = {}): UiNode<TextProps> {
    return node("text", { text, ...options });
  },

  /** A small heading. */
  heading(text: string, options: Omit<TextProps, "text"> = {}): UiNode<TextProps> {
    return node("heading", { text, ...options });
  },

  /** A button. `onClick` runs in the mod when the player presses it. */
  button(label: string, onClick?: () => void, options: Omit<ButtonProps, "label"> = {}): UiNode<ButtonProps> {
    return node("button", { label, ...options }, { click: onClick && (() => onClick()) });
  },

  /** An on and off switch. `onChange` gets the new state. */
  toggle(label: string, onChange?: (checked: boolean) => void, options: Omit<ToggleProps, "label"> = {}): UiNode<ToggleProps> {
    let self: UiNode<ToggleProps>;
    self = node("toggle", { label, ...options }, {
      change: (v) => {
        Object.assign(self.props, { checked: !!v });
        onChange?.(!!v);
      },
    });
    return self;
  },

  /**
   * A slider. `onChange` gets the value when the player lets go, or while they drag with
   * `live: true`.
   *
   * @example
   * ```ts
   * ui.slider("Level", (v) => panel.set({ level: v }), { min: 0, max: 100, value: 50, unit: "%", live: true });
   * ```
   */
  slider(label: string, onChange?: (value: number) => void, options: Omit<SliderProps, "label"> = {}): UiNode<SliderProps> {
    let self: UiNode<SliderProps>;
    self = node("slider", { label, ...options }, {
      change: (v) => {
        Object.assign(self.props, { value: Number(v) });
        onChange?.(Number(v));
      },
    });
    return self;
  },

  /** A text field. `onSubmit` runs on Enter; `onChange` when the field loses focus. */
  input(
    options: InputProps & { onChange?: (value: string) => void; onSubmit?: (value: string) => void } = {},
  ): UiNode<InputProps> {
    const { onChange, onSubmit, ...props } = options;
    let self: UiNode<InputProps>;
    self = node("input", props, {
      change: (v) => {
        Object.assign(self.props, { value: String(v) });
        onChange?.(String(v));
      },
      submit: (v) => onSubmit?.(String(v)),
    });
    return self;
  },

  /** A progress bar from 0 to `max` (100 by default). */
  progress(value: number, options: Omit<ProgressProps, "value"> = {}): UiNode<ProgressProps> {
    return node("progress", { value, ...options });
  },

  /**
   * A list of lines that scrolls on its own, for a log or a live feed. It keeps the newest
   * lines only (`keep`, 500 by default), follows the newest line unless the player has
   * scrolled up, and without a `height` fills the window's free height. It keeps at least
   * 160 px: when the other nodes leave less, the window scrolls.
   *
   * @example
   * ```ts
   * import { game, ui } from "rednode";
   *
   * const log = ui.list({ keep: 1000 });
   * ui.window({ title: "Events", width: 420, height: 360, children: [log, ui.button("Clear", () => log.clear())] });
   * game.on("PlayerPuppet.OnGameAttached", (e) => log.push(`${new Date().toLocaleTimeString()} ${e.name}`));
   * ```
   */
  list(options: Partial<ListProps> = {}): UiList {
    const keep = Math.min(5000, Math.max(1, Math.floor(Number(options.keep) || 500)));
    const self = node<ListProps>("list", { ...options, keep, lines: (options.lines ?? []).map(String).slice(-keep) });
    const props = self.props as ListProps;
    return Object.assign(self, {
      push(...lines: string[]) {
        const add = lines.map(String);
        if (!add.length) return;
        props.lines.push(...add);
        if (props.lines.length > keep) props.lines.splice(0, props.lines.length - keep);
        const at = nodes.get(self.id)?.window;
        if (at) transport().ui?.update(at, self.id, { push: add });
      },
      clear() {
        self.set({ lines: [] });
      },
    });
  },

  /**
   * A picture from a file or from bytes, for a mod that makes or fetches pictures: a
   * render, a preview, a before and after. `src` is a PNG, JPEG, WebP or GIF file (a
   * relative path in the package's folder, or a full path in `pkg.dataDir`), a
   * `data:image/` URL, or the file's bytes (a `Buffer` or `Uint8Array`). Give a `width`
   * in pixels; the height follows the picture. `set({ src })` shows another picture, or
   * the same file again after the mod wrote over it. A picture that cannot be shown says
   * why in the window and in the Mod log. Needs REDnode 0.55.0 or later.
   *
   * @example
   * ```ts
   * import path from "node:path";
   * import { pkg, ui } from "rednode";
   *
   * const file = path.join(pkg.dataDir, "before.png"); // written by the mod
   * const before = ui.image(file, { width: 220, alt: "The hat before" });
   * const after = ui.image("waiting.png", { width: 220, onClick: () => console.log("larger") });
   * ui.window({ title: "Reshape", width: 480, height: 320, children: [ui.row(before, after)] });
   * after.set({ src: path.join(pkg.dataDir, "after.png") });
   * ```
   */
  image(src: string | Uint8Array, options: Omit<ImageProps, "src"> & { onClick?: () => void } = {}): UiImage {
    const { onClick, ...props } = options;
    const self = node<ImageProps & { clickable: boolean }>("image", { ...props, src: imageSource(src), clickable: !!onClick }, { click: onClick && (() => onClick()) });
    const set = self.set.bind(self);
    return Object.assign(self, {
      set(next: Partial<ImageSetProps>) {
        set(next.src === undefined ? (next as Partial<ImageProps>) : { ...next, src: imageSource(next.src) });
      },
    });
  },

  /** Puts nodes side by side. */
  row(...children: UiNode[]): UiNode<Record<string, never>> {
    return node("row", {}, undefined, children);
  },

  /** Puts nodes under each other. A window's content is already a column. */
  column(...children: UiNode[]): UiNode<Record<string, never>> {
    return node("column", {}, undefined, children);
  },

  /**
   * Opens a window in the game. It looks like any overlay app window: the
   * player can move it in interactive mode (F10), and its position is saved.
   */
  window(options: WindowOptions): UiWindow {
    const t = transport();
    if (!t.ui) throw new Error("rednode: ui.window is for Node mods. Overlay apps write HTML with the UI kit.");
    ensureListening();
    const id = options.id ?? "main";
    const existing = windows.get(id);
    if (existing && !existing.closed) throw new Error(`rednode: a window with id "${id}" is already open`);

    const root: Spec = {
      id: `w:${id}`,
      type: "window",
      props: {
        title: options.title,
        width: options.width ?? 360,
        height: options.height ?? 320,
        anchor: options.anchor ?? "center",
        x: options.x ?? 0,
        y: options.y ?? 0,
        closable: options.closable !== false,
      },
      children: options.children.map((c) => nodes.get(c.id)!.spec),
    };
    const ids: string[] = [];
    for (const c of root.children!) collect(c, ids);
    for (const n of ids) nodes.get(n)!.window = id;
    const state: WindowState = { onClose: options.onClose, closed: false, nodes: ids, root, buttons: new Map() };
    root.props.titleButtons = titleButtons(state, options.titleButtons);
    windows.set(id, state);
    t.ui.open(id, root);

    return {
      id,
      get closed() {
        return state.closed;
      },
      set(changes: WindowChanges) {
        const next: Record<string, unknown> = {};
        if (changes.title !== undefined) next.title = root.props.title = String(changes.title);
        if (changes.titleButtons !== undefined) next.titleButtons = root.props.titleButtons = titleButtons(state, changes.titleButtons);
        if (changes.children !== undefined) {
          // The old nodes leave the window (they keep their state and handlers, to come back
          // later); the new ones join it.
          for (const n of state.nodes) {
            const s = nodes.get(n);
            if (s && s.window === id) s.window = null;
          }
          root.children = changes.children.map((c) => {
            const s = nodes.get(c.id);
            if (!s) throw new Error("rednode: win.set's children must be nodes made with ui.*");
            return s.spec;
          });
          const kept: string[] = [];
          for (const c of root.children) collect(c, kept);
          state.nodes = kept;
          if (!state.closed) for (const n of kept) nodes.get(n)!.window = id;
          next.children = root.children;
        }
        if (!state.closed && Object.keys(next).length) t.ui!.update(id, root.id, next);
      },
      close() {
        if (state.closed) return;
        forget(id);
        t.ui!.close(id);
      },
    };
  },

  /**
   * Solo mode: while on, REDnode hides every other package's windows and HUD
   * widgets, so this package has the screen to itself (an editing viewport, a
   * full-screen tool). REDnode's own tool windows stay: the launcher tab, which
   * shows the solo and an End solo button, the Mod log, the Mod Manager and the
   * Test timer. Solo ends when the package turns it off, stops or crashes, or the
   * player ends it; {@link ui.onSolo} hears that.
   *
   * The package must list `"solo"` in its rednode-app.json permissions and the
   * player must allow it in the Mod Manager; until then this rejects and says so.
   * Works in Node mods and in overlay apps.
   *
   * @example
   * ```ts
   * import { ui } from "rednode";
   *
   * await ui.solo(true);  // edit mode on: other windows go
   * // ...
   * await ui.solo(false); // they come back
   * ```
   */
  async solo(on: boolean): Promise<void> {
    const t = transport() as Transport & { solo?(on: boolean): Promise<unknown> };
    const page = (globalThis as { rednode?: { pkg?: { solo?(on: boolean): Promise<unknown> } } }).rednode?.pkg;
    const solo = t.solo ? (v: boolean) => t.solo!(v) : page?.solo;
    if (!solo) throw new Error("rednode: solo mode needs the REDnode host");
    try {
      await solo(!!on);
    } catch (err) {
      throw cleanError(err);
    }
  },

  /**
   * Puts text on the Windows clipboard, for the player to paste anywhere. Works in
   * Node mods and in overlay apps; use it instead of `navigator.clipboard`, which an
   * overlay window cannot always reach. It only writes: no package can read the
   * clipboard.
   *
   * @example
   * ```ts
   * import { ui } from "rednode";
   *
   * await ui.copy("746693166");
   * ```
   */
  async copy(text: string): Promise<void> {
    try {
      await transport().call("clipboard.write", { text: String(text) });
    } catch (err) {
      throw cleanError(err);
    }
  },

  /**
   * Calls the handler when this package's solo mode starts or ends, also when the
   * player ends it from the launcher. Returns a function that stops listening.
   */
  onSolo(handler: (on: boolean) => void): () => void {
    return transport().listen((m) => {
      if (m.event === "solo") handler(!!(m as { on?: boolean }).on);
    });
  },
};
