/* Blockbild-Editor – Übersetzung nach BASIC im Stil von QBasic/QuickBASIC
 *
 *   Strukturiert: SUB/FUNCTION (rekursiv), DIM … AS LONG/STRING, IF…ELSEIF…END IF, DO…LOOP,
 *   FOR…NEXT, SELECT CASE. Zahl → LONG (Division mit \, Rest mit MOD wie in C), Text → STRING,
 *   Arrays → REDIM name(0 TO n - 1), Länge über UBOUND(name) + 1.
 *   QBasic übergibt Parameter immer by reference: In-Parameter werden beim Aufruf in Klammern
 *   gesetzt ((x) = Kopie), InOut-Parameter und Arrays direkt.
 *   Funktionen geben ihren Wert über den Funktionsnamen zurück (ggt& = result am Ende).
 *   QBasic unterscheidet nicht zwischen Groß- und Kleinschreibung und kennt keine "_" in Namen –
 *   Namen werden bei Bedarf umbenannt (camelCase, Umlaute ersetzt, Kollisionen mit Ziffer).
 *   AND/OR werten immer beide Seiten aus – wo die rechte Seite auf ein Array zugreift, wird die
 *   Bedingung schrittweise über eine Hilfsvariable berechnet (wie && / || in der Simulation).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;

  const IND = '    ';
  const MAXNAME = 40;
  // Schlüsselwörter und eingebaute Funktionen von QBasic (dazu einige aus FreeBASIC/bwBASIC)
  const RESERVED = new Set(('ABS ACCESS ALIAS AND ANY APPEND AS ASC ATN BASE BEEP BINARY BLOAD BSAVE BYVAL BYREF CALL CALLS CASE ' +
    'CDBL CDECL CHAIN CHDIR CHR CINT CIRCLE CLEAR CLNG CLOSE CLS COLOR COM COMMAND COMMON CONST COS CSNG CSRLIN CVD CVDMBF ' +
    'CVI CVL CVS CVSMBF DATA DATE DECLARE DEF DEFDBL DEFINT DEFLNG DEFSNG DEFSTR DIM DO DOUBLE DRAW ELSE ELSEIF END ENVIRON ' +
    'EOF EQV ERASE ERDEV ERL ERR ERROR EXIT EXP FIELD FILEATTR FILES FIX FOR FRE FREEFILE FUNCTION GET GOSUB GOTO HEX IF IMP ' +
    'INKEY INP INPUT INSTR INT INTEGER IOCTL IS KEY KILL LBOUND LCASE LEFT LEN LET LINE LIST LOC LOCATE LOCK LOF LOG LONG LOOP ' +
    'LPOS LPRINT LSET LTRIM MID MKD MKDIR MKI MKL MKS MOD NAME NEXT NOT OCT OFF ON OPEN OPTION OR OUT OUTPUT PAINT PALETTE ' +
    'PCOPY PEEK PEN PLAY PMAP POINT POKE POS PRESET PRINT PSET PUT RANDOM RANDOMIZE READ REDIM REM RESET RESTORE RESUME ' +
    'RETURN RIGHT RMDIR RND RSET RTRIM RUN SADD SCREEN SEEK SEG SELECT SGN SHARED SHELL SIGNAL SIN SINGLE SLEEP SOUND SPACE ' +
    'SPC SQR STATIC STEP STICK STOP STR STRIG STRING SUB SWAP SYSTEM TAB TAN THEN TIME TIMER TO TROFF TRON TYPE UBOUND UCASE ' +
    'UEVENT UNLOCK UNTIL USING VAL VARPTR VARSEG VIEW WAIT WEND WHILE WIDTH WINDOW WRITE XOR ' +
    'TRUE FALSE NULL NEW OLD SAVE LOAD MERGE EDIT CHANGE AUTO DELETE RENUM CONT MAX MIN MAIN BYE QUIT ' +
    'SHORT BYTE UBYTE USHORT UINTEGER ULONG LONGINT ULONGINT PTR POINTER PRIVATE PUBLIC SCOPE NAMESPACE ' +
    'OPERATOR PROPERTY CONSTRUCTOR DESTRUCTOR THIS CLASS EXTENDS OVERLOAD NOTHING ENUM UNION WITH OPTIONAL').split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const BT = { integer: 'LONG', string: 'STRING', 'integer[]': 'LONG', 'string[]': 'STRING' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };

  /** BASIC-Text: "…" (ohne Escape-Zeichen) – Anführungszeichen und Steuerzeichen über CHR$(). */
  function basStr(s) {
    const out = [];
    let cur = '';
    let open = false;
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c === 127 || ch === '"') { if (open) out.push('"' + cur + '"'); cur = ''; open = false; out.push('CHR$(' + c + ')'); }
      else { cur += ch; open = true; }
    }
    if (open || !out.length) out.push('"' + cur + '"');
    return out.join(' + ');
  }

  /** Name ohne Umlaute und Unterstriche (QBasic erlaubt nur Buchstaben, Ziffern und Punkt). */
  function baseName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    s = s.replace(/_+([A-Za-z0-9]?)/g, (m, c, off) => (off === 0 ? c : c.toUpperCase()));
    if (!/^[A-Za-z]/.test(s)) s = 'v' + s;
    if (/^fn/i.test(s)) s = 'v' + s.charAt(0).toUpperCase() + s.slice(1); // FNxxx wäre eine DEF-FN-Funktion
    return s.slice(0, MAXNAME - 3);
  }

  /** Freier Name: nicht reserviert, nicht vergeben (ohne Rücksicht auf Groß-/Kleinschreibung). */
  function unique(base, taken) {
    let n = base;
    for (let i = 2; RESERVED.has(n.toUpperCase()) || taken.has(n.toUpperCase()); i++) n = base + i;
    taken.add(n.toUpperCase());
    return n;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const used = { num: false };
    const taken = new Set();
    const H = { num: unique(baseName(tr('javaHelperNum')), taken) };
    const fnName = new Map();
    const SUFFIX = { integer: '&', string: '$', void: '' };
    for (const f of program.fns.filter((x) => !x.isMain)) fnName.set(f.name, unique(baseName(f.name), taken));
    const declares = [];
    const mainLines = [];
    const procs = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || baseName(n);
    const target = (ctx, src) => { const t = tryTarget(src); return t ? ex(ctx, t) : String(src || '').trim() || 'x'; };
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const fnRef = (f) => fnName.get(f.name) + SUFFIX[f.returnType];
    // eigene Stufen für MOD, \ und * – QBasic bindet * stärker als \ und \ stärker als MOD
    const PREC = { '||': 1, '&&': 2, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '%': 6, '/': 7, '*': 8 };
    const OPS = { '||': 'OR', '&&': 'AND', '==': '=', '!=': '<>', '%': 'MOD', '/': '\\' };

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function comment(ctx, n) { if (n && n.comment) line(ctx, "' " + n.comment.replace(/\s+/g, ' ')); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    function paramList(fn, ctx) {
      return fn.params.map((p) => (ctx.dummy.get(p.name) || name(ctx, p.name || 'p')) + (A.isArrayType(p.type) ? '()' : '') + ' AS ' + BT[p.type]);
    }

    /** Hilfsvariable des Unterprogramms (wird am Anfang mit DIM angelegt). */
    function helperVar(ctx, key, base, type) {
      if (!ctx.helpers[key]) {
        ctx.helpers[key] = unique(baseName(base), ctx.local);
        ctx.extra.push(ctx.helpers[key] + ' AS ' + BT[type]);
      }
      return ctx.helpers[key];
    }

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      const local = new Set(taken);
      for (const n of scope.keys()) rename.set(n, unique(baseName(n), local));
      const ctx = { fn, scope, rename, ind: fn.isMain ? 0 : 1, lines: [], local, extra: [], helpers: {}, dummy: new Map() };

      const dims = [];
      // QBasic übergibt immer by reference: In-Parameter, die verändert werden, arbeiten mit einer lokalen Kopie
      const written = A.writtenNames(program, fn);
      for (const p of fn.params) {
        if (p.byRef || A.isArrayType(p.type) || !written.has(p.name) || ctx.dummy.has(p.name)) continue;
        const d = unique(name(ctx, p.name) + 'In', local);
        ctx.dummy.set(p.name, d);
        dims.push(name(ctx, p.name) + ' AS ' + BT[p.type]);
        line(ctx, name(ctx, p.name) + ' = ' + d);
      }
      for (const [n, v] of scope) {
        if (v.kind === 'param' || A.isArrayType(v.type)) continue;
        dims.push(name(ctx, n) + ' AS ' + BT[v.type]);
      }
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, name(ctx, 'result') + ' = ' + valueFor(ctx, fn.resultInit, fn.returnType));
      genSeq(ctx, fn.body);
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, fnRef(fn) + ' = ' + name(ctx, 'result'));

      const head = [];
      const ind = IND.repeat(ctx.ind);
      for (const d of dims.concat(ctx.extra)) head.push(ind + 'DIM ' + d);
      if (fn.isMain) { mainLines.push(...head, ...(head.length && ctx.lines.length ? [''] : []), ...ctx.lines); return; }
      const kind = fn.returnType === 'void' ? 'SUB' : 'FUNCTION';
      const ps = paramList(fn, ctx);
      const sig = kind + ' ' + fnRef(fn) + (ps.length ? ' (' + ps.join(', ') + ')' : '');
      declares.push('DECLARE ' + kind + ' ' + fnRef(fn) + ' (' + ps.join(', ') + ')');
      procs.push('', sig, ...head, ...ctx.lines, 'END ' + kind);
    }

    // ------------------------------------------------------------ Ausdrücke

    function ex(ctx, a, minPrec = 0) {
      const wrapP = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'str': { const s = basStr(a.v); return s.includes(' + ') && minPrec > 5 ? '(' + s + ')' : s; }
        case 'paren': return '(' + ex(ctx, a.e) + ')';
        case 'id': return name(ctx, a.name);
        case 'idx': return ex(ctx, a.obj, 10) + '(' + ex(ctx, a.index) + ')';
        case 'len': {
          const t = typeOf(ctx, a.obj);
          return A.isArrayType(t) ? wrapP('UBOUND(' + ex(ctx, a.obj) + ') + 1', 5) : 'LEN(' + ex(ctx, a.obj) + ')';
        }
        case 'un':
          if (a.op === '!') return wrapP('NOT ' + boolOperand(ctx, a.a), 3);
          if (a.op === '+') return ex(ctx, a.a, minPrec);
          return (minPrec > 0 ? '(' : '') + '-' + ex(ctx, a.a, 9) + (minPrec > 0 ? ')' : '');
        case 'bin': {
          if (a.op === '+' && typeOf(ctx, a) === 'string') return wrapP(textExpr(ctx, a), 5);
          if (a.op === '&&' || a.op === '||') {
            const p = PREC[a.op];
            return wrapP(boolOperand(ctx, a.a) + ' ' + OPS[a.op] + ' ' + boolOperand(ctx, a.b), p);
          }
          // a.length - 1 → UBOUND(a)
          const sa = strip(a.a);
          if (a.op === '-' && sa.k === 'len' && A.isArrayType(typeOf(ctx, sa.obj)) && A.literalValue(a.b) === 1) return 'UBOUND(' + ex(ctx, sa.obj) + ')';
          const p = PREC[a.op];
          // Vergleiche nicht verketten (a < b = c), Operanden eines Vergleichs mindestens auf Stufe +/−
          const pr = p === 4 ? 5 : p + 1;
          return wrapP(ex(ctx, a.a, p === 4 ? 5 : p) + ' ' + (OPS[a.op] || a.op) + ' ' + ex(ctx, a.b, pr), p);
        }
        default: return '0';
      }
    }

    /** Wahrheitswert als -1/0 (QBasic-Vergleiche liefern -1 für wahr). */
    function boolOperand(ctx, ast) {
      const s = strip(ast);
      const t = typeOf(ctx, s);
      if (t === 'bool') return '(' + ex(ctx, s) + ')';
      if (t === 'string') return '(LEN(' + ex(ctx, s) + ') > 0)';
      return '(' + ex(ctx, s, 5) + ' <> 0)';
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [ast];
    }

    /** Text-Ausdruck: Teile mit + verbinden, Zahlen über LTRIM$(STR$(…)). */
    function textExpr(ctx, ast) {
      return parts(ctx, ast).map((p) => asText(ctx, p, 6)).join(' + ');
    }

    function asText(ctx, ast, minPrec = 0) {
      const t = typeOf(ctx, ast);
      if (t === 'string') return ex(ctx, ast, minPrec);
      if (t === 'bool') return 'MID$("false true", 1 - 6 * (' + ex(ctx, strip(ast)) + '), 5)';
      return 'LTRIM$(STR$(' + ex(ctx, strip(ast)) + '))';
    }

    function hasFloat(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
      return hit;
    }

    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return String(src || '').trim() || (type === 'string' ? '""' : '0');
      const t = typeOf(ctx, ast);
      if (type === 'string') return t === 'string' ? ex(ctx, strip(ast)) : asText(ctx, ast);
      if (type === 'integer' && t === 'string') return 'VAL(' + ex(ctx, strip(ast)) + ')';
      if (type === 'integer' && hasFloat(ast)) return 'FIX(' + ex(ctx, strip(ast)) + ')';
      return ex(ctx, strip(ast));
    }

    // ------------------------------------------------------------ Bedingungen

    const hasIdx = (ast) => { let hit = false; BBE.expr.walk(ast, (a) => { if (a.k === 'idx') hit = true; }); return hit; };
    /** Muss kurzgeschlossen werden? (rechte Seite von && / || greift auf ein Array zu) */
    function needsShort(ast) {
      let hit = false;
      BBE.expr.walk(ast, (a) => { if (a.k === 'bin' && (a.op === '&&' || a.op === '||') && hasIdx(a.b)) hit = true; });
      return hit;
    }

    function condExpr(ctx, s) {
      const t = typeOf(ctx, s);
      if (t === 'string') return 'LEN(' + ex(ctx, s) + ') > 0';
      if (t === 'integer') return ex(ctx, s, 5) + ' <> 0';
      return ex(ctx, s);
    }

    /** Bedingung schrittweise in die Hilfsvariable t rechnen (Kurzschluss wie && / ||). */
    function emitBool(ctx, ast, t) {
      const s = strip(ast);
      if (!needsShort(s)) { line(ctx, t + ' = ' + (typeOf(ctx, s) === 'bool' ? ex(ctx, s) : boolOperand(ctx, s))); return; }
      if (s.k === 'bin' && (s.op === '&&' || s.op === '||')) {
        emitBool(ctx, s.a, t);
        line(ctx, (s.op === '&&' ? 'IF ' : 'IF NOT ') + t + ' THEN');
        ctx.ind++; emitBool(ctx, s.b, t); ctx.ind--;
        line(ctx, 'END IF');
        return;
      }
      if (s.k === 'un' && s.op === '!') { emitBool(ctx, s.a, t); line(ctx, t + ' = NOT ' + t); return; }
      line(ctx, t + ' = ' + ex(ctx, s));
    }

    /** Bedingung als Ausdruck; bei Bedarf werden vorher Zeilen für den Kurzschluss ausgegeben. */
    function cond(ctx, src) {
      const ast = tryParse(src);
      if (!ast) return '-1';
      const s = strip(ast);
      if (!needsShort(s)) return condExpr(ctx, s);
      const t = helperVar(ctx, 'cond', tr('basCond'), 'integer');
      emitBool(ctx, s, t);
      return t;
    }
    const condIsShort = (src) => { const a = tryParse(src); return !!a && needsShort(strip(a)); };

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, "' " + l);
          return;
        case 'decl': {
          comment(ctx, n);
          const nm = name(ctx, n.name || 'variable');
          if (n.vtype.endsWith('[]')) {
            const len = tryParse(n.length);
            const lit = len ? A.literalValue(len) : 0;
            const hi = typeof lit === 'number' ? String(lit - 1) : ex(ctx, strip(len), 5) + ' - 1';
            line(ctx, 'REDIM ' + nm + '(0 TO ' + hi + ') AS ' + BT[n.vtype]);
          } else {
            line(ctx, nm + ' = ' + valueFor(ctx, n.init, n.vtype));
          }
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
          const prompt = p ? asText(ctx, strip(p)) : '""';
          if (tt === 'integer') { used.num = true; line(ctx, target(ctx, n.target) + ' = ' + H.num + '&(' + prompt + ')'); return; }
          if (prompt !== '""') line(ctx, 'PRINT ' + prompt + ';');
          line(ctx, 'LINE INPUT ' + target(ctx, n.target));
          return;
        }
        case 'output': {
          comment(ctx, n);
          const ast = tryParse(n.expr);
          line(ctx, ast ? 'PRINT ' + asText(ctx, strip(ast)) : 'PRINT');
          return;
        }
        case 'if': {
          comment(ctx, n);
          line(ctx, 'IF ' + cond(ctx, n.cond) + ' THEN');
          block(ctx, n.then);
          let els = n.else;
          // SONST-WENN → ELSEIF (nur ohne Kurzschluss-Hilfszeilen)
          while (els && els.length === 1 && els[0].kind === 'if' && !els[0].comment && !condIsShort(els[0].cond)) {
            line(ctx, 'ELSEIF ' + cond(ctx, els[0].cond) + ' THEN');
            block(ctx, els[0].then);
            els = els[0].else;
          }
          if (els && els.length) { line(ctx, 'ELSE'); block(ctx, els); }
          line(ctx, 'END IF');
          return;
        }
        case 'while':
          comment(ctx, n);
          if (condIsShort(n.cond)) {
            line(ctx, 'DO');
            ctx.ind++; line(ctx, 'IF NOT ' + cond(ctx, n.cond) + ' THEN EXIT DO'); ctx.ind--;
          } else line(ctx, 'DO WHILE ' + cond(ctx, n.cond));
          block(ctx, n.body);
          line(ctx, 'LOOP');
          return;
        case 'until':
          comment(ctx, n);
          line(ctx, 'DO');
          block(ctx, n.body);
          if (condIsShort(n.cond)) {
            ctx.ind++; const c = cond(ctx, n.cond); ctx.ind--;
            line(ctx, 'LOOP UNTIL ' + c);
          } else line(ctx, 'LOOP UNTIL ' + cond(ctx, n.cond));
          return;
        case 'for': {
          comment(ctx, n);
          const ct = tryTarget(n.counter);
          const k = target(ctx, n.counter);
          const from = ex(ctx, tryParse(n.from) || { k: 'num', v: 0, raw: '0' });
          const toAst = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          // echtes FOR (Grenzen werden nur einmal berechnet) nur, wenn Zähler und Grenze im Rumpf unverändert bleiben
          const inner = A.writtenNames(program, { body: n.body });
          const reads = new Set();
          const collect = (x) => { if (!x) return; if (x.k === 'id') reads.add(x.name); if (x.k !== 'len') ['a', 'b', 'e', 'obj', 'index'].forEach((key) => collect(x[key])); };
          collect(toAst);
          const simple = typeof lit === 'number' && ct && ct.k === 'id' && !inner.has(ct.name) && ![...reads].some((r) => inner.has(r));
          if (simple) {
            line(ctx, 'FOR ' + k + ' = ' + from + ' TO ' + ex(ctx, toAst) + (lit === 1 ? '' : ' STEP ' + lit));
            block(ctx, n.body);
            line(ctx, 'NEXT ' + k);
            return;
          }
          const to = ex(ctx, toAst, 5);
          const s = stepAst ? ex(ctx, stepAst, 6) : '1';
          let c;
          if (typeof lit === 'number') c = k + (lit >= 0 ? ' <= ' : ' >= ') + to;
          else c = '(' + s + ' > 0 AND ' + k + ' <= ' + to + ') OR (' + s + ' < 0 AND ' + k + ' >= ' + to + ')';
          line(ctx, k + ' = ' + from);
          line(ctx, 'DO WHILE ' + c);
          block(ctx, n.body);
          ctx.ind++; line(ctx, k + ' = ' + k + (typeof lit === 'number' && lit < 0 ? ' - ' + (-lit) : ' + ' + s)); ctx.ind--;
          line(ctx, 'LOOP');
          return;
        }
        case 'switch': {
          comment(ctx, n);
          const sel = tryParse(n.expr);
          line(ctx, 'SELECT CASE ' + (sel ? ex(ctx, strip(sel)) : '0'));
          for (const c of n.cases) {
            const v = tryParse(c.value);
            line(ctx, 'CASE ' + (v ? ex(ctx, strip(v)) : '0'));
            block(ctx, c.body);
          }
          if (n.else && n.else.length) { line(ctx, 'CASE ELSE'); block(ctx, n.else); }
          line(ctx, 'END SELECT');
          return;
        }
        case 'call': {
          comment(ctx, n);
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, "' " + (n.fn || '?') + '(…)'); return; }
          const args = callee.params.map((p, i) => {
            const src = n.args[i] || '';
            if (A.isArrayType(p.type)) return target(ctx, src) + '()';
            if (p.byRef) return target(ctx, src);
            return valueFor(ctx, src, p.type);
          });
          const argText = args.length ? '(' + args.join(', ') + ')' : '';
          if (callee.returnType === 'void') { line(ctx, 'CALL ' + fnRef(callee) + argText); return; }
          const call = fnRef(callee) + argText;
          if (n.target && n.target.trim()) {
            const tt = targetType(ctx, n.target);
            let v = call;
            if (tt === 'string' && callee.returnType !== 'string') v = 'LTRIM$(STR$(' + call + '))';
            else if (tt === 'integer' && callee.returnType === 'string') v = 'VAL(' + call + ')';
            line(ctx, target(ctx, n.target) + ' = ' + v);
          } else {
            line(ctx, helperVar(ctx, 'discard' + callee.returnType, tr('basDiscard') + (callee.returnType === 'string' ? 'Text' : ''), callee.returnType) + ' = ' + call);
          }
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    for (const fn of program.fns.filter((f) => !f.isMain)) genFunction(fn);
    genFunction(program.fns.find((f) => f.isMain));

    const helpers = [];
    if (used.num) {
      // lokale Namen dürfen nicht wie ein Unterprogramm heißen
      const loc = new Set(taken);
      const V = { q: unique(baseName(tr('genArgPrompt')), loc) };
      for (const k of ['zeile', 'i', 'ok', 'c']) V[k] = unique(k, loc);
      const P = (...s) => helpers.push(...s.map((x) => x.replace(/@(\w+)/g, (m, k) => V[k])));
      declares.push('DECLARE FUNCTION ' + H.num + '& (' + V.q + ' AS STRING)');
      helpers.push('', "' " + tr('javaHelperNumDoc'));
      P('FUNCTION ' + H.num + '& (@q AS STRING)');
      P(IND + 'DIM @zeile AS STRING, @i AS LONG, @ok AS LONG, @c AS STRING');
      P(IND + 'DO');
      P(IND + IND + 'PRINT @q;');
      P(IND + IND + 'LINE INPUT @zeile');
      P(IND + IND + '@zeile = LTRIM$(RTRIM$(@zeile))');
      P(IND + IND + '@ok = LEN(@zeile) > 0');
      P(IND + IND + 'FOR @i = 1 TO LEN(@zeile)');
      P(IND + IND + IND + '@c = MID$(@zeile, @i, 1)');
      P(IND + IND + IND + 'IF @c < "0" OR @c > "9" THEN');
      P(IND + IND + IND + IND + 'IF @i > 1 OR LEN(@zeile) = 1 OR (@c <> "-" AND @c <> "+") THEN @ok = 0');
      P(IND + IND + IND + 'END IF');
      P(IND + IND + 'NEXT @i');
      P(IND + IND + 'IF @ok THEN EXIT DO');
      helpers.push(IND + IND + 'PRINT ' + basStr(tr('javaNeedInt')));
      P(IND + 'LOOP');
      P(IND + H.num + '& = VAL(@zeile)');
      P('END FUNCTION');
    }

    const out = ["' " + tr('basHeader1'), "' " + tr('basHeader2')];
    if (declares.length) out.push('', ...declares);
    out.push('', ...mainLines, 'END', ...procs, ...helpers);
    return out.join('\n') + '\n';
  }

  BBE.basicgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
