// Keys test: REDnode 0.48.0's shared keys for packages (#23, K3), with a made-up service,
// "rednode-test", so the player's real keys are never touched.
//
// 1. secrets.shared reads a shared key: null until the player allows this package
//    ("keys:rednode-test" in the manifest) or while no key is set.
// 2. secrets.askShared asks the player in REDnode's own Key request window: allow, and paste
//    a key when none is saved. The answer is the key, or null.
// 3. The offer: a key this package kept in its own secrets moves to the shared store, as
//    REDagent's and EDGEwave Voice's do.
// 4. A key the manifest does not list is refused.
// Only a key's last 4 characters are ever shown or logged.

import { secrets, ui } from 'rednode';

const SERVICE = 'rednode-test';
const OWN = 'old-test-key';
const status = ui.text('Ready', { tone: 'dim' });
const log = ui.list({ keep: 100, height: 220 });

function say(text, tone) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
  status.set({ text, tone: tone ?? 'dim' });
}

const shown = (key) => (key ? `a key ending in ${key.slice(-4)}` : 'null');

async function run(label, fn) {
  try {
    say(`${label}: ${await fn()}`);
  } catch (err) {
    say(`${label} failed: ${err.message}`, 'danger');
  }
}

ui.window({
  title: 'Keys test',
  anchor: 'right',
  x: 40,
  y: 80,
  width: 500,
  height: 560,
  closable: true,
  children: [
    ui.heading('1. Read'),
    ui.row(ui.button('secrets.shared', () => run('shared', async () => shown(await secrets.shared(SERVICE))))),
    ui.heading('2. Ask'),
    ui.row(
      ui.button('secrets.askShared', () => run('askShared', async () => shown(await secrets.askShared(SERVICE, { reason: 'For the Keys test' })))),
    ),
    ui.heading('3. Offer its own key'),
    ui.row(
      ui.button('Keep an own key', () => run('own key', async () => (await secrets.set(OWN, 'rnt-own-key-7k3q'), 'kept one ending in 7k3q'))),
      ui.button('Ask, offering it', async () => {
        await run('askShared with offer', async () => {
          const mine = await secrets.get(OWN);
          const key = await secrets.askShared(SERVICE, { reason: 'Move the Keys test key', offer: mine ?? undefined });
          if (key && mine) await secrets.delete(OWN);
          return `${shown(key)}${key && mine ? '; own copy deleted' : ''}`;
        });
      }, { variant: 'ghost' }),
    ),
    ui.heading('4. Not listed'),
    ui.row(ui.button('secrets.shared("openai")', () => run('shared("openai")', async () => shown(await secrets.shared('openai'))), { variant: 'ghost' })),
    status,
    log,
  ],
});

say('Ready. Uses the made-up service "rednode-test"; remove it in Keys after the test.');
