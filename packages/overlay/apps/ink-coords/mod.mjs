// Ink Coords: the Coords HUD sample, drawn by the game itself with the ink API (I2a).
// The tree is built once; each update changes one text. REDnode builds it again after a
// save load and removes it when this mod stops, so there is nothing to clean up here.

import { game, ink } from 'rednode';

const where = ink.text('Load a save', { size: 30, color: 'cyan' });

ink.mount(
  'hud',
  { anchor: 'top-right', x: -60, y: 260 },
  ink.column({ gap: 4 }, ink.text('REDNODE  //  WHERE', { size: 20, color: 'red' }), where),
);

let shown = '';
async function update() {
  let text;
  try {
    const p = await game.player.position();
    text = `${p.x.toFixed(1)}   ${p.y.toFixed(1)}   ${p.z.toFixed(1)}`;
  } catch {
    text = 'No player';
  }
  if (text === shown) return; // only real changes go to the game
  shown = text;
  where.set({ text });
}

setInterval(update, 250);
update();
console.log('Ink Coords ready');
