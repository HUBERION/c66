/* Blockbild-Editor – Übersetzung nach Fortran (Fortran 2008, z. B. gfortran)
 *
 *   Ein Programm mit "contains": Unterprogramme werden zu recursive subroutine/function.
 *   Zahl → integer, Text → character(len=:), allocatable (wächst automatisch),
 *   Arrays → allocatable mit Untergrenze 0 (a(0:n-1)), Text-Arrays über den Typ "text" (Element%v).
 *   InOut → intent(inout); In-Parameter, die verändert werden, bekommen eine lokale Kopie.
 *   Fortran unterscheidet nicht zwischen Groß- und Kleinschreibung – Namen werden bei Bedarf umbenannt.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '  ';
  const MAXLINE = 120;
  // Schlüsselwörter und Intrinsics, die als Namen verwirren oder mit dem erzeugten Code kollidieren
  const RESERVED = new Set(('program end contains implicit none integer character logical real type function subroutine ' +
    'result recursive call if then else do while select case default exit cycle return stop print write read allocate ' +
    'deallocate allocated intent in out inout value len size mod trim merge int achar adjustl text module use ' +
    'true false and or not eq ne lt le gt ge kind').split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };

  /** Fortran-Text: '…' mit verdoppeltem ', Steuerzeichen über achar(). */
  function fStr(s) {
    const out = [];
    let cur = '';
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c === 127) { if (cur) out.push("'" + cur + "'"); cur = ''; out.push('achar(' + c + ')'); }
      else cur += ch === "'" ? "''" : ch;
    }
    if (cur || !out.length) out.push("'" + cur + "'");
    return out.join(' // ');
  }

  function asciiName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(s)) s = 'v' + (s.startsWith('_') ? '' : '_') + s;
    return s.slice(0, 60);
  }

  /** Lange Zeilen mit & umbrechen (Fortran erlaubt höchstens 132 Zeichen). */
  function wrap(lineText) {
    const out = [];
    let rest = lineText;
    const indent = (lineText.match(/^ */) || [''])[0] + IND + IND;
    while (rest.length > MAXLINE) {
      let inStr = false, best = -1, bestStr = -1;
      for (let i = 0; i < MAXLINE - 2 && i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "'") inStr = !inStr;
        else if (!inStr && i > 20 && (rest.startsWith(', ', i) || rest.startsWith(' // ', i))) best = i;
        else if (inStr && i > 20) bestStr = i;
      }
      if (best > 0) {
        const cut = rest.startsWith(', ', best) ? best + 1 : best;
        out.push(rest.slice(0, cut).replace(/\s+$/, '') + ' &');
        rest = indent + rest.slice(cut).replace(/^\s+/, '');
      } else if (bestStr > 0) {
        out.push(rest.slice(0, bestStr) + '&');
        rest = indent + '&' + rest.slice(bestStr);
      } else break;
    }
    out.push(rest);
    return out;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { str: tr('fortStr'), line: tr('fortReadLine'), num: tr('fortHelperNum'), toNum: tr('fortToNum') };
    const used = { str: false, line: false, num: false, toNum: false, text: false };
    const progName = tr('fortProgram');
    const taken = new Set([progName, H.str, H.line, H.num, H.toNum, 'text'].map((s) => s.toLowerCase()));
    const fnName = new Map();
    for (const f of program.fns.filter((x) => !x.isMain)) {
      let n = asciiName(f.name);
      if (RESERVED.has(n.toLowerCase())) n += '_';
      while (taken.has(n.toLowerCase())) n += '_';
      taken.add(n.toLowerCase());
      fnName.set(f.name, n);
    }
    const globalTaken = new Set(taken);
    const mainLines = [];
    const procs = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || asciiName(n);
    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const PREC = { '||': 1, '&&': 2, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
    const OPS = { '||': '.or.', '&&': '.and.', '!=': '/=' };

    function line(ctx, s) { for (const l of wrap(IND.repeat(ctx.ind) + s)) ctx.lines.push(l); }
    function comment(ctx, n) { if (n && n.comment) line(ctx, '! ' + n.comment.replace(/\s+/g, ' ')); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    function declType(t) {
      if (t === 'integer') return 'integer';
      if (t === 'string') return 'character(len=:), allocatable';
      if (t === 'integer[]') return 'integer, allocatable';
      used.text = true;
      return 'type(text), allocatable';
    }

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      const local = new Set(fn.isMain ? [] : globalTaken);
      if (fn.isMain) for (const n of globalTaken) local.add(n);
      for (const n of scope.keys()) {
        let r = n === 'result' && !fn.isMain ? 'result' : asciiName(n);
        if (r !== 'result' || fn.isMain) {
          if (RESERVED.has(r.toLowerCase())) r += '_';
          while (local.has(r.toLowerCase())) r += '_';
        }
        local.add(r.toLowerCase());
        rename.set(n, r);
      }
      const lines = fn.isMain ? mainLines : [];
      const written = A.writtenNames(program, fn);
      const ctx = { fn, scope, rename, ind: fn.isMain ? 1 : 2, lines, local, extra: [], firstDecl: new Set() };
      const seen = new Set();
      for (const n of fn.body) if (n.kind === 'decl' && n.name && !seen.has(n.name)) { seen.add(n.name); ctx.firstDecl.add(n); }

      const decls = [];
      const copies = [];
      const dummies = [];
      for (const p of fn.params) {
        const nm = name(ctx, p.name || 'p');
        if (A.isArrayType(p.type)) {
          dummies.push(nm);
          if (p.type === 'string[]') used.text = true;
          decls.push((p.type === 'integer[]' ? 'integer' : 'type(text)') + ', intent(inout) :: ' + nm + '(0:)');
        } else if (p.byRef) {
          dummies.push(nm);
          decls.push(declType(p.type) + ', intent(inout) :: ' + nm);
        } else if (p.type === 'integer') {
          dummies.push(nm);
          decls.push('integer, ' + (written.has(p.name) ? 'value' : 'intent(in)') + ' :: ' + nm);
        } else if (written.has(p.name)) {
          let d = nm + '_in';
          while (local.has(d.toLowerCase())) d += '_';
          local.add(d.toLowerCase());
          dummies.push(d);
          decls.push('character(len=*), intent(in) :: ' + d);
          decls.push('character(len=:), allocatable :: ' + nm);
          copies.push(nm + ' = ' + d);
        } else {
          dummies.push(nm);
          decls.push('character(len=*), intent(in) :: ' + nm);
        }
      }
      if (!fn.isMain && fn.returnType !== 'void') decls.push(declType(fn.returnType) + ' :: result');
      for (const [n, v] of scope) {
        if (v.kind !== 'decl') continue;
        decls.push(declType(v.type) + ' :: ' + name(ctx, n) + (A.isArrayType(v.type) ? '(:)' : ''));
      }

      // Rumpf zuerst (dabei können Hilfsvariablen dazukommen)
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, 'result = ' + valueFor(ctx, fn.resultInit, fn.returnType));
      for (const c of copies) line(ctx, c);
      genSeq(ctx, fn.body);
      const bodyLines = lines.splice(0);
      const head = [];
      const ind = IND.repeat(fn.isMain ? 1 : 2);
      for (const d of decls.concat(ctx.extra)) head.push(...wrap(ind + d));

      if (fn.isMain) { mainLines.push(...head, ...(head.length ? [''] : []), ...bodyLines); return; }
      const kind = fn.returnType === 'void' ? 'subroutine' : 'function';
      const sig = IND + 'recursive ' + kind + ' ' + fnName.get(fn.name) + '(' + dummies.join(', ') + ')' + (kind === 'function' ? ' result(result)' : '');
      procs.push(...wrap(sig), ...head, ...(head.length && bodyLines.length ? [''] : []), ...bodyLines, IND + 'end ' + kind + ' ' + fnName.get(fn.name), '');
    }

    /** Hilfsvariable für verworfene Rückgabewerte. */
    function discard(ctx, type) {
      const n = tr('fortDiscard') + (type === 'string' ? '_text' : '_zahl');
      if (!ctx.local.has(n.toLowerCase())) { ctx.local.add(n.toLowerCase()); ctx.extra.push(declType(type) + ' :: ' + n); }
      return n;
    }

    // ------------------------------------------------------------ Ausdrücke

    function ex(ctx, a, minPrec = 0) {
      const wrapP = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': { const s = fStr(a.v); return s.includes(' // ') && minPrec > 0 ? '(' + s + ')' : s; }
        case 'paren': return typeOf(ctx, a) === 'string' ? ex(ctx, a.e, minPrec) : '(' + ex(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': {
          const t = typeOf(ctx, a.obj);
          return ex(ctx, a.obj, 9) + '(' + ex(ctx, a.index) + ')' + (t === 'string[]' ? '%v' : '');
        }
        case 'len': {
          const t = typeOf(ctx, a.obj);
          return (A.isArrayType(t) ? 'size(' : 'len(') + ex(ctx, a.obj) + ')';
        }
        case 'un':
          if (a.op === '!') return '(.not. ' + ex(ctx, a.a, 3) + ')';
          if (a.op === '+') return ex(ctx, a.a, minPrec);
          return (minPrec > 0 ? '(' : '') + '-' + ex(ctx, a.a, 6) + (minPrec > 0 ? ')' : '');
        case 'bin': {
          if (a.op === '+' && typeOf(ctx, a) === 'string') return wrapP(textExpr(ctx, a), 5);
          if (a.op === '%') return 'mod(' + ex(ctx, a.a) + ', ' + ex(ctx, a.b) + ')';
          const p = PREC[a.op];
          return wrapP(ex(ctx, a.a, p) + ' ' + (OPS[a.op] || a.op) + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [ast];
    }

    /** Text-Ausdruck: Teile mit // verbinden, Zahlen über als_text(). */
    function textExpr(ctx, ast) {
      return parts(ctx, ast).map((p) => asText(ctx, p, 6)).join(' // ');
    }

    function asText(ctx, ast, minPrec = 0) {
      const t = typeOf(ctx, ast);
      if (t === 'string') return ex(ctx, ast, minPrec);
      if (t === 'bool') return "trim(merge('true ', 'false', " + ex(ctx, ast) + '))';
      used.str = true;
      return H.str + '(' + ex(ctx, ast) + ')';
    }

    function hasFloat(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
      return hit;
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || (type === 'string' ? "''" : '0');
      const t = typeOf(ctx, ast);
      if (type === 'string') return t === 'string' ? ex(ctx, strip(ast)) : asText(ctx, ast);
      if (type === 'integer' && t === 'string') { used.toNum = true; return H.toNum + '(' + ex(ctx, ast) + ')'; }
      if (type === 'integer' && hasFloat(ast)) return 'int(' + ex(ctx, ast) + ')';
      return ex(ctx, strip(ast));
    }

    function cond(ctx, src) {
      const ast = tryParse(src);
      if (!ast) return '.true.';
      const s = strip(ast);
      const t = typeOf(ctx, s);
      if (t === 'string') return 'len(' + ex(ctx, s) + ') > 0';
      if (t === 'integer') return ex(ctx, s, 5) + ' /= 0';
      return ex(ctx, s);
    }

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, '! ' + l);
          return;
        case 'decl': {
          comment(ctx, n);
          const nm = name(ctx, n.name || 'variable');
          if (n.vtype.endsWith('[]')) {
            const len = tryParse(n.length);
            if (!ctx.firstDecl.has(n)) line(ctx, 'if (allocated(' + nm + ')) deallocate(' + nm + ')');
            line(ctx, 'allocate(' + nm + '(0:' + (len ? ex(ctx, len, 5) : '0') + ' - 1))');
            line(ctx, nm + ' = ' + (n.vtype === 'string[]' ? "text('')" : '0'));
          } else {
            line(ctx, nm + ' = ' + valueFor(ctx, n.init, n.vtype));
          }
          return;
        }
        case 'assign':
          comment(ctx, n);
          line(ctx, target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, targetType(ctx, n.target)));
          return;
        case 'input': {
          comment(ctx, n);
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? asText(ctx, strip(p)) : "''";
          used.line = true;
          if (tt === 'integer') { used.num = true; line(ctx, target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ')'); }
          else line(ctx, target(ctx, n.target) + ' = ' + H.line + '(' + prompt + ')');
          return;
        }
        case 'output': {
          comment(ctx, n);
          const ast = tryParse(n.expr);
          if (!ast) { line(ctx, "print '(a)', ''"); return; }
          if (typeOf(ctx, ast) === 'integer') line(ctx, "print '(i0)', " + ex(ctx, strip(ast)));
          else line(ctx, "print '(a)', " + asText(ctx, strip(ast)));
          return;
        }
        case 'if':
          comment(ctx, n);
          line(ctx, 'if (' + cond(ctx, n.cond) + ') then');
          block(ctx, n.then);
          if (n.else && n.else.length) {
            if (n.else.length === 1 && n.else[0].kind === 'if' && !n.else[0].comment) {
              const save = ctx.lines.length;
              genStmt(ctx, n.else[0]);
              ctx.lines[save] = ctx.lines[save].replace(/^(\s*)if /, '$1else if ');
              ctx.lines.pop(); // "end if" des inneren WENN
              line(ctx, 'end if');
              return;
            }
            line(ctx, 'else');
            block(ctx, n.else);
          }
          line(ctx, 'end if');
          return;
        case 'while':
          comment(ctx, n);
          line(ctx, 'do while (' + cond(ctx, n.cond) + ')');
          block(ctx, n.body);
          line(ctx, 'end do');
          return;
        case 'until':
          comment(ctx, n);
          line(ctx, 'do');
          block(ctx, n.body);
          ctx.ind++; line(ctx, 'if (' + cond(ctx, n.cond) + ') exit'); ctx.ind--;
          line(ctx, 'end do');
          return;
        case 'for': {
          comment(ctx, n);
          const ct = tryTarget(n.counter);
          const k = target(ctx, n.counter);
          const from = ex(ctx, tryParse(n.from) || { k: 'num', v: 0, raw: '0' });
          const toAst = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          const to = ex(ctx, toAst, 5);
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          // echtes DO nur, wenn Zähler und Grenzen im Rumpf nicht verändert werden
          const inner = A.writtenNames(program, { body: n.body });
          const reads = new Set();
          // Array-Längen ändern sich durch Zuweisungen an Elemente nicht
          const collect = (x) => { if (!x) return; if (x.k === 'id') reads.add(x.name); if (x.k !== 'len') ['a', 'b', 'e', 'obj', 'index'].forEach((key) => collect(x[key])); };
          collect(toAst);
          const simple = typeof lit === 'number' && ct && ct.k === 'id' && !inner.has(ct.name) && ![...reads].some((r) => inner.has(r));
          if (simple) {
            line(ctx, 'do ' + k + ' = ' + from + ', ' + ex(ctx, toAst) + (lit === 1 ? '' : ', ' + lit));
            block(ctx, n.body);
            line(ctx, 'end do');
            return;
          }
          const s = stepAst ? ex(ctx, stepAst, 5) : '1';
          let c;
          if (typeof lit === 'number') c = k + (lit >= 0 ? ' <= ' : ' >= ') + to;
          else c = '(' + s + ' > 0 .and. ' + k + ' <= ' + to + ') .or. (' + s + ' < 0 .and. ' + k + ' >= ' + to + ')';
          line(ctx, k + ' = ' + from);
          line(ctx, 'do while (' + c + ')');
          block(ctx, n.body);
          ctx.ind++; line(ctx, k + ' = ' + k + (typeof lit === 'number' && lit < 0 ? ' - ' + (-lit) : ' + ' + s)); ctx.ind--;
          line(ctx, 'end do');
          return;
        }
        case 'switch': {
          comment(ctx, n);
          const sel = tryParse(n.expr);
          const vals = n.cases.map((c) => tryParse(c.value));
          const literal = vals.every((v) => v && (strip(v).k === 'num' || strip(v).k === 'str' || (strip(v).k === 'un' && strip(strip(v).a).k === 'num')));
          if (literal && sel) {
            line(ctx, 'select case (' + ex(ctx, strip(sel)) + ')');
            n.cases.forEach((c, i) => { line(ctx, 'case (' + ex(ctx, strip(vals[i])) + ')'); block(ctx, c.body); });
            if (n.else) { line(ctx, 'case default'); block(ctx, n.else); }
            line(ctx, 'end select');
            return;
          }
          const s = sel ? ex(ctx, strip(sel), 4) : '0';
          n.cases.forEach((c, i) => {
            line(ctx, (i ? 'else if (' : 'if (') + s + ' == ' + (vals[i] ? ex(ctx, strip(vals[i]), 5) : '0') + ') then');
            block(ctx, c.body);
          });
          if (n.else && n.else.length) {
            if (n.cases.length) { line(ctx, 'else'); block(ctx, n.else); } else genSeq(ctx, n.else);
          }
          if (n.cases.length) line(ctx, 'end if');
          return;
        }
        case 'call': {
          comment(ctx, n);
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, '! ' + (n.fn || '?') + '(…)'); return; }
          const args = callee.params.map((p, i) => {
            const src = n.args[i] || '';
            if (p.byRef || A.isArrayType(p.type)) return target(ctx, src);
            return valueFor(ctx, src, p.type);
          });
          const call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
          if (callee.returnType === 'void') { line(ctx, 'call ' + call); return; }
          if (n.target && n.target.trim()) {
            const tt = targetType(ctx, n.target);
            let v = call;
            if (tt === 'string' && callee.returnType !== 'string') { used.str = true; v = H.str + '(' + call + ')'; }
            line(ctx, target(ctx, n.target) + ' = ' + v);
          } else line(ctx, discard(ctx, callee.returnType) + ' = ' + call);
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    for (const fn of program.fns.filter((f) => !f.isMain)) genFunction(fn);
    genFunction(program.fns.find((f) => f.isMain));

    const helpers = [];
    const q = tr('genArgPrompt');
    const P = (...s) => helpers.push(...s);
    if (used.str) {
      P(IND + 'function ' + H.str + '(n) result(s)');
      P(IND + IND + 'integer, intent(in) :: n');
      P(IND + IND + 'character(len=:), allocatable :: s');
      P(IND + IND + 'character(len=24) :: puffer');
      P(IND + IND + "write (puffer, '(i0)') n");
      P(IND + IND + 's = trim(puffer)');
      P(IND + 'end function ' + H.str, '');
    }
    if (used.toNum) {
      P(IND + 'function ' + H.toNum + '(s) result(n)');
      P(IND + IND + 'character(len=*), intent(in) :: s');
      P(IND + IND + 'integer :: n, fehler');
      P(IND + IND + 'read (s, *, iostat=fehler) n');
      P(IND + IND + 'if (fehler /= 0) n = 0');
      P(IND + 'end function ' + H.toNum, '');
    }
    if (used.line) {
      P(IND + 'function ' + H.line + '(' + q + ', ende) result(zeile)');
      P(IND + IND + 'character(len=*), intent(in) :: ' + q);
      P(IND + IND + 'logical, intent(out), optional :: ende');
      P(IND + IND + 'character(len=:), allocatable :: zeile');
      P(IND + IND + 'character(len=100) :: puffer');
      P(IND + IND + 'integer :: anzahl, fehler');
      P(IND + IND + "write (*, '(a)', advance='no') " + q);
      P(IND + IND + "zeile = ''");
      P(IND + IND + 'do');
      P(IND + IND + IND + "read (*, '(a)', advance='no', size=anzahl, iostat=fehler) puffer");
      P(IND + IND + IND + 'zeile = zeile // puffer(1:anzahl)');
      P(IND + IND + IND + 'if (fehler /= 0) exit');
      P(IND + IND + 'end do');
      P(IND + IND + 'if (present(ende)) ende = fehler /= 0 .and. .not. is_iostat_eor(fehler)');
      P(IND + 'end function ' + H.line, '');
    }
    if (used.num) {
      P(IND + '! ' + tr('javaHelperNumDoc'));
      P(IND + 'function ' + H.num + '(' + q + ') result(n)');
      P(IND + IND + 'character(len=*), intent(in) :: ' + q);
      P(IND + IND + 'integer :: n, fehler');
      P(IND + IND + 'logical :: ende');
      P(IND + IND + 'character(len=:), allocatable :: zeile');
      P(IND + IND + 'do');
      P(IND + IND + IND + 'zeile = ' + H.line + '(' + q + ', ende)');
      P(IND + IND + IND + 'read (zeile, *, iostat=fehler) n');
      P(IND + IND + IND + 'if (fehler == 0 .and. len_trim(zeile) > 0) return');
      P(IND + IND + IND + 'if (ende) then');
      P(IND + IND + IND + IND + 'n = 0');
      P(IND + IND + IND + IND + 'return');
      P(IND + IND + IND + 'end if');
      P(IND + IND + IND + "print '(a)', " + fStr(tr('javaNeedInt')));
      P(IND + IND + 'end do');
      P(IND + 'end function ' + H.num, '');
    }

    const out = ['! ' + tr('fortHeader1'), '! ' + tr('fortHeader2'), 'program ' + progName, IND + 'implicit none'];
    if (used.text) out.push('', IND + '! ' + tr('fortTextType'), IND + 'type :: text', IND + IND + 'character(len=:), allocatable :: v', IND + 'end type text');
    out.push(...mainLines);
    if (procs.length || helpers.length) out.push('', 'contains', '', ...procs, ...helpers);
    while (out[out.length - 1] === '') out.pop();
    out.push('end program ' + progName);
    return out.join('\n') + '\n';
  }

  BBE.fortgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
