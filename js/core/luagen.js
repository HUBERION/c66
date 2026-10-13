/* Blockbild-Editor – Übersetzung nach Lua (5.3 oder neuer)
 *
 *   Zahl → Lua-Ganzzahl; / und % rechnen wie in C (Richtung 0 abgeschnitten, Rest mit dem Vorzeichen
 *   des Dividenden) – Luas // und % runden dagegen ab, deshalb idiv() bzw. math.fmod().
 *   Text → string, Text + Zahl → "..", Wahrheitswerte: 0 und "" sind in Lua wahr → explizit vergleichen.
 *   Arrays → Tabelle mit Index 0 … n - 1, Länge im Feld .n (Luas # zählt Index 0 nicht mit).
 *   InOut-Zahlen/Texte: Rückgabe als zusätzliche Werte und Zuweisung beim Aufruf:  x, y = tausche(x, y)
 *   Variablen gelten im ganzen Unterprogramm → verschachtelte Deklarationen als local am Anfang.
 *   Lua-Namen sind ASCII: Umlaute werden ersetzt (ä → ae …), Schlüsselwörter bekommen ein _.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '  ';
  // Schlüsselwörter und globale Namen der Standardbibliothek (würden sonst verdeckt)
  const RESERVED = new Set(('and break do else elseif end false for function goto if in local nil not or repeat return then ' +
    'true until while print io math string table type tostring tonumber pairs ipairs select error assert pcall xpcall ' +
    'os require utf8 next rawget rawset rawequal rawlen setmetatable getmetatable load loadfile dofile coroutine debug ' +
    'package arg unpack collectgarbage _G _ENV _VERSION main idiv trunc to_num new_array').split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };

  /** Lua-Text in "…" mit Escapes; Steuerzeichen als \ddd. */
  function luaStr(s) {
    let out = '"';
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (ch === '\\') out += '\\\\';
      else if (ch === '"') out += '\\"';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (c < 32 || c === 127) out += '\\' + String(c).padStart(3, '0');
      else out += ch;
    }
    return out + '"';
  }

  function asciiName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    if (!s) s = 'v';
    if (/^[0-9]/.test(s)) s = '_' + s;
    return s;
  }

  /** Alle Variablennamen, die in einem Ausdrucks-/Zielfeld vorkommen. */
  function idsIn(src) {
    const out = new Set();
    const a = tryParse(src) || tryTarget(src);
    if (a) BBE.expr.walk(a, (x) => { if (x.k === 'id') out.add(x.name); });
    return out;
  }

  function exprFields(n) {
    switch (n.kind) {
      case 'decl': return [n.init, n.length];
      case 'input': return [n.prompt, n.target];
      case 'output': return [n.expr];
      case 'assign': return [n.target, n.expr];
      case 'if': case 'while': case 'until': return [n.cond];
      case 'for': return [n.counter, n.from, n.to, n.step];
      case 'switch': return [n.expr, ...n.cases.map((c) => c.value)];
      case 'call': return [n.target, ...(n.args || [])];
      default: return [];
    }
  }

  const counterName = (n) => { const t = tryTarget(n.counter); return t && t.k === 'id' ? t.name : null; };

  /** Kommt der Name außerhalb der ZÄHLE-Schleifen mit diesem Zähler vor? */
  function usedOutsideLoops(seq, nm) {
    for (const n of seq) {
      if (n.kind === 'for' && counterName(n) === nm) continue;
      for (const src of exprFields(n)) if (src && idsIn(src).has(nm)) return true;
      for (const c of M.childSeqs(n)) if (usedOutsideLoops(c.seq, nm)) return true;
    }
    return false;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { num: asciiName(tr('pyHelperNum')), text: asciiName(tr('luaHelperText')) };
    const q = asciiName(tr('genArgPrompt'));
    const used = { num: false, text: false, idiv: false, trunc: false, toNum: false, arr: false };
    const taken = new Set([H.num, H.text, '_']);
    const fnName = new Map();
    for (const f of program.fns.filter((x) => !x.isMain)) {
      let n = asciiName(f.name);
      if (RESERVED.has(n)) n += '_';
      while (taken.has(n)) n += '_';
      taken.add(n);
      fnName.set(f.name, n);
    }
    const globalTaken = new Set(taken);
    const body = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(asciiName(n)) ? asciiName(n) + '_' : asciiName(n));
    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 5, '-': 5, '*': 6 };
    const OPS = { '||': 'or', '&&': 'and', '!=': '~=' };
    const defaultFor = (t) => (t === 'string' ? '""' : t === 'integer' ? '0' : null);

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function comment(ctx, n) { if (n && n.comment) line(ctx, '-- ' + n.comment.replace(/\s+/g, ' ')); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      const local = new Set(globalTaken);
      for (const n of scope.keys()) {
        let r = asciiName(n);
        if (RESERVED.has(r)) r += '_';
        while (local.has(r)) r += '_';
        local.add(r);
        rename.set(n, r);
      }
      const outs = fn.params.filter((p) => p.byRef && !A.isArrayType(p.type));
      const ctx = { fn, scope, rename, ind: 1, lines: [], declared: new Set(fn.params.map((p) => p.name)), hoisted: new Set(), discard: false };
      // local gilt nur im Block → verschachtelte Deklarationen an den Anfang
      M.walkSeq(fn.body, (n, seq, i, depth) => { if (n.kind === 'decl' && n.name && depth > 0) ctx.hoisted.add(n.name); });

      const head = [];
      if (!fn.isMain && fn.returnType !== 'void') { head.push('local result = ' + valueFor(ctx, fn.resultInit, fn.returnType)); ctx.declared.add('result'); }
      for (const n of ctx.hoisted) {
        const v = scope.get(n);
        if (!v || ctx.declared.has(n)) continue;
        const d = defaultFor(v.type);
        head.push('local ' + name(ctx, n) + (d ? ' = ' + d : ''));
        ctx.declared.add(n);
      }
      genSeq(ctx, fn.body);
      if (ctx.discard) head.push('local _');
      if (!fn.isMain) {
        const ret = [];
        if (fn.returnType !== 'void') ret.push('result');
        outs.forEach((p) => ret.push(name(ctx, p.name)));
        if (ret.length) line(ctx, 'return ' + ret.join(', '));
      }
      const params = fn.params.map((p) => name(ctx, p.name || 'p'));
      body.push(fn.isMain ? 'local function main()' : 'function ' + fnName.get(fn.name) + '(' + params.join(', ') + ')');
      for (const h of head) body.push(IND + h);
      body.push(...ctx.lines, 'end');
    }

    // ------------------------------------------------------------ Ausdrücke

    function ex(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': return luaStr(a.v);
        case 'paren': return '(' + ex(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 9) + '[' + ex(ctx, a.index) + ']';
        case 'len': {
          const t = typeOf(ctx, a.obj);
          if (t === 'string') return 'utf8.len(' + ex(ctx, a.obj) + ')';
          return ex(ctx, a.obj, 9) + '.n';
        }
        case 'un': {
          if (a.op === '!') return wrap('not ' + boolEx(ctx, a.a, 7), 7);
          if (a.op === '+') return ex(ctx, a.a, minPrec);
          const s = ex(ctx, a.a, 7);
          return wrap('-' + (s.startsWith('-') ? '(' + s + ')' : s), 7);
        }
        case 'bin': {
          if (a.op === '+' && typeOf(ctx, a) === 'string') return wrap(textExpr(ctx, a), 4);
          if (a.op === '/') { used.idiv = true; return 'idiv(' + ex(ctx, a.a) + ', ' + ex(ctx, a.b) + ')'; }
          if (a.op === '%') return 'math.fmod(' + ex(ctx, a.a) + ', ' + ex(ctx, a.b) + ')';
          const p = PREC[a.op];
          if (a.op === '&&' || a.op === '||') return wrap(boolEx(ctx, a.a, p) + ' ' + OPS[a.op] + ' ' + boolEx(ctx, a.b, p + 1), p);
          if (p === 3) return wrap(ex(ctx, a.a, 4) + ' ' + (OPS[a.op] || a.op) + ' ' + ex(ctx, a.b, 4), p);
          return wrap(ex(ctx, a.a, p) + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    /** Als Bedingung: in Lua sind 0 und "" wahr → Zahlen/Texte ausdrücklich vergleichen. */
    function boolEx(ctx, ast, minPrec = 0) {
      const t = typeOf(ctx, ast);
      const wrap = (s) => (3 < minPrec ? '(' + s + ')' : s);
      if (t === 'integer') return wrap(ex(ctx, ast, 4) + ' ~= 0');
      if (t === 'string') return wrap(ex(ctx, ast, 4) + ' ~= ""');
      return ex(ctx, ast, minPrec);
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [ast];
    }

    /** Text-Ausdruck: Teile mit .. verbinden (ganze Zahlen hängt Lua selbst als Ziffern an). */
    function textExpr(ctx, ast) {
      return parts(ctx, ast).map((p) => {
        const t = typeOf(ctx, p);
        if (t === 'string') return ex(ctx, p, 5);
        if (t === 'integer') return ex(ctx, p, 7);
        return 'tostring(' + ex(ctx, p) + ')';
      }).join(' .. ');
    }

    /** Wert als eigenständiger Text. */
    function toStr(ctx, ast) {
      const t = typeOf(ctx, ast);
      if (t === 'string') return ex(ctx, strip(ast));
      return 'tostring(' + ex(ctx, strip(ast)) + ')';
    }

    function hasFloat(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
      return hit;
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || defaultFor(type) || 'nil';
      const t = typeOf(ctx, ast);
      if (type === 'string') return toStr(ctx, ast);
      if (type === 'integer') {
        if (t === 'string') { used.toNum = true; return 'to_num(' + ex(ctx, strip(ast)) + ')'; }
        if (t === 'bool') return '(' + ex(ctx, strip(ast), 3) + ' and 1 or 0)';
        if (hasFloat(ast)) { used.trunc = true; return 'trunc(' + ex(ctx, strip(ast)) + ')'; }
      }
      return ex(ctx, strip(ast));
    }

    const cond = (ctx, src) => { const ast = tryParse(src); return ast ? boolEx(ctx, strip(ast)) : 'true'; };

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, '-- ' + l);
          return;
        case 'decl': {
          comment(ctx, n);
          const nm = name(ctx, n.name || 'variable');
          let value;
          if (n.vtype.endsWith('[]')) {
            used.arr = true;
            value = 'new_array(' + ex(ctx, tryParse(n.length) || { k: 'num', raw: '0' }) + ', ' + (n.vtype === 'string[]' ? '""' : '0') + ')';
          } else value = valueFor(ctx, n.init, n.vtype);
          line(ctx, (ctx.declared.has(n.name) ? '' : 'local ') + nm + ' = ' + value);
          ctx.declared.add(n.name);
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
          const prompt = p ? toStr(ctx, p) : '""';
          if (tt === 'integer') { used.num = true; line(ctx, target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ')'); }
          else { used.text = true; line(ctx, target(ctx, n.target) + ' = ' + H.text + '(' + prompt + ')'); }
          return;
        }
        case 'output': {
          comment(ctx, n);
          const ast = tryParse(n.expr);
          line(ctx, 'print(' + (ast ? ex(ctx, strip(ast)) : '""') + ')');
          return;
        }
        case 'if':
          comment(ctx, n);
          line(ctx, 'if ' + cond(ctx, n.cond) + ' then');
          block(ctx, n.then);
          if (n.else && n.else.length) {
            if (n.else.length === 1 && n.else[0].kind === 'if' && !n.else[0].comment) {
              const save = ctx.lines.length;
              genStmt(ctx, n.else[0]);
              ctx.lines[save] = ctx.lines[save].replace(/^(\s*)if /, '$1elseif ');
              return; // das "end" des inneren WENN schließt die ganze Kette
            }
            line(ctx, 'else');
            block(ctx, n.else);
          }
          line(ctx, 'end');
          return;
        case 'while':
          comment(ctx, n);
          line(ctx, 'while ' + cond(ctx, n.cond) + ' do');
          block(ctx, n.body);
          line(ctx, 'end');
          return;
        case 'until':
          comment(ctx, n);
          line(ctx, 'repeat');
          block(ctx, n.body);
          line(ctx, 'until ' + cond(ctx, n.cond));
          return;
        case 'for': {
          comment(ctx, n);
          const ct = tryTarget(n.counter);
          const k = target(ctx, n.counter);
          const from = ex(ctx, tryParse(n.from) || { k: 'num', v: 0, raw: '0' });
          const toAst = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          // echtes "for" nur, wenn Zähler und Grenze im Rumpf nicht verändert werden und der Zähler
          // nach der Schleife nicht mehr gebraucht wird (Luas Zähler gilt nur in der Schleife)
          const inner = A.writtenNames(program, { body: n.body });
          const reads = new Set();
          const collect = (x) => { if (!x) return; if (x.k === 'id') reads.add(x.name); if (x.k !== 'len') ['a', 'b', 'e', 'obj', 'index'].forEach((key) => collect(x[key])); };
          collect(toAst);
          const v = ct && ct.k === 'id' ? ctx.scope.get(ct.name) : null;
          const simple = typeof lit === 'number' && lit !== 0 && v && v.kind !== 'result' && !(v.kind === 'param' && v.byRef) &&
            !inner.has(ct.name) && ![...reads].some((r) => inner.has(r)) && !usedOutsideLoops(ctx.fn.body, ct.name);
          if (simple) {
            line(ctx, 'for ' + k + ' = ' + from + ', ' + ex(ctx, toAst) + (lit === 1 ? '' : ', ' + lit) + ' do');
            block(ctx, n.body);
            line(ctx, 'end');
            return;
          }
          const to = ex(ctx, toAst, 4);
          const s = stepAst ? ex(ctx, stepAst, 6) : '1';
          let c;
          if (typeof lit === 'number') c = k + (lit >= 0 ? ' <= ' : ' >= ') + to;
          else c = '(' + s + ' > 0 and ' + k + ' <= ' + to + ') or (' + s + ' < 0 and ' + k + ' >= ' + to + ')';
          line(ctx, k + ' = ' + from);
          line(ctx, 'while ' + c + ' do');
          block(ctx, n.body);
          ctx.ind++; line(ctx, k + ' = ' + k + (typeof lit === 'number' && lit < 0 ? ' - ' + (-lit) : ' + ' + s)); ctx.ind--;
          line(ctx, 'end');
          return;
        }
        case 'switch': {
          comment(ctx, n);
          const sel = tryParse(n.expr);
          const s = sel ? ex(ctx, strip(sel), 4) : '0';
          n.cases.forEach((c, i) => {
            const v = tryParse(c.value);
            line(ctx, (i ? 'elseif ' : 'if ') + s + ' == ' + (v ? ex(ctx, strip(v), 4) : '0') + ' then');
            block(ctx, c.body);
          });
          if (n.else && n.else.length) {
            if (n.cases.length) { line(ctx, 'else'); block(ctx, n.else); } else genSeq(ctx, n.else);
          }
          if (n.cases.length) line(ctx, 'end');
          return;
        }
        case 'call': {
          comment(ctx, n);
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, '-- ' + (n.fn || '?') + '(…)'); return; }
          const args = callee.params.map((p, i) => {
            const src = n.args[i] || '';
            if (p.byRef || A.isArrayType(p.type)) return target(ctx, src);
            return valueFor(ctx, src, p.type);
          });
          let call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
          const lhs = [];
          const hasRes = callee.returnType !== 'void';
          const hasTarget = hasRes && n.target && n.target.trim();
          if (hasRes) lhs.push(hasTarget ? target(ctx, n.target) : '_');
          callee.params.forEach((p, i) => { if (p.byRef && !A.isArrayType(p.type)) lhs.push(target(ctx, n.args[i] || '')); });
          if (!hasTarget && lhs.length === 1 && hasRes) { line(ctx, call); return; }
          if (!lhs.length) { line(ctx, call); return; }
          if (lhs.length === 1 && hasTarget) {
            const tt = targetType(ctx, n.target);
            if (tt === 'string' && callee.returnType !== 'string') call = 'tostring(' + call + ')';
            else if (tt === 'integer' && callee.returnType === 'string') { used.toNum = true; call = 'to_num(' + call + ')'; }
          }
          if (lhs[0] === '_') ctx.discard = true;
          line(ctx, lhs.join(', ') + ' = ' + call);
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    const fns = program.fns.filter((f) => !f.isMain);
    for (const fn of fns) { genFunction(fn); body.push(''); }
    genFunction(program.fns.find((f) => f.isMain));

    const out = ['-- ' + tr('luaHeader1'), '-- ' + tr('luaHeader2'), ''];
    const P = (...s) => out.push(...s);
    if (used.idiv) {
      P('-- ' + tr('luaHelperDivDoc'));
      P('local function idiv(a, b)');
      P(IND + 'local q = a // b');
      P(IND + 'if q < 0 and q * b ~= a then q = q + 1 end');
      P(IND + 'return q');
      P('end', '');
    }
    if (used.trunc) {
      P('local function trunc(x)');
      P(IND + 'if x < 0 then return math.ceil(x) end');
      P(IND + 'return math.floor(x)');
      P('end', '');
    }
    if (used.toNum) {
      P('local function to_num(s)');
      P(IND + 'local n = tonumber(s)');
      P(IND + 'if n == nil then return 0 end');
      P(IND + 'return math.tointeger(n) or n');
      P('end', '');
    }
    if (used.arr) {
      P('-- ' + tr('luaHelperArrayDoc'));
      P('local function new_array(n, value)');
      P(IND + 'local a = { n = n }');
      P(IND + 'for i = 0, n - 1 do a[i] = value end');
      P(IND + 'return a');
      P('end', '');
    }
    if (used.text) {
      P('local function ' + H.text + '(' + q + ')');
      P(IND + 'io.write(' + q + ')');
      P(IND + 'local s = io.read("l")');
      P(IND + 'if s == nil then return "" end');
      P(IND + 'return (s:gsub("\\r$", ""))');
      P('end', '');
    }
    if (used.num) {
      P('-- ' + tr('javaHelperNumDoc'));
      P('local function ' + H.num + '(' + q + ')');
      P(IND + 'while true do');
      P(IND + IND + 'io.write(' + q + ')');
      P(IND + IND + 'local s = io.read("l")');
      P(IND + IND + 'if s == nil then return 0 end');
      P(IND + IND + 's = s:match("^%s*(.-)%s*$")');
      P(IND + IND + 'if s:match("^[+-]?%d+$") then return math.tointeger(tonumber(s)) end');
      P(IND + IND + 'print(' + luaStr(tr('javaNeedInt')) + ')');
      P(IND + 'end');
      P('end', '');
    }
    if (fns.length) P('local ' + fns.map((f) => fnName.get(f.name)).join(', '), '');
    P(...body, '', 'main()');
    return out.join('\n') + '\n';
  }

  BBE.luagen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
