/* Blockbild-Editor – Übersetzung nach Java (ab Java 8)
 *
 *   Zahl → int, Text → String, Zahl[]/Text[] → int[]/String[] (Länge über .length)
 *   Eine Klasse mit statischen Methoden, Eingaben über Scanner.
 *   InOut-Zahlen/Texte: Java kennt kein call by reference für int/String – der Wert wird in ein
 *   Hilfs-Array mit einem Element verpackt und nach dem Aufruf zurückgeschrieben. Arrays werden
 *   in Java ohnehin geteilt.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  const RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
    'final finally float for goto if implements import instanceof int interface long native new package private protected public ' +
    'return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var ' +
    'record yield String System Scanner Arrays Math main args').split(' '));
  const JT = { integer: 'int', string: 'String', 'integer[]': 'int[]', 'string[]': 'String[]' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const jStr = (s) => JSON.stringify(String(s));

  /** Gültiger Klassenname aus dem Dateinamen, z. B. "beispiel-ggt" → "BeispielGgt". */
  function className(fileName) {
    const parts = String(fileName || 'Blockbild').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    let n = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('') || 'Blockbild';
    if (/^[0-9]/.test(n)) n = 'Programm' + n;
    return RESERVED.has(n) ? n + 'Programm' : n;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const cls = opts.className || className(opts.fileName);
    const H = { num: tr('javaHelperNum') };
    const used = { num: false, arrays: false, scanner: false, box: false };
    const fnName = new Map(program.fns.map((f) => [f.name, RESERVED.has(f.name) ? f.name + '_' : f.name]));
    const body = [];

    // run() wird am Ende von generate() aufgerufen, wenn alle Hilfsfunktionen definiert sind
    function run() {
    genFunction(program.fns.find((f) => f.isMain));
    for (const fn of program.fns.filter((f) => !f.isMain)) { body.push(''); genFunction(fn); }

    const out = ['/*', ' * ' + tr('javaHeader1'), ' * ' + tr('javaHeader2'), ' */'];
    if (used.scanner) out.push('import java.util.Scanner;');
    if (used.arrays) out.push('import java.util.Arrays;');
    if (used.scanner || used.arrays) out.push('');
    out.push('public class ' + cls + ' {');
    if (used.scanner) out.push('', IND + 'static Scanner ' + tr('javaScanner') + ' = new Scanner(System.in);');
    out.push('');
    out.push(...body);
    if (used.num) {
      const q = tr('genArgPrompt');
      out.push('');
      out.push(IND + '/** ' + tr('javaHelperNumDoc') + ' */');
      out.push(IND + 'static int ' + H.num + '(String ' + q + ') {');
      out.push(IND + IND + 'while (true) {');
      out.push(IND + IND + IND + 'System.out.print(' + q + ');');
      out.push(IND + IND + IND + 'String zeile = ' + tr('javaScanner') + '.nextLine().trim();');
      out.push(IND + IND + IND + 'try {');
      out.push(IND + IND + IND + IND + 'return Integer.parseInt(zeile);');
      out.push(IND + IND + IND + '} catch (NumberFormatException e) {');
      out.push(IND + IND + IND + IND + 'System.out.println(' + jStr(tr('javaNeedInt')) + ');');
      out.push(IND + IND + IND + '}');
      out.push(IND + IND + '}');
      out.push(IND + '}');
    }
    out.push('}');
    return out.join('\n') + '\n';
    }

    // ------------------------------------------------------------ Methoden

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      for (const name of scope.keys()) rename.set(name, RESERVED.has(name) ? name + '_' : name);
      const boxed = new Set(fn.params.filter((p) => p.byRef && !A.isArrayType(p.type)).map((p) => p.name));
      const ctx = { fn, scope, rename, boxed, ind: 2, lines: body, declared: new Set(fn.params.map((p) => p.name)), tmp: 0, hoisted: new Set() };

      // Deklarationen, die nicht direkt im Methodenrumpf stehen oder doppelt sind, kommen an den Anfang
      const top = new Set();
      for (const n of fn.body) if (n.kind === 'decl' && n.name && !top.has(n.name)) top.add(n.name);
      M.walkSeq(fn.body, (n, seq, i, depth) => {
        if (n.kind === 'decl' && n.name && (depth > 0 || !top.has(n.name))) ctx.hoisted.add(n.name);
      });

      let sig;
      if (fn.isMain) sig = 'public static void main(String[] args)';
      else {
        const ret = fn.returnType === 'void' ? 'void' : JT[fn.returnType];
        const ps = fn.params.map((p) => (boxed.has(p.name) ? JT[p.type] + '[]' : JT[p.type]) + ' ' + name(ctx, p.name || 'p'));
        sig = 'static ' + ret + ' ' + fnName.get(fn.name) + '(' + ps.join(', ') + ')';
      }
      if (boxed.size) body.push(IND + '/* ' + tr('javaBoxNote') + ' */');
      body.push(IND + sig + ' {');
      if (!fn.isMain && fn.returnType !== 'void') {
        line(ctx, JT[fn.returnType] + ' result = ' + valueFor(ctx, fn.resultInit, fn.returnType) + ';');
        ctx.declared.add('result');
      }
      for (const n of ctx.hoisted) {
        const v = scope.get(n);
        if (!v || ctx.declared.has(n)) continue;
        line(ctx, JT[v.type] + ' ' + name(ctx, n) + ' = ' + defaultFor(v.type) + ';');
        ctx.declared.add(n);
      }
      genSeq(ctx, fn.body);
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, 'return result;');
      body.push(IND + '}');
    }

    const defaultFor = (t) => (t === 'string' ? '""' : t === 'integer[]' ? 'new int[0]' : t === 'string[]' ? 'new String[0]' : '0');
    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    const withComment = (code, n) => (n && n.comment ? code + '  // ' + n.comment.replace(/\s+/g, ' ') : code);
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    // ------------------------------------------------------------ Ausdrücke

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(n) ? n + '_' : n);
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

    function ex(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': return jStr(a.v);
        case 'paren': return '(' + ex(ctx, a.e) + ')';
        case 'id': return ctx.boxed.has(a.name) ? name(ctx, a.name) + '[0]' : name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 9) + '[' + ex(ctx, a.index) + ']';
        case 'len': {
          const t = typeOf(ctx, a.obj);
          return ex(ctx, a.obj, 9) + (A.isArrayType(t) ? '.length' : '.length()');
        }
        case 'un':
          if (a.op === '!') return wrap('!' + boolCode(ctx, a.a, 7), 7);
          return wrap(a.op + (a.op === '-' && strip(a.a).k === 'un' ? ' ' : '') + ex(ctx, a.a, 7), 7);
        case 'bin': {
          const p = PREC[a.op];
          if (a.op === '&&' || a.op === '||') return wrap(boolCode(ctx, a.a, p) + ' ' + a.op + ' ' + boolCode(ctx, a.b, p + 1), p);
          const cmp = ['==', '!=', '<', '<=', '>', '>='].includes(a.op);
          if (cmp && (typeOf(ctx, a.a) === 'string' || typeOf(ctx, a.b) === 'string')) {
            const l = textCode(ctx, a.a), r = textCode(ctx, a.b);
            if (a.op === '==') return wrap(l + '.equals(' + r + ')', 9);
            if (a.op === '!=') return wrap('!' + l + '.equals(' + r + ')', 7);
            return wrap(l + '.compareTo(' + r + ') ' + a.op + ' 0', p);
          }
          // Java rechnet Text + Zahl von links nach rechts genauso wie das Blockbild
          return wrap(ex(ctx, a.a, p) + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    /** Wert als boolean (Zahlen ≠ 0 und nicht leere Texte gelten als wahr). */
    function boolCode(ctx, ast, minPrec = 0) {
      const t = typeOf(ctx, ast);
      if (t === 'integer') return '(' + ex(ctx, ast) + ' != 0)';
      if (t === 'string') return '!' + ex(ctx, ast, 9) + '.isEmpty()';
      return ex(ctx, ast, minPrec);
    }

    function textCode(ctx, ast) {
      if (typeOf(ctx, ast) === 'string') return ex(ctx, ast, 9);
      return 'String.valueOf(' + ex(ctx, ast) + ')';
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || defaultFor(type);
      const t = typeOf(ctx, ast);
      if (type === 'string' && t !== 'string') return '"" + ' + ex(ctx, ast, 6);
      if (type === 'integer' && t === 'string') return 'Integer.parseInt(' + ex(ctx, ast) + ')';
      // Kommazahlen (z. B. tg * 1.25) wie im C-Export auf int abschneiden
      if (type === 'integer' && hasFloat(ast)) return '(int) (' + ex(ctx, ast) + ')';
      return ex(ctx, ast);
    }

    function hasFloat(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
      return hit;
    }

    function cond(ctx, src) {
      const ast = tryParse(src);
      return ast ? boolCode(ctx, strip(ast)) : (String(src || '').trim() || 'true');
    }

    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          line(ctx, '// ' + String(n.text || '').replace(/\n/g, ' '));
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          const isArr = n.vtype.endsWith('[]');
          let value;
          if (isArr) {
            value = 'new ' + (n.vtype === 'string[]' ? 'String' : 'int') + '[' + ex(ctx, tryParse(n.length) || { k: 'num', v: 0, raw: '0' }) + ']';
          } else value = valueFor(ctx, n.init, n.vtype);
          const declared = ctx.declared.has(n.name);
          line(ctx, withComment((declared ? '' : JT[n.vtype] + ' ') + nm + ' = ' + value + ';', n));
          ctx.declared.add(n.name);
          if (n.vtype === 'string[]') { used.arrays = true; line(ctx, 'Arrays.fill(' + nm + ', "");'); }
          return;
        }
        case 'assign':
          line(ctx, withComment(target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, targetType(ctx, n.target)) + ';', n));
          return;
        case 'input': {
          used.scanner = true;
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? (typeOf(ctx, p) === 'string' ? ex(ctx, strip(p)) : '"" + ' + ex(ctx, p, 6)) : '""';
          if (tt === 'integer') { used.num = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ');', n)); }
          else {
            if (prompt !== '""') line(ctx, withComment('System.out.print(' + prompt + ');', n));
            line(ctx, target(ctx, n.target) + ' = ' + tr('javaScanner') + '.nextLine();');
          }
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, withComment('System.out.println(' + (ast ? ex(ctx, strip(ast)) : '""') + ');', n));
          return;
        }
        case 'if':
          line(ctx, withComment('if (' + cond(ctx, n.cond) + ') {', n));
          block(ctx, n.then);
          if (n.else && n.else.length) {
            if (n.else.length === 1 && n.else[0].kind === 'if' && !n.else[0].comment) {
              // SONST WENN → else if
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
        case 'call': return genCall(ctx, n);
        default: return;
      }
    }

    function genCall(ctx, n) {
      const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
      if (!callee) { line(ctx, withComment('// ' + (n.fn || '?') + '(…)', n)); return; }
      const before = [], after = [], args = [];
      callee.params.forEach((p, i) => {
        const src = n.args[i] || '';
        if (A.isArrayType(p.type)) { args.push(target(ctx, src)); return; }
        if (p.byRef) {
          // Wert in ein Array mit einem Element verpacken und danach zurückschreiben
          const t = tryTarget(src);
          if (t && t.k === 'id' && ctx.boxed.has(t.name)) { args.push(name(ctx, t.name)); return; }
          const box = 'box' + (++ctx.tmp);
          const code = target(ctx, src);
          before.push(JT[p.type] + '[] ' + box + ' = { ' + code + ' };');
          after.push(code + ' = ' + box + '[0];');
          args.push(box);
          return;
        }
        args.push(valueFor(ctx, src, p.type));
      });
      const call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
      before.forEach((s) => line(ctx, s));
      if (callee.returnType !== 'void' && n.target && n.target.trim()) {
        const tt = targetType(ctx, n.target);
        line(ctx, withComment(target(ctx, n.target) + ' = ' + (tt === 'string' && callee.returnType !== 'string' ? '"" + ' : '') + call + ';', n));
      } else line(ctx, withComment(call + ';', n));
      after.forEach((s) => line(ctx, s));
    }

    return run();
  }

  BBE.javagen = { generate, className };
})(typeof window !== 'undefined' ? window : globalThis);
