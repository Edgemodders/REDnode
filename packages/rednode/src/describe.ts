/**
 * Service descriptions from JSDoc (SV2, docs/services.md): reads a service file's source,
 * finds its exported functions and the JSDoc above each, and turns them into descriptors
 * with JSON Schema for the parameters. The REDnode host uses it when a package's service
 * loads; `rednode describe` writes the same as service.json for bundled or TypeScript
 * packages, whose built files have lost their comments. No Node imports: it runs anywhere.
 *
 * @internal
 * @module
 */

/** A JSON Schema, in the subset REDnode writes and checks. */
export interface Schema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  enum?: (string | number | boolean | null)[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  description?: string;
}

/** One parameter of a service function. */
export interface ParamDescriptor {
  name: string;
  /** The type as written, such as `number` or `{ x: number, y: number }`. */
  type: string;
  description: string;
  optional: boolean;
  /** The default as written in the source, for people. */
  default?: string;
  schema: Schema;
}

/** One service function, as its JSDoc and signature describe it. */
export interface FunctionDescriptor {
  name: string;
  description: string;
  params: ParamDescriptor[];
  /** False when the function has neither JSDoc parameters nor a parameter list REDnode could read: its calls are not checked. */
  checked: boolean;
  returns: { type: string; description: string; schema: Schema } | null;
  /** `@tool`: an AI assistant may call it (SV3). */
  tool: boolean;
  /** `@readonly`: it changes nothing, so an assistant calls it without asking. */
  readonly: boolean;
  /** `@timeout <ms>`: how long a call may take before it fails. */
  timeoutMs: number | null;
  /** `@deprecated <why>`. */
  deprecated: string | null;
}

/** One event the service sends, from `@event name {type} description`. */
export interface EventDescriptor {
  name: string;
  type: string;
  description: string;
  schema: Schema;
}

/** A whole service file's description: what service.json holds. */
export interface ServiceDescriptor {
  format: 1;
  functions: Record<string, FunctionDescriptor>;
  events: Record<string, EventDescriptor>;
  /** Things the reader could not understand, for the Mod log. */
  warnings: string[];
}

// ---------- types to JSON Schema ----------

const PRIMITIVES: Record<string, Schema> = {
  string: { type: "string" },
  number: { type: "number" },
  integer: { type: "integer" },
  int: { type: "integer" },
  boolean: { type: "boolean" },
  bool: { type: "boolean" },
  null: { type: "null" },
  object: { type: "object" },
  Object: { type: "object" },
  array: { type: "array" },
  Array: { type: "array" },
  any: {},
  unknown: {},
  "*": {},
};

/** Splits on a separator at the top level: not inside braces, brackets, angles, parentheses or quotes. */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === ">" && text[i - 1] === "=") continue; // an arrow, not a closing angle
    else if ("{[(<".includes(c)) depth++;
    else if ("}])>".includes(c)) depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim());
}

/**
 * The JSON Schema of a type written in JSDoc or TypeScript: primitives, string and number
 * literals, unions, `T[]`, `Array<T>`, object literals with optional members, and
 * parentheses. Anything else becomes "any value" and is reported in `unknown`.
 */
export function schemaOf(type: string, unknown: string[] = []): Schema {
  let t = type.trim();
  if (!t) return {};
  // JSDoc's {{ a: number }}: the outer braces are the tag's, the inner the object's.
  while (t.startsWith("(") && group(t, 0)?.end === t.length - 1) t = t.slice(1, -1).trim();
  const union = splitTop(t, "|").filter(Boolean);
  if (union.length > 1) {
    const parts = union.map((u) => schemaOf(u, unknown));
    // A union of literals is an enum.
    if (parts.every((p) => p.enum && !p.type)) return { enum: parts.flatMap((p) => p.enum!) };
    return { anyOf: parts };
  }
  if (t.endsWith("[]")) return { type: "array", items: schemaOf(t.slice(0, -2), unknown) };
  const generic = /^(Array|ReadonlyArray)<(.*)>$/s.exec(t);
  if (generic) return { type: "array", items: schemaOf(generic[2], unknown) };
  if (/^Record<\s*string\s*,/.test(t) || /^\{\s*\[\s*\w+\s*:\s*string\s*\]\s*:/.test(t)) return { type: "object" };
  if (/^(['"`]).*\1$/s.test(t)) return { enum: [t.slice(1, -1)] };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { enum: [Number(t)] };
  if (t === "true" || t === "false") return { enum: [t === "true"] };
  if (t === "undefined" || t === "void") return { type: "null" };
  if (t.startsWith("{") && t.endsWith("}")) {
    const body = t.slice(1, -1).trim();
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const member of splitTop(body, ",").flatMap((m) => splitTop(m, ";")).filter(Boolean)) {
      const m = /^(\w+)(\?)?\s*:\s*(.+)$/s.exec(member);
      if (!m) {
        unknown.push(member);
        continue;
      }
      properties[m[1]] = schemaOf(m[3], unknown);
      if (!m[2]) required.push(m[1]);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}) };
  }
  if (t in PRIMITIVES) return { ...PRIMITIVES[t] };
  unknown.push(t);
  return {};
}

// ---------- reading the source ----------

/** The text of a balanced bracket group starting at `open`, without the brackets, and where it ends. */
function group(text: string, open: number): { inner: string; end: number } | null {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const close = pairs[text[open]];
  if (!close) return null;
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === text[open]) depth++;
    else if (c === close && --depth === 0) return { inner: text.slice(open + 1, i), end: i };
  }
  return null;
}

interface Tag {
  tag: string;
  text: string;
}

/** A JSDoc block's description and tags. */
function parseJsDoc(block: string): { description: string; tags: Tag[] } {
  const lines = block
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, ""));
  const description: string[] = [];
  const tags: Tag[] = [];
  for (const line of lines) {
    const m = /^@(\w+)\s*(.*)$/.exec(line.trim());
    if (m) tags.push({ tag: m[1], text: m[2] });
    else if (tags.length) tags[tags.length - 1].text += `\n${line}`;
    else description.push(line);
  }
  return { description: description.join("\n").trim(), tags };
}

/** `{type} rest` -> the type (braces balanced, JSDoc's double braces kept as an object) and the rest. */
function takeType(text: string): { type: string | null; rest: string } {
  const t = text.trimStart();
  if (!t.startsWith("{")) return { type: null, rest: t };
  const g = group(t, 0);
  if (!g) return { type: null, rest: t };
  return { type: g.inner.trim(), rest: t.slice(g.end + 1).trim() };
}

const cleanDescription = (s: string) => s.replace(/^-\s*/, "").replace(/\s+/g, " ").trim();

interface SignatureParam {
  name: string;
  type: string | null;
  optional: boolean;
  default?: string;
}

/** The parameters in a function's parameter list, with TypeScript types and defaults if written. */
function signatureParams(list: string): SignatureParam[] | null {
  const parts = splitTop(list, ",").filter(Boolean);
  const out: SignatureParam[] = [];
  for (const p of parts) {
    const m = /^(\.\.\.)?\s*(\w+)\s*(\?)?\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/s.exec(p);
    if (!m) return null; // destructuring or something unusual: not read
    if (m[1]) return null; // rest parameters: not checked
    out.push({ name: m[2], type: m[4]?.trim() ?? null, optional: !!m[3] || m[5] !== undefined, ...(m[5] !== undefined ? { default: m[5].trim() } : {}) });
  }
  return out;
}

/**
 * Describes a service file from its source. `exported`, when given, is the list of
 * functions the file really exports (from loading it); functions found only in the source
 * are then left out, and exported ones with no JSDoc get an unchecked descriptor.
 */
export function describeSource(source: string, exported?: string[]): ServiceDescriptor {
  const warnings: string[] = [];
  const functions: Record<string, FunctionDescriptor> = {};
  const events: Record<string, EventDescriptor> = {};
  const text = source.replace(/\r\n/g, "\n");

  // Events may be described in any JSDoc block.
  for (const block of text.match(/\/\*\*[\s\S]*?\*\//g) ?? []) {
    for (const t of parseJsDoc(block).tags.filter((x) => x.tag === "event")) {
      const m = /^([\w:.-]+)\s*([\s\S]*)$/.exec(t.text.trim());
      if (!m) continue;
      const { type, rest } = takeType(m[2]);
      const unknown: string[] = [];
      events[m[1]] = { name: m[1], type: type ?? "any", description: cleanDescription(rest), schema: type ? schemaOf(type, unknown) : {} };
      for (const u of unknown) warnings.push(`event ${m[1]}: type "${u}" is read as any value`);
    }
  }

  // export [async] function name(...), export const name = [async] (...) => / function (...)
  const decl = /(\/\*\*[\s\S]*?\*\/\s*)?export\s+(?:async\s+)?function\s*\*?\s*(\w+)\s*(?:<[^>]*>)?\s*\(|(\/\*\*[\s\S]*?\*\/\s*)?export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\s*\w*\s*)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(text))) {
    const doc = m[1] ?? m[3] ?? null;
    const name = m[2] ?? m[4];
    const open = decl.lastIndex - 1;
    const g = group(text, open);
    // Only the comment right above counts: the match may start at an earlier block.
    const block = doc ? doc.slice(doc.lastIndexOf("/**")).trim() : null;
    functions[name] = describeFunction(name, block, g ? g.inner : null, warnings);
  }
  // export { a, b as c }: described only by name.
  for (const e of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of e[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (n && !(n in functions)) functions[n] = describeFunction(n, null, null, warnings);
    }
  }

  if (exported) {
    for (const n of Object.keys(functions)) if (!exported.includes(n)) delete functions[n];
    for (const n of exported) if (!(n in functions)) functions[n] = describeFunction(n, null, null, warnings);
  }
  return { format: 1, functions, events, warnings };
}

function describeFunction(name: string, block: string | null, paramList: string | null, warnings: string[]): FunctionDescriptor {
  const doc = block ? parseJsDoc(block) : { description: "", tags: [] as Tag[] };
  const sig = paramList === null ? null : signatureParams(paramList);
  const unknown: string[] = [];
  const params: ParamDescriptor[] = [];
  const docParams = doc.tags.filter((t) => t.tag === "param" || t.tag === "arg" || t.tag === "argument");
  for (const t of docParams) {
    const { type, rest } = takeType(t.text);
    const nm = /^(\[)?\s*([\w.]+)\s*(?:=\s*([^\]]*))?(\])?\s*([\s\S]*)$/.exec(rest);
    if (!nm) continue;
    const pname = nm[2];
    if (pname.includes(".")) continue; // a member of an object parameter: its type is written on the parent
    const fromSig = sig?.find((s) => s.name === pname);
    const written = type ?? fromSig?.type ?? null;
    const optionalType = written?.endsWith("=") ?? false; // JSDoc's {number=}
    const typeText = (optionalType ? written!.slice(0, -1) : written) ?? "any";
    params.push({
      name: pname,
      type: typeText,
      description: cleanDescription(nm[5]),
      optional: !!nm[1] || optionalType || !!fromSig?.optional,
      ...(nm[3] ?? fromSig?.default ? { default: (nm[3] ?? fromSig?.default)!.trim() } : {}),
      schema: schemaOf(typeText, unknown),
    });
  }
  // Parameters in the signature that the JSDoc does not name.
  for (const s of sig ?? []) {
    if (params.some((p) => p.name === s.name)) continue;
    params.splice(sig!.indexOf(s), 0, {
      name: s.name,
      type: s.type ?? "any",
      description: "",
      optional: s.optional,
      ...(s.default ? { default: s.default } : {}),
      schema: s.type ? schemaOf(s.type, unknown) : {},
    });
  }
  // In the signature's order, when there is a signature.
  if (sig) params.sort((a, b) => sig.findIndex((s) => s.name === a.name) - sig.findIndex((s) => s.name === b.name));
  const returnsTag = doc.tags.find((t) => t.tag === "returns" || t.tag === "return");
  let returns: FunctionDescriptor["returns"] = null;
  if (returnsTag) {
    const { type, rest } = takeType(returnsTag.text);
    returns = { type: type ?? "any", description: cleanDescription(rest), schema: type ? schemaOf(type.replace(/^Promise<(.*)>$/s, "$1"), unknown) : {} };
  }
  const timeout = doc.tags.find((t) => t.tag === "timeout");
  const deprecated = doc.tags.find((t) => t.tag === "deprecated");
  for (const u of unknown) warnings.push(`${name}: type "${u}" is read as any value`);
  if (!block) warnings.push(`${name}: no JSDoc; its calls are not checked`);
  return {
    name,
    description: cleanDescription(doc.description),
    params,
    checked: !!block && (sig !== null || docParams.length > 0 || params.length === 0),
    returns,
    tool: doc.tags.some((t) => t.tag === "tool"),
    readonly: doc.tags.some((t) => t.tag === "readonly"),
    timeoutMs: timeout && Number(timeout.text.trim()) > 0 ? Number(timeout.text.trim()) : null,
    deprecated: deprecated ? cleanDescription(deprecated.text) || "deprecated" : null,
  };
}

// ---------- checking calls ----------

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  if (typeof v === "number" && Number.isInteger(v)) return "a whole number";
  return `a ${typeof v}`;
}

/** Why a value does not fit a schema, or null when it does. */
export function checkValue(value: unknown, schema: Schema, where: string): string | null {
  if (schema.anyOf) {
    const fits = schema.anyOf.some((s) => checkValue(value, s, where) === null);
    return fits ? null : `${where} is ${typeName(value)}, which fits none of its types`;
  }
  if (schema.enum) {
    return schema.enum.some((e) => e === value) ? null : `${where} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`;
  }
  switch (schema.type) {
    case undefined:
      return null;
    case "string":
    case "boolean":
      return typeof value === schema.type ? null : `${where} must be a ${schema.type}, not ${typeName(value)}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${where} must be a number, not ${typeName(value)}`;
    case "integer":
      return Number.isInteger(value) ? null : `${where} must be a whole number, not ${typeName(value)}`;
    case "null":
      return value === null || value === undefined ? null : `${where} must be empty (null)`;
    case "array": {
      if (!Array.isArray(value)) return `${where} must be an array, not ${typeName(value)}`;
      if (!schema.items) return null;
      for (let i = 0; i < value.length; i++) {
        const why = checkValue(value[i], schema.items, `${where}[${i}]`);
        if (why) return why;
      }
      return null;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return `${where} must be an object, not ${typeName(value)}`;
      for (const r of schema.required ?? []) if (!(r in (value as object))) return `${where} needs "${r}"`;
      for (const [k, s] of Object.entries(schema.properties ?? {})) {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined) continue;
        const why = checkValue(v, s, `${where}.${k}`);
        if (why) return why;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Why a call's arguments do not fit the function's description, or null when they do. */
export function checkArgs(fn: FunctionDescriptor, args: unknown[]): string | null {
  if (!fn.checked) return null;
  if (args.length > fn.params.length) {
    return `${fn.name} takes ${fn.params.length ? `at most ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"} (${fn.params.map((p) => p.name).join(", ")})` : "no arguments"}, not ${args.length}`;
  }
  for (let i = 0; i < fn.params.length; i++) {
    const p = fn.params[i];
    const v = args[i];
    if (v === undefined || v === null) {
      if (!p.optional) return `${fn.name} needs its argument "${p.name}"${p.type !== "any" ? ` (${p.type})` : ""}`;
      continue;
    }
    const why = checkValue(v, p.schema, `"${p.name}"`);
    if (why) return `${fn.name}: ${why}`;
  }
  return null;
}

/**
 * The JSON Schema of a function's parameters as one object, as MCP tools take them:
 * properties by name, with descriptions, and the required ones listed.
 */
export function inputSchema(fn: FunctionDescriptor): Schema & { type: "object" } {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const p of fn.params) {
    properties[p.name] = { ...p.schema, ...(p.description ? { description: p.description + (p.default ? ` Default: ${p.default}.` : "") } : p.default ? { description: `Default: ${p.default}.` } : {}) };
    if (!p.optional) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
