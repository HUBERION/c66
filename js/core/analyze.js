/* Blockbild-Editor – Gültigkeitsbereiche, Typen und Live-Prüfung
 *
 * Variablen gelten (wie im Original) im ganzen Unterprogramm: Deklarationen, Parameter und – bei
 * Funktionen mit Rückgabewert – die automatisch angelegte Variable "result".
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip, IDENT, ASCII_IDENT, ExprError } = BBE.expr;
  const M = BBE.model;

  const C_RESERVED = new Set(('auto break case char const continue default do double else enum extern float for goto if ' +
    'inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void ' +
    'volatile while _Bool _Complex _Imaginary bool true false NULL main printf scanf strcpy strcmp snprintf sprintf strlen memset').split(' '));

  const RESULT = 'result';

  /** Symboltabelle eines Unterprogramms: name -> { type, kind, byRef, id } */
  function scopeOf(fn) {
    const scope = new Map();
    for (const p of fn.params) {
      if (p.name && !scope.has(p.name)) scope.set(p.name, { type: p.type, kind: 'param', byRef: p.byRef || p.type.endsWith('[]'), id: p.id });
    }
    if (!fn.isMain && fn.returnType !== 'void') scope.set(RESULT, { type: fn.returnType, kind: 'result' });
    M.walkSeq(fn.body, (n) => {
      if (n.kind === 'decl' && n.name && !scope.has(n.name)) scope.set(n.name, { type: n.vtype, kind: 'decl', id: n.id });
    });
    return scope;
  }

  const isArrayType = (t) => typeof t === 'string' && t.endsWith('[]');
  const elemType = (t) => (isArrayType(t) ? t.slice(0, -2) : '?');

  /** Statischer Typ eines Ausdrucks: integer | string | bool | integer[] | string[] | ? */
  function typeOf(ast, scope) {
    switch (ast.k) {
      case 'num': return 'integer';
      case 'str': return 'string';
      case 'paren': return typeOf(ast.e, scope);
      case 'id': { const v = scope.get(ast.name); return v ? v.type : '?'; }
      case 'idx': return elemType(typeOf(ast.obj, scope));
      case 'len': return 'integer';
      case 'un': return ast.op === '!' ? 'bool' : 'integer';
      case 'bin': {
        if (ast.op === '+') {
          const a = typeOf(ast.a, scope), b = typeOf(ast.b, scope);
          if (a === 'string' || b === 'string') return 'string';
          if (a === '?' || b === '?') return '?';
          return 'integer';
        }
        if ('-*/%'.includes(ast.op)) return 'integer';
        return 'bool';
      }
      default: return '?';
    }
  }

  /** Name prüfen; liefert [key, args, severity] oder null. */
  function checkName(name) {
    if (!name) return ['pEmptyName', [], 'error'];
    if (!IDENT.test(name)) return ['pBadName', [name], 'error'];
    if (C_RESERVED.has(name)) return ['pReserved', [name], 'warn'];
    if (!ASCII_IDENT.test(name)) return ['pNonAscii', [name], 'warn'];
    return null;
  }

  function analyze(program) {
    const problems = [];
    const byKey = new Map();
    const scopes = new Map();
    const fnNames = new Map();

    const add = (sev, fnId, nodeId, field, key, args) => {
      const p = { sev, fnId, nodeId, field, key, args: args || [] };
      problems.push(p);
      const k = nodeId + ':' + field;
      const prev = byKey.get(k);
      if (!prev || (prev.sev === 'warn' && sev === 'error')) byKey.set(k, p);
    };

    for (const fn of program.fns) {
      if (fn.isMain) continue;
      const bad = checkName(fn.name);
      if (bad) add(bad[2], fn.id, fn.id, 'name', bad[0], bad[1]);
      else if (fnNames.has(fn.name)) add('error', fn.id, fn.id, 'name', 'pFnDuplicate', [fn.name]);
      if (fn.name === 'main') add('error', fn.id, fn.id, 'name', 'pReserved', ['main']);
      fnNames.set(fn.name, fn);
    }

    for (const fn of program.fns) {
      const scope = scopeOf(fn);
      scopes.set(fn.id, scope);

      // Parameter
      const seenParams = new Set();
      for (const p of fn.params) {
        const bad = checkName(p.name);
        if (bad) add(bad[2], fn.id, fn.id, 'param:' + p.id, bad[0], bad[1]);
        else if (seenParams.has(p.name)) add('error', fn.id, fn.id, 'param:' + p.id, 'pParamDuplicate', [p.name]);
        else if (p.name === RESULT && fn.returnType !== 'void') add('error', fn.id, fn.id, 'param:' + p.id, 'pResultReserved', []);
        seenParams.add(p.name);
      }
      if (!fn.isMain && fn.returnType !== 'void') {
        checkExpr(fn, scope, fn.id, 'resultInit', fn.resultInit, { required: true, target: fn.returnType });
      }

      const declared = new Set(fn.params.map((p) => p.name));
      M.walkSeq(fn.body, (n) => checkNode(fn, scope, n, declared));
    }

    function checkExpr(fn, scope, nodeId, field, src, opts = {}) {
      const text = src == null ? '' : String(src).trim();
      if (!text) {
        if (opts.required) add('error', fn.id, nodeId, field, 'pEmpty');
        return null;
      }
      let ast;
      try {
        ast = opts.lvalue ? parseTarget(text) : parseCached(text);
      } catch (e) {
        if (e instanceof ExprError) { add('error', fn.id, nodeId, field, e.key, e.args); return null; }
        throw e;
      }
      if (!checkRefs(fn, scope, nodeId, field, ast, opts.allowArray || opts.lvalue)) return null;
      const t = typeOf(ast, scope);
      if (opts.lvalue && isArrayType(t) && !opts.allowArray) add('error', fn.id, nodeId, field, 'pAssignArray');
      if (opts.target === 'integer' && t === 'string') add('warn', fn.id, nodeId, field, 'pTextToNumber');
      return { ast, type: t };
    }

    function checkRefs(fn, scope, nodeId, field, ast, allowArrayTop) {
      let ok = true;
      const visit = (a, arrayOk) => {
        switch (a.k) {
          case 'id': {
            const v = scope.get(a.name);
            if (!v) { add('error', fn.id, nodeId, field, 'pUnknownVar', [a.name]); ok = false; return; }
            if (isArrayType(v.type) && !arrayOk) { add('error', fn.id, nodeId, field, 'pArrayInExpr', [a.name]); ok = false; }
            return;
          }
          case 'paren': visit(a.e, arrayOk); return;
          case 'idx': {
            const t = typeOf(a.obj, scope);
            visit(a.obj, true);
            if (ok && !isArrayType(t)) { add('error', fn.id, nodeId, field, 'pNotArray', [exprText(a.obj)]); ok = false; }
            visit(a.index, false);
            return;
          }
          case 'len': {
            const t = typeOf(a.obj, scope);
            visit(a.obj, true);
            if (ok && !isArrayType(t) && t !== 'string' && t !== '?') { add('error', fn.id, nodeId, field, 'pLengthType'); ok = false; }
            return;
          }
          case 'un': visit(a.a, false); return;
          case 'bin': visit(a.a, false); visit(a.b, false); return;
          default: return;
        }
      };
      visit(ast, !!allowArrayTop);
      return ok;
    }

    function checkTargetVar(fn, scope, nodeId, field, src, opts = {}) {
      const r = checkExpr(fn, scope, nodeId, field, src, { required: true, lvalue: true, allowArray: opts.allowArray });
      return r;
    }

    function checkNode(fn, scope, n, declared) {
      const id = n.id;
      switch (n.kind) {
        case 'decl': {
          const bad = checkName(n.name);
          if (bad) add(bad[2], fn.id, id, 'name', bad[0], bad[1]);
          else if (n.name === RESULT && !fn.isMain && fn.returnType !== 'void') add('error', fn.id, id, 'name', 'pResultReserved');
          else if (fn.params.some((p) => p.name === n.name)) add('error', fn.id, id, 'name', 'pDeclParam', [n.name]);
          else if (declared.has(n.name)) add('warn', fn.id, id, 'name', 'pDuplicateDecl', [n.name]);
          if (n.name) declared.add(n.name);
          if (isArrayType(n.vtype)) checkExpr(fn, scope, id, 'length', n.length, { required: true, target: 'integer' });
          else checkExpr(fn, scope, id, 'init', n.init, { required: true, target: n.vtype });
          break;
        }
        case 'input':
          checkExpr(fn, scope, id, 'prompt', n.prompt, {});
          checkTargetVar(fn, scope, id, 'target', n.target);
          break;
        case 'output':
          checkExpr(fn, scope, id, 'expr', n.expr, { required: true });
          break;
        case 'assign': {
          const t = checkTargetVar(fn, scope, id, 'target', n.target);
          checkExpr(fn, scope, id, 'expr', n.expr, { required: true, target: t ? t.type : undefined });
          break;
        }
        case 'if': case 'while': case 'until':
          checkExpr(fn, scope, id, 'cond', n.cond, { required: true });
          break;
        case 'for': {
          const t = checkTargetVar(fn, scope, id, 'counter', n.counter);
          if (t && t.type !== 'integer' && t.type !== '?') add('error', fn.id, id, 'counter', 'pCounterType');
          checkExpr(fn, scope, id, 'from', n.from, { required: true, target: 'integer' });
          checkExpr(fn, scope, id, 'to', n.to, { required: true, target: 'integer' });
          const s = checkExpr(fn, scope, id, 'step', n.step, { required: true, target: 'integer' });
          if (s && literalValue(s.ast) === 0) add('error', fn.id, id, 'step', 'pStepZero');
          break;
        }
        case 'switch': {
          checkExpr(fn, scope, id, 'expr', n.expr, { required: true });
          const seen = new Set();
          for (const c of n.cases) {
            const r = checkExpr(fn, scope, id, 'case:' + c.id, c.value, { required: true });
            if (!r) continue;
            const lit = literalValue(r.ast);
            if (lit === undefined) add('warn', fn.id, id, 'case:' + c.id, 'pCaseLiteral');
            else if (seen.has(String(lit))) add('warn', fn.id, id, 'case:' + c.id, 'pCaseDuplicate', [String(lit)]);
            else seen.add(String(lit));
          }
          break;
        }
        case 'call': {
          if (!n.fn) { add('error', fn.id, id, 'fn', 'pNoFunction'); break; }
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { add('error', fn.id, id, 'fn', 'pUnknownFunction', [n.fn]); break; }
          if (callee.returnType !== 'void' && n.target) {
            const t = checkTargetVar(fn, scope, id, 'target', n.target);
            if (t && callee.returnType === 'string' && t.type === 'integer') add('warn', fn.id, id, 'target', 'pTextToNumber');
          }
          callee.params.forEach((p, i) => {
            const field = 'arg:' + i;
            const src = n.args[i];
            const isArr = isArrayType(p.type);
            if (isArr || p.byRef) {
              const r = checkExpr(fn, scope, id, field, src, { required: true, lvalue: true, allowArray: isArr });
              if (r && isArr && r.type !== p.type && r.type !== '?') add('error', fn.id, id, field, 'pArrayArg', [p.name || '?', typeLabelKey(p.type)]);
              if (r && !isArr && isArrayType(r.type)) add('error', fn.id, id, field, 'pAssignArray');
              if (r && !isArr && r.type !== p.type && r.type !== '?') add('warn', fn.id, id, field, 'pArgType', [p.name || '?']);
            } else {
              const r = checkExpr(fn, scope, id, field, src, { required: true, target: p.type });
              if (r && p.type === 'string' && r.type === 'integer') { /* Zahl wird zu Text – erlaubt */ }
            }
          });
          break;
        }
        default: break;
      }
    }

    const count = { error: 0, warn: 0 };
    problems.forEach((p) => count[p.sev]++);
    return { problems, byKey, scopes, count };
  }

  const typeLabelKey = (t) => t;

  /** Konstanter Wert eines Literals (auch -1, +1, "abc"), sonst undefined. */
  function literalValue(ast) {
    const a = strip(ast);
    if (!a) return undefined;
    if (a.k === 'num') return a.v;
    if (a.k === 'str') return a.v;
    if (a.k === 'un' && (a.op === '-' || a.op === '+')) {
      const inner = literalValue(a.a);
      if (typeof inner === 'number') return a.op === '-' ? -inner : inner;
    }
    return undefined;
  }

  /** Ausdruck als lesbarer Text (für Meldungen). */
  function exprText(ast) {
    switch (ast.k) {
      case 'num': return ast.raw;
      case 'str': return JSON.stringify(ast.v);
      case 'id': return ast.name;
      case 'paren': return '(' + exprText(ast.e) + ')';
      case 'idx': return exprText(ast.obj) + '[' + exprText(ast.index) + ']';
      case 'len': return exprText(ast.obj) + '.length';
      case 'un': return ast.op + exprText(ast.a);
      case 'bin': return exprText(ast.a) + ' ' + ast.op + ' ' + exprText(ast.b);
      default: return '?';
    }
  }

  /** Variablen, die in einem Unterprogramm beschrieben werden (für C: Kopie von Text-Parametern). */
  function writtenNames(program, fn) {
    const out = new Set();
    const nameOf = (src) => {
      try { const t = parseTarget(src); return t.k === 'id' ? t.name : t.obj.name; } catch (e) { return null; }
    };
    M.walkSeq(fn.body, (n) => {
      if (n.kind === 'assign' || n.kind === 'input') out.add(nameOf(n.target));
      if (n.kind === 'for') out.add(nameOf(n.counter));
      if (n.kind === 'call') {
        if (n.target) out.add(nameOf(n.target));
        const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
        if (callee) callee.params.forEach((p, i) => { if (p.byRef || isArrayType(p.type)) out.add(nameOf(n.args[i] || '')); });
      }
    });
    out.delete(null);
    return out;
  }

  BBE.analyze = { analyze, scopeOf, typeOf, literalValue, exprText, writtenNames, isArrayType, elemType, C_RESERVED, RESULT };
})(typeof window !== 'undefined' ? window : globalThis);
