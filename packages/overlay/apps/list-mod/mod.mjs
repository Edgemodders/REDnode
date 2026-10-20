// Live log mod: a window built around ui.list, a list of lines that scrolls on its own.
// It keeps the newest 300 lines, follows the newest one unless you scroll up, and fills
// the window's free height, so the window itself never scrolls.

import { game, ui } from 'rednode';

const time = () => new Date().toLocaleTimeString();
const log = ui.list({ keep: 300 });
let lines = 0;
const count = ui.text('No lines yet.', { tone: 'dim' });

function add(text) {
  log.push(`${time()}  ${text}`);
  lines++;
  count.set({ text: `${lines} lines so far; the list keeps the newest 300.` });
}

ui.window({
  title: 'Live log',
  width: 440,
  height: 380,
  children: [
    count,
    log,
    ui.row(
      ui.button('Add a line', () => add('A line from the button')),
      ui.button('Clear', () => log.clear(), { variant: 'ghost' }),
    ),
  ],
});

setInterval(async () => {
  try {
    const p = await game.player.position();
    add(`V at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
  } catch (err) {
    add(`No position: ${err.message}`);
  }
}, 2000);

game.on('PlayerPuppet.OnGameAttached', (e) => add(`Game event ${e.name}`));
game.onState((s) => add(`State: ${Object.entries(s).filter(([, v]) => v === true).map(([k]) => k).join(', ') || 'gameplay'}`));
