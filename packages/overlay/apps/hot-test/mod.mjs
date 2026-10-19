// Hot swap test: #12's H1. archives.reload() copies an archive into the game's hot folder
// and has RED Hot Tools swap it in, then answers with what was swapped. Needs RED Hot Tools
// ("requires"), the "archives" permission and the player's OK in the launcher.
// Sound state (H1c-1): archives.soundState() reads the game's sound pak index and open
// paks, and where the index puts the sound ids typed in; the summary goes to the Mod log.

import { archives, kernel, ui } from 'rednode';

let file = '';
let ids = '';

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const result = ui.text('Type the name of an archive in archive/pc/mod, or a full path, then Swap.', { tone: 'dim' });
const sound = ui.text("Sound state: the game's sound pak index and open paks.", { tone: 'dim' });

ui.window({
  title: 'Hot swap test',
  anchor: 'left',
  x: 40,
  y: 120,
  width: 440,
  height: 440,
  children: [
    requires,
    ui.input({
      placeholder: 'MyMod.archive, or C:\\...\\MyMod.archive (Enter)',
      onChange: (v) => (file = v),
      onSubmit: (v) => {
        file = v;
        swap();
      },
    }),
    ui.button('Swap', swap),
    result,
    ui.input({
      placeholder: 'Sound ids to look up (optional), like 123456789 987654321',
      onChange: (v) => (ids = v),
      onSubmit: (v) => {
        ids = v;
        soundState();
      },
    }),
    ui.button('Sound state', soundState),
    sound,
  ],
});

const checked = await kernel.requirements();
requires.set({
  text: checked.map((r) => `${r.ok ? 'OK' : 'MISSING'}  ${r.name} ${r.wants}  ${r.found ?? r.note}`).join('\n'),
  tone: checked.every((r) => r.ok) ? 'normal' : 'danger',
});

async function swap() {
  const name = file.trim();
  if (!name) return;
  result.set({ text: `Swapping ${name}...`, tone: 'dim' });
  try {
    const r = await archives.reload([name]);
    const lines = [`${r.reloaded.length} swapped in ${r.ms} ms`, ...r.failed.map((f) => `Failed: ${f.file}: ${f.why}`)];
    result.set({ text: lines.join('\n'), tone: r.failed.length ? 'danger' : 'normal' });
    console.log(`Swap of ${name}: ${lines.join('; ')}`);
  } catch (err) {
    result.set({ text: err.message, tone: 'danger' });
    console.log(`Swap of ${name} refused: ${err.message}`);
  }
}

async function soundState() {
  const list = ids.split(/[\s,]+/).filter(Boolean).map(Number);
  if (list.some((n) => !Number.isInteger(n) || n < 0)) {
    sound.set({ text: 'Sound ids are whole numbers, separated by spaces', tone: 'danger' });
    return;
  }
  try {
    const s = await archives.soundState(list);
    sound.set({ text: s.summary, tone: 'normal' });
    console.log(`Sound state: ${s.summary}`);
  } catch (err) {
    sound.set({ text: err.message, tone: 'danger' });
    console.log(`Sound state failed: ${err.message}`);
  }
}
