/* Blockbild-Editor – Menüs, Dialoge und Autovervollständigung */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { h, placePopup } = BBE.dom;
  const { icon, kindIcon } = BBE.icons;

  // ---------------------------------------------------------------- Menüs

  let openMenu = null;

  function closeMenu() {
    if (openMenu) {
      const m = openMenu;
      openMenu = null;
      // sanft ausblenden
      m.el.classList.add('out');
      setTimeout(() => m.el.remove(), 130);
      document.removeEventListener('pointerdown', m.outside, true);
      document.removeEventListener('keydown', m.keys, true);
      window.removeEventListener('blur', closeMenu);
      if (m.returnFocus && m.returnFocus.isConnected) m.returnFocus.focus({ preventScroll: true });
    }
  }

  /**
   * items: { label, icon, kind, cat, key, action, disabled, danger } | '-' | { title }
   * anchor: Element oder {x, y}
   */
  function menu(items, anchor, opts = {}) {
    closeMenu();
    const el = h('div.menu' + (opts.grid ? '.grid' : ''), { role: 'menu' });
    const buttons = [];
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { el.appendChild(h('div.m-sep')); continue; }
      if (it.title) { el.appendChild(h('div.m-title', null, it.title)); continue; }
      const b = h('button.mi' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', disabled: !!it.disabled });
      if (it.kind) b.appendChild(h('span.pal-ic', { class: 'cat-' + it.cat }, kindIcon(it.kind)));
      else if (it.icon) b.appendChild(icon(it.icon));
      b.appendChild(h('span', null, it.label));
      if (it.key) b.appendChild(h('span.mi-key', null, it.key));
      b.addEventListener('click', () => { closeMenu(); it.action && it.action(); });
      el.appendChild(b);
      buttons.push(b);
    }
    document.body.appendChild(el);
    placePopup(el, anchor);
    const m = {
      el,
      returnFocus: anchor instanceof Element ? anchor : document.activeElement,
      outside: (e) => { if (!el.contains(e.target)) closeMenu(); },
      keys: (e) => {
        const enabled = buttons.filter((b) => !b.disabled);
        const i = enabled.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (enabled[i + 1] || enabled[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (enabled[i - 1] || enabled[enabled.length - 1]).focus(); }
        else if (e.key === 'Tab') { closeMenu(); }
      }
    };
    openMenu = m;
    setTimeout(() => {
      document.addEventListener('pointerdown', m.outside, true);
      document.addEventListener('keydown', m.keys, true);
      window.addEventListener('blur', closeMenu);
    }, 0);
    const first = buttons.find((b) => !b.disabled);
    if (first && opts.focus !== false) first.focus({ preventScroll: true });
    return closeMenu;
  }

  // ---------------------------------------------------------------- Dialoge

  /**
   * dialog({ title, body, actions: [{label, value, primary, danger}], wide, t })
   * -> Promise mit value der gewählten Aktion (null = Abbruch/Schließen)
   */
  function dialog(opts) {
    return new Promise((resolve) => {
      const t = opts.t || ((k) => k);
      const dlg = h('dialog.dlg' + (opts.wide ? '.wide' : ''), { 'aria-label': opts.title });
      const close = h('button.x-btn', { type: 'button', 'aria-label': t('dlg.close'), title: t('dlg.close') }, icon('x'));
      const body = h('div.dlg-body');
      if (typeof opts.body === 'string') body.appendChild(h('p', null, opts.body));
      else if (Array.isArray(opts.body)) opts.body.forEach((b) => body.appendChild(typeof b === 'string' ? h('p', null, b) : b));
      else if (opts.body) body.appendChild(opts.body);
      const inner = h('div.dlg-inner', null, h('div.dlg-head', null, h('h2', null, opts.title), close), body);
      let finished = false;
      // Schließt sofort (ohne auf das asynchrone close-Ereignis zu warten)
      const finish = (value) => {
        if (finished) return;
        finished = true;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const done = () => { if (dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } } dlg.remove(); };
        if (reduce || document.hidden) done();
        else { dlg.classList.add('out'); setTimeout(done, 140); }
        if (opts.onClose) opts.onClose(value);
        resolve(value);
      };
      if (opts.actions && opts.actions.length) {
        const foot = h('div.dlg-foot');
        for (const a of opts.actions) {
          const b = h('button.btn', { type: 'button', class: a.primary ? 'primary' : a.danger ? 'danger-fill' : '' }, a.label);
          b.addEventListener('click', () => finish(a.value));
          foot.appendChild(b);
        }
        inner.appendChild(foot);
      }
      dlg.appendChild(inner);
      close.addEventListener('click', () => finish(null));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      dlg.addEventListener('close', () => finish(null));
      dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      if (opts.onOpen) opts.onOpen(dlg, finish);
      const primary = dlg.querySelector('.dlg-foot .btn.primary');
      if (primary && !opts.noAutofocus) primary.focus();
    });
  }

  // ---------------------------------------------------------------- Autovervollständigung

  /**
   * Bietet Variablennamen an. getItems(input) -> [{ label, type }]
   * Für Ausdrücke wird nur das Wort am Cursor ersetzt.
   */
  function attachAutocomplete(root, getItems) {
    let pop = null;
    let state = null;

    const wordAt = (inp) => {
      const pos = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
      const before = inp.value.slice(0, pos);
      const m = /[\p{L}_][\p{L}\p{N}_]*$/u.exec(before);
      if (inp.dataset.ac === 'var' || inp.dataset.ac === 'name') return { start: 0, end: inp.value.length, word: inp.value.trim() };
      if (!m) return { start: pos, end: pos, word: '' };
      // nicht innerhalb von Texten vorschlagen
      const quotes = (before.slice(0, m.index).match(/"/g) || []).length;
      if (quotes % 2 === 1) return null;
      return { start: m.index, end: pos, word: m[0] };
    };

    function close() {
      if (pop) { pop.remove(); pop = null; }
      state = null;
    }

    function open(inp, force) {
      const ac = inp.dataset.ac;
      if (!ac || ac === 'name') { close(); return; }
      const w = wordAt(inp);
      if (!w) { close(); return; }
      if (!force && !w.word) { close(); return; }
      let items = getItems(inp).filter((it) => it.label.toLowerCase().startsWith(w.word.toLowerCase()) && it.label !== w.word);
      if (!items.length) { close(); return; }
      items = items.slice(0, 12);
      if (!pop) {
        pop = h('div.ac-pop', { role: 'listbox' });
        document.body.appendChild(pop);
      }
      pop.textContent = '';
      items.forEach((it, i) => {
        const row = h('div.ac-item' + (i === 0 ? '.on' : ''), { role: 'option' }, h('span', null, it.label), h('span.ac-type', null, it.type || ''));
        row.addEventListener('pointerdown', (e) => { e.preventDefault(); accept(inp, it); });
        pop.appendChild(row);
      });
      state = { inp, items, index: 0, w };
      placePopup(pop, inp);
    }

    function accept(inp, it) {
      const w = state ? state.w : wordAt(inp);
      if (!w) return;
      const v = inp.value;
      inp.value = v.slice(0, w.start) + it.label + v.slice(w.end);
      const caret = w.start + it.label.length;
      try { inp.setSelectionRange(caret, caret); } catch (e) { /* select-Felder */ }
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    }

    function move(d) {
      if (!state || !pop) return;
      state.index = (state.index + d + state.items.length) % state.items.length;
      Array.from(pop.children).forEach((c, i) => c.classList.toggle('on', i === state.index));
    }

    root.addEventListener('input', (e) => {
      const inp = e.target;
      if (inp instanceof HTMLInputElement && inp.dataset.ac && e.isTrusted) open(inp, false);
    });
    root.addEventListener('focusin', (e) => {
      const inp = e.target;
      if (inp instanceof HTMLInputElement && inp.dataset.ac === 'var' && !inp.value) open(inp, true);
    });
    root.addEventListener('focusout', () => setTimeout(close, 120));
    root.addEventListener('keydown', (e) => {
      if (!state || e.target !== state.inp) {
        if (e.key === ' ' && e.ctrlKey && e.target instanceof HTMLInputElement) { e.preventDefault(); open(e.target, true); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); move(-1); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); accept(state.inp, state.items[state.index]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    });
    window.addEventListener('resize', close);
    root.addEventListener('scroll', close, true);
    return { close };
  }

  BBE.ui = { menu, closeMenu, dialog, attachAutocomplete };
})(window);
