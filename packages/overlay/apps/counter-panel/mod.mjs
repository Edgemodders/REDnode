// Counter panel: another package's service, called through the REDnode host.
// service.connect finds Counter service by its id; each of its exported functions is
// then a method here that returns a promise. Its "changed" events arrive with $on.

import { service, ui } from 'rednode';

const count = ui.text('-', { tone: 'accent' });
const status = ui.text('Connecting to Counter service...', { tone: 'dim' });
const log = ui.list({ keep: 100 });

function say(text, tone) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
  status.set({ text, tone: tone ?? 'dim' });
}

let counter = null;
let stopper = null; // the AbortController of a running Wait

// Runs a call and shows its answer or its error.
async function run(label, fn) {
  if (!counter) return say('Not connected yet: switch Counter service on', 'danger');
  const started = performance.now();
  try {
    const r = await fn();
    say(`${label}: ${JSON.stringify(r)} (${(performance.now() - started).toFixed(0)} ms)`);
    return r;
  } catch (err) {
    say(`${label} failed: ${err.message}`, 'danger');
  }
}

async function connect() {
  try {
    counter = await service.connect('counter-service');
    say(`Connected to ${counter.$info.name} ${counter.$info.version}: ${counter.$info.functions.join(', ')}`);
    counter.$on('changed', (e) => {
      count.set({ text: String(e.count) });
      log.push(`${new Date().toLocaleTimeString()}  event changed: ${e.count} (by ${e.by}, from ${e.from})`);
    });
    count.set({ text: String(await counter.get()) });
  } catch (err) {
    counter = null;
    say(`Could not connect: ${err.message}`, 'danger');
  }
}

ui.window({
  title: 'Counter panel',
  anchor: 'left',
  x: 40,
  y: 80,
  width: 460,
  height: 520,
  closable: true,
  children: [
    ui.row(ui.text('Count', { tone: 'dim' }), count),
    ui.row(
      ui.button('+1', () => run('add(1)', () => counter.add(1))),
      ui.button('+10', () => run('add(10)', () => counter.add(10)), { variant: 'ghost' }),
      ui.button('Reset', () => run('reset()', () => counter.reset()), { variant: 'ghost' }),
      ui.button('Read', () => run('get()', () => counter.get()), { variant: 'ghost' }),
    ),
    ui.heading('Edge cases'),
    ui.row(
      ui.button('Wait 3 s', () => run('wait(3000)', () => counter.wait(3000)), { variant: 'ghost' }),
      ui.button('Wait 40 s', () => run('wait(40000), default 30 s timeout', () => counter.wait(40000)), { variant: 'ghost' }),
      ui.button('Wait, then Stop', () => {
        stopper = new AbortController();
        run('wait(20000) with a signal', () => counter.$with({ signal: stopper.signal }).wait(20000));
      }, { variant: 'ghost' }),
      ui.button('Stop', () => stopper?.abort(), { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Fail', () => run('fail()', () => counter.fail()), { variant: 'ghost' }),
      ui.button('Unknown function', () => run('nothing()', () => counter.nothing()), { variant: 'ghost' }),
      ui.button('Reconnect', connect, { variant: 'ghost' }),
    ),
    status,
    log,
  ],
});

console.log('Counter panel ready');
connect();
