// The Welcome window: shown once, at the first start (the host opens it until it is
// closed once; settings.welcomed). It follows the overlay's mode, so the player sees
// F10 work: "Showing" lights up first, and "Got it" asks for F10 until the mouse works.

const $ = (id) => document.getElementById(id);
const NOW = {
  passive: 'Press F10 to use the mouse here.',
  interactive: 'The mouse works here now. Click Got it.',
  hidden: 'REDnode is hidden. Press F10 to show it.',
};

function showMode(mode) {
  for (const m of ['passive', 'interactive', 'hidden']) $(`k-${m}`).classList.toggle('now', m === mode);
  $('now').textContent = NOW[mode] ?? NOW.passive;
}

$('ok').addEventListener('click', () => window.rednode.close());
window.rednode.state().then((s) => showMode(s.mode), () => showMode('passive'));
window.rednode.on((m) => {
  if (m.event === 'state' && m.state?.overlay) showMode(m.state.overlay);
});
