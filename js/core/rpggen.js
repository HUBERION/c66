/* Blockbild-Editor – Übersetzung nach ILE RPG IV (vollständig freies Format, **FREE, ab IBM i 7.3)
 *
 *   Eine Quelle für CRTBNDRPG: ctl-opt main(...) (Linear-Main, kein RPG-Zyklus), jedes Unterprogramm
 *   wird eine Subprozedur (dcl-proc, rekursiv, lokale Variablen automatisch). Prototypen stehen oben.
 *   Zahl → int(10), "/" → %div (schneidet ab wie C), "%" → %rem (Vorzeichen wie C).
 *   Text → varchar(256), Verkettung mit +, Zahlen über %char().
 *   Array → dim(1000) + Länge NAME_len; RPG zählt ab 1: aus a[i] wird a(i + 1).
 *   In → value, InOut → Referenz (Standard), Arrays → Referenz + Länge als value.
 *   Ein-/Ausgabe über DSPLY (höchstens 52 Zeichen je Zeile; längere Texte werden aufgeteilt).
 *   RPG unterscheidet nicht zwischen Groß- und Kleinschreibung – Namen werden bei Bedarf umbenannt.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '  ';
  const MAXLINE = 100;      // Quelldateien (QRPGLESRC, Satzlänge 112) haben 100 Zeichen pro Zeile
  const MAXLIT = 60;        // längere Text-Literale werden in Stücke geteilt
  const MAXARR = 1000;
  const NUM = 'int(10)';
  const TXT = 'varchar(256)';
  const ARG = 'varchar(4096)';
  const DSPLEN = 52;        // DSPLY zeigt höchstens 52 Zeichen
  // Operationscodes, Deklarations-Schlüsselwörter, Datentypen und Operatoren von RPG IV (ohne Groß-/Kleinschreibung)
  const RESERVED = new Set(('acq begsr callp chain clear close commit dealloc delete dou dow dsply dump else elseif enddo endfor ' +
    'endif endmon endsl endsr eval evalr except exfmt exsr feod for force if in iter leave leavesr monitor next open other out ' +
    'post read readc reade readp readpe rel reset return rolbk select setgt setll sorta test unlock update when write exec sql ' +
    'add sub mult div mvr comp cab call callb parm plist kfld klist lookup move movel movea scan subst xlate cat check checkr ' +
    'time tag goto do end endcs cas occur extrct shtdn setoff seton define alloc realloc ' +
    'char varchar graph vargraph ucs2 varucs2 ind packed zoned bindec int uns float date time timestamp pointer object ' +
    'alias align alt altseq ascend based ccsid class const ctdata datfmt descend dim dtaara export ext extfld extfmt extname ' +
    'extpgm extproc fromfile import inz len like likeds likefile likerec noopt occurs opdesc options overlay packeven perrcd ' +
    'pos prefix psds qualified rtnparm static template timfmt tofile value varying nullind main nomain text ' +
    'and or not to downto by result').split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  // Steuerzeichen als EBCDIC-Hex-Literal (IBM i rechnet in EBCDIC)
  const EBCDIC_CTRL = { 0: '00', 7: '2F', 8: '16', 9: '05', 10: '25', 11: '0B', 12: '0C', 13: '0D', 27: '27', 127: '07' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };

  /** RPG-Text-Literal(e) für einen Text: '…' mit verdoppeltem ', Steuerzeichen als x'25'. */
  function litParts(s) {
    const out = [];
    let cur = '';
    let n = 0;
    const flush = () => { if (n) out.push("'" + cur + "'"); cur = ''; n = 0; };
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (c < 32 || c === 127) { flush(); out.push("x'" + (EBCDIC_CTRL[c] || '40') + "'"); continue; }
      if (n >= MAXLIT) flush();
      cur += ch === "'" ? "''" : ch;
      n++;
      if (ch === ' ' && n >= MAXLIT - 20) flush();   // möglichst nach einem Leerzeichen teilen
    }
    flush();
    if (!out.length) out.push("''");
    return out;
  }
  const lit = (s) => litParts(s).join(' + ');

  function asciiName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(s)) s = 'v' + (s.startsWith('_') ? '' : '_') + s;
    return s.slice(0, 50);
  }

  /** Zahl-Literal in RPG-Schreibweise (.5 → 0.5, 1e3 → 1000). */
  function numLit(a) {
    if (/[eE]/.test(a.raw)) return Number.isInteger(a.v) ? String(a.v) : String(a.v).toUpperCase();
    let r = a.raw;
    if (r.startsWith('.')) r = '0' + r;
    if (r.endsWith('.')) r = r.slice(0, -1);
    return r;
  }

  function hasFloat(ast) {
    let hit = false;
    BBE.expr.walk(ast, (a) => { if (a.k === 'num' && !Number.isInteger(a.v)) hit = true; });
    return hit;
  }

  /** Lange Zeilen an " + ", ": ", " and ", " or " (außerhalb von Literalen) umbrechen. */
  function wrap(text) {
    const out = [];
    let rest = text;
    const indent = (text.match(/^ */) || [''])[0] + IND + IND;
    if (/^\s*\/\//.test(text)) {
      // Kommentar: an Wortgrenzen umbrechen
      const pre = (text.match(/^\s*\/\/ ?/) || ['// '])[0];
      while (rest.length > MAXLINE) {
        let cut = rest.lastIndexOf(' ', MAXLINE);
        if (cut <= pre.length) break;
        out.push(rest.slice(0, cut));
        rest = pre + rest.slice(cut + 1);
      }
      out.push(rest);
      return out;
    }
    if (rest.length > MAXLINE) {
      // Kommentar am Zeilenende: in eine eigene Zeile davor
      let q = false;
      for (let i = 0; i < rest.length - 1; i++) {
        if (rest[i] === "'") q = !q;
        else if (!q && rest[i] === '/' && rest[i + 1] === '/') {
          const ind0 = (text.match(/^ */) || [''])[0];
          return wrap(ind0 + rest.slice(i)).concat(wrap(rest.slice(0, i).replace(/\s+$/, '')));
        }
      }
    }
    while (rest.length > MAXLINE) {
      let inStr = false;
      let best = -1;
      for (let i = 0; i < MAXLINE && i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "'") inStr = !inStr;
        else if (!inStr && i > indent.length + 10 && ch === ' ' && /^ (\+|-|\*|and|or|=|<>|<=|>=|<|>) /.test(rest.slice(i))) best = i;
        else if (!inStr && i > indent.length + 10 && ch === ':' && rest[i + 1] === ' ') best = i + 1;
      }
      if (best <= 0) break;
      out.push(rest.slice(0, best).replace(/\s+$/, ''));
      rest = indent + rest.slice(best).replace(/^\s+/, '');
    }
    out.push(rest);
    return out;
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const used = { out: false, text: false, num: false, boolText: false, boolNum: false };
    const safe = (s) => { let b = asciiName(s); while (RESERVED.has(b.toLowerCase()) || ['txt', 'buf', 'antwort', 'eingabe', 'ok', 'i', 'b'].includes(b.toLowerCase())) b += '_'; return b; };
    const P = safe(tr('genArgPrompt'));
    const V = safe(tr('genArgValue'));

    // ------------------------------------------------------------ globale Namen
    const globalTaken = new Set();
    const claimGlobal = (base) => {
      let b = asciiName(base);
      while (RESERVED.has(b.toLowerCase()) || globalTaken.has(b.toLowerCase())) b += '_';
      globalTaken.add(b.toLowerCase());
      return b;
    };
    const H = {
      main: claimGlobal(tr('rpgMain')),
      out: claimGlobal(tr('rpgHelperOut')),
      text: claimGlobal(tr('rpgHelperText')),
      num: claimGlobal(tr('javaHelperNum')),
      boolText: claimGlobal(tr('rpgHelperBool')),
      boolNum: claimGlobal(tr('rpgHelperBoolNum'))
    };
    const fnName = new Map();
    for (const f of program.fns.filter((x) => !x.isMain)) fnName.set(f.name, claimGlobal(f.name));

    const protos = [];
    const procs = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || asciiName(n);
    const lenName = (ctx, n) => ctx.lens.get(n) || asciiName(n) + '_len';
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };

    function line(ctx, s) { for (const l of wrap(IND.repeat(ctx.ind) + s)) ctx.lines.push(l); }
    function comment(ctx, n) { if (n && n.comment) line(ctx, '// ' + n.comment.replace(/\s+/g, ' ')); }
    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    /** Parameterzeilen (für dcl-pr und dcl-pi gleich). */
    function paramLines(fn, nameOf, lenOf) {
      const out = [];
      for (const p of fn.params) {
        const nm = nameOf(p);
        if (p.type === 'integer[]' || p.type === 'string[]') {
          out.push(nm + ' ' + (p.type === 'integer[]' ? NUM : TXT) + ' dim(' + MAXARR + ');');
          out.push(lenOf(p) + ' ' + NUM + ' value;');
        } else {
          out.push(nm + ' ' + (p.type === 'string' ? TXT : NUM) + (p.byRef ? '' : ' value') + ';');
        }
      }
      return out;
    }
    const retType = (fn) => (fn.isMain || fn.returnType === 'void' ? '' : ' ' + (fn.returnType === 'string' ? TXT : NUM));

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      const lens = new Map();
      const taken = new Set(globalTaken);
      const claim = (base, arr) => {
        let b = base;
        const bad = (x) => RESERVED.has(x.toLowerCase()) || taken.has(x.toLowerCase()) || (arr && taken.has((x + '_len').toLowerCase()));
        while (bad(b)) b += '_';
        taken.add(b.toLowerCase());
        if (arr) taken.add((b + '_len').toLowerCase());
        return b;
      };
      for (const [n, v] of scope) {
        const arr = A.isArrayType(v.type);
        const r = v.kind === 'result' ? (() => { const b = 'result'; taken.add(b); return b; })() : claim(asciiName(n), arr);
        rename.set(n, r);
        if (arr) lens.set(n, r + '_len');
      }
      const ctx = { fn, scope, rename, lens, taken, ind: 1, lines: [], extra: [], nTmp: 0, valued: new Map() };
      ctx.tmp = (type) => {
        let b;
        do { b = 'tmp' + (++ctx.nTmp); } while (RESERVED.has(b) || taken.has(b));
        taken.add(b);
        ctx.extra.push('dcl-s ' + b + ' ' + (type === 'string' ? TXT : NUM) + ';');
        return b;
      };

      // erste Deklarationen auf oberster Ebene mit einfachem Literal → inz(...)
      const seen = new Set();
      for (const n of fn.body) {
        if (n.kind !== 'decl' || !n.name || seen.has(n.name)) continue;
        seen.add(n.name);
        if (n.vtype.endsWith('[]')) continue;
        const ast = tryParse(n.init);
        const s = ast && strip(ast);
        if (!s) continue;
        if (n.vtype === 'integer' && (s.k === 'num' || (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num'))) {
          const v = A.literalValue(s);
          if (!Number.isInteger(v) || Math.abs(v) > 2147483647) continue;
          ctx.valued.set(n, v === 0 ? '' : ' inz(' + v + ')');
        } else if (n.vtype === 'string' && s.k === 'str') {
          const l = litParts(s.v);
          if (l.length > 1 || !l[0].startsWith("'") || [...s.v].length > 256) continue;
          ctx.valued.set(n, s.v === '' ? '' : ' inz(' + l[0] + ')');
        }
      }

      if (!fn.isMain && fn.returnType !== 'void') line(ctx, 'result = ' + valueFor(ctx, fn.resultInit, fn.returnType) + ';');
      genSeq(ctx, fn.body);
      if (!fn.isMain && fn.returnType !== 'void') line(ctx, 'return result;');

      const pname = fn.isMain ? H.main : fnName.get(fn.name);
      const head = [];
      const nameOfP = (p) => name(ctx, p.name || 'p');
      const lenOfP = (p) => lenName(ctx, p.name || 'p');
      if (!fn.isMain) {
        const pl = paramLines(fn, nameOfP, lenOfP);
        protos.push('dcl-pr ' + pname + retType(fn) + ';', ...pl.map((l) => IND + l), 'end-pr;');
        head.push(IND + 'dcl-pi *n' + retType(fn) + ';', ...pl.map((l) => IND + IND + l), IND + 'end-pi;');
      }
      const decls = [];
      if (!fn.isMain && fn.returnType !== 'void') decls.push('dcl-s result ' + (fn.returnType === 'string' ? TXT : NUM) + ';');
      const declNode = new Map();
      for (const [n, v] of scope) if (v.kind === 'decl') declNode.set(n, v);
      const inzOf = new Map();
      for (const [node, inz] of ctx.valued) inzOf.set(node.name, inz + ';' + (node.comment ? '  // ' + node.comment.replace(/\s+/g, ' ') : ''));
      for (const [n, v] of declNode) {
        const nm = name(ctx, n);
        if (v.type === 'integer[]' || v.type === 'string[]') {
          decls.push('dcl-s ' + nm + ' ' + (v.type === 'integer[]' ? NUM : TXT) + ' dim(' + MAXARR + ');');
          decls.push('dcl-s ' + lenName(ctx, n) + ' ' + NUM + ';');
        } else {
          decls.push('dcl-s ' + nm + ' ' + (v.type === 'string' ? TXT : NUM) + (inzOf.get(n) || ';'));
        }
      }
      for (const d of decls.concat(ctx.extra)) head.push(...wrap(IND + d));
      procs.push(
        '',
        'dcl-proc ' + pname + ';',
        ...head,
        ...(head.length && ctx.lines.length ? [''] : []),
        ...ctx.lines,
        'end-proc;'
      );
    }

    // ------------------------------------------------------------ Ausdrücke

    /** Index: RPG zählt ab 1. a[j + 1] → a(j + 2), a[j - 1] → a(j). */
    function sub(ctx, idx) {
      const s = strip(idx);
      if (s.k === 'num' && Number.isInteger(s.v)) return String(s.v + 1);
      if (s.k === 'bin' && (s.op === '+' || s.op === '-') && strip(s.b).k === 'num' && Number.isInteger(strip(s.b).v) && typeOf(ctx, s) !== 'string') {
        const k = (s.op === '+' ? strip(s.b).v : -strip(s.b).v) + 1;
        const base = num(ctx, s.a, 5);
        return k === 0 ? base : base + (k > 0 ? ' + ' + k : ' - ' + (-k));
      }
      return num(ctx, idx, 5) + ' + 1';
    }

    /** Variable oder Array-Element. */
    function ref(ctx, t) {
      if (t.k === 'id') return name(ctx, t.name);
      return name(ctx, strip(t.obj).name) + '(' + sub(ctx, t.index) + ')';
    }

    /** Rechenausdruck (Zahl). minPrec: 5 = + -, 6 = * , 7 = Vorzeichen, 8 = Operand eines Vorzeichens. */
    function num(ctx, a, minPrec = 0) {
      const wrapP = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return numLit(a);
        case 'str': return '%int(' + lit(a.v) + ')';
        case 'paren':
          if (typeOf(ctx, a) === 'string') return '%int(' + text(ctx, a) + ')';
          if (typeOf(ctx, a) === 'bool') return boolNum(ctx, a);
          return minPrec > 0 ? '(' + num(ctx, a.e) + ')' : num(ctx, a.e);
        case 'id':
        case 'idx':
          if (typeOf(ctx, a) === 'string') return '%int(' + ref(ctx, a) + ')';
          return ref(ctx, a);
        case 'len': {
          const o = strip(a.obj);
          if (A.isArrayType(typeOf(ctx, o)) && o.k === 'id') return lenName(ctx, o.name);
          return '%len(' + text(ctx, o) + ')';
        }
        case 'un':
          if (a.op === '!') return boolNum(ctx, a);
          if (a.op === '+') return num(ctx, a.a, minPrec);
          return wrapP('-' + num(ctx, a.a, 8), 7);
        case 'bin': {
          if (!'+-*/%'.includes(a.op)) return boolNum(ctx, a);
          if (a.op === '+' && typeOf(ctx, a) === 'string') return '%int(' + text(ctx, a) + ')';
          if (a.op === '/') {
            if (hasFloat(a)) return '%int(' + num(ctx, a.a, 6) + ' / ' + num(ctx, a.b, 7) + ')';
            return '%div(' + num(ctx, a.a) + ': ' + num(ctx, a.b) + ')';
          }
          if (a.op === '%') {
            if (hasFloat(a)) {
              const x = num(ctx, a.a, 7), y = num(ctx, a.b, 7);
              return wrapP(x + ' - %int(' + x + ' / ' + y + ') * ' + y, 5);
            }
            return '%rem(' + num(ctx, a.a) + ': ' + num(ctx, a.b) + ')';
          }
          const p = a.op === '*' ? 6 : 5;
          return wrapP(num(ctx, a.a, p) + ' ' + a.op + ' ' + num(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    function boolNum(ctx, a) { used.boolNum = true; return H.boolNum + '(' + cond(ctx, strip(a)) + ')'; }
    function boolText(ctx, a) { used.boolText = true; return H.boolText + '(' + cond(ctx, strip(a)) + ')'; }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [s];
    }

    /** Text-Ausdruck: Teile mit + verbinden, Zahlen über %char(). */
    function text(ctx, ast) {
      return parts(ctx, ast).map((s) => {
        const t = typeOf(ctx, s);
        if (s.k === 'str') return lit(s.v);
        if (t === 'string' && (s.k === 'id' || s.k === 'idx')) return ref(ctx, s);
        if (t === 'bool') return boolText(ctx, s);
        return '%char(' + num(ctx, s) + ')';
      }).join(' + ');
    }

    const CMP = { '==': '=', '!=': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
    const isEmptyStr = (s) => s.k === 'str' && s.v === '';

    /** Bedingung (Wahrheitswert). minPrec: 1 = or, 2 = and, 3 = Vergleich. */
    function cond(ctx, s, minPrec = 0) {
      const wrapP = (x, p) => (p < minPrec ? '(' + x + ')' : x);
      if (s.k === 'paren') return '(' + cond(ctx, strip(s.e)) + ')';
      if (s.k === 'un' && s.op === '!') return 'not (' + cond(ctx, strip(s.a)) + ')';
      if (s.k === 'bin') {
        if (s.op === '&&') return wrapP(cond(ctx, strip(s.a), 2) + ' and ' + cond(ctx, strip(s.b), 2), 2);
        if (s.op === '||') return wrapP(cond(ctx, strip(s.a), 1) + ' or ' + cond(ctx, strip(s.b), 1), 1);
        if (CMP[s.op]) {
          const a = strip(s.a), b = strip(s.b);
          const ta = typeOf(ctx, a), tb = typeOf(ctx, b);
          if (ta === 'string' || tb === 'string') {
            // RPG füllt beim Vergleich mit Leerzeichen auf – leerer Text daher über die Länge
            if ((s.op === '==' || s.op === '!=') && (isEmptyStr(a) || isEmptyStr(b))) {
              const other = isEmptyStr(a) ? b : a;
              return wrapP('%len(' + text(ctx, other) + ')' + (s.op === '==' ? ' = 0' : ' > 0'), 3);
            }
            return wrapP(text(ctx, a) + ' ' + CMP[s.op] + ' ' + text(ctx, b), 3);
          }
          if (ta === 'bool' || tb === 'bool') {
            const side = (x, t) => (t === 'bool' ? '(' + cond(ctx, x) + ')' : '(' + num(ctx, x) + ' <> 0)');
            return wrapP(side(a, ta) + ' ' + CMP[s.op] + ' ' + side(b, tb), 3);
          }
          return wrapP(num(ctx, a, 5) + ' ' + CMP[s.op] + ' ' + num(ctx, b, 5), 3);
        }
      }
      const t = typeOf(ctx, s);
      if (t === 'string') return wrapP('%len(' + text(ctx, s) + ') > 0', 3);
      return wrapP(num(ctx, s, 5) + ' <> 0', 3);
    }

    function condFrom(ctx, src) {
      const ast = tryParse(src);
      return ast ? cond(ctx, strip(ast)) : '*on';
    }

    /** Wert eines Ausdrucks im gewünschten Typ. */
    function valueFor(ctx, src, type) {
      const ast = tryParse(src);
      if (!ast) return type === 'string' ? "''" : '0';
      return valueOf(ctx, ast, type);
    }
    function valueOf(ctx, ast, type) {
      const s = strip(ast);
      if (type === 'string') return text(ctx, s);
      const t = typeOf(ctx, s);
      if (t === 'string') return '%int(' + text(ctx, s) + ')';
      if (t === 'bool') return boolNum(ctx, s);
      return num(ctx, s);
    }
    /** Umwandlung eines fertigen RPG-Ausdrucks zwischen Zahl und Text. */
    const conv = (code, from, to) => (from === to ? code : to === 'string' ? '%char(' + code + ')' : '%int(' + code + ')');

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, l.trim() ? '// ' + l : '//');
          return;
        case 'decl': {
          if (!ctx.valued.has(n)) comment(ctx, n);
          if (!n.name) return;
          const nm = name(ctx, n.name);
          if (n.vtype.endsWith('[]')) {
            line(ctx, lenName(ctx, n.name) + ' = ' + valueFor(ctx, n.length, 'integer') + ';');
            line(ctx, 'clear ' + nm + ';');
          } else if (!ctx.valued.has(n)) {
            line(ctx, nm + ' = ' + valueFor(ctx, n.init, n.vtype) + ';');
          }
          return;
        }
        case 'assign': {
          comment(ctx, n);
          const t = tryTarget(n.target);
          if (!t) { line(ctx, '// ' + n.target + ' = ' + n.expr); return; }
          line(ctx, ref(ctx, t) + ' = ' + valueFor(ctx, n.expr, typeOf(ctx, t) === 'string' ? 'string' : 'integer') + ';');
          return;
        }
        case 'input': {
          comment(ctx, n);
          const t = tryTarget(n.target);
          if (!t) return;
          const p = tryParse(n.prompt);
          const prompt = p ? text(ctx, p) : "''";
          used.out = true;
          used.text = true;
          if (typeOf(ctx, t) === 'string') line(ctx, ref(ctx, t) + ' = ' + H.text + '(' + prompt + ');');
          else { used.num = true; line(ctx, ref(ctx, t) + ' = ' + H.num + '(' + prompt + ');'); }
          return;
        }
        case 'output': {
          comment(ctx, n);
          const ast = tryParse(n.expr);
          used.out = true;
          line(ctx, H.out + '(' + (ast ? text(ctx, ast) : "''") + ');');
          return;
        }
        case 'if': {
          comment(ctx, n);
          line(ctx, 'if ' + condFrom(ctx, n.cond) + ';');
          block(ctx, n.then);
          let rest = n.else;
          while (rest && rest.length === 1 && rest[0].kind === 'if' && !rest[0].comment) {
            line(ctx, 'elseif ' + condFrom(ctx, rest[0].cond) + ';');
            block(ctx, rest[0].then);
            rest = rest[0].else;
          }
          if (rest && rest.length) { line(ctx, 'else;'); block(ctx, rest); }
          line(ctx, 'endif;');
          return;
        }
        case 'while':
          comment(ctx, n);
          line(ctx, 'dow ' + condFrom(ctx, n.cond) + ';');
          block(ctx, n.body);
          line(ctx, 'enddo;');
          return;
        case 'until':
          comment(ctx, n);
          line(ctx, 'dou ' + condFrom(ctx, n.cond) + ';');
          block(ctx, n.body);
          line(ctx, 'enddo;');
          return;
        case 'for': {
          comment(ctx, n);
          const ct = tryTarget(n.counter);
          if (!ct) return;
          const k = ref(ctx, ct);
          const fromAst = tryParse(n.from) || { k: 'num', v: 0, raw: '0' };
          const toAst = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          const stepAst = tryParse(n.step);
          const lit0 = stepAst ? A.literalValue(stepAst) : 1;
          const lit1 = typeof lit0 === 'number' && Number.isInteger(lit0) && lit0 !== 0 ? lit0 : null;
          // echtes FOR nur, wenn Zähler und Grenze im Rumpf nicht verändert werden
          const inner = A.writtenNames(program, { body: n.body });
          const declared = new Set();
          M.walkSeq(n.body, (x) => { if (x.kind === 'decl' && x.name) { inner.add(x.name); declared.add(x.name); } });
          // Werte in der Grenze dürfen sich nicht ändern; bei a.length nur die Länge (Neu-Deklaration)
          const reads = new Set();
          const lenReads = new Set();
          const collect = (x) => {
            if (!x) return;
            if (x.k === 'len') { const o = strip(x.obj); if (o.k === 'id') lenReads.add(o.name); else collect(o); return; }
            if (x.k === 'id') reads.add(x.name);
            ['a', 'b', 'e', 'obj', 'index'].forEach((key) => collect(x[key]));
          };
          collect(toAst);
          const simple = lit1 !== null && ct.k === 'id' && !inner.has(ct.name) && ![...reads].some((r) => inner.has(r)) &&
            ![...lenReads].some((r) => declared.has(r)) &&
            !hasFloat(fromAst) && !hasFloat(toAst) && typeOf(ctx, toAst) !== 'string' && typeOf(ctx, fromAst) !== 'string';
          const from = valueOf(ctx, fromAst, 'integer');
          if (simple) {
            const by = Math.abs(lit1) === 1 ? '' : ' by ' + Math.abs(lit1);
            line(ctx, 'for ' + k + ' = ' + from + (lit1 > 0 ? ' to ' : ' downto ') + num(ctx, strip(toAst)) + by + ';');
            block(ctx, n.body);
            line(ctx, 'endfor;');
            return;
          }
          const to = typeOf(ctx, toAst) === 'string' ? '%int(' + text(ctx, toAst) + ')' : num(ctx, strip(toAst), 5);
          let c;
          let inc;
          if (lit1 !== null) {
            c = k + (lit1 > 0 ? ' <= ' : ' >= ') + to;
            inc = k + ' = ' + k + (lit1 > 0 ? ' + ' + lit1 : ' - ' + (-lit1));
          } else {
            const s = stepAst ? valueOf(ctx, stepAst, 'integer') : '1';
            const sp = /^[\w%().]+$/.test(s) ? s : '(' + s + ')';
            c = '(' + sp + ' > 0 and ' + k + ' <= ' + to + ') or (' + sp + ' < 0 and ' + k + ' >= ' + to + ')';
            inc = k + ' = ' + k + ' + ' + sp;
          }
          line(ctx, k + ' = ' + from + ';');
          line(ctx, 'dow ' + c + ';');
          block(ctx, n.body);
          ctx.ind++; line(ctx, inc + ';'); ctx.ind--;
          line(ctx, 'enddo;');
          return;
        }
        case 'switch': {
          comment(ctx, n);
          const sel = tryParse(n.expr) || { k: 'num', v: 0, raw: '0' };
          if (!n.cases.length) { if (n.else) genSeq(ctx, n.else); return; }
          line(ctx, 'select;');
          ctx.ind++;
          for (const c of n.cases) {
            const v = tryParse(c.value) || { k: 'num', v: 0, raw: '0' };
            line(ctx, 'when ' + cond(ctx, { k: 'bin', op: '==', a: sel, b: v }) + ';');
            block(ctx, c.body);
          }
          if (n.else && n.else.length) { line(ctx, 'other;'); block(ctx, n.else); }
          ctx.ind--;
          line(ctx, 'endsl;');
          return;
        }
        case 'call': {
          comment(ctx, n);
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, '// ' + (n.fn || '?') + '(…)'); return; }
          const args = [];
          const after = [];
          callee.params.forEach((p, i) => {
            const src = n.args[i] || '';
            if (A.isArrayType(p.type)) {
              const t = tryTarget(src);
              const v = t ? (t.k === 'id' ? t.name : strip(t.obj).name) : src;
              args.push(name(ctx, v), lenName(ctx, v));
            } else if (p.byRef) {
              const t = tryTarget(src);
              const tt = t ? typeOf(ctx, t) : '?';
              if (t && tt === p.type) { args.push(ref(ctx, t)); return; }
              // Typ passt nicht: über eine Hilfsvariable übergeben und danach zurückschreiben
              const tmp = ctx.tmp(p.type);
              line(ctx, tmp + ' = ' + valueFor(ctx, src, p.type) + ';');
              args.push(tmp);
              if (t && (tt === 'integer' || tt === 'string')) after.push(ref(ctx, t) + ' = ' + conv(tmp, p.type, tt) + ';');
            } else {
              args.push(valueFor(ctx, src, p.type));
            }
          });
          const call = fnName.get(callee.name) + '(' + args.join(': ') + ')';
          if (callee.returnType !== 'void' && n.target && n.target.trim() && tryTarget(n.target)) {
            const t = tryTarget(n.target);
            const tt = typeOf(ctx, t) === 'string' ? 'string' : 'integer';
            line(ctx, ref(ctx, t) + ' = ' + conv(call, callee.returnType, tt) + ';');
          } else line(ctx, call + ';');
          for (const a of after) line(ctx, a);
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    genFunction(program.fns.find((f) => f.isMain));
    for (const fn of program.fns.filter((f) => !f.isMain)) genFunction(fn);

    const helpers = [];
    const X = (...s) => helpers.push(...s);
    const I1 = IND, I2 = IND + IND, I3 = IND + IND + IND, I4 = IND.repeat(4);
    if (used.out) {
      protos.push('dcl-pr ' + H.out + ';', I1 + 'txt ' + ARG + ' const;', 'end-pr;');
      X('', '// ' + tr('rpgHelperOutDoc'));
      X('dcl-proc ' + H.out + ';');
      X(I1 + 'dcl-pi *n;', I2 + 'txt ' + ARG + ' const;', I1 + 'end-pi;');
      X(I1 + 'dcl-s buf char(' + DSPLEN + ');', I1 + 'dcl-s i ' + NUM + ';', '');
      X(I1 + 'if %len(txt) = 0;', I2 + "dsply ' ';", I2 + 'return;', I1 + 'endif;');
      X(I1 + 'i = 1;');
      X(I1 + 'dow i <= %len(txt);');
      X(I2 + 'if %len(txt) - i + 1 > ' + DSPLEN + ';', I3 + 'buf = %subst(txt: i: ' + DSPLEN + ');', I2 + 'else;', I3 + 'buf = %subst(txt: i);', I2 + 'endif;');
      X(I2 + 'dsply buf;', I2 + 'i = i + ' + DSPLEN + ';', I1 + 'enddo;');
      X('end-proc;');
    }
    if (used.text) {
      protos.push('dcl-pr ' + H.text + ' ' + TXT + ';', I1 + P + ' ' + ARG + ' const;', 'end-pr;');
      X('', '// ' + tr('rpgHelperTextDoc'));
      X('dcl-proc ' + H.text + ';');
      X(I1 + 'dcl-pi *n ' + TXT + ';', I2 + P + ' ' + ARG + ' const;', I1 + 'end-pi;');
      X(I1 + 'dcl-s buf char(' + DSPLEN + ');', I1 + 'dcl-s antwort char(' + DSPLEN + ');', I1 + 'dcl-s i ' + NUM + ';', '');
      X(I1 + '// ' + tr('rpgHelperTextLong'));
      X(I1 + 'i = 1;');
      X(I1 + 'dow %len(' + P + ') - i + 1 > ' + DSPLEN + ';', I2 + 'buf = %subst(' + P + ': i: ' + DSPLEN + ');', I2 + 'dsply buf;', I2 + 'i = i + ' + DSPLEN + ';', I1 + 'enddo;');
      X(I1 + 'if i <= %len(' + P + ');', I2 + 'buf = %subst(' + P + ': i);', I1 + 'else;', I2 + 'buf = *blanks;', I1 + 'endif;');
      X(I1 + 'antwort = *blanks;');
      X(I1 + "dsply buf '' antwort;");
      X(I1 + 'return %trimr(antwort);');
      X('end-proc;');
    }
    if (used.num) {
      protos.push('dcl-pr ' + H.num + ' ' + NUM + ';', I1 + P + ' ' + ARG + ' const;', 'end-pr;');
      X('', '// ' + tr('javaHelperNumDoc'));
      X('dcl-proc ' + H.num + ';');
      X(I1 + 'dcl-pi *n ' + NUM + ';', I2 + P + ' ' + ARG + ' const;', I1 + 'end-pi;');
      X(I1 + 'dcl-s eingabe ' + TXT + ';', I1 + 'dcl-s ' + V + ' ' + NUM + ';', I1 + 'dcl-s ok ind inz(*off);', '');
      X(I1 + 'dow not ok;');
      X(I2 + 'eingabe = %trim(' + H.text + '(' + P + '));');
      X(I2 + 'if %len(eingabe) > 0;');
      X(I3 + 'monitor;', I4 + V + ' = %int(eingabe);', I4 + 'ok = *on;', I3 + 'on-error;', I4 + '// ' + tr('rpgNoNumber'), I3 + 'endmon;');
      X(I2 + 'endif;');
      X(I2 + 'if not ok;', I3 + H.out + '(' + lit(tr('javaNeedInt')) + ');', I2 + 'endif;');
      X(I1 + 'enddo;');
      X(I1 + 'return ' + V + ';');
      X('end-proc;');
    }
    if (used.boolText) {
      protos.push('dcl-pr ' + H.boolText + ' varchar(5);', I1 + 'b ind value;', 'end-pr;');
      X('', 'dcl-proc ' + H.boolText + ';');
      X(I1 + 'dcl-pi *n varchar(5);', I2 + 'b ind value;', I1 + 'end-pi;', '');
      X(I1 + 'if b;', I2 + "return 'true';", I1 + 'endif;', I1 + "return 'false';", 'end-proc;');
    }
    if (used.boolNum) {
      protos.push('dcl-pr ' + H.boolNum + ' ' + NUM + ';', I1 + 'b ind value;', 'end-pr;');
      X('', 'dcl-proc ' + H.boolNum + ';');
      X(I1 + 'dcl-pi *n ' + NUM + ';', I2 + 'b ind value;', I1 + 'end-pi;', '');
      X(I1 + 'if b;', I2 + 'return 1;', I1 + 'endif;', I1 + 'return 0;', 'end-proc;');
    }

    const out = ['**FREE', '// ' + tr('rpgHeader1'), '// ' + tr('rpgHeader2'), '// ' + tr('rpgHeader3')]
      .flatMap((l) => (l.startsWith('//') ? wrap(l) : [l]));
    out.push('ctl-opt dftactgrp(*no) actgrp(*new) main(' + H.main + ');');
    if (protos.length) out.push('', '// ' + tr('rpgProtos'), ...protos);
    out.push(...procs, ...helpers.flatMap((l) => wrap(l)));
    return out.join('\n') + '\n';
  }

  BBE.rpggen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
