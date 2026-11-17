// The Key binding window: the player picks a key for an app (its title bar's Key binding, or
// the Mod Manager). The host hears the keys pressed here itself, by their Windows codes, checks
// each against the game's own bindings and REDnode's keys, and sends what it would be. Save keeps
// it; Esc or Cancel leaves the key as it was.

const $ = (id) => document.getElementById(id);
let ask = null;

function show(a) {
  ask = a;
  if (!a) return;
  $('app').textContent = a.name;
  $('current').textContent = a.current ? `Now: ${a.current}` : 'No key yet';
  $('clear').hidden = !a.current;
  const key = $('key');
  const c = a.candidate;
  key.classList.toggle('wait', !c && !a.holding);
  key.classList.toggle('bad', !!c && !c.ok);
  key.textContent = a.holding ?? c?.name ?? 'Press a key…';
  $('problem').textContent = c?.problem ?? '';
  $('problem').hidden = !c?.problem;
  $('notes').textContent = (c?.ok && c.notes?.join('. ')) || '';
  $('notes').hidden = !(c?.ok && c.notes?.length);
  $('save').disabled = !c?.ok;
}

function fail(err) {
  $('problem').textContent = String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  $('problem').hidden = false;
}

$('save').addEventListener('click', () => window.rednode.keybind.save().catch(fail));
$('clear').addEventListener('click', () => window.rednode.keybind.clear().catch(fail));
$('cancel').addEventListener('click', () => window.rednode.keybind.cancel().catch(fail));
document.querySelector('rn-window').addEventListener('close', (e) => {
  e.preventDefault();
  window.rednode.keybind.cancel().catch(fail);
});
// Esc comes here as a key and cancels, instead of leaving the cursor mode.
navigator.keyboard?.lock?.(['Escape']).catch(() => {});
window.rednode.keybind.state().then(show, () => {});
window.rednode.on((m) => {
  if (m.event === 'keybind') show(m.ask);
});
