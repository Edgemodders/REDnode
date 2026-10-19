// Hot swap test: #12's H1. archives.reload() copies an archive into the game's hot folder
// and has RED Hot Tools swap it in, then answers with what was swapped. Needs RED Hot Tools
// ("requires"), the "archives" permission and the player's OK in the launcher.

import { archives, kernel, ui } from 'rednode';

let file = '';

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const result = ui.text('Type the name of an archive in archive/pc/mod, or a full path, then Swap.', { tone: 'dim' });

ui.window({
  title: 'Hot swap test',
  anchor: 'left',
  x: 40,
  y: 120,
  width: 440,
  height: 300,
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
