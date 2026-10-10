/* Blockbild-Editor – Übersetzung nach C++ (C++11 oder neuer)
 *
 *   Zahl → int, Text → string, Zahl[]/Text[] → vector<int>/vector<string> (Länge über .size())
 *   InOut-Parameter → Referenz (int& a) – C++ kennt echtes call by reference.
 *   Eingabe mit getline/cin, Ausgabe mit cout. Text + Zahl braucht to_string.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  // C++-Schlüsselwörter und Namen aus std, die wegen "using namespace std" kollidieren könnten
  const RESERVED = new Set(('alignas alignof and and_eq asm auto bitand bitor bool break case catch char class compl const constexpr ' +
    'const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto ' +
    'if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register ' +
    'reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw ' +
    'true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq main std string vector ' +
    'cout cin endl getline swap max min sort count find abs size begin end data move copy fill remove replace reverse search ' +
    'distance left right list map set array function exp log pow sqrt round stoi to_string').split(' '));
  const CT = { integer: 'int', string: 'string', 'integer[]': 'vector<int>', 'string[]': 'vector<string>' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const cStr = (s) => BBE.cgen.cString(s);

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { num: tr('javaHelperNum') };
    const used = { num: false };
    const fnName = new Map(program.fns.map((f) => [f.name, RESERVED.has(f.name) ? f.name + '_' : f.name]));
    const body = [];
    const protos = [];

    const defaultFor = (t) => (t === 'string' ? '""' : t === 'integer' ? '0' : '');
    const withComment = (code, n) => (n && n.comment ? code + '  // ' + n.comment.replace(/\s+/g, ' ') : code);
    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(n) ? n + '_' : n);
    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    function signature(fn, ctx) {
      if (fn.isMain) return 'int main()';
      const ret = fn.returnType === 'void' ? 'void' : CT[fn.returnType];
      const ps = fn.params.map((p) => {
        const n = name(ctx, p.name || 'p');
        if (A.isArrayType(p.type)) return CT[p.type] + '& ' + n;
        return CT[p.type] + (p.byRef ? '& ' : ' ') + n;
      });
      return ret + ' ' + fnName.get(fn.name) + '(' + ps.join(', ') + ')';
    }

    // ------------------------------------------------------------ Funktionen

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      for (const n of scope.keys()) rename.set(n, RESERVED.has(n) ? n + '_' : n);
      const ctx = { fn, scope, rename, ind: 1, lines: body, declared: new Set(fn.params.map((p) => p.name)), hoisted: new Set() };
      // Variablen gelten im Blockbild im ganzen Unterprogramm → verschachtelte/doppelte Deklarationen an den Anfang
      const top = new Set();
      for (const n of fn.body) if (n.kind === 'decl' && n.name && !top.has(n.name)) top.add(n.name);
      M.walkSeq(fn.body, (n, seq, i, depth) => { if (n.kind === 'decl' && n.name && (depth > 0 || !top.has(n.name))) ctx.hoisted.add(n.name); });

      const sig = signature(fn, ctx);
      if (!fn.isMain) protos.push(sig + ';');
      body.push(sig + ' {');
      if (!fn.isMain && fn.returnType !== 'void') {
        line(ctx, CT[fn.returnType] + ' result = ' + valueFor(ctx, fn.resultInit, fn.returnType) + ';');
        ctx.declared.add('result');
      }
      for (const n of ctx.hoisted) {
        const v = scope.get(n);
        if (!v || ctx.declared.has(n)) continue;
        const d = defaultFor(v.type);
        line(ctx, CT[v.type] + ' ' + name(ctx, n) + (d ? ' = ' + d : '') + ';');
        ctx.declared.add(n);
      }
      genSeq(ctx, fn.body);
      if (fn.isMain) line(ctx, 'return 0;');
      else if (fn.returnType !== 'void') line(ctx, 'return result;');
      body.push('}');
    }

    // ------------------------------------------------------------ Ausdrücke

    function ex(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': return cStr(a.v);
        case 'paren': return '(' + ex(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 9) + '[' + ex(ctx, a.index) + ']';
        case 'len': {
          const t = typeOf(ctx, a.obj);
          return '(int) ' + ex(ctx, a.obj, 9) + (A.isArrayType(t) ? '.size()' : '.length()');
        }
        case 'un':
          if (a.op === '!') return wrap('!' + ex(ctx, a.a, 7), 7);
          return wrap(a.op + (a.op === '-' && strip(a.a).k === 'un' ? ' ' : '') + ex(ctx, a.a, 7), 7);
        case 'bin': {
          const p = PREC[a.op];
          if (a.op === '+' && typeOf(ctx, a) === 'string') return wrap(textConcat(ctx, a), 5);
          const cmp = ['==', '!=', '<', '<=', '>', '>='].includes(a.op);
          if (cmp && (typeOf(ctx, a.a) === 'string' || typeOf(ctx, a.b) === 'string')) {
            // zwei Textliterale lassen sich nicht direkt vergleichen
            const l = strip(a.a).k === 'str' && strip(a.b).k === 'str' ? 'string(' + ex(ctx, a.a) + ')' : ex(ctx, a.a, p);
            return wrap(l + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p);
          }
          return wrap(ex(ctx, a.a, p) + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    /** Teile einer Text-Verkettung von links nach rechts. */
    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [ast];
    }

    /** Text-Verkettung: Zahlen über to_string, erstes Literal als string. */
    function textConcat(ctx, ast) {
      const list = parts(ctx, ast).map((p, i) => {
        const s = strip(p);
        if (s.k === 'str') return i === 0 ? 'string(' + cStr(s.v) + ')' : cStr(s.v);
        if (typeOf(ctx, p) === 'string') return ex(ctx, p, 6);
        return 'to_string(' + ex(ctx, p) + ')';
      });
      // zwei Literale hintereinander: zusammenfassen wäre schöner, so bleibt es aber korrekt
      return list.join(' + ');
    }

    function hasFloat(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
      return hit;
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || defaultFor(type) || '{}';
      const t = typeOf(ctx, ast);
      if (type === 'string' && t !== 'string') return 'to_string(' + ex(ctx, ast) + ')';
      if (type === 'integer' && t === 'string') return 'stoi(' + ex(ctx, ast) + ')';
      if (type === 'integer' && hasFloat(ast)) return '(int) (' + ex(ctx, ast) + ')';
      return ex(ctx, ast);
    }

    function cond(ctx, src) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || 'true';
      const s = strip(ast);
      if (typeOf(ctx, s) === 'string') return '!' + ex(ctx, s, 9) + '.empty()';
      return ex(ctx, s);
    }

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          line(ctx, '// ' + String(n.text || '').replace(/\n/g, ' '));
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          const declared = ctx.declared.has(n.name);
          if (n.vtype.endsWith('[]')) {
            const len = ex(ctx, tryParse(n.length) || { k: 'num', v: 0, raw: '0' });
            if (declared) line(ctx, withComment(nm + ' = ' + CT[n.vtype] + '(' + len + ');', n));
            else line(ctx, withComment(CT[n.vtype] + ' ' + nm + '(' + len + ');', n));
          } else {
            line(ctx, withComment((declared ? '' : CT[n.vtype] + ' ') + nm + ' = ' + valueFor(ctx, n.init, n.vtype) + ';', n));
          }
          ctx.declared.add(n.name);
          return;
        }
        case 'assign':
          line(ctx, withComment(target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, targetType(ctx, n.target)) + ';', n));
          return;
        case 'input': {
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? (typeOf(ctx, p) === 'string' ? ex(ctx, strip(p)) : 'to_string(' + ex(ctx, p) + ')') : '""';
          if (tt === 'integer') { used.num = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ');', n)); }
          else {
            if (prompt !== '""') line(ctx, withComment('cout << ' + coutParts(ctx, p).join(' << ') + ';', n));
            line(ctx, 'getline(cin, ' + target(ctx, n.target) + ');');
          }
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, withComment('cout << ' + (ast ? coutParts(ctx, ast).join(' << ') + ' << ' : '') + 'endl;', n));
          return;
        }
        case 'if':
          line(ctx, withComment('if (' + cond(ctx, n.cond) + ') {', n));
          block(ctx, n.then);
          if (n.else && n.else.length) {
            if (n.else.length === 1 && n.else[0].kind === 'if' && !n.else[0].comment) {
              const save = ctx.lines.length;
              ctx.lines.push('');
              genStmt(ctx, n.else[0]);
              const first = ctx.lines[save + 1];
              ctx.lines.splice(save, 2, IND.repeat(ctx.ind) + '} else ' + first.trim());
              return;
            }
            line(ctx, '} else {');
            block(ctx, n.else);
          }
          line(ctx, '}');
          return;
        case 'while':
          line(ctx, withComment('while (' + cond(ctx, n.cond) + ') {', n));
          block(ctx, n.body);
          line(ctx, '}');
          return;
        case 'until':
          line(ctx, withComment('do {', n));
          block(ctx, n.body);
          line(ctx, '} while (!(' + cond(ctx, n.cond) + '));');
          return;
        case 'for': {
          const k = target(ctx, n.counter);
          const from = ex(ctx, tryParse(n.from) || { k: 'num', v: 0, raw: '0' });
          const to = ex(ctx, tryParse(n.to) || { k: 'num', v: 0, raw: '0' });
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          let c, inc;
          if (typeof lit === 'number') {
            c = k + (lit >= 0 ? ' <= ' : ' >= ') + to;
            inc = lit === 1 ? k + '++' : lit === -1 ? k + '--' : lit > 0 ? k + ' += ' + lit : k + ' -= ' + (-lit);
          } else {
            const s = ex(ctx, stepAst);
            c = '(' + s + ' > 0 ? ' + k + ' <= ' + to + ' : ' + k + ' >= ' + to + ')';
            inc = k + ' += ' + s;
          }
          line(ctx, withComment('for (' + k + ' = ' + from + '; ' + c + '; ' + inc + ') {', n));
          block(ctx, n.body);
          line(ctx, '}');
          return;
        }
        case 'switch': {
          const sel = tryParse(n.expr);
          if (sel && typeOf(ctx, sel) === 'string') {
            // switch geht in C++ nur mit Zahlen → if / else if
            const s = ex(ctx, strip(sel), 3);
            n.cases.forEach((c, i) => {
              const v = tryParse(c.value);
              const test = s + ' == ' + (v ? ex(ctx, strip(v), 4) : '""');
              line(ctx, i === 0 ? withComment('if (' + test + ') {', n) : '} else if (' + test + ') {');
              block(ctx, c.body);
            });
            if (n.else && n.else.length) {
              if (!n.cases.length) { line(ctx, withComment('{', n)); block(ctx, n.else); line(ctx, '}'); return; }
              line(ctx, '} else {');
              block(ctx, n.else);
            }
            if (n.cases.length) line(ctx, '}');
            return;
          }
          line(ctx, withComment('switch (' + (sel ? ex(ctx, strip(sel)) : '0') + ') {', n));
          ctx.ind++;
          for (const c of n.cases) {
            const v = tryParse(c.value);
            line(ctx, 'case ' + (v ? ex(ctx, strip(v)) : '0') + ':');
            ctx.ind++; genSeq(ctx, c.body); line(ctx, 'break;'); ctx.ind--;
          }
          if (n.else) { line(ctx, 'default:'); ctx.ind++; genSeq(ctx, n.else); line(ctx, 'break;'); ctx.ind--; }
          ctx.ind--;
          line(ctx, '}');
          return;
        }
        case 'call': {
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, withComment('// ' + (n.fn || '?') + '(…)', n)); return; }
          const args = callee.params.map((p, i) => {
            const src = n.args[i] || '';
            if (A.isArrayType(p.type) || p.byRef) return target(ctx, src);
            return valueFor(ctx, src, p.type);
          });
          const call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
          if (callee.returnType !== 'void' && n.target && n.target.trim()) {
            const tt = targetType(ctx, n.target);
            line(ctx, withComment(target(ctx, n.target) + ' = ' + (tt === 'string' && callee.returnType !== 'string' ? 'to_string(' + call + ')' : call) + ';', n));
          } else line(ctx, withComment(call + ';', n));
          return;
        }
        default: return;
      }
    }

    /** Für cout: Verkettung in einzelne <<-Teile zerlegen (Zahlen brauchen dort kein to_string). */
    function coutParts(ctx, ast) {
      if (typeOf(ctx, ast) !== 'string') return [ex(ctx, ast, 6)];
      return parts(ctx, ast).map((p) => (strip(p).k === 'str' ? cStr(strip(p).v) : ex(ctx, p, 6)));
    }

    // ------------------------------------------------------------ Zusammenbau

    const mainFn = program.fns.find((f) => f.isMain);
    const subs = program.fns.filter((f) => !f.isMain);
    genFunction(mainFn);
    for (const fn of subs) { body.push(''); genFunction(fn); }

    const out = ['// ' + tr('cppHeader1'), '// ' + tr('cppHeader2'), '#include <iostream>', '#include <string>', '#include <vector>', '', 'using namespace std;', ''];
    if (protos.length) out.push(...protos, '');
    if (used.num) {
      const q = tr('genArgPrompt');
      out.push('// ' + tr('javaHelperNumDoc'));
      out.push('int ' + H.num + '(const string& ' + q + ') {');
      out.push(IND + 'while (true) {');
      out.push(IND + IND + 'cout << ' + q + ';');
      out.push(IND + IND + 'string zeile;');
      out.push(IND + IND + 'if (!getline(cin, zeile)) return 0;');
      out.push(IND + IND + 'try {');
      out.push(IND + IND + IND + 'return stoi(zeile);');
      out.push(IND + IND + '} catch (...) {');
      out.push(IND + IND + IND + 'cout << ' + cStr(tr('javaNeedInt')) + ' << endl;');
      out.push(IND + IND + '}');
      out.push(IND + '}');
      out.push('}', '');
    }
    out.push(...body);
    return out.join('\n') + '\n';
  }

  BBE.cppgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
