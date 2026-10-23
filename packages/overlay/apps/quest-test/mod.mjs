// Quest test: a sample of quests, journal and game.player.teleport in the rednode package
// (Q-A, asked for by EDGEquest). Facts: Read lists the facts in the field, Watch hears each
// change as the game makes it, Set +1 raises the first one. Journal: Tracked fills in the
// tracked entry's path, Read entry shows its state. Here keeps V's position; Teleport goes
// back to it.

import { game, journal, quests, ui } from 'rednode';

let factText = 'rednode_test, sq030_dam_meetup_done';
let entryPath = '';
let spot = null;
let stopWatch = null;

const names = () =>
  factText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const status = ui.text('Load a save, then Read.', { tone: 'dim' });
const lines = ui.text('', { tone: 'normal' });
const log = ui.list({ height: 140 });

const say = (text, tone = 'dim') => status.set({ text, tone });
const fail = (what, err) => {
  say(`${what}: ${err.message}`, 'danger');
  console.log(`${what} failed: ${err.message}`);
};
const note = (line) => {
  log.push(`${new Date().toLocaleTimeString()}  ${line}`);
  console.log(line);
};

ui.window({
  title: 'Quest test',
  anchor: 'left',
  x: 40,
  y: 160,
  width: 480,
  height: 560,
  children: [
    ui.input({ placeholder: 'Fact names, comma separated', value: factText, onChange: (v) => (factText = v) }),
    ui.row(ui.button('Read', read), ui.button('Watch', watch, { variant: 'ghost' }), ui.button('Set +1', bump, { variant: 'ghost' })),
    ui.input({ placeholder: 'A journal path (an objective)', value: entryPath, onChange: (v) => (entryPath = v.trim()) }),
    ui.row(ui.button('Tracked', tracked, { variant: 'ghost' }), ui.button('Read entry', readEntry, { variant: 'ghost' })),
    ui.row(ui.button('Here', here, { variant: 'ghost' }), ui.button('Teleport', teleport, { variant: 'ghost' })),
    status,
    lines,
    log,
  ],
});

async function read() {
  try {
    const t0 = Date.now();
    const values = await quests.facts(names());
    lines.set({ text: Object.entries(values).map(([n, v]) => `${n}  ${v}`).join('\n') });
    say(`${names().length} facts in ${Date.now() - t0} ms`);
    console.log(`Read: ${JSON.stringify(values)}`);
  } catch (err) {
    fail('Read', err);
  }
}

async function watch() {
  try {
    if (stopWatch) await stopWatch();
    const watched = names();
    stopWatch = await quests.watch(watched, ({ name, value }) => note(`Watcher: ${name} = ${value}`));
    say(`Watching ${watched.join(', ')}`);
    console.log(`Watch: ${watched.join(', ')}`);
  } catch (err) {
    fail('Watch', err);
  }
}

async function bump() {
  const [name] = names();
  if (!name) return;
  try {
    const value = (await quests.fact(name)) + 1;
    await quests.setFact(name, value);
    say(`Set ${name} to ${value} (the watcher, if on, logs it on its own)`);
    console.log(`Set +1: ${name} to ${value}`);
  } catch (err) {
    fail('Set +1', err);
  }
}

async function tracked() {
  try {
    const t = await journal.tracked();
    if (!t) return say('Nothing tracked');
    entryPath = t.path;
    say(`Tracked: ${t.path}`);
    console.log(`Tracked: ${t.path} (hash ${t.hash})`);
    await readEntry();
  } catch (err) {
    fail('Tracked', err);
  }
}

async function readEntry() {
  if (!entryPath) return say('Type a path, or press Tracked');
  try {
    const e = await journal.entry(entryPath);
    const text = e ? `${e.path}\nstate  ${e.state}\ntracked  ${e.tracked}` : `Not in the journal: ${entryPath}`;
    lines.set({ text });
    console.log(`Read entry: ${JSON.stringify(e)}`);
  } catch (err) {
    fail('Read entry', err);
  }
}

async function here() {
  try {
    spot = await game.player.position();
    say(`Kept ${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}, ${spot.z.toFixed(1)}. Walk away, then Teleport.`);
    console.log(`Here: ${JSON.stringify(spot)}`);
  } catch (err) {
    fail('Here', err);
  }
}

async function teleport() {
  if (!spot) return say('Press Here first');
  try {
    await game.player.teleport(spot);
    note(`Teleported to ${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}, ${spot.z.toFixed(1)}`);
  } catch (err) {
    fail('Teleport', err);
  }
}

console.log('Quest test ready');
