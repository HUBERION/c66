/* Blockbild-Editor – Seitenleiste: Stack, Konsole, C-Code, Prüfung */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { h } = BBE.dom;
  const { icon } = BBE.icons;
  const show = (v) => BBE.interp.show(v);

  // ---------------------------------------------------------------- Stack

  function renderStack(box, frames, opts) {
    const { t, showAddr, changed, changedElems, live } = opts;
    box.textContent = '';
    if (!frames || !frames.length) {
      box.appendChild(h('div.stack-empty', null, icon('stack'), h('span', null, t('stack.empty'))));
      return;
    }
    frames.forEach((fr, i) => {
      const el = h('div.frame' + (i === 0 && live ? '.top' : ''));
      el.appendChild(h('div.frame-head', null,
        h('span', null, fr.isMain ? 'main' : fr.name + '()'),
        h('span.frame-tag', null, i === 0 && live ? t('stack.top') : '')));
      const table = h('table.vars');
      const tbody = h('tbody');
      if (!fr.vars.length) {
        tbody.appendChild(h('tr', null, h('td.v-val', { colspan: showAddr ? 3 : 2, style: { color: 'var(--fg-3)' } }, '–')));
      }
      for (const v of fr.vars) {
        const isChanged = changed && changed.has(v.cell);
        const row = h('tr', { class: (v.ref ? 'ref ' : '') + (isChanged ? 'changed' : '') });
        const nameCell = h('td.v-name', null, v.name, h('span.v-type', null, t('type.' + v.type)));
        if (v.ref) nameCell.appendChild(h('span.v-ref', null, '→ ' + t('stack.ref', v.via || '?')));
        row.appendChild(nameCell);
        row.appendChild(h('td.v-val', null, valueNode(v, changedElems)));
        if (showAddr) row.appendChild(h('td.v-addr', null, v.addr || ''));
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      el.appendChild(table);
      box.appendChild(el);
    });
  }

  function valueNode(v, changedElems) {
    if (v.isArray) {
      const base = parseInt(v.addr, 16);
      return h('span.arr', null, v.value.map((x, i) => {
        const addr = '0x' + (base + i * 8).toString(16).padStart(4, '0');
        const ch = changedElems && changedElems.has(addr);
        return h('span.cell' + (ch ? '.changed' : ''), { title: v.name + '[' + i + '] · ' + addr },
          h('i', null, String(i)), h('b', null, typeof x === 'string' ? '"' + x + '"' : show(x)));
      }));
    }
    if (typeof v.value === 'string') return h('span.str', null, v.value);
    return h('span', null, show(v.value));
  }

  // ---------------------------------------------------------------- Konsole

  class Console {
    constructor(opts) {
      this.t = opts.t;
      this.body = opts.body;       // scrollender Bereich
      this.list = opts.list;       // Zeilen
      this.form = opts.form;       // Eingabezeile
      this.input = opts.input;
      this.promptEl = opts.promptEl;
      this.pending = null;
      this.empty = true;
      this.renderEmpty();

      this.form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submit();
      });
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelInput(); }
      });
    }

    renderEmpty() {
      this.list.textContent = '';
      this.list.appendChild(h('div.c-empty', null, this.t('console.empty')));
      this.empty = true;
    }

    clear() {
      this.renderEmpty();
    }

    add(el) {
      if (this.empty) { this.list.textContent = ''; this.empty = false; }
      this.list.appendChild(el);
      while (this.list.childElementCount > 2000) this.list.firstChild.remove();
      this.body.scrollTop = this.body.scrollHeight;
      return el;
    }

    print(text) { this.add(h('div.c-line', null, text)); }
    sys(text) { this.add(h('div.c-sys', null, text)); }
    error(text) { this.add(h('div.c-err', null, text)); }
    hint(text) { this.add(h('div.c-hint', null, text)); }

    /** Fragt einen Wert ab; cb(wert) oder cb(null) bei Abbruch. */
    ask(prompt, numeric, label, cb) {
      const lineEl = this.add(h('div.c-line', null, h('span.c-prompt', null, prompt)));
      this.pending = { numeric, label, cb, lineEl };
      this.promptEl.textContent = prompt || label || '';
      this.form.hidden = false;
      this.input.value = '';
      this.input.inputMode = 'text';
      this.input.enterKeyHint = 'send';
      this.input.placeholder = this.t('console.inputPh');
      setTimeout(() => this.input.focus(), 0);
    }

    submit() {
      const p = this.pending;
      if (!p) return;
      const raw = this.input.value;
      if (p.numeric) {
        const s = raw.trim().replace(',', '.');
        if (s === '' || Number.isNaN(Number(s))) {
          this.hint(this.t('console.needNumber'));
          this.input.select();
          return;
        }
        this.finishInput(s, raw.trim());
        return;
      }
      this.finishInput(raw, raw);
    }

    finishInput(value, echo) {
      const p = this.pending;
      this.pending = null;
      this.form.hidden = true;
      p.lineEl.appendChild(h('span.c-in', null, echo));
      p.cb(value);
    }

    cancelInput() {
      const p = this.pending;
      if (!p) return;
      this.pending = null;
      this.form.hidden = true;
      this.hint(this.t('console.cancelled', p.label));
      p.cb(null);
    }

    abort() {
      if (!this.pending) return;
      this.pending = null;
      this.form.hidden = true;
    }

    get waiting() { return !!this.pending; }
  }

  // ---------------------------------------------------------------- Quelltext (C, C++, C#, Java, Python, JavaScript, Fortran, COBOL)

  const words = (s) => new Set(s.split(' '));
  const LANGS = {
    c: {
      kw: words('if else while for do switch case default break continue return sizeof'),
      types: words('int char void const static unsigned long short double float'),
      line: '//', block: true, pp: true, quotes: '"'
    },
    java: {
      kw: words('if else while for do switch case default break continue return new static public private class import try catch throw true false null final'),
      types: words('int char void double float long boolean String Scanner Integer Arrays System'),
      line: '//', block: true, pp: false, quotes: '"'
    },
    cpp: {
      kw: words('if else while for do switch case default break continue return new using namespace try catch true false const auto'),
      types: words('int char void double float long bool string vector cout cin endl getline to_string stoi std'),
      line: '//', block: true, pp: true, quotes: '"'
    },
    cs: {
      kw: words('if else while for do switch case default break continue return new static using class ref out try catch true false null var'),
      types: words('int char void double float long bool string Console Array'),
      line: '//', block: true, pp: false, quotes: '"'
    },
    python: {
      kw: words('def return if elif else while for in break continue pass match case import from and or not True False None is lambda try except'),
      types: words('int str float list print input range len isinstance'),
      line: '#', block: false, pp: false, quotes: '"\''
    },
    js: {
      kw: words('function return if else while for do switch case default break continue let const var new true false null undefined of in typeof try catch throw'),
      types: words('console process require Number String Array Math Buffer prompt'),
      line: '//', block: true, pp: false, quotes: '"\'`'
    },
    // Fortran und COBOL unterscheiden nicht zwischen Groß- und Kleinschreibung (ci)
    fortran: {
      kw: words('program end contains implicit none function subroutine recursive result call if then else do while select case default exit cycle return print write read allocate deallocate type intent in out inout value present optional'),
      types: words('integer character logical len allocatable size mod trim merge int achar allocated is_iostat_eor len_trim'),
      line: '!', block: false, pp: false, quotes: '\'"', ci: true
    },
    cobol: {
      kw: words('identification division program-id data working-storage local-storage linkage section procedure using by content reference value pic occurs move to compute display accept with no advancing if else end-if evaluate when other end-evaluate perform varying from until test after forever end-perform exit call goback stop run end program recursive initialize not and or continue on exception end-accept spaces true'),
      types: words('function concatenate trim trailing length numval rem integer-part test-numval'),
      line: '*>', block: false, pp: /^\s*>>/, quotes: '"', ci: true, word: /^[A-Za-z_][\w-]*/
    }
  };

  function highlight(pre, code, lang) {
    const L = LANGS[lang] || LANGS.c;
    pre.textContent = '';
    let inBlock = false;
    for (const line of code.replace(/\n$/, '').split('\n')) {
      const el = h('span.cl');
      let i = 0;
      const push = (cls, text) => { if (!text) return; el.appendChild(cls ? h('span.' + cls, null, text) : document.createTextNode(text)); };
      if (L.pp && !inBlock && (L.pp instanceof RegExp ? L.pp : /^\s*#/).test(line)) { push('tok-pp', line); pre.appendChild(el); continue; }
      let buf = '';
      const flush = () => { push(null, buf); buf = ''; };
      while (i < line.length) {
        if (inBlock) {
          const end = line.indexOf('*/', i);
          if (end < 0) { push('tok-cmt', line.slice(i)); i = line.length; break; }
          push('tok-cmt', line.slice(i, end + 2));
          i = end + 2;
          inBlock = false;
          continue;
        }
        const rest = line.slice(i);
        if (L.block && rest.startsWith('/*')) { flush(); inBlock = true; continue; }
        if (rest.startsWith(L.line)) { flush(); push('tok-cmt', rest); i = line.length; break; }
        // Python: f"…" und """…"""
        const pre1 = lang === 'python' && /^[fFrR]["']/.test(rest) ? 1 : 0;
        if (L.quotes.includes(rest[pre1])) {
          flush();
          const q = rest[pre1];
          let j = pre1 + 1;
          while (j < rest.length && rest[j] !== q) j += rest[j] === '\\' ? 2 : 1;
          push('tok-str', rest.slice(0, j + 1));
          i += j + 1;
          continue;
        }
        const m = (L.word || /^[A-Za-z_]\w*/).exec(rest);
        if (m) {
          const w = L.ci ? m[0].toLowerCase() : m[0];
          if (L.kw.has(w)) { flush(); push('tok-kw', m[0]); }
          else if (L.types.has(w)) { flush(); push('tok-type', m[0]); }
          else buf += m[0];
          i += m[0].length;
          continue;
        }
        const num = /^\d+(\.\d+)?/.exec(rest);
        if (num && !/\w/.test(line[i - 1] || '')) { flush(); push('tok-num', num[0]); i += num[0].length; continue; }
        buf += rest[0];
        i++;
      }
      flush();
      if (!el.childNodes.length) el.appendChild(document.createTextNode(' '));
      pre.appendChild(el);
    }
  }

  // ---------------------------------------------------------------- Prüfung

  function renderProblems(box, analysis, opts) {
    const { t, program, onPick } = opts;
    box.textContent = '';
    if (!analysis || !analysis.problems.length) {
      box.appendChild(h('div.prob-ok', null, icon('check'), h('span', null, t('prob.none'))));
      return;
    }
    const sorted = analysis.problems.slice().sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'error' ? -1 : 1));
    const list = h('ul.prob-list');
    for (const p of sorted) {
      const fn = program.fns.find((f) => f.id === p.fnId);
      const where = (fn ? (fn.isMain ? 'main' : fn.name || '?') : '?') + ' · ' + fieldLabel(t, p.field);
      const btn = h('button.prob.' + p.sev, { type: 'button' },
        icon(p.sev === 'error' ? 'error' : 'warn'),
        h('span', null, h('span.p-msg', null, t(p.key, p.args)), h('span.p-where', null, where)));
      btn.addEventListener('click', () => onPick(p));
      list.appendChild(h('li', null, btn));
    }
    box.appendChild(list);
  }

  function fieldLabel(t, field) {
    if (!field) return '';
    if (field.startsWith('case:')) return t('kw.case');
    if (field.startsWith('arg:')) return t('ph.arg') + ' ' + (Number(field.slice(4)) + 1);
    if (field.startsWith('param:')) return t('fn.params');
    const map = { cond: 'ph.cond', expr: 'ph.expr', target: 'ph.var', name: 'ph.name', init: 'ph.value', length: 'ph.length', prompt: 'ph.prompt', counter: 'ph.var', from: 'ph.from', to: 'ph.to', step: 'ph.step', fn: 'pal.call', resultInit: 'fn.result' };
    return map[field] ? t(map[field]).replace(/"/g, '') : field;
  }

  BBE.panels = { renderStack, Console, highlight, highlightC: (pre, code) => highlight(pre, code, 'c'), renderProblems };
})(window);
