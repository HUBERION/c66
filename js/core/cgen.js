/* Blockbild-Editor – Übersetzung nach C (C99)
 *
 *   Zahl            -> int                Text          -> char name[MAX_STRING_SIZE]
 *   Zahl[] / Text[] -> Array + nameSize    InOut (Zahl)  -> int *name
 *   Text-Ausdrücke mit + werden mit snprintf zusammengesetzt, Vergleiche mit strcmp.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  const MAXS = 'MAX_STRING_SIZE';

  function cString(s) {
    return '"' + String(s)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t') + '"';
  }

  /** Inhalt eines Formatstrings: bereits C-escaped, % verdoppelt. */
  const fmtLiteral = (s) => cString(s).slice(1, -1).replace(/%/g, '%%');
  const q = (escaped) => '"' + escaped + '"';

  function tryParse(src) {
    try { return parseCached(String(src || '').trim()); } catch (e) { return null; }
  }
  function tryTarget(src) {
    try { return parseTarget(String(src || '').trim()); } catch (e) { return null; }
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const out = [];
    const subs = program.fns.filter((f) => !f.isMain);

    out.push('/*');
    out.push(' * ' + tr('cHeader1'));
    out.push(' * ' + tr('cHeader2'));
    out.push(' */');
    out.push('#include <stdio.h>');
    out.push('#include <string.h>');
    out.push('');
    out.push('#define ' + MAXS + ' 255');
    out.push('');

    if (subs.length) {
      for (const fn of subs) out.push(signature(program, fn) + ';');
      out.push('');
    }

    for (const fn of program.fns) {
      genFunction(program, fn, out, tr);
      out.push('');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  // ------------------------------------------------------------------ Signaturen

  function paramInfo(program, fn) {
    const written = fn.isMain ? new Set() : A.writtenNames(program, fn);
    const info = new Map();
    for (const p of fn.params) {
      const isArr = A.isArrayType(p.type);
      info.set(p.name, {
        type: p.type,
        ptrInt: p.type === 'integer' && p.byRef && !isArr,
        textCopy: p.type === 'string' && !p.byRef && written.has(p.name)
      });
    }
    return info;
  }

  function signature(program, fn) {
    if (fn.isMain) return 'int main(void)';
    const info = paramInfo(program, fn);
    const ret = fn.returnType === 'integer' ? 'int ' : fn.returnType === 'string' ? 'char *' : 'void ';
    const ps = [];
    for (const p of fn.params) {
      const name = p.name || 'p';
      switch (p.type) {
        case 'integer': ps.push(p.byRef ? 'int *' + name : 'int ' + name); break;
        case 'string':
          if (p.byRef) ps.push('char *' + name);
          else ps.push('const char *' + name + (info.get(p.name).textCopy ? 'In' : ''));
          break;
        case 'integer[]': ps.push('int ' + name + '[]', 'int ' + name + 'Size'); break;
        case 'string[]': ps.push('char ' + name + '[][' + MAXS + ']', 'int ' + name + 'Size'); break;
        default: ps.push('int ' + name);
      }
    }
    return ret + (fn.name || 'unterprogramm') + '(' + (ps.length ? ps.join(', ') : 'void') + ')';
  }

  // ------------------------------------------------------------------ Funktionen

  function genFunction(program, fn, out, tr) {
    const scope = A.scopeOf(fn);
    const ctx = {
      program, fn, scope, out, tr,
      ind: 1, tmp: 0,
      params: paramInfo(program, fn),
      hoisted: new Set(),
      declaredInPlace: new Set()
    };

    // Deklarationen, die verschachtelt oder doppelt vorkommen, werden am Anfang angelegt
    const topNames = new Set();
    for (const n of fn.body) {
      if (n.kind === 'decl' && n.name && !topNames.has(n.name)) topNames.add(n.name);
    }
    const seen = new Set();
    M.walkSeq(fn.body, (n, seq, i, depth) => {
      if (n.kind !== 'decl' || !n.name) return;
      if (A.isArrayType(n.vtype)) return;
      if (depth > 0 && !topNames.has(n.name)) ctx.hoisted.add(n.name);
      seen.add(n.name);
    });

    // Größenvariablen nur anlegen, wenn .length verwendet oder das Array übergeben wird
    ctx.sizeUsed = new Set();
    const texts = [];
    M.walkSeq(fn.body, (n) => {
      for (const k of ['cond', 'expr', 'init', 'length', 'prompt', 'target', 'counter', 'from', 'to', 'step']) if (n[k]) texts.push(n[k]);
      if (n.kind === 'switch') n.cases.forEach((c) => texts.push(c.value));
      if (n.kind === 'call') {
        texts.push(...n.args);
        const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
        if (callee) callee.params.forEach((p, i) => { if (A.isArrayType(p.type)) ctx.sizeUsed.add(String(n.args[i] || '').trim()); });
      }
    });
    if (fn.resultInit) texts.push(fn.resultInit);
    M.walkSeq(fn.body, (n) => {
      if (n.kind === 'decl' && A.isArrayType(n.vtype) && n.name) {
        const re = new RegExp('(^|[^\\p{L}\\p{N}_])' + n.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\.\\s*length', 'u');
        if (texts.some((s) => re.test(s))) ctx.sizeUsed.add(n.name);
      }
    });

    out.push(signature(program, fn));
    out.push('{');

    for (const p of fn.params) {
      if (ctx.params.get(p.name).textCopy) {
        line(ctx, 'char ' + p.name + '[' + MAXS + '];');
        line(ctx, 'strcpy(' + p.name + ', ' + p.name + 'In);');
      }
    }

    if (!fn.isMain && fn.returnType !== 'void') {
      if (fn.returnType === 'integer') {
        const e = exprCode(ctx, tryParse(fn.resultInit), fn.resultInit);
        flushPre(ctx);
        line(ctx, 'int result = ' + e + ';');
      } else {
        line(ctx, 'static char result[' + MAXS + '];');
        storeText(ctx, 'result', 'result', tryParse(fn.resultInit), fn.resultInit);
      }
    }

    for (const name of ctx.hoisted) {
      const v = ctx.scope.get(name);
      if (!v) continue;
      line(ctx, v.type === 'string' ? 'char ' + name + '[' + MAXS + '] = "";' : 'int ' + name + ' = 0;');
    }

    genSeq(ctx, fn.body);

    if (fn.isMain) line(ctx, 'return 0;');
    else if (fn.returnType !== 'void') line(ctx, 'return result;');
    out.push('}');
  }

  function line(ctx, s) {
    ctx.out.push(IND.repeat(ctx.ind) + s);
  }

  const withComment = (code, n) => (n.comment ? code + '  // ' + n.comment.replace(/\s+/g, ' ') : code);

  function genSeq(ctx, seq) {
    for (const n of seq) genStmt(ctx, n);
  }

  // ------------------------------------------------------------------ Ausdrücke

  const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');

  function isText(ctx, ast) { return typeOf(ctx, ast) === 'string'; }

  /** Teile einer Text-Verkettung von links nach rechts. */
  function concatParts(ctx, ast) {
    const a = strip(ast);
    if (a.k === 'bin' && a.op === '+' && isText(ctx, a)) return concatParts(ctx, a.a).concat(concatParts(ctx, a.b));
    return [ast];
  }

  /** Formatstring + Argumente für printf/snprintf. */
  function format(ctx, ast) {
    let fmt = '';
    const args = [];
    for (const part of concatParts(ctx, ast)) {
      const p = strip(part);
      if (p.k === 'str') { fmt += fmtLiteral(p.v); continue; }
      if (isText(ctx, part)) { fmt += '%s'; args.push(exprCode(ctx, part)); continue; }
      fmt += '%d';
      args.push(exprCode(ctx, part));
    }
    return { fmt, args };
  }

  const isConcat = (ctx, ast) => { const a = strip(ast); return a.k === 'bin' && a.op === '+' && isText(ctx, a); };

  /** Text-Ausdruck, der als `const char *` verwendbar ist (Verkettungen landen in einem Hilfspuffer). */
  function textOperand(ctx, ast) {
    if (isConcat(ctx, ast) || !isText(ctx, ast)) {
      const name = 'tmp' + (++ctx.tmp);
      const f = format(ctx, ast);
      ctx.pre = ctx.pre || [];
      ctx.pre.push('char ' + name + '[' + MAXS + '];');
      ctx.pre.push('snprintf(' + name + ', ' + MAXS + ', ' + q(f.fmt) + joinArgs(f.args) + ');');
      return name;
    }
    return exprCode(ctx, ast);
  }

  const joinArgs = (args) => (args.length ? ', ' + args.join(', ') : '');

  function flushPre(ctx) {
    if (!ctx.pre) return;
    for (const s of ctx.pre) line(ctx, s);
    ctx.pre = null;
  }

  function exprCode(ctx, ast, fallback) {
    if (!ast) return fallback != null && String(fallback).trim() ? String(fallback).trim() : '0';
    switch (ast.k) {
      case 'num': return ast.raw;
      case 'str': return cString(ast.v);
      case 'paren': return '(' + exprCode(ctx, ast.e) + ')';
      case 'id': return ctx.params.has(ast.name) && ctx.params.get(ast.name).ptrInt ? '*' + ast.name : ast.name;
      case 'idx': return exprCode(ctx, ast.obj) + '[' + exprCode(ctx, ast.index) + ']';
      case 'len': {
        const t = typeOf(ctx, ast.obj);
        if (A.isArrayType(t) && strip(ast.obj).k === 'id') return strip(ast.obj).name + 'Size';
        return '(int)strlen(' + exprCode(ctx, ast.obj) + ')';
      }
      case 'un': {
        const inner = exprCode(ctx, ast.a);
        return ast.op + (ast.op === '-' && inner.startsWith('-') ? ' ' : '') + inner;
      }
      case 'bin': {
        const cmp = ['==', '!=', '<', '<=', '>', '>='].includes(ast.op);
        if (cmp && (isText(ctx, ast.a) || isText(ctx, ast.b))) {
          return 'strcmp(' + textOperand(ctx, ast.a) + ', ' + textOperand(ctx, ast.b) + ') ' + ast.op + ' 0';
        }
        if (ast.op === '+' && isText(ctx, ast)) return textOperand(ctx, ast);
        return exprCode(ctx, ast.a) + ' ' + ast.op + ' ' + exprCode(ctx, ast.b);
      }
      default: return '0';
    }
  }

  /** Ziel einer Zuweisung als C-Ausdruck. */
  function targetCode(ctx, t, src) {
    if (!t) return String(src || '').trim() || '/* ? */';
    return exprCode(ctx, t);
  }

  function baseName(t) {
    if (!t) return null;
    return t.k === 'id' ? t.name : (t.obj && t.obj.name) || null;
  }

  function usesName(ast, name) {
    let hit = false;
    BBE.expr.walk(ast, (a) => { if (a.k === 'id' && a.name === name) hit = true; });
    return hit;
  }

  /** Text in ein char-Array schreiben. */
  function storeText(ctx, target, base, ast, src, n) {
    if (!ast) { line(ctx, withComment('strcpy(' + target + ', ' + (String(src || '').trim() || '""') + ');', n || {})); return; }
    const a = strip(ast);
    if (a.k === 'str' || (isText(ctx, ast) && !isConcat(ctx, ast))) {
      const code = exprCode(ctx, ast);
      flushPre(ctx);
      line(ctx, withComment('strcpy(' + target + ', ' + code + ');', n || {}));
      return;
    }
    const f = format(ctx, ast);
    flushPre(ctx);
    if (base && usesName(ast, base)) {
      const tmp = 'tmp' + (++ctx.tmp);
      line(ctx, withComment('char ' + tmp + '[' + MAXS + '];', n || {}));
      line(ctx, 'snprintf(' + tmp + ', ' + MAXS + ', ' + q(f.fmt) + joinArgs(f.args) + ');');
      line(ctx, 'strcpy(' + target + ', ' + tmp + ');');
    } else {
      line(ctx, withComment('snprintf(' + target + ', ' + MAXS + ', ' + q(f.fmt) + joinArgs(f.args) + ');', n || {}));
    }
  }

  // ------------------------------------------------------------------ Anweisungen

  function cond(ctx, src) {
    const ast = tryParse(src);
    return exprCode(ctx, ast ? strip(ast) : null, src || '1');
  }

  function genStmt(ctx, n) {
    switch (n.kind) {
      case 'comment':
        line(ctx, '/* ' + String(n.text || '').replace(/\*\//g, '* /') + ' */');
        return;

      case 'decl': return genDecl(ctx, n);

      case 'assign': {
        const t = tryTarget(n.target);
        const tType = t ? typeOf(ctx, t) : '?';
        const ast = tryParse(n.expr);
        if (tType === 'string') {
          storeText(ctx, targetCode(ctx, t, n.target), baseName(t), ast, n.expr, n);
          return;
        }
        const e = exprCode(ctx, ast, n.expr);
        const tc = targetCode(ctx, t, n.target);
        flushPre(ctx);
        line(ctx, withComment(tc + ' = ' + e + ';', n));
        return;
      }

      case 'input': {
        const t = tryTarget(n.target);
        const tType = t ? typeOf(ctx, t) : '?';
        const p = tryParse(n.prompt);
        let first = true;
        const emit = (s) => { line(ctx, first ? withComment(s, n) : s); first = false; };
        if (p) {
          const f = format(ctx, p);
          flushPre(ctx);
          if (f.fmt || f.args.length) emit('printf(' + q(f.fmt) + joinArgs(f.args) + ');');
        }
        const tc = targetCode(ctx, t, n.target);
        if (tType === 'string') {
          emit('scanf(" %' + 254 + '[^\\n]", ' + tc + ');');
        } else {
          const ptr = t && t.k === 'id' && ctx.params.has(t.name) && ctx.params.get(t.name).ptrInt;
          emit('scanf("%d", ' + (ptr ? t.name : '&' + tc) + ');');
        }
        return;
      }

      case 'output': {
        const ast = tryParse(n.expr);
        if (!ast) { line(ctx, withComment('printf("%s\\n", ' + (n.expr || '""') + ');', n)); return; }
        const f = format(ctx, ast);
        flushPre(ctx);
        line(ctx, withComment('printf(' + q(f.fmt + '\\n') + joinArgs(f.args) + ');', n));
        return;
      }

      case 'if': {
        const c = cond(ctx, n.cond);
        flushPre(ctx);
        line(ctx, withComment('if (' + c + ') {', n));
        block(ctx, n.then);
        if (n.else && n.else.length) {
          line(ctx, '} else {');
          block(ctx, n.else);
        }
        line(ctx, '}');
        return;
      }

      case 'while': {
        const c = cond(ctx, n.cond);
        if (ctx.pre) {
          const pre = ctx.pre; ctx.pre = null;
          line(ctx, withComment('while (1) {', n));
          ctx.ind++;
          pre.forEach((s) => line(ctx, s));
          line(ctx, 'if (!(' + c + ')) break;');
          genSeq(ctx, n.body);
          ctx.ind--;
          line(ctx, '}');
          return;
        }
        line(ctx, withComment('while (' + c + ') {', n));
        block(ctx, n.body);
        line(ctx, '}');
        return;
      }

      case 'until': {
        const c = cond(ctx, n.cond);
        if (ctx.pre) {
          // Bedingung braucht Hilfspuffer: als Schleife mit Abbruch am Ende formulieren
          const pre = ctx.pre; ctx.pre = null;
          line(ctx, withComment('for (;;) {', n));
          ctx.ind++;
          genSeq(ctx, n.body);
          pre.forEach((s) => line(ctx, s));
          line(ctx, 'if (' + c + ') break;');
          ctx.ind--;
          line(ctx, '}');
          return;
        }
        line(ctx, withComment('do {', n));
        block(ctx, n.body);
        line(ctx, '} while (!(' + c + '));');
        return;
      }

      case 'for': {
        const t = tryTarget(n.counter);
        const k = targetCode(ctx, t, n.counter);
        const from = exprCode(ctx, tryParse(n.from), n.from);
        const to = exprCode(ctx, tryParse(n.to), n.to);
        const stepAst = tryParse(n.step);
        const lit = stepAst ? A.literalValue(stepAst) : 1;
        const kk = k.startsWith('*') ? '(' + k + ')' : k;
        let condCode, inc;
        if (typeof lit === 'number') {
          condCode = k + (lit >= 0 ? ' <= ' : ' >= ') + to;
          inc = lit === 1 ? kk + '++' : lit === -1 ? kk + '--' : lit > 0 ? k + ' += ' + lit : k + ' -= ' + (-lit);
        } else {
          const s = exprCode(ctx, stepAst, n.step);
          condCode = '(' + s + ' > 0 ? ' + k + ' <= ' + to + ' : ' + k + ' >= ' + to + ')';
          inc = k + ' += ' + s;
        }
        flushPre(ctx);
        line(ctx, withComment('for (' + k + ' = ' + from + '; ' + condCode + '; ' + inc + ') {', n));
        block(ctx, n.body);
        line(ctx, '}');
        return;
      }

      case 'switch': {
        const sel = tryParse(n.expr);
        if (sel && isText(ctx, sel)) {
          const s = textOperand(ctx, sel);
          flushPre(ctx);
          const vals = n.cases.map((c) => textOperand(ctx, tryParse(c.value) || { k: 'str', v: c.value }));
          flushPre(ctx);
          let first = true;
          for (const [ci, c] of n.cases.entries()) {
            const test = 'strcmp(' + s + ', ' + vals[ci] + ') == 0) {';
            line(ctx, first ? withComment('if (' + test, n) : '} else if (' + test);
            block(ctx, c.body);
            first = false;
          }
          if (n.else && n.else.length) {
            if (first) { line(ctx, withComment('{', n)); block(ctx, n.else); line(ctx, '}'); return; }
            line(ctx, '} else {');
            block(ctx, n.else);
          }
          if (!first) line(ctx, '}');
          return;
        }
        const e = exprCode(ctx, sel, n.expr);
        flushPre(ctx);
        line(ctx, withComment('switch (' + e + ') {', n));
        ctx.ind++;
        for (const c of n.cases) {
          line(ctx, 'case ' + exprCode(ctx, tryParse(c.value), c.value) + ':');
          ctx.ind++;
          genSeq(ctx, c.body);
          line(ctx, 'break;');
          ctx.ind--;
        }
        if (n.else) {
          line(ctx, 'default:');
          ctx.ind++;
          genSeq(ctx, n.else);
          line(ctx, 'break;');
          ctx.ind--;
        }
        ctx.ind--;
        line(ctx, '}');
        return;
      }

      case 'call': return genCall(ctx, n);
      default: return;
    }
  }

  function block(ctx, seq) {
    ctx.ind++;
    genSeq(ctx, seq);
    ctx.ind--;
  }

  function genDecl(ctx, n) {
    const name = n.name || 'variable';
    if (n.vtype === 'integer[]' || n.vtype === 'string[]') {
      const lenAst = tryParse(n.length);
      const lit = lenAst ? A.literalValue(lenAst) : undefined;
      const len = exprCode(ctx, lenAst, n.length || '1');
      flushPre(ctx);
      const withSize = ctx.sizeUsed.has(name);
      if (withSize) line(ctx, withComment('int ' + name + 'Size = ' + len + ';', n));
      const dimExpr = typeof lit === 'number' ? String(lit) : withSize ? name + 'Size' : len;
      const dims = '[' + dimExpr + ']' + (n.vtype === 'string[]' ? '[' + MAXS + ']' : '');
      const base = n.vtype === 'string[]' ? 'char ' : 'int ';
      const first = (s) => (withSize ? s : withComment(s, n));
      if (typeof lit === 'number') {
        line(ctx, first(base + name + dims + ' = ' + (n.vtype === 'string[]' ? '{""}' : '{0}') + ';'));
      } else {
        line(ctx, first(base + name + dims + ';'));
        line(ctx, 'memset(' + name + ', 0, sizeof ' + name + ');');
      }
      return;
    }

    const ast = tryParse(n.init);
    const hoisted = ctx.hoisted.has(name) || ctx.declaredInPlace.has(name);
    if (n.vtype === 'string') {
      if (hoisted) { storeText(ctx, name, name, ast, n.init, n); return; }
      ctx.declaredInPlace.add(name);
      const a = ast && strip(ast);
      if (a && a.k === 'str' && a === ast) {
        line(ctx, withComment('char ' + name + '[' + MAXS + '] = ' + cString(a.v) + ';', n));
        return;
      }
      line(ctx, withComment('char ' + name + '[' + MAXS + '];', n));
      storeText(ctx, name, name, ast, n.init);
      return;
    }
    const e = exprCode(ctx, ast, n.init);
    flushPre(ctx);
    if (hoisted) { line(ctx, withComment(name + ' = ' + e + ';', n)); return; }
    ctx.declaredInPlace.add(name);
    line(ctx, withComment('int ' + name + ' = ' + e + ';', n));
  }

  function genCall(ctx, n) {
    const callee = ctx.program.fns.find((f) => !f.isMain && f.name === n.fn);
    if (!callee) { line(ctx, withComment('/* ' + (n.fn || '?') + '(...) */', n)); return; }
    const args = [];
    callee.params.forEach((p, i) => {
      const src = n.args[i] || '';
      if (A.isArrayType(p.type)) {
        const t = tryTarget(src);
        const nm = baseName(t) || src.trim() || '/* ? */';
        args.push(nm, nm + 'Size');
        return;
      }
      if (p.byRef) {
        const t = tryTarget(src);
        if (p.type === 'string') { args.push(targetCode(ctx, t, src)); return; }
        if (t && t.k === 'id' && ctx.params.has(t.name) && ctx.params.get(t.name).ptrInt) { args.push(t.name); return; }
        args.push('&' + targetCode(ctx, t, src));
        return;
      }
      const ast = tryParse(src);
      if (p.type === 'string' && ast) { args.push(textOperand(ctx, ast)); return; }
      args.push(exprCode(ctx, ast, src));
    });
    const callCode = callee.name + '(' + args.join(', ') + ')';
    const t = n.target ? tryTarget(n.target) : null;
    flushPre(ctx);
    if (callee.returnType === 'void' || !n.target) { line(ctx, withComment(callCode + ';', n)); return; }
    const tc = targetCode(ctx, t, n.target);
    if (callee.returnType === 'string') line(ctx, withComment('strcpy(' + tc + ', ' + callCode + ');', n));
    else line(ctx, withComment(tc + ' = ' + callCode + ';', n));
  }

  BBE.cgen = { generate, cString };
})(typeof window !== 'undefined' ? window : globalThis);
