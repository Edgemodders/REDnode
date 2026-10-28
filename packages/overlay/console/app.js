// Console (O12): the window. The code runs in the Console's own Node mod (mod.mjs);
// this page sends each entry over the channel and shows what comes back.
// Built into the host, so it may use window.rednode.logs.copy and window.rednode.console.
'use strict';

const MAX = 600; // output entries kept in the page
const $ = (id) => document.getElementById(id);
const out = $('out');
const code = $('code');
const hints = $('hints');

let history = [];
let at = -1; // position in history while going through it, -1 for the draft
let draft = '';
let busy = false;
let completeId = 0;
let started = false; // the mod has answered once

const post = (data) => window.rednode.pkg.post(data);

// ---------- values ----------

const SHORT = 90;

// One line for a value: {x: 1, y: "a"} or Array(3) [1, 2, 3], cut at SHORT characters.
function preview(node, top = true) {
  if (!node.kids) return node.s;
  if (!top) return node.t === 'arr' ? node.s || `Array(${node.n})` : node.s ? `${node.s} {…}` : '{…}';
  const inner = node.kids.map((c) => (node.t === 'arr' && /^\d+$/.test(c.k) ? '' : `${c.k}: `) + preview(c.v, false));
  if (node.more) inner.push('…');
  let text = node.t === 'arr' ? `[${inner.join(', ')}]` : `{${inner.join(', ')}}`;
  if (text.length > SHORT) text = `${text.slice(0, SHORT - 2)}…${text.endsWith(']') ? ']' : '}'}`;
  return node.s ? `${node.s} ${text}` : text;
}

function valueEl(node) {
  if (!node.kids || !node.kids.length) {
    const span = document.createElement('span');
    span.className = node.t;
    span.textContent = node.kids ? preview(node) : node.s;
    return span;
  }
  const wrap = document.createElement('span');
  const head = document.createElement('span');
  head.className = 'fold';
  head.textContent = preview(node);
  let kids = null;
  head.addEventListener('click', () => {
    head.classList.toggle('open');
    if (kids) {
      kids.hidden = !kids.hidden;
      return;
    }
    kids = document.createElement('div');
    kids.className = 'kids';
    for (const c of node.kids) {
      const row = document.createElement('div');
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = `${c.k}: `;
      row.append(k, valueEl(c.v));
      kids.append(row);
    }
    if (node.more) {
      const row = document.createElement('div');
      row.className = 'k';
      row.textContent = `… ${node.more} more`;
      kids.append(row);
    }
    wrap.append(kids);
  });
  wrap.append(head);
  return wrap;
}

// ---------- entries ----------

function entryEl(e) {
  const div = document.createElement('div');
  div.className = `e ${e.kind}${e.level ? ` ${e.level}` : ''}`;
  if (e.kind === 'input') {
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `[${e.n}] `;
    const c = document.createElement('span');
    c.className = 'code';
    c.textContent = e.code;
    div.append(n, '› ', c);
  } else if (e.kind === 'result') {
    if (e.ms >= 50) div.append(ms(e.ms));
    if (e.named) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `$${e.n} = `;
      div.append(n);
    }
    div.append(valueEl(e.value));
  } else if (e.kind === 'log') {
    e.parts.forEach((p, i) => {
      if (i) div.append(' ');
      div.append(p.t === 'text' ? document.createTextNode(p.s) : valueEl(p));
    });
  } else {
    if (e.ms >= 50) div.append(ms(e.ms));
    div.append(e.text);
  }
  div.dataset.text = asText(e);
  return div;
}

function ms(n) {
  const span = document.createElement('span');
  span.className = 'ms';
  span.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`;
  return span;
}

function asText(e) {
  if (e.kind === 'input') return `[${e.n}] › ${e.code}`;
  if (e.kind === 'result') return `${e.named ? `$${e.n} = ` : ''}${preview(e.value)}`;
  if (e.kind === 'log') return e.parts.map((p) => (p.t === 'text' ? p.s : preview(p))).join(' ');
  return e.text;
}

const atBottom = () => out.scrollHeight - out.scrollTop - out.clientHeight < 24;

function add(entries) {
  const stick = atBottom();
  out.append(...entries.map(entryEl));
  while (out.childElementCount > MAX) out.firstElementChild.remove();
  if (stick || entries.some((e) => e.kind === 'input')) out.scrollTop = out.scrollHeight;
}

function setBusy(on) {
  busy = on;
  const status = $('status');
  status.textContent = on ? 'RUNNING' : 'READY';
  status.classList.toggle('busy', on);
}

// ---------- the input line ----------

function grow() {
  code.style.height = '18px';
  code.style.height = `${Math.min(code.scrollHeight, 108)}px`;
}

function run() {
  const text = code.value;
  if (!text.trim() || busy) return;
  post({ type: 'run', code: text });
  if (history[history.length - 1] !== text) history.push(text);
  at = -1;
  draft = '';
  code.value = '';
  hideHints();
  grow();
}

function recall(step) {
  if (!history.length) return false;
  if (at === -1) draft = code.value;
  const next = at === -1 ? (step < 0 ? history.length - 1 : -1) : at + step;
  if (next >= history.length) at = -1;
  else if (next < 0) at = at === -1 ? -1 : 0;
  else at = next;
  code.value = at === -1 ? draft : history[at];
  grow();
  const end = code.value.length;
  code.setSelectionRange(end, end);
  return true;
}

function hideHints() {
  hints.classList.remove('on');
  hints.replaceChildren();
}

function showHints(list) {
  hints.replaceChildren(
    ...list.slice(0, 120).map((x) => {
      const s = document.createElement('span');
      s.textContent = x;
      return s;
    }),
  );
  hints.classList.add('on');
}

// Tab: the evaluator's own completion for the text before the caret.
function complete() {
  const before = code.value.slice(0, code.selectionStart);
  post({ type: 'complete', id: ++completeId, line: before.split('\n').pop() });
}

function completed({ id, list, prefix }) {
  if (id !== completeId) return;
  if (!list.length) return hideHints();
  // The longest start every choice shares.
  let common = list[0];
  for (const x of list) while (!x.startsWith(common)) common = common.slice(0, -1);
  const add = common.slice(prefix.length);
  if (add) {
    const pos = code.selectionStart;
    code.setRangeText(add, pos, pos, 'end');
    grow();
  }
  if (list.length > 1) showHints(list);
  else hideHints();
}

code.addEventListener('input', () => {
  grow();
  if (hints.classList.contains('on')) hideHints();
});

code.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    run();
  } else if (ev.key === 'Tab') {
    ev.preventDefault();
    complete();
  } else if (ev.key === 'ArrowUp' && !code.value.slice(0, code.selectionStart).includes('\n')) {
    if (recall(-1)) ev.preventDefault();
  } else if (ev.key === 'ArrowDown' && !code.value.slice(code.selectionEnd).includes('\n') && at !== -1) {
    if (recall(1)) ev.preventDefault();
  } else if (ev.key === 'l' && ev.ctrlKey) {
    ev.preventDefault();
    post({ type: 'clear' });
  }
});

// A click in the output goes back to the input, unless it selected text or folded a value.
out.addEventListener('mouseup', (ev) => {
  if (!window.getSelection().toString() && !ev.target.closest('.fold')) code.focus();
});

$('clear').addEventListener('click', () => post({ type: 'clear' }));
$('stop').addEventListener('click', async () => {
  try {
    await window.rednode.console.stop();
  } catch (err) {
    add([{ kind: 'error', text: err.message }]);
  }
});
$('copy').addEventListener('click', () => {
  const text = [...out.children].map((d) => d.dataset.text).join('\n');
  window.rednode.logs.copy(text);
});

// ---------- the mod ----------

window.rednode.on((m) => {
  if (m.event !== 'channel' || !m.data) return;
  const d = m.data;
  if (d.type === 'ready') {
    // The mod started, or started again after Stop: the output here stays.
    if (started) add([{ kind: 'info', text: 'The Console started again: its variables are cleared.' }]);
    post({ type: 'hello' });
  } else if (d.type === 'state') {
    history = d.history ?? [];
    at = -1;
    setBusy(!!d.busy);
    // The first answer fills a page that just opened; later ones only bring the history.
    if (!started) {
      out.replaceChildren();
      add(d.entries ?? []);
    }
    started = true;
  } else if (d.type === 'entry') {
    if (started || d.entry.kind !== 'info') add([d.entry]);
  }
  else if (d.type === 'busy') setBusy(d.busy);
  else if (d.type === 'clear') out.replaceChildren();
  else if (d.type === 'complete') completed(d);
});

post({ type: 'hello' });
code.focus();
