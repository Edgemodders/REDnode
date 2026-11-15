/**
 * The player's controller, read by REDnode's plugin (REDnode 0.65.0): which buttons are held and
 * how far each trigger is pressed, as changes arrive. A first small piece of the Input phase
 * (I3); keys and the game's own input actions come later.
 *
 * Only reads: the game still gets every button and trigger, so a mod that gives a button its
 * own meaning should pick one the game does nothing with in that moment.
 *
 * @module
 */

import { transport, type HostMessage } from "./transport.js";

/** A controller button, by XInput's names. */
export type GamepadButton =
  | "a" | "b" | "x" | "y"
  | "lb" | "rb" | "ls" | "rs"
  | "up" | "down" | "left" | "right"
  | "start" | "back";

/** The controller after a change. */
export interface GamepadState {
  /** False when the controller was unplugged or turned off (then nothing is held). */
  connected: boolean;
  /** Every button held now. */
  buttons: GamepadButton[];
  /** The buttons that went down with this change. */
  pressed: GamepadButton[];
  /** The buttons that came up with this change. */
  released: GamepadButton[];
  /** The left trigger, 0 (let go) to 1 (pressed all the way). Sent in steps of about 1/16. */
  lt: number;
  /** The right trigger, 0 to 1. */
  rt: number;
}

let last: GamepadState = { connected: false, buttons: [], pressed: [], released: [], lt: 0, rt: 0 };
let watching = false;

// The plugin's "gamepad" game event, read whole (game.on keeps only the common fields).
const names = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as GamepadButton[]) : []);
function stateOf(m: HostMessage): GamepadState {
  return { connected: !!m.connected, buttons: names(m.buttons), pressed: names(m.pressed), released: names(m.released), lt: Number(m.lt) || 0, rt: Number(m.rt) || 0 };
}
function onPad(fn: (pad: GamepadState) => void) {
  return transport().listen((m) => {
    if (m.event === "game" && m.name === "gamepad") fn(stateOf(m));
  });
}

function watch() {
  if (watching) return;
  watching = true;
  onPad((pad) => (last = pad));
}

/** The player's controller. */
export const input = {
  /**
   * Calls `handler` with the controller's state each time it changes: a button down or up, a
   * trigger moving a step or reaching 0 or 1, the controller connected or gone. Changes come
   * only while the game is in front (out of it, nothing counts as held).
   *
   * @returns A function that stops listening.
   *
   * @example
   * ```ts
   * import { input } from "rednode";
   *
   * let held = false;
   * input.onGamepad((pad) => {
   *   if (!held && pad.rt > 0.5) { held = true; console.log("right trigger down"); }
   *   if (held && pad.rt < 0.2) { held = false; console.log("right trigger up"); }
   *   if (pad.pressed.includes("y")) console.log("Y pressed");
   * });
   * ```
   */
  onGamepad(handler: (pad: GamepadState) => void) {
    watch();
    return onPad(handler);
  },

  /**
   * The controller's state as last heard by this package. Before the first change it reads as
   * not connected with nothing held, so listen with {@link input.onGamepad} for anything that
   * must not be missed.
   */
  gamepad(): GamepadState {
    watch();
    return { ...last, buttons: [...last.buttons], pressed: [...last.pressed], released: [...last.released] };
  },
};
