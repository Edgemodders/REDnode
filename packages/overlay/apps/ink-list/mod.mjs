// Ink list: the test of phase I2c's trees from data (docs/ink.md). A list of contracts on the
// HUD, drawn by the game, built from data with ink.list; the window's buttons change the data,
// and only what changed goes to the game. The plugin logs each batch that adds, removes or
// moves widgets ("Ink: ink-list: 1 add, 0 remove, 0 move, 0 set"), to check that.

import { ink, ui } from 'rednode';

const NAMES = ['Watson', 'Kabuki', 'Japantown', 'Heywood', 'Santo Domingo', 'Pacifica', 'Dogtown', 'Westbrook', 'City Center'];
let nextId = 1;
const contract = () => ({ id: nextId++, name: NAMES[(nextId - 2) % NAMES.length], reward: 500 * (1 + ((nextId * 7) % 9)) });
let contracts = [contract(), contract(), contract()];

const row = (c) =>
  ink.row(
    { gap: 16, align: 'center' },
    ink.text(`#${c.id}`, { style: 'small', tone: 'dim' }),
    ink.text(c.name, { style: 'body' }),
    ink.text(`${c.reward} €$`, { style: 'value' }),
  );

const log = ui.list({ keep: 200 });
function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

let list = null;
let mount = null;
const summary = () => contracts.map((c) => `#${c.id} ${c.name}`).join(', ');

function change(label, fn) {
  if (!list) return say(`${label}: press Show first`);
  fn();
  list.set({ items: contracts });
  say(`${label}: ${summary()}`);
}

// Rebuilding the whole tree from data with mount.update: the same shape keeps the widgets.
const board = (title) =>
  ink.column({ gap: 10 }, ink.text(title, { style: 'label' }), ink.text(`${contracts.length} contracts`, { style: 'small', tone: 'dim' }));

let header = null;
let titleAt = 0;

ui.window({
  title: 'Ink list',
  anchor: 'right',
  x: -40,
  y: 0,
  width: 520,
  height: 620,
  closable: true,
  children: [
    ui.text('A list on the HUD at the left, from data. Close the overlay (F10) to see it.', { tone: 'dim' }),
    ui.row(
      ui.button('Show', () => {
        mount?.unmount();
        header?.unmount();
        list = ink.list({ gap: 8, items: contracts }, row, (c) => c.id);
        mount = ink.mount('hud', { anchor: 'left', x: 80, y: 60 }, list);
        header = ink.mount('hud', { anchor: 'left', x: 80, y: -120 }, board('Contracts'));
        say(`Show: ${summary()}`);
      }),
      ui.button('Remove all', () => {
        mount?.unmount();
        header?.unmount();
        mount = header = list = null;
        say('Removed');
      }, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Add', () => change('Add', () => contracts.push(contract()))),
      ui.button('Add at top', () => change('Add at top', () => contracts.unshift(contract())), { variant: 'ghost' }),
      ui.button('Remove first', () => change('Remove first', () => contracts.shift()), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Last to top', () => change('Last to top', () => contracts.unshift(contracts.pop()))),
      ui.button('Rename second', () =>
        change('Rename second', () => {
          if (contracts[1]) contracts[1] = { ...contracts[1], name: `${contracts[1].name} prime` };
        }), { variant: 'ghost' }),
      ui.button('Shuffle', () => change('Shuffle', () => contracts.reverse()), { variant: 'ghost' }),
    ),
    ui.button('Update header (mount.update)', () => {
      if (!header) return say('Update header: press Show first');
      titleAt = (titleAt + 1) % 3;
      header.update(board(['Contracts', 'Open gigs', 'Fixer board'][titleAt]));
      say(`Update header: "${['Contracts', 'Open gigs', 'Fixer board'][titleAt]}", ${contracts.length} contracts`);
    }),
    log,
  ],
});

say('Ink list ready');
