/* Blockbild-Editor – Python → Blockbild
 *
 * Übersetzt die im Unterricht übliche Teilmenge von Python in ein Blockbild (.bb-Format):
 *   Zuweisungen, input()/int(input()), print(), if/elif/else, while, while True … break (→ WIEDERHOLE … BIS),
 *   for … in range(…), for x in liste, match/case, def mit return, Listen ([0] * n, [1, 2, 3]), len(),
 *   f-Strings, Kommentare. Was nicht passt, wird als markierter Kommentar übernommen.
 * Ergebnis: { bb, warnings: [{ line, key, args }] }
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  class PyError extends Error {
    constructor(key, args, line) { super(key); this.key = key; this.args = args || []; this.line = line; }
  }

  // ================================================================ Tokenizer

  const OPS3 = ['**=', '//=', '...', '>>=', '<<='];
  const OPS2 = ['==', '!=', '<=', '>=', '//', '**', '+=', '-=', '*=', '/=', '%=', '->', ':=', '<<', '>>', '&=', '|=', '^='];
  const OPS1 = '+-*/%()[]{},:.=<>@~^&|;';

  function tokenize(src) {
    const s = String(src).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const toks = [];
    const indents = [0];
    let i = 0, line = 1, depth = 0, atStart = true;
    const push = (t, v, extra) => toks.push(Object.assign({ t, v, line }, extra));
    const lastIs = (t) => toks.length && toks[toks.length - 1].t === t;

    while (i < s.length) {
      if (atStart && depth === 0) {
        let col = 0;
        while (s[i] === ' ' || s[i] === '\t') { col = s[i] === '\t' ? col + 8 - (col % 8) : col + 1; i++; }
        if (i >= s.length) break;
        if (s[i] === '\n') { i++; line++; continue; }
        if (s[i] === '#') {
          let j = i;
          while (j < s.length && s[j] !== '\n') j++;
          push('comment', s.slice(i + 1, j).trim(), { col });
          i = j;
          continue;
        }
        if (col > indents[indents.length - 1]) { indents.push(col); push('indent'); }
        while (col < indents[indents.length - 1]) { indents.pop(); push('dedent'); }
        if (col !== indents[indents.length - 1]) throw new PyError('pyIndent', [], line);
        atStart = false;
      }
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\f') { i++; continue; }
      if (c === '\\' && s[i + 1] === '\n') { i += 2; line++; continue; }
      if (c === '\n') {
        i++;
        if (depth === 0) { if (!lastIs('newline') && toks.length) push('newline'); atStart = true; }
        line++;
        continue;
      }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }

      // Zeichenketten (mit Präfix r, f, b, u)
      const pm = /^([rRbBfFuU]{0,2})(['"])/.exec(s.slice(i, i + 3));
      if (pm && (pm[1] === '' || /^[rRbBfFuU]+$/.test(pm[1]))) {
        const prefix = pm[1].toLowerCase();
        const q = pm[2];
        let j = i + pm[1].length;
        const triple = s.substr(j, 3) === q + q + q;
        j += triple ? 3 : 1;
        const startLine = line;
        let raw = '';
        for (;;) {
          if (j >= s.length) throw new PyError('pyString', [], startLine);
          const d = s[j];
          if (d === '\\' && !prefix.includes('r')) { raw += d + (s[j + 1] || ''); if (s[j + 1] === '\n') line++; j += 2; continue; }
          if (triple ? s.substr(j, 3) === q + q + q : d === q) break;
          if (d === '\n') { if (!triple) throw new PyError('pyString', [], startLine); line++; }
          raw += d;
          j++;
        }
        j += triple ? 3 : 1;
        const value = prefix.includes('r') ? raw : unescape(raw);
        toks.push({ t: prefix.includes('f') ? 'fstr' : 'str', v: value, raw, line: startLine, triple });
        i = j;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(\d[\d_]*)?\.?\d[\d_]*([eE][+-]?\d+)?j?|\d[\d_]*\.)/.exec(s.slice(i));
        const rawNum = m[0].replace(/_/g, '');
        push('num', rawNum);
        i += m[0].length;
        continue;
      }
      if (/[\p{L}_]/u.test(c)) {
        let j = i + 1;
        while (j < s.length && /[\p{L}\p{N}_]/u.test(s[j])) j++;
        push('name', s.slice(i, j));
        i = j;
        continue;
      }
      const three = s.substr(i, 3), two = s.substr(i, 2);
      if (OPS3.includes(three)) { push('op', three); i += 3; continue; }
      if (OPS2.includes(two)) { push('op', two); i += 2; continue; }
      if (OPS1.includes(c)) {
        if ('([{'.includes(c)) depth++;
        if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
        push('op', c);
        i++;
        continue;
      }
      throw new PyError('pyChar', [c], line);
    }
    if (toks.length && !lastIs('newline')) push('newline');
    while (indents.length > 1) { indents.pop(); push('dedent'); }
    push('eof');
    return toks;
  }

  function unescape(raw) {
    return raw.replace(/\\(\n|[\\'"abfnrtv0]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (m, e) => {
      if (e === '\n') return '';
      const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', 0: '\0' };
      if (e in map) return map[e];
      return String.fromCharCode(parseInt(e.slice(1), 16));
    });
  }

  // ================================================================ Parser

  function parse(src) {
    const toks = tokenize(src);
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    let p = 0;
    const peek = (o = 0) => toks[p + o];
    const next = () => toks[p++];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    const isName = (v) => peek().t === 'name' && peek().v === v;
    const eat = (v) => { if (isOp(v) || isName(v)) return next(); return null; };
    const expect = (v) => {
      const tk = eat(v);
      if (!tk) throw new PyError('pyExpected', [v, describe(peek())], peek().line);
      return tk;
    };
    const srcLine = (n) => (lines[n - 1] || '').trim();

    function block() {
      // nach ':' – entweder einzeilig oder eingerückter Block
      if (peek().t !== 'newline') {
        const st = simpleStmts();
        return st;
      }
      next();
      const body = [];
      while (peek().t === 'comment') body.push(commentStmt());
      if (peek().t !== 'indent') throw new PyError('pyIndentExpected', [], peek().line);
      next();
      while (peek().t !== 'dedent' && peek().t !== 'eof') body.push(...statement());
      if (peek().t === 'dedent') next();
      return body;
    }

    function commentStmt() {
      const tk = next();
      return { k: 'comment', text: tk.v, line: tk.line };
    }

    function statement() {
      const tk = peek();
      if (tk.t === 'comment') return [commentStmt()];
      if (tk.t === 'newline') { next(); return []; }
      if (tk.t === 'indent') throw new PyError('pyIndent', [], tk.line);
      if (tk.t === 'name') {
        switch (tk.v) {
          case 'if': return [ifStmt()];
          case 'while': return [whileStmt()];
          case 'for': return [forStmt()];
          case 'def': return [defStmt()];
          case 'match': if (peek(1).t !== 'op' || peek(1).v === '(' ) { const m = tryMatch(); if (m) return [m]; } break;
          case 'class': case 'try': case 'with': case 'async': case 'lambda': return [skipCompound()];
          default: break;
        }
        if (tk.v === '@') return [skipCompound()];
      }
      if (tk.t === 'op' && tk.v === '@') return [skipCompound()];
      const save = p;
      try {
        return simpleStmts();
      } catch (e) {
        // nicht unterstützter Ausdruck: nur diese Zeile überspringen
        if (!(e instanceof PyError) || !['pyLambda', 'pyWalrus', 'pyComplex', 'pyFString'].includes(e.key)) throw e;
        p = save;
        const line = peek().line;
        while (peek().t !== 'newline' && peek().t !== 'eof') next();
        if (peek().t === 'newline') next();
        return [{ k: 'unsupported', line, text: srcLine(line), reason: e.key }];
      }
    }

    function skipCompound() {
      const line = peek().line;
      const text = srcLine(line);
      const kw = peek().v;
      // bis zum Ende des Blocks überspringen – samt except/else/finally bei try
      const skipBlock = () => {
        let d = 0;
        while (peek().t !== 'eof') {
          const t = next();
          if (t.t === 'indent') d++;
          if (t.t === 'dedent') { d--; if (d <= 0) break; }
          if (t.t === 'newline' && d === 0 && peek().t !== 'indent') break;
        }
      };
      skipBlock();
      while (peek().t === 'name' && (peek().v === 'except' || peek().v === 'finally' || (kw === 'try' && peek().v === 'else'))) skipBlock();
      return { k: 'unsupported', line, text };
    }

    function simpleStmts() {
      const out = [];
      for (;;) {
        out.push(smallStmt());
        if (!eat(';')) break;
        if (peek().t === 'newline') break;
      }
      if (peek().t === 'newline') next();
      else if (peek().t !== 'eof' && peek().t !== 'dedent') throw new PyError('pyUnexpected', [describe(peek())], peek().line);
      return out;
    }

    function smallStmt() {
      const tk = peek();
      const line = tk.line;
      if (tk.t === 'name') {
        switch (tk.v) {
          case 'pass': next(); return { k: 'pass', line };
          case 'break': next(); return { k: 'break', line };
          case 'continue': next(); return { k: 'continue', line };
          case 'return': {
            next();
            const value = peek().t === 'newline' || isOp(';') ? null : exprList();
            return { k: 'return', value, line };
          }
          case 'import': case 'from': case 'global': case 'nonlocal': case 'assert': case 'del': case 'raise': case 'yield': {
            while (peek().t !== 'newline' && peek().t !== 'eof' && !isOp(';')) next();
            return { k: tk.v === 'import' || tk.v === 'from' ? 'import' : (tk.v === 'global' || tk.v === 'nonlocal' ? 'skip' : 'unsupported'), line, text: srcLine(line) };
          }
          default: break;
        }
      }
      const first = exprList();
      if (isOp('=')) {
        const targets = [first];
        let value;
        while (eat('=')) {
          value = exprList();
          if (isOp('=')) targets.push(value);
        }
        return { k: 'assign', targets, value, line };
      }
      if (peek().t === 'op' && /^(\+|-|\*|\/|\/\/|%|\*\*)=$/.test(peek().v)) {
        const op = next().v.slice(0, -1);
        return { k: 'aug', target: first, op, value: exprList(), line };
      }
      if (isOp(':')) {
        next();
        const ann = ternary();
        let value = null;
        if (eat('=')) value = exprList();
        return value ? { k: 'assign', targets: [first], value, ann, line } : { k: 'annotation', target: first, ann, line };
      }
      return { k: 'expr', value: first, line };
    }

    function ifStmt() {
      const line = next().line;
      const test = namedExpr();
      expect(':');
      const body = block();
      let orelse = [];
      while (peek().t === 'comment' && peek(1) && peek(1).t === 'name' && (peek(1).v === 'elif' || peek(1).v === 'else')) next();
      if (isName('elif')) {
        orelse = [ifStmt()];
      } else if (isName('else')) {
        next();
        expect(':');
        orelse = block();
      }
      return { k: 'if', test, body, orelse, line };
    }

    function whileStmt() {
      const line = next().line;
      const test = namedExpr();
      expect(':');
      const body = block();
      let orelse = null;
      if (isName('else')) { next(); expect(':'); orelse = block(); }
      return { k: 'while', test, body, orelse, line };
    }

    function forStmt() {
      const line = next().line;
      const target = targetList();
      expect('in');
      const iter = exprList();
      expect(':');
      const body = block();
      let orelse = null;
      if (isName('else')) { next(); expect(':'); orelse = block(); }
      return { k: 'for', target, iter, body, orelse, line };
    }

    function targetList() {
      const first = arith();
      if (!isOp(',')) return first;
      const elts = [first];
      while (eat(',')) { if (isName('in')) break; elts.push(arith()); }
      return { k: 'tuple', elts };
    }

    function defStmt() {
      const line = next().line;
      const name = next();
      if (name.t !== 'name') throw new PyError('pyExpected', ['name', describe(name)], line);
      expect('(');
      const params = [];
      while (!isOp(')')) {
        if (isOp('*') || isOp('**') || isOp('/')) { next(); if (peek().t === 'name') next(); eat(','); continue; }
        const pn = next();
        let ann = null, def = null;
        if (eat(':')) ann = ternary();
        if (eat('=')) def = ternary();
        params.push({ name: pn.v, ann, def });
        if (!eat(',')) break;
      }
      expect(')');
      let returns = null;
      if (eat('->')) returns = ternary();
      expect(':');
      const body = block();
      return { k: 'def', name: name.v, params, returns, body, line };
    }

    function tryMatch() {
      // "match" ist nur ein weiches Schlüsselwort
      const save = p;
      const line = next().line;
      try {
        const subject = namedExpr();
        if (!isOp(':')) { p = save; return null; }
        next();
        if (peek().t !== 'newline') { p = save; return null; }
        next();
        while (peek().t === 'comment') next();
        if (peek().t !== 'indent') { p = save; return null; }
        next();
        const cases = [];
        while (isName('case')) {
          next();
          const patterns = [pattern()];
          while (eat('|')) patterns.push(pattern());
          let guard = null;
          if (eat('if')) guard = namedExpr();
          expect(':');
          cases.push({ patterns, guard, body: block() });
          while (peek().t === 'comment') next();
        }
        if (peek().t === 'dedent') next();
        return { k: 'match', subject, cases, line };
      } catch (e) {
        p = save;
        return null;
      }
    }

    function pattern() {
      if (isName('_')) { next(); return { k: 'wild' }; }
      return orExpr();
    }

    // ---------------------------------------------------------- Ausdrücke

    function exprList() {
      const first = namedExpr();
      if (!isOp(',')) return first;
      const elts = [first];
      while (eat(',')) {
        if (peek().t === 'newline' || isOp('=') || isOp(')') || isOp(';')) break;
        elts.push(namedExpr());
      }
      return { k: 'tuple', elts };
    }

    function namedExpr() {
      const e = ternary();
      if (isOp(':=')) throw new PyError('pyWalrus', [], peek().line);
      return e;
    }

    function ternary() {
      if (isName('lambda')) throw new PyError('pyLambda', [], peek().line);
      const a = orExpr();
      if (isName('if') ) {
        const save = p;
        next();
        const test = orExpr();
        if (!eat('else')) { p = save; return a; }
        const b = ternary();
        return { k: 'ifexp', test, body: a, orelse: b };
      }
      return a;
    }

    function orExpr() {
      let a = andExpr();
      while (isName('or')) { next(); a = { k: 'boolop', op: 'or', a, b: andExpr() }; }
      return a;
    }
    function andExpr() {
      let a = notExpr();
      while (isName('and')) { next(); a = { k: 'boolop', op: 'and', a, b: notExpr() }; }
      return a;
    }
    function notExpr() {
      if (isName('not')) { next(); return { k: 'not', a: notExpr() }; }
      return comparison();
    }
    function comparison() {
      const left = arith();
      const ops = [], rights = [];
      for (;;) {
        let op = null;
        if (peek().t === 'op' && ['<', '>', '==', '>=', '<=', '!='].includes(peek().v)) op = next().v;
        else if (isName('in')) { next(); op = 'in'; }
        else if (isName('not') && peek(1).t === 'name' && peek(1).v === 'in') { next(); next(); op = 'not in'; }
        else if (isName('is')) { next(); op = eat('not') ? 'is not' : 'is'; }
        if (!op) break;
        ops.push(op);
        rights.push(arith());
      }
      return ops.length ? { k: 'cmp', left, ops, rights } : left;
    }
    function arith() {
      let a = term();
      while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; a = { k: 'bin', op, a, b: term() }; }
      return a;
    }
    function term() {
      let a = factor();
      while (peek().t === 'op' && ['*', '/', '//', '%', '@'].includes(peek().v)) { const op = next().v; a = { k: 'bin', op, a, b: factor() }; }
      return a;
    }
    function factor() {
      if (peek().t === 'op' && (peek().v === '-' || peek().v === '+' || peek().v === '~')) { const op = next().v; return { k: 'un', op, a: factor() }; }
      return power();
    }
    function power() {
      const a = atomExpr();
      if (eat('**')) return { k: 'bin', op: '**', a, b: factor() };
      return a;
    }
    function atomExpr() {
      let e = atom();
      for (;;) {
        if (isOp('(')) {
          next();
          const args = [], kwargs = {};
          while (!isOp(')')) {
            if (peek().t === 'name' && peek(1).t === 'op' && peek(1).v === '=') {
              const k = next().v; next();
              kwargs[k] = namedExpr();
            } else {
              if (isOp('*') || isOp('**')) next();
              const a = namedExpr();
              if (isName('for')) { comprehensionSkip(); args.push({ k: 'comp' }); break; }
              args.push(a);
            }
            if (!eat(',')) break;
          }
          expect(')');
          e = { k: 'call', func: e, args, kwargs };
        } else if (isOp('[')) {
          next();
          let index;
          if (isOp(':')) { index = sliceRest(null); } else {
            index = namedExpr();
            if (isOp(':')) index = sliceRest(index);
          }
          expect(']');
          e = { k: 'sub', value: e, index };
        } else if (isOp('.')) {
          next();
          const n = next();
          e = { k: 'attr', value: e, name: n.v };
        } else {
          return e;
        }
      }
    }
    function sliceRest(lower) {
      next();
      let upper = null;
      if (!isOp(']') && !isOp(':')) upper = namedExpr();
      if (eat(':') && !isOp(']')) namedExpr();
      return { k: 'slice', lower, upper };
    }
    function comprehensionSkip() {
      let d = 0;
      while (peek().t !== 'eof') {
        if (peek().t === 'op' && '([{'.includes(peek().v)) d++;
        if (peek().t === 'op' && ')]}'.includes(peek().v)) { if (d === 0) return; d--; }
        next();
      }
    }
    function atom() {
      const tk = next();
      switch (tk.t) {
        case 'num': {
          if (/j$/.test(tk.v)) throw new PyError('pyComplex', [], tk.line);
          let raw = tk.v;
          if (/^0[xXbBoO]/.test(raw)) raw = String(Number(raw));
          if (raw.endsWith('.')) raw = raw.slice(0, -1);
          return { k: 'num', v: Number(raw), raw };
        }
        case 'str': case 'fstr': {
          let parts = [tk];
          while (peek().t === 'str' || peek().t === 'fstr') parts.push(next());
          if (parts.every((x) => x.t === 'str')) return { k: 'str', v: parts.map((x) => x.v).join('') };
          return { k: 'fstr', parts: parts.flatMap((x) => (x.t === 'str' ? [x.v] : fstringParts(x, tk.line))) };
        }
        case 'name':
          if (tk.v === 'True') return { k: 'bool', v: true };
          if (tk.v === 'False') return { k: 'bool', v: false };
          if (tk.v === 'None') return { k: 'none' };
          return { k: 'name', id: tk.v };
        case 'op':
          if (tk.v === '(') {
            if (eat(')')) return { k: 'tuple', elts: [] };
            const e = namedExpr();
            if (isName('for')) { comprehensionSkip(); expect(')'); return { k: 'comp' }; }
            if (isOp(',')) {
              const elts = [e];
              while (eat(',')) { if (isOp(')')) break; elts.push(namedExpr()); }
              expect(')');
              return { k: 'tuple', elts };
            }
            expect(')');
            return { k: 'paren', e };
          }
          if (tk.v === '[') {
            const elts = [];
            while (!isOp(']')) {
              const e = namedExpr();
              if (isName('for')) { comprehensionSkip(); expect(']'); return { k: 'comp' }; }
              elts.push(e);
              if (!eat(',')) break;
            }
            expect(']');
            return { k: 'list', elts };
          }
          if (tk.v === '{') {
            let d = 1;
            while (d && peek().t !== 'eof') { const t = next(); if (t.t === 'op' && t.v === '{') d++; if (t.t === 'op' && t.v === '}') d--; }
            return { k: 'dict' };
          }
          break;
        default: break;
      }
      throw new PyError('pyUnexpected', [describe(tk)], tk.line);
    }

    function fstringParts(tk, line) {
      // f"…{ausdruck[:format]}…" → Teile: Text | Ausdruck
      const raw = tk.triple ? tk.v : tk.v;
      const out = [];
      let i = 0, buf = '';
      while (i < raw.length) {
        const c = raw[i];
        if (c === '{' && raw[i + 1] === '{') { buf += '{'; i += 2; continue; }
        if (c === '}' && raw[i + 1] === '}') { buf += '}'; i += 2; continue; }
        if (c === '{') {
          if (buf) { out.push(buf); buf = ''; }
          let d = 1, j = i + 1, inner = '';
          while (j < raw.length && d) {
            if (raw[j] === '{') d++;
            if (raw[j] === '}') { d--; if (!d) break; }
            inner += raw[j];
            j++;
          }
          // Formatangabe / Konvertierung abtrennen
          let depth2 = 0, cut = inner.length;
          for (let k = 0; k < inner.length; k++) {
            const ch = inner[k];
            if ('([{'.includes(ch)) depth2++;
            if (')]}'.includes(ch)) depth2--;
            if (depth2 === 0 && (ch === ':' || (ch === '!' && inner[k + 1] !== '='))) { cut = k; break; }
          }
          const exprSrc = inner.slice(0, cut).trim().replace(/=$/, '');
          const sub = parse(exprSrc).body;
          const st = sub[0];
          if (!st || st.k !== 'expr') throw new PyError('pyFString', [], line);
          out.push(st.value);
          i = j + 1;
          continue;
        }
        buf += c;
        i++;
      }
      if (buf) out.push(buf);
      return out;
    }

    const body = [];
    while (peek().t !== 'eof') {
      if (peek().t === 'dedent') { next(); continue; }
      body.push(...statement());
    }
    return { body, lines };
  }

  function describe(tk) {
    if (!tk) return '…';
    if (tk.t === 'newline') return '⏎';
    if (tk.t === 'eof') return '…';
    if (tk.t === 'indent' || tk.t === 'dedent') return '⇥';
    if (tk.t === 'str' || tk.t === 'fstr') return '"' + tk.v + '"';
    return String(tk.v);
  }

  // ================================================================ Übersetzung

  const S = (...st) => ({ type: 'Statements', statements: st });
  const DEFAULT = { integer: '0', string: '""' };
  const PY_TYPES = { int: 'integer', float: 'integer', bool: 'integer', str: 'string' };

  function annType(a) {
    if (!a) return null;
    if (a.k === 'name') return PY_TYPES[a.id] || (a.id === 'list' ? 'integer[]' : null);
    if (a.k === 'sub' && a.value.k === 'name' && (a.value.id === 'list' || a.value.id === 'List')) {
      const inner = annType(a.index);
      return inner && !inner.endsWith('[]') ? inner + '[]' : 'integer[]';
    }
    if (a.k === 'str') return annType({ k: 'name', id: a.v });
    return null;
  }

  const isArray = (t) => typeof t === 'string' && t.endsWith('[]');
  const strip = (e) => (e && e.k === 'paren' ? strip(e.e) : e);
  const isCallTo = (e, name) => { const x = strip(e); return x && x.k === 'call' && x.func.k === 'name' && x.func.id === name; };

  /** Stark vereinfachte Typableitung für Python-Ausdrücke. */
  function pyType(e, scope, fns) {
    e = strip(e);
    if (!e) return '?';
    switch (e.k) {
      case 'num': case 'bool': return 'integer';
      case 'str': case 'fstr': return 'string';
      case 'name': return scope.get(e.id) || '?';
      case 'list': {
        if (!e.elts.length) return 'integer[]';
        const t = pyType(e.elts[0], scope, fns);
        return (t === 'string' ? 'string' : 'integer') + '[]';
      }
      case 'bin': {
        if (e.op === '*' && (strip(e.a).k === 'list' || strip(e.b).k === 'list')) return pyType(strip(e.a).k === 'list' ? e.a : e.b, scope, fns);
        if (e.op === '+') {
          const a = pyType(e.a, scope, fns), b = pyType(e.b, scope, fns);
          if (a === 'string' || b === 'string') return 'string';
          if (isArray(a)) return a;
          return a === '?' && b === '?' ? '?' : 'integer';
        }
        if (e.op === '*' && (pyType(e.a, scope, fns) === 'string' || pyType(e.b, scope, fns) === 'string')) return 'string';
        return 'integer';
      }
      case 'un': case 'not': case 'cmp': case 'boolop': return 'integer';
      case 'sub': { const t = pyType(e.value, scope, fns); return isArray(t) ? t.slice(0, -2) : t === 'string' ? 'string' : '?'; }
      case 'ifexp': { const t = pyType(e.body, scope, fns); return t !== '?' ? t : pyType(e.orelse, scope, fns); }
      case 'call': {
        if (e.func.k === 'name') {
          const n = e.func.id;
          if (['int', 'float', 'len', 'abs', 'round', 'min', 'max', 'sum', 'bool', 'ord'].includes(n)) return 'integer';
          if (['str', 'input', 'chr'].includes(n)) return 'string';
          const f = fns.get(n);
          if (f) return f.returnType === 'void' ? '?' : f.returnType;
        }
        if (e.func.k === 'attr' && ['upper', 'lower', 'strip', 'capitalize', 'title', 'replace'].includes(e.func.name)) return 'string';
        return '?';
      }
      default: return '?';
    }
  }

  function convert(src, opts = {}) {
    const tr = opts.t || ((k) => k);
    const mod = parse(src);
    const warnings = [];
    const warn = (line, key, args) => warnings.push({ line, key, args: args || [] });

    // -------------------------------------------------------- Funktionen sammeln
    const defs = mod.body.filter((s) => s.k === 'def');
    let mainBody = mod.body.filter((s) => s.k !== 'def');
    const fns = new Map();
    for (const d of defs) {
      if (fns.has(d.name)) warn(d.line, 'pyRedefined', [d.name]);
      fns.set(d.name, {
        def: d, name: d.name,
        params: d.params.map((p) => ({ name: p.name, type: annType(p.ann) })),
        returnType: d.returns ? (annType(d.returns) || (d.returns.k === 'none' ? 'void' : null)) : null,
        scope: new Map()
      });
    }

    // Muster "def main(): …" + main() bzw. if __name__ == "__main__": main()
    const isMainCall = (s) => s.k === 'expr' && isCallTo(s.value, 'main') && !s.value.args.length;
    const isGuard = (s) => s.k === 'if' && s.test.k === 'cmp' && strip(s.test.left).k === 'name' && strip(s.test.left).id === '__name__' && s.body.every((x) => isMainCall(x) || x.k === 'comment' || x.k === 'pass');
    const realMain = mainBody.filter((s) => s.k !== 'comment' && s.k !== 'import' && s.k !== 'pass');
    if (fns.has('main') && realMain.length && realMain.every((s) => isMainCall(s) || isGuard(s))) {
      const m = fns.get('main');
      mainBody = mainBody.filter((s) => s.k === 'comment').concat(m.def.body);
      fns.delete('main');
    } else if (fns.has('main')) {
      // Name "main" ist im Blockbild reserviert
      const m = fns.get('main');
      fns.delete('main');
      m.name = 'main_';
      fns.set('main_', m);
      warn(m.def.line, 'pyRenamed', ['main', 'main_']);
    }

    // -------------------------------------------------------- Typen ableiten (mehrere Durchläufe)
    const mainScope = new Map();
    const scanAssign = (body, scope, fnInfo) => {
      const visit = (list) => {
        for (const s of list) {
          if (s.k === 'assign') {
            const v = s.value;
            for (const tg of s.targets) {
              const t = strip(tg);
              if (t.k === 'name' && !scope.has(t.id)) {
                let ty = annType(s.ann) || pyType(v, scope, fns);
                if (isCallTo(v, 'input')) ty = 'string';
                if (ty !== '?') scope.set(t.id, ty);
              }
              if (t.k === 'tuple' && strip(v).k === 'tuple') {
                t.elts.forEach((x, i) => { const xx = strip(x); if (xx.k === 'name' && !scope.has(xx.id)) { const ty = pyType(strip(v).elts[i], scope, fns); if (ty !== '?') scope.set(xx.id, ty); } });
              }
            }
          }
          if (s.k === 'aug') { const t = strip(s.target); if (t.k === 'name' && !scope.has(t.id)) { const ty = pyType(s.value, scope, fns); if (ty !== '?') scope.set(t.id, ty); } }
          if (s.k === 'for') {
            const t = strip(s.target);
            if (t.k === 'name' && !scope.has(t.id)) {
              if (isCallTo(s.iter, 'range')) scope.set(t.id, 'integer');
              else { const it = pyType(s.iter, scope, fns); if (isArray(it)) scope.set(t.id, it.slice(0, -2)); }
            }
          }
          if (s.k === 'if') { visit(s.body); visit(s.orelse); }
          if (s.k === 'while' || s.k === 'for') visit(s.body);
          if (s.k === 'match') s.cases.forEach((c) => visit(c.body));
          if (s.k === 'return' && fnInfo && s.value && !fnInfo.returnTypeFixed) {
            const ty = pyType(s.value, scope, fns);
            if (ty !== '?' && !fnInfo.returnType) fnInfo.returnType = isArray(ty) ? 'integer' : ty;
          }
        }
      };
      visit(body);
    };
    const callSites = (body, scope) => {
      const walkE = (e) => {
        if (!e || typeof e !== 'object') return;
        if (e.k === 'call' && e.func.k === 'name' && fns.has(e.func.id)) {
          const f = fns.get(e.func.id);
          e.args.forEach((a, i) => {
            if (f.params[i] && !f.params[i].type) { const ty = pyType(a, scope, fns); if (ty !== '?') f.params[i].type = ty; }
          });
        }
        for (const v of Object.values(e)) {
          if (Array.isArray(v)) v.forEach(walkE); else if (v && typeof v === 'object') walkE(v);
        }
      };
      body.forEach(walkE);
    };
    for (const f of fns.values()) f.returnTypeFixed = !!f.returnType;
    for (let round = 0; round < 4; round++) {
      scanAssign(mainBody, mainScope, null);
      callSites(mainBody, mainScope);
      for (const f of fns.values()) {
        f.params.forEach((p) => { if (p.type) f.scope.set(p.name, p.type); });
        scanAssign(f.def.body, f.scope, f);
        callSites(f.def.body, f.scope);
      }
    }
    for (const f of fns.values()) {
      f.params.forEach((p) => { if (!p.type) p.type = 'integer'; f.scope.set(p.name, p.type); });
      const hasValueReturn = (list) => list.some((s) => (s.k === 'return' && s.value) || (s.body && hasValueReturn(s.body)) || (s.orelse && hasValueReturn(s.orelse)) || (s.cases && s.cases.some((c) => hasValueReturn(c.body))));
      if (!f.returnType) f.returnType = hasValueReturn(f.def.body) ? 'integer' : 'void';
      if (isArray(f.returnType)) { warn(f.def.line, 'pyReturnArray', [f.name]); f.returnType = 'void'; }
    }

    // -------------------------------------------------------- Anweisungen übersetzen

    function makeCtx(scope, fnInfo) {
      return { scope, fn: fnInfo, declared: new Set(fnInfo ? fnInfo.params.map((p) => p.name) : []), top: [], tmp: 0, pre: null, depth: 0 };
    }

    const unsupportedNote = (s) => ({ type: 'CommentStatement', comment: tr('pyNote', s.line, (mod.lines[s.line - 1] || '').trim()) });

    function tmpName(ctx, base) {
      let n;
      do { n = (base || tr('pyTmp')) + (++ctx.tmp); } while (ctx.scope.has(n) || ctx.declared.has(n));
      return n;
    }

    /** Variable deklarieren (falls nötig). Auf oberster Ebene direkt, sonst am Anfang des Unterprogramms. */
    function ensureDecl(ctx, name, type, out, init) {
      if (ctx.declared.has(name)) return false;
      ctx.declared.add(name);
      const ty = type && type !== '?' ? type : (ctx.scope.get(name) || 'integer');
      if (!ctx.scope.has(name)) ctx.scope.set(name, ty);
      if (isArray(ty)) {
        const d = { type: 'DeclarationStatement', variableType: ty, variableName: name, arrayLength: init != null ? init : '0', isArray: true };
        (ctx.depth === 0 ? out : ctx.top).push(d);
        return true;
      }
      if (ctx.depth === 0 && init != null) {
        out.push({ type: 'DeclarationStatement', variableType: ty, variableName: name, initializationValue: init, isArray: false });
        return true;
      }
      ctx.top.push({ type: 'DeclarationStatement', variableType: ty, variableName: name, initializationValue: DEFAULT[ty] || '0', isArray: false });
      return false;
    }

    function flush(ctx, out) {
      if (ctx.pre && ctx.pre.length) out.push(...ctx.pre);
      ctx.pre = null;
    }
    const pre = (ctx) => (ctx.pre = ctx.pre || []);

    // ---- Ausdrücke in Blockbild-Syntax
    const PREC = { or: 1, and: 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

    function ex(ctx, e, line, minPrec = 0) {
      e = e && e.k === 'paren' ? { k: 'paren', e: e.e } : e;
      const wrap = (s, prec) => (prec < minPrec ? '(' + s + ')' : s);
      switch (e.k) {
        case 'paren': return ex(ctx, e.e, line, minPrec);
        case 'num': return e.raw;
        case 'bool': return e.v ? '1' : '0';
        case 'none': warn(line, 'pyNone'); return '0';
        case 'str': return JSON.stringify(e.v);
        case 'name':
          if (ctx.fn && e.id === 'result' && ctx.fn.returnType !== 'void') return 'result';
          return e.id;
        case 'fstr': {
          const parts = e.parts.map((p) => (typeof p === 'string' ? JSON.stringify(p) : ex(ctx, p, line, 6)));
          if (!parts.length) return '""';
          if (typeof e.parts[0] !== 'string') parts.unshift('""');
          return wrap(mergeLiterals(parts).join(' + '), 5);
        }
        case 'un':
          if (e.op === '~') { warn(line, 'pyOperator', ['~']); return ex(ctx, e.a, line, 7); }
          return wrap(e.op + ex(ctx, e.a, line, 7), 7);
        case 'not': return wrap('!' + ex(ctx, e.a, line, 7), 7);
        case 'boolop': {
          const op = e.op === 'and' ? '&&' : '||';
          return wrap(ex(ctx, e.a, line, PREC[e.op]) + ' ' + op + ' ' + ex(ctx, e.b, line, PREC[e.op] + 1), PREC[e.op]);
        }
        case 'cmp': {
          const parts = [];
          let left = e.left;
          e.ops.forEach((op, i) => {
            const right = e.rights[i];
            let o = op;
            if (op === 'is') o = '==';
            else if (op === 'is not') o = '!=';
            else if (op === 'in' || op === 'not in') {
              const r = strip(right);
              if (r.k === 'tuple' || r.k === 'list') {
                const one = r.elts.map((x) => ex(ctx, left, line, 4) + (op === 'in' ? ' == ' : ' != ') + ex(ctx, x, line, 4));
                parts.push(one.length ? '(' + one.join(op === 'in' ? ' || ' : ' && ') + ')' : (op === 'in' ? '0' : '1'));
                left = right;
                return;
              }
              warn(line, 'pyOperator', [op]);
              o = '==';
            }
            parts.push(ex(ctx, left, line, 4) + ' ' + o + ' ' + ex(ctx, right, line, 4));
            left = right;
          });
          return parts.length > 1 ? wrap(parts.join(' && '), 2) : wrap(parts[0], 3);
        }
        case 'bin': {
          if (e.op === '//') {
            const a = ex(ctx, e.a, line, 6), b = ex(ctx, e.b, line, 7);
            return wrap('(' + a + ' - ' + a + ' % ' + b + ') / ' + b, 6);
          }
          if (e.op === '**') {
            const n = strip(e.b);
            if (n.k === 'num' && Number.isInteger(n.v) && n.v >= 0 && n.v <= 4) {
              if (n.v === 0) return '1';
              const base = ex(ctx, e.a, line, 7);
              return wrap(Array(n.v).fill(base).join(' * '), 6);
            }
            warn(line, 'pyOperator', ['**']);
            return wrap(ex(ctx, e.a, line, 6) + ' * ' + ex(ctx, e.a, line, 7), 6);
          }
          if (e.op === '*' && (pyType(e.a, ctx.scope, fns) === 'string' || pyType(e.b, ctx.scope, fns) === 'string')) {
            warn(line, 'pyOperator', ['"text" * n']);
          }
          if (e.op === '@') { warn(line, 'pyOperator', ['@']); return '0'; }
          const prec = PREC[e.op];
          if (e.op === '+' && pyType(e, ctx.scope, fns) === 'string') {
            // Python: Text + Zahl ist ein Fehler, im Blockbild erlaubt – Reihenfolge bleibt erhalten
            return wrap(ex(ctx, e.a, line, prec) + ' + ' + ex(ctx, e.b, line, prec + 1), prec);
          }
          return wrap(ex(ctx, e.a, line, prec) + ' ' + e.op + ' ' + ex(ctx, e.b, line, prec + 1), prec);
        }
        case 'sub': {
          const v = strip(e.value);
          if (e.index.k === 'slice') { warn(line, 'pySlice'); return ex(ctx, e.value, line, 7); }
          const idx = strip(e.index);
          const base = ex(ctx, e.value, line, 8);
          if (v.k !== 'name') warn(line, 'pyComplexIndex');
          if (pyType(e.value, ctx.scope, fns) === 'string') warn(line, 'pyStringIndex', [base]);
          if (idx.k === 'un' && idx.op === '-' && strip(idx.a).k === 'num') return base + '[' + base + '.length - ' + strip(idx.a).raw + ']';
          return base + '[' + ex(ctx, e.index, line, 0) + ']';
        }
        case 'call': return exCall(ctx, e, line, minPrec);
        case 'ifexp': {
          const ty = pyType(e, ctx.scope, fns);
          const t = tmpName(ctx);
          ctx.scope.set(t, ty === '?' ? 'integer' : ty);
          ctx.declared.add(t);
          ctx.top.push({ type: 'DeclarationStatement', variableType: ctx.scope.get(t), variableName: t, initializationValue: DEFAULT[ctx.scope.get(t)] || '0', isArray: false });
          const c = ex(ctx, e.test, line);
          const a = ex(ctx, e.body, line);
          const b = ex(ctx, e.orelse, line);
          pre(ctx).push({ type: 'IfStatement', condition: c, thenStatements: S({ type: 'AssignmentStatement', variableName: t, assignmentValue: a }), elseStatements: S({ type: 'AssignmentStatement', variableName: t, assignmentValue: b }) });
          return t;
        }
        case 'attr':
          warn(line, 'pyAttr', [e.name]);
          return ex(ctx, e.value, line, minPrec);
        case 'list': case 'tuple': case 'dict': case 'comp': case 'slice':
          warn(line, 'pyCollection');
          return '0';
        case 'wild': return '_';
        default:
          warn(line, 'pyExpr');
          return '0';
      }
    }

    function hoistValue(ctx, type, line, build) {
      const t = tmpName(ctx);
      const ty = type === '?' ? 'integer' : type;
      ctx.scope.set(t, ty);
      ctx.declared.add(t);
      ctx.top.push({ type: 'DeclarationStatement', variableType: ty, variableName: t, initializationValue: DEFAULT[ty] || '0', isArray: false });
      build(t, pre(ctx));
      return t;
    }

    function exCall(ctx, e, line, minPrec) {
      const f = e.func;
      if (f.k === 'attr') {
        const m = f.name;
        const obj = ex(ctx, f.value, line, 8);
        if (m === 'upper' || m === 'lower' || m === 'strip' || m === 'capitalize' || m === 'title') { warn(line, 'pyMethod', [m]); return obj; }
        if (m === 'format') { warn(line, 'pyMethod', [m]); return obj; }
        warn(line, 'pyMethod', [m]);
        return obj;
      }
      if (f.k !== 'name') { warn(line, 'pyExpr'); return '0'; }
      const n = f.id;
      const args = e.args;
      switch (n) {
        case 'len': {
          const a = strip(args[0]);
          if (a && a.k === 'name') return a.id + '.length';
          return '(' + ex(ctx, args[0], line, 8) + ').length';
        }
        case 'int': case 'float': case 'round': case 'bool':
          if (!args.length) return '0';
          if (isCallTo(args[0], 'input')) {
            return hoistValue(ctx, 'integer', line, (t, list) => list.push({ type: 'InputStatement', prompt: promptOf(ctx, args[0], line), variableName: t }));
          }
          if (n === 'round') warn(line, 'pyRound');
          if (n === 'int' && pyType(args[0], ctx.scope, fns) === 'integer') {
            // int(a / b) → ganzzahlige Division
            const a = strip(args[0]);
            if (a.k === 'bin' && a.op === '/') return ex(ctx, { k: 'bin', op: '//', a: a.a, b: a.b }, line, minPrec);
          }
          return ex(ctx, args[0], line, minPrec);
        case 'str':
          if (!args.length) return '""';
          if (pyType(args[0], ctx.scope, fns) === 'string') return ex(ctx, args[0], line, minPrec);
          return (minPrec > 5 ? '(' : '') + '"" + ' + ex(ctx, args[0], line, 6) + (minPrec > 5 ? ')' : '');
        case 'input':
          return hoistValue(ctx, 'string', line, (t, list) => list.push({ type: 'InputStatement', prompt: promptOf(ctx, e, line), variableName: t }));
        case 'abs':
          return hoistValue(ctx, 'integer', line, (t, list) => {
            list.push({ type: 'AssignmentStatement', variableName: t, assignmentValue: ex(ctx, args[0], line) });
            list.push({ type: 'IfStatement', condition: t + ' < 0', thenStatements: S({ type: 'AssignmentStatement', variableName: t, assignmentValue: '-' + t }), elseStatements: null });
          });
        case 'min': case 'max': {
          if (args.length < 2) { warn(line, 'pyBuiltin', [n]); return '0'; }
          const vals = args.map((a) => ex(ctx, a, line));
          return hoistValue(ctx, pyType(args[0], ctx.scope, fns), line, (t, list) => {
            list.push({ type: 'AssignmentStatement', variableName: t, assignmentValue: vals[0] });
            for (const v of vals.slice(1)) {
              list.push({ type: 'IfStatement', condition: v + (n === 'min' ? ' < ' : ' > ') + t, thenStatements: S({ type: 'AssignmentStatement', variableName: t, assignmentValue: v }), elseStatements: null });
            }
          });
        }
        case 'print':
          warn(line, 'pyExpr');
          return '""';
        default: {
          const fi = fns.get(n);
          if (!fi) { warn(line, 'pyBuiltin', [n]); return '0'; }
          const callArgs = args.map((a) => ex(ctx, a, line));
          if (fi.returnType === 'void') { warn(line, 'pyVoidValue', [n]); }
          return hoistValue(ctx, fi.returnType === 'void' ? 'integer' : fi.returnType, line, (t, list) => {
            list.push({ type: 'FunctionCallStatement', functionName: fi.name, parameters: callArgs.map((value) => ({ value })), variableName: fi.returnType === 'void' ? undefined : t });
          });
        }
      }
    }

    /** Benachbarte Textliterale zusammenfassen: "a" + " " + x → "a " + x */
    function mergeLiterals(parts) {
      const out = [];
      const isLit = (s) => /^"(?:[^"\\]|\\.)*"$/.test(s);
      for (const part of parts) {
        if (out.length && isLit(part) && isLit(out[out.length - 1]) && !(out.length === 1 && part === '""')) {
          out[out.length - 1] = JSON.stringify(JSON.parse(out[out.length - 1]) + JSON.parse(part));
        } else out.push(part);
      }
      if (out.length > 1 && out[0] === '""' && isLit(out[1])) out.shift();
      return out;
    }

    function promptOf(ctx, inputCall, line) {
      const c = strip(inputCall);
      if (!c.args.length) return '""';
      return ex(ctx, c.args[0], line);
    }

    // ---- "liefert immer" – für frühe returns
    const alwaysReturns = (list) => {
      const last = list.filter((s) => s.k !== 'comment' && s.k !== 'pass').slice(-1)[0];
      if (!last) return false;
      if (last.k === 'return') return true;
      if (last.k === 'if') return alwaysReturns(last.body) && last.orelse.length > 0 && alwaysReturns(last.orelse);
      return false;
    };

    /** Liste von Python-Anweisungen → Blockbild-Anweisungen. */
    function block(ctx, list, tail) {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const rest = list.slice(i + 1);
        // if … : return …   (ohne else) gefolgt von weiteren Anweisungen → Rest wird zum SONST-Zweig
        if (ctx.fn && s.k === 'if' && !s.orelse.length && alwaysReturns(s.body) && rest.some((x) => x.k !== 'comment')) {
          stmt(ctx, Object.assign({}, s, { orelse: rest }), out, tail);
          return out;
        }
        stmt(ctx, s, out, tail && i === list.length - 1);
      }
      return out;
    }

    function sub(ctx, list, tail) {
      ctx.depth++;
      const r = block(ctx, list, tail);
      ctx.depth--;
      return S(...r);
    }

    function assignTo(ctx, target, valueSrc, valueType, out, line) {
      const t = strip(target);
      if (t.k === 'name') {
        const isNew = !ctx.declared.has(t.id);
        if (isNew) {
          flush(ctx, out);
          if (ensureDecl(ctx, t.id, valueType, out, valueSrc)) return;
        }
        flush(ctx, out);
        out.push({ type: 'AssignmentStatement', variableName: t.id, assignmentValue: valueSrc });
        return;
      }
      if (t.k === 'sub') {
        const tg = ex(ctx, t, line);
        flush(ctx, out);
        out.push({ type: 'AssignmentStatement', variableName: tg, assignmentValue: valueSrc });
        return;
      }
      flush(ctx, out);
      warn(line, 'pyTarget');
      out.push({ type: 'CommentStatement', comment: tr('pyNote', line, (mod.lines[line - 1] || '').trim()) });
    }

    function stmt(ctx, s, out, tail) {
      const line = s.line;
      switch (s.k) {
        case 'comment':
          out.push({ type: 'CommentStatement', comment: s.text });
          return;
        case 'pass': case 'skip': return;
        case 'import':
          return;
        case 'annotation': {
          const t = strip(s.target);
          if (t.k === 'name') ensureDecl(ctx, t.id, annType(s.ann), out, null);
          return;
        }
        case 'expr': return exprStmt(ctx, s, out);
        case 'assign': return assignStmt(ctx, s, out);
        case 'aug': {
          const t = strip(s.target);
          const tgt = t.k === 'name' ? t.id : ex(ctx, t, line);
          const op = s.op === '//' ? '//' : s.op;
          const val = ex(ctx, { k: 'bin', op, a: s.target, b: { k: 'paren', e: s.value } }, line);
          if (t.k === 'name' && !ctx.declared.has(t.id)) { warn(line, 'pyUndeclared', [t.id]); ensureDecl(ctx, t.id, pyType(s.value, ctx.scope, fns), out, null); }
          flush(ctx, out);
          out.push({ type: 'AssignmentStatement', variableName: tgt, assignmentValue: val });
          return;
        }
        case 'if': {
          const cond = ex(ctx, s.test, line);
          flush(ctx, out);
          out.push({
            type: 'IfStatement', condition: cond,
            thenStatements: sub(ctx, s.body, tail),
            elseStatements: s.orelse.length ? sub(ctx, s.orelse, tail) : null
          });
          return;
        }
        case 'while': return whileStmt(ctx, s, out);
        case 'for': return forStmt(ctx, s, out);
        case 'match': return matchStmt(ctx, s, out, tail);
        case 'return': {
          if (!ctx.fn) { warn(line, 'pyReturnMain'); return; }
          if (!tail) warn(line, 'pyEarlyReturn');
          if (!s.value) return;
          if (ctx.fn.returnType === 'void') { warn(line, 'pyReturnVoid'); return; }
          const v = ex(ctx, s.value, line);
          flush(ctx, out);
          out.push({ type: 'AssignmentStatement', variableName: 'result', assignmentValue: v });
          return;
        }
        case 'break': case 'continue':
          warn(line, 'pyBreak', [s.k]);
          out.push(unsupportedNote(s));
          return;
        case 'def':
          warn(line, 'pyNestedDef', [s.name]);
          out.push(unsupportedNote(s));
          return;
        default:
          if (s.reason) warn(line, s.reason);
          else warn(line, 'pyStatement', [(s.text || '').split(/[\s:(]/)[0] || '?']);
          out.push(unsupportedNote(s));
      }
    }

    function exprStmt(ctx, s, out) {
      const e = strip(s.value);
      const line = s.line;
      if (e.k === 'str') return; // Docstring
      if (e.k === 'call' && e.func.k === 'name' && e.func.id === 'print') {
        const sepArg = e.kwargs.sep;
        const sep = sepArg ? (strip(sepArg).k === 'str' ? strip(sepArg).v : ' ') : ' ';
        if (e.kwargs.end && !(strip(e.kwargs.end).k === 'str' && strip(e.kwargs.end).v === '\n')) warn(line, 'pyPrintEnd');
        const parts = e.args.map((a) => ex(ctx, a, line, e.args.length > 1 ? 6 : 0));
        let text;
        if (!parts.length) text = '""';
        else {
          const joined = [];
          parts.forEach((x, i) => { if (i > 0 && sep) joined.push(JSON.stringify(sep)); joined.push(x); });
          // ohne Trennzeichen würden zwei Zahlen addiert statt aneinandergehängt
          if (joined.length > 1 && !sep && pyType(e.args[0], ctx.scope, fns) !== 'string') joined.unshift('""');
          text = mergeLiterals(joined).join(' + ');
        }
        flush(ctx, out);
        out.push({ type: 'OutputStatement', outputString: text });
        return;
      }
      if (e.k === 'call' && e.func.k === 'name' && e.func.id === 'input') {
        const t = tmpName(ctx);
        ctx.scope.set(t, 'string');
        ctx.declared.add(t);
        ctx.top.push({ type: 'DeclarationStatement', variableType: 'string', variableName: t, initializationValue: '""', isArray: false });
        out.push({ type: 'InputStatement', prompt: promptOf(ctx, e, line), variableName: t });
        return;
      }
      if (e.k === 'call' && e.func.k === 'name' && fns.has(e.func.id)) {
        const fi = fns.get(e.func.id);
        const args = e.args.map((a) => ex(ctx, a, line));
        flush(ctx, out);
        out.push({ type: 'FunctionCallStatement', functionName: fi.name, parameters: args.map((value) => ({ value })) });
        return;
      }
      if (e.k === 'call' && e.func.k === 'attr') {
        warn(line, 'pyMethod', [e.func.name]);
        out.push(unsupportedNote(s));
        return;
      }
      warn(line, 'pyExprStmt');
      out.push(unsupportedNote(s));
    }

    function assignStmt(ctx, s, out) {
      const line = s.line;
      const v = strip(s.value);
      for (const target of s.targets) {
        const t = strip(target);
        // Tupel-Zuweisung: a, b = b, a
        if (t.k === 'tuple') {
          if (v.k !== 'tuple' || v.elts.length !== t.elts.length) { warn(line, 'pyTarget'); out.push(unsupportedNote(s)); return; }
          const temps = v.elts.map((x) => {
            const ty = pyType(x, ctx.scope, fns);
            const val = ex(ctx, x, line);
            const tmp = tmpName(ctx);
            ctx.scope.set(tmp, ty === '?' ? 'integer' : ty);
            ctx.declared.add(tmp);
            ctx.top.push({ type: 'DeclarationStatement', variableType: ctx.scope.get(tmp), variableName: tmp, initializationValue: DEFAULT[ctx.scope.get(tmp)] || '0', isArray: false });
            flush(ctx, out);
            out.push({ type: 'AssignmentStatement', variableName: tmp, assignmentValue: val });
            return tmp;
          });
          t.elts.forEach((x, i) => assignTo(ctx, x, temps[i], ctx.scope.get(temps[i]), out, line));
          continue;
        }
        // Eingabe
        const isInput = isCallTo(v, 'input');
        const isNumInput = v.k === 'call' && v.func.k === 'name' && ['int', 'float'].includes(v.func.id) && v.args[0] && isCallTo(v.args[0], 'input');
        if ((isInput || isNumInput) && t.k !== 'tuple') {
          const prompt = promptOf(ctx, isInput ? v : v.args[0], line);
          const ty = isInput ? (annType(s.ann) || 'string') : 'integer';
          if (t.k === 'name') {
            if (!ctx.declared.has(t.id)) {
              if (ctx.scope.get(t.id) && ctx.scope.get(t.id) !== ty && isInput) {
                // erst Text, später Zahl: als Zahl einlesen
              }
              ensureDecl(ctx, t.id, ctx.scope.get(t.id) || ty, out, DEFAULT[ctx.scope.get(t.id) || ty]);
            }
            if (isInput && ctx.scope.get(t.id) === 'integer') warn(line, 'pyInputNumber', [t.id]);
          }
          flush(ctx, out);
          out.push({ type: 'InputStatement', prompt, variableName: t.k === 'name' ? t.id : ex(ctx, t, line) });
          continue;
        }
        // Listen
        const listInfo = listLiteral(v);
        if (listInfo && t.k === 'name') {
          const elemType = listInfo.elemType || (ctx.scope.get(t.id) && isArray(ctx.scope.get(t.id)) ? ctx.scope.get(t.id).slice(0, -2) : 'integer');
          const arrType = elemType + '[]';
          if (ctx.declared.has(t.id)) { warn(line, 'pyListReassign', [t.id]); out.push(unsupportedNote(s)); continue; }
          let length;
          if (listInfo.kind === 'repeat') length = ex(ctx, listInfo.count, line);
          else length = String(listInfo.items.length);
          if (listInfo.kind === 'literal' && !listInfo.items.length) warn(line, 'pyEmptyList', [t.id]);
          ctx.scope.set(t.id, arrType);
          ctx.declared.add(t.id);
          flush(ctx, out);
          (ctx.depth === 0 ? out : ctx.top).push({ type: 'DeclarationStatement', variableType: arrType, variableName: t.id, arrayLength: length, isArray: true });
          if (listInfo.kind === 'literal') {
            listInfo.items.forEach((x, i) => {
              const val = ex(ctx, x, line);
              flush(ctx, out);
              out.push({ type: 'AssignmentStatement', variableName: t.id + '[' + i + ']', assignmentValue: val });
            });
          } else {
            const fill = strip(listInfo.value);
            const isDefault = (fill.k === 'num' && fill.v === 0) || (fill.k === 'str' && fill.v === '') || (fill.k === 'bool' && !fill.v);
            if (!isDefault) {
              const ix = tmpName(ctx, 'i');
              ctx.scope.set(ix, 'integer');
              ctx.declared.add(ix);
              ctx.top.push({ type: 'DeclarationStatement', variableType: 'integer', variableName: ix, initializationValue: '0', isArray: false });
              const val = ex(ctx, listInfo.value, line);
              flush(ctx, out);
              out.push({ type: 'ForStatement', counterName: ix, fromValue: '0', toValue: t.id + '.length - 1', counterShift: '+1', loopStatements: S({ type: 'AssignmentStatement', variableName: t.id + '[' + ix + ']', assignmentValue: val }) });
            }
          }
          continue;
        }
        // Funktionsaufruf mit Ergebnis
        if (v.k === 'call' && v.func.k === 'name' && fns.has(v.func.id) && t.k === 'name') {
          const fi = fns.get(v.func.id);
          const args = v.args.map((a) => ex(ctx, a, line));
          if (!ctx.declared.has(t.id)) ensureDecl(ctx, t.id, fi.returnType === 'void' ? 'integer' : fi.returnType, out, null);
          flush(ctx, out);
          if (fi.returnType === 'void') warn(line, 'pyVoidValue', [fi.name]);
          out.push({ type: 'FunctionCallStatement', functionName: fi.name, parameters: args.map((value) => ({ value })), variableName: fi.returnType === 'void' ? undefined : t.id });
          continue;
        }
        if (t.k === 'name' && ctx.fn && t.id === 'result' && ctx.fn.returnType !== 'void') warn(line, 'pyResultName');
        const ty = annType(s.ann) || pyType(v, ctx.scope, fns);
        const val = ex(ctx, s.value, line);
        assignTo(ctx, t, val, ty, out, line);
      }
    }

    function listLiteral(v) {
      v = strip(v);
      if (v.k === 'list') {
        const first = v.elts[0];
        return { kind: 'literal', items: v.elts, elemType: first ? (pyType(first, new Map(), fns) === 'string' ? 'string' : 'integer') : null };
      }
      if (v.k === 'bin' && v.op === '*') {
        const a = strip(v.a), b = strip(v.b);
        const lst = a.k === 'list' ? a : b.k === 'list' ? b : null;
        if (lst && lst.elts.length === 1) {
          const count = lst === a ? v.b : v.a;
          const value = lst.elts[0];
          return { kind: 'repeat', count, value, elemType: pyType(value, new Map(), fns) === 'string' ? 'string' : 'integer' };
        }
      }
      return null;
    }

    function whileStmt(ctx, s, out) {
      const line = s.line;
      if (s.orelse) warn(line, 'pyLoopElse');
      const test = strip(s.test);
      const isTrue = (test.k === 'bool' && test.v) || (test.k === 'num' && test.v !== 0);
      // while True: … if bedingung: break  → WIEDERHOLE … BIS bedingung
      const body = s.body.filter((x) => x.k !== 'pass');
      const last = body[body.length - 1];
      const breaksElsewhere = (list) => list.some((x) => x.k === 'break' || (x.k === 'if' && (breaksElsewhere(x.body) || breaksElsewhere(x.orelse))));
      if (isTrue && last && last.k === 'if' && !last.orelse.length && last.body.length === 1 && last.body[0].k === 'break' && !breaksElsewhere(body.slice(0, -1))) {
        const inner = sub(ctx, body.slice(0, -1), false);
        const cond = ex(ctx, last.test, last.line);
        if (ctx.pre) { warn(line, 'pyComplexCond'); flush(ctx, inner.statements); }
        out.push({ type: 'DoWhileStatement', condition: cond, loopStatements: inner });
        return;
      }
      if (breaksElsewhere(body)) warn(line, 'pyBreak', ['break']);
      const cond = ex(ctx, s.test, line);
      if (ctx.pre) warn(line, 'pyComplexCond');
      flush(ctx, out);
      out.push({ type: 'WhileStatement', condition: cond, loopStatements: sub(ctx, s.body, false) });
    }

    function forStmt(ctx, s, out) {
      const line = s.line;
      if (s.orelse) warn(line, 'pyLoopElse');
      const t = strip(s.target);
      if (t.k !== 'name') { warn(line, 'pyTarget'); out.push(unsupportedNote(s)); return; }
      const it = strip(s.iter);
      if (isCallTo(it, 'range')) {
        const a = it.args;
        let from = '0', toExpr, step = '+1', stepVal = 1;
        if (a.length === 1) toExpr = a[0];
        else { from = ex(ctx, a[0], line); toExpr = a[1]; }
        if (a.length >= 3) {
          const st = strip(a[2]);
          const lit = st.k === 'num' ? st.v : (st.k === 'un' && st.op === '-' && strip(st.a).k === 'num' ? -strip(st.a).v : null);
          if (lit === null) { warn(line, 'pyRangeStep'); stepVal = 1; step = ex(ctx, a[2], line); }
          else { stepVal = lit; step = (lit > 0 ? '+' : '') + lit; }
        }
        const te = strip(toExpr);
        let to;
        const d = stepVal > 0 ? -1 : 1;
        if (te.k === 'num' && Number.isInteger(te.v)) to = String(te.v + d);
        else if (te.k === 'bin' && (te.op === '+' || te.op === '-') && strip(te.b).k === 'num' && Number.isInteger(strip(te.b).v)) {
          // n + 1 → n,  n + 2 → n + 1,  n - 1 → n - 2
          const c = (te.op === '+' ? 1 : -1) * strip(te.b).v + d;
          const base = ex(ctx, te.a, line, 5);
          to = c === 0 ? base : base + (c > 0 ? ' + ' + c : ' - ' + (-c));
        } else to = ex(ctx, toExpr, line, 5) + (d < 0 ? ' - 1' : ' + 1');
        if (!ctx.declared.has(t.id)) { ctx.scope.set(t.id, 'integer'); ctx.declared.add(t.id); ctx.top.push({ type: 'DeclarationStatement', variableType: 'integer', variableName: t.id, initializationValue: '0', isArray: false }); }
        flush(ctx, out);
        out.push({ type: 'ForStatement', counterName: t.id, fromValue: from, toValue: to, counterShift: step, loopStatements: sub(ctx, s.body, false) });
        return;
      }
      const itType = pyType(it, ctx.scope, fns);
      if (isArray(itType) && it.k === 'name') {
        const ix = tmpName(ctx, 'i');
        ctx.scope.set(ix, 'integer');
        ctx.declared.add(ix);
        ctx.top.push({ type: 'DeclarationStatement', variableType: 'integer', variableName: ix, initializationValue: '0', isArray: false });
        if (!ctx.declared.has(t.id)) {
          const et = itType.slice(0, -2);
          ctx.scope.set(t.id, et);
          ctx.declared.add(t.id);
          ctx.top.push({ type: 'DeclarationStatement', variableType: et, variableName: t.id, initializationValue: DEFAULT[et], isArray: false });
        }
        const body = sub(ctx, s.body, false);
        body.statements.unshift({ type: 'AssignmentStatement', variableName: t.id, assignmentValue: it.id + '[' + ix + ']' });
        out.push({ type: 'ForStatement', counterName: ix, fromValue: '0', toValue: it.id + '.length - 1', counterShift: '+1', loopStatements: body });
        return;
      }
      warn(line, 'pyForIter');
      out.push(unsupportedNote(s));
    }

    function matchStmt(ctx, s, out, tail) {
      const line = s.line;
      const subj = ex(ctx, s.subject, line);
      flush(ctx, out);
      const cases = [];
      let els = null;
      for (const c of s.cases) {
        if (c.guard) warn(line, 'pyMatchGuard');
        const body = sub(ctx, c.body, tail);
        for (const p of c.patterns) {
          if (p.k === 'wild' || (p.k === 'name' && !fns.has(p.id) && !ctx.scope.has(p.id))) { els = body; continue; }
          cases.push({ caseValue: ex(ctx, p, line), caseStatements: JSON.parse(JSON.stringify(body)) });
        }
      }
      out.push({ type: 'SwitchStatement', variableName: subj, casesStatements: cases, elseStatements: els });
    }

    function convertBody(list, ctx) {
      const stmts = block(ctx, list, true);
      return ctx.top.concat(stmts);
    }

    // -------------------------------------------------------- Ergebnis zusammensetzen
    const bb = {};
    const mctx = makeCtx(mainScope, null);
    bb.main = S(...convertBody(mainBody, mctx));
    for (const f of fns.values()) {
      const ctx = makeCtx(f.scope, f);
      if (f.returnType !== 'void') ctx.declared.add('result');
      const stmts = convertBody(f.def.body, ctx);
      bb[f.name] = {
        parameters: f.params.map((p) => ({ type: p.type, name: p.name, onlyIn: !isArray(p.type) })),
        statements: S(...stmts),
        returnType: f.returnType,
        resultInitializationValue: f.returnType === 'void' ? undefined : DEFAULT[f.returnType]
      };
    }
    // doppelte Hinweise je Zeile zusammenfassen
    const seen = new Set();
    const uniq = warnings.filter((w) => { const k = w.line + w.key + w.args.join(); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.line - b.line);
    return { bb, warnings: uniq };
  }

  BBE.pyimport = { tokenize, parse, convert, PyError };
})(typeof window !== 'undefined' ? window : globalThis);
