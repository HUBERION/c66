/* Blockbild-Editor – Übersetzung nach Rust (stable, Edition 2021, eine Datei: rustc datei.rs)
 *
 *   Zahl → i64 (rechnet wie C: / schneidet ab, % hat das Vorzeichen des Dividenden),
 *   Text → String, Zahl[]/Text[] → Vec<i64>/Vec<String> (feste Länge aus der Deklaration).
 *   InOut-Zahl/-Text → &mut (im Rumpf *a), Arrays immer &mut Vec<…>, Indizes mit "as usize".
 *   Variablen gelten im ganzen Unterprogramm: verschachtelte/doppelte Deklarationen werden mit
 *   Standardwert an den Anfang gehoben, die Deklaration selbst wird zur Zuweisung.
 *   ZÄHLE → while-Schleife (Zähler nach der Schleife = letzter Wert + Schritt, Ende wird jedes Mal
 *   neu ausgewertet – wie in C), WIEDERHOLE…BIS → loop { …; if bed { break; } }.
 *
 *   Rust erlaubt nicht zwei &mut auf dasselbe Array (z. B. tausche(a[j], a[j + 1])) und auch nicht,
 *   eine Variable zu lesen, während sie als &mut ausgeliehen ist. Array-Elemente als InOut-Argument
 *   werden deshalb in eine Hilfsvariable kopiert und nach dem Aufruf zurückgeschrieben; Werte-Argumente,
 *   die eine gleichzeitig ausgeliehene Variable lesen, werden vorher ausgerechnet. Unterschied zur
 *   Simulation nur, wenn das Unterprogramm dasselbe Element zusätzlich über einen anderen Weg ändert.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip, walk } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  // Schlüsselwörter (auch reservierte) und Namen, die als Variable nicht gehen (Muster wie None/Some/Ok/Err)
  const RESERVED = new Set(('as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref ' +
    'return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro ' +
    'override priv typeof unsized virtual yield try gen union macro_rules main Some None Ok Err Option Result String Vec Box std core ' +
    'alloc print println format').split(' '));
  const RT = { integer: 'i64', string: 'String', 'integer[]': 'Vec<i64>', 'string[]': 'Vec<String>' };
  const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  const CMP = ['==', '!=', '<', '<=', '>', '>='];
  // Vorrang: || 1, && 2, Vergleiche 3 (in Rust nicht verkettbar), + - 5, * / % 6, as 7, unär 8, Aufruf/Index 9

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };

  /** Inhalt eines Rust-Textliterals (ohne Anführungszeichen). */
  function esc(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === '\\') out += '\\\\';
      else if (ch === '"') out += '\\"';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (c < 0x20 || c === 0x7f) out += '\\u{' + c.toString(16) + '}';
      else out += ch;
    }
    return out;
  }
  const rsStr = (s) => '"' + esc(s) + '"';
  const fmtEsc = (s) => esc(s).replace(/\{/g, '{{').replace(/\}/g, '}}');

  const isFloatLit = (a) => a.k === 'num' && /[.eE]/.test(a.raw) && !/^0[xX]/.test(a.raw);
  function hasFloat(ast) {
    let hit = false;
    walk(ast, (a) => { if (isFloatLit(a)) hit = true; });
    return hit;
  }
  function idsOf(ast) {
    const out = new Set();
    walk(ast, (a) => { if (a.k === 'id') out.add(a.name); });
    return out;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { num: tr('pyHelperNum'), line: tr('fortReadLine') };
    const used = { num: false, line: false };
    const helperNames = new Set([H.num, H.line]);
    const fnName = new Map(program.fns.map((f) => [f.name, RESERVED.has(f.name) || helperNames.has(f.name) ? f.name + '_' : f.name]));
    const rustFnNames = new Set([...fnName.values(), ...helperNames]);
    const body = [];

    const defaultFor = (t) => (t === 'string' ? 'String::new()' : A.isArrayType(t) ? 'Vec::new()' : '0');
    const withComment = (code, n) => (n && n.comment ? code + '  // ' + n.comment.replace(/\s+/g, ' ') : code);
    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || (RESERVED.has(n) || rustFnNames.has(n) ? n + '_' : n);
    const wrap = (s, p, minPrec) => (p < minPrec ? '(' + s + ')' : s);

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    // ------------------------------------------------------------ Funktionen

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const written = A.writtenNames(program, fn);
      const declCount = new Map();
      M.walkSeq(fn.body, (n) => { if (n.kind === 'decl' && n.name) declCount.set(n.name, (declCount.get(n.name) || 0) + 1); });
      const rename = new Map();
      for (const n of scope.keys()) rename.set(n, RESERVED.has(n) || rustFnNames.has(n) ? n + '_' : n);
      const ctx = {
        fn, scope, rename, ind: 1, lines: body, tmp: 0,
        declared: new Set(fn.params.map((p) => p.name)), hoisted: new Set(),
        refs: new Set(fn.params.filter((p) => p.byRef && !A.isArrayType(p.type)).map((p) => p.name)),
        arrParams: new Set(fn.params.filter((p) => A.isArrayType(p.type)).map((p) => p.name)),
        taken: new Set([...rename.values(), ...rustFnNames])
      };
      ctx.isMut = (n) => written.has(n) || ctx.hoisted.has(n) || (declCount.get(n) || 0) > 1;
      // Variablen gelten im Blockbild im ganzen Unterprogramm → verschachtelte/doppelte Deklarationen an den Anfang
      const top = new Set();
      for (const n of fn.body) if (n.kind === 'decl' && n.name && !top.has(n.name)) top.add(n.name);
      M.walkSeq(fn.body, (n, seq, i, depth) => { if (n.kind === 'decl' && n.name && (depth > 0 || !top.has(n.name))) ctx.hoisted.add(n.name); });

      let sig;
      if (fn.isMain) sig = 'fn main()';
      else {
        const ps = fn.params.map((p) => {
          const n = name(ctx, p.name || 'p');
          if (A.isArrayType(p.type)) return n + ': &mut ' + RT[p.type];
          if (p.byRef) return n + ': &mut ' + RT[p.type];
          return (written.has(p.name) || declCount.has(p.name) ? 'mut ' : '') + n + ': ' + RT[p.type];
        });
        sig = 'fn ' + fnName.get(fn.name) + '(' + ps.join(', ') + ')' + (fn.returnType === 'void' ? '' : ' -> ' + RT[fn.returnType]);
      }
      body.push(sig + ' {');
      if (!fn.isMain && fn.returnType !== 'void') {
        const r = A.RESULT;
        line(ctx, 'let ' + (written.has(r) || declCount.has(r) ? 'mut ' : '') + name(ctx, r) + ': ' + RT[fn.returnType] + ' = ' +
          valueFor(ctx, fn.resultInit, fn.returnType) + ';');
        ctx.declared.add(r);
      }
      for (const n of ctx.hoisted) {
        const v = scope.get(n);
        if (!v || ctx.declared.has(n)) continue;
        line(ctx, 'let mut ' + name(ctx, n) + ': ' + RT[v.type] + ' = ' + defaultFor(v.type) + ';');
        ctx.declared.add(n);
      }
      genSeq(ctx, fn.body);
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, name(ctx, A.RESULT));
      body.push('}');
    }

    /** Neuer Name für eine Hilfsvariable, der mit nichts im Unterprogramm kollidiert. */
    function newTmp(ctx) {
      let n;
      do { n = 'tmp' + (++ctx.tmp); } while (ctx.taken.has(n));
      ctx.taken.add(n);
      return n;
    }

    // ------------------------------------------------------------ Ausdrücke

    /** Empfänger eines Methodenaufrufs (.len(), .clone() …): Referenzen ohne * (Rust dereferenziert selbst). */
    function recvr(ctx, a) {
      const s = strip(a);
      if (s.k === 'id') return name(ctx, s.name);
      return ex(ctx, s, 9);
    }

    function index(ctx, a) {
      const s = strip(a);
      if (s.k === 'num' && !isFloatLit(s)) return s.raw;
      return ex(ctx, s, 8) + ' as usize';
    }

    function ex(ctx, a, minPrec = 0) {
      switch (a.k) {
        case 'num': return isFloatLit(a) ? String(Math.trunc(a.v)) : a.raw;
        case 'str': return rsStr(a.v);
        // Klammern setzt der Generator selbst nach Vorrang (überflüssige würde rustc anmahnen)
        case 'paren': return ex(ctx, a.e, minPrec);
        case 'id': return ctx.refs.has(a.name) ? wrap('*' + name(ctx, a.name), 8, minPrec) : name(ctx, a.name);
        case 'idx': return recvr(ctx, a.obj) + '[' + index(ctx, a.index) + ']';
        case 'len': {
          const t = typeOf(ctx, a.obj);
          return wrap(recvr(ctx, a.obj) + (A.isArrayType(t) ? '.len()' : '.chars().count()') + ' as i64', 7, minPrec);
        }
        case 'un':
          if (a.op === '!') return notCode(ctx, a.a, minPrec);
          if (a.op === '+') return ex(ctx, a.a, minPrec);
          if (hasFloat(a)) return wrap(exF(ctx, a, 8) + ' as i64', 7, minPrec);
          {
            const inner = ex(ctx, a.a, 8);
            return wrap('-' + (inner.startsWith('-') ? ' ' : '') + inner, 8, minPrec);
          }
        case 'bin': {
          const p = PREC[a.op];
          if (a.op === '&&' || a.op === '||') return wrap(boolCode(ctx, a.a, p) + ' ' + a.op + ' ' + boolCode(ctx, a.b, p + 1), p, minPrec);
          if (a.op === '+' && typeOf(ctx, a) === 'string') return textConcat(ctx, a);
          if (CMP.includes(a.op)) {
            const ta = typeOf(ctx, a.a), tb = typeOf(ctx, b(a));
            let l, r;
            if (ta === 'string' || tb === 'string') {
              if (a.op === '==' || a.op === '!=') { l = ex(ctx, a.a, 5); r = ex(ctx, a.b, 5); }
              else { l = strSide(ctx, a.a); r = strSide(ctx, a.b); }
            } else if (hasFloat(a.a) || hasFloat(a.b)) { l = exF(ctx, a.a, 5); r = exF(ctx, a.b, 5); }
            else { l = ex(ctx, a.a, 5); r = ex(ctx, a.b, 5); }
            // "x as i64 < y" liest Rust als Typ mit Parametern → Klammern
            if (/ as (i64|usize|f64)$/.test(l) && a.op[0] === '<') l = '(' + l + ')';
            return wrap(l + ' ' + a.op + ' ' + r, p, minPrec);
          }
          if (hasFloat(a)) return wrap(exF(ctx, a, 8) + ' as i64', 7, minPrec);
          return wrap(ex(ctx, a.a, p) + ' ' + a.op + ' ' + ex(ctx, a.b, p + 1), p, minPrec);
        }
        default: return '0';
      }
    }
    const b = (a) => a.b;

    /** Text für <, <=, >, >=: String hat diese Vergleiche nur mit String → beide Seiten als &str. */
    function strSide(ctx, a) {
      const s = strip(a);
      if (s.k === 'str') return rsStr(s.v);
      return recvr(ctx, s) + '.as_str()';
    }

    /** Ausdruck mit Kommazahl-Literal als f64 (Teilausdrücke ohne Kommazahl bleiben ganzzahlig wie in C). */
    function exF(ctx, a, minPrec = 0) {
      if (!hasFloat(a)) return wrap(ex(ctx, a, 8) + ' as f64', 7, minPrec);
      switch (a.k) {
        case 'num': {
          let s = String(a.v);
          if (!/[.eE]/.test(s)) s += '.0';
          return s;
        }
        case 'paren': return exF(ctx, a.e, minPrec);
        case 'un':
          if (a.op === '+') return exF(ctx, a.a, minPrec);
          if (a.op === '-') return wrap('-' + exF(ctx, a.a, 8), 8, minPrec);
          return ex(ctx, a, minPrec);
        case 'bin':
          if ('+-*/%'.includes(a.op) && typeOf(ctx, a) !== 'string') {
            const p = PREC[a.op];
            return wrap(exF(ctx, a.a, p) + ' ' + a.op + ' ' + exF(ctx, a.b, p + 1), p, minPrec);
          }
          return ex(ctx, a, minPrec);
        default: return ex(ctx, a, minPrec);
      }
    }

    /** Wert als bool (Zahlen ≠ 0 und nicht leere Texte gelten als wahr). */
    function boolCode(ctx, ast, minPrec = 0) {
      const s = strip(ast);
      const t = typeOf(ctx, s);
      if (t === 'integer') return wrap(ex(ctx, s, 5) + ' != 0', 3, minPrec);
      if (t === 'string') return wrap('!' + recvr(ctx, s) + '.is_empty()', 8, minPrec);
      return ex(ctx, s, minPrec);
    }
    function notCode(ctx, ast, minPrec) {
      const s = strip(ast);
      const t = typeOf(ctx, s);
      if (t === 'integer') return wrap(ex(ctx, s, 5) + ' == 0', 3, minPrec);
      if (t === 'string') return recvr(ctx, s) + '.is_empty()';
      return wrap('!' + ex(ctx, s, 8), 8, minPrec);
    }

    /** Teile einer Text-Verkettung von links nach rechts. */
    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [s];
    }

    /** Formatzeichenkette + Argumente für format!/println!: Literale direkt, alles andere als {}. */
    function fmtOf(ctx, ast) {
      let fmt = '';
      const args = [];
      const list = typeOf(ctx, ast) === 'string' ? parts(ctx, ast) : [strip(ast)];
      for (const p of list) {
        if (p.k === 'str') fmt += fmtEsc(p.v);
        else if (p.k === 'num' && !isFloatLit(p)) fmt += p.raw.replace(/^0+(?=\d)/, '');
        else { fmt += '{}'; args.push(hasFloat(p) ? exF(ctx, p) : ex(ctx, p)); }
      }
      return { fmt, args };
    }

    function textConcat(ctx, ast) {
      const { fmt, args } = fmtOf(ctx, ast);
      if (!args.length) return 'String::from("' + fmt.replace(/\{\{/g, '{').replace(/\}\}/g, '}') + '")';
      return 'format!("' + fmt + '", ' + args.join(', ') + ')';
    }

    /** Wert für eine Variable vom Typ type (String-Werte als eigener String, Zahlen als i64). */
    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || defaultFor(type);
      const s = strip(ast);
      const t = typeOf(ctx, s);
      if (type === 'string') {
        if (t === 'string') {
          if (s.k === 'str') return s.v === '' ? 'String::new()' : 'String::from(' + rsStr(s.v) + ')';
          if (s.k === 'id' || s.k === 'idx') return recvr(ctx, s) + '.clone()';
          return ex(ctx, s);
        }
        if (hasFloat(s)) return 'format!("{}", ' + exF(ctx, s) + ')';
        return ex(ctx, s, 9) + '.to_string()';
      }
      if (type === 'integer') {
        if (t === 'string') return recvr(ctx, s) + '.trim().parse::<i64>().unwrap_or(0)';
        if (t === 'bool') return ex(ctx, s, 8) + ' as i64';
      }
      return ex(ctx, s);
    }

    function cond(ctx, src) {
      const ast = tryParse(src);
      return ast ? boolCode(ctx, ast) : (String(src || '').trim() || 'true');
    }

    /** Eingabe-Frage als &str. */
    function promptArg(ctx, src) {
      const ast = tryParse(src);
      if (!ast) return '""';
      const s = strip(ast);
      const t = typeOf(ctx, s);
      if (s.k === 'str') return rsStr(s.v);
      if (t === 'string') return '&' + ex(ctx, s, 8);
      return '&' + valueFor(ctx, src, 'string');
    }

    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const rootOf = (t) => (t ? (t.k === 'id' ? t.name : t.obj.name) : null);

    function convert(code, from, to) {
      if (to === 'string' && from !== 'string') return code + '.to_string()';
      if (to === 'integer' && from === 'string') return code + '.trim().parse::<i64>().unwrap_or(0)';
      return code;
    }

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, ('// ' + l).trimEnd());
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          let value;
          if (n.vtype.endsWith('[]')) {
            const len = tryParse(n.length) || { k: 'num', v: 0, raw: '0' };
            value = 'vec![' + (n.vtype === 'string[]' ? 'String::new()' : '0') + '; ' + index(ctx, len) + ']';
          } else value = valueFor(ctx, n.init, n.vtype);
          if (ctx.declared.has(n.name)) {
            line(ctx, withComment((ctx.refs.has(n.name) || ctx.arrParams.has(n.name) ? '*' : '') + nm + ' = ' + value + ';', n));
          } else {
            line(ctx, withComment('let ' + (ctx.isMut(n.name) ? 'mut ' : '') + nm + ': ' + RT[n.vtype] + ' = ' + value + ';', n));
            ctx.declared.add(n.name);
          }
          return;
        }
        case 'assign':
          line(ctx, withComment(target(ctx, n.target) + ' = ' + valueFor(ctx, n.expr, targetType(ctx, n.target)) + ';', n));
          return;
        case 'input': {
          const tt = targetType(ctx, n.target);
          const prompt = promptArg(ctx, n.prompt);
          used.line = true;
          if (tt === 'integer') { used.num = true; line(ctx, withComment(target(ctx, n.target) + ' = ' + H.num + '(' + prompt + ');', n)); }
          else line(ctx, withComment(target(ctx, n.target) + ' = ' + H.line + '(' + prompt + ').unwrap_or_default();', n));
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          if (!ast) { line(ctx, withComment('println!();', n)); return; }
          const { fmt, args } = fmtOf(ctx, ast);
          line(ctx, withComment('println!("' + fmt + '"' + args.map((x) => ', ' + x).join('') + ');', n));
          return;
        }
        case 'if':
          line(ctx, withComment('if ' + cond(ctx, n.cond) + ' {', n));
          block(ctx, n.then);
          if (n.else && n.else.length) {
            if (n.else.length === 1 && n.else[0].kind === 'if' && !n.else[0].comment) {
              // SONST WENN → else if
              const save = ctx.lines.length;
              genStmt(ctx, n.else[0]);
              ctx.lines[save] = IND.repeat(ctx.ind) + '} else ' + ctx.lines[save].trim();
              return;
            }
            line(ctx, '} else {');
            block(ctx, n.else);
          }
          line(ctx, '}');
          return;
        case 'while': {
          const c = cond(ctx, n.cond);
          line(ctx, withComment(c === 'true' ? 'loop {' : 'while ' + c + ' {', n));
          block(ctx, n.body);
          line(ctx, '}');
          return;
        }
        case 'until':
          line(ctx, withComment('loop {', n));
          block(ctx, n.body);
          ctx.ind++;
          line(ctx, 'if ' + cond(ctx, n.cond) + ' {');
          line(ctx, IND + 'break;');
          line(ctx, '}');
          ctx.ind--;
          line(ctx, '}');
          return;
        case 'for': {
          // wie in C: Ende und Schritt werden bei jedem Durchlauf neu ausgewertet
          const k = target(ctx, n.counter);
          const zero = { k: 'num', v: 0, raw: '0' };
          const to = ex(ctx, tryParse(n.to) || zero, 5);
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          line(ctx, withComment(k + ' = ' + valueFor(ctx, n.from, 'integer') + ';', n));
          if (typeof lit === 'number' && Number.isInteger(lit) && lit !== 0) {
            line(ctx, 'while ' + k + (lit > 0 ? ' <= ' : ' >= ') + to + ' {');
            block(ctx, n.body);
            line(ctx, IND + k + (lit > 0 ? ' += ' + lit : ' -= ' + (-lit)) + ';');
          } else {
            const s = ex(ctx, stepAst || zero, 5);
            line(ctx, 'loop {');
            line(ctx, IND + 'if ' + s + ' > 0 && ' + k + ' > ' + to + ' || ' + s + ' <= 0 && ' + k + ' < ' + to + ' {');
            line(ctx, IND + IND + 'break;');
            line(ctx, IND + '}');
            block(ctx, n.body);
            line(ctx, IND + k + ' += ' + ex(ctx, stepAst || zero, 5) + ';');
          }
          line(ctx, '}');
          return;
        }
        case 'switch': {
          const sel = tryParse(n.expr);
          const vals = n.cases.map((c) => { const v = tryParse(c.value); return v ? A.literalValue(v) : undefined; });
          const asMatch = sel && typeOf(ctx, sel) !== 'string' && !hasFloat(sel) &&
            vals.every((v, i) => Number.isInteger(v) && vals.indexOf(v) === i && !hasFloat(tryParse(n.cases[i].value)));
          if (asMatch) {
            line(ctx, withComment('match ' + ex(ctx, strip(sel)) + ' {', n));
            ctx.ind++;
            n.cases.forEach((c, i) => {
              if (!c.body.length) { line(ctx, vals[i] + ' => {}'); return; }
              line(ctx, vals[i] + ' => {');
              block(ctx, c.body);
              line(ctx, '}');
            });
            if (n.else && n.else.length) { line(ctx, '_ => {'); block(ctx, n.else); line(ctx, '}'); }
            else line(ctx, '_ => {}');
            ctx.ind--;
            line(ctx, '}');
            return;
          }
          // Text oder keine festen Zahlen → if / else if
          const s = sel ? ex(ctx, strip(sel), 5) : '0';
          n.cases.forEach((c, i) => {
            const v = tryParse(c.value);
            const test = s + ' == ' + (v ? ex(ctx, strip(v), 5) : '0');
            line(ctx, i === 0 ? withComment('if ' + test + ' {', n) : '} else if ' + test + ' {');
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
        case 'call': genCall(ctx, n); return;
        default: return;
      }
    }

    function genCall(ctx, n) {
      const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
      if (!callee) { line(ctx, withComment('// ' + (n.fn || '?') + '(…)', n)); return; }
      // 1. Durchgang: welche Variablen werden direkt als &mut ausgeliehen, welche Argumente brauchen eine Kopie?
      const direct = new Set();
      const kind = callee.params.map((p, i) => {
        if (!(p.byRef || A.isArrayType(p.type))) return 'value';
        const t = tryTarget(n.args[i] || '');
        if (!t) return 'raw';
        if (A.isArrayType(p.type)) { direct.add(rootOf(t)); return 'direct'; }
        if (t.k === 'id' && !direct.has(t.name)) { direct.add(t.name); return 'direct'; }
        return 'copy';
      });
      const touched = new Set(direct);
      callee.params.forEach((p, i) => { if (kind[i] === 'copy') touched.add(rootOf(tryTarget(n.args[i]))); });
      // 2. Durchgang: Argumente erzeugen
      const pre = [], post = [], copyRoots = new Set();
      const args = callee.params.map((p, i) => {
        const src = n.args[i] || '';
        if (kind[i] === 'raw') return String(src).trim() || '_';
        if (kind[i] === 'direct') {
          const t = tryTarget(src);
          const nm = name(ctx, t.name || rootOf(t));
          return ctx.refs.has(t.name) || ctx.arrParams.has(t.name) ? nm : '&mut ' + nm;
        }
        if (kind[i] === 'copy') {
          const t = tryTarget(src);
          let place;
          if (t.k === 'idx') {
            let ix = index(ctx, t.index);
            if ([...idsOf(t.index)].some((x) => touched.has(x))) {
              const it = newTmp(ctx);
              pre.push('let ' + it + ' = ' + ix + ';');
              ix = it;
            }
            place = recvr(ctx, t.obj) + '[' + ix + ']';
          } else place = ex(ctx, t);
          copyRoots.add(rootOf(t));
          const tmp = newTmp(ctx);
          pre.push('let mut ' + tmp + ' = ' + place + (p.type === 'string' ? '.clone()' : '') + ';');
          post.push(place + ' = ' + tmp + ';');
          return '&mut ' + tmp;
        }
        const v = valueFor(ctx, src, p.type);
        const ast = tryParse(src);
        if (ast && [...idsOf(ast)].some((x) => direct.has(x))) {
          const tmp = newTmp(ctx);
          pre.push('let ' + tmp + ' = ' + v + ';');
          return tmp;
        }
        return v;
      });
      let call = fnName.get(callee.name) + '(' + args.join(', ') + ')';
      const hasTarget = callee.returnType !== 'void' && n.target && n.target.trim();
      const stmts = pre.slice();
      if (hasTarget) {
        const tt = targetType(ctx, n.target);
        call = convert(call, callee.returnType, tt);
        const tRoot = rootOf(tryTarget(n.target));
        if (post.length && copyRoots.has(tRoot)) {
          const r = newTmp(ctx);
          stmts.push('let ' + r + ' = ' + call + ';', ...post, target(ctx, n.target) + ' = ' + r + ';');
        } else stmts.push(target(ctx, n.target) + ' = ' + call + ';', ...post);
      } else stmts.push(call + ';', ...post);
      if (stmts.length === 1) { line(ctx, withComment(stmts[0], n)); return; }
      line(ctx, withComment('{', n));
      ctx.ind++;
      if (post.length) line(ctx, '// ' + tr('rustCopyNote'));
      for (const s of stmts) line(ctx, s);
      ctx.ind--;
      line(ctx, '}');
    }

    // ------------------------------------------------------------ Zusammenbau

    genFunction(program.fns.find((f) => f.isMain));
    for (const fn of program.fns.filter((f) => !f.isMain)) { body.push(''); genFunction(fn); }

    const out = ['// ' + tr('rustHeader1'), '// ' + tr('rustHeader2'),
      '#![allow(non_snake_case, unused_variables, unused_assignments, dead_code)]', ''];
    if (used.line) out.push('use std::io::Write;', '');
    out.push(...body);
    const q = tr('genArgPrompt');
    const w = tr('genArgValue');
    if (used.line) {
      out.push('');
      out.push('/// ' + tr('rustHelperReadDoc'));
      out.push('fn ' + H.line + '(' + q + ': &str) -> Option<String> {');
      out.push(IND + 'print!("{}", ' + q + ');');
      out.push(IND + 'std::io::stdout().flush().unwrap();');
      out.push(IND + 'let mut ' + w + ' = String::new();');
      out.push(IND + 'match std::io::stdin().read_line(&mut ' + w + ') {');
      out.push(IND + IND + 'Ok(0) | Err(_) => None,');
      out.push(IND + IND + "Ok(_) => Some(" + w + ".trim_end_matches(|c: char| c == '\\n' || c == '\\r').to_string()),");
      out.push(IND + '}');
      out.push('}');
    }
    if (used.num) {
      out.push('');
      out.push('/// ' + tr('javaHelperNumDoc'));
      out.push('fn ' + H.num + '(' + q + ': &str) -> i64 {');
      out.push(IND + 'loop {');
      out.push(IND + IND + 'match ' + H.line + '(' + q + ') {');
      out.push(IND + IND + IND + 'None => return 0,');
      out.push(IND + IND + IND + 'Some(' + w + ') => match ' + w + '.trim().parse::<i64>() {');
      out.push(IND + IND + IND + IND + 'Ok(n) => return n,');
      out.push(IND + IND + IND + IND + 'Err(_) => println!(' + rsStr(tr('javaNeedInt')) + '),');
      out.push(IND + IND + IND + '},');
      out.push(IND + IND + '}');
      out.push(IND + '}');
      out.push('}');
    }
    return out.join('\n') + '\n';
  }

  BBE.rustgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
