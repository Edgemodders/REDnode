/**
 * The reader of ink markup (UI Tools, phase UT1): an `.ink.html` file's tags, attributes and
 * text, each with its line and column, for {@link ink.parse}. It knows nothing of ink's tags;
 * `ink.parse` checks them. No Node imports, so the docs simulation runs it too.
 *
 * @module
 */

/** A mistake in ink markup, with where it is. */
export class InkMarkupError extends Error {
  /** From 1. */
  readonly line: number;
  /** From 1. */
  readonly column: number;
  /** The file, when the markup came from one. */
  readonly file?: string;
  /** The message without the place. */
  readonly reason: string;
  constructor(reason: string, line: number, column: number, file?: string) {
    super(`${file ?? "ink markup"}:${line}:${column}: ${reason}`);
    this.name = "InkMarkupError";
    this.reason = reason;
    this.line = line;
    this.column = column;
    this.file = file;
  }
}

/** Where something starts in the source. */
export interface MarkupPlace {
  line: number;
  column: number;
}

/** An attribute as written: its value is text, or `true` for a bare one (`visible`). */
export interface MarkupAttribute extends MarkupPlace {
  name: string;
  value: string | true;
}

/** An element: its tag as written, its attributes in order, its children. */
export interface MarkupElement extends MarkupPlace {
  type: "element";
  tag: string;
  attributes: MarkupAttribute[];
  children: MarkupChild[];
}

/** Text between tags, entities decoded, whitespace as written. */
export interface MarkupText extends MarkupPlace {
  type: "text";
  text: string;
}

export type MarkupChild = MarkupElement | MarkupText;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const NAME = /[A-Za-z_][\w.:-]*/y;

/**
 * Reads markup into elements and text. Comments (`<!-- -->`) are dropped. Every tag must be
 * closed, by `</tag>` or as `<tag />`.
 */
export function readMarkup(source: string, file?: string): MarkupChild[] {
  let i = 0;
  // Line starts, for a place from an index.
  const starts = [0];
  for (let k = 0; k < source.length; k++) if (source[k] === "\n") starts.push(k + 1);
  const place = (at: number): MarkupPlace => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: at - starts[lo] + 1 };
  };
  function fail(reason: string, at: number): never {
    const p = place(at);
    throw new InkMarkupError(reason, p.line, p.column, file);
  }
  const decode = (text: string, at: number): string =>
    text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string, offset: number) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (!Number.isFinite(code) || code > 0x10ffff) fail(`"${whole}" is not a character`, at + offset);
        return String.fromCodePoint(code);
      }
      const known = ENTITIES[name.toLowerCase()];
      if (known === undefined) fail(`"${whole}" is not an entity: use &amp; &lt; &gt; &quot; or &apos;`, at + offset);
      return known;
    });
  const name = (): string | null => {
    NAME.lastIndex = i;
    const m = NAME.exec(source);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const spaces = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };

  const root: MarkupChild[] = [];
  const open: { element: MarkupElement; at: number }[] = [];
  const into = () => (open.length ? open[open.length - 1].element.children : root);

  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) fail("a comment is not closed with -->", i);
      i = end + 3;
      continue;
    }
    if (source.startsWith("</", i)) {
      const at = i;
      i += 2;
      const tag = name();
      if (!tag) fail("a closing tag needs a name", at);
      spaces();
      if (source[i] !== ">") fail(`</${tag} is not closed with >`, at);
      i++;
      const top = open.pop();
      if (!top) fail(`</${tag}> closes nothing`, at);
      if (top!.element.tag !== tag) {
        const p = place(top!.at);
        fail(`</${tag}> closes <${top!.element.tag}> from line ${p.line}`, at);
      }
      continue;
    }
    if (source[i] === "<") {
      const at = i;
      i++;
      if (source[i] === "!" || source[i] === "?") fail("only tags, text and comments are allowed here", at);
      const tag = name();
      if (!tag) fail("a tag needs a name right after <", at);
      const element: MarkupElement = { type: "element", tag: tag!, attributes: [], children: [], ...place(at) };
      for (;;) {
        spaces();
        if (i >= source.length) fail(`<${tag}> is not closed with >`, at);
        if (source.startsWith("/>", i)) {
          i += 2;
          into().push(element);
          break;
        }
        if (source[i] === ">") {
          i++;
          into().push(element);
          open.push({ element, at });
          break;
        }
        const attrAt = i;
        const attr = name();
        if (!attr) fail(`"${source[i]}" cannot start an attribute name in <${tag}>`, i);
        if (element.attributes.some((a) => a.name === attr)) fail(`${attr} is given twice in <${tag}>`, attrAt);
        spaces();
        let value: string | true = true;
        if (source[i] === "=") {
          i++;
          spaces();
          const quote = source[i];
          if (quote !== '"' && quote !== "'") fail(`${attr}'s value needs quotes: ${attr}="..."`, i);
          const end = source.indexOf(quote, i + 1);
          if (end < 0) fail(`${attr}'s value is not closed with ${quote}`, i);
          value = decode(source.slice(i + 1, end), i + 1);
          i = end + 1;
        }
        element.attributes.push({ name: attr!, value, ...place(attrAt) });
      }
      continue;
    }
    const at = i;
    const end = source.indexOf("<", i);
    const raw = source.slice(i, end < 0 ? source.length : end);
    i += raw.length;
    if (raw.includes(">")) fail('">" in text: write &gt;', at + raw.indexOf(">"));
    into().push({ type: "text", text: decode(raw, at), ...place(at) });
  }
  if (open.length) {
    const top = open[open.length - 1];
    fail(`<${top.element.tag}> is never closed: add </${top.element.tag}> or write <${top.element.tag} />`, top.at);
  }
  return root;
}
