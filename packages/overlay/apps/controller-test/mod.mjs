// Controller test: shows what REDnode's plugin reads from the player's controller (REDnode
// 0.65.0 and later, input.onGamepad): connected or not, the buttons held, both triggers, and
// which of the 14 buttons have been seen so far. Every press, release, trigger end and
// connection change also goes to the Mod log and red4ext/logs/rednode-mods.log.
//
// It only reads: the game still gets every button, so press them where the game does no harm
// (the pause menu, or standing still).

import { input, ui } from 'rednode';

const ALL = ['a', 'b', 'x', 'y', 'lb', 'rb', 'ls', 'rs', 'up', 'down', 'left', 'right', 'start', 'back'];
const seen = new Set();
const time = () => new Date().toLocaleTimeString();

const status = ui.text('No controller heard yet. Press any button.', { tone: 'dim' });
const held = ui.text('Held: nothing');
const lt = ui.progress(0, { label: 'Left trigger', max: 100 });
const rt = ui.progress(0, { label: 'Right trigger', max: 100 });
const count = ui.text(`Seen 0 of ${ALL.length} buttons.`, { tone: 'dim' });
const missing = ui.text(`Not seen yet: ${ALL.join(', ')}`, { tone: 'dim' });
const log = ui.list({ keep: 200 });

function note(text) {
  log.push(`${time()}  ${text}`);
  console.log(text);
}

let wasConnected = null;
let ltEnd = 0;
let rtEnd = 0;
// A trigger counts as at an end when it is let go (0) or all the way in (1).
const endOf = (v) => (v >= 0.98 ? 1 : v <= 0.02 ? 0 : -1);

input.onGamepad((pad) => {
  if (pad.connected !== wasConnected) {
    wasConnected = pad.connected;
    status.set({ text: pad.connected ? 'Controller connected.' : 'Controller gone (unplugged or turned off).', tone: pad.connected ? 'accent' : 'danger' });
    note(pad.connected ? 'Connected' : 'Gone');
  }
  for (const b of pad.pressed) {
    note(`Pressed ${b}`);
    seen.add(b);
  }
  for (const b of pad.released) note(`Released ${b}`);
  if (pad.pressed.length) {
    count.set({ text: `Seen ${seen.size} of ${ALL.length} buttons.`, tone: seen.size === ALL.length ? 'accent' : 'dim' });
    const left = ALL.filter((b) => !seen.has(b));
    missing.set({ text: left.length ? `Not seen yet: ${left.join(', ')}` : 'Every button seen.' });
  }
  held.set({ text: `Held: ${pad.buttons.length ? pad.buttons.join(' + ') : 'nothing'}` });
  lt.set({ value: Math.round(pad.lt * 100) });
  rt.set({ value: Math.round(pad.rt * 100) });
  const l = endOf(pad.lt);
  const r = endOf(pad.rt);
  if (l >= 0 && l !== ltEnd) note(l ? 'Left trigger all the way in' : 'Left trigger let go');
  if (r >= 0 && r !== rtEnd) note(r ? 'Right trigger all the way in' : 'Right trigger let go');
  if (l >= 0) ltEnd = l;
  if (r >= 0) rtEnd = r;
});

ui.window({
  title: 'Controller test',
  width: 440,
  height: 520,
  children: [
    status,
    held,
    lt,
    rt,
    count,
    missing,
    log,
    ui.row(ui.button('Clear the list', () => log.clear(), { variant: 'ghost' })),
  ],
});

console.log('Controller test started');
