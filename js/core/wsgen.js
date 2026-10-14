/* Blockbild-Editor – Übersetzung nach Whitespace (+ Interpreter)
 *
 *   Whitespace (Edwin Brady & Chris Morris, 2003, Befehlssatz 0.3): nur Leerzeichen (S), Tabulator (T) und
 *   Zeilenumbruch (L) sind Befehle, jedes andere Zeichen ist Kommentar. Ein Stapelrechner mit beliebig großen
 *   ganzen Zahlen, einer Halde (Heap) mit Adressen 0, 1, 2, … und einem eigenen Rücksprungstapel für call/ret.
 *     Stapel   SS n push · SLS dup · STS n copy · SLT swap · SLL discard · STL n slide
 *     Rechnen  TSSS add · TSST sub · TSSL mul · TSTS div · TSTT mod            (a b → a op b)
 *     Halde    TTS store (Adresse Wert →) · TTT retrieve (Adresse → Wert)
 *     Sprünge  LSS l Marke · LST l call · LSL l jump · LTS l jz · LTT l jn · LTL ret · LLL end
 *     E/A      TLSS Zeichen ausgeben · TLST Zahl ausgeben · TLTS Zeichen lesen · TLTT Zahl lesen (beide → Halde[Adresse])
 *   Zahl = Vorzeichen (S + / T −), dann Binärziffern (S 0 / T 1), dann L.  Marke = Folge aus S/T, dann L.
 *
 *   Lesbarkeit (der Quelltext selbst ist unsichtbar):
 *   - Jeder Befehl bekommt ein Kürzel als Kommentar: push_5, push_3:summe, add, retrieve, call:fak, jz:wenn1_sonst,
 *     Marken als „name:“. Kommentare enthalten nie Leerraum: jedes Zeichen, auf das /\s/ passt (auch Tabulator,
 *     Zeilenumbruch, geschütztes Leerzeichen), wird zu „·“; Zeichen-Konstanten zeigen ein Leerzeichen als '␣'.
 *   - Das Kürzel steht direkt nach dem ersten L des Befehls, wenn das L nicht das letzte Zeichen ist (Sprünge, dup,
 *     discard, E/A …), sonst vor dem Befehl. So beginnt jede Zeile mit einem Kürzel; der unsichtbare Code steht
 *     immer dahinter (nur am Zeilenende oder zwischen zwei Kürzeln, nie als Einrückung).
 *   - Kommentarzeilen (Kopf, Anweisungen des Blockbilds) brauchen einen echten Zeilenumbruch. Dafür wird eine
 *     Marke mit eigener, nie angesprungener Nummer gesetzt (LSS l): sie tut nichts, liefert aber zwei L.
 *     Am Zeilenanfang trägt eine Marke zwei Kommentarzeilen (vor und nach ihrem ersten L), sonst eine.
 *
 *   Übersetzung:
 *   - Halde: 0 = leerer Text (bleibt 0), 1 = HP (nächste freie Zelle der Halde), 2 = FP (Rahmen des laufenden
 *     Unterprogramms), ab 3 die Variablen des Hauptprogramms, danach die Zellen der eingebauten Routinen.
 *     Dann (nur mit Unterprogrammen) der Rahmenstapel mit 100000 Zellen, dahinter die Halde: zuerst die
 *     Textkonstanten (beim Start einmal angelegt), dann alles, was zur Laufzeit entsteht.
 *   - Unterprogramme: echtes call/ret. Rahmen = [Parameter …, Variablen …, result]. Der Aufrufer schreibt die
 *     Argumente direkt hinter seinen eigenen Rahmen, erhöht FP um seine Rahmengröße, ruft auf und setzt FP danach
 *     zurück. Der Rückgabewert liegt nach ret oben auf dem Stapel. Rekursion funktioniert, weil alles über FP läuft.
 *   - In-Parameter als Wert, InOut als Adresse der Zelle (Variable oder Array-Element), Arrays als Adresse.
 *   - Texte: [Länge, Zeichencodes …] auf der Halde, unveränderlich; eine Text-Variable enthält die Adresse.
 *     Arrays: [Länge, Elemente …]. Routinen: txt_pack (Zeichen vom Stapel → Text), txt_cat, txt_num (Zahl → Text),
 *     txt_cmp (−1/0/1 nach Zeichencodes), txt_out, txt_read (Zeile lesen), txt_int (Text → Zahl), int_read
 *     (Zahl lesen, fragt nach), int_div / int_mod (schneiden ab wie C), arr_new, txt_init (Textkonstanten beim Start).
 *     Routinen nehmen ihre Argumente vom Stapel und legen das Ergebnis darauf; jede hat eigene Hilfszellen.
 *   - Zuweisung, Eingabe, Aufruf mit Ergebnis: erst die Zieladresse auf den Stapel, dann den Wert, dann store.
 *   - Marken heißen nach dem Blockbild (wenn3_sonst, solange4_ende …, Wörter aus tr('wsLabelWords'));
 *     kodiert werden sie als fortlaufende Nummern.
 *   - Whitespace rechnet div/mod wie Haskell (abgerundet, Rest mit dem Vorzeichen des Divisors). Blockbild und
 *     die anderen Exporte rechnen wie C (zur 0 hin abgeschnitten, Rest mit dem Vorzeichen des Dividenden) –
 *     deshalb laufen / und % über int_div / int_mod, die das Ergebnis korrigieren.
 *   - Zahlen werden nicht mit „Zahl lesen“ (TLTT) eingelesen – das bricht im Original bei ungültiger Eingabe ab –,
 *     sondern als Textzeile, die txt_int prüft (int_read fragt nach, bis eine ganze Zahl kommt).
 *     Ende der Eingabe: „Zeichen lesen“ liefert hier −1 (Erweiterung; das Original bricht ab) → "" bzw. 0.
 *   - Speicher wird beim Start bis zur Halde einmal mit 0 beschrieben (für Interpreter, die wie das Original
 *     die Halde erst beim Schreiben anlegen und beim Lesen unbeschriebener Zellen abbrechen).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;

  const STACK_CELLS = 100000;
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const ident = (n) => {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(s)) s = 'u' + s;
    return s;
  };

  // ---------------------------------------------------------------- Kodierung
  const OPS = {
    push: 'SS', dup: 'SLS', copy: 'STS', swap: 'SLT', discard: 'SLL', slide: 'STL',
    add: 'TSSS', sub: 'TSST', mul: 'TSSL', div: 'TSTS', mod: 'TSTT',
    store: 'TTS', retrieve: 'TTT',
    mark: 'LSS', call: 'LST', jump: 'LSL', jz: 'LTS', jn: 'LTT', ret: 'LTL', end: 'LLL',
    outchar: 'TLSS', outnum: 'TLST', readchar: 'TLTS', readnum: 'TLTT'
  };
  const NUM_ARG = new Set(['push', 'copy', 'slide']);
  const LABEL_ARG = new Set(['mark', 'call', 'jump', 'jz', 'jn']);
  const enc = (code) => code.replace(/S/g, ' ').replace(/T/g, '\t').replace(/L/g, '\n');
  const bitsOf = (n) => n.toString(2).replace(/0/g, 'S').replace(/1/g, 'T');
  const numCode = (v) => { const n = BigInt(v); return (n < 0n ? 'T' : 'S') + bitsOf(n < 0n ? -n : n) + 'L'; };
  /** Marke Nr. k (k ≥ 1) → beginnt immer mit T, daher eindeutig, auch wenn ein Interpreter Marken als Zahlen liest. */
  const labelCode = (k) => bitsOf(BigInt(k)) + 'L';
  /** Kommentartext ohne Leerraum. */
  const clean = (s) => String(s).replace(/\s/g, '·');
  const charName = (cp) => {
    if (cp === 32) return "'␣'";
    if (cp === 10) return "'\\n'";
    if (cp === 9) return "'\\t'";
    if (cp === 13) return "'\\r'";
    const c = String.fromCodePoint(cp);
    if (cp < 32 || /\s/.test(c)) return '';
    return "'" + c + "'";
  };

  const DEFAULT_WORDS = 'if,then,else,end,while,body,repeat,for,switch,case,input,cond,yes,no'.split(',');
  function labelWords(list) {
    const w = String(list).split(',').map((x) => ident(x.trim()));
    const v = w.length === DEFAULT_WORDS.length ? w : DEFAULT_WORDS;
    const k = ['if', 'then', 'else', 'end', 'while', 'body', 'repeat', 'for', 'switch', 'case', 'input', 'cond', 'yes', 'no'];
    const o = {};
    k.forEach((key, i) => { o[key] = v[i]; });
    return o;
  }

  // Eingebaute Routinen und ihre Zellen (jede Routine hat eigene Zellen; sie rufen sich nie gegenseitig rekursiv auf)
  const ROUTINES = ['txt_pack', 'txt_cat', 'txt_num', 'txt_cmp', 'txt_out', 'txt_read', 'txt_int', 'int_read', 'int_div', 'int_mod', 'arr_new'];
  const HELP_KEY = {
    txt_pack: 'wsHelpPack', txt_cat: 'wsHelpCat', txt_num: 'wsHelpNum', txt_cmp: 'wsHelpCmp', txt_out: 'wsHelpOut', txt_read: 'wsHelpRead',
    txt_int: 'wsHelpInt', int_read: 'wsHelpReadInt', int_div: 'wsHelpDiv', int_mod: 'wsHelpMod', arr_new: 'wsHelpArr'
  };

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const unsupported = [];
    const W = labelWords(tr('wsLabelWords'));
    const prog = [];             // { op, arg, cmt } oder { note: [Zeilen] }
    const I = (op, arg, cmt) => { prog.push({ op, arg, cmt }); };
    const note = (...lines) => { prog.push({ note: lines }); };

    // ---- Marken
    const reserved = new Set(ROUTINES.concat(['txt_init']));
    const fnLabel = new Map();
    const subs = program.fns.filter((f) => !f.isMain);
    const main = program.fns.find((f) => f.isMain);
    for (const f of subs) {
      let n = ident(f.name);
      while (reserved.has(n)) n += '_';
      reserved.add(n);
      fnLabel.set(f.name, n);
    }
    const genLabels = new Set();
    let labelNo = 0;
    const newLabel = (hint) => {
      let n = hint + (++labelNo);
      while (reserved.has(n)) n += '_';
      reserved.add(n);
      genLabels.add(n);
      return n;
    };
    const sub = (base, suffix) => {
      let n = base + '_' + suffix;
      while (reserved.has(n)) n += '_';
      reserved.add(n);
      genLabels.add(n);
      return n;
    };
    const mark = (l) => I('mark', l);

    // ---- Zellen (symbolisch; Adressen werden am Ende vergeben)
    const cellOrder = [];        // Schlüssel der Zellen ab 3 in der Reihenfolge der Vergabe
    const cellName = new Map([['empty', '""'], ['HP', 'HP'], ['FP', 'FP']]);
    const cellAt = new Map([['empty', 0], ['HP', 1], ['FP', 2]]);
    const useCell = (key, shown) => { if (!cellName.has(key)) { cellName.set(key, shown); cellOrder.push(key); } return key; };
    const mainScope = A.scopeOf(main);
    for (const [n] of mainScope) useCell('v:' + n, n);
    const rc = (r, n) => useCell('r:' + r + '.' + n, r.replace(/^(txt|int|arr)_/, '') + '.' + n);
    let usesFP = false;
    const pushCell = (key) => { if (key === 'FP') usesFP = true; I('push', { cell: key }, cellName.get(key)); };
    const getc = (key) => { pushCell(key); I('retrieve'); };
    const setc = (key, val) => { pushCell(key); val(); I('store'); };
    const addc = (key, k) => setc(key, () => { getc(key); I('push', k); I('add'); });
    const pool = new Map();      // Textkonstante → Versatz ab Beginn der Halde
    let poolSize = 0;
    const used = new Set();      // benutzte Routinen
    const callR = (r) => { used.add(r); I('call', r); };
    const pushText = (s) => {
      if (s === '') { I('push', 0, '""'); return; }
      if (!pool.has(s)) { pool.set(s, poolSize); poolSize += [...s].length + 1; used.add('txt_pack'); }
      I('push', { konst: s }, '"' + s + '"');
    };

    // ---- Rahmen der Unterprogramme
    function frameOf(fn) {
      const scope = A.scopeOf(fn);
      const slot = new Map();
      let k = 0;
      for (const p of fn.params) if (!slot.has(p.name)) slot.set(p.name, k++);
      for (const [n] of scope) if (!slot.has(n)) slot.set(n, k++);
      return { scope, slot, size: k };
    }
    const frames = new Map(subs.map((f) => [f, frameOf(f)]));

    const typeOf = (ctx, a) => A.typeOf(a, ctx.scope);
    const isRef = (ctx, n) => { const v = ctx.scope.get(n); return !!(v && v.kind === 'param' && v.byRef && !A.isArrayType(v.type)); };

    // ------------------------------------------------------------ Adressen und Werte

    /** Adresse der eigenen Zelle einer Variablen auf den Stapel. */
    function varCell(ctx, n) {
      if (ctx.fn.isMain) { pushCell(useCell('v:' + n, n)); return; }
      const k = ctx.frame.slot.get(n);
      if (k === undefined) { pushCell(useCell('scratch', 'tmp')); return; }
      getc('FP');
      if (k) { I('push', k, '+' + n); I('add'); }
    }

    /** Adresse, an die geschrieben wird (Variable, InOut-Ziel oder Array-Element). */
    function targetAddr(ctx, tgt) {
      const t = strip(tgt);
      if (t && t.k === 'id') {
        varCell(ctx, t.name);
        if (isRef(ctx, t.name)) I('retrieve', null, '&' + t.name);
        return;
      }
      if (t && t.k === 'idx') { elemAddr(ctx, t); return; }
      pushCell(useCell('scratch', 'tmp'));
    }

    /** Adresse von a[i] = Basis + i + 1 (an der Basis steht die Länge). */
    function elemAddr(ctx, s) {
      gen(ctx, s.obj);
      const i = strip(s.index);
      if (i.k === 'num' && Number.isInteger(i.v)) { I('push', i.v + 1); I('add'); return; }
      gen(ctx, i);
      I('add');
      I('push', 1);
      I('add');
    }

    const isFrac = (s) => s.k === 'num' && !Number.isInteger(s.v);
    function fraction(raw) {
      const [i, d = ''] = String(raw).split('.');
      const p = parseInt(i + d, 10), q = Math.pow(10, d.length);
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      const g = gcd(Math.abs(p), q);
      return [p / g, q / g];
    }

    /** Wert eines Ausdrucks auf den Stapel (Zahl, 0/1 für Wahrheitswerte, Adresse bei Texten und Arrays). */
    function gen(ctx, a) {
      const s = strip(a);
      if (!s) { I('push', 0); return; }
      const t = typeOf(ctx, s);
      switch (s.k) {
        case 'num': I('push', Math.trunc(s.v)); return;
        case 'str': pushText(s.v); return;
        case 'id': targetAddr(ctx, s); I('retrieve', null, s.name); return;
        case 'idx': elemAddr(ctx, s); I('retrieve'); return;
        case 'len': gen(ctx, s.obj); I('retrieve', null, 'length'); return;
        case 'un':
          if (s.op === '-') {
            const lv = A.literalValue(s);
            if (typeof lv === 'number') { I('push', Math.trunc(lv)); return; }
            I('push', 0); num(ctx, s.a); I('sub'); return;
          }
          if (s.op === '+') { num(ctx, s.a); return; }
          break;
        case 'bin':
          if (t === 'string') { textExpr(ctx, s); return; }
          if ('+-*'.includes(s.op)) {
            const fa = strip(s.a), fb = strip(s.b);
            if (s.op === '*' && (isFrac(fa) || isFrac(fb))) {
              // Kommazahl-Faktor: x * 1.25 → x * 5 / 4 (abgeschnitten)
              const [f, other] = isFrac(fb) ? [fb, s.a] : [fa, s.b];
              const [p, q] = fraction(f.raw);
              num(ctx, other); I('push', p); I('mul'); I('push', q); callR('int_div');
              return;
            }
            num(ctx, s.a); num(ctx, s.b); I({ '+': 'add', '-': 'sub', '*': 'mul' }[s.op]);
            return;
          }
          if (s.op === '/' || s.op === '%') { num(ctx, s.a); num(ctx, s.b); callR(s.op === '/' ? 'int_div' : 'int_mod'); return; }
          break;
        default: break;
      }
      // Wahrheitswert → 0/1
      const l = newLabel(W.cond), yes = sub(l, W.yes), no = sub(l, W.no), end = sub(l, W.end);
      condJump(ctx, s, yes, no);
      mark(yes); I('push', 1); I('jump', end);
      mark(no); I('push', 0);
      mark(end);
    }

    /** Zahlenwert (Texte werden mit txt_int umgewandelt, ungültig → 0). */
    function num(ctx, a) {
      if (typeOf(ctx, a) === 'string') { textExpr(ctx, a); callR('txt_int'); I('discard', null, 'ok'); return; }
      gen(ctx, a);
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [s];
    }

    /** Text-Ausdruck → Adresse des Texts auf den Stapel. */
    function textExpr(ctx, a) {
      let n = 0;
      for (const p of parts(ctx, a)) {
        if (p.k === 'str' && p.v === '') continue;
        textPart(ctx, p);
        if (n++) callR('txt_cat');
      }
      if (!n) I('push', 0, '""');
    }

    function textPart(ctx, p) {
      const t = typeOf(ctx, p);
      if (p.k === 'str') pushText(p.v);
      else if (t === 'string' || A.isArrayType(t)) gen(ctx, p);
      else if (t === 'bool') {
        const l = newLabel(W.cond), yes = sub(l, W.yes), no = sub(l, W.no), end = sub(l, W.end);
        condJump(ctx, p, yes, no);
        mark(yes); pushText('true'); I('jump', end);
        mark(no); pushText('false');
        mark(end);
      } else { gen(ctx, p); callR('txt_num'); }
    }

    /** Text ausgeben, Stück für Stück (ohne neuen Text zu bauen). */
    function textOut(ctx, a) {
      for (const p of parts(ctx, a)) {
        const t = typeOf(ctx, p);
        if (p.k === 'str') {
          if (p.v === '') continue;
          const cps = [...p.v];
          if (cps.length === 1) { I('push', cps[0].codePointAt(0), charName(cps[0].codePointAt(0))); I('outchar'); }
          else { pushText(p.v); callR('txt_out'); }
        } else if (t === 'string') { gen(ctx, p); callR('txt_out'); }
        else if (t === 'bool') { textPart(ctx, p); callR('txt_out'); }
        else { gen(ctx, p); I('outnum'); }
      }
    }

    // ------------------------------------------------------------ Bedingungen

    function condJump(ctx, a, yes, no) {
      const s = strip(a);
      if (!s) { I('jump', yes); return; }
      if (s.k === 'bin' && s.op === '&&') { const mid = newLabel(W.cond); condJump(ctx, s.a, mid, no); mark(mid); condJump(ctx, s.b, yes, no); return; }
      if (s.k === 'bin' && s.op === '||') { const mid = newLabel(W.cond); condJump(ctx, s.a, yes, mid); mark(mid); condJump(ctx, s.b, yes, no); return; }
      if (s.k === 'un' && s.op === '!') { condJump(ctx, s.a, no, yes); return; }
      if (s.k === 'bin' && ['==', '!=', '<', '<=', '>', '>='].includes(s.op)) {
        if (typeOf(ctx, s.a) === 'string' || typeOf(ctx, s.b) === 'string') { textCond(ctx, s, yes, no); return; }
        const zero = (x) => { const v = A.literalValue(x); return v === 0; };
        // a op b  →  a − b  (bei > und <= umgedreht: b − a), dann jz / jn
        const swap = s.op === '>' || s.op === '<=';
        const [x, y] = swap ? [s.b, s.a] : [s.a, s.b];
        if (zero(y)) num(ctx, x);
        else if (zero(x)) { I('push', 0); num(ctx, y); I('sub'); }
        else { num(ctx, x); num(ctx, y); I('sub'); }
        branch(s.op, yes, no);
        return;
      }
      if (typeOf(ctx, s) === 'string') {
        // Text als Bedingung: nicht leer
        textExpr(ctx, s); I('retrieve', null, 'length');
        I('jz', no); I('jump', yes);
        return;
      }
      num(ctx, s);
      I('jz', no);
      I('jump', yes);
    }

    /** Oben liegt d = a − b (bzw. b − a bei > und <=). */
    function branch(op, yes, no) {
      switch (op) {
        case '==': I('jz', yes); I('jump', no); return;
        case '!=': I('jz', no); I('jump', yes); return;
        case '<': case '>': I('jn', yes); I('jump', no); return;
        default: I('jn', no); I('jump', yes); return;        // <= und >=
      }
    }

    /** Textvergleich über txt_cmp (−1, 0, 1). */
    function textCond(ctx, s, yes, no) {
      const isEmpty = (x) => strip(x).k === 'str' && strip(x).v === '';
      if ((s.op === '==' || s.op === '!=') && (isEmpty(s.a) || isEmpty(s.b))) {
        textExpr(ctx, isEmpty(s.a) ? s.b : s.a);
        I('retrieve', null, 'length');
        branch(s.op, yes, no);
        return;
      }
      textExpr(ctx, s.a); textExpr(ctx, s.b); callR('txt_cmp');
      if (s.op === '>' || s.op === '<=') { I('push', -1); I('mul'); }   // −r: > wird zu <, <= zu >=
      branch(s.op, yes, no);
    }

    // ------------------------------------------------------------ Anweisungen

    /** Wert in eine Variable/ein Element schreiben (ast null → 0 bzw. ""). */
    function store(ctx, targetSrc, ast) {
      const tgt = typeof targetSrc === 'string' ? tryTarget(targetSrc) : targetSrc;
      if (!tgt) return;
      const tt = typeOf(ctx, tgt);
      targetAddr(ctx, tgt);
      if (!ast) I('push', 0, tt === 'string' ? '""' : null);
      else if (tt === 'string') textExpr(ctx, ast);
      else if (A.isArrayType(tt)) gen(ctx, ast);
      else num(ctx, ast);
      I('store', null, typeof targetSrc === 'string' ? targetSrc.trim() : (tgt.k === 'id' ? tgt.name : null));
    }

    function genSeq(ctx, seq) { for (const n of seq || []) genStmt(ctx, n); }

    function genStmt(ctx, n) {
      const head = (txt) => note(txt + (n.comment ? '   (' + n.comment.replace(/\s+/g, ' ') + ')' : ''));
      switch (n.kind) {
        case 'comment':
          note(...String(n.text || '').split('\n').map((l) => '// ' + l));
          return;
        case 'decl': {
          if (A.isArrayType(n.vtype)) {
            head(n.name + ' = ' + tr('mgNewArray', n.length));
            targetAddr(ctx, { k: 'id', name: n.name });
            const len = tryParse(n.length);
            if (len) num(ctx, len); else I('push', 0);
            callR('arr_new');
            I('store', null, n.name);
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
          targetAddr(ctx, tgt);               // Zieladresse zuerst: sie bleibt unter dem gelesenen Wert liegen
          if (typeOf(ctx, tgt) === 'string') {
            if (p) textOut(ctx, p);
            callR('txt_read');
          } else {
            const again = newLabel(W.input);
            mark(again);
            if (p) textOut(ctx, p);
            callR('int_read');
            I('jz', again);                 // 0 = keine ganze Zahl → nochmal fragen
          }
          I('store', null, n.target.trim());
          return;
        }
        case 'output': {
          head(tr('mgOutput', n.expr));
          const ast = tryParse(n.expr);
          if (ast) textOut(ctx, ast);
          I('push', 10, charName(10));
          I('outchar');
          return;
        }
        case 'if': {
          head(tr('mgIf', n.cond));
          const l = newLabel(W.if), yes = sub(l, W.then), no = sub(l, W.else), end = sub(l, W.end);
          condJump(ctx, tryParse(n.cond), yes, no);
          mark(yes);
          genSeq(ctx, n.then);
          if (n.else && n.else.length) { I('jump', end); mark(no); genSeq(ctx, n.else); mark(end); }
          else mark(no);
          return;
        }
        case 'while': {
          head(tr('mgWhile', n.cond));
          const top = newLabel(W.while), body = sub(top, W.body), end = sub(top, W.end);
          mark(top);
          condJump(ctx, tryParse(n.cond), body, end);
          mark(body);
          genSeq(ctx, n.body);
          I('jump', top);
          mark(end);
          return;
        }
        case 'until': {
          head(tr('mgUntil', n.cond));
          const top = newLabel(W.repeat), end = sub(top, W.end);
          mark(top);
          genSeq(ctx, n.body);
          condJump(ctx, tryParse(n.cond), end, top);
          mark(end);
          return;
        }
        case 'for': {
          head(tr('mgFor', n.counter, n.from, n.to, String(n.step || '1').trim() || '1'));
          const top = newLabel(W.for), body = sub(top, W.body), end = sub(top, W.end);
          const k = tryTarget(n.counter);
          if (!k) return;
          store(ctx, k, tryParse(n.from) || { k: 'num', v: 0, raw: '0' });
          const stepAst = tryParse(n.step) || { k: 'num', v: 1, raw: '1' };
          const to = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          const lit = A.literalValue(stepAst);
          mark(top);
          if (typeof lit === 'number') condJump(ctx, { k: 'bin', op: lit >= 0 ? '<=' : '>=', a: k, b: to }, body, end);
          else {
            const neg = sub(top, W.no);
            num(ctx, stepAst);
            I('jn', neg);
            condJump(ctx, { k: 'bin', op: '<=', a: k, b: to }, body, end);
            mark(neg);
            condJump(ctx, { k: 'bin', op: '>=', a: k, b: to }, body, end);
          }
          mark(body);
          genSeq(ctx, n.body);
          store(ctx, k, { k: 'bin', op: '+', a: k, b: stepAst });
          I('jump', top);
          mark(end);
          return;
        }
        case 'switch': {
          head(tr('mgSwitch', n.expr));
          const sel = tryParse(n.expr);
          if (!sel) return;
          const isText = typeOf(ctx, sel) === 'string';
          const l = newLabel(W.switch), end = sub(l, W.end), other = sub(l, W.else);
          const labels = n.cases.map((c, i) => sub(l, W.case + (i + 1)));
          if (isText) textExpr(ctx, sel); else num(ctx, sel);
          n.cases.forEach((c, i) => {
            const v = tryParse(c.value) || { k: isText ? 'str' : 'num', v: isText ? '' : 0, raw: '0' };
            I('dup');
            if (isText) { textExpr(ctx, v); callR('txt_cmp'); }
            else { num(ctx, v); I('sub'); }
            I('jz', labels[i]);
          });
          I('jump', other);
          n.cases.forEach((c, i) => {
            mark(labels[i]);
            I('discard', null, n.expr.trim());
            genSeq(ctx, c.body);
            I('jump', end);
          });
          mark(other);
          I('discard', null, n.expr.trim());
          if (n.else) genSeq(ctx, n.else);
          mark(end);
          return;
        }
        case 'call': {
          const callee = subs.find((f) => f.name === n.fn);
          head(tr('mgCall', (n.target && n.target.trim() ? n.target + ' = ' : '') + (n.fn || '?') + '(' + n.args.join(', ') + ')'));
          if (!callee) return;
          const fr = frames.get(callee);
          const own = ctx.fn.isMain ? 0 : ctx.frame.size;
          const tgt = callee.returnType !== 'void' && n.target && n.target.trim() ? tryTarget(n.target) : null;
          if (tgt) targetAddr(ctx, tgt);      // Zieladresse zuerst: der Rückgabewert landet darüber
          // Argumente direkt in den neuen Rahmen (hinter den eigenen) schreiben
          callee.params.forEach((p, i) => {
            const src = tryParse(n.args[i] || '') || { k: 'num', v: 0, raw: '0' };
            const slot = fr.slot.get(p.name);
            if (ctx.fn.isMain) I('push', { stack: slot }, callee.name + '.' + p.name);
            else { getc('FP'); I('push', own + slot, '+' + callee.name + '.' + p.name); I('add'); }
            if (A.isArrayType(p.type)) gen(ctx, src);
            else if (p.byRef) targetAddr(ctx, src);
            else if (p.type === 'string') textExpr(ctx, src);
            else num(ctx, src);
            I('store');
          });
          if (own) addc('FP', own);
          I('call', fnLabel.get(callee.name));
          if (own) addc('FP', -own);
          if (callee.returnType !== 'void') {
            if (!tgt) { I('discard', null, 'result'); return; }
            const tt = typeOf(ctx, tgt);
            if (tt === 'string' && callee.returnType !== 'string') callR('txt_num');
            else if (tt !== 'string' && callee.returnType === 'string') { callR('txt_int'); I('discard', null, 'ok'); }
            I('store', null, n.target.trim());
          }
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Eingebaute Routinen

    const helpers = {
      // [c1 … cn n] → [Adresse]: legt einen Text mit den n Zeichen vom Stapel an (cn liegt oben)
      txt_pack() {
        const N = rc('txt_pack', 'n'), Ad = rc('txt_pack', 'a'), P = rc('txt_pack', 'p');
        const loop = sub('txt_pack', 'loop'), done = sub('txt_pack', 'done');
        setc(N, () => I('swap'));
        setc(Ad, () => getc('HP'));
        getc(Ad); getc(N); I('store', null, 'length');
        setc(P, () => { getc(Ad); getc(N); I('add'); });
        setc('HP', () => { getc(P); I('push', 1); I('add'); });
        mark(loop);
        getc(P); getc(Ad); I('sub'); I('jz', done);
        getc(P); I('swap'); I('store');
        addc(P, -1);
        I('jump', loop);
        mark(done);
        getc(Ad);
        I('ret');
      },
      // [a b] → [Adresse von a+b]; ist ein Teil leer, wird der andere zurückgegeben (Texte sind unveränderlich)
      txt_cat() {
        const X = rc('txt_cat', 'a'), B = rc('txt_cat', 'b'), R = rc('txt_cat', 'r'), D = rc('txt_cat', 'd'), S = rc('txt_cat', 's'), N = rc('txt_cat', 'n');
        const retA = sub('txt_cat', 'a'), retB = sub('txt_cat', 'b');
        setc(B, () => I('swap'));
        setc(X, () => I('swap'));
        getc(X); I('retrieve', null, 'length'); I('jz', retB);
        getc(B); I('retrieve', null, 'length'); I('jz', retA);
        setc(R, () => getc('HP'));
        getc(R); getc(X); I('retrieve'); getc(B); I('retrieve'); I('add'); I('store', null, 'length');
        setc(D, () => getc(R));
        for (const src of [X, B]) {
          const loop = sub('txt_cat', 'copy'), next = sub('txt_cat', 'next');
          setc(S, () => getc(src));
          setc(N, () => { getc(src); I('retrieve'); });
          mark(loop);
          getc(N); I('jz', next);
          addc(S, 1); addc(D, 1);
          getc(D); getc(S); I('retrieve'); I('store');
          addc(N, -1);
          I('jump', loop);
          mark(next);
        }
        setc('HP', () => { getc(D); I('push', 1); I('add'); });
        getc(R); I('ret');
        mark(retA); getc(X); I('ret');
        mark(retB); getc(B); I('ret');
      },
      // [n] → [Adresse]: Zahl als Text (Ziffern von hinten mit mod 10 / div 10 – n ist dann ≥ 0)
      txt_num() {
        const N = rc('txt_num', 'n'), L = rc('txt_num', 'len'), T = rc('txt_num', 't'), Ad = rc('txt_num', 'a'), P = rc('txt_num', 'p');
        const neg = sub('txt_num', 'neg'), count = sub('txt_num', 'count'), cl = sub('txt_num', 'cl'), alloc = sub('txt_num', 'alloc'),
          digit = sub('txt_num', 'digit'), sign = sub('txt_num', 'sign'), done = sub('txt_num', 'done');
        setc(N, () => I('swap'));
        setc(L, () => I('push', 1));
        getc(N); I('jn', neg);
        I('jump', count);
        mark(neg);
        setc(L, () => I('push', 2));
        setc(N, () => { I('push', 0); getc(N); I('sub'); });
        mark(count);
        setc(T, () => { getc(N); I('push', 10); I('div'); });
        mark(cl);
        getc(T); I('jz', alloc);
        addc(L, 1);
        setc(T, () => { getc(T); I('push', 10); I('div'); });
        I('jump', cl);
        mark(alloc);
        setc(Ad, () => getc('HP'));
        getc(Ad); getc(L); I('store', null, 'length');
        setc(P, () => { getc(Ad); getc(L); I('add'); });
        setc('HP', () => { getc(P); I('push', 1); I('add'); });
        mark(digit);
        getc(P); getc(N); I('push', 10); I('mod'); I('push', 48, "'0'"); I('add'); I('store');
        setc(N, () => { getc(N); I('push', 10); I('div'); });
        addc(P, -1);
        getc(N); I('jz', sign);
        I('jump', digit);
        mark(sign);
        getc(P); getc(Ad); I('sub'); I('jz', done);
        getc(P); I('push', 45, "'-'"); I('store');
        mark(done);
        getc(Ad);
        I('ret');
      },
      // [a b] → [−1 | 0 | 1]: Zeichen für Zeichen nach Zeichencode
      txt_cmp() {
        const X = rc('txt_cmp', 'a'), B = rc('txt_cmp', 'b'), LA = rc('txt_cmp', 'la'), LB = rc('txt_cmp', 'lb');
        const loop = sub('txt_cmp', 'loop'), same = sub('txt_cmp', 'same'), aEnd = sub('txt_cmp', 'aend'),
          lt = sub('txt_cmp', 'lt'), gt = sub('txt_cmp', 'gt');
        setc(B, () => I('swap'));
        setc(X, () => I('swap'));
        setc(LA, () => { getc(X); I('retrieve'); });
        setc(LB, () => { getc(B); I('retrieve'); });
        mark(loop);
        getc(LA); I('jz', aEnd);
        getc(LB); I('jz', gt);
        addc(X, 1); addc(B, 1);
        getc(X); I('retrieve'); getc(B); I('retrieve'); I('sub');
        I('dup'); I('jz', same);
        I('jn', lt);
        I('jump', gt);
        mark(same);
        I('discard');
        addc(LA, -1); addc(LB, -1);
        I('jump', loop);
        mark(aEnd);
        const eq = sub('txt_cmp', 'eq');
        getc(LB); I('jz', eq);
        mark(lt); I('push', -1); I('ret');
        mark(gt); I('push', 1); I('ret');
        mark(eq); I('push', 0); I('ret');
      },
      // [a] → []: Text ausgeben
      txt_out() {
        const P = rc('txt_out', 'p'), N = rc('txt_out', 'n');
        const loop = sub('txt_out', 'loop'), done = sub('txt_out', 'done');
        setc(P, () => I('swap'));
        setc(N, () => { getc(P); I('retrieve'); });
        mark(loop);
        getc(N); I('jz', done);
        addc(P, 1);
        getc(P); I('retrieve'); I('outchar');
        addc(N, -1);
        I('jump', loop);
        mark(done);
        I('ret');
      },
      // [] → [Adresse]: eine Zeile lesen (bis LF, CR wird verworfen); Ende der Eingabe (−1) → eof = 1
      txt_read() {
        const Ad = rc('txt_read', 'a'), P = rc('txt_read', 'p'), EOF = rc('txt_read', 'eof');
        const loop = sub('txt_read', 'loop'), cr = sub('txt_read', 'cr'), eof = sub('txt_read', 'eof'), lf = sub('txt_read', 'lf'), fin = sub('txt_read', 'fin');
        setc(Ad, () => getc('HP'));
        setc(P, () => getc(Ad));
        setc(EOF, () => I('push', 0));
        mark(loop);
        addc(P, 1);
        getc(P); I('readchar');
        getc(P); I('retrieve');
        I('dup'); I('jn', eof);
        I('dup'); I('push', 10, charName(10)); I('sub'); I('jz', lf);
        I('push', 13, charName(13)); I('sub'); I('jz', cr);
        I('jump', loop);
        mark(cr);
        addc(P, -1);
        I('jump', loop);
        mark(eof);
        setc(EOF, () => I('push', 1));
        mark(lf);
        I('discard');
        mark(fin);
        getc(P); I('push', 0); I('store');                      // Endezeichen löschen: ab HP ist alles 0
        getc(Ad); getc(P); getc(Ad); I('sub'); I('push', 1); I('sub'); I('store', null, 'length');
        setc('HP', () => getc(P));
        getc(Ad);
        I('ret');
      },
      // [a] → [Wert ok]: ganze Zahl (Leerzeichen/Tabulatoren davor und danach erlaubt, Vorzeichen + oder −); ungültig → [0 0]
      txt_int() {
        const P = rc('txt_int', 'p'), N = rc('txt_int', 'n'), V = rc('txt_int', 'v'), S = rc('txt_int', 's'), D = rc('txt_int', 'd'), C = rc('txt_int', 'c');
        const lab = (x) => sub('txt_int', x);
        const lead = lab('lead'), skip = lab('skip'), signs = lab('sign'), minus = lab('minus'), plus = lab('plus'), digits = lab('digits'),
          trail = lab('trail'), tskip = lab('tskip'), fin = lab('fin'), bad = lab('bad');
        const next = () => { addc(P, 1); addc(N, -1); };
        const char = () => setc(C, () => { getc(P); I('push', 1); I('add'); I('retrieve'); });
        const isC = (code, l) => { getc(C); I('push', code, charName(code)); I('sub'); I('jz', l); };
        setc(P, () => I('swap'));
        setc(N, () => { getc(P); I('retrieve'); });
        setc(V, () => I('push', 0));
        setc(S, () => I('push', 1));
        setc(D, () => I('push', 0));
        mark(lead);
        getc(N); I('jz', fin);
        char();
        isC(32, skip); isC(9, skip);
        I('jump', signs);
        mark(skip); next(); I('jump', lead);
        mark(signs);
        isC(45, minus); isC(43, plus);
        I('jump', digits);
        mark(minus); setc(S, () => I('push', -1));
        mark(plus); next();
        mark(digits);
        getc(N); I('jz', fin);
        char();
        getc(C); I('push', 48, "'0'"); I('sub'); I('jn', trail);          // < '0'
        I('push', 57, "'9'"); getc(C); I('sub'); I('jn', trail);          // > '9'
        setc(V, () => { getc(V); I('push', 10); I('mul'); getc(C); I('push', 48, "'0'"); I('sub'); I('add'); });
        addc(D, 1);
        next();
        I('jump', digits);
        mark(trail);
        getc(N); I('jz', fin);
        char();
        isC(32, tskip); isC(9, tskip);
        I('jump', bad);
        mark(tskip); next(); I('jump', trail);
        mark(fin);
        getc(D); I('jz', bad);
        getc(V); getc(S); I('mul'); I('push', 1, 'ok'); I('ret');
        mark(bad);
        I('push', 0); I('push', 0, 'ok'); I('ret');
      },
      // [] → [Wert 1] oder [0] (keine ganze Zahl: Meldung ausgegeben); Ende der Eingabe → [0 1]
      int_read() {
        const parse = sub('int_read', 'parse'), bad = sub('int_read', 'bad'), empty = sub('int_read', 'empty');
        callR('txt_read');
        I('dup'); I('retrieve', null, 'length'); I('jz', empty);
        mark(parse);
        callR('txt_int');
        I('jz', bad);
        I('push', 1, 'ok'); I('ret');
        mark(bad);
        I('discard');
        pushText(tr('javaNeedInt')); callR('txt_out');
        I('push', 10, charName(10)); I('outchar');
        I('push', 0); I('ret');
        mark(empty);
        getc(rc('txt_read', 'eof')); I('jz', parse);
        I('discard'); I('push', 0); I('push', 1, 'ok'); I('ret');
      },
      // [a b] → [a / b] wie in C: div rundet ab; ist der Rest ≠ 0 und haben a und b verschiedene Vorzeichen, +1
      int_div() {
        const X = rc('int_div', 'a'), B = rc('int_div', 'b');
        const fix = sub('int_div', 'fix'), done = sub('int_div', 'done');
        setc(B, () => I('swap'));
        setc(X, () => I('swap'));
        getc(X); getc(B); I('div');
        getc(X); getc(B); I('mod'); I('jz', done);
        getc(X); getc(B); I('mul'); I('jn', fix);
        mark(done); I('ret');
        mark(fix); I('push', 1); I('add'); I('ret');
      },
      // [a b] → [a % b] wie in C (Vorzeichen von a): mod hat das Vorzeichen von b; ist es ≠ 0 und a, b verschieden, − b
      int_mod() {
        const X = rc('int_div', 'a'), B = rc('int_div', 'b');
        const fix = sub('int_mod', 'fix'), done = sub('int_mod', 'done');
        setc(B, () => I('swap'));
        setc(X, () => I('swap'));
        getc(X); getc(B); I('mod');
        I('dup'); I('jz', done);
        getc(X); getc(B); I('mul'); I('jn', fix);
        mark(done); I('ret');
        mark(fix); getc(B); I('sub'); I('ret');
      },
      // [n] → [Adresse]: Array mit n Elementen (alle 0) auf der Halde
      arr_new() {
        const N = rc('arr_new', 'n'), Ad = rc('arr_new', 'a');
        setc(N, () => I('swap'));
        setc(Ad, () => getc('HP'));
        getc(Ad); getc(N); I('add'); I('push', 0); I('store');        // letzte Zelle anlegen (die Zellen ab HP sind 0)
        getc(Ad); getc(N); I('store', null, 'length');
        setc('HP', () => { getc(Ad); getc(N); I('add'); I('push', 1); I('add'); });
        getc(Ad);
        I('ret');
      }
    };

    // ------------------------------------------------------------ Zusammenbau

    const mctx = { fn: main, scope: mainScope, frame: null };
    const startAt = prog.length;
    genSeq(mctx, main.body);
    I('end', null, tr('mgCmtEnd'));

    for (const fn of subs) {
      const fr = frames.get(fn);
      const ctx = { fn, scope: fr.scope, frame: fr };
      note('', tr('wsSub', fn.name + '(' + fn.params.map((p) => (p.byRef ? '&' : '') + p.name).join(', ') + ')',
        [...fr.slot].map(([n, k]) => 'FP+' + k + ' ' + n).join(', ')));
      mark(fnLabel.get(fn.name));
      // Variablen im Rahmen auf 0 setzen (der Stapel wird wiederverwendet)
      for (const [n, k] of fr.slot) {
        const v = fr.scope.get(n);
        if (v && (v.kind === 'param' || (v.kind === 'result' && fn.returnType !== 'void'))) continue;   // result: gleich danach
        varCell(ctx, n); I('push', 0); I('store', null, n);
      }
      if (fn.returnType !== 'void') store(ctx, 'result', tryParse(fn.resultInit));
      genSeq(ctx, fn.body);
      if (fn.returnType !== 'void') gen(ctx, { k: 'id', name: 'result' });
      I('ret');
    }

    // Routinen (auch solche, die erst von anderen Routinen gebraucht werden)
    const done = new Set();
    for (;;) {
      const r = ROUTINES.find((x) => used.has(x) && !done.has(x));
      if (!r) break;
      done.add(r);
      note('', tr(HELP_KEY[r]));
      mark(r);
      helpers[r]();
    }

    // Speicher verteilen
    let next = 3;
    for (const k of cellOrder) cellAt.set(k, next++);
    const round = (x) => Math.ceil(x / 100) * 100;
    const STACK = round(next);
    const HEAP = subs.length ? STACK + STACK_CELLS : round(next);

    // Textkonstanten: Routine txt_init legt sie beim Start in der Reihenfolge des Pools an (Adresse = HEAP + Versatz)
    if (pool.size) {
      note('', tr('wsHelpConst'));
      mark('txt_init');
      for (const [s, off] of pool) {
        note(tr('wsConst', '"' + s + '"', HEAP + off));
        const cps = [...s].map((c) => c.codePointAt(0));
        for (const cp of cps) I('push', cp, charName(cp));
        I('push', cps.length, 'length');
        I('call', 'txt_pack');
        I('discard');
      }
      I('ret');
    }

    // Startcode: HP und FP setzen, Speicher bis zur Halde anlegen, Textkonstanten anlegen
    const init = [];
    const J = (op, arg, cmt) => init.push({ op, arg, cmt });
    init.push({ note: [tr('wsInit', HEAP - 1)] });
    J('push', { cell: 'HP' }, 'HP'); J('push', HEAP); J('store');
    if (subs.length) { J('push', { cell: 'FP' }, 'FP'); J('push', STACK); J('store'); usesFP = true; }
    J('push', HEAP - 1); J('push', 0); J('store');
    if (pool.size) J('call', 'txt_init');
    init.push({ note: ['', tr('wsMain')] });
    prog.splice(startAt, 0, ...init);

    // Sprünge zur direkt folgenden Marke entfernen
    for (let i = 0; i < prog.length; i++) {
      const c = prog[i];
      if (c.op !== 'jump') continue;
      let j = i + 1, hit = false;
      while (j < prog.length && (prog[j].note || prog[j].op === 'mark')) { if (prog[j].arg === c.arg) hit = true; j++; }
      if (hit) { prog.splice(i, 1); i--; }
    }
    // Marken, zu denen nie gesprungen wird, weglassen
    const targets = new Set(prog.filter((c) => c.op && LABEL_ARG.has(c.op) && c.op !== 'mark').map((c) => c.arg));
    for (let i = prog.length - 1; i >= 0; i--) if (prog[i].op === 'mark' && genLabels.has(prog[i].arg) && !targets.has(prog[i].arg)) prog.splice(i, 1);

    // ---- Ausgabe
    const labelNum = new Map();
    let nextLabel = 0;
    const lab = (name) => { if (!labelNum.has(name)) labelNum.set(name, ++nextLabel); return labelCode(labelNum.get(name)); };
    const out = [];
    let atStart = true;
    let nextNoteNo = 0;
    const put = (code, cmt) => {
      const i = code.indexOf('L');
      out.push(i >= 0 && i < code.length - 1 ? enc(code.slice(0, i + 1)) + cmt + enc(code.slice(i + 1)) : cmt + enc(code));
      atStart = code.endsWith('L');
    };
    const noteLine = (s) => (s === '' ? '' : ';·' + clean(s));
    const putNotes = (lines) => {
      let k = 0;
      while (k < lines.length) {
        const code = enc('SS' + lab('#note' + (++nextNoteNo)));
        if (atStart && k + 1 < lines.length) { out.push(noteLine(lines[k]) + '\n' + noteLine(lines[k + 1]) + code); k += 2; }
        else { out.push('\n' + noteLine(lines[k]) + code); k++; }
        atStart = true;
      }
    };
    const resolve = (a) => {
      if (a && typeof a === 'object') {
        if ('cell' in a) return cellAt.get(a.cell);
        if ('konst' in a) return HEAP + pool.get(a.konst);
        if ('stack' in a) return STACK + a.stack;
      }
      return a;
    };

    // Kopf
    const cells = [['empty', 0], ['HP', 1]].concat(usesFP ? [['FP', 2]] : []).concat(cellOrder.map((k) => [k, cellAt.get(k)]))
      .map(([k, a]) => a + '=' + cellName.get(k));
    const head = [tr('wsHeader1'), tr('wsHeader2'), tr('wsHeader3'), tr('wsMemory', cells.join(', ')),
      subs.length ? tr('wsStackHeap', STACK, HEAP) : tr('wsHeap', HEAP)];
    if (unsupported.length) head.push('⚠ ' + [...new Set(unsupported)].join(' '));
    if (head.length % 2) head.push('');
    putNotes(head);

    for (const c of prog) {
      if (c.note) { putNotes(c.note); continue; }
      let code = OPS[c.op];
      let m;
      if (NUM_ARG.has(c.op)) {
        const v = resolve(c.arg);
        code += numCode(v);
        m = c.op + '_' + v + (c.cmt ? ':' + c.cmt : '');
      } else if (LABEL_ARG.has(c.op)) {
        code += lab(c.arg);
        m = c.op === 'mark' ? c.arg + ':' : c.op + ':' + c.arg;
      } else m = c.op + (c.cmt ? ':' + c.cmt : '');
      put(code, clean(m));
    }
    const text = out.join('') + (atStart ? '' : '\n');
    const uniq = [...new Set(unsupported)];
    return opts.report ? { code: text, unsupported: uniq } : text;
  }

  // ------------------------------------------------------------ Interpreter

  const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q; };
  const floorMod = (a, b) => { const r = a % b; return (r !== 0n && ((r < 0n) !== (b < 0n))) ? r + b : r; };

  /** Quelltext → { prog: [{ op, n?, label? , at }], labels: Map } (alle Zeichen außer Leerzeichen, Tab, LF sind Kommentar). */
  function parse(src) {
    const code = [];
    const pos = [];
    let line = 1;
    for (const ch of String(src)) {
      if (ch === ' ') { code.push('S'); pos.push(line); }
      else if (ch === '\t') { code.push('T'); pos.push(line); }
      else if (ch === '\n') { code.push('L'); pos.push(line); line++; }
    }
    let i = 0;
    const where = (k) => 'Zeile ' + (pos[k] || line);
    const need = () => { if (i >= code.length) throw new Error(where(i) + ': unvollständiger Befehl am Ende'); return code[i++]; };
    const readNum = () => {
      const s = need();
      if (s === 'L') return 0n;
      let v = 0n;
      for (;;) { const c = need(); if (c === 'L') break; v = v * 2n + (c === 'T' ? 1n : 0n); }
      return s === 'T' ? -v : v;
    };
    const readLabel = () => { let s = ''; for (;;) { const c = need(); if (c === 'L') return s; s += c; } };
    const prog = [];
    const labels = new Map();
    while (i < code.length) {
      const at = i;
      const bad = () => new Error(where(at) + ': unbekannter Befehl ' + code.slice(at, i).join(''));
      const a = need();
      let op = null;
      const ins = { at: where(at) };
      if (a === 'S') {
        const b = need();
        if (b === 'S') { op = 'push'; ins.n = readNum(); }
        else if (b === 'L') op = { S: 'dup', T: 'swap', L: 'discard' }[need()];
        else { const c = need(); if (c === 'S') { op = 'copy'; ins.n = readNum(); } else if (c === 'L') { op = 'slide'; ins.n = readNum(); } }
      } else if (a === 'T') {
        const b = need();
        if (b === 'S') op = { SS: 'add', ST: 'sub', SL: 'mul', TS: 'div', TT: 'mod' }[need() + need()];
        else if (b === 'T') op = { S: 'store', T: 'retrieve' }[need()];
        else op = { SS: 'outchar', ST: 'outnum', TS: 'readchar', TT: 'readnum' }[need() + need()];
      } else {
        op = { SS: 'mark', ST: 'call', SL: 'jump', TS: 'jz', TT: 'jn', TL: 'ret', LL: 'end' }[need() + need()];
        if (op && LABEL_ARG.has(op)) ins.label = readLabel();
      }
      if (!op) throw bad();
      ins.op = op;
      if (op === 'mark') {
        if (labels.has(ins.label)) throw new Error(ins.at + ': Marke doppelt');
        labels.set(ins.label, prog.length);
        continue;
      }
      prog.push(ins);
    }
    return { prog, labels };
  }

  /**
   * Führt ein Whitespace-Programm aus.
   *   Zahlen: BigInt. div/mod wie Haskell (div rundet ab, mod hat das Vorzeichen des Divisors). Division durch 0 → Fehler.
   *   Halde: unbeschriebene Zellen lesen sich als 0 (das Original bricht ab, wenn die Zelle hinter dem bisher
   *   beschriebenen Bereich liegt); negative Adressen → Fehler.
   *   Zeichen lesen: ein Unicode-Zeichen (Codepoint); am Ende der Eingabe −1 (das Original bricht ab).
   *   Zahl lesen: eine Zeile (bis LF, CR am Ende wird entfernt), Leerraum davor/danach erlaubt, optional „-“,
   *   dann Ziffern; sonst Fehler (wie read im Original). Am Ende der Eingabe → Fehler.
   *   Zeichen ausgeben: Codepoint → Text (in JS als String, also UTF-16; beim Schreiben in eine Datei UTF-8).
   *   Ende: nur über „end“; läuft das Programm über das letzte Zeichen hinaus, ist das ein Fehler.
   * @param src  Quelltext
   * @param io   { stdin: string (ganze Eingabe) | input(): string|null (eine Zeile), output(text), maxSteps }
   * @returns    { steps, error }
   */
  function run(src, io = {}) {
    let steps = 0;
    let buf = '';
    const flush = () => { if (buf && io.output) io.output(buf); buf = ''; };
    try {
      const { prog, labels } = parse(src);
      // Eingabe als Folge von Codepoints
      let inp = io.stdin != null ? [...String(io.stdin)] : [];
      let ip = 0;
      const more = () => {
        if (ip < inp.length) return true;
        if (io.stdin == null && io.input) {
          const l = io.input();
          if (l == null) return false;
          inp = [...(String(l) + '\n')]; ip = 0;
          return inp.length > 0;
        }
        return false;
      };
      const stack = [], calls = [], heap = new Map();
      const pop = (ins) => { if (!stack.length) throw new Error(ins.at + ' (' + ins.op + '): Stapel leer'); return stack.pop(); };
      const adr = (a, ins) => { if (a < 0n) throw new Error(ins.at + ' (' + ins.op + '): negative Adresse ' + a); return a; };
      const jump = (ins) => { if (!labels.has(ins.label)) throw new Error(ins.at + ': Marke fehlt'); return labels.get(ins.label); };
      const max = io.maxSteps || 50000000;
      let pc = 0;
      for (;;) {
        if (pc >= prog.length) throw new Error('Programm endet ohne end');
        if (++steps > max) { flush(); return { steps, error: 'Schrittgrenze erreicht' }; }
        const ins = prog[pc++];
        switch (ins.op) {
          case 'push': stack.push(ins.n); break;
          case 'dup': { const v = pop(ins); stack.push(v, v); break; }
          case 'copy': {
            const k = Number(ins.n);
            if (k < 0 || k >= stack.length) throw new Error(ins.at + ' (copy): kein Element ' + k);
            stack.push(stack[stack.length - 1 - k]);
            break;
          }
          case 'swap': { const b = pop(ins), a = pop(ins); stack.push(b, a); break; }
          case 'discard': pop(ins); break;
          case 'slide': {
            const top = pop(ins);
            const k = Number(ins.n);
            if (k < 0) throw new Error(ins.at + ' (slide): negativ');
            stack.length = Math.max(0, stack.length - k);
            stack.push(top);
            break;
          }
          case 'add': case 'sub': case 'mul': case 'div': case 'mod': {
            const b = pop(ins), a = pop(ins);
            if ((ins.op === 'div' || ins.op === 'mod') && b === 0n) throw new Error(ins.at + ' (' + ins.op + '): Division durch 0');
            stack.push(ins.op === 'add' ? a + b : ins.op === 'sub' ? a - b : ins.op === 'mul' ? a * b : ins.op === 'div' ? floorDiv(a, b) : floorMod(a, b));
            break;
          }
          case 'store': { const v = pop(ins), a = adr(pop(ins), ins); heap.set(a, v); break; }
          case 'retrieve': { const a = adr(pop(ins), ins); stack.push(heap.has(a) ? heap.get(a) : 0n); break; }
          case 'call': calls.push(pc); pc = jump(ins); break;
          case 'jump': pc = jump(ins); break;
          case 'jz': if (pop(ins) === 0n) pc = jump(ins); break;
          case 'jn': if (pop(ins) < 0n) pc = jump(ins); break;
          case 'ret': if (!calls.length) throw new Error(ins.at + ' (ret): kein Rücksprung offen'); pc = calls.pop(); break;
          case 'end': flush(); return { steps };
          case 'outchar': {
            const v = pop(ins);
            if (v < 0n || v > 0x10FFFFn) throw new Error(ins.at + ' (outchar): kein Zeichen ' + v);
            buf += String.fromCodePoint(Number(v));
            if (buf.length > 4096) flush();
            break;
          }
          case 'outnum': buf += pop(ins).toString(); if (buf.length > 4096) flush(); break;
          case 'readchar': {
            flush();
            const a = adr(pop(ins), ins);
            heap.set(a, more() ? BigInt(inp[ip++].codePointAt(0)) : -1n);
            break;
          }
          case 'readnum': {
            flush();
            const a = adr(pop(ins), ins);
            if (!more()) throw new Error(ins.at + ' (readnum): Ende der Eingabe');
            let l = '';
            while (more()) { const c = inp[ip++]; if (c === '\n') break; l += c; }
            l = l.replace(/\r$/, '').trim();
            if (!/^-?\d+$/.test(l)) throw new Error(ins.at + ' (readnum): keine ganze Zahl: ' + l);
            heap.set(a, BigInt(l));
            break;
          }
          default: throw new Error(ins.at + ': ' + ins.op);
        }
      }
    } catch (e) {
      flush();
      return { steps, error: e.message };
    }
  }

  BBE.wsgen = { generate, run };
})(typeof window !== 'undefined' ? window : globalThis);
