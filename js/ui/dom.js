/* Blockbild-Editor – kleine DOM-Helfer */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  /** h('div.klasse', {attr}, ...kinder) */
  function h(tag, attrs, ...children) {
    const m = /^([a-z0-9]+)((?:\.[\w-]+)*)$/i.exec(tag);
    const el = document.createElement(m ? m[1] : tag);
    if (m && m[2]) el.className = m[2].slice(1).split('.').join(' ');
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }

  // ---------------------------------------------------------------- Breite von Eingabefeldern

  let measureCanvas;
  const fontCache = new WeakMap();
  function textWidth(text, font) {
    measureCanvas = measureCanvas || document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  function autosize(input) {
    if (!input || !input.isConnected) return;
    let font = fontCache.get(input);
    if (!font) {
      const cs = getComputedStyle(input);
      font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      fontCache.set(input, font);
    }
    if (input.tagName === 'SELECT') {
      const opt = input.options[input.selectedIndex];
      const w = Math.ceil(textWidth(opt ? opt.text : '', font)) + 22;
      input.style.width = w + 'px';
      return;
    }
    const txt = input.value || input.placeholder || '';
    const w = Math.ceil(textWidth(txt, font)) + 8;
    input.style.width = Math.max(w, 18) + 'px';
  }

  function autosizeAll(root) {
    root.querySelectorAll('input.f, select.sel-type').forEach(autosize);
  }

  // ---------------------------------------------------------------- Diverses

  function debounce(fn, ms) {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = (...a) => { clearTimeout(t); fn(...a); };
    d.cancel = () => clearTimeout(t);
    return d;
  }

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    getRaw(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
  };

  /** Läuft die Seite in einer Vorschau, die Downloads blockiert? */
  const inSandboxViewer = () => !!(G.claude && (G.claude.hot !== undefined || G.claude.use));

  function download(filename, text, mime) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /** Popup an einem Punkt oder unter einem Element positionieren (bleibt im Fenster). */
  function placePopup(pop, anchor) {
    const vw = window.innerWidth, vh = window.innerHeight;
    pop.style.left = '0px';
    pop.style.top = '0px';
    const pr = pop.getBoundingClientRect();
    let x, y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 4;
      if (y + pr.height > vh - 8) y = Math.max(8, r.top - pr.height - 4);
    } else {
      x = anchor.x;
      y = anchor.y;
      if (y + pr.height > vh - 8) y = Math.max(8, vh - pr.height - 8);
    }
    if (x + pr.width > vw - 8) x = Math.max(8, vw - pr.width - 8);
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
  }

  let toastBox;
  function toast(msg, opts = {}) {
    if (!toastBox) {
      toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastBox);
    }
    const el = h('div.toast', null, h('span', null, msg));
    if (opts.action) {
      el.appendChild(h('button', { type: 'button', onclick: () => { opts.action.run(); el.remove(); } }, opts.action.label));
    }
    toastBox.appendChild(el);
    while (toastBox.children.length > 3) toastBox.firstChild.remove();
    setTimeout(() => el.remove(), opts.ms || 2600);
  }

  BBE.dom = { h, append, autosize, autosizeAll, debounce, store, download, copyText, placePopup, toast, inSandboxViewer };
})(window);
