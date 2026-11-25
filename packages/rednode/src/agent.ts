/**
 * Questions to the AI assistant: a package asks, the assistant package (REDagent)
 * answers, through the REDnode host. Works in Node mods and overlay apps.
 *
 * @module
 */

import { transport } from "./transport.js";

/**
 * The most a question's `context` may be, as JSON: 65,536 characters (#54). A bigger one is
 * refused with an error, never cut.
 */
export const AGENT_CONTEXT_LIMIT = 65536;
/** The most a question's prompt may be: 20,000 characters. A longer one is refused with an error, never cut. */
export const AGENT_PROMPT_LIMIT = 20000;

/** A model family for {@link AskOptions.model}; the assistant takes its newest model of that family. */
export type AgentModel = "sonnet" | "opus" | "haiku";

/** The answer to {@link agent.ask}. */
export interface AgentAnswer {
  /** The whole answer, as plain text or simple Markdown. */
  text: string;
  /** What the answer cost the player, in US dollars. */
  cost: number;
}

/** Options for {@link agent.ask}. */
export interface AskOptions {
  /**
   * Data the assistant needs, such as the mod's state. Sent as JSON beside the question, whole:
   * at most {@link AGENT_CONTEXT_LIMIT} (65,536) characters of JSON. A bigger one is refused
   * with an error before anything is sent (REDnode 0.72.0; before it, REDagent cut it at 8,000
   * characters without a word).
   */
  context?: unknown;
  /**
   * `false`: the assistant answers from the prompt and the context only, with none of REDnode's
   * tools (no logs, game reads or files). Faster and cheaper, for a question whose context holds
   * everything, such as "write one post as this person". Default `true`. REDnode 0.72.0 and
   * REDagent 0.4.5 or later; an older one answers with tools.
   */
  tools?: boolean;
  /**
   * A model family: `"sonnet"` (the default), `"opus"` for harder questions, `"haiku"` for quick,
   * cheap ones. The assistant takes its newest model of that family, so a package never pins a
   * model id; another name is refused with an error. Each costs the player a different amount;
   * the daily limit per package covers it. REDnode 0.72.0 and REDagent 0.4.5 or later.
   */
  model?: AgentModel;
  /** Called with each piece of the answer as it is written, for showing it while it streams. */
  onText?: (text: string) => void;
  /** Stops the question. The promise then rejects. */
  signal?: AbortSignal;
}

/** A question as the assistant package receives it in {@link agent.serve}. */
export interface AgentRequest {
  /** The package that asks. */
  from: { id: string; name: string };
  prompt: string;
  context?: unknown;
  /** `false` when the asker wants an answer without tools ({@link AskOptions.tools}). */
  tools: boolean;
  /** The model family the asker wants, if it named one ({@link AskOptions.model}). */
  model?: string;
  /** Aborted when the asker cancels. */
  signal: AbortSignal;
  /** Sends a piece of the answer to the asker while it is written. */
  write(text: string): void;
}

/** What an {@link agent.serve} handler returns: the cost, and the text if it was not written piece by piece. */
export interface AgentResult {
  text?: string;
  cost?: number;
}

interface AgentTransport {
  agent?(msg: Record<string, unknown>): void;
}

function send(msg: Record<string, unknown>): void {
  const fromMod = transport() as AgentTransport;
  const fromPage = (globalThis as Record<string, unknown>).rednode as AgentTransport | undefined;
  const t = fromMod.agent ? fromMod : fromPage;
  if (!t?.agent) throw new Error("rednode: agent needs the REDnode host");
  t.agent(msg);
}

// What is wrong with a question before it is sent, or null (#54). The host checks the same.
function askRefusal(prompt: string, options: AskOptions): string | null {
  if (typeof prompt !== "string" || !prompt.trim()) return "agent.ask needs a question.";
  if (prompt.length > AGENT_PROMPT_LIMIT) return `The question is ${prompt.length} characters; agent.ask takes at most ${AGENT_PROMPT_LIMIT}. Put the data in context.`;
  if (options.tools !== undefined && typeof options.tools !== "boolean") return "agent.ask's tools must be true or false.";
  if (options.model !== undefined && (typeof options.model !== "string" || !/^[a-z0-9-]{1,32}$/.test(options.model))) {
    return 'agent.ask\'s model must be a model family, such as "sonnet", "opus" or "haiku".';
  }
  if (options.context !== undefined) {
    let json: string | undefined;
    try {
      json = JSON.stringify(options.context);
    } catch (err) {
      return `agent.ask's context cannot be sent as JSON: ${(err as Error).message}`;
    }
    if (json !== undefined && json.length > AGENT_CONTEXT_LIMIT) {
      return `The context is ${json.length} characters of JSON; agent.ask takes at most ${AGENT_CONTEXT_LIMIT}. Send less, such as only the recent posts.`;
    }
  }
  return null;
}

interface Pending {
  resolve(answer: AgentAnswer): void;
  reject(err: Error): void;
  onText?: (text: string) => void;
  text: string;
}
let nextAsk = 1;
const asks = new Map<number, Pending>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "agent") return;
    const p = asks.get(Number(m.aid));
    if (!p) return;
    if (m.type === "text") {
      const t = String(m.text ?? "");
      p.text += t;
      p.onText?.(t);
      return;
    }
    asks.delete(Number(m.aid));
    if (m.type === "done") p.resolve({ text: typeof m.text === "string" && m.text ? m.text : p.text, cost: Number(m.cost) || 0 });
    else p.reject(new Error(String(m.error ?? "The assistant could not answer.")));
  });
}

/**
 * The AI assistant, for any package. Asking needs `"permissions": ["agent"]` in
 * the package's rednode-app.json and the player's OK in the launcher or the Mod
 * Manager. Every answer costs the player a little, so ask when it helps them;
 * a mod that asks on its own (a feed that writes posts) keeps it rare and says
 * so in its description. The assistant (REDagent) answers with read-only tools:
 * it can look at logs, the game state and the game API, but never changes
 * anything; `tools: false` answers from the prompt and context alone. It keeps a
 * daily spending limit per package; past it, questions fail.
 *
 * @example
 * ```ts
 * import { agent, ui } from "rednode";
 *
 * const answer = ui.text("");
 * const { text, cost } = await agent.ask("Suggest a build for a netrunner at level 12.", {
 *   context: { level: 12, attributes: { intelligence: 9 } },
 *   onText: (t) => answer.set({ text: answer.props.text + t }),
 * });
 * console.log(`That cost $${cost.toFixed(3)}`);
 *
 * // Everything it needs is in the context: no tools, a quick answer.
 * const post = await agent.ask("Write one short post as this person. Answer as JSON: { text }.", {
 *   context: { person: cards, recent: lastPosts, district: "Watson", time: "21:40" },
 *   tools: false,
 * });
 * ```
 */
export const agent = {
  /** Asks a question. Resolves with the whole answer; rejects if it is refused, fails or is stopped. */
  ask(prompt: string, options: AskOptions = {}): Promise<AgentAnswer> {
    listen();
    const aid = nextAsk++;
    return new Promise<AgentAnswer>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error("Stopped."));
        return;
      }
      const why = askRefusal(prompt, options);
      if (why) {
        reject(new Error(why));
        return;
      }
      asks.set(aid, { resolve, reject, onText: options.onText, text: "" });
      options.signal?.addEventListener("abort", () => {
        if (!asks.has(aid)) return;
        asks.delete(aid);
        send({ op: "cancel", aid });
        reject(new Error("Stopped."));
      });
      try {
        send({
          op: "ask",
          aid,
          prompt,
          context: options.context,
          ...(options.tools === false ? { tools: false } : {}),
          ...(options.model !== undefined ? { model: options.model } : {}),
        });
      } catch (err) {
        asks.delete(aid);
        reject(err as Error);
      }
    });
  },

  /**
   * For the assistant package only (its manifest says `"provides": ["agent"]`):
   * answers other packages' questions. The handler writes the answer with
   * `request.write` as it streams, or returns it, and returns the cost.
   * A thrown error goes back to the asker as the reason.
   */
  serve(handler: (request: AgentRequest) => Promise<AgentResult | void>): () => void {
    const running = new Map<number, AbortController>();
    const stop = transport().listen((m) => {
      if (m.event === "agent-cancel") {
        running.get(Number(m.rid))?.abort();
        return;
      }
      if (m.event !== "agent-request") return;
      const rid = Number(m.rid);
      const controller = new AbortController();
      running.set(rid, controller);
      const request: AgentRequest = {
        from: m.from as { id: string; name: string },
        prompt: String(m.prompt ?? ""),
        context: m.context,
        tools: m.tools !== false,
        ...(typeof m.model === "string" ? { model: m.model } : {}),
        signal: controller.signal,
        write: (text) => send({ op: "reply", rid, type: "text", text }),
      };
      Promise.resolve()
        .then(() => handler(request))
        .then(
          (result) => send({ op: "reply", rid, type: "done", text: result?.text ?? "", cost: result?.cost ?? 0 }),
          (err) => send({ op: "reply", rid, type: "error", error: String((err as Error)?.message ?? err) }),
        )
        .finally(() => running.delete(rid));
    });
    send({ op: "serve" });
    return stop;
  },
};
