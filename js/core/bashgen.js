/* Blockbild-Editor – Übersetzung nach bash (4.3 oder neuer)
 *
 *   Zahl → ganze Zahl in $(( … )) (rechnet wie C: / schneidet ab, % hat das Vorzeichen des Dividenden).
 *   Text → Variable in "…".
 *   Arrays: der Inhalt liegt in einem globalen Feld (_a1, _a2, …); die Variable ist eine Namensreferenz
 *   (local -n) darauf. So lassen sich Arrays an Unterprogramme übergeben ("${!zahlen}" = Name des Felds),
 *   auch rekursiv, ohne dass gleichnamige lokale Variablen stören.
 *   Unterprogramme sind bash-Funktionen mit local-Variablen. Rückgabewert und InOut-Werte stehen danach
 *   im globalen Array _ret (wie in Python: Rückgabe statt Referenz).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '  ';
  const RESERVED = new Set(('if then else elif fi case esac for select while until do done in function time coproc declare local ' +
    'export readonly typeset unset set shift read echo printf test true false exit return break continue eval exec source alias ' +
    'cd pwd type let main PATH HOME IFS REPLY RANDOM SECONDS LINENO PWD OLDPWD UID EUID PPID HOSTNAME SHELL USER LANG ' +
    'LC_ALL LC_COLLATE TERM OPTIND OPTARG BASH').split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  /** Inhalt für "…": \ " $ ` maskieren. */
  const dq = (s) => String(s).replace(/[\\"$`]/g, (c) => '\\' + c);

  function asciiName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(s)) s = 'v' + s;
    if (RESERVED.has(s) || s.startsWith('BASH')) s += '_';
    return s;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const H = { num: tr('pyHelperNum'), text: tr('bashHelperText'), arr: tr('bashNewArray') };
    const used = { num: false, text: false, arr: false, collate: false };
    const fnName = new Map();
    const taken = new Set([H.num, H.text, H.arr]);
    for (const f of program.fns.filter((x) => !x.isMain)) {
      let n = asciiName(f.name);
      while (taken.has(n)) n += '_';
      taken.add(n);
      fnName.set(f.name, n);
    }
    const body = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || asciiName(n);
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function comment(ctx, n) { if (n && n.comment) line(ctx, '# ' + n.comment.replace(/\s+/g, ' ')); }
    function block(ctx, seq) {
      ctx.ind++;
      const before = ctx.lines.length;
      for (const n of seq) genStmt(ctx, n);
      if (ctx.lines.length === before) line(ctx, ':');
      ctx.ind--;
    }

    // ------------------------------------------------------------ Ausdrücke

    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

    /** Rechenausdruck für $(( … )) – Variablen ohne $. */
    function num(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return Number.isInteger(a.v) ? a.raw : String(Math.trunc(a.v));
        case 'str': return /^-?\d+$/.test(a.v) ? a.v : '0';
        case 'paren': return '(' + num(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': return name(ctx, strip(a.obj).name) + '[' + num(ctx, a.index) + ']';
        case 'len': {
          const o = strip(a.obj);
          if (A.isArrayType(typeOf(ctx, o))) return '${#' + name(ctx, o.name) + '[@]}';
          if (o.k === 'id') return '${#' + name(ctx, o.name) + '}';
          return '${#' + name(ctx, strip(o.obj).name) + '[' + num(ctx, o.index) + ']}';
        }
        case 'un': return wrap(a.op + (a.op === '-' && strip(a.a).k === 'un' ? ' ' : '') + num(ctx, a.a, 7), 7);
        case 'bin': {
          // bash kennt keine Kommazahlen: x * 1.25 → x * 5 / 4 (gleiches Ergebnis wie (int)(x * 1.25))
          const fa = strip(a.a), fb = strip(a.b);
          if (a.op === '*' && (isFrac(fa) || isFrac(fb))) {
            const [f, other] = isFrac(fb) ? [fb, a.a] : [fa, a.b];
            const [p, q] = fraction(f.raw);
            return wrap(num(ctx, other, 6) + ' * ' + p + ' / ' + q, 6);
          }
          const p = PREC[a.op];
          return wrap(num(ctx, a.a, p) + ' ' + a.op + ' ' + num(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    const isFrac = (s) => s.k === 'num' && !Number.isInteger(s.v);
    /** "1.25" → [5, 4] */
    function fraction(raw) {
      const [i, d = ''] = String(raw).split('.');
      let p = parseInt(i + d, 10), q = Math.pow(10, d.length);
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      const g = gcd(Math.abs(p), q);
      return [p / g, q / g];
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [ast];
    }

    /** Inhalt eines "…"-Texts. */
    function text(ctx, ast) {
      return parts(ctx, ast).map((p) => {
        const s = strip(p);
        const t = typeOf(ctx, s);
        if (s.k === 'str') return dq(s.v);
        if (s.k === 'id') return '${' + name(ctx, s.name) + '}';
        if (s.k === 'idx') return '${' + name(ctx, strip(s.obj).name) + '[' + num(ctx, s.index) + ']}';
        if (t === 'bool') return '$(' + cond(ctx, s) + ' && echo true || echo false)';
        return '$(( ' + num(ctx, s) + ' ))';
      }).join('');
    }

    /** Wert als Wort für Zuweisung/Argument: "…" oder $(( … )). */
    function value(ctx, ast, type) {
      if (!ast) return type === 'string' ? '""' : '0';
      const s = strip(ast);
      if (type === 'string') return '"' + text(ctx, s) + '"';
      if (s.k === 'num' && Number.isInteger(s.v)) return s.raw;
      if (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num') return '-' + strip(s.a).raw;
      if (s.k === 'id' && typeOf(ctx, s) === 'integer') return '"$' + name(ctx, s.name) + '"';
      return '$(( ' + num(ctx, s) + ' ))';
    }

    /** Kommt ein Textvergleich vor? Dann [[ … ]], sonst (( … )). */
    function hasText(ctx, a) {
      let hit = false;
      BBE.expr.walk(a, (x) => {
        if (x.k === 'bin' && ['==', '!=', '<', '<=', '>', '>='].includes(x.op) && (typeOf(ctx, x.a) === 'string' || typeOf(ctx, x.b) === 'string')) hit = true;
      });
      return hit || typeOf(ctx, a) === 'string';
    }

    /** Bedingung als bash-Befehl. */
    function cond(ctx, a) {
      const s = strip(a);
      if (!hasText(ctx, s)) return '(( ' + num(ctx, s) + ' ))';
      const group = (x) => (/^(\[\[|\(\()/.test(x) && !/ (&&|\|\|) /.test(x) ? x : '{ ' + x + '; }');
      if (s.k === 'bin' && (s.op === '&&' || s.op === '||')) return group(cond(ctx, s.a)) + ' ' + s.op + ' ' + group(cond(ctx, s.b));
      if (s.k === 'un' && s.op === '!') return '! ' + group(cond(ctx, s.a));
      if (s.k === 'bin') {
        const l = '"' + text(ctx, s.a) + '"';
        const r = '"' + text(ctx, s.b) + '"';
        if (s.op === '<' || s.op === '>') used.collate = true;
        switch (s.op) {
          case '==': return '[[ ' + l + ' == ' + r + ' ]]';
          case '!=': return '[[ ' + l + ' != ' + r + ' ]]';
          case '<': return '[[ ' + l + ' < ' + r + ' ]]';
          case '>': return '[[ ' + l + ' > ' + r + ' ]]';
          case '<=': used.collate = true; return '! [[ ' + l + ' > ' + r + ' ]]';
          case '>=': used.collate = true; return '! [[ ' + l + ' < ' + r + ' ]]';
          default: break;
        }
      }
      return '[[ -n "' + text(ctx, s) + '" ]]';
    }

    function condFrom(ctx, src) {
      const ast = tryParse(src);
      return ast ? cond(ctx, ast) : 'true';
    }

    /** Ziel einer Zuweisung (Variable oder Element). */
    function target(ctx, src) {
      const t = tryTarget(src);
      if (!t) return asciiName(String(src || '').trim() || 'x');
      if (t.k === 'id') return name(ctx, t.name);
      return name(ctx, strip(t.obj).name) + '[' + num(ctx, t.index) + ']';
    }

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      for (const n of scope.keys()) rename.set(n, asciiName(n));
      const ctx = { fn, scope, rename, ind: 1, lines: body };
      const fname = fn.isMain ? 'main' : fnName.get(fn.name);
      body.push(fname + '() {');
      // Parameter: Arrays als Namensreferenz, alles andere als Kopie
      const ps = fn.params.map((p, i) => (A.isArrayType(p.type) ? 'local -n ' : 'local ') + name(ctx, p.name || 'p') + '="$' + (i + 1) + '"');
      for (const p of ps) line(ctx, p);
      const locals = [];
      if (!fn.isMain && fn.returnType !== 'void') locals.push('result=' + value(ctx, tryParse(fn.resultInit), fn.returnType));
      for (const [n, v] of scope) {
        if (v.kind !== 'decl' || A.isArrayType(v.type)) continue;
        locals.push(name(ctx, n) + '=' + (v.type === 'string' ? '""' : '0'));
      }
      if (locals.length) line(ctx, 'local ' + locals.join(' '));
      for (const n of fn.body) genStmt(ctx, n);
      if (!fn.isMain) {
        const ret = [];
        if (fn.returnType !== 'void') ret.push('"$result"');
        fn.params.forEach((p) => { if (p.byRef && !A.isArrayType(p.type)) ret.push('"$' + name(ctx, p.name) + '"'); });
        if (ret.length) line(ctx, '_ret=(' + ret.join(' ') + ')');
      }
      body.push('}', '');
    }

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      if (n.kind !== 'comment') comment(ctx, n);
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, '# ' + l);
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          if (n.vtype.endsWith('[]')) {
            used.arr = true;
            const len = tryParse(n.length);
            line(ctx, H.arr + ' ' + (len ? value(ctx, len, 'integer') : '0') + ' ' + (n.vtype === 'string[]' ? '""' : '0'));
            line(ctx, 'local -n ' + nm + '="$_neu"');
          } else line(ctx, nm + '=' + value(ctx, tryParse(n.init), n.vtype));
          return;
        }
        case 'assign': {
          const tt = targetType(ctx, n.target);
          line(ctx, target(ctx, n.target) + '=' + value(ctx, tryParse(n.expr), tt === 'string' ? 'string' : 'integer'));
          return;
        }
        case 'input': {
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = '"' + (p ? text(ctx, p) : '') + '"';
          if (tt === 'integer') { used.num = true; line(ctx, H.num + ' ' + prompt); }
          else { used.text = true; line(ctx, H.text + ' ' + prompt); }
          line(ctx, target(ctx, n.target) + '=' + (tt === 'integer' ? '$REPLY' : '"$REPLY"'));
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, "printf '%s\\n' \"" + (ast ? text(ctx, ast) : '') + '"');
          return;
        }
        case 'if': {
          line(ctx, 'if ' + condFrom(ctx, n.cond) + '; then');
          block(ctx, n.then);
          let rest = n.else;
          while (rest && rest.length === 1 && rest[0].kind === 'if' && !rest[0].comment) {
            line(ctx, 'elif ' + condFrom(ctx, rest[0].cond) + '; then');
            block(ctx, rest[0].then);
            rest = rest[0].else;
          }
          if (rest && rest.length) { line(ctx, 'else'); block(ctx, rest); }
          line(ctx, 'fi');
          return;
        }
        case 'while':
          line(ctx, 'while ' + condFrom(ctx, n.cond) + '; do');
          block(ctx, n.body);
          line(ctx, 'done');
          return;
        case 'until':
          line(ctx, 'while true; do');
          block(ctx, n.body);
          ctx.ind++; line(ctx, 'if ' + condFrom(ctx, n.cond) + '; then break; fi'); ctx.ind--;
          line(ctx, 'done');
          return;
        case 'for': {
          const k = target(ctx, n.counter);
          const from = num(ctx, tryParse(n.from) || { k: 'num', v: 0, raw: '0' });
          const to = num(ctx, tryParse(n.to) || { k: 'num', v: 0, raw: '0' }, 5);
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          let c, inc;
          if (typeof lit === 'number') {
            c = k + (lit >= 0 ? ' <= ' : ' >= ') + to;
            inc = lit === 1 ? k + '++' : lit === -1 ? k + '--' : lit > 0 ? k + ' += ' + lit : k + ' -= ' + (-lit);
          } else {
            const s = num(ctx, stepAst, 7);
            c = s + ' > 0 ? ' + k + ' <= ' + to + ' : ' + k + ' >= ' + to;
            inc = k + ' += ' + s;
          }
          line(ctx, 'for (( ' + k + ' = ' + from + '; ' + c + '; ' + inc + ' )); do');
          block(ctx, n.body);
          line(ctx, 'done');
          return;
        }
        case 'switch': {
          const sel = tryParse(n.expr);
          const isText = sel && typeOf(ctx, sel) === 'string';
          const vals = n.cases.map((c) => tryParse(c.value));
          const lit = (v) => v && (strip(v).k === 'str' || (strip(v).k === 'num' && Number.isInteger(strip(v).v)) ||
            (strip(v).k === 'un' && strip(v).op === '-' && strip(strip(v).a).k === 'num'));
          if (sel && vals.every(lit)) {
            line(ctx, 'case ' + (isText ? '"' + text(ctx, sel) + '"' : '$(( ' + num(ctx, sel) + ' ))') + ' in');
            ctx.ind++;
            n.cases.forEach((c, i) => {
              const v = strip(vals[i]);
              const pat = v.k === 'str' ? '"' + dq(v.v) + '"' : num(ctx, v);
              line(ctx, pat + ')');
              block(ctx, c.body);
              line(ctx, IND + ';;');
            });
            if (n.else) { line(ctx, '*)'); block(ctx, n.else); line(ctx, IND + ';;'); }
            ctx.ind--;
            line(ctx, 'esac');
            return;
          }
          // Fallwerte sind Ausdrücke → if/elif
          const subj = sel || { k: 'num', v: 0, raw: '0' };
          n.cases.forEach((c, i) => {
            const test = { k: 'bin', op: '==', a: subj, b: vals[i] || { k: 'num', v: 0, raw: '0' } };
            line(ctx, (i ? 'elif ' : 'if ') + cond(ctx, test) + '; then');
            block(ctx, c.body);
          });
          if (n.else && n.else.length) {
            if (n.cases.length) { line(ctx, 'else'); block(ctx, n.else); } else { for (const x of n.else) genStmt(ctx, x); }
          }
          if (n.cases.length) line(ctx, 'fi');
          return;
        }
        case 'call': {
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, '# ' + (n.fn || '?') + '(…)'); return; }
          const args = callee.params.map((p, i) => {
            const src = n.args[i] || '';
            if (A.isArrayType(p.type)) {
              const t = tryTarget(src);
              return '"${!' + (t ? name(ctx, t.k === 'id' ? t.name : strip(t.obj).name) : asciiName(src)) + '}"';
            }
            const v = value(ctx, tryParse(src), p.type);
            return /^[-\d]+$/.test(v) || v.startsWith('"') ? v : '"' + v + '"';
          });
          line(ctx, fnName.get(callee.name) + (args.length ? ' ' + args.join(' ') : ''));
          let k = 0;
          if (callee.returnType !== 'void') {
            if (n.target && n.target.trim()) line(ctx, target(ctx, n.target) + '="${_ret[0]}"');
            k = 1;
          }
          callee.params.forEach((p, i) => {
            if (p.byRef && !A.isArrayType(p.type)) { line(ctx, target(ctx, n.args[i] || '') + '="${_ret[' + k + ']}"'); k++; }
          });
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    for (const fn of program.fns.filter((f) => !f.isMain)) genFunction(fn);
    genFunction(program.fns.find((f) => f.isMain));

    const out = ['#!/usr/bin/env bash', '# ' + tr('bashHeader1'), '# ' + tr('bashHeader2'), ''];
    if (used.collate) out.push('# ' + tr('bashCollate'), 'LC_COLLATE=C', '');
    if (used.arr) {
      out.push('# ' + tr('bashNewArrayDoc'));
      out.push('_anzahl=0');
      out.push(H.arr + '() {');
      out.push(IND + '(( _anzahl++ ))');
      out.push(IND + '_neu="_a$_anzahl"');
      out.push(IND + 'local -n _feld="$_neu"');
      out.push(IND + '_feld=()');
      out.push(IND + 'local i');
      out.push(IND + 'for (( i = 0; i < $1; i++ )); do _feld[i]="$2"; done');
      out.push('}', '');
    }
    if (used.text) {
      out.push('# ' + tr('bashHelperTextDoc'));
      out.push(H.text + '() {');
      out.push(IND + "printf '%s' \"$1\"");
      out.push(IND + 'IFS= read -r REPLY || REPLY=""');
      out.push('}', '');
    }
    if (used.num) {
      out.push('# ' + tr('javaHelperNumDoc'));
      out.push(H.num + '() {');
      out.push(IND + 'local zeile');
      out.push(IND + 'while true; do');
      out.push(IND + IND + "printf '%s' \"$1\"");
      out.push(IND + IND + 'if ! IFS= read -r zeile; then REPLY=0; return; fi');
      out.push(IND + IND + 'zeile="${zeile//[[:space:]]/}"');
      out.push(IND + IND + 'if [[ $zeile =~ ^([+-]?)([0-9]+)$ ]]; then');
      out.push(IND + IND + IND + 'REPLY=$(( ${BASH_REMATCH[1]}10#${BASH_REMATCH[2]} ))');
      out.push(IND + IND + IND + 'return');
      out.push(IND + IND + 'fi');
      out.push(IND + IND + "printf '%s\\n' \"" + dq(tr('javaNeedInt')) + '"');
      out.push(IND + 'done');
      out.push('}', '');
    }
    out.push(...body, 'main "$@"');
    return out.join('\n') + '\n';
  }

  BBE.bashgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
