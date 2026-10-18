// The docs' example pages (docs/examples, made by tools/examples/build.mjs): tabs,
// copy buttons, the live preview's size, its Mod log and the simulated game's buttons,
// and the filter on the index page.
'use strict';

(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  let fit = () => {}; // set by the preview below

  // ---------- tabs ----------
  const tabs = $$('.ex-tabs [role="tab"]');
  function select(tab, focus) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    if (focus) tab.focus();
    history.replaceState(null, '', tab.dataset.tab === 'preview' ? location.pathname : `#${tab.dataset.tab}`);
    fit();
  }
  for (const t of tabs) {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length], true);
    });
  }
  const fromHash = tabs.find((t) => `#${t.dataset.tab}` === location.hash);
  if (fromHash) select(fromHash);

  // ---------- copy ----------
  for (const b of $$('.ex-copy')) {
    b.addEventListener('click', async () => {
      const text = b.closest('.ex-file').querySelector('code').textContent;
      const label = b.querySelector('span');
      try {
        await navigator.clipboard.writeText(text);
        label.textContent = 'Copied';
        b.classList.add('done');
      } catch {
        label.textContent = 'Press Ctrl+C';
        const range = document.createRange();
        range.selectNodeContents(b.closest('.ex-file').querySelector('code'));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
      setTimeout(() => {
        label.textContent = 'Copy';
        b.classList.remove('done');
      }, 1600);
    });
  }

  // ---------- the preview ----------
  const frame = $('.ex-frame');
  if (frame) {
    const stage = $('.ex-stage');
    const screen = $('.ex-screen');
    const log = $('[data-log]');
    const status = $('[data-status]');
    let size = { width: +frame.dataset.width, height: +frame.dataset.height };

    // Shown at its real size, shrunk only when wider than the page.
    fit = () => {
      if (!screen || screen.offsetParent === null) return;
      const room = screen.clientWidth - 48;
      const scale = Math.min(1, room / size.width);
      frame.width = size.width;
      frame.height = size.height;
      frame.style.transform = scale < 1 ? `scale(${scale})` : '';
      stage.style.width = `${Math.ceil(size.width * scale)}px`;
      stage.style.height = `${Math.ceil(size.height * scale)}px`;
    };
    window.addEventListener('resize', fit);
    fit();

    const send = (m) => frame.contentWindow?.postMessage({ rednodeExample: true, ...m }, '*');
    for (const b of $$('[data-control]')) b.addEventListener('click', () => send({ t: 'control', action: b.dataset.control }));
    $('[data-reload]')?.addEventListener('click', () => frame.contentWindow.location.reload());
    $('[data-clear]')?.addEventListener('click', () => log.replaceChildren());

    const time = () => new Date().toTimeString().slice(0, 8);
    function line(level, source, text) {
      const li = document.createElement('li');
      li.className = `lv-${level} src-${source}`;
      li.innerHTML = `<span class="t"></span><span class="s"></span><span class="m"></span>`;
      li.children[0].textContent = time();
      li.children[1].textContent = source === 'mod' || source === 'page' ? 'mod' : source;
      li.children[2].textContent = text;
      log.append(li);
      while (log.children.length > 300) log.firstElementChild.remove();
      log.scrollTop = log.scrollHeight;
    }

    const STATUS = {
      starting: 'Starting',
      running: 'Running',
      restarting: 'Crashed, restarting',
      'not-responding': 'Not responding',
      crashed: 'Crashed',
      stopped: 'Stopped',
    };
    window.addEventListener('message', (e) => {
      if (e.source !== frame.contentWindow) return;
      const m = e.data;
      if (!m?.rednodeExample) return;
      if (m.t === 'log') line(m.level, m.source, m.text);
      else if (m.t === 'status' && status) {
        status.textContent = STATUS[m.status] ?? m.status;
        status.dataset.state = m.status;
      } else if (m.t === 'size' && frame.dataset.kind === 'mod') {
        size = { width: Math.max(240, m.width), height: Math.max(80, m.height) };
        fit();
      } else if (m.t === 'sim') {
        for (const b of $$('[data-state]')) b.setAttribute('aria-pressed', String(!!m.state[b.dataset.state]));
        const o = $('[data-overlay]');
        if (o) o.textContent = { passive: 'Showing', interactive: 'Using', hidden: 'Hidden' }[m.state.overlay] ?? m.state.overlay;
      } else if (m.t === 'closed') {
        line('info', 'host', 'The app closed its window. Press Reload to open it again.');
        frame.style.visibility = 'hidden';
      }
    });
    frame.addEventListener('load', () => (frame.style.visibility = ''));
  }

  // ---------- the index's filter ----------
  const filter = $('[data-filter]');
  if (filter) {
    let kind = '';
    const apply = () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      for (const c of $$('.ex-card')) {
        const ok = (!kind || c.dataset.kind === kind) && (!q || c.dataset.search.includes(q));
        c.hidden = !ok;
        if (ok) shown += 1;
      }
      for (const g of $$('.ex-group')) g.hidden = !$$('.ex-card', g).some((c) => !c.hidden);
      $('[data-none]').hidden = shown > 0;
    };
    filter.addEventListener('input', apply);
    for (const b of $$('[data-kind-filter]')) {
      b.addEventListener('click', () => {
        kind = b.dataset.kindFilter;
        for (const x of $$('[data-kind-filter]')) x.setAttribute('aria-pressed', String(x === b));
        apply();
      });
    }
  }
})();
