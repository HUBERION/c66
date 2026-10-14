/* Blockbild-Editor – Übersetzung nach MARTIN GOES (+ Interpreter)
 *
 *   MARTIN GOES: unendlich viele Zellen 0, 1, 2, … mit beliebig großen ganzen Zahlen (am Anfang 0).
 *   Befehle: M x y (x·=y), A x y (x+=y), R x y (x−=y), T (Ende), I x (einlesen), N x (x=−x), G L (Sprung),
 *            O x (ausgeben), E x L (wenn x = 0 → L), S x y (x:=y).
 *   Operanden: #5 Konstante, 5 Zelle 5, @5 Zelle, deren Adresse in Zelle 5 steht.
 *   Texte: im Speicher ab Zelle a: Länge, dann die Zeichencodes. "…" Textkonstante (\n \" \\),
 *          $x / $@x = der Text ab Zelle x bzw. ab der Adresse in Zelle x.
 *          O "…" / O $x Text ausgeben, I $x Zeile als Text einlesen, S $x "…" Textkonstante ablegen.
 *          O schreibt ohne Zeilenumbruch (O "\n" für einen Umbruch).
 *
 *   Übersetzung:
 *   - Variablen des Hauptprogramms liegen in den Zellen 0, 1, 2, … (bei Texten ab 1: Zelle 0 bleibt 0 = leerer Text).
 *   - Danach Hilfszellen: SP, FP, HP (Halde), RV (Rückgabewert), RID (Rücksprung-Nr.), HR/X1/X2 (für die
 *     Text-Routinen), K… (deren Zwischenzellen) und die Zwischenergebnisse der Anweisungen.
 *   - Unterprogramme: Rahmen auf dem Stapel (ab Zelle 1000000): [Rücksprung-Nr., alter FP, Parameter, Variablen].
 *     Jedes Unterprogramm springt am Ende zu "zurueck", das die Rücksprung-Nummer der Aufrufstelle zuordnet.
 *   - InOut-Parameter bekommen die Adresse der Variablen, Arrays die Adresse ihres Speichers auf der Halde.
 *   - Texte liegen auf der Halde und werden nie verändert; eine Text-Variable enthält die Adresse
 *     (0 = leerer Text). Verkettung, Zahl → Text und Textvergleich sind eingebaute Routinen (txt_cat, txt_num, txt_cmp).
 *   - Vergleiche: nur E (= 0) existiert. x < 0 wird mit einer Schleife geprüft (x+k und x−k, bis eines 0 wird).
 *   - Division/Rest: wiederholtes Abziehen mit Vorzeichenbehandlung (schneidet ab wie C).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;

  const STACK = 1000000;
  const KCELLS = 12;
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const labelName = (n) => {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(s)) s = 'u' + s;
    return s;
  };
  /** Textkonstante in MARTIN-GOES-Schreibweise */
  const lit = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r') + '"';

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const unsupported = [];
    const code = [];          // { label, op, args: [], cmt } oder { text } (Kommentarzeile)
    const RET = tr('mgReturnLabel');
    const END = tr('mgEndLabel');
    const HELP = { cat: 'txt_cat', num: 'txt_num', cmp: 'txt_cmp' };
    const fnLabel = new Map();
    for (const f of program.fns.filter((x) => !x.isMain)) {
      let n = labelName(f.name);
      while ([...fnLabel.values()].includes(n) || /\d$/.test(n) || n === RET || n === END || Object.values(HELP).includes(n)) n += '_';
      fnLabel.set(f.name, n);
    }
    // Sprechende Sprungmarken: wenn3/sonst3/ende3, solange4/rumpf4 … (Wörter je nach Sprache)
    const W = tr('genArgPrompt') === 'frage'
      ? { then: 'dann', else: 'sonst', end: 'ende', while: 'solange', body: 'rumpf', repeat: 'wdh', for: 'fuer', case: 'fall',
        other: 'sonstfall', back: 'weiter', and: 'und', or: 'oder', yes: 'ja', no: 'nein', sign: 'vz', div: 'div', loop: 'schleife' }
      : { then: 'then', else: 'else', end: 'end', while: 'while', body: 'body', repeat: 'repeat', for: 'for', case: 'case',
        other: 'other', back: 'resume', and: 'and', or: 'or', yes: 'yes', no: 'no', sign: 'sign', div: 'div', loop: 'loop' };
    let labelNo = 0;
    const genLabels = new Set();
    /** Gruppe von Sprungmarken mit gemeinsamer Nummer, z. B. group('then', 'else', 'end') → dann3, sonst3, ende3 */
    const group = (...hints) => {
      const fns = new Set(fnLabel.values());
      let ls;
      do { const n = ++labelNo; ls = hints.map((h) => (W[h] || h || 'L') + n); } while (ls.some((l) => fns.has(l)));
      ls.forEach((l) => genLabels.add(l));
      return ls;
    };
    const newLabel = (hint) => group(hint || 'loop')[0];
    // Textkonstanten stehen einmal in einem Datenbereich nach den Hilfszellen (Adressen werden am Ende eingesetzt)
    const litPool = [];

    // ---- Zellen
    const main = program.fns.find((f) => f.isMain);
    const mainScope = A.scopeOf(main);
    // Werden Texte gespeichert? Dann bleibt Zelle 0 frei (immer 0 = Länge 0 = leerer Text).
    const textStored = program.fns.some((f) => f.returnType === 'string' || [...A.scopeOf(f).values()].some((v) => v.type === 'string' || v.type === 'string[]'));
    const mainCell = new Map();
    const first = textStored ? 1 : 0;
    for (const [n] of mainScope) mainCell.set(n, first + mainCell.size);
    const base = first + mainCell.size;
    const R = { SP: base, FP: base + 1, HP: base + 2, RV: base + 3, RID: base + 4, HR: base + 5, X1: base + 6, X2: base + 7 };
    const K0 = base + 8;
    const TEMP0 = K0 + KCELLS;
    let maxTemp = 0, maxK = 0;
    const usedReg = new Set();
    let usesHeap = false, usesStack = false, usesEnd = false;
    const usedHelp = new Set();
    const callSites = [];

    // ---- Namen der Zellen für Kopf und Kommentare
    const cellName = new Map();
    if (textStored) cellName.set(0, tr('mgEmptyText'));
    for (const [n, c] of mainCell) cellName.set(c, n);
    for (const [k, c] of Object.entries(R)) cellName.set(c, k);
    for (let i = 0; i < KCELLS; i++) cellName.set(K0 + i, 'k' + (i + 1));
    const nm = (n) => (cellName.has(+n) ? cellName.get(+n) : +n >= TEMP0 ? 't' + (+n - TEMP0 + 1) : n);
    const textCells = new Set([...mainCell].filter(([n]) => mainScope.get(n).type === 'string').map(([, c]) => String(c)));
    // Hilfszellen, die gerade die Adresse einer Variablen/eines Elements enthalten: t1 → { name, text }
    // (dann heißt @t1 im Kommentar einfach „result“ oder „werte[i]“)
    const alias = new Map();
    const opnd = (o) => {
      if (typeof o !== 'string') return String(o);
      if (o.startsWith('"')) return o;
      if (isLit(o)) return lit(litPool[+o.slice(2)].v);
      if (o.startsWith('#')) return o.slice(1);
      if (o.startsWith('$@')) return tr('mgPsText') + ' ' + (alias.has(o.slice(2)) ? alias.get(o.slice(2)).name : nm(o.slice(2)));
      if (o.startsWith('$')) return tr('mgPsText') + '(' + opnd(o.slice(1)) + ')';
      if (o.startsWith('@')) return alias.has(o.slice(1)) ? alias.get(o.slice(1)).name : '@' + nm(o.slice(1));
      return nm(o);
    };
    const isText = (x) => textCells.has(x) || (x.startsWith('@') && alias.has(x.slice(1)) && alias.get(x.slice(1)).text);
    /** Klartext zu einem Befehl, z. B. „X1 := antwort“ */
    function explain(op, args) {
      const [x, y] = args;
      const X = opnd(x), Y = opnd(y);
      switch (op) {
        case 'S':
          if (x.startsWith('$')) return Y + ' → ' + X;
          return X + ' := ' + (y === '#0' && isText(x) ? '""' : Y);
        case 'A': return X + ' := ' + X + ' + ' + Y;
        case 'R': return X + ' := ' + X + ' − ' + Y;
        case 'M': return X + ' := ' + X + ' · ' + Y;
        case 'N': return X + ' := −' + X;
        case 'E': return X + ' = 0 → ' + y;
        case 'I': return x.startsWith('$') ? tr('mgPsLine') + ' → ' + X : X + ' := ' + tr('mgPsNum');
        case 'O': return x.startsWith('"') ? null : tr('mgPsOut') + ' ' + X;
        default: return null;
      }
    }

    let pendingLabel = null;
    /** Befehl ausgeben; der Kommentar wird sofort gebildet (Namen gelten zu diesem Zeitpunkt). */
    function emit(op, args, cmt, aliasFor) {
      args = args || [];
      code.push({ label: pendingLabel, op, args, cmt: cmt || explain(op, args) });
      pendingLabel = null;
      // eine Hilfszelle bekommt einen neuen Wert → ihr Name gilt nicht mehr
      if (args[0] && /^\d+$/.test(args[0]) && 'SARMNI'.includes(op)) alias.delete(args[0]);
      if (aliasFor) alias.set(args[0], aliasFor);
    }
    function label(l) {
      if (pendingLabel) emit('G', [l]); // zwei Labels hintereinander: leerer Sprung (wird später entfernt)
      pendingLabel = l;
    }
    function note(text) { code.push({ text }); }

    function frameOf(fn) {
      const scope = A.scopeOf(fn);
      const slot = new Map();
      let k = 2;
      for (const p of fn.params) slot.set(p.name, k++);
      for (const [n] of scope) if (!slot.has(n)) slot.set(n, k++);
      return { scope, slot, size: k };
    }

    function temp(ctx) {
      if (ctx.helper) { const t = K0 + ctx.tmp++; maxK = Math.max(maxK, ctx.tmp); return t; }
      const t = TEMP0 + ctx.tmp++;
      maxTemp = Math.max(maxTemp, ctx.tmp);
      return t;
    }
    const reg = (r) => { usedReg.add(r); return String(R[r]); };
    const typeOf = (ctx, a) => A.typeOf(a, ctx.scope);

    /** Zelle (Operand) einer Variablen zum Lesen/Schreiben. */
    function varOperand(ctx, n) {
      if (ctx.fn.isMain) return String(mainCell.get(n) ?? 0);
      const slot = ctx.frame.slot.get(n) ?? 2;
      const t = String(temp(ctx));
      const v = ctx.scope.get(n);
      const info = { name: n, text: !!v && v.type === 'string' };
      const byRef = v && v.kind === 'param' && v.byRef && !A.isArrayType(v.type);
      emit('S', [t, reg('FP')]);
      emit('A', [t, '#' + slot], tr('mgCmtAddrOf', n, ' (FP+' + slot + ')'), byRef ? null : info);
      if (byRef) emit('S', [t, '@' + t], tr('mgCmtAddr', n), info);
      return '@' + t;
    }

    /** Operand, der den Wert liefert (#k, Zelle oder @t). Bei Texten ist der Wert die Adresse. */
    function val(ctx, a) {
      const s = strip(a);
      if (s.k === 'num' && Number.isInteger(s.v)) return '#' + s.v;
      if (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num' && Number.isInteger(strip(s.a).v)) return '#-' + strip(s.a).v;
      if (s.k === 'id') return varOperand(ctx, s.name);
      if (s.k === 'idx') return elemOperand(ctx, s);
      if (s.k === 'len') {
        const o = strip(s.obj);
        const at = A.isArrayType(typeOf(ctx, o)) ? cellOf(ctx, val(ctx, o)) : textAddr(ctx, o);
        if (at === '#0') return '#0';
        if (isLit(at)) return '#' + litLen(at);   // Länge einer Textkonstante ist bekannt
        if (+at >= TEMP0) alias.set(at, { name: A.exprText(o) + '.length' });   // @t = Länge
        return '@' + at;   // Länge steht an der Adresse
      }
      if (typeOf(ctx, s) === 'string') return textAddr(ctx, s);
      return String(evalInto(ctx, s));
    }

    /** Operand in eine direkte Zelle bringen (für @…/$@…). */
    function cellOf(ctx, op) {
      if (/^\d+$/.test(op)) return op;
      if (op === '#0') return '#0';
      const t = String(temp(ctx));
      emit('S', [t, op]);
      return t;
    }

    /** Element a[i]: Adresse = Basis + i + 1 */
    function elemOperand(ctx, s) {
      const t = String(temp(ctx));
      const info = { name: A.exprText(s), text: typeOf(ctx, s) === 'string' };
      emit('S', [t, val(ctx, s.obj)]);
      const i = strip(s.index);
      if (i.k === 'num' && Number.isInteger(i.v)) emit('A', [t, '#' + (i.v + 1)], tr('mgCmtAddrOf', info.name, ''), info);
      else { emit('A', [t, val(ctx, i)]); emit('A', [t, '#1'], tr('mgCmtAddrOf', info.name, ''), info); }
      return '@' + t;
    }

    /** Operand, dessen Wert die Adresse der Variablen/des Elements ist (für InOut). */
    function addrValue(ctx, a) {
      const s = strip(a);
      if (s.k === 'idx') return elemOperand(ctx, s).slice(1);
      if (s.k !== 'id') return '#0';
      if (ctx.fn.isMain) return '#' + (mainCell.get(s.name) ?? 0);
      return varOperand(ctx, s.name).slice(1);
    }

    // ------------------------------------------------------------ Texte

    /** Aufruf einer eingebauten Text-Routine; Ergebnis (RV) in eine neue Zwischenzelle. */
    function helperCall(ctx, name, args) {
      usedHelp.add(name);
      if (args[0] !== undefined) emit('S', [reg('X1'), args[0]]);
      if (args[1] !== undefined) emit('S', [reg('X2'), args[1]]);
      const id = callSites.length + 1;
      const back = newLabel('back');
      callSites.push(back);
      emit('S', [reg('HR'), '#' + id]);
      emit('G', [HELP[name]]);
      label(back);
      const t = String(temp(ctx));
      emit('S', [t, reg('RV')]);
      return t;
    }

    /** Textkonstante → Konstante mit ihrer Adresse im Datenbereich (#§n, wird am Ende ersetzt). */
    function textLiteral(ctx, v) {
      if (v === '') return '#0';
      let i = litPool.findIndex((x) => x.v === v);
      if (i < 0) { litPool.push({ v, len: [...v].length }); i = litPool.length - 1; }
      return '#§' + i;
    }
    const isLit = (op) => typeof op === 'string' && op.startsWith('#§');
    const litLen = (op) => litPool[+op.slice(2)].len;

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [s];
    }

    /** Text-Ausdruck → Zelle (oder #0) mit der Adresse des Texts. */
    function textAddr(ctx, a) {
      const ps = parts(ctx, a);
      let acc = null;
      for (const p of ps) {
        const t = typeOf(ctx, p);
        let x;
        if (p.k === 'str') x = textLiteral(ctx, p.v);
        else if (t === 'string') x = cellOf(ctx, p.k === 'id' ? varOperand(ctx, p.name) : p.k === 'idx' ? elemOperand(ctx, p) : '#0');
        else if (t === 'bool') {
          const [yes, no, end] = group('yes', 'no', 'end');
          x = String(temp(ctx));
          condJump(ctx, p, yes, no);
          label(yes); emit('S', [x, textLiteral(ctx, 'true')]); emit('G', [end]);
          label(no); emit('S', [x, textLiteral(ctx, 'false')]);
          label(end);
        } else x = helperCall(ctx, 'num', [val(ctx, p)]);
        if (x === '#0' && acc !== null) continue;
        acc = acc === null ? x : helperCall(ctx, 'cat', [acc, x]);
      }
      return acc === null ? '#0' : acc;
    }

    /** Text ausgeben, Stück für Stück (ohne neuen Text zu bauen). */
    function emitTextOut(ctx, a) {
      for (const p of parts(ctx, a)) {
        const t = typeOf(ctx, p);
        if (p.k === 'str') { if (p.v !== '') emit('O', [lit(p.v)]); }
        else if (t === 'string') {
          const c = cellOf(ctx, p.k === 'id' ? varOperand(ctx, p.name) : elemOperand(ctx, p));
          if (c !== '#0') emit('O', ['$@' + c]);
        } else if (t === 'bool') {
          const [yes, no, end] = group('yes', 'no', 'end');
          condJump(ctx, p, yes, no);
          label(yes); emit('O', ['"true"']); emit('G', [end]);
          label(no); emit('O', ['"false"']);
          label(end);
        } else emit('O', [val(ctx, p)]);
      }
    }

    // ------------------------------------------------------------ Zahlen

    /** Ausdruck in eine neue Hilfszelle rechnen; liefert die Zellnummer. */
    function evalInto(ctx, a) {
      const s = strip(a);
      const t = temp(ctx);
      const T = String(t);
      if (s.k === 'bin' && '+-*'.includes(s.op) && typeOf(ctx, s) !== 'string') {
        const fa = strip(s.a), fb = strip(s.b);
        // Kommazahl-Faktor: x * 1.25 → x * 5 / 4
        if (s.op === '*' && (isFrac(fa) || isFrac(fb))) {
          const [f, other] = isFrac(fb) ? [fb, s.a] : [fa, s.b];
          const [p, q] = fraction(f.raw);
          emit('S', [T, val(ctx, other)]);
          emit('M', [T, '#' + p]);
          divmod(ctx, t, '#' + q, '/', t);
          return t;
        }
        emit('S', [T, val(ctx, s.a)]);
        emit({ '+': 'A', '-': 'R', '*': 'M' }[s.op], [T, val(ctx, s.b)]);
        return t;
      }
      if (s.k === 'bin' && (s.op === '/' || s.op === '%')) {
        emit('S', [T, val(ctx, s.a)]);
        const d = temp(ctx);
        emit('S', [String(d), val(ctx, s.b)]);
        divmod(ctx, t, String(d), s.op, t);
        return t;
      }
      if (s.k === 'un' && s.op === '-') { emit('S', [T, val(ctx, s.a)]); emit('N', [T]); return t; }
      if (s.k === 'un' && s.op === '+') { emit('S', [T, val(ctx, s.a)]); return t; }
      if (s.k === 'num') { emit('S', [T, '#' + Math.trunc(s.v)]); return t; }
      if (typeOf(ctx, s) === 'string') { unsupported.push(tr('mgNoTextNum')); emit('S', [T, '#0']); return t; }
      // Wahrheitswert → 0/1
      const [yes, no] = group('yes', 'no');
      emit('S', [T, '#0']);
      condJump(ctx, s, yes, no);
      label(yes);
      emit('S', [T, '#1']);
      label(no);
      return t;
    }

    const isFrac = (s) => s.k === 'num' && !Number.isInteger(s.v);
    function fraction(raw) {
      const [i, d = ''] = String(raw).split('.');
      const p = parseInt(i + d, 10), q = Math.pow(10, d.length);
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      const g = gcd(Math.abs(p), q);
      return [p / g, q / g];
    }

    /** Springt nach neg, wenn Zelle x < 0, sonst nach nonneg (x bleibt unverändert). */
    function signJump(ctx, x, neg, nonneg) {
      const p = String(temp(ctx)), q = String(temp(ctx));
      const loop = newLabel('sign');
      emit('S', [p, x], tr('mgCmtSign'));
      emit('S', [q, x]);
      label(loop);
      emit('E', [q, nonneg]);
      emit('E', [p, neg]);
      emit('A', [p, '#1']);
      emit('R', [q, '#1']);
      emit('G', [loop]);
    }

    /** dst := a / d bzw. a % d (a steht schon in Zelle aCell, d ist ein Operand). Schneidet ab wie C. */
    function divmod(ctx, aCell, d, op, dst) {
      const a = String(aCell);
      const b = String(temp(ctx)), q = String(temp(ctx)), sq = String(temp(ctx)), sr = String(temp(ctx)), diff = String(temp(ctx));
      const [aPos, bChk, bPos, loop, done, aNeg, bNeg] = group('div', 'div', 'div', 'div', 'div', 'div', 'div').map((l, i) => { const x = l + 'abcdefg'[i]; genLabels.add(x); return x; });
      emit('S', [b, d], op === '/' ? tr('mgCmtDiv') : tr('mgCmtMod'));
      usesEnd = true;
      emit('E', [b, END]);                // Division durch 0 → Programmende
      emit('S', [q, '#0']);
      emit('S', [sq, '#1']);
      emit('S', [sr, '#1']);
      signJump(ctx, a, aNeg, aPos);
      label(aNeg);
      emit('N', [a]);
      emit('N', [sq]);
      emit('N', [sr]);
      label(aPos);
      signJump(ctx, b, bNeg, bChk);
      label(bNeg);
      emit('N', [b]);
      emit('N', [sq]);
      label(bChk);
      label(loop);
      emit('S', [diff, a]);
      emit('R', [diff, b]);
      signJump(ctx, diff, done, bPos);
      label(bPos);
      emit('S', [a, diff]);
      emit('A', [q, '#1']);
      emit('G', [loop]);
      label(done);
      if (op === '/') { emit('M', [q, sq]); emit('S', [String(dst), q]); }
      else { emit('M', [a, sr]); emit('S', [String(dst), a]); }
    }

    /** Bedingung als Sprünge. */
    function condJump(ctx, a, yes, no) {
      const s = strip(a);
      if (s.k === 'bin' && s.op === '&&') { const mid = newLabel('and'); condJump(ctx, s.a, mid, no); label(mid); condJump(ctx, s.b, yes, no); return; }
      if (s.k === 'bin' && s.op === '||') { const mid = newLabel('or'); condJump(ctx, s.a, yes, mid); label(mid); condJump(ctx, s.b, yes, no); return; }
      if (s.k === 'un' && s.op === '!') { condJump(ctx, s.a, no, yes); return; }
      if (s.k === 'bin' && ['==', '!=', '<', '<=', '>', '>='].includes(s.op)) {
        if (typeOf(ctx, s.a) === 'string' || typeOf(ctx, s.b) === 'string') { textCond(ctx, s, yes, no); return; }
        // Vergleich mit 0 direkt mit E:  n != 0  →  E n …
        const zero = (x) => strip(x).k === 'num' && strip(x).v === 0;
        if ((s.op === '==' || s.op === '!=') && (zero(s.a) || zero(s.b))) {
          const v = val(ctx, zero(s.b) ? s.a : s.b);
          emit('E', [v, s.op === '==' ? yes : no]);
          emit('G', [s.op === '==' ? no : yes]);
          return;
        }
        const swap = s.op === '<=' || s.op === '>';
        const d = temp(ctx), D = String(d);
        emit('S', [D, val(ctx, swap ? s.b : s.a)]);
        emit('R', [D, val(ctx, swap ? s.a : s.b)]);
        switch (s.op) {
          case '==': emit('E', [D, yes]); emit('G', [no]); return;
          case '!=': emit('E', [D, no]); emit('G', [yes]); return;
          case '<': case '>': signJump(ctx, D, yes, no); return;      // a−b < 0  bzw.  b−a < 0
          default: signJump(ctx, D, no, yes); return;                 // <=: b−a < 0 → falsch;  >=: a−b < 0 → falsch
        }
      }
      if (typeOf(ctx, s) === 'string') {
        // Text als Bedingung: nicht leer
        const c = textAddr(ctx, s);
        if (c === '#0') { emit('G', [no]); return; }
        if (isLit(c)) { emit('G', [yes]); return; }
        const n = String(temp(ctx));
        emit('S', [n, '@' + c]);
        emit('E', [n, no]);
        emit('G', [yes]);
        return;
      }
      const v = val(ctx, s);
      if (v.startsWith('#')) { emit('G', [v === '#0' ? no : yes]); return; }
      emit('E', [v, no]);
      emit('G', [yes]);
    }

    /** Textvergleich über txt_cmp (Ergebnis −1, 0, 1). */
    function textCond(ctx, s, yes, no) {
      const isEmpty = (x) => strip(x).k === 'str' && strip(x).v === '';
      // Vergleich mit "" → nur die Länge prüfen
      if ((s.op === '==' || s.op === '!=') && (isEmpty(s.a) || isEmpty(s.b))) {
        const other = isEmpty(s.a) ? s.b : s.a;
        const c = textAddr(ctx, other);
        if (c === '#0') { emit('G', [s.op === '==' ? yes : no]); return; }
        if (isLit(c)) { emit('G', [s.op === '==' ? no : yes]); return; }
        const n = String(temp(ctx));
        emit('S', [n, '@' + c]);
        emit('E', [n, s.op === '==' ? yes : no]);
        emit('G', [s.op === '==' ? no : yes]);
        return;
      }
      const a = textAddr(ctx, s.a), b = textAddr(ctx, s.b);
      const r = helperCall(ctx, 'cmp', [a, b]);
      switch (s.op) {
        case '==': emit('E', [r, yes]); emit('G', [no]); return;
        case '!=': emit('E', [r, no]); emit('G', [yes]); return;
        case '<': emit('A', [r, '#1']); emit('E', [r, yes]); emit('G', [no]); return;   // −1 → kleiner
        case '>=': emit('A', [r, '#1']); emit('E', [r, no]); emit('G', [yes]); return;
        case '>': emit('R', [r, '#1']); emit('E', [r, yes]); emit('G', [no]); return;   // 1 → größer
        default: emit('R', [r, '#1']); emit('E', [r, no]); emit('G', [yes]); return;    // <=
      }
    }

    function condFrom(ctx, src, yes, no) {
      const ast = tryParse(src);
      if (!ast) { emit('G', [yes]); return; }
      condJump(ctx, ast, yes, no);
    }

    /** Wert in eine Variable/ein Element schreiben. */
    function store(ctx, targetSrc, ast) {
      const tgt = tryTarget(targetSrc);
      if (!tgt) return;
      const tt = typeOf(ctx, tgt);
      if (tt === 'string') {
        const v = ast ? textAddr(ctx, ast) : '#0';
        emit('S', [lval(ctx, tgt), v]);
        return;
      }
      if (!ast) { emit('S', [lval(ctx, tgt), '#0']); return; }
      const s = strip(ast);
      if (typeOf(ctx, s) === 'string') { unsupported.push(tr('mgNoTextNum')); note('; ' + tr('mgSkipped')); return; }
      // x = x + y → A x y (bei Zellen des Hauptprogramms)
      if (tgt.k === 'id' && ctx.fn.isMain && s.k === 'bin' && '+-*'.includes(s.op) && strip(s.a).k === 'id' && strip(s.a).name === tgt.name &&
          !isFrac(strip(s.b))) {
        const y = val(ctx, s.b);
        emit({ '+': 'A', '-': 'R', '*': 'M' }[s.op], [String(mainCell.get(tgt.name)), y]);
        return;
      }
      const v = val(ctx, s);
      emit('S', [lval(ctx, tgt), v]);
    }

    function lval(ctx, tgt) {
      if (tgt.k === 'id') return varOperand(ctx, tgt.name);
      return elemOperand(ctx, tgt);
    }

    // ------------------------------------------------------------ Anweisungen

    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }

    function genStmt(ctx, n) {
      ctx.tmp = 0;
      const head = (txt) => note('; ' + txt + (n.comment ? '   (' + n.comment.replace(/\s+/g, ' ') + ')' : ''));
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) note('; ' + l);
          return;
        case 'decl': {
          if (A.isArrayType(n.vtype)) {
            head(n.name + ' = ' + tr('mgNewArray', n.length));
            usesHeap = true;
            const len = tryParse(n.length);
            const hp = reg('HP');
            const lenV = len ? val(ctx, len) : '#0';
            const t = String(temp(ctx));
            emit('S', [t, lenV]);
            emit('S', ['@' + hp, t], tr('mgCmtLen'));
            emit('S', [lval(ctx, { k: 'id', name: n.name }), hp]);
            emit('A', [hp, t]);
            emit('A', [hp, '#1']);
            return;
          }
          head(n.name + ' = ' + (String(n.init || '').trim() || (n.vtype === 'string' ? '""' : '0')));
          store(ctx, n.name, tryParse(n.init));
          return;
        }
        case 'assign':
          head(n.target + ' = ' + n.expr);
          store(ctx, n.target, tryParse(n.expr));
          return;
        case 'input': {
          const tgt = tryTarget(n.target);
          head(tr('mgInput', n.target) + (String(n.prompt || '').trim() ? '  ' + n.prompt : ''));
          if (!tgt) return;
          const p = tryParse(n.prompt);
          if (p) emitTextOut(ctx, p);
          ctx.tmp = 0;
          if (typeOf(ctx, tgt) === 'string') {
            usesHeap = true;
            const hp = reg('HP');
            const t = String(temp(ctx));
            emit('S', [t, hp]);
            emit('I', ['$@' + t], tr('mgCmtReadText'));
            emit('A', [hp, '@' + t]);
            emit('A', [hp, '#1']);
            emit('S', [lval(ctx, tgt), t]);
          } else emit('I', [lval(ctx, tgt)]);
          return;
        }
        case 'output': {
          head(tr('mgOutput', n.expr));
          const ast = tryParse(n.expr);
          if (ast) emitTextOut(ctx, ast);
          emit('O', ['"\\n"']);
          return;
        }
        case 'if': {
          head(tr('mgIf', n.cond));
          const [yes, no, end] = group('then', 'else', 'end');
          condFrom(ctx, n.cond, yes, no);
          label(yes);
          genSeq(ctx, n.then);
          if (n.else && n.else.length) { emit('G', [end]); label(no); genSeq(ctx, n.else); label(end); }
          else { label(no); }
          return;
        }
        case 'while': {
          head(tr('mgWhile', n.cond));
          const [top, body, end] = group('while', 'body', 'end');
          label(top);
          ctx.tmp = 0;
          condFrom(ctx, n.cond, body, end);
          label(body);
          genSeq(ctx, n.body);
          emit('G', [top]);
          label(end);
          return;
        }
        case 'until': {
          head(tr('mgUntil', n.cond));
          const [top, end] = group('repeat', 'end');
          label(top);
          genSeq(ctx, n.body);
          ctx.tmp = 0;
          condFrom(ctx, n.cond, end, top);
          label(end);
          return;
        }
        case 'for': {
          head(tr('mgFor', n.counter, n.from, n.to, String(n.step || '1').trim() || '1'));
          const [top, body, end] = group('for', 'body', 'end');
          store(ctx, n.counter, tryParse(n.from));
          const stepAst = tryParse(n.step) || { k: 'num', v: 1, raw: '1' };
          const lit1 = A.literalValue(stepAst);
          const k = tryParse(n.counter), to = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          label(top);
          ctx.tmp = 0;
          if (typeof lit1 === 'number') condJump(ctx, { k: 'bin', op: lit1 >= 0 ? '<=' : '>=', a: k, b: to }, body, end);
          else {
            const [pos, neg] = group('sign', 'sign').map((l, i) => { const x = l + 'pn'[i]; genLabels.add(x); return x; });
            const s = String(temp(ctx));
            emit('S', [s, val(ctx, stepAst)]);
            signJump(ctx, s, neg, pos);
            label(pos);
            ctx.tmp = 0;
            condJump(ctx, { k: 'bin', op: '<=', a: k, b: to }, body, end);
            label(neg);
            ctx.tmp = 0;
            condJump(ctx, { k: 'bin', op: '>=', a: k, b: to }, body, end);
          }
          label(body);
          genSeq(ctx, n.body);
          ctx.tmp = 0;
          store(ctx, n.counter, { k: 'bin', op: '+', a: k, b: stepAst });
          emit('G', [top]);
          label(end);
          return;
        }
        case 'switch': {
          head(tr('mgSwitch', n.expr));
          const sel = tryParse(n.expr);
          if (!sel) return;
          const isText = typeOf(ctx, sel) === 'string';
          const [end, other] = group('end', 'other');
          const labels = n.cases.map(() => newLabel('case'));
          const sv = isText ? textAddr(ctx, sel) : cellOf(ctx, val(ctx, sel));
          n.cases.forEach((c, i) => {
            const v = tryParse(c.value) || { k: isText ? 'str' : 'num', v: isText ? '' : 0, raw: '0' };
            if (isText) {
              const r = helperCall(ctx, 'cmp', [sv, textAddr(ctx, v)]);
              emit('E', [r, labels[i]]);
            } else {
              const d = String(temp(ctx));
              emit('S', [d, sv]);
              emit('R', [d, val(ctx, v)]);
              emit('E', [d, labels[i]]);
            }
          });
          emit('G', [other]);
          n.cases.forEach((c, i) => { label(labels[i]); genSeq(ctx, c.body); emit('G', [end]); });
          label(other);
          if (n.else) genSeq(ctx, n.else);
          label(end);
          return;
        }
        case 'call': {
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          head(tr('mgCall', (n.target && n.target.trim() ? n.target + ' = ' : '') + (n.fn || '?') + '(' + n.args.join(', ') + ')'));
          if (!callee) return;
          usesStack = true;
          const fr = frames.get(callee);
          const SP = reg('SP'), FP = reg('FP');
          // Argumente in den neuen Rahmen schreiben (ab SP)
          callee.params.forEach((p, i) => {
            ctx.tmp = 0;
            const src = tryParse(n.args[i] || '') || { k: 'num', v: 0, raw: '0' };
            const v = A.isArrayType(p.type) ? val(ctx, src) : p.byRef ? addrValue(ctx, src) : p.type === 'string' ? textAddr(ctx, src) : val(ctx, src);
            const a = String(temp(ctx));
            emit('S', [a, SP]);
            emit('A', [a, '#' + fr.slot.get(p.name)], tr('mgCmtParam', p.name), { name: callee.name + '.' + p.name, text: p.type === 'string' });
            emit('S', ['@' + a, v]);
          });
          ctx.tmp = 0;
          const id = callSites.length + 1;
          const back = newLabel('back');
          callSites.push(back);
          const a = String(temp(ctx));
          emit('S', ['@' + SP, '#' + id], tr('mgCmtRetId'));
          emit('S', [a, SP]);
          emit('A', [a, '#1']);
          emit('S', ['@' + a, FP], tr('mgCmtSaveFp'));
          emit('S', [FP, SP]);
          emit('A', [SP, '#' + fr.size]);
          emit('G', [fnLabel.get(callee.name)]);
          label(back);
          if (callee.returnType !== 'void' && n.target && n.target.trim()) {
            ctx.tmp = 0;
            const tgt = tryTarget(n.target);
            if (!tgt) return;
            const tt = typeOf(ctx, tgt);
            if (tt === callee.returnType) emit('S', [lval(ctx, tgt), reg('RV')]);
            else if (tt === 'string') { const t = helperCall(ctx, 'num', [reg('RV')]); emit('S', [lval(ctx, tgt), t]); }
            else unsupported.push(tr('mgNoTextNum'));
          }
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Eingebaute Text-Routinen

    function genHelpers() {
      if (!usedHelp.size) return;
      const K = (i) => String(K0 + i);
      const X1 = reg('X1'), X2 = reg('X2'), RV = reg('RV'), HP = reg('HP'), HR = reg('HR'), RID = reg('RID');
      const ret = () => { emit('S', [RID, HR]); emit('G', [RET]); };
      const hctx = { helper: true, tmp: 0 };
      if (usedHelp.has('cat')) {
        note(''); note('; ' + tr('mgHelpCat'));
        const [r, d, s, k] = [K(0), K(1), K(2), K(3)];
        const l1 = newLabel(), l2 = newLabel(), l3 = newLabel(), l4 = newLabel();
        label(HELP.cat);
        emit('S', [r, HP]);
        emit('S', [k, '@' + X1]);
        emit('A', [k, '@' + X2]);
        emit('S', ['@' + r, k], tr('mgCmtLen'));
        emit('S', [d, r]);
        emit('S', [s, X1]);
        emit('S', [k, '@' + X1]);
        label(l1); emit('E', [k, l2]); emit('A', [s, '#1']); emit('A', [d, '#1']); emit('S', ['@' + d, '@' + s]); emit('R', [k, '#1']); emit('G', [l1]);
        label(l2); emit('S', [s, X2]); emit('S', [k, '@' + X2]);
        label(l3); emit('E', [k, l4]); emit('A', [s, '#1']); emit('A', [d, '#1']); emit('S', ['@' + d, '@' + s]); emit('R', [k, '#1']); emit('G', [l3]);
        label(l4); emit('S', [HP, d]); emit('A', [HP, '#1']); emit('S', [RV, r]);
        ret();
      }
      if (usedHelp.has('num')) {
        note(''); note('; ' + tr('mgHelpNum'));
        const [r, p, x, q, i, j, h, st] = [K(0), K(1), K(2), K(3), K(4), K(5), K(6), K(7)];
        hctx.tmp = 8;
        const pos = newLabel(), neg = newLabel(), digit = newLabel(), sub = newLabel(), dDone = newLabel(), dOk = newLabel(),
          rev = newLabel(), revBody = newLabel(), done = newLabel();
        label(HELP.num);
        emit('S', [r, HP]);
        emit('S', [x, X1]);
        emit('S', [p, r]);
        emit('A', [p, '#1']);
        hctx.tmp = 8; signJump(hctx, x, neg, pos);
        label(neg); emit('S', ['@' + p, '#45'], '-'); emit('A', [p, '#1']); emit('N', [x]);
        label(pos); emit('S', [st, p]);
        // Ziffern von hinten: x % 10 durch wiederholtes Abziehen
        label(digit); emit('S', [q, '#0']);
        label(sub); emit('S', [h, x]); emit('R', [h, '#10']);
        hctx.tmp = 8; signJump(hctx, h, dDone, dOk);
        label(dOk); emit('S', [x, h]); emit('A', [q, '#1']); emit('G', [sub]);
        label(dDone); emit('S', ['@' + p, x]); emit('A', ['@' + p, '#48'], tr('mgCmtDigit')); emit('A', [p, '#1']);
        emit('S', [x, q]); emit('E', [x, rev]); emit('G', [digit]);
        // Ziffern umdrehen (st … p−1)
        label(rev); emit('S', [i, st]); emit('S', [j, p]); emit('R', [j, '#1']);
        label(revBody); emit('S', [h, j]); emit('R', [h, i]); emit('E', [h, done]);
        const swap = newLabel();
        hctx.tmp = 8; signJump(hctx, h, done, swap);
        label(swap);
        emit('S', [h, '@' + i]); emit('S', ['@' + i, '@' + j]); emit('S', ['@' + j, h]);
        emit('A', [i, '#1']); emit('R', [j, '#1']); emit('G', [revBody]);
        label(done); emit('S', [h, p]); emit('R', [h, r]); emit('R', [h, '#1']); emit('S', ['@' + r, h], tr('mgCmtLen'));
        emit('S', [HP, p]); emit('S', [RV, r]);
        ret();
      }
      if (usedHelp.has('cmp')) {
        note(''); note('; ' + tr('mgHelpCmp'));
        const [la, lb, pa, pb, d] = [K(0), K(1), K(2), K(3), K(4)];
        const loop = newLabel(), next = newLabel(), aEnd = newLabel(), lt = newLabel(), gt = newLabel(), eq = newLabel(), out = newLabel();
        label(HELP.cmp);
        emit('S', [la, '@' + X1]); emit('S', [lb, '@' + X2]); emit('S', [pa, X1]); emit('S', [pb, X2]);
        label(loop); emit('E', [la, aEnd]); emit('E', [lb, gt]);
        emit('A', [pa, '#1']); emit('A', [pb, '#1']);
        emit('S', [d, '@' + pa]); emit('R', [d, '@' + pb]); emit('E', [d, next]);
        hctx.tmp = 5; signJump(hctx, d, lt, gt);
        label(next); emit('R', [la, '#1']); emit('R', [lb, '#1']); emit('G', [loop]);
        label(aEnd); emit('E', [lb, eq]); emit('G', [lt]);
        label(lt); emit('S', [RV, '#-1']); emit('G', [out]);
        label(gt); emit('S', [RV, '#1']); emit('G', [out]);
        label(eq); emit('S', [RV, '#0']);
        label(out);
        ret();
      }
    }
    // ------------------------------------------------------------ Zusammenbau

    const frames = new Map(program.fns.filter((f) => !f.isMain).map((f) => [f, frameOf(f)]));

    const mctx = { fn: main, scope: mainScope, tmp: 0 };
    const initAt = code.length;
    genSeq(mctx, main.body);
    emit('T', [], tr('mgCmtEnd'));

    for (const fn of program.fns.filter((f) => !f.isMain)) {
      const fr = frames.get(fn);
      const ctx = { fn, scope: fr.scope, frame: fr, tmp: 0 };
      note('');
      note('; ' + tr('mgSub', fn.name, fn.params.map((p) => p.name).join(', ')));
      note('; ' + tr('mgFrame', [...fr.slot].map(([n, k]) => 'FP+' + k + ' ' + n).join(', ')));
      label(fnLabel.get(fn.name));
      // Variablen im Rahmen auf 0 setzen (der Stapel wird wiederverwendet)
      if ([...fr.slot.keys()].some((n) => (fr.scope.get(n) || {}).kind !== 'param')) note('; ' + tr('mgZeroVars'));
      for (const [n] of fr.slot) {
        const v = fr.scope.get(n);
        if (v && v.kind === 'param') continue;
        ctx.tmp = 0;
        emit('S', [varOperand(ctx, n), '#0']);
      }
      if (fn.returnType !== 'void') { ctx.tmp = 0; store(ctx, 'result', tryParse(fn.resultInit)); }
      genSeq(ctx, fn.body);
      ctx.tmp = 0;
      if (fn.returnType !== 'void') emit('S', [reg('RV'), varOperand(ctx, 'result')], tr('mgCmtResult'));
      const SP = reg('SP'), FP = reg('FP'), RID = reg('RID');
      const t = String(temp(ctx));
      emit('S', [SP, FP], tr('mgCmtPop'));
      emit('S', [RID, '@' + FP]);
      emit('S', [t, FP]);
      emit('A', [t, '#1']);
      emit('S', [FP, '@' + t]);
      emit('G', [RET]);
    }

    genHelpers();
    if (usedHelp.size) maxK = Math.max(maxK, 10);

    if (callSites.length) {
      note('');
      note('; ' + tr('mgCmtDispatch'));
      const RID = reg('RID');
      label(RET);
      callSites.forEach((l) => { emit('R', [RID, '#1']); emit('E', [RID, l]); });
      emit('T');
    }
    if (usesEnd) { label(END); emit('T'); }

    // Speicherplan: … Zwischenzellen | Textkonstanten (ab volle Zehn) | Halde (ab volle Hundert)
    const litBase = Math.ceil((TEMP0 + maxTemp + 1) / 10) * 10;
    let a = litBase;
    for (const l of litPool) { l.addr = a; a += l.len + 1; }
    const heapBase = Math.ceil((a + 1) / 100) * 100;
    // Startwerte für Stapel und Halde sowie die Textkonstanten vor das Hauptprogramm
    const init = [];
    if (usesStack) init.push({ op: 'S', args: [String(R.SP), '#' + STACK], cmt: tr('mgCmtStack') });
    if (usesHeap || usedHelp.size) { usedReg.add('HP'); init.push({ op: 'S', args: [String(R.HP), '#' + heapBase], cmt: tr('mgCmtHeap') }); }
    if (litPool.length) {
      init.push({ text: '; ' + tr('mgLitHead') });
      for (const l of litPool) init.push({ op: 'S', args: ['$' + l.addr, lit(l.v)] });
    }
    code.splice(initAt, 0, ...init);
    if (init.length) code.splice(initAt + init.length, 0, { text: '; ' + tr('mgMainHead') });

    // Adressen der Textkonstanten einsetzen
    for (const c of code) if (c.args) c.args = c.args.map((o) => (isLit(o) ? '#' + litPool[+o.slice(2)].addr : o));

    // Sprünge zum direkt folgenden Label entfernen
    for (let i = 0; i < code.length - 1; i++) {
      const c = code[i];
      if (c.op === 'G' && !c.label) {
        let j = i + 1;
        while (j < code.length && code[j].text !== undefined) j++;
        if (j < code.length && code[j].label === c.args[0]) { code.splice(i, 1); i--; }
      }
    }
    // Labels, zu denen nie gesprungen wird, weglassen (Unterprogramme und Routinen behalten ihren Namen)
    const target = new Set();
    for (const c of code) {
      if (c.op === 'G') target.add(c.args[0]);
      if (c.op === 'E') target.add(c.args[1]);
    }
    for (const c of code) if (c.label && genLabels.has(c.label) && !target.has(c.label)) c.label = null;

    // Ausgabe
    const out = ['; ' + tr('mgHeader1'), '; ' + tr('mgHeader2'), ';'];
    // Speicherplan im Kopf: eine Zeile je Bereich
    const span = (p, q) => (p === q ? String(p) : p + '…' + q);
    const plan = [];
    const cells = [...mainCell].map(([n, c]) => c + ' ' + n);
    if (textStored) cells.unshift('0 ' + tr('mgEmptyText'));
    if (cells.length) plan.push(tr('mgCells') + ' ' + cells.join(', '));
    const regDoc = { SP: tr('mgRegSP'), FP: tr('mgRegFP'), HP: tr('mgRegHP'), RV: tr('mgRegRV'), RID: tr('mgRegRID'), HR: tr('mgRegHR'), X1: tr('mgRegX'), X2: tr('mgRegX') };
    for (const [k, c] of Object.entries(R)) if (usedReg.has(k)) plan.push(c + ' ' + k + ' – ' + regDoc[k]);
    if (maxK) plan.push(span(K0, K0 + maxK - 1) + ' k1… – ' + tr('mgHelpCells'));
    if (maxTemp) plan.push(span(TEMP0, TEMP0 + maxTemp - 1) + ' t1… – ' + tr('mgTemps'));
    if (litPool.length) plan.push(span(litBase, a - 1) + ' – ' + tr('mgLitHead'));
    if (usesHeap || usedHelp.size) plan.push(heapBase + '… – ' + tr('mgCmtHeap'));
    if (usesStack) plan.push(STACK + '… – ' + tr('mgCmtStack'));
    if (plan.length) { out.push('; ' + tr('mgPlan')); for (const p of plan) out.push(';   ' + p); }
    const uniq = [...new Set(unsupported)];
    if (uniq.length) out.push(';', '; ⚠ ' + uniq.join(' '));
    out.push('');
    for (const c of code) {
      if (c.text !== undefined) { out.push(c.text); continue; }
      const lab = c.label ? (c.label + ': ').padEnd(12) : ' '.repeat(12);
      const ins = (c.op + '  ' + c.args.join(' ')).trimEnd();
      out.push((lab + (c.cmt ? ins.padEnd(20) + '; ' + c.cmt : ins)).trimEnd());
    }
    const text = out.join('\n') + '\n';
    return opts.report ? { code: text, unsupported: uniq } : text;
  }

  // ------------------------------------------------------------ Interpreter

  /** Zeile in Befehl zerlegen: Label, Befehl, Operanden (Textkonstanten mit ; und Leerzeichen erlaubt). */
  function parseLine(raw) {
    const toks = [];
    let i = 0, labelName = null;
    const s = raw;
    while (i < s.length) {
      const c = s[i];
      if (c === ';') break;
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && j + 1 < s.length) { const e = s[j + 1]; v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e; j += 2; }
          else v += s[j++];
        }
        toks.push({ str: v });
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < s.length && !/[\s;"]/.test(s[j])) j++;
      toks.push(s.slice(i, j));
      i = j;
    }
    const m = toks.length && typeof toks[0] === 'string' ? /^([A-Za-z_]\w*):(.*)$/.exec(toks[0]) : null;
    if (m) { labelName = m[1]; if (m[2]) toks[0] = m[2]; else toks.shift(); }
    else if (toks.length > 1 && toks[1] === ':') { labelName = toks.shift(); toks.shift(); }
    return { labelName, toks };
  }

  /**
   * Führt ein MARTIN-GOES-Programm aus.
   * @param src     Quelltext
   * @param io      { input(): string|null (eine Zeile), output(string), maxSteps }
   * @returns       { steps, error }
   */
  function run(src, io = {}) {
    const prog = [];
    const labels = new Map();
    String(src).split('\n').forEach((raw, lineNo) => {
      const { labelName, toks } = parseLine(raw);
      if (labelName) labels.set(labelName, prog.length);
      if (!toks.length) return;
      const [op, ...args] = toks;
      prog.push({ op: String(op).toUpperCase(), args, line: lineNo + 1 });
    });
    const mem = new Map();
    const get = (a) => mem.get(a.toString()) || 0n;
    const set = (a, v) => mem.set(a.toString(), v);
    const err = (ins, m) => new Error('Zeile ' + ins.line + ': ' + m);
    const isText = (o) => typeof o === 'string' && o.startsWith('$');
    const addr = (o, ins) => {
      if (typeof o !== 'string') throw err(ins, 'Text an falscher Stelle');
      if (o.startsWith('$')) o = o.slice(1);
      if (o.startsWith('@')) return get(BigInt(o.slice(1)));
      if (o.startsWith('#')) throw err(ins, 'Konstante als Ziel');
      return BigInt(o);
    };
    const value = (o, ins) => {
      if (typeof o !== 'string') throw err(ins, 'Text an falscher Stelle');
      return o.startsWith('#') ? BigInt(o.slice(1)) : get(addr(o, ins));
    };
    const readText = (a) => {
      const n = Number(get(a));
      let s = '';
      for (let k = 1; k <= n; k++) s += String.fromCodePoint(Number(get(a + BigInt(k))));
      return s;
    };
    const writeText = (a, s) => {
      const cps = [...s];
      set(a, BigInt(cps.length));
      cps.forEach((ch, k) => set(a + BigInt(k + 1), BigInt(ch.codePointAt(0))));
    };
    const jump = (l, ins) => { if (!labels.has(l)) throw err(ins, 'Label ' + l + ' fehlt'); return labels.get(l); };
    const out = (s) => { if (io.output) io.output(s); };
    // Eingabe: io.input() liefert eine Zeile, oder io.stdin enthält die ganze Eingabe als Text
    if (!io.input && io.stdin != null) {
      const lines = String(io.stdin).split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      io = Object.assign({}, io, { input: () => (lines.length ? lines.shift() : null) });
    }
    let pc = 0, steps = 0;
    const max = io.maxSteps || 50000000;
    try {
      while (pc < prog.length) {
        if (++steps > max) return { steps, error: 'Schrittgrenze erreicht' };
        const ins = prog[pc++];
        const [x, y] = ins.args;
        switch (ins.op) {
          case 'M': set(addr(x, ins), get(addr(x, ins)) * value(y, ins)); break;
          case 'A': set(addr(x, ins), get(addr(x, ins)) + value(y, ins)); break;
          case 'R': set(addr(x, ins), get(addr(x, ins)) - value(y, ins)); break;
          case 'T': return { steps };
          case 'I': {
            const line = io.input ? io.input() : null;
            if (isText(x)) writeText(addr(x, ins), line == null ? '' : String(line).replace(/\r$/, ''));
            else { const t = String(line == null ? '' : line).trim(); set(addr(x, ins), /^[+-]?\d+$/.test(t) ? BigInt(t) : 0n); }
            break;
          }
          case 'N': set(addr(x, ins), -get(addr(x, ins))); break;
          case 'G': pc = jump(x, ins); break;
          case 'O':
            if (typeof x !== 'string') out(x.str);
            else if (isText(x)) out(readText(addr(x, ins)));
            else out(value(x, ins).toString());
            break;
          case 'E': if (value(x, ins) === 0n) pc = jump(y, ins); break;
          case 'S':
            if (isText(x) && y && typeof y !== 'string') writeText(addr(x, ins), y.str);
            else set(addr(x, ins), value(y, ins));
            break;
          default: throw err(ins, 'unbekannter Befehl ' + ins.op);
        }
      }
      return { steps };
    } catch (e) {
      return { steps, error: e.message };
    }
  }

  BBE.mggen = { generate, run };
})(typeof window !== 'undefined' ? window : globalThis);
