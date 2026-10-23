// Ink language: the test of phase I2d (docs/ink.md). A HUD panel in the player's language:
// the game's own text by key (the game translates it itself), and this package's own text from
// locales/<language>.json through t(), with a parameter, plurals, V's gender, a key French
// lacks and one no file has. Switch the game's language in its settings and watch it follow.

import { game, ink, t, ui } from 'rednode';

const status = ui.text('Reading the game language...', { tone: 'dim' });
const log = ui.list({ keep: 200 });
function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

// The language line is a plain text this mod sets itself; everything else follows by itself.
const language = ink.text('', { style: 'small', tone: 'dim' });

ink.mount(
  'hud',
  { anchor: 'left', x: 80, y: -200 },
  ink.column(
    { gap: 6 },
    ink.text(t('title'), { style: 'label' }),
    language,
    ink.row({ gap: 12 }, ink.text(t('gameKey'), { style: 'small' }), ink.text('LocKey#15396', { style: 'value' })),
    ink.text('', { key: 'UI-ResourceExports-Inventory', style: 'body', tone: 'accent' }),
    ink.text(t('reward', { amount: 500 }), { style: 'body' }),
    ink.text(t('found', { count: 1 }), { style: 'body' }),
    ink.text(t('found', { count: 2 }), { style: 'body' }),
    ink.text(t('found', { count: 5 }), { style: 'body' }),
    ink.text(t('thanks'), { style: 'body', tone: 'highlight' }),
    ink.text(t('onlyEnglish'), { style: 'small', tone: 'dim' }),
    ink.text(t('nowhere'), { style: 'small', tone: 'dim' }),
  ),
);

async function showLanguage(why) {
  const { language: name, tag } = await game.language();
  const number = new Intl.NumberFormat(tag).format(1234567.89);
  language.set({ text: `${name}  (${tag})  ${number}` });
  status.set({ text: `Game language: ${name} (${tag}). A number in it: ${number}`, tone: 'normal' });
  say(`${why}: ${name} (${tag}); ${t('reward', { amount: 500 })}; ${t('thanks')}`);
}

game.on('language', (e) => showLanguage(`The language changed to ${e.language}`));

ui.window({
  title: 'Ink language',
  anchor: 'right',
  x: -40,
  y: 0,
  width: 520,
  height: 420,
  closable: true,
  children: [
    status,
    ui.text('The panel is on the HUD at the left. Change the language in the game: Settings, Language, On-screen.', { tone: 'dim' }),
    ui.button('Read the language', () => showLanguage('Read')),
    log,
  ],
});

await t.ready;
await showLanguage('Ready');
