// The Key request window (#23, K3): a package asked for one of the player's shared keys with
// secrets.askShared, and REDnode asks the player here. Allow grants the package its keys:<service>
// permission, saving a pasted key, or the key the package offers to move, to the shared store
// first. The host opens this window while a request waits and closes it once answered.
// A typed key goes to the host and is cleared from the page.

const $ = (id) => document.getElementById(id);
let request = null;
let busy = false;

function error(text) {
  $('error').textContent = text ?? '';
  $('error').hidden = !text;
}

function last4(text) {
  const span = document.createElement('span');
  span.className = 'last4';
  span.textContent = `•••• ${text}`;
  return span;
}

function show(r) {
  request = r;
  error(null);
  if (!r) return;
  $('pkg').textContent = r.package;
  $('svc').textContent = r.serviceName;
  $('reason').textContent = r.reason ? `“${r.reason}”` : '';
  $('reason').hidden = !r.reason;
  const what = $('what');
  what.replaceChildren();
  if (r.offer && r.needsKey) {
    what.append(`${r.package} kept its own ${r.serviceName} key (`, last4(r.offer.last4), '). Allow moves it to the shared store, so every EDGE tool on this PC uses it. Or paste another key below.');
  } else if (r.needsKey) {
    what.append(`No ${r.serviceName} key is saved yet. Paste yours: it is kept encrypted for your Windows user and shared with every EDGE tool on this PC.`);
  } else {
    what.append(`It will use your saved ${r.serviceName} key (`, last4(r.saved ?? '????'), '), the one every EDGE tool on this PC shares.');
  }
  if (!r.granted) what.append(' Calls with it may cost you.');
  $('key').hidden = !r.needsKey;
  $('key').value = '';
  if (r.prefix) $('key').setAttribute('title', `${r.serviceName} keys start with ${r.prefix}`);
  else $('key').removeAttribute('title');
  $('allow').textContent = r.offer && r.needsKey ? 'Move and allow' : 'Allow';
  setBusy(false);
}

function setBusy(on, text) {
  busy = on;
  $('allow').disabled = on;
  $('deny').disabled = on;
  $('left').textContent = on ? text : '';
  if (!on) $('left').innerHTML = 'Press <kbd>F10</kbd> to use the mouse here.';
  if (request?.waiting && !on) $('left').append(` ${request.waiting} more waiting.`);
}

async function answer(allow) {
  if (!request || busy) return;
  const typed = String($('key').value ?? '').trim();
  $('key').value = '';
  const how = allow && request.offer && request.needsKey && !typed ? 'offer' : 'typed';
  if (allow && request.needsKey && how === 'typed' && !typed) return error(`Paste your ${request.serviceName} key first`);
  setBusy(true, allow && (typed || how === 'offer') ? 'Encrypting the key…' : 'One moment…');
  try {
    await window.rednode.keyask.answer(request.aid, allow, how, typed);
  } catch (err) {
    setBusy(false);
    error(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

$('allow').addEventListener('click', () => answer(true));
$('deny').addEventListener('click', () => answer(false));
$('key').addEventListener('submit', () => answer(true));
window.rednode.keyask.pending().then(show, () => {});
window.rednode.on((m) => {
  if (m.event === 'keyask') show(m.request);
});
