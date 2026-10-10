/* Blockbild-Editor – Übersetzung nach Python 3 (ab 3.10, wegen match/case)
 *
 *   Zahl/Text → int bzw. float / str        Zahl[]/Text[] → Liste
 *   InOut-Parameter: Python kennt kein call by reference für Zahlen und Texte – das Unterprogramm
 *   gibt die geänderten Werte zurück, der Aufruf weist sie wieder zu:  x, y = tausche(x, y)
 *   Listen werden in Python ohnehin geteilt und brauchen das nicht.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  const RESERVED = new Set(('False None True and as assert async await break class continue def del elif else except finally for from ' +
    'global if import in is lambda nonlocal not or pass raise return try while with yield match case print input len range int str ' +
    'float list main type id sum min max abs').split(' '));

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const pyStr = (s) => JSON.stringify(String(s));

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { text: tr('pyHelperText'), num: tr('pyHelperNum') };
    const used = { text: false, num: false };
    const fnName = new Map(program.fns.map((f) => [f.name, RESERVED.has(f.name) ? f.name + '_' : f.name]));
    const body = [];

    // run() wird am Ende von generate() aufgerufen, wenn alle Hilfsfunktionen definiert sind
    function run() {
    for (const fn of program.fns.filter((f) => !f.isMain)) {
      genFunction(fn);
      body.push('', '');
    }
    genFunction(program.fns.find((f) => f.isMain));

    const out = ['# ' + tr('pyHeader1'), '# ' + tr('pyHeader2'), ''];
    const q = tr('genArgPrompt'), v = tr('genArgValue');
    if (used.num) {
      out.push('', 'def ' + H.num + '(' + q + '):');
      out.push(IND + '"""' + tr('pyHelperNumDoc') + '"""');
      out.push(IND + 'while True:');
      out.push(IND + IND + 'try:');
      out.push(IND + IND + IND + v + ' = float(input(' + q + '))');
      out.push(IND + IND + IND + 'return int(' + v + ') if ' + v + '.is_integer() else ' + v);
      out.push(IND + IND + 'except ValueError:');
      out.push(IND + IND + IND + 'print(' + pyStr(tr('console.needNumber')) + ')');
    }
    if (used.text) {
      out.push('', '', 'def ' + H.text + '(' + v + '):');
      out.push(IND + '"""' + tr('pyHelperTextDoc') + '"""');
      out.push(IND + 'if isinstance(' + v + ', float) and ' + v + '.is_integer():');
      out.push(IND + IND + 'return str(int(' + v + '))');
      out.push(IND + 'return str(' + v + ')');
    }
    if (used.num || used.text) out.push('', '');
    out.push(...body);
    out.push('', '', 'if __name__ == "__main__":', IND + 'main()');
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
    }

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      for (const name of scope.keys()) rename.set(name, RESERVED.has(name) ? name + '_' : name);
      const outs = fn.params.filter((p) => p.byRef && !A.isArrayType(p.type));
      const ctx = { fn, scope, rename, ind: 1, lines: body, floaty: floatyVars(fn, scope), outs };
      const params = fn.params.map((p) => rename.get(p.name) || p.name || 'p');
      body.push('def ' + (fn.isMain ? 'main' : fnName.get(fn.name)) + '(' + params.join(', ') + '):');
      const start = body.length;
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, 'result = ' + valueFor(ctx, fn.resultInit, fn.returnType));
      genSeq(ctx, fn.body);
      if (!fn.isMain) {
        const ret = [];
        if (fn.returnType !== 'void') ret.push('result');
        outs.forEach((p) => ret.push(rename.get(p.name)));
        if (ret.length) line(ctx, 'return ' + ret.join(', '));
      }
      if (body.length === start) line(ctx, 'pass');
    }

    /** Zahl-Variablen, die durch "/" eine Kommazahl werden können (für die Anzeige ohne ".0"). */
    function floatyVars(fn, scope) {
      const fl = new Set();
      const isFloaty = (ast) => {
        let hit = false;
        if (ast) BBE.expr.walk(ast, (a) => { if ((a.k === 'bin' && a.op === '/') || (a.k === 'num' && !Number.isInteger(a.v)) || (a.k === 'id' && fl.has(a.name))) hit = true; });
        return hit;
      };
      for (let round = 0; round < 4; round++) {
        M.walkSeq(fn.body, (n) => {
          const name = (src) => { const t = tryTarget(src); return t ? (t.k === 'id' ? t.name : t.obj.name) : null; };
          if (n.kind === 'assign' && isFloaty(tryParse(n.expr))) fl.add(name(n.target));
          if (n.kind === 'decl' && isFloaty(tryParse(n.init))) fl.add(n.name);
          if (n.kind === 'for' && isFloaty(tryParse(n.step))) fl.add(name(n.counter));
        });
        if (!fn.isMain && fn.returnType !== 'void' && isFloaty(tryParse(fn.resultInit))) fl.add('result');
      }
      return fl;
    }

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    const withComment = (code, n) => (n && n.comment ? code + '  # ' + n.comment.replace(/\s+/g, ' ') : code);

    function genSeq(ctx, seq) {
      const start = ctx.lines.length;
      for (const n of seq) genStmt(ctx, n);
      if (ctx.lines.length === start) line(ctx, 'pass');
    }

    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    // ------------------------------------------------------------ Ausdrücke

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(n) ? n + '_' : n);
    const isFloatyExpr = (ctx, ast) => {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if ((a.k === 'bin' && a.op === '/') || (a.k === 'num' && !Number.isInteger(a.v)) || (a.k === 'id' && ctx.floaty.has(a.name))) hit = true; });
      return hit;
    };

    const PREC = { '||': 1, '&&': 2, '!': 3, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    const PY_OP = { '&&': 'and', '||': 'or' };

    function ex(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': return pyStr(a.v);
        case 'paren': return ex(ctx, a.e, minPrec);
        case 'id': return name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 9) + '[' + ex(ctx, a.index) + ']';
        case 'len': return 'len(' + ex(ctx, a.obj) + ')';
        case 'un':
          if (a.op === '!') return wrap('not ' + ex(ctx, a.a, 3), 3);
          return wrap(a.op + ex(ctx, a.a, 7), 7);
        case 'bin': {
          if (a.op === '+' && typeOf(ctx, a) === 'string') return wrap(textExpr(ctx, a), 5);
          const p = PREC[a.op];
          const op = PY_OP[a.op] || a.op;
          return wrap(ex(ctx, a.a, p) + ' ' + op + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    /** Text-Verkettung: als f-String, wenn möglich, sonst mit str(). */
    function textExpr(ctx, ast) {
      const parts = [];
      const flat = (x) => {
        const s = strip(x);
        if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') { flat(s.a); flat(s.b); } else parts.push(x);
      };
      flat(ast);
      const pieces = parts.map((p) => {
        const s = strip(p);
        if (s.k === 'str') return { lit: s.v };
        if (typeOf(ctx, p) === 'string') return { code: ex(ctx, p) };
        return { code: numText(ctx, p) };
      });
      const fstrOk = pieces.every((x) => x.lit !== undefined || !/["'{}\\]/.test(x.code));
      if (fstrOk) {
        // Platzhalter aus dem Private-Use-Bereich: werden von JSON.stringify nicht escaped
        return 'f' + pyStr(pieces.map((x) => (x.lit !== undefined ? x.lit.replace(/[{}]/g, (m) => m + m) : '' + x.code + '')).join(''))
          .replace(//g, '{').replace(//g, '}');
      }
      return pieces.map((x) => (x.lit !== undefined ? pyStr(x.lit) : (x.code.startsWith('str(') || x.code.startsWith(H.text + '(') ? x.code : 'str(' + x.code + ')'))).join(' + ');
    }

    /** Zahl als Text – ohne ".0", wenn sie eine Kommazahl sein kann. */
    function numText(ctx, ast) {
      if (isFloatyExpr(ctx, ast)) { used.text = true; return H.text + '(' + ex(ctx, ast) + ')'; }
      return ex(ctx, ast);
    }

    function textValue(ctx, ast) {
      const t = typeOf(ctx, ast);
      if (t === 'string') return ex(ctx, ast);
      if (isFloatyExpr(ctx, ast)) { used.text = true; return H.text + '(' + ex(ctx, ast) + ')'; }
      return 'str(' + ex(ctx, ast) + ')';
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || (type === 'string' ? '""' : '0');
      if (type === 'string' && typeOf(ctx, ast) !== 'string') return textValue(ctx, ast);
      return ex(ctx, ast);
    }

    function cond(ctx, src) {
      const ast = tryParse(src);
      return ast ? ex(ctx, strip(ast)) : (String(src || '').trim() || 'True');
    }

    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || '_'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          line(ctx, '# ' + String(n.text || '').replace(/\n/g, ' '));
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          if (n.vtype.endsWith('[]')) {
            const fill = n.vtype === 'string[]' ? '""' : '0';
            line(ctx, withComment(nm + ' = [' + fill + '] * ' + ex(ctx, tryParse(n.length) || { k: 'num', raw: '0' }, 6), n));
          } else {
            line(ctx, withComment(nm + ' = ' + valueFor(ctx, n.init, n.vtype), n));
          }
          return;
        }
        case 'assign': {
          const tt = targetType(ctx, n.target);
          line(ctx, withComment(target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, tt), n));
          return;
        }
        case 'input': {
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? textValue(ctx, p) : '""';
          if (tt === 'integer') { used.num = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ')', n)); }
          else line(ctx, withComment(target(ctx, n.target) + ' = input(' + prompt + ')', n));
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, withComment('print(' + (ast ? (typeOf(ctx, ast) === 'string' ? ex(ctx, strip(ast)) : numText(ctx, ast)) : '""') + ')', n));
          return;
        }
        case 'if': {
          line(ctx, withComment('if ' + cond(ctx, n.cond) + ':', n));
          block(ctx, n.then);
          let els = n.else;
          // SONST, das nur aus einem WENN besteht → elif
          while (els && els.length === 1 && els[0].kind === 'if' && !els[0].comment) {
            const inner = els[0];
            line(ctx, 'elif ' + cond(ctx, inner.cond) + ':');
            block(ctx, inner.then);
            els = inner.else;
          }
          if (els && els.length) { line(ctx, 'else:'); block(ctx, els); }
          return;
        }
        case 'while':
          line(ctx, withComment('while ' + cond(ctx, n.cond) + ':', n));
          block(ctx, n.body);
          return;
        case 'until':
          line(ctx, withComment('while True:', n));
          ctx.ind++;
          for (const s of n.body) genStmt(ctx, s);
          line(ctx, 'if ' + cond(ctx, n.cond) + ':');
          line(ctx, IND + 'break');
          ctx.ind--;
          return;
        case 'for': return genFor(ctx, n);
        case 'switch': {
          const sel = tryParse(n.expr);
          line(ctx, withComment('match ' + (sel ? ex(ctx, strip(sel)) : '0') + ':', n));
          ctx.ind++;
          for (const c of n.cases) {
            const v = tryParse(c.value);
            line(ctx, 'case ' + (v ? ex(ctx, strip(v)) : '_') + ':');
            block(ctx, c.body);
          }
          if (n.else) { line(ctx, 'case _:'); block(ctx, n.else); }
          ctx.ind--;
          return;
        }
        case 'call': return genCall(ctx, n);
        default: return;
      }
    }

    function genFor(ctx, n) {
      const k = target(ctx, n.counter);
      const from = ex(ctx, tryParse(n.from) || { k: 'num', raw: '0' });
      const toAst = tryParse(n.to);
      const stepAst = tryParse(n.step);
      const lit = stepAst ? A.literalValue(stepAst) : 1;
      if (typeof lit === 'number' && Number.isInteger(lit) && lit !== 0) {
        // Ende einschließlich: bis + 1 (aufwärts) bzw. bis - 1 (abwärts); "x - 1" + 1 wird zu "x"
        const d = lit > 0 ? 1 : -1;
        let end;
        const s = toAst ? strip(toAst) : null;
        if (s && s.k === 'num' && Number.isInteger(s.v)) end = String(s.v + d);
        else if (s && s.k === 'bin' && (s.op === '+' || s.op === '-') && strip(s.b).k === 'num' && Number.isInteger(strip(s.b).v)) {
          const c = (s.op === '+' ? 1 : -1) * strip(s.b).v + d;
          const base = ex(ctx, s.a, 5);
          end = c === 0 ? base : base + (c > 0 ? ' + ' + c : ' - ' + (-c));
        } else end = (toAst ? ex(ctx, toAst, 5) : '0') + (d > 0 ? ' + 1' : ' - 1');
        const args = lit === 1 && from === '0' ? [end] : lit === 1 ? [from, end] : [from, end, String(lit)];
        line(ctx, withComment('for ' + k + ' in range(' + args.join(', ') + '):', n));
        block(ctx, n.body);
        return;
      }
      // Schrittweite ist kein fester Wert → while-Schleife wie im Blockbild
      const step = stepAst ? ex(ctx, stepAst) : '1';
      const to = toAst ? ex(ctx, toAst, 4) : '0';
      line(ctx, withComment(k + ' = ' + from, n));
      line(ctx, 'while (' + k + ' <= ' + to + ' if ' + step + ' > 0 else ' + k + ' >= ' + to + '):');
      ctx.ind++;
      for (const s of n.body) genStmt(ctx, s);
      line(ctx, k + ' += ' + step);
      ctx.ind--;
    }

    function genCall(ctx, n) {
      const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
      if (!callee) { line(ctx, withComment('# ' + (n.fn || '?') + '(…)', n)); return; }
      const args = callee.params.map((p, i) => {
        const src = n.args[i] || '';
        if (p.byRef || A.isArrayType(p.type)) return target(ctx, src);
        return valueFor(ctx, src, p.type);
      });
      const call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
      const lhs = [];
      if (callee.returnType !== 'void') lhs.push(n.target && n.target.trim() ? target(ctx, n.target) : '_');
      callee.params.forEach((p, i) => { if (p.byRef && !A.isArrayType(p.type)) lhs.push(target(ctx, n.args[i] || '')); });
      if (!lhs.length || (lhs.length === 1 && lhs[0] === '_')) line(ctx, withComment(call, n));
      else line(ctx, withComment(lhs.join(', ') + ' = ' + call, n));
    }

    return run();
  }

  BBE.pygen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
