/* Blockbild-Editor – Übersetzung nach JavaScript (Node.js; im Browser über prompt/console)
 *
 *   Rechnet exakt wie die Simulation (die selbst in JavaScript läuft): Zahlen sind Kommazahlen,
 *   Text + Zahl verkettet, == vergleicht wie im Blockbild.
 *   InOut-Zahlen/Texte: Rückgabe als Array und Zuweisung beim Aufruf:  [x, y] = tausche(x, y)
 *   Arrays werden ohnehin geteilt.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '  ';
  const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static ' +
    'implements interface package private protected public await arguments eval undefined NaN Infinity console process require ' +
    'main prompt Number String Array Math').split(' '));

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const jsStr = (s) => JSON.stringify(String(s));

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { num: tr('jsHelperNum'), text: tr('jsHelperText') };
    const R = tr('jsReadLine');
    // "prompt" würde im Browser die eingebaute Funktion prompt() verdecken
    const jsArg = tr('genArgPrompt') === 'prompt' ? 'question' : tr('genArgPrompt');
    const used = { num: false, text: false };
    const fnName = new Map(program.fns.map((f) => [f.name, RESERVED.has(f.name) ? f.name + '_' : f.name]));
    const body = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(n) ? n + '_' : n);
    const withComment = (code, n) => (n && n.comment ? code + '  // ' + n.comment.replace(/\s+/g, ' ') : code);
    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    const defaultFor = (t) => (t === 'string' ? '""' : t === 'integer' ? '0' : '[]');

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      for (const n of scope.keys()) rename.set(n, RESERVED.has(n) ? n + '_' : n);
      const outs = fn.params.filter((p) => p.byRef && !A.isArrayType(p.type));
      const ctx = { fn, scope, rename, ind: 1, lines: body, declared: new Set(fn.params.map((p) => p.name)), hoisted: new Set() };
      // let gilt nur im Block → verschachtelte/doppelte Deklarationen an den Anfang
      const top = new Set();
      for (const n of fn.body) if (n.kind === 'decl' && n.name && !top.has(n.name)) top.add(n.name);
      M.walkSeq(fn.body, (n, seq, i, depth) => { if (n.kind === 'decl' && n.name && (depth > 0 || !top.has(n.name))) ctx.hoisted.add(n.name); });

      const params = fn.params.map((p) => name(ctx, p.name || 'p'));
      body.push('function ' + (fn.isMain ? 'main' : fnName.get(fn.name)) + '(' + params.join(', ') + ') {');
      if (!fn.isMain && fn.returnType !== 'void') { line(ctx, 'let result = ' + valueFor(ctx, fn.resultInit, fn.returnType) + ';'); ctx.declared.add('result'); }
      const hoist = [];
      for (const n of ctx.hoisted) {
        const v = scope.get(n);
        if (!v || ctx.declared.has(n)) continue;
        hoist.push(name(ctx, n) + ' = ' + defaultFor(v.type));
        ctx.declared.add(n);
      }
      if (hoist.length) line(ctx, 'let ' + hoist.join(', ') + ';');
      genSeq(ctx, fn.body);
      if (!fn.isMain) {
        const ret = [];
        if (fn.returnType !== 'void') ret.push('result');
        outs.forEach((p) => ret.push(name(ctx, p.name)));
        if (ret.length === 1) line(ctx, 'return ' + ret[0] + ';');
        else if (ret.length > 1) line(ctx, 'return [' + ret.join(', ') + '];');
      }
      body.push('}');
    }

    function ex(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': return jsStr(a.v);
        case 'paren': return '(' + ex(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 9) + '[' + ex(ctx, a.index) + ']';
        case 'len': return ex(ctx, a.obj, 9) + '.length';
        case 'un': return wrap(a.op + (a.op === '-' && strip(a.a).k === 'un' ? ' ' : '') + ex(ctx, a.a, 7), 7);
        case 'bin': {
          const p = PREC[a.op];
          return wrap(ex(ctx, a.a, p) + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || defaultFor(type);
      const t = typeOf(ctx, ast);
      if (type === 'string' && t !== 'string') return 'String(' + ex(ctx, ast) + ')';
      if (type === 'integer' && t === 'string') return 'Number(' + ex(ctx, ast) + ')';
      return ex(ctx, ast);
    }

    const cond = (ctx, src) => { const ast = tryParse(src); return ast ? ex(ctx, strip(ast)) : 'true'; };

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment': line(ctx, '// ' + String(n.text || '').replace(/\n/g, ' ')); return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          const value = n.vtype.endsWith('[]')
            ? 'new Array(' + ex(ctx, tryParse(n.length) || { k: 'num', raw: '0' }) + ').fill(' + (n.vtype === 'string[]' ? '""' : '0') + ')'
            : valueFor(ctx, n.init, n.vtype);
          line(ctx, withComment((ctx.declared.has(n.name) ? '' : 'let ') + nm + ' = ' + value + ';', n));
          ctx.declared.add(n.name);
          return;
        }
        case 'assign':
          line(ctx, withComment(target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, targetType(ctx, n.target)) + ';', n));
          return;
        case 'input': {
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? ex(ctx, strip(p)) : '""';
          if (tt === 'integer') { used.num = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ');', n)); }
          else { used.text = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.text + '(' + prompt + ');', n)); }
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, withComment('console.log(' + (ast ? ex(ctx, strip(ast)) : '""') + ');', n));
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
          const from = ex(ctx, tryParse(n.from) || { k: 'num', raw: '0' });
          const to = ex(ctx, tryParse(n.to) || { k: 'num', raw: '0' });
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
        case 'call': {
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, withComment('// ' + (n.fn || '?') + '(…)', n)); return; }
          const args = callee.params.map((p, i) => {
            const src = n.args[i] || '';
            if (p.byRef || A.isArrayType(p.type)) return target(ctx, src);
            return valueFor(ctx, src, p.type);
          });
          const call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
          const lhs = [];
          const hasRes = callee.returnType !== 'void';
          if (hasRes) lhs.push(n.target && n.target.trim() ? target(ctx, n.target) : '');
          callee.params.forEach((p, i) => { if (p.byRef && !A.isArrayType(p.type)) lhs.push(target(ctx, n.args[i] || '')); });
          if (!lhs.length || (lhs.length === 1 && !lhs[0])) line(ctx, withComment(call + ';', n));
          else if (lhs.length === 1) line(ctx, withComment(lhs[0] + ' = ' + call + ';', n));
          else line(ctx, withComment('[' + lhs.join(', ') + '] = ' + call + ';', n));
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau
    for (const fn of program.fns.filter((f) => !f.isMain)) { genFunction(fn); body.push(''); }
    genFunction(program.fns.find((f) => f.isMain));

    const out = ['// ' + tr('jsHeader1'), '// ' + tr('jsHeader2'), "'use strict';", ''];
    if (used.num || used.text) {
      const q = jsArg;
      out.push('// ' + tr('jsHelperReadDoc'));
      out.push('function ' + R + '(' + q + ') {');
      out.push(IND + "if (typeof process === 'undefined') return prompt(" + q + ") ?? '';");
      out.push(IND + 'process.stdout.write(' + q + ');');
      out.push(IND + "const fs = require('fs');");
      out.push(IND + 'const buf = Buffer.alloc(1);');
      out.push(IND + 'let bytes = [];');
      out.push(IND + 'for (;;) {');
      out.push(IND + IND + 'let n = 0;');
      out.push(IND + IND + "try { n = fs.readSync(0, buf, 0, 1, null); } catch (e) { if (e.code === 'EAGAIN') continue; throw e; }");
      out.push(IND + IND + 'if (n === 0 || buf[0] === 10) break;');
      out.push(IND + IND + 'if (buf[0] !== 13) bytes.push(buf[0]);');
      out.push(IND + '}');
      out.push(IND + "return Buffer.from(bytes).toString('utf8');");
      out.push('}', '');
    }
    if (used.text) {
      const q = jsArg;
      out.push('function ' + H.text + '(' + q + ') {', IND + 'return ' + R + '(' + q + ');', '}', '');
    }
    if (used.num) {
      const q = jsArg;
      out.push('// ' + tr('javaHelperNumDoc'));
      out.push('function ' + H.num + '(' + q + ') {');
      out.push(IND + 'for (;;) {');
      out.push(IND + IND + 'const s = ' + R + '(' + q + ").trim().replace(',', '.');");
      out.push(IND + IND + "if (s !== '' && !Number.isNaN(Number(s))) return Number(s);");
      out.push(IND + IND + 'console.log(' + jsStr(tr('console.needNumber')) + ');');
      out.push(IND + '}');
      out.push('}', '');
    }
    out.push(...body, '', 'main();');
    return out.join('\n') + '\n';
  }

  BBE.jsgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
