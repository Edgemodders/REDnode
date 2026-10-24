// Counter service: every function this file exports can be called by other packages,
// by this package's id ("counter-service"), through the REDnode host. It has no
// window and no main: the service file is the whole package.

import { service } from 'rednode';

let count = 0;

/**
 * The count now.
 * @tool
 * @readonly
 * @returns {number} The count.
 */
export function get() {
  return count;
}

/**
 * Adds to the count, and tells every connected package.
 * @tool
 * @param {number} [by=1] How much to add; negative takes away.
 * @returns {number} The new count.
 */
export function add(by = 1) {
  if (typeof by !== 'number' || !Number.isFinite(by)) throw new Error('add needs a number');
  count += by;
  const who = service.caller();
  service.emit('changed', { count, by, from: who?.name ?? who?.assistant ?? 'unknown' });
  return count;
}

/**
 * Sets the count back to 0.
 * @tool
 * @returns {number} 0.
 */
export function reset() {
  count = 0;
  service.emit('changed', { count, by: 0, from: service.caller()?.name ?? 'unknown' });
  return count;
}

/**
 * Waits, then answers: for trying timeouts and Stop. Ends early when the caller gives up.
 * @param {number} ms How long to wait, in milliseconds.
 * @returns {string} How long it waited.
 */
export function wait(ms) {
  const signal = service.signal();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(`waited ${ms} ms`), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      console.log(`wait(${ms}) stopped: the caller gave up`);
      reject(new Error('stopped'));
    });
  });
}

/**
 * Always fails: for seeing how an error reaches the caller.
 */
export function fail() {
  throw new Error('Counter service failed on purpose');
}
