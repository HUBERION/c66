/* Blockbild-Editor – Ausdrücke: Tokenizer und Parser
 *
 * Unterstützte Sprache (wie im ursprünglichen Blockbild-Editor):
 *   Zahlen 12, 1.25 · Texte "abc" oder 'abc' · Variablen · a[i] · a.length
 *   + - * / %  · == != < <= > >= · && || ! · Klammern
 * Der Parser liefert einen Syntaxbaum, den Interpreter, Prüfung und C-Generator gemeinsam nutzen.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  class ExprError extends Error {
    constructor(key, args, pos) {
      super(key);
      this.key = key;
      this.args = args || [];
      this.pos = pos == null ? -1 : pos;
    }
  }

  const BINARY = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3,
    '<': 4, '<=': 4, '>': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6
  };

  const isIdStart = (c) => /[\p{L}_]/u.test(c);
  const isIdPart = (c) => /[\p{L}\p{N}_]/u.test(c);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }

      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        toks.push({ t: 'num', v: Number(m[0]), raw: m[0], pos: i });
        i += m[0].length;
        if (i < src.length && isIdStart(src[i])) throw new ExprError('exprBadNumber', [m[0] + src[i]], i);
        continue;
      }

      if (c === '"' || c === "'") {
        let j = i + 1, out = '';
        for (;;) {
          if (j >= src.length) throw new ExprError('exprUnterminatedString', [], i);
          const d = src[j];
          if (d === c) break;
          if (d === '\\' && j + 1 < src.length) {
            const e = src[j + 1];
            out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
            j += 2;
            continue;
          }
          out += d;
          j++;
        }
        toks.push({ t: 'str', v: out, raw: src.slice(i, j + 1), pos: i });
        i = j + 1;
        continue;
      }

      if (isIdStart(c)) {
        let j = i + 1;
        while (j < src.length && isIdPart(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j), pos: i });
        i = j;
        continue;
      }

      const two = src.substr(i, 2);
      if (two === '<>') throw new ExprError('exprUseNotEqual', [], i);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        toks.push({ t: 'op', v: two, pos: i });
        i += 2;
        continue;
      }
      if (two === '=<' || two === '=>') throw new ExprError('exprUseCompare', [two === '=<' ? '<=' : '>='], i);
      if ('+-*/%()[].,!<>='.includes(c)) {
        toks.push({ t: 'op', v: c, pos: i });
        i++;
        continue;
      }
      if (c === '&' || c === '|') throw new ExprError('exprDoubleOp', [c + c], i);
      throw new ExprError('exprUnexpectedChar', [c], i);
    }
    toks.push({ t: 'eof', pos: src.length });
    return toks;
  }

  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (v) => toks[p].t === 'op' && toks[p].v === v;

    function expect(v) {
      if (!isOp(v)) {
        const tk = peek();
        throw new ExprError(tk.t === 'eof' ? 'exprMissing' : 'exprExpected', [v, describe(tk)], tk.pos);
      }
      return next();
    }

    function parsePrimary() {
      const tk = next();
      if (tk.t === 'num') return { k: 'num', v: tk.v, raw: tk.raw, pos: tk.pos };
      if (tk.t === 'str') return { k: 'str', v: tk.v, pos: tk.pos };
      if (tk.t === 'id') return { k: 'id', name: tk.v, pos: tk.pos };
      if (tk.t === 'op' && tk.v === '(') {
        const e = parseBinary(0);
        expect(')');
        return { k: 'paren', e, pos: tk.pos };
      }
      if (tk.t === 'eof') throw new ExprError('exprIncomplete', [], tk.pos);
      throw new ExprError('exprUnexpectedToken', [describe(tk)], tk.pos);
    }

    function parsePostfix(e) {
      for (;;) {
        if (isOp('[')) {
          const tk = next();
          const index = parseBinary(0);
          expect(']');
          e = { k: 'idx', obj: e, index, pos: tk.pos };
        } else if (isOp('.')) {
          const tk = next();
          const name = next();
          if (name.t !== 'id' || name.v !== 'length') throw new ExprError('exprOnlyLength', [], tk.pos);
          e = { k: 'len', obj: e, pos: tk.pos };
        } else {
          return e;
        }
      }
    }

    function parseUnary() {
      const tk = peek();
      if (tk.t === 'op' && (tk.v === '!' || tk.v === '-' || tk.v === '+')) {
        next();
        return { k: 'un', op: tk.v, a: parseUnary(), pos: tk.pos };
      }
      return parsePostfix(parsePrimary());
    }

    function parseBinary(minPrec) {
      let left = parseUnary();
      for (;;) {
        const tk = peek();
        if (tk.t === 'op' && tk.v === '=') throw new ExprError('exprSingleEquals', [], tk.pos);
        if (tk.t !== 'op' || !(tk.v in BINARY)) return left;
        const prec = BINARY[tk.v];
        if (prec <= minPrec) return left;
        next();
        const right = parseBinary(prec);
        left = { k: 'bin', op: tk.v, a: left, b: right, pos: tk.pos };
      }
    }

    if (peek().t === 'eof') throw new ExprError('exprEmpty', [], 0);
    const ast = parseBinary(0);
    if (peek().t !== 'eof') {
      const tk = peek();
      if (tk.t === 'op' && tk.v === ',') throw new ExprError('exprComma', [], tk.pos);
      throw new ExprError('exprUnexpectedToken', [describe(tk)], tk.pos);
    }
    return ast;
  }

  function describe(tk) {
    if (tk.t === 'eof') return '…';
    if (tk.t === 'str') return tk.raw;
    if (tk.t === 'num') return tk.raw;
    return tk.v;
  }

  const cache = new Map();

  /** Parsed einen Ausdruck mit Cache. Wirft ExprError. */
  function parseCached(src) {
    const s = src == null ? '' : String(src);
    let entry = cache.get(s);
    if (!entry) {
      try { entry = { ast: parse(s) }; } catch (e) {
        if (!(e instanceof ExprError)) throw e;
        entry = { err: e };
      }
      if (cache.size > 4000) cache.clear();
      cache.set(s, entry);
    }
    if (entry.err) throw entry.err;
    return entry.ast;
  }

  /** Ziel einer Zuweisung: Variable oder Array-Element. */
  function parseTarget(src) {
    const ast = parseCached(src);
    if (ast.k === 'id') return ast;
    if (ast.k === 'idx' && ast.obj.k === 'id') return ast;
    throw new ExprError('exprNotAssignable', [String(src).trim()], 0);
  }

  function walk(ast, fn) {
    if (!ast) return;
    fn(ast);
    switch (ast.k) {
      case 'paren': walk(ast.e, fn); break;
      case 'idx': walk(ast.obj, fn); walk(ast.index, fn); break;
      case 'len': walk(ast.obj, fn); break;
      case 'un': walk(ast.a, fn); break;
      case 'bin': walk(ast.a, fn); walk(ast.b, fn); break;
    }
  }

  const strip = (ast) => (ast && ast.k === 'paren' ? strip(ast.e) : ast);

  const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
  const ASCII_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

  BBE.expr = { ExprError, tokenize, parse, parseCached, parseTarget, walk, strip, IDENT, ASCII_IDENT, BINARY };
})(typeof window !== 'undefined' ? window : globalThis);
