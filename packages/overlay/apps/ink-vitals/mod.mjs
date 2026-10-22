// Ink vitals: health, RAM and money on the HUD, drawn by the game (the ink API, I2c).
// Every value is bound: the plugin reads it every frame and changes the screen only when it
// changes, so a hit shows at once. This mod builds the tree and sends nothing after that.

import { ink } from 'rednode';

// A label, a bar and its number, in one row.
const meter = (label, bind, of, tone, format) =>
  ink.row(
    { gap: 14, align: 'center' },
    ink.text(label, { style: 'small', tone: 'dim', width: 80, height: 40 }),
    ink.bar({ bind, of, width: 320, height: 10, tone }),
    ink.text('', { style: 'value', tone, bind, format }),
  );

ink.mount(
  'hud',
  { anchor: 'bottom-left', x: 80, y: -300 },
  ink.column(
    { gap: 8 },
    ink.text('Vitals', { style: 'label' }),
    meter('HP', 'player.health', 'player.healthMax', 'normal', '{value}'),
    meter('RAM', 'player.memory', 100, 'accent', '{value}%'),
    ink.text('', { style: 'value', tone: 'highlight', bind: 'player.money', format: '{value} €$' }),
  ),
);

console.log('Ink vitals ready: the plugin reads every value; this mod sends nothing more');
