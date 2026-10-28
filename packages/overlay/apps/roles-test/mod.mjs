// Roles test: the parts of REDnode 0.44.0 that EDGEwave's voice package uses (#20).
//
// 1. use("counter") finds the package that provides the "counter" role (Counter service
//    says "provides": ["counter"]), rather than a package by its id. With two providers,
//    the player picks one in the Mod Manager's Provides section.
// 2. audio.play takes a full path in pkg.dataDir, for sounds a package makes while it
//    runs: this writes a tone as a WAV file there, plays it, then writes the same file
//    again at another pitch and plays the new one.
// 3. ui.input({ password: true }) hides what is typed.

import { audio, pkg, ui, use } from 'rednode';

const status = ui.text('Ready', { tone: 'dim' });
const log = ui.list({ keep: 100, height: 200 });

function say(text, tone) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
  status.set({ text, tone: tone ?? 'dim' });
}

async function run(label, fn) {
  try {
    const r = await fn();
    if (r !== undefined) say(`${label}: ${r}`);
  } catch (err) {
    say(`${label} failed: ${err.message}`, 'danger');
  }
}

// ---------- 1. a role ----------

let counter = null;
async function useCounter() {
  counter = await use('counter');
  counter.$on('changed', (e) => say(`event changed from ${counter.$info.name}: ${e.count}`));
  return `${counter.$info.name} (${counter.$info.id} ${counter.$info.version}) answers "${counter.$info.role}"`;
}

// ---------- 2. a sound made at run time ----------

// A one-second sine tone as 16-bit mono PCM in a WAV file.
function toneWav(hz, seconds = 1, rate = 44100) {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 2000, (n - i) / 2000); // no click at either end
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.4 * fade * 32767), 44 + i * 2);
  }
  return b;
}

// node:fs is loaded when first needed, so the docs preview (no file access) still runs.
async function playTone(hz) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const toneFile = path.join(pkg.dataDir, 'tone.wav');
  fs.writeFileSync(toneFile, toneWav(hz));
  const sound = await audio.play(toneFile);
  const { why } = await sound.ended;
  return `${hz} Hz from ${toneFile}, ${why}`;
}

// ---------- the window ----------

ui.window({
  title: 'Roles test',
  anchor: 'right',
  x: 40,
  y: 80,
  width: 480,
  height: 600,
  closable: true,
  children: [
    ui.heading('1. Role'),
    ui.row(
      ui.button('use("counter")', () => run('use', useCounter)),
      ui.button('add(1)', () => run('add(1)', () => (counter ? counter.add(1) : Promise.reject(new Error('Press use("counter") first')))), { variant: 'ghost' }),
      ui.button('use("nobody")', () => run('use("nobody")', () => use('nobody')), { variant: 'ghost' }),
    ),
    ui.heading('2. Sound from the data folder'),
    ui.row(
      ui.button('Write and play 440 Hz', () => run('tone', () => playTone(440))),
      ui.button('Write again, 880 Hz', () => run('tone', () => playTone(880)), { variant: 'ghost' }),
    ),
    ui.heading('3. Password field'),
    ui.input({
      label: 'A key (Enter to check)',
      placeholder: 'type anything',
      password: true,
      onSubmit: (v) => say(`Got ${v.length} characters; the field showed dots`),
    }),
    status,
    log,
  ],
});

say(`Ready. Data folder: ${pkg.dataDir}`);
