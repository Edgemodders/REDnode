// The Editor request window (#44): a tool on the player's PC, such as EDGEhack in VS Code, sent a
// change through the editor channel (Try Live), and REDnode asks the player here first. The tool's
// call waits for the answer. The host opens this window while a request waits and closes it once
// answered; Allow and Deny last until the host restarts.

const $ = (id) => document.getElementById(id);
let request = null;
let busy = false;

function show(r) {
  request = r;
  $('error').hidden = true;
  if (!r) return;
  $('editor').textContent = r.editor;
  $('label').textContent = r.label ? `For: ${r.label}` : '';
  $('label').hidden = !r.label;
  setBusy(false);
}

function setBusy(on) {
  busy = on;
  $('allow').disabled = on;
  $('deny').disabled = on;
  $('left').innerHTML = on ? 'One moment…' : 'Press <kbd>F10</kbd> to use the mouse here.';
  if (request?.waiting && !on) $('left').append(` ${request.waiting} more waiting.`);
}

async function answer(allow) {
  if (!request || busy) return;
  setBusy(true);
  try {
    await window.rednode.editorask.answer(request.aid, allow);
  } catch (err) {
    setBusy(false);
    $('error').textContent = String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('error').hidden = false;
  }
}

$('allow').addEventListener('click', () => answer(true));
$('deny').addEventListener('click', () => answer(false));
window.rednode.editorask.pending().then(show, () => {});
window.rednode.on((m) => {
  if (m.event === 'editorask') show(m.request);
});
