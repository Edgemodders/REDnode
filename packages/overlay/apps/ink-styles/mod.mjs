// Ink styles: the test of phase I2b (docs/ink.md). Puts a gallery of the ink API's layout and
// look words on the HUD, drawn by the game: every text style, every tone, the plain and the
// game look, a column's align, a row's grow, gap and pad, and icons from TweakDB. The window's
// buttons change them while they show, to see that each change reaches the game.

import { ink, ui } from 'rednode';

const STYLES = ['title', 'subtitle', 'heading', 'body', 'label', 'value', 'small', 'fluff'];
const TONES = ['normal', 'accent', 'highlight', 'success', 'warning', 'danger', 'dim', 'white'];
const ALIGNS = ['left', 'center', 'right'];
const ICONS = [
  'UIIcon.AssaultRiflesPerkWeaponGroup',
  'UIIcon.Assault_Area_01_Perk_1',
  'UIIcon.Ability.CanUseFragGrenades',
  'UIIcon.Ability.HasICELevelBooster',
];

let mount = null;
let toneAt = 0;
let alignAt = 0;
let gapAt = 0;
let iconText = ICONS[0];

const log = ui.list({ keep: 200 });
function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

// The nodes the buttons change.
let sample;
let aligned;
let spaced;
let picked;

function gallery() {
  sample = ink.text('This line changes tone', { style: 'body', tone: TONES[0] });
  aligned = ink.column(
    { width: 700, height: 130, align: ALIGNS[0], gap: 4 },
    ink.text('Aligned', { style: 'label' }),
    ink.text('in a column', { style: 'small' }),
    ink.text('700 wide', { style: 'small', tone: 'dim' }),
  );
  spaced = ink.row(
    { gap: 4, pad: 8 },
    ink.rect({ width: 40, height: 20, tone: 'accent' }),
    ink.rect({ width: 40, height: 20, tone: 'normal' }),
    ink.rect({ width: 40, height: 20, tone: 'highlight' }),
  );
  picked = ink.image({ icon: iconText, width: 64, height: 64, tone: 'white' });

  return ink.column(
    { gap: 10 },
    ink.text('Ink styles', { style: 'title' }),
    ...STYLES.map((style) => ink.text(`${style}: Night City, 2077`, { style })),
    ink.row({ gap: 18 }, ...TONES.map((tone) => ink.text(tone, { style: 'label', tone }))),
    ink.row(
      { gap: 24 },
      ink.text('plain look', { size: 38 }),
      ink.text('game look', { size: 38, look: 'game' }),
      ink.text('a game color', { size: 38, color: 'MainColors.Yellow' }),
      ink.text('#ff00ff', { size: 38, color: '#ff00ff' }),
    ),
    sample,
    aligned,
    ink.row(
      { width: 700, height: 24, gap: 8, align: 'fill' },
      ink.rect({ grow: 1, tone: 'accent' }),
      ink.rect({ grow: 2, tone: 'normal' }),
      ink.rect({ width: 100, height: 24, tone: 'highlight' }),
    ),
    spaced,
    ink.row(
      { gap: 16, align: 'center' },
      ...ICONS.map((icon) => ink.image({ icon, width: 64, height: 64, tone: 'white' })),
      picked,
    ),
  );
}

function step(label, fn) {
  try {
    if (!mount && label !== 'Show') return say(`${label}: press Show first`);
    say(`${label}: ${fn() ?? 'done'}`);
  } catch (err) {
    say(`${label} failed: ${err.message}`);
  }
}

ui.window({
  title: 'Ink styles',
  anchor: 'right',
  x: -40,
  y: 0,
  width: 520,
  height: 640,
  closable: true,
  children: [
    ui.text('Shows a gallery on the HUD at the left. Close the overlay (F10) to see it.', { tone: 'dim' }),
    ui.row(
      ui.button('Show', () =>
        step('Show', () => {
          mount?.unmount();
          mount = ink.mount('hud', { anchor: 'left', x: 80, y: 0 }, gallery());
          return 'the gallery is on the HUD';
        }),
      ),
      ui.button('Remove', () =>
        step('Remove', () => {
          mount.unmount();
          mount = null;
          return 'removed';
        }),
        { variant: 'ghost' },
      ),
    ),
    ui.row(
      ui.button('Next tone', () =>
        step('Next tone', () => {
          toneAt = (toneAt + 1) % TONES.length;
          sample.set({ tone: TONES[toneAt], color: undefined });
          return `the line is ${TONES[toneAt]}`;
        }),
      ),
      ui.button('White over tone', () =>
        step('White over tone', () => {
          sample.set({ color: '#ffffff' });
          return 'the line is plain white (its tone untied)';
        }),
        { variant: 'ghost' },
      ),
    ),
    ui.row(
      ui.button('Next align', () =>
        step('Next align', () => {
          alignAt = (alignAt + 1) % ALIGNS.length;
          aligned.set({ align: ALIGNS[alignAt] });
          return `the column's lines are ${ALIGNS[alignAt]}`;
        }),
      ),
      ui.button('Next gap', () =>
        step('Next gap', () => {
          gapAt = (gapAt + 1) % 3;
          spaced.set({ gap: [4, 24, 60][gapAt], pad: [8, 24, 0][gapAt] });
          return `the three small boxes are ${[4, 24, 60][gapAt]} apart, padded ${[8, 24, 0][gapAt]}`;
        }),
        { variant: 'ghost' },
      ),
    ),
    ui.input({
      value: iconText,
      placeholder: 'A UIIcon record, such as UIIcon.Assault_Area_01_Perk_1',
      onChange: (v) => (iconText = v.trim()),
      onSubmit: (v) => (iconText = v.trim()),
    }),
    ui.button('Show this icon', () =>
      step('Show this icon', () => {
        picked.set({ icon: iconText });
        return `the last icon is ${iconText}`;
      }),
    ),
    log,
  ],
});

say('Ink styles ready');
