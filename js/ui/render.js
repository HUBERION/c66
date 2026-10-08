/* Blockbild-Editor – Darstellung der Struktogramme
 *
 * R (Render-Kontext): { t, app, program, fn, static }
 *   static = true erzeugt eine reine Ansicht ohne Eingabefelder (für den Bild-Export).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { h, autosize } = BBE.dom;
  const { icon, kindIcon } = BBE.icons;
  const M = BBE.model;

  const TYPES = ['integer', 'string', 'integer[]', 'string[]'];
  const KIND_CLASS = {
    decl: 'blk-decl', input: 'blk-input', output: 'blk-output', assign: 'blk-assign', if: 'blk-if',
    while: 'blk-loop blk-while', for: 'blk-loop blk-for', until: 'blk-loop blk-until', switch: 'blk-switch',
    call: 'blk-call', comment: 'blk-cmt'
  };

  // ---------------------------------------------------------------- Bausteine der Zeilen

  const kw = (text, cls) => h('span.kw' + (cls ? '.' + cls : ''), null, text);
  const op = (text) => h('span.op', null, text);

  /**
   * Eingabefeld, das direkt ins Modell schreibt.
   * opts: { ph, pkey, ac: 'expr'|'var'|'name', cls, label, readOnly }
   */
  function field(R, obj, key, opts = {}) {
    const value = obj[key] == null ? '' : String(obj[key]);
    if (R.static) return h('span.f' + (opts.cls ? '.' + opts.cls : ''), null, value);
    const inp = h('input.f', {
      type: 'text', value, placeholder: opts.ph ? R.t(opts.ph) : '', spellcheck: 'false', autocomplete: 'off',
      autocapitalize: 'off', 'aria-label': opts.label ? R.t(opts.label) : (opts.ph ? R.t(opts.ph) : key)
    });
    if (opts.cls) opts.cls.split('.').forEach((c) => c && inp.classList.add(c));
    if (opts.pkey) inp.dataset.pkey = opts.pkey;
    if (opts.ac) inp.dataset.ac = opts.ac;
    inp.dataset.field = key;
    if (opts.readOnly) inp.readOnly = true;
    inp.addEventListener('input', () => {
      obj[key] = inp.value;
      autosize(inp);
      if (opts.onInput) opts.onInput(inp.value);
      R.app.fieldInput(inp, obj, key);
    });
    inp.addEventListener('change', () => R.app.fieldCommit(obj, key));
    return inp;
  }

  function typeSelect(R, obj, key, types, onChange, cls) {
    if (R.static) return h('span.sel-type.static' + (cls ? '.' + cls : ''), null, R.t('type.' + obj[key]));
    const sel = h('select.sel-type' + (cls ? '.' + cls : ''), { 'aria-label': R.t('stack.var') },
      types.map((t) => h('option', { value: t }, R.t('type.' + t))));
    sel.value = obj[key];
    sel.addEventListener('change', () => { onChange(sel.value); });
    return sel;
  }

  function commentField(R, node) {
    const has = !!(node.comment && node.comment.trim());
    if (R.static) return has ? h('span.cmt-mark', null, '// ' + node.comment) : null;
    const wrap = h('span.cmt-wrap' + (has ? '.has' : ''), null, h('span.slash', null, '//'));
    const inp = field(R, node, 'comment', { ph: 'ph.comment', cls: 'f-cmt' });
    inp.addEventListener('input', () => wrap.classList.toggle('has', !!inp.value.trim()));
    inp.addEventListener('blur', () => { if (!inp.value.trim()) wrap.classList.remove('show'); });
    wrap.appendChild(inp);
    return wrap;
  }

  const ln = (cls, ...kids) => h('div.ln' + (cls ? '.' + cls : ''), null, ...kids);

  // ---------------------------------------------------------------- Sequenzen

  function renderSeq(R, seq, owner, key, cls, style) {
    const el = h('div.seq' + (cls ? '.' + cls : ''), { dataset: { owner, key } });
    if (style) Object.entries(style).forEach(([k, v]) => el.style.setProperty(k, v));
    if (!seq.length) {
      el.classList.add('empty');
      if (!R.static) {
        const root = cls && cls.includes('root');
        const ph = h('button.seq-ph', { type: 'button', title: R.t('seq.add'), dataset: { owner, key } },
          root ? [h('span.ph-title', null, R.t('canvas.emptyTitle')), h('span.ph-txt', null, R.t('canvas.emptyText'))]
            : [h('span.ph-sym', null, '∅'), h('span.ph-txt', null, R.t('seq.empty'))]);
        ph.addEventListener('click', (e) => { e.stopPropagation(); R.app.quickInsert(owner, key, ph); });
        el.appendChild(ph);
      }
      return el;
    }
    for (const n of seq) el.appendChild(renderBlock(R, n));
    return el;
  }

  // ---------------------------------------------------------------- Blöcke

  function renderBlock(R, n) {
    const el = h('div.blk', { class: KIND_CLASS[n.kind] + ' cat-' + M.CATEGORY[n.kind], dataset: { id: n.id, kind: n.kind } });
    const t = R.t;
    const pk = (f) => n.id + ':' + f;

    switch (n.kind) {
      case 'decl': {
        const isArr = n.vtype.endsWith('[]');
        const parts = [
          typeSelect(R, n, 'vtype', TYPES, (v) => R.app.changeDeclType(n, v)),
          op(':'),
          field(R, n, 'name', { ph: 'ph.name', pkey: pk('name'), ac: 'name' })
        ];
        if (isArr) parts.push(op('['), field(R, n, 'length', { ph: 'ph.length', pkey: pk('length'), ac: 'expr' }), op(']'));
        else parts.push(op('='), field(R, n, 'init', { ph: 'ph.value', pkey: pk('init'), ac: 'expr' }));
        el.appendChild(ln('', ...parts, commentField(R, n)));
        break;
      }
      case 'input':
        el.appendChild(ln('', kw(t('kw.input')), op(':'),
          field(R, n, 'prompt', { ph: 'ph.prompt', pkey: pk('prompt'), ac: 'expr' }), op(','),
          field(R, n, 'target', { ph: 'ph.var', pkey: pk('target'), ac: 'var' }), commentField(R, n)));
        break;
      case 'output':
        el.appendChild(ln('', kw(t('kw.output')), op(':'),
          field(R, n, 'expr', { ph: 'ph.output', pkey: pk('expr'), ac: 'expr' }), commentField(R, n)));
        break;
      case 'assign':
        el.appendChild(ln('', field(R, n, 'target', { ph: 'ph.var', pkey: pk('target'), ac: 'var' }), op('='),
          field(R, n, 'expr', { ph: 'ph.expr', pkey: pk('expr'), ac: 'expr' }), commentField(R, n)));
        break;
      case 'comment':
        el.appendChild(ln('', op('//'), field(R, n, 'text', { ph: 'ph.text', ac: '' })));
        break;
      case 'call':
        el.appendChild(renderCallLine(R, n));
        break;

      case 'if': {
        el.appendChild(h('div.lbl', null, kw(t('kw.if'))));
        el.appendChild(h('div.ln.head', { dataset: { part: 'head' } },
          field(R, n, 'cond', { ph: 'ph.cond', pkey: pk('cond'), ac: 'expr' }),
          h('span.ns-yes', null, t('kw.yes')), h('span.ns-no', null, t('kw.no')),
          commentField(R, n)));
        el.appendChild(h('div.lbl', null, kw(t('kw.then'))));
        el.appendChild(renderSeq(R, n.then, n.id, 'then', 'then'));
        if (n.else) {
          el.appendChild(h('div.lbl', null, kw(t('kw.else'))));
          el.appendChild(renderSeq(R, n.else, n.id, 'else', 'else'));
        } else {
          const empty = h('div.else-empty', { title: t('ctx.addElse') }, R.static ? '' : '∅');
          if (!R.static) empty.addEventListener('dblclick', () => R.app.addElse(n));
          el.appendChild(empty);
        }
        break;
      }

      case 'switch': {
        const cols = n.cases.length + (n.else ? 1 : 0);
        el.style.setProperty('--n', String(Math.max(cols, 1)));
        el.appendChild(h('div.lbl.sw', null, kw(t('kw.switch'))));
        el.appendChild(h('div.ln.head', { dataset: { part: 'head' } },
          kw(t('kw.switch'), 'ns-only'),
          field(R, n, 'expr', { ph: 'ph.var', pkey: pk('expr'), ac: 'expr' }), commentField(R, n)));
        n.cases.forEach((c, i) => {
          const st = { '--c': String(i + 1) };
          const lbl = h('div.lbl.case-lbl' + (i === 0 ? '.first' : ''), { dataset: { caseId: c.id } },
            field(R, c, 'value', { ph: 'ph.case', pkey: n.id + ':case:' + c.id, ac: 'expr' }));
          lbl.style.setProperty('--c', String(i + 1));
          el.appendChild(lbl);
          el.appendChild(renderSeq(R, c.body, n.id, 'case:' + c.id, 'case' + (i === 0 ? '.first' : ''), st));
        });
        if (n.else) {
          const ci = String(n.cases.length + 1);
          const lbl = h('div.lbl.case-lbl.else-lbl' + (n.cases.length === 0 ? '.first' : ''), null, kw(t('kw.else')));
          lbl.style.setProperty('--c', ci);
          el.appendChild(lbl);
          el.appendChild(renderSeq(R, n.else, n.id, 'else', 'else' + (n.cases.length === 0 ? '.first' : ''), { '--c': ci }));
        }
        break;
      }

      case 'while':
        el.appendChild(h('div.ln.head', { dataset: { part: 'head' } }, kw(t('kw.while')),
          field(R, n, 'cond', { ph: 'ph.cond', pkey: pk('cond'), ac: 'expr' }), commentField(R, n)));
        el.appendChild(h('div.bar'));
        el.appendChild(renderSeq(R, n.body, n.id, 'body', 'body'));
        break;

      case 'for': {
        const stepField = field(R, n, 'step', { ph: 'ph.step', pkey: pk('step'), ac: 'expr' });
        const dim = () => stepField.classList && stepField.classList.toggle('dim', (n.step || '').trim() === '+1');
        dim();
        if (stepField.addEventListener) stepField.addEventListener('input', dim);
        const from = t('kw.forFrom');
        el.appendChild(h('div.ln.head', { dataset: { part: 'head' } }, kw(t('kw.for')),
          field(R, n, 'counter', { ph: 'ph.var', pkey: pk('counter'), ac: 'var' }),
          from === '=' ? op('=') : kw(from),
          field(R, n, 'from', { ph: 'ph.from', pkey: pk('from'), ac: 'expr' }),
          kw(t('kw.forTo')),
          field(R, n, 'to', { ph: 'ph.to', pkey: pk('to'), ac: 'expr' }),
          kw(t('kw.forStep')), stepField, commentField(R, n)));
        el.appendChild(h('div.bar'));
        el.appendChild(renderSeq(R, n.body, n.id, 'body', 'body'));
        break;
      }

      case 'until':
        el.appendChild(h('div.bar', null, kw(t('kw.untilBar'))));
        el.appendChild(renderSeq(R, n.body, n.id, 'body', 'body'));
        el.appendChild(h('div.ln.foot', { dataset: { part: 'foot' } }, kw(t('kw.untilFoot')),
          field(R, n, 'cond', { ph: 'ph.cond', pkey: pk('cond'), ac: 'expr' }), commentField(R, n)));
        break;

      default: break;
    }

    if (!R.static && R.app.hasBreakpoint(n.id)) {
      const dot = h('button.bp-dot', { type: 'button', title: R.t('ctx.breakpoint'), 'aria-label': R.t('ctx.breakpoint') });
      dot.addEventListener('click', (e) => { e.stopPropagation(); R.app.toggleBreakpoint(n.id); });
      el.appendChild(dot);
    }
    return el;
  }

  function renderCallLine(R, n) {
    const t = R.t;
    const callee = R.program.fns.find((f) => !f.isMain && f.name === n.fn);
    const kids = [];
    if (callee && callee.returnType !== 'void') {
      kids.push(field(R, n, 'target', { ph: 'ph.target', pkey: n.id + ':target', ac: 'var' }), op('='));
    }
    if (R.static) {
      kids.push(h('span.f.sel-fn', null, n.fn || '?'));
    } else {
      const subs = R.program.fns.filter((f) => !f.isMain);
      const sel = h('select.sel-type.sel-fn', { 'aria-label': t('pal.call') });
      sel.dataset.pkey = n.id + ':fn';
      sel.appendChild(h('option', { value: '' }, subs.length ? t('call.none') : t('call.noFns')));
      for (const f of subs) sel.appendChild(h('option', { value: f.name }, f.name || '?'));
      if (n.fn && !callee) sel.appendChild(h('option', { value: n.fn }, n.fn + ' ?'));
      sel.value = n.fn || '';
      sel.addEventListener('change', () => R.app.changeCallTarget(n, sel.value));
      kids.push(sel);
    }
    kids.push(op('('));
    const params = callee ? callee.params : n.args.map(() => null);
    params.forEach((p, i) => {
      if (i > 0) kids.push(op(','));
      if (n.args[i] === undefined) n.args[i] = '';
      const holder = { get v() { return n.args[i]; }, set v(x) { n.args[i] = x; } };
      const fld = field(R, holder, 'v', {
        ph: 'ph.arg', pkey: n.id + ':arg:' + i, ac: p && (p.byRef || p.type.endsWith('[]')) ? 'var' : 'expr'
      });
      if (p && fld.setAttribute) {
        fld.placeholder = p.name || R.t('ph.arg');
        fld.title = (p.byRef ? 'InOut ' : 'In ') + R.t('type.' + p.type) + ' ' + (p.name || '');
      }
      kids.push(fld);
    });
    kids.push(op(')'));
    kids.push(commentField(R, n));
    return ln('', ...kids);
  }

  // ---------------------------------------------------------------- Unterprogramm-Kopf

  function renderFnHead(R, fn) {
    const t = R.t;
    if (fn.isMain) {
      return h('div.fn-head.main', { dataset: { fn: fn.id, part: 'head' } },
        h('span.fn-badge', null, t('fn.main')), h('span.fn-title', null, 'main'));
    }
    const head = h('div.fn-head', { dataset: { fn: fn.id, part: 'head' } }, h('span.fn-badge', null, t('fn.sub')));
    if (R.static) {
      head.appendChild(h('span.sel-type.static', null, t('type.' + fn.returnType)));
      head.appendChild(h('span.fn-title', null, fn.name));
    } else {
      const rt = typeSelect(R, fn, 'returnType', ['void', 'integer', 'string'], (v) => R.app.changeReturnType(fn, v));
      rt.title = t('fn.returns');
      head.appendChild(rt);
      const name = field(R, fn, 'name', { ph: 'ph.fnName', pkey: fn.id + ':name', cls: 'fn-name', label: 'tb.fileName' });
      name.addEventListener('input', () => R.app.renameFunctionLive(fn));
      head.appendChild(name);
    }
    head.appendChild(h('span.fn-paren', null, '('));
    fn.params.forEach((p, i) => {
      head.appendChild(renderParam(R, fn, p));
      if (i < fn.params.length - 1) head.appendChild(h('span.fn-paren', null, ','));
    });
    if (!R.static) {
      const add = h('button.add-param', { type: 'button', title: t('fn.addParam') }, icon('plus'), t('fn.addParam'));
      add.addEventListener('click', () => R.app.addParam(fn));
      head.appendChild(add);
    }
    head.appendChild(h('span.fn-paren', null, ')'));
    return head;
  }

  function renderParam(R, fn, p) {
    const t = R.t;
    const isArr = p.type.endsWith('[]');
    const ref = p.byRef || isArr;
    const chip = h('span.param', { dataset: { param: p.id } });
    if (R.static) {
      chip.appendChild(h('span.dir-btn' + (ref ? '.inout' : ''), null, ref ? 'InOut' : 'In'));
      chip.appendChild(h('span.sel-type.static', null, t('type.' + p.type)));
      chip.appendChild(op(':'));
      chip.appendChild(h('span.f', null, p.name));
      if (p.doc) chip.appendChild(h('span.param-doc', null, '// ' + p.doc));
      return chip;
    }
    const dir = h('button.dir-btn' + (ref ? '.inout' : ''), {
      type: 'button', title: isArr ? t('param.arrayRef') : (ref ? t('param.inout') : t('param.in')), disabled: isArr
    }, icon(ref ? 'arrowUpDown' : 'arrowDown'), ref ? 'InOut' : 'In');
    dir.addEventListener('click', () => R.app.toggleParamDir(fn, p));
    chip.appendChild(dir);
    chip.appendChild(typeSelect(R, p, 'type', TYPES, (v) => R.app.changeParamType(fn, p, v)));
    chip.appendChild(op(':'));
    chip.appendChild(field(R, p, 'name', { ph: 'ph.name', pkey: fn.id + ':param:' + p.id, ac: 'name' }));
    if (p.doc || p.showDoc) {
      chip.appendChild(op('//'));
      const doc = field(R, p, 'doc', { ph: 'ph.doc', cls: 'param-doc' });
      chip.appendChild(doc);
    }
    const x = h('button.x-btn', { type: 'button', title: t('param.remove'), 'aria-label': t('param.remove') }, icon('x'));
    x.addEventListener('click', () => R.app.removeParam(fn, p));
    chip.appendChild(x);
    return chip;
  }

  // ---------------------------------------------------------------- ganzes Unterprogramm

  function renderFunction(R, fn) {
    const s = R.app.settings;
    const view = h('div.fnview', { dataset: { fn: fn.id } });
    view.appendChild(renderFnHead(R, fn));
    const dia = h('div.diagram', {
      class: (s.layout === 'ns' ? 'layout-ns' : 'layout-bb') + (s.colors ? '' : ' mono') + (R.locked ? ' locked' : ''),
      dataset: { fn: fn.id }
    });
    if (!fn.isMain && fn.returnType !== 'void') {
      const row = h('div.blk.blk-decl.cat-data.locked.result-row', { dataset: { fn: fn.id, part: 'result' } });
      row.appendChild(ln('', R.static ? null : icon('lock', 'lock-ic'),
        h('span.sel-type.static', null, R.t('type.' + fn.returnType)), op(':'),
        h('span.f.lock-txt', null, 'result'), op('='),
        field(R, fn, 'resultInit', { ph: 'ph.value', pkey: fn.id + ':resultInit', ac: 'expr' })));
      dia.appendChild(row);
    }
    dia.appendChild(renderSeq(R, fn.body, fn.id, 'body', 'root'));
    if (!fn.isMain && fn.returnType !== 'void') {
      const post = R.t('kw.returnPost');
      dia.appendChild(h('div.ln.fn-foot', { dataset: { fn: fn.id, part: 'return' } },
        kw(R.t('kw.returnPre')), op('result'), post ? kw(post) : null));
    }
    view.appendChild(dia);
    return view;
  }

  /** Mini-Darstellung für den Ziehen-Geist. */
  function ghost(R, kind, count) {
    const label = R.t('kw.' + (kind === 'else' ? 'else' : kind === 'case' ? 'case' : kind));
    return h('div.drag-ghost', { class: 'cat-' + M.CATEGORY[kind] },
      h('span.ghost-ic', null, kindIcon(kind)), h('span.kw', null, label),
      count > 1 ? h('span.ghost-count', null, '×' + count) : null);
  }

  BBE.render = { renderFunction, renderBlock, renderSeq, ghost, TYPES };
})(window);
