// The Connect window (#19): an MCP client signing in through OAuth waits here for the
// player. It shows the client's name and the code its browser page shows; Allow lets it in.
// The host opens this window while a request waits and closes it once answered or lapsed.

const $ = (id) => document.getElementById(id);
let expires = 0;

function show(request) {
  if (!request) return;
  $('client').textContent = request.client;
  $('code').textContent = request.code;
  expires = request.expires;
}

function tick() {
  if (!expires) return;
  const s = Math.max(0, Math.round((expires - Date.now()) / 1000));
  $('left').textContent = s ? `Press F10 to use the mouse here. ${s} s left.` : 'This request lapsed.';
}

async function answer(allow) {
  $('allow').disabled = true;
  $('deny').disabled = true;
  await window.rednode.connect.answer(allow).catch(() => false);
}

$('allow').addEventListener('click', () => answer(true));
$('deny').addEventListener('click', () => answer(false));
window.rednode.connect.pending().then(show, () => {});
window.rednode.on((m) => {
  if (m.event === 'connect') show(m.request);
});
setInterval(tick, 1000);
tick();
