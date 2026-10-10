/* Blockbild-Editor – Übersetzung nach C# (ab .NET 6 / C# 10, läuft aber auch mit älteren Versionen)
 *
 *   Zahl → int, Text → string, Zahl[]/Text[] → int[]/string[] (Länge über .Length)
 *   InOut-Parameter → ref (Aufruf mit ref x) – C# kennt echtes call by reference.
 *   Eine Klasse Program mit statischen Methoden, Eingaben über Console.ReadLine.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  const RESERVED = new Set(('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double ' +
    'else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long ' +
    'namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof ' +
    'stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile ' +
    'while var dynamic value Main Console Array Program String Math').split(' '));
  const CT = { integer: 'int', string: 'string', 'integer[]': 'int[]', 'string[]': 'string[]' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const csStr = (s) => JSON.stringify(String(s));

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const cls = opts.className || 'Program';
    const H = { num: tr('csHelperNum') };
    const used = { num: false };
    const fnName = new Map(program.fns.map((f) => [f.name, RESERVED.has(f.name) ? f.name + '_' : f.name]));
    const body = [];

    const defaultFor = (t) => (t === 'string' ? '""' : t === 'integer[]' ? 'new int[0]' : t === 'string[]' ? 'new string[0]' : '0');
    const withComment = (code, n) => (n && n.comment ? code + '  // ' + n.comment.replace(/\s+/g, ' ') : code);
    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(n) ? n + '_' : n);
    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    // ------------------------------------------------------------ Methoden

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      for (const n of scope.keys()) rename.set(n, RESERVED.has(n) ? n + '_' : n);
      const ctx = { fn, scope, rename, ind: 2, lines: body, declared: new Set(fn.params.map((p) => p.name)), hoisted: new Set() };
      // C# verbietet, lokale Variablen in inneren Blöcken neu zu deklarieren → verschachtelte/doppelte an den Anfang
      const top = new Set();
      for (const n of fn.body) if (n.kind === 'decl' && n.name && !top.has(n.name)) top.add(n.name);
      M.walkSeq(fn.body, (n, seq, i, depth) => { if (n.kind === 'decl' && n.name && (depth > 0 || !top.has(n.name))) ctx.hoisted.add(n.name); });

      let sig;
      if (fn.isMain) sig = 'static void Main()';
      else {
        const ret = fn.returnType === 'void' ? 'void' : CT[fn.returnType];
        const ps = fn.params.map((p) => (p.byRef && !A.isArrayType(p.type) ? 'ref ' : '') + CT[p.type] + ' ' + name(ctx, p.name || 'p'));
        sig = 'static ' + ret + ' ' + fnName.get(fn.name) + '(' + ps.join(', ') + ')';
      }
      body.push(IND + sig);
      body.push(IND + '{');
      if (!fn.isMain && fn.returnType !== 'void') {
        line(ctx, CT[fn.returnType] + ' result = ' + valueFor(ctx, fn.resultInit, fn.returnType) + ';');
        ctx.declared.add('result');
      }
      for (const n of ctx.hoisted) {
        const v = scope.get(n);
        if (!v || ctx.declared.has(n)) continue;
        line(ctx, CT[v.type] + ' ' + name(ctx, n) + ' = ' + defaultFor(v.type) + ';');
        ctx.declared.add(n);
      }
      genSeq(ctx, fn.body);
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, 'return result;');
      body.push(IND + '}');
    }

    // ------------------------------------------------------------ Ausdrücke

    function ex(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': return csStr(a.v);
        case 'paren': return '(' + ex(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 9) + '[' + ex(ctx, a.index) + ']';
        case 'len': return ex(ctx, a.obj, 9) + '.Length';
        case 'un':
          if (a.op === '!') return wrap('!' + boolCode(ctx, a.a, 7), 7);
          return wrap(a.op + (a.op === '-' && strip(a.a).k === 'un' ? ' ' : '') + ex(ctx, a.a, 7), 7);
        case 'bin': {
          const p = PREC[a.op];
          if (a.op === '&&' || a.op === '||') return wrap(boolCode(ctx, a.a, p) + ' ' + a.op + ' ' + boolCode(ctx, a.b, p + 1), p);
          const cmp = ['<', '<=', '>', '>='].includes(a.op);
          if (cmp && (typeOf(ctx, a.a) === 'string' || typeOf(ctx, a.b) === 'string')) {
            return wrap('string.CompareOrdinal(' + ex(ctx, a.a) + ', ' + ex(ctx, a.b) + ') ' + a.op + ' 0', p);
          }
          // == und != vergleichen in C# auch Texte inhaltlich; Text + Zahl rechnet wie das Blockbild
          return wrap(ex(ctx, a.a, p) + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    /** Wert als bool (Zahlen ≠ 0 und nicht leere Texte gelten als wahr). */
    function boolCode(ctx, ast, minPrec = 0) {
      const t = typeOf(ctx, ast);
      if (t === 'integer') return '(' + ex(ctx, ast) + ' != 0)';
      if (t === 'string') return '(' + ex(ctx, ast) + '.Length > 0)';
      return ex(ctx, ast, minPrec);
    }

    function hasFloat(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
      return hit;
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || defaultFor(type);
      const t = typeOf(ctx, ast);
      if (type === 'string' && t !== 'string') return '"" + ' + ex(ctx, ast, 6);
      if (type === 'integer' && t === 'string') return 'int.Parse(' + ex(ctx, ast) + ')';
      if (type === 'integer' && hasFloat(ast)) return '(int) (' + ex(ctx, ast) + ')';
      return ex(ctx, ast);
    }

    function cond(ctx, src) {
      const ast = tryParse(src);
      return ast ? boolCode(ctx, strip(ast)) : (String(src || '').trim() || 'true');
    }

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          line(ctx, '// ' + String(n.text || '').replace(/\n/g, ' '));
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          let value;
          if (n.vtype.endsWith('[]')) value = 'new ' + (n.vtype === 'string[]' ? 'string' : 'int') + '[' + ex(ctx, tryParse(n.length) || { k: 'num', v: 0, raw: '0' }) + ']';
          else value = valueFor(ctx, n.init, n.vtype);
          line(ctx, withComment((ctx.declared.has(n.name) ? '' : CT[n.vtype] + ' ') + nm + ' = ' + value + ';', n));
          ctx.declared.add(n.name);
          if (n.vtype === 'string[]') line(ctx, 'Array.Fill(' + nm + ', "");');
          return;
        }
        case 'assign':
          line(ctx, withComment(target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, targetType(ctx, n.target)) + ';', n));
          return;
        case 'input': {
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? (typeOf(ctx, p) === 'string' ? ex(ctx, strip(p)) : '"" + ' + ex(ctx, p, 6)) : '""';
          if (tt === 'integer') { used.num = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ');', n)); }
          else {
            if (prompt !== '""') line(ctx, withComment('Console.Write(' + prompt + ');', n));
            line(ctx, target(ctx, n.target) + ' = Console.ReadLine() ?? "";');
          }
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, withComment('Console.WriteLine(' + (ast ? ex(ctx, strip(ast)) : '""') + ');', n));
          return;
        }
        case 'if':
          line(ctx, withComment('if (' + cond(ctx, n.cond) + ')', n));
          line(ctx, '{');
          block(ctx, n.then);
          line(ctx, '}');
          if (n.else && n.else.length) {
            if (n.else.length === 1 && n.else[0].kind === 'if' && !n.else[0].comment) {
              // SONST WENN → else if
              const save = ctx.lines.length;
              genStmt(ctx, n.else[0]);
              ctx.lines[save] = IND.repeat(ctx.ind) + 'else ' + ctx.lines[save].trim();
              return;
            }
            line(ctx, 'else');
            line(ctx, '{');
            block(ctx, n.else);
            line(ctx, '}');
          }
          return;
        case 'while':
          line(ctx, withComment('while (' + cond(ctx, n.cond) + ')', n));
          line(ctx, '{');
          block(ctx, n.body);
          line(ctx, '}');
          return;
        case 'until':
          line(ctx, withComment('do', n));
          line(ctx, '{');
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
          line(ctx, withComment('for (' + k + ' = ' + from + '; ' + c + '; ' + inc + ')', n));
          line(ctx, '{');
          block(ctx, n.body);
          line(ctx, '}');
          return;
        }
        case 'switch': {
          const sel = tryParse(n.expr);
          line(ctx, withComment('switch (' + (sel ? ex(ctx, strip(sel)) : '0') + ')', n));
          line(ctx, '{');
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
            if (A.isArrayType(p.type)) return target(ctx, src);
            if (p.byRef) return 'ref ' + target(ctx, src);
            return valueFor(ctx, src, p.type);
          });
          const call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
          if (callee.returnType !== 'void' && n.target && n.target.trim()) {
            const tt = targetType(ctx, n.target);
            line(ctx, withComment(target(ctx, n.target) + ' = ' + (tt === 'string' && callee.returnType !== 'string' ? '"" + ' : '') + call + ';', n));
          } else line(ctx, withComment(call + ';', n));
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    genFunction(program.fns.find((f) => f.isMain));
    for (const fn of program.fns.filter((f) => !f.isMain)) { body.push(''); genFunction(fn); }

    const out = ['// ' + tr('csHeader1'), '// ' + tr('csHeader2'), 'using System;', '', 'class ' + cls, '{'];
    out.push(...body);
    if (used.num) {
      const q = tr('genArgPrompt');
      out.push('');
      out.push(IND + '/// <summary>' + tr('javaHelperNumDoc') + '</summary>');
      out.push(IND + 'static int ' + H.num + '(string ' + q + ')');
      out.push(IND + '{');
      out.push(IND + IND + 'while (true)');
      out.push(IND + IND + '{');
      out.push(IND + IND + IND + 'Console.Write(' + q + ');');
      out.push(IND + IND + IND + 'string zeile = Console.ReadLine() ?? "";');
      out.push(IND + IND + IND + 'if (int.TryParse(zeile.Trim(), out int wert)) return wert;');
      out.push(IND + IND + IND + 'Console.WriteLine(' + csStr(tr('javaNeedInt')) + ');');
      out.push(IND + IND + '}');
      out.push(IND + '}');
    }
    out.push('}');
    return out.join('\n') + '\n';
  }

  BBE.csgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
