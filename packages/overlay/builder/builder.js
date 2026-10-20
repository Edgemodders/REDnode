// Renders a window described by a Node mod (rednode's ui builder) with the UI
// kit, and sends the player's clicks and changes back to the mod.
//
// The spec is a tree of { id, type, props, children }. The host keeps the
// newest copy, so a reloaded page shows the current state.
'use strict';

const builder = window.rednode.builder;
const elements = new Map(); // node id -> { el, type }

function setText(el, props) {
  el.textContent = props.text ?? '';
  el.className = `${el.dataset.base}${props.tone && props.tone !== 'normal' ? ` tone-${props.tone}` : ''}`;
}

function attr(el, name, value) {
  if (value === undefined || value === null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

// Applies props to an element. Used for the first render and for updates.
function apply(type, el, props) {
  switch (type) {
    case 'text':
    case 'heading':
      setText(el, props);
      break;
    case 'button':
      if ('label' in props) el.textContent = props.label;
      if ('variant' in props) attr(el, 'variant', props.variant === 'primary' ? null : props.variant);
      if ('disabled' in props) attr(el, 'disabled', !!props.disabled);
      if ('sound' in props) attr(el, 'sound', props.sound);
      break;
    case 'toggle':
      if ('label' in props) attr(el, 'label', props.label);
      if ('checked' in props) el.checked = !!props.checked;
      if ('disabled' in props) attr(el, 'disabled', !!props.disabled);
      break;
    case 'slider':
      for (const k of ['label', 'min', 'max', 'step', 'unit']) if (k in props) attr(el, k, props[k]);
      if ('value' in props) attr(el, 'value', props.value);
      break;
    case 'input':
      for (const k of ['label', 'placeholder']) if (k in props) attr(el, k, props[k]);
      if ('value' in props) attr(el, 'value', props.value ?? '');
      break;
    case 'progress':
      for (const k of ['label', 'value', 'max']) if (k in props) attr(el, k, props[k]);
      break;
    case 'list':
      if ('keep' in props) el.dataset.keep = String(props.keep ?? 500);
      if ('follow' in props) el.dataset.follow = props.follow === false ? 'no' : 'yes';
      if ('height' in props) {
        el.style.height = props.height ? `${Number(props.height)}px` : '';
        el.classList.toggle('fill', !props.height);
        checkFill();
      }
      if ('lines' in props) {
        el.replaceChildren();
        addLines(el, props.lines ?? [], true);
      }
      if ('push' in props) addLines(el, props.push ?? [], false);
      break;
    default:
      break;
  }
}

// A list's new lines: added at the bottom, the oldest dropped past "keep". The list follows
// the newest line while the player is at the bottom; scrolled up, it stays put.
function addLines(el, lines, toEnd) {
  const atEnd = toEnd || el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'line';
    div.textContent = String(line);
    frag.append(div);
  }
  el.append(frag);
  const keep = Number(el.dataset.keep) || 500;
  while (el.childElementCount > keep) el.firstElementChild.remove();
  if (atEnd && el.dataset.follow !== 'no') el.scrollTop = el.scrollHeight;
}

// A list without a height fills the window: the window then takes the page's full height.
function checkFill() {
  document.body.classList.toggle('fill', !!document.querySelector('.list.fill'));
}

function send(node, type, value) {
  builder.send({ node, type, value });
}

function render(spec) {
  let el;
  switch (spec.type) {
    case 'text':
      el = document.createElement('div');
      el.dataset.base = 'text';
      break;
    case 'heading':
      el = document.createElement('h3');
      el.dataset.base = 'heading';
      break;
    case 'button':
      el = document.createElement('rn-button');
      el.addEventListener('click', () => send(spec.id, 'click'));
      break;
    case 'toggle':
      el = document.createElement('rn-toggle');
      el.addEventListener('change', (e) => send(spec.id, 'change', e.detail.checked));
      break;
    case 'slider':
      el = document.createElement('rn-slider');
      el.addEventListener('change', (e) => send(spec.id, 'change', e.detail.value));
      break;
    case 'input':
      el = document.createElement('rn-input');
      el.addEventListener('change', (e) => send(spec.id, 'change', e.detail.value));
      el.addEventListener('submit', (e) => send(spec.id, 'submit', e.detail.value));
      break;
    case 'progress':
      el = document.createElement('rn-progress');
      break;
    case 'list':
      el = document.createElement('div');
      el.className = 'list fill';
      break;
    case 'row':
    case 'column':
      el = document.createElement('div');
      el.className = spec.type;
      break;
    default:
      el = document.createElement('div');
      el.className = 'text tone-danger';
      el.textContent = `Unknown node type: ${spec.type}`;
      return el;
  }
  apply(spec.type, el, spec.type === 'list' ? { height: undefined, ...spec.props } : spec.props ?? {});
  elements.set(spec.id, { el, type: spec.type });
  for (const child of spec.children ?? []) el.append(render(child));
  return el;
}

function show(spec) {
  const win = document.getElementById('win');
  elements.clear();
  win.setAttribute('title', spec.props.title ?? '');
  attr(win, 'closable', spec.props.closable !== false);
  const content = document.createElement('div');
  content.className = 'content';
  for (const child of spec.children ?? []) content.append(render(child));
  win.replaceChildren(content);
  win.hidden = false;
  checkFill();
  for (const list of win.querySelectorAll('.list')) list.scrollTop = list.scrollHeight;
}

// The window's close button: the host closes the window and tells the mod.
document.getElementById('win').addEventListener('close', (e) => {
  e.preventDefault();
  send(null, 'close');
});

window.rednode.on((m) => {
  if (m.event !== 'builder') return;
  if (m.op === 'update') {
    const found = elements.get(m.node);
    if (found) apply(found.type, found.el, m.props ?? {});
  }
});

builder.spec().then(show);
