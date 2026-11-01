// Ink markup: the test of UI Tools' phase UT1 (docs/ink.md). The HUD panel is written as ink
// markup in board.ink.html and loaded with ink.load; the window's buttons change its data
// with set(), and only the props that read the changed data go to the game. The plugin logs
// each batch that adds, removes or moves widgets ("Ink: ink-markup: 1 add, ..."), to check that.

import { ink, ui } from 'rednode';

const NAMES = ['Watson', 'Kabuki', 'Japantown', 'Heywood', 'Santo Domingo', 'Pacifica', 'Dogtown', 'Westbrook', 'City Center'];
const TITLES = ['Contracts', 'Bounty board', 'Fixer jobs'];
let nextId = 1;
const contract = () => {
  const id = nextId++;
  return { id, name: NAMES[(id - 1) % NAMES.length], reward: 500 * (1 + ((id * 7) % 9)) };
};
let contracts = [contract(), contract(), contract()];
let titleAt = 0;

const data = () => ({
  title: TITLES[titleAt],
  contracts,
  count: contracts.length,
  total: contracts.reduce((sum, c) => sum + c.reward, 0),
});

const log = ui.list({ keep: 200 });
function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

let view = null;
const summary = () => contracts.map((c) => `#${c.id} ${c.name}`).join(', ') || 'none';

async function show() {
  view?.unmount();
  view = null;
  const started = performance.now();
  try {
    view = await ink.load('board.ink.html', {}, data());
    say(`Show: board.ink.html loaded in ${(performance.now() - started).toFixed(1)} ms; ${summary()}`);
  } catch (err) {
    say(`Show failed: ${err.message}`);
  }
}

function change(label, fn) {
  if (!view) return say(`${label}: press Show first`);
  fn();
  view.set(data());
  say(`${label}: ${summary()}`);
}

// A mistake in markup is refused with its line and column, before anything reaches the game.
const BROKEN = `<mount layer="hud">
  <column gap="6">
    <text style="huge">Too big</text>
  </column>
</mount>`;

ui.window({
  title: 'Ink markup',
  anchor: 'right',
  x: -40,
  y: 0,
  width: 520,
  height: 620,
  closable: true,
  children: [
    ui.text('A panel on the HUD at the left, from board.ink.html. Close the overlay (F10) to see it.', { tone: 'dim' }),
    ui.row(
      ui.button('Show', show),
      ui.button('Remove', () => {
        view?.unmount();
        view = null;
        say('Removed');
      }, { variant: 'ghost' }),
      ui.button('Next title', () => change('Next title', () => (titleAt = (titleAt + 1) % TITLES.length)), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Add', () => change('Add', () => contracts.push(contract()))),
      ui.button('Remove first', () => change('Remove first', () => contracts.shift()), { variant: 'ghost' }),
      ui.button('Rename first', () =>
        change('Rename first', () => {
          if (contracts[0]) contracts[0] = { ...contracts[0], name: `${contracts[0].name} prime` };
        }), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Broken markup', () => {
        try {
          ink.parse(BROKEN);
          say('Broken markup: no error (unexpected)');
        } catch (err) {
          say(`Broken markup refused: ${err.message}`);
        }
      }, { variant: 'ghost' }),
    ),
    log,
  ],
});

await show();
