/* Blockbild-Editor – Übersetzung nach Brainfuck (+ Interpreter)
 *
 *   Brainfuck: ein Band aus Zellen, ein Zeiger, acht Befehle  > < + - . , [ ]
 *   Alles andere im Quelltext ist Kommentar (darum stehen in Kommentaren nie diese acht Zeichen;
 *   safe() ersetzt sie durch breite Unicode-Zeichen).
 *
 *   Zellmodell (steht auch im Kopf jedes erzeugten Programms, run() setzt genau das um):
 *   - Zellen mit mindestens 16 Bit (32 Bit empfohlen). Das Programm erzeugt NIE negative Zellwerte und
 *     verlässt sich nicht auf Überlauf – es läuft mit vorzeichenlosen und mit vorzeichenbehafteten,
 *     umlaufenden oder unbegrenzten Zellen. 8-Bit-Zellen gehen nur, solange alle Zahlen unter 256 bleiben.
 *   - ',' bei Dateiende: 0 oder Zelle unverändert (vor jedem ',' steht die Zelle auf 0).
 *   - Band nur rechts vom Start; Länge steht im Kopf (Rekursion braucht je Ebene einen Rahmen mehr).
 *
 *   Übersetzung:
 *   - Zahl = zwei Zellen (P, N), Wert = P − N; gespeicherte Zahlen sind normalisiert (höchstens eine ≠ 0).
 *     + und − sind reines Verschieben; * / % rechnen mit Beträgen und Vorzeichen-Merkern
 *     (schneidet ab wie C, der Rest hat das Vorzeichen des Dividenden). Kommazahlen: x * 1.25 → x * 5 / 4.
 *   - Rahmen je Unterprogramm, feste Größe. Rechts vom Kopf (RUN PC T E RET): Zahlen, Hilfszellen,
 *     Ziffernstapel. Links vom Kopf, gespiegelt: Texte (verschränkt, Einheit j aller Texte nebeneinander,
 *     Einheit 0 direkt am Kopf) und Arrays (ebenso). Gleiche Schrittweite in allen Rahmen, damit
 *     Kopieren zwischen Rahmen mit festem Abstand geht.
 *   - Unterprogramme: das Programm ist eine Schleife über Blöcke (Verteiler mit PC). Der Zeiger steht im
 *     Rahmen des laufenden Unterprogramms; ein Aufruf schreibt die Parameter in den nächsten Rahmen
 *     (fester Abstand), setzt dort RUN = 1, RET = Fortsetzungsblock, PC = erster Block und rückt vor.
 *     Am Ende setzt das Unterprogramm PC = RET; der Fortsetzungsblock (läuft noch im fremden Rahmen) holt
 *     Ergebnis, InOut-Werte und Arrays zurück, löscht den Rahmen und rückt zurück. So geht auch Rekursion.
 *   - InOut-Parameter und Arrays: Kopie hinein, beim Rücksprung Kopie zurück (copy-in/copy-out).
 *   - Arrays: Einheiten zu 6 Zellen (Spur, Zähler, 2 Träger, 2 Zellen Element). Variabler Index: Zähler und
 *     Wert wandern Einheit für Einheit, die Spur führt zurück. Länge im Kopf-Element.
 *   - Texte: Bytes (UTF-8) in Einheiten zu 3 Zellen (Zähler, Träger, Byte), hinter dem Text nur Nullen;
 *     Länge in der Einheit 0. Ausgeben/Anhängen/Löschen mit Suchschleifen über die Bytes.
 *   - Ganze Zahl lesen: Zeile Zeichen für Zeichen, bis eine ganze Zahl kommt (sonst javaNeedInt);
 *     Dateiende → 0 bzw. leerer Text.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;

  const TEXT_CAP = 127;      // höchstens so viele Bytes je Text (was nicht mehr passt, wird weggelassen)
  const ARRAY_CAP = 127;     // Arrays mit variabler Länge: höchstens so viele Elemente
  const TU = 3;              // Text-Einheit: c (Zähler/Spur), v (Träger), ch (Byte)
  const AU = 6;              // Array-Einheit: t (Spur), c (Zähler), vp, vn (Träger), ep, en (Element)
  const IU = 8;              // Ziffern-Einheit: D, F, n, d, r, q, z1, z2
  const H = { RUN: 0, PC: 1, T: 2, E: 3, RET: 4 };
  const HEAD = 5;
  const WRAP = 72;

  const tryParse = (src) => { try { const s = String(src == null ? '' : src).trim(); return s ? parseCached(s) : null; } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const utf8 = (s) => {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(String(s)));
    return Array.from(unescape(encodeURIComponent(String(s)))).map((c) => c.charCodeAt(0));
  };
  const rep = (c, n) => (n > 0 ? c.repeat(n) : '');
  const R = (n) => rep('>', n);
  const Lf = (n) => rep('<', n);
  const mv = (d) => (d > 0 ? R(d) : Lf(-d));
  const SAFE = { '+': '＋', '-': '－', '<': '＜', '>': '＞', '[': '［', ']': '］', '.': '．', ',': '，', '!': '！', '#': '＃' };
  /** Kommentartext ohne Brainfuck-Befehlszeichen */
  const safe = (s) => String(s).replace(/[+\-<>[\].,!#]/g, (c) => SAFE[c]).replace(/\s+/g, ' ').trim();

  /** Nebeneinanderliegende Zeigerbewegungen bzw. +/− zusammenfassen */
  const peep = (s) => s.replace(/[<>]{2,}/g, (r) => { let d = 0; for (const c of r) d += c === '>' ? 1 : -1; return mv(d); })
    .replace(/[+-]{2,}/g, (r) => { let d = 0; for (const c of r) d += c === '+' ? 1 : -1; return d > 0 ? rep('+', d) : rep('-', -d); });

  /** Code, der in der aktuellen Zelle k addiert; Hilfszelle (0) im Abstand o. */
  function constCode(k, o) {
    if (k <= 16) return rep('+', k);
    let best = null;
    for (let a = 2; a * a <= k * 2 && a <= 64; a++) {
      const b = Math.floor(k / a), c = k - a * b;
      const cost = a + b + c + 2 * Math.abs(o) + 6;
      if (!best || cost < best.cost) best = { a, b, c, cost };
    }
    if (!best || best.cost >= k) return rep('+', k);
    return mv(o) + rep('+', best.a) + '[-' + mv(-o) + rep('+', best.b) + mv(o) + ']' + mv(-o) + rep('+', best.c);
  }

  // Divmod (n d 0 0 0 0 → 0 d−n%d n%d n/d 0 0), für d ≥ 2, Zeiger auf n
  const DIVMOD = '[->-[>+>>]>[+[-<+>]>+>>]<<<<<]';

  // Ersatztexte (englisch), falls die Übersetzungen (i18n) fehlen
  const FALLBACK = {
    bfHeader1: 'Generated with the block diagram editor (Brainfuck)',
    bfHeader2: 'Interpreter: cells of at least 16 bits (32 bits recommended); cell values never become negative and never overflow',
    bfHeader3: 'Input: at end of input the read command must give 0 or leave the cell unchanged; lines end with LF (CR is skipped)',
    bfHeader4: 'Tape: at least {0} cells to the right of the start (more for each level of recursion); the pointer never moves left of the start',
    bfHeader5: 'Numbers: two cells P and N (value P minus N); texts: UTF‑8 bytes (at most {0}); arrays with variable length: at most {1} elements',
    bfHeader6: 'Whole numbers as in C: division truncates; what does not fit into a text is left out',
    bfFrame: 'Frame {0}: {1} cells; cells from the frame head: {2}',
    bfDispatch: 'Dispatcher: runs the block whose number is in PC (frame head: cells 0 to 4 = RUN PC T E RET)',
    bfStart: 'Start: RUN = 1 and PC = first block of the main program',
    bfBlock: 'Block {0}',
    bfCont: 'back from {0}',
    bfEndSub: 'end of {0}: PC = RET',
    bfNoTextArray: 'Brainfuck: arrays of texts are not translated',
    bfBadArg: 'Brainfuck: an array parameter needs an array variable as argument',
    bfText: 'text', bfArray: 'array'
  };

  function generate(program, opts = {}) {
    const t0 = opts.t || ((k) => k);
    const tr = (k, ...a) => {
      let s = t0(k, ...a);
      if (s === k && FALLBACK[k]) s = FALLBACK[k].replace(/\{(\d)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m));
      return s;
    };
    let hints = null, res = null;
    for (let pass = 0; pass < 4; pass++) {
      res = compile(program, tr, hints);
      const same = hints && JSON.stringify(hints) === JSON.stringify(res.hints);
      hints = res.hints;
      if (same) break;
    }
    return opts.report ? { code: res.code, unsupported: res.unsupported } : res.code;
  }

  // ======================================================================= Übersetzer

  function compile(program, tr, hints) {
    const unsupported = [];
    const unsup = (k) => { if (!unsupported.includes(tr(k))) unsupported.push(tr(k)); };
    const fns = program.fns;
    const main = fns.find((f) => f.isMain) || fns[0];
    const subs = fns.filter((f) => f !== main);
    const fnByName = new Map(subs.map((f) => [f.name, f]));
    const kids = (n) => [n.then, n.else, n.body, ...(n.cases || []).map((c) => c.body)].filter(Array.isArray);
    const hasCall = (n) => (n.kind === 'call' && fnByName.has(n.fn)) || kids(n).some((s) => s.some(hasCall));
    const dispatch = fns.some((f) => f.body.some(hasCall));

    // ---- Array-Kapazitäten
    const declCap = (n) => {
      const a = tryParse(n.length);
      const v = a ? A.literalValue(a) : undefined;
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.max(1, v) : ARRAY_CAP;
    };
    // eine gemeinsame Kapazität für alle Arrays (Arrays werden zwischen Rahmen kopiert)
    let maxCap = 1;
    for (const f of fns) BBE.model.walkSeq(f.body, (n) => { if (n.kind === 'decl' && A.isArrayType(n.vtype)) maxCap = Math.max(maxCap, declCap(n)); });

    // ---- Rahmen
    // Rechts vom Kopf (RUN PC T E RET): Zahlen, Längen, Hilfszellen, Ziffernstapel.
    // Links vom Kopf, gespiegelt (Einheit 0 nahe am Kopf, weitere Einheiten nach links): alle Arrays
    // des Rahmens verschränkt (Einheit j aller Arrays nebeneinander), links davon ebenso alle Texte.
    // Gleiche Schrittweite in allen Rahmen → Kopieren zwischen Rahmen mit festem Abstand.
    const layouts = new Map();
    const scopes = fns.map((fn) => A.scopeOf(fn));
    const fnHint = (fi) => (hints ? hints.fns[fi] : { maxTemp: 0, maxTb: 0 });
    const countOf = (fi, type) => [...scopes[fi].values()].filter((v) => v.type === type).length;
    const textSlots = fns.map((fn, fi) => countOf(fi, 'string') + fnHint(fi).maxTb);
    const arrSlots = fns.map((fn, fi) => countOf(fi, 'integer[]'));
    const ST = TU * Math.max(1, ...textSlots);
    const SA = AU * Math.max(1, ...arrSlots);
    fns.forEach((fn, fi) => {
      const scope = scopes[fi];
      const h = fnHint(fi);
      const L = { fn, scope, vars: new Map() };
      const RT = textSlots[fi] ? (TEXT_CAP + 2) * ST : 0;
      const RA = arrSlots[fi] ? (maxCap + 3) * SA : 0;
      const aBase = -1, tBase = -1 - RA;
      let off = HEAD, kt = 0, ka = 0;
      for (const [name, sv] of scope) {
        const t = sv.type;
        if (t === 'string') { const b = tBase - TU * kt++; L.vars.set(name, { kind: 'text', len: b - 1, sv, base: b, st: ST }); }
        else if (t === 'integer[]') { const b = aBase - AU * ka++; L.vars.set(name, { kind: 'arr', len: b - SA - 4, sv, base: b, sa: SA, cap: maxCap }); }
        else if (t === 'string[]') L.vars.set(name, { kind: 'none', sv });
        else { L.vars.set(name, { kind: 'num', p: off, n: off + 1, sv }); off += 2; }
      }
      L.tbufs = [];
      for (let i = 0; i < h.maxTb; i++) L.tbufs.push(tBase - TU * kt++);
      L.tempBase = off;
      off += h.maxTemp;
      L.itoa = off;
      off += 2 * IU;            // der Ziffernstapel darf über das Rahmenende hinaus wachsen (dort ist alles 0)
      L.size = off;
      L.bufs = RT + RA;
      layouts.set(fn, L);
    });

    // ---- Ausgabe-Puffer (Kommentarzeilen + Codezeilen)
    let B = null;      // aktueller Baustein: { ptr, items, buf, ind }
    let C = null;      // aktueller Kontext: { fn, L, tmpTop, maxTemp, tbTop, maxTb }
    const newBuilder = (ptr, ind) => ({ ptr, items: [], buf: '', ind: ind || 0 });
    const code = (s) => { B.buf += s; };
    const flush = () => { if (B.buf) { const c = peep(B.buf); if (c) B.items.push({ ind: B.ind, code: c }); B.buf = ''; } };
    const note = (t) => { flush(); B.items.push({ ind: B.ind, cmt: safe(t) }); };

    // ---- Grundbefehle (Zellen relativ zum Rahmen des laufenden Unterprogramms)
    const go = (o) => { code(mv(o - B.ptr)); B.ptr = o; };
    const inc = (o, k = 1) => { if (!k) return; go(o); code(rep(k > 0 ? '+' : '-', Math.abs(k))); };
    const clr = (o) => { go(o); code('[-]'); };
    const loop = (o, body) => { go(o); code('['); body(); go(o); code(']'); };
    const moveTo = (src, dsts) => loop(src, () => { inc(src, -1); for (const d of dsts) inc(d, 1); });
    const tmp = () => { const o = C.L.tempBase + C.tmpTop++; if (C.tmpTop > C.maxTemp) C.maxTemp = C.tmpTop; return o; };
    const mark = () => C.tmpTop;
    const release = (m) => { C.tmpTop = m; };
    const copyVia = (src, dsts, t) => { moveTo(src, [...dsts, t]); moveTo(t, [src]); };
    const copyTo = (src, dsts) => { const m = mark(); const t = tmp(); moveTo(src, [...dsts, t]); moveTo(t, [src]); release(m); };
    const addConstWith = (o, k, t) => { if (k <= 0) return; go(o); code(constCode(k, t - o)); };
    const addConst = (o, k) => { if (k <= 16) { inc(o, k); return; } const m = mark(); const t = tmp(); addConstWith(o, k, t); release(m); };
    const tmpPair = () => ({ p: tmp(), n: tmp() });
    const swap = (d) => ({ p: d.n, n: d.p });

    /** Wenn x ≠ 0: x−1, sonst u+1 */
    function decOrFlag(x, u) {
      const m = mark();
      const e = tmp(), t = tmp();
      inc(e);
      loop(x, () => { inc(x, -1); moveTo(x, [t]); inc(e, -1); });
      moveTo(t, [x]);
      loop(e, () => { inc(e, -1); inc(u); });
      release(m);
    }
    /** x := max(x − k, 0); u ≠ 0, wenn x < k war */
    function subSat(x, k, u) {
      const m = mark();
      const c = tmp();
      addConst(c, k);
      loop(c, () => { inc(c, -1); decOrFlag(x, u); });
      release(m);
    }
    /** Merker (neue Hilfszelle): 1, wenn Zelle x = 0 */
    function isZero(x) {
      const f = tmp();
      const m = mark();
      const t = tmp();
      inc(f);
      copyTo(x, [t]);
      loop(t, () => { clr(t); inc(f, -1); });
      release(m);
      return f;
    }
    /** Merker: 1, wenn Zelle x = k */
    function eqConst(x, k) {
      const f = tmp();
      const m = mark();
      const t = tmp(), u = tmp();
      copyTo(x, [t]);
      subSat(t, k, u);
      inc(f);
      loop(t, () => { clr(t); clr(f); });
      loop(u, () => { clr(u); clr(f); });
      release(m);
      return f;
    }
    function ifElse(f, yes, no) {
      const m = mark();
      const e = tmp();
      inc(e);
      loop(f, () => { clr(f); inc(e, -1); yes(); });
      loop(e, () => { inc(e, -1); if (no) no(); });
      release(m);
    }
    /** Zahl (P, N) normalisieren: höchstens eine Zelle ≠ 0 */
    function normalize(d) {
      // solange P ≠ 0 und N ≠ 0: beide um 1 verringern (Schritte = kleinerer Wert)
      const m = mark();
      const f = tmp(), g = tmp(), t = tmp();
      inc(f);
      loop(f, () => {
        clr(f);
        copyTo(d.p, [t]);
        loop(t, () => { clr(t); copyTo(d.n, [t]); loop(t, () => { clr(t); inc(g); }); });
        loop(g, () => { clr(g); inc(d.p, -1); inc(d.n, -1); inc(f); });
      });
      release(m);
    }
    /** Ausdruck liefert sicher eine normalisierte Zahl (Variable, Konstante, Element, Länge, Wahrheitswert) */
    function simple(a) {
      const s = strip(a);
      if (!s) return true;
      if (s.k === 'un' && (s.op === '-' || s.op === '+')) return simple(s.a);
      if (s.k === 'bin') return !['+', '-'].includes(s.op);
      return true;
    }
    const evalNorm = (a, d) => { if (a) evalAdd(a, d); if (!simple(a)) normalize(d); };
    /** d += a · b (a, b bleiben erhalten) */
    function mul(a, b, d) {
      const m = mark();
      const t = tmp(), u = tmp();
      copyTo(a, [t]);
      loop(t, () => { inc(t, -1); moveTo(b, [d, u]); moveTo(u, [b]); });
      release(m);
    }
    /** q += a / b, r += a % b (a wird gelöscht, b bleibt; b = 0 → nichts) */
    function divmod(a, b, q, r) {
      const m = mark();
      // b = 0: nichts; b = 1: q = a; sonst klassisches Divmod auf 6 aufeinanderfolgenden Zellen
      const w = [tmp(), tmp(), tmp(), tmp(), tmp(), tmp()];
      const c = tmp();
      copyTo(b, [c]);
      const f0 = isZero(c);
      loop(f0, () => { clr(f0); clr(a); });
      const u = tmp();
      decOrFlag(c, u);
      clr(u);
      const f1 = isZero(c);
      loop(f1, () => { clr(f1); moveTo(a, [q]); });
      moveTo(a, [w[0]]);
      clr(c);
      copyTo(b, [w[1]]);
      go(w[0]);
      code(DIVMOD);
      clr(w[1]);
      moveTo(w[2], [r]);
      moveTo(w[3], [q]);
      release(m);
    }

    // ---- Werte und Typen
    const typeOf = (a) => A.typeOf(a, C.L.scope);
    const varOf = (name) => C.L.vars.get(name);
    const isFrac = (s) => s && s.k === 'num' && !Number.isInteger(s.v);
    function fraction(raw) {
      const [i, d = ''] = String(raw).split('.');
      const p = parseInt(i + d, 10), q = Math.pow(10, d.length);
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      const g = gcd(Math.abs(p), q);
      return [p / g, q / g];
    }
    const num = (v) => ({ k: 'num', v, raw: String(v) });
    const mentions = (ast, name) => { let f = false; BBE.expr.walk(ast, (x) => { if (x.k === 'id' && x.name === name) f = true; }); return f; };

    // ---- Puffer: gespiegelt links vom Kopf. Die Bausteine unten sind "logisch" geschrieben
    // (Einheit j+1 rechts von Einheit j); mcode() tauscht < und >.
    const mcode = (s) => code(s.replace(/[<>]/g, (c) => (c === '<' ? '>' : '<')));

    // ---- Arrays: Einheit −1 = Leer-Einheit (Ende der Spur), 0 = Kopf, Element i = Einheit i+1.
    // Bahnen: 0 t (Spur), 1 c (Zähler), 2 vp, 3 vn (Träger), 4 ep, 5 en (Element)
    const aAt = (arr, j, x) => arr.base - (j + 1) * arr.sa - x;
    /** Element arr[idx] (idx = Zelle, ≥ 0) nach vp/vn der Kopf-Einheit */
    function arrFetch(arr, idx) {
      const sa = arr.sa, c0 = aAt(arr, 0, 1);
      copyTo(idx, [c0]);
      inc(c0);
      go(c0);
      mcode('[-[-' + R(sa) + '+' + Lf(sa) + ']<+' + R(sa + 1) + ']');
      mcode('>>>[-<<+<+>>>]<<<[->>>+<<<]>>>>[-<<+<<+>>>>]<<<<[->>>>+<<<<]');
      mcode(Lf(sa + 1) + '[-' + R(sa + 2) + '[-' + Lf(sa) + '+' + R(sa) + ']>[-' + Lf(sa) + '+' + R(sa) + ']' + Lf(2 * sa + 3) + ']');
      B.ptr = aAt(arr, -1, 0);
    }
    /** arr[idx] := Wert in vp/vn der Kopf-Einheit */
    function arrStore(arr, idx) {
      const sa = arr.sa, c0 = aAt(arr, 0, 1);
      copyTo(idx, [c0]);
      inc(c0);
      go(c0);
      mcode('[-[-' + R(sa) + '+' + Lf(sa) + ']>[-' + R(sa) + '+' + Lf(sa) + ']>[-' + R(sa) + '+' + Lf(sa) + ']<<<+' + R(sa + 1) + ']');
      mcode('>>>[-]>[-]<<<[->>+<<]>[->>+<<]');
      mcode(Lf(sa + 3) + '[-' + Lf(sa) + ']');
      B.ptr = aAt(arr, -1, 0);
    }
    /** für jedes Element 0 … len−1: body = logischer Code relativ zum Zähler c der Einheit (zurück auf c) */
    function arrEach(arr, lenCell, body) {
      const sa = arr.sa, c1 = aAt(arr, 1, 1);
      copyVia(lenCell, [c1], aAt(arr, 0, 5));
      go(c1);
      mcode('[-[-' + R(sa) + '+' + Lf(sa) + ']<+>' + body + R(sa) + ']');
      mcode(Lf(sa + 1) + '[-' + Lf(sa) + ']');
      B.ptr = aAt(arr, 0, 0);
    }
    // D = logischer Abstand zum Ziel-Array
    const bodyCopy = (D) => '>>>[-' + mv(D) + '+' + mv(-D) + '<<+>>]<<[->>+<<]<' + '>>>>[-' + mv(D) + '+' + mv(-D) + '<<+>>]<<[->>+<<]<<';
    const bodyClearMove = (D) => '>>>' + mv(D) + '[-]>[-]<' + mv(-D) + '[-' + mv(D) + '+' + mv(-D) + ']>[-' + mv(D) + '+' + mv(-D) + ']<<<<';
    const bodyClear = '>>>[-]>[-]<<<<';
    function arrClear(arr) { arrEach(arr, arr.len, bodyClear); clr(arr.len); }

    function arrayVarOf(a) {
      const s = strip(a);
      if (!s || s.k !== 'id') return null;
      const v = varOf(s.name);
      return v && v.kind === 'arr' ? v : null;
    }
    function fetchElem(s, dst) {
      const arr = arrayVarOf(s.obj);
      if (!arr) { if (typeOf(s) === 'string') unsup('bfNoTextArray'); return; }
      const i = strip(s.index);
      if (i && i.k === 'num' && Number.isInteger(i.v) && i.v >= 0 && i.v < arr.cap) {
        copyTo(aAt(arr, i.v + 1, 4), [dst.p]);
        copyTo(aAt(arr, i.v + 1, 5), [dst.n]);
        return;
      }
      const m = mark();
      const ip = tmpPair();
      evalNorm(s.index, ip);
      clr(ip.n);
      arrFetch(arr, ip.p);
      clr(ip.p);
      moveTo(aAt(arr, 0, 2), [dst.p]);
      moveTo(aAt(arr, 0, 3), [dst.n]);
      release(m);
    }
    /** arr[index] := Zahl d (normalisiert, wird geleert) */
    function storeElem(tgt, d) {
      const arr = arrayVarOf(tgt.obj);
      if (!arr) { unsup('bfNoTextArray'); clr(d.p); clr(d.n); return; }
      const i = strip(tgt.index);
      if (i && i.k === 'num' && Number.isInteger(i.v) && i.v >= 0 && i.v < arr.cap) {
        const ep = aAt(arr, i.v + 1, 4), en = aAt(arr, i.v + 1, 5);
        clr(ep); clr(en);
        moveTo(d.p, [ep]);
        moveTo(d.n, [en]);
        return;
      }
      const m = mark();
      const ip = tmpPair();
      evalNorm(tgt.index, ip);
      clr(ip.n);
      moveTo(d.p, [aAt(arr, 0, 2)]);
      moveTo(d.n, [aAt(arr, 0, 3)]);
      arrStore(arr, ip.p);
      clr(ip.p);
      release(m);
    }

    // ---- Texte: Einheit 0 bleibt leer (Ende der Suchschleifen), Bytes ab Einheit 1, dahinter nur Nullen.
    // Bahnen: 0 c (Zähler/Spur), 1 v (Träger), 2 ch (Byte)
    const tAt = (T, j, x) => T.base - j * T.st - x;
    function textOut(T) {
      const st = T.st;
      go(tAt(T, 1, 2));
      mcode('[.' + R(st) + ']' + Lf(st) + '[' + Lf(st) + ']');
      B.ptr = tAt(T, 0, 2);
    }
    function textClear(T) {
      const st = T.st;
      go(tAt(T, 1, 2));
      mcode('[[-]<<+>>' + R(st) + ']' + Lf(st + 2) + '[-' + Lf(st) + ']');
      B.ptr = tAt(T, 0, 0);
      clr(T.len);
    }
    /** Bytes an einen Text anhängen, der sicher leer ist (feste Zellen) */
    function appendLitStatic(T, bytes) {
      const bs = bytes.slice(0, TEXT_CAP);
      bs.forEach((b, i) => addConstWith(tAt(T, i + 1, 2), b, tAt(T, i + 1, 1)));
      inc(T.len, bs.length);
    }
    /** Merker (neue Hilfszelle): Text T hat noch Platz für n Bytes */
    function fits(T, n) {
      const f = tmp();
      if (n > TEXT_CAP) return f;
      const m = mark();
      const d = tmpPair();
      addConst(d.p, TEXT_CAP - n);
      copyTo(T.len, [d.n]);
      normalize(d);
      clr(d.p);
      inc(f);
      loop(d.n, () => { clr(d.n); clr(f); });
      release(m);
      return f;
    }
    /** Bytes ans Ende hängen, wenn sie noch Platz haben */
    function appendLit(T, bytes) {
      if (!bytes.length) return;
      const m = mark();
      const f = fits(T, bytes.length);
      loop(f, () => { clr(f); appendLitRaw(T, bytes); });
      release(m);
    }
    /** Byte aus Zelle x ans Ende hängen, wenn Platz ist (x wird geleert) */
    function appendByteG(T, x) {
      const m = mark();
      const f = fits(T, 1);
      ifElse(f, () => appendByte(T, x), () => clr(x));
      release(m);
    }
    /** Bytes ans Ende eines Texts hängen (Suchschleife bis zum Ende) */
    function appendLitRaw(T, bytes) {
      if (!bytes.length) return;
      const st = T.st;
      go(tAt(T, 1, 2));
      mcode('[' + R(st) + ']');
      bytes.forEach((b, i) => { mcode(constCode(b, -1)); if (i < bytes.length - 1) mcode(R(st)); });
      mcode('[' + Lf(st) + ']');
      B.ptr = tAt(T, 0, 2);
      inc(T.len, bytes.length);
    }
    /** Byte aus Zelle x (≠ 0, wird geleert) ans Ende hängen */
    function appendByte(T, x) {
      const st = T.st;
      moveTo(x, [tAt(T, 1, 1)]);
      go(tAt(T, 1, 2));
      mcode('[<[-' + R(st) + '+' + Lf(st) + ']' + R(st + 1) + ']<[->+<]>[' + Lf(st) + ']');
      B.ptr = tAt(T, 0, 2);
      inc(T.len);
    }
    /** x += Byte Nr. idx (Zelle, idx < Länge) */
    function textFetch(T, idx, x) {
      const st = T.st, c0 = tAt(T, 0, 0);
      copyTo(idx, [c0]);
      inc(c0);
      go(c0);
      mcode('[-[-' + R(st) + '+' + Lf(st) + ']' + R(st) + ']>>[-<+<+>>]<<[->>+<<]' + Lf(st - 2));
      mcode('[' + R(st - 1) + '[-' + Lf(st) + '+' + R(st) + ']' + Lf(2 * st - 1) + ']');
      B.ptr = tAt(T, 0, 2);
      moveTo(tAt(T, 1, 1), [x]);
    }
    /** Text S in den leeren Text T kopieren (fester Abstand) */
    function copyBuf(S, T) {
      const st = S.st, D = S.base - T.base;
      go(tAt(S, 1, 2));
      mcode('[[-' + mv(D) + '+' + mv(-D) + '<+>]<[->+<]>' + R(st) + ']' + Lf(st) + '[' + Lf(st) + ']');
      B.ptr = tAt(S, 0, 2);
      copyTo(S.len, [T.len]);
    }
    /** Text S in den leeren Text T verschieben (S wird leer) */
    function moveBuf(S, T) {
      const st = S.st, D = S.base - T.base;
      go(tAt(S, 1, 2));
      mcode('[[-' + mv(D) + '+' + mv(-D) + ']' + R(st) + ']' + mv(D) + Lf(st) + '[' + Lf(st) + ']');
      B.ptr = tAt(T, 0, 2);
      moveTo(S.len, [T.len]);
    }
    /** Text S ans Ende von T hängen (Byte für Byte) */
    function appendBuf(S, T) {
      const m = mark();
      const i = tmp(), k = tmp();
      copyTo(S.len, [k]);
      loop(k, () => {
        inc(k, -1);
        const m2 = mark();
        const x = tmp();
        textFetch(S, i, x);
        appendByteG(T, x);
        inc(i);
        release(m2);
      });
      clr(i);
      release(m);
    }
    /** Länge in Zeichen (Bytes außer UTF-8-Folgebytes 128…191) zu Zelle d addieren */
    function textChars(T, d) {
      const m = mark();
      const i = tmp(), k = tmp();
      copyTo(T.len, [k]);
      loop(k, () => {
        inc(k, -1);
        const m2 = mark();
        const x = tmp(), u = tmp(), c = tmp();
        textFetch(T, i, x);
        subSat(x, 128, u);
        const z = isZero(u);
        loop(z, () => { clr(z); const m3 = mark(); const u2 = tmp(); subSat(x, 64, u2); loop(u2, () => { clr(u2); inc(c); }); release(m3); });
        clr(u); clr(x);
        inc(d);
        loop(c, () => { clr(c); inc(d, -1); });
        inc(i);
        release(m2);
      });
      clr(i);
      release(m);
    }
    /** Hilfstext aus dem Vorrat (Länge in einer Hilfszelle) */
    function tempText() {
      const i = C.tbTop++;
      if (C.tbTop > C.maxTb) C.maxTb = C.tbTop;
      const base = C.L.tbufs[i] !== undefined ? C.L.tbufs[i] : -1 - TU * (C.L.vars.size + i);
      return { len: base - 1, base, st: ST, temp: true };
    }
    function freeTempText(T) { textClear(T); C.tbTop--; }

    // ---- Zahl → Ziffern (Ziffernstapel am Rahmenende)
    const dD = (j) => C.L.itoa + (j + 1) * IU;
    /** Betrag in n der Einheit 0 → Ziffern+1 in D der Einheiten 0 …; Zeiger danach auf D(−1) */
    function digits() {
      inc(dD(0) + 1);
      go(dD(0) + 1);
      code('[[-]>>' + rep('+', 10) + '<' + DIVMOD + '>[-]<>>[-<<<<+>>>>]<<<<+' + R(5) + '[-' + R(4) + '+>+' + Lf(5) + ']' + R(4) + ']');
      code(Lf(1 + IU));
    }
    /** Zahl d (normalisiert, wird geleert) ausgeben */
    function printNum(d) {
      const n0 = dD(0) + 2;
      loop(d.n, () => { printLit([45]); moveTo(d.n, [n0]); });
      moveTo(d.p, [n0]);
      digits();
      code('[' + rep('+', 47) + '.[-]' + Lf(IU) + ']');
      B.ptr = C.L.itoa;
    }
    /** Zahl d (normalisiert, wird geleert) an Text T hängen */
    function appendNum(T, d) {
      const n0 = dD(0) + 2;
      loop(d.n, () => { appendLit(T, [45]); moveTo(d.n, [n0]); });
      moveTo(d.p, [n0]);
      digits();
      code('[' + Lf(IU) + ']');
      B.ptr = C.L.itoa;
      const f0 = dD(0) + 1;
      loop(dD(0), () => {
        go(dD(0));
        code('[' + R(IU) + ']' + Lf(IU) + '[->+<]' + Lf(IU) + '[' + R(IU + 1) + '[-' + Lf(IU) + '+' + R(IU) + ']' + Lf(2 * IU + 1) + ']');
        B.ptr = C.L.itoa;
        inc(f0, 47);
        appendByteG(T, f0);
      });
    }

    /** Bytes ausgeben (eine Hilfszelle, von Zeichen zu Zeichen nur die Differenz) */
    function printLit(bytes) {
      if (!bytes.length) return;
      const m = mark();
      const w = tmp(), t = tmp();
      let cur = 0;
      for (const b of bytes) {
        const dlt = b - cur;
        if (Math.abs(dlt) <= 12) inc(w, dlt);
        else { if (cur) clr(w); addConstWith(w, b, t); }
        go(w);
        code('.');
        cur = b;
      }
      if (cur) clr(w);
      release(m);
    }

    // ---- Ausdrücke: Zahl
    /** dst (Paar) += Wert des Ausdrucks */
    function evalAdd(a, dst) {
      const s = strip(a);
      if (!s) return;
      const ty = typeOf(s);
      switch (s.k) {
        case 'num': {
          const k = Math.trunc(s.v);
          if (k > 0) addConst(dst.p, k); else if (k < 0) addConst(dst.n, -k);
          return;
        }
        case 'str': {
          // Textkonstante als Zahl (wie die Simulation: Leerzeichen am Rand zählen nicht)
          const t = s.v.trim(), v = Number(t);
          if (t !== '' && Number.isInteger(v)) { if (v > 0) addConst(dst.p, v); else addConst(dst.n, -v); }
          return;
        }
        case 'id': {
          const v = varOf(s.name);
          if (!v) return;
          if (v.kind === 'num') { copyTo(v.p, [dst.p]); copyTo(v.n, [dst.n]); return; }
          if (v.kind === 'text') { textToNum(v, dst); return; }
          unsup('bfNoTextArray');
          return;
        }
        case 'un':
          if (s.op === '-') { evalAdd(s.a, swap(dst)); return; }
          if (s.op === '+') { evalAdd(s.a, dst); return; }
          break;
        case 'idx': fetchElem(s, dst); return;
        case 'len': lengthAdd(s.obj, dst.p); return;
        case 'bin':
          if (s.op === '+' && ty !== 'string') { evalAdd(s.a, dst); evalAdd(s.b, dst); return; }
          if (s.op === '-') { evalAdd(s.a, dst); evalAdd(s.b, swap(dst)); return; }
          if (s.op === '*') { mulAdd(s, dst); return; }
          if (s.op === '/' || s.op === '%') { divAdd(s, dst); return; }
          break;
        default: break;
      }
      if (ty === 'string') {
        const m = mark();
        const T = textOperand(s);
        if (T) { textToNum(T, dst); if (T.temp) freeTempText(T); }
        release(m);
        return;
      }
      const m = mark();
      const f = cond(s);
      moveTo(f, [dst.p]);
      release(m);
    }
    function lengthAdd(obj, cell) {
      const o = strip(obj);
      if (o && o.k === 'id') {
        const v = varOf(o.name);
        if (v && v.kind === 'arr') { copyTo(v.len, [cell]); return; }
        if (v && v.kind === 'text') { textChars(v, cell); return; }
      }
      if (o && o.k === 'str') { addConst(cell, [...o.v].length); return; }
      if (o && typeOf(o) === 'string') {
        const m = mark();
        const TB = tempText();
        buildText(TB, o, null, true);
        textChars(TB, cell);
        freeTempText(TB);
        release(m);
        return;
      }
      unsup('bfNoTextArray');
    }
    function mulAdd(s, dst) {
      const fa = strip(s.a), fb = strip(s.b);
      if (isFrac(fa) || isFrac(fb)) {
        const [f, other] = isFrac(fb) ? [fb, s.a] : [fa, s.b];
        const [p, q] = fraction(f.raw);
        evalAdd({ k: 'bin', op: '/', a: { k: 'bin', op: '*', a: other, b: num(p) }, b: num(q) }, dst);
        return;
      }
      const m = mark();
      const x = tmpPair(), y = tmpPair(), sa = tmp(), sb = tmp(), pr = tmp();
      evalNorm(s.a, x);
      evalNorm(s.b, y);
      // Beträge und Vorzeichen
      loop(x.n, () => { moveTo(x.n, [x.p]); inc(sa); });
      loop(y.n, () => { moveTo(y.n, [y.p]); inc(sb); });
      // über den kleineren Faktor zählen
      const d = tmpPair();
      copyTo(x.p, [d.p]);
      copyTo(y.p, [d.n]);
      normalize(d);
      clr(d.n);
      ifElse(d.p, () => mul(y.p, x.p, pr), () => mul(x.p, y.p, pr));
      clr(x.p); clr(y.p);
      loop(sb, () => {
        clr(sb);
        const m2 = mark();
        const e = tmp();
        inc(e);
        loop(sa, () => { clr(sa); inc(e, -1); });
        moveTo(e, [sa]);
        release(m2);
      });
      ifElse(sa, () => moveTo(pr, [dst.n]), () => moveTo(pr, [dst.p]));
      release(m);
    }
    function divAdd(s, dst) {
      const m = mark();
      const x = tmpPair(), y = tmpPair(), sa = tmp(), sb = tmp(), q = tmp(), r = tmp();
      evalNorm(s.a, x);
      evalNorm(s.b, y);
      loop(x.n, () => { moveTo(x.n, [x.p]); inc(sa); });
      loop(y.n, () => { moveTo(y.n, [y.p]); inc(sb); });
      divmod(x.p, y.p, q, r);
      clr(y.p);
      if (s.op === '/') {
        clr(r);
        // Vorzeichen: sa xor sb
        loop(sb, () => {
          clr(sb);
          const m2 = mark();
          const e = tmp();
          inc(e);
          loop(sa, () => { clr(sa); inc(e, -1); });
          moveTo(e, [sa]);
          release(m2);
        });
        ifElse(sa, () => moveTo(q, [dst.n]), () => moveTo(q, [dst.p]));
      } else {
        clr(q); clr(sb);
        ifElse(sa, () => moveTo(r, [dst.n]), () => moveTo(r, [dst.p]));
      }
      release(m);
    }

    // ---- Bedingungen → Merker (neue Hilfszelle, 0/1)
    function cond(a) {
      const s = strip(a);
      const f = tmp();
      const m = mark();
      if (!s) { inc(f); return f; }
      if (s.k === 'bin' && s.op === '&&') {
        const f1 = cond(s.a);
        loop(f1, () => { clr(f1); const m2 = mark(); const f2 = cond(s.b); moveTo(f2, [f]); release(m2); });
      } else if (s.k === 'bin' && s.op === '||') {
        const f1 = cond(s.a);
        const e = tmp();
        inc(e);
        loop(f1, () => { clr(f1); inc(f); inc(e, -1); });
        loop(e, () => { inc(e, -1); const m2 = mark(); const f2 = cond(s.b); moveTo(f2, [f]); release(m2); });
      } else if (s.k === 'un' && s.op === '!') {
        const f1 = cond(s.a);
        inc(f);
        loop(f1, () => { clr(f1); inc(f, -1); });
      } else if (s.k === 'bin' && ['==', '!=', '<', '<=', '>', '>='].includes(s.op)) {
        if (typeOf(s.a) === 'string' && typeOf(s.b) === 'string') textCond(s, f);
        else {
          const d = tmpPair();
          evalAdd(s.a, d);
          evalAdd(s.b, swap(d));
          normalize(d);
          switch (s.op) {
            case '==': inc(f); loop(d.p, () => { clr(d.p); clr(f); }); loop(d.n, () => { clr(d.n); clr(f); }); break;
            case '!=': loop(d.p, () => { clr(d.p); inc(f); }); loop(d.n, () => { clr(d.n); inc(f); }); break;
            case '<': loop(d.n, () => { clr(d.n); inc(f); }); clr(d.p); break;
            case '>': loop(d.p, () => { clr(d.p); inc(f); }); clr(d.n); break;
            case '<=': inc(f); loop(d.p, () => { clr(d.p); clr(f); }); clr(d.n); break;
            default: inc(f); loop(d.n, () => { clr(d.n); clr(f); }); clr(d.p); break;
          }
        }
      } else if (typeOf(s) === 'string') {
        // Text als Bedingung: nicht leer
        if (s.k === 'str') { if (s.v !== '') inc(f); }
        else {
          const T = textOperand(s);
          if (T) {
            const t = tmp();
            copyTo(T.len, [t]);
            loop(t, () => { clr(t); inc(f); });
            if (T.temp) freeTempText(T);
          }
        }
      } else {
        const d = tmpPair();
        evalNorm(s, d);
        loop(d.p, () => { clr(d.p); inc(f); });
        loop(d.n, () => { clr(d.n); inc(f); });
      }
      release(m);
      return f;
    }
    /** Text-Operand als Puffer: Variable oder neuer Hilfstext */
    function textOperand(a) {
      const s = strip(a);
      if (s.k === 'id') { const v = varOf(s.name); if (v && v.kind === 'text') return v; }
      if (s.k === 'idx') { unsup('bfNoTextArray'); return null; }
      const TB = tempText();
      buildText(TB, s, null, true);
      return TB;
    }
    /** Textvergleich → Merker f */
    function textCond(s, f) {
      const X = textOperand(s.a);
      const Y = textOperand(s.b);
      if (!X || !Y) return;
      const lt = tmp(), gt = tmp();
      textCmp(X, Y, lt, gt);
      if (Y.temp) freeTempText(Y);
      if (X.temp) freeTempText(X);
      switch (s.op) {
        case '==': inc(f); loop(lt, () => { clr(lt); clr(f); }); loop(gt, () => { clr(gt); clr(f); }); break;
        case '!=': loop(lt, () => { clr(lt); inc(f); }); loop(gt, () => { clr(gt); inc(f); }); break;
        case '<': moveTo(lt, [f]); clr(gt); break;
        case '>': moveTo(gt, [f]); clr(lt); break;
        case '<=': inc(f); loop(gt, () => { clr(gt); clr(f); }); clr(lt); break;
        default: inc(f); loop(lt, () => { clr(lt); clr(f); }); clr(gt); break;
      }
    }
    /** Byte für Byte vergleichen: lt / gt = 1, wenn X < Y bzw. X > Y */
    function textCmp(X, Y, lt, gt) {
      const m = mark();
      const i = tmp(), run = tmp();
      inc(run);
      loop(run, () => {
        clr(run);
        const m2 = mark();
        const a = tmp(), b = tmp();
        for (const [T, x] of [[X, a], [Y, b]]) {
          const d = tmpPair();
          copyTo(T.len, [d.p]);
          copyTo(i, [d.n]);
          normalize(d);
          clr(d.n);
          loop(d.p, () => { clr(d.p); textFetch(T, i, x); });
        }
        const d = tmpPair();
        copyTo(a, [d.p]);
        copyTo(b, [d.n]);
        normalize(d);
        const cont = tmp();
        loop(a, () => { clr(a); inc(cont); });
        clr(b);
        loop(d.p, () => { clr(d.p); inc(gt); clr(cont); });
        loop(d.n, () => { clr(d.n); inc(lt); clr(cont); });
        moveTo(cont, [run]);
        inc(i);
        release(m2);
      });
      clr(i);
      release(m);
    }

    // ---- Texte bauen
    function parts(ast) {
      const s = strip(ast);
      if (s && s.k === 'bin' && s.op === '+' && typeOf(s) === 'string') return parts(s.a).concat(parts(s.b));
      return s ? [s] : [];
    }
    /** Text T := Ausdruck. selfName = Name von T (falls Variable), empty = T ist sicher leer */
    function buildText(T, ast, selfName, empty) {
      const ps = ast ? parts(ast) : [];
      const isSelf = (p) => selfName && p.k === 'id' && p.name === selfName;
      if (selfName && ps.length && isSelf(ps[0]) && !ps.slice(1).some((p) => mentions(p, selfName))) {
        for (const p of ps.slice(1)) appendPart(T, p, false);
        return;
      }
      if (selfName && ps.some((p) => mentions(p, selfName))) {
        const m = mark();
        const TB = tempText();
        let e = true;
        for (const p of ps) e = appendPart(TB, p, e);
        textClear(T);
        moveBuf(TB, T);
        C.tbTop--;
        release(m);
        return;
      }
      if (!empty) textClear(T);
      let e = true;
      for (const p of ps) e = appendPart(T, p, e);
    }
    /** ein Stück an T hängen; liefert, ob T danach noch sicher leer ist */
    function appendPart(T, p, empty) {
      const s = strip(p);
      const ty = typeOf(s);
      if (s.k === 'str') {
        const b = utf8(s.v);
        if (!b.length) return empty;
        if (empty) appendLitStatic(T, b); else appendLit(T, b);
        return false;
      }
      if (ty === 'string') {
        if (s.k === 'id') {
          const v = varOf(s.name);
          if (!v || v.kind !== 'text') return empty;
          if (empty) copyBuf(v, T); else appendBuf(v, T);
          return false;
        }
        unsup('bfNoTextArray');
        return empty;
      }
      const m = mark();
      if (ty === 'bool') {
        const f = cond(s);
        ifElse(f, () => appendLit(T, utf8('true')), () => appendLit(T, utf8('false')));
      } else {
        const d = tmpPair();
        evalNorm(s, d);
        appendNum(T, d);
      }
      release(m);
      return false;
    }

    // ---- Ausgabe
    function outputParts(ast) {
      for (const p of parts(ast)) {
        const s = strip(p);
        const ty = typeOf(s);
        const m = mark();
        if (s.k === 'str') printLit(utf8(s.v));
        else if (ty === 'string') {
          const T = textOperand(s);
          if (T) { textOut(T); if (T.temp) freeTempText(T); }
        } else if (ty === 'bool') {
          const f = cond(s);
          ifElse(f, () => printLit(utf8('true')), () => printLit(utf8('false')));
        } else {
          const d = tmpPair();
          evalNorm(s, d);
          printNum(d);
        }
        release(m);
      }
    }

    // ---- Eingabe
    /** Zustand beim Zerlegen einer Zahl: Vorzeichen, Betrag, Ziffern, Fehler, am Anfang */
    function numState() {
      const st = { sign: tmp(), mag: tmp(), digs: tmp(), bad: tmp(), first: tmp() };
      inc(st.first);
      return st;
    }
    /** ein Zeichen x (≠ 0) einer Zahl verarbeiten: Ziffer, Vorzeichen am Anfang, Leerzeichen, sonst Fehler */
    function numChar(x, st) {
      const { sign, mag, digs, bad, first } = st;
      const m4 = mark();
      const t = tmp(), u = tmp();
      copyTo(x, [t]);
      subSat(t, 48, u);
      ifElse(u, () => {
        const m5 = mark();
        const fm = eqConst(x, 45), fp = eqConst(x, 43), fs = eqConst(x, 32);
        const ok = tmp();
        loop(fs, () => { clr(fs); inc(ok); });
        const g = tmp();
        copyTo(first, [g]);
        loop(g, () => {
          clr(g);
          loop(fm, () => { clr(fm); inc(sign); inc(ok); });
          loop(fp, () => { clr(fp); inc(ok); });
        });
        clr(fm); clr(fp);
        const nok = isZero(ok);
        clr(ok);
        moveTo(nok, [bad]);
        release(m5);
      }, () => {
        const m5 = mark();
        const t2 = tmp(), u2 = tmp();
        copyTo(t, [t2]);
        subSat(t2, 10, u2);
        clr(t2);
        ifElse(u2, () => {
          const m6 = mark();
          const w = tmp();
          moveTo(mag, [w]);
          loop(w, () => { inc(w, -1); inc(mag, 10); });
          moveTo(t, [mag]);
          inc(digs);
          release(m6);
        }, () => inc(bad));
        release(m5);
      });
      clr(t);
      clr(first);
      release(m4);
    }
    /** Text T als ganze Zahl lesen → d += Wert (ungültig → 0) */
    function textToNum(T, d) {
      const m = mark();
      const st = numState();
      const i = tmp(), k = tmp();
      copyTo(T.len, [k]);
      loop(k, () => {
        inc(k, -1);
        const m2 = mark();
        const x = tmp();
        textFetch(T, i, x);
        numChar(x, st);
        clr(x);
        inc(i);
        release(m2);
      });
      clr(i);
      const inv = isZero(st.digs);
      loop(st.bad, () => { clr(st.bad); clr(inv); inc(inv); });
      loop(inv, () => { clr(inv); clr(st.mag); clr(st.sign); });
      clr(st.digs); clr(st.first);
      ifElse(st.sign, () => moveTo(st.mag, [d.n]), () => moveTo(st.mag, [d.p]));
      release(m);
    }
    /** Zeile lesen, bis eine ganze Zahl kommt → Paar d (bei Dateiende 0) */
    function readNum(d, prompt) {
      const m = mark();
      const again = tmp();
      inc(again);
      loop(again, () => {
        inc(again, -1);
        if (prompt) outputParts(prompt);
        const m2 = mark();
        const st = numState();
        const eof = tmp(), run = tmp();
        const { sign, mag, digs, bad, first } = st;
        inc(run);
        loop(run, () => {
          const m3 = mark();
          const x = tmp();
          go(x); code(',');
          const e0 = isZero(x), e10 = eqConst(x, 10), e13 = eqConst(x, 13);
          const other = tmp();
          inc(other);
          loop(e0, () => { clr(e0); clr(other); clr(run); copyTo(first, [eof]); });
          loop(e10, () => { clr(e10); clr(other); clr(run); });
          loop(e13, () => { clr(e13); clr(other); });
          loop(other, () => { clr(other); numChar(x, st); });
          clr(x);
          release(m3);
        });
        // ungültig: keine Ziffer oder falsches Zeichen (außer bei Dateiende am Zeilenanfang)
        const inv = isZero(digs);
        loop(bad, () => { clr(bad); clr(inv); inc(inv); });
        loop(eof, () => { clr(eof); clr(inv); clr(mag); clr(sign); });
        loop(inv, () => { clr(inv); printLit(utf8(tr('javaNeedInt') + '\n')); inc(again); clr(mag); clr(sign); });
        clr(digs); clr(first);
        ifElse(sign, () => moveTo(mag, [d.n]), () => moveTo(mag, [d.p]));
        release(m2);
      });
      release(m);
    }
    /** Zeile in Text T lesen (CR wird übersprungen) */
    function readText(T) {
      textClear(T);
      const m = mark();
      const run = tmp();
      inc(run);
      loop(run, () => {
        const m2 = mark();
        const x = tmp();
        go(x); code(',');
        const e0 = isZero(x), e10 = eqConst(x, 10), e13 = eqConst(x, 13);
        const other = tmp();
        inc(other);
        loop(e0, () => { clr(e0); clr(other); clr(run); });
        loop(e10, () => { clr(e10); clr(other); clr(run); });
        loop(e13, () => { clr(e13); clr(other); });
        loop(other, () => { clr(other); appendByteG(T, x); });
        clr(x);
        release(m2);
      });
      release(m);
    }

    // ---- Zuweisen
    /** Zahl d (wird geleert) in Ziel schreiben */
    function storeNum(tgt, d) {
      if (tgt.k === 'idx') { storeElem(tgt, d); return; }
      const v = varOf(tgt.name);
      if (v && v.kind === 'num') { clr(v.p); clr(v.n); moveTo(d.p, [v.p]); moveTo(d.n, [v.n]); return; }
      if (v && v.kind === 'text') { textClear(v); appendNum(v, d); return; }
      clr(d.p); clr(d.n);
    }
    function assign(targetSrc, ast) {
      const tgt = tryTarget(targetSrc);
      if (!tgt) return;
      const tt = typeOf(tgt);
      if (tt === 'string') {
        if (tgt.k !== 'id') { unsup('bfNoTextArray'); return; }
        const v = varOf(tgt.name);
        if (v && v.kind === 'text') buildText(v, ast, tgt.name, false);
        return;
      }
      if (A.isArrayType(tt)) return;
      const m = mark();
      const d = tmpPair();
      evalNorm(ast, d);
      storeNum(tgt, d);
      release(m);
    }

    // ---- Blöcke (nur mit Unterprogramm-Aufrufen)
    const blocks = [];
    const nBlocks = hints ? hints.nBlocks : 0;
    const newBlock = (title) => { const b = { idx: blocks.length, title, B: null }; blocks.push(b); return b; };
    const blockId = (b) => (hints ? nBlocks - 1 - b.idx : b.idx);
    const startBlock = (b, ptr) => { B = newBuilder(ptr === undefined ? H.E : ptr, 1); b.B = B; note(tr('bfBlock', blockId(b)) + (b.title ? ': ' + b.title : '')); };
    /** PC des eigenen Rahmens setzen (T dient als Hilfszelle) */
    const setPC = (b) => addConstWith(H.PC, blockId(b), H.T);
    const endGoto = (b) => { setPC(b); go(H.E); flush(); };
    const endBranch = (f, yes, no) => {
      ifElse(f, () => setPC(yes), () => setPC(no));
      go(H.E);
      flush();
    };
    const entryOf = new Map();

    // ---- Anweisungen
    function genSeq(seq) { for (const n of seq) genStmt(n); }

    function head(n, txt) { note(txt + (n.comment ? '   (' + n.comment + ')' : '')); }

    function genStmt(n) {
      const m = mark();
      if (dispatch && hasCall(n)) genSplit(n);
      else genSimple(n);
      release(m);
    }

    function genSimple(n) {
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) note(l);
          return;
        case 'decl': {
          const v = varOf(n.name);
          if (A.isArrayType(n.vtype)) {
            head(n, n.name + ' = ' + tr('mgNewArray', n.length));
            if (!v || v.kind !== 'arr') { unsup('bfNoTextArray'); return; }
            arrClear(v);
            const len = tryParse(n.length);
            const d = tmpPair();
            evalNorm(len, d);
            clr(d.n);
            moveTo(d.p, [v.len]);
            // höchstens Kapazität
            const e = tmpPair();
            copyTo(v.len, [e.p]);
            addConst(e.n, v.cap);
            normalize(e);
            clr(e.n);
            loop(e.p, () => { clr(e.p); clr(v.len); addConst(v.len, v.cap); });
            return;
          }
          head(n, n.name + ' = ' + (String(n.init || '').trim() || (n.vtype === 'string' ? '""' : '0')));
          assign(n.name, tryParse(n.init));
          return;
        }
        case 'assign':
          head(n, n.target + ' = ' + n.expr);
          assign(n.target, tryParse(n.expr));
          return;
        case 'input': {
          head(n, tr('mgInput', n.target) + (String(n.prompt || '').trim() ? '  ' + n.prompt : ''));
          const tgt = tryTarget(n.target);
          if (!tgt) return;
          const p = tryParse(n.prompt);
          const tt = typeOf(tgt);
          if (tt === 'string') {
            if (p) outputParts(p);
            const v = tgt.k === 'id' ? varOf(tgt.name) : null;
            if (!v || v.kind !== 'text') { unsup('bfNoTextArray'); return; }
            readText(v);
            return;
          }
          const d = tmpPair();
          readNum(d, p);
          storeNum(tgt, d);
          return;
        }
        case 'output': {
          head(n, tr('mgOutput', n.expr));
          const ast = tryParse(n.expr);
          if (ast) outputParts(ast);
          printLit([10]);
          return;
        }
        case 'if': {
          head(n, tr('mgIf', n.cond));
          const f = cond(tryParse(n.cond));
          B.ind++;
          ifElse(f, () => genSeq(n.then), n.else && n.else.length ? () => { B.ind--; note(tr('kw.else')); B.ind++; genSeq(n.else); } : null);
          B.ind--;
          return;
        }
        case 'while': {
          head(n, tr('mgWhile', n.cond));
          const c = tryParse(n.cond);
          const f = cond(c);
          B.ind++;
          loop(f, () => {
            clr(f);
            genSeq(n.body);
            const m = mark(); const g = cond(c); moveTo(g, [f]); release(m);
          });
          B.ind--;
          return;
        }
        case 'until': {
          head(n, tr('mgUntil', n.cond));
          const c = tryParse(n.cond);
          const f = tmp();
          inc(f);
          B.ind++;
          loop(f, () => {
            clr(f);
            genSeq(n.body);
            const m = mark(); const g = cond({ k: 'un', op: '!', a: c || num(1) }); moveTo(g, [f]); release(m);
          });
          B.ind--;
          return;
        }
        case 'for': {
          head(n, tr('mgFor', n.counter, n.from, n.to, String(n.step || '1').trim() || '1'));
          const fc = forParts(n);
          if (!fc) return;
          assign(n.counter, fc.from);
          const f = cond(fc.test);
          B.ind++;
          loop(f, () => {
            clr(f);
            genSeq(n.body);
            assign(n.counter, fc.next);
            const m = mark(); const g = cond(fc.test); moveTo(g, [f]); release(m);
          });
          B.ind--;
          return;
        }
        case 'switch': {
          head(n, tr('mgSwitch', n.expr));
          const sel = tryParse(n.expr);
          if (!sel) return;
          const done = tmp();
          B.ind++;
          for (const c of n.cases) {
            note(tr('mgSwitch', n.expr) + ' = ' + c.value);
            const m = mark();
            const f = caseMatch(sel, c, done);
            loop(f, () => { clr(f); inc(done); genSeq(c.body); });
            release(m);
          }
          if (n.else) {
            note(tr('kw.else'));
            const m = mark();
            const f = isZero(done);
            loop(f, () => { clr(f); genSeq(n.else); });
            release(m);
          }
          clr(done);
          B.ind--;
          return;
        }
        default: return;
      }
    }

    /** FÜR: Startwert, Bedingung und Weiterzählen als Ausdrücke (Bedingung wie in C jedes Mal neu) */
    function forParts(n) {
      const k = tryTarget(n.counter);
      if (!k) return null;
      const from = tryParse(n.from) || num(0);
      const to = tryParse(n.to) || num(0);
      const step = tryParse(n.step) || num(1);
      const lit = A.literalValue(step);
      let test;
      if (typeof lit === 'number') test = { k: 'bin', op: lit >= 0 ? '<=' : '>=', a: k, b: to };
      else {
        test = {
          k: 'bin', op: '||',
          a: { k: 'bin', op: '&&', a: { k: 'bin', op: '>=', a: step, b: num(0) }, b: { k: 'bin', op: '<=', a: k, b: to } },
          b: { k: 'bin', op: '&&', a: { k: 'bin', op: '<', a: step, b: num(0) }, b: { k: 'bin', op: '>=', a: k, b: to } }
        };
      }
      return { from, test, next: { k: 'bin', op: '+', a: k, b: step } };
    }
    /** Merker: Fall passt und noch kein Fall ausgeführt */
    function caseMatch(sel, c, done) {
      const isText = typeOf(sel) === 'string';
      const v = tryParse(c.value) || (isText ? { k: 'str', v: '' } : num(0));
      const f = cond({ k: 'bin', op: '==', a: sel, b: v });
      const nd = isZero(done);
      const r = tmp();
      loop(f, () => { clr(f); moveTo(nd, [r]); });
      clr(nd);
      return r;
    }

    // ---- Anweisungen mit Aufrufen: in Blöcke zerlegt
    function genSplit(n) {
      switch (n.kind) {
        case 'call': genCall(n); return;
        case 'if': {
          head(n, tr('mgIf', n.cond));
          const hasElse = n.else && n.else.length;
          const bt = newBlock(tr('mgIf', n.cond)), be = hasElse ? newBlock(tr('kw.else')) : null, bj = newBlock('');
          const f = cond(tryParse(n.cond));
          endBranch(f, bt, be || bj);
          startBlock(bt); genSeq(n.then); endGoto(bj);
          if (be) { startBlock(be); genSeq(n.else); endGoto(bj); }
          startBlock(bj);
          return;
        }
        case 'while': {
          head(n, tr('mgWhile', n.cond));
          const bh = newBlock(tr('mgWhile', n.cond)), bb = newBlock(''), bx = newBlock('');
          endGoto(bh);
          startBlock(bh);
          const f = cond(tryParse(n.cond));
          endBranch(f, bb, bx);
          startBlock(bb); genSeq(n.body); endGoto(bh);
          startBlock(bx);
          return;
        }
        case 'until': {
          head(n, tr('mgUntil', n.cond));
          const bb = newBlock(tr('mgUntil', n.cond)), bx = newBlock('');
          endGoto(bb);
          startBlock(bb);
          genSeq(n.body);
          const f = cond(tryParse(n.cond) || num(1));
          endBranch(f, bx, bb);
          startBlock(bx);
          return;
        }
        case 'for': {
          head(n, tr('mgFor', n.counter, n.from, n.to, String(n.step || '1').trim() || '1'));
          const fc = forParts(n);
          if (!fc) return;
          assign(n.counter, fc.from);
          const bh = newBlock(tr('mgFor', n.counter, n.from, n.to, String(n.step || '1').trim() || '1')), bb = newBlock(''), bx = newBlock('');
          endGoto(bh);
          startBlock(bh);
          const f = cond(fc.test);
          endBranch(f, bb, bx);
          startBlock(bb);
          genSeq(n.body);
          assign(n.counter, fc.next);
          endGoto(bh);
          startBlock(bx);
          return;
        }
        case 'switch': {
          head(n, tr('mgSwitch', n.expr));
          const sel = tryParse(n.expr);
          if (!sel) return;
          const bc = n.cases.map((c) => newBlock(tr('mgSwitch', n.expr) + ' = ' + c.value));
          const be = n.else ? newBlock(tr('kw.else')) : null;
          const bj = newBlock('');
          const done = tmp();
          n.cases.forEach((c, i) => {
            const m = mark();
            const f = caseMatch(sel, c, done);
            loop(f, () => { clr(f); inc(done); setPC(bc[i]); });
            release(m);
          });
          const f = isZero(done);
          loop(f, () => { clr(f); setPC(be || bj); });
          clr(done);
          go(H.E);
          flush();
          n.cases.forEach((c, i) => { startBlock(bc[i]); genSeq(c.body); endGoto(bj); });
          if (be) { startBlock(be); genSeq(n.else); endGoto(bj); }
          startBlock(bj);
          return;
        }
        default: genSimple(n);
      }
    }

    /** Aufruf: Parameter in den neuen Rahmen, Sprung; Fortsetzungsblock holt die Ergebnisse */
    function genCall(n) {
      const callee = fnByName.get(n.fn);
      const label = (n.target && n.target.trim() ? n.target + ' = ' : '') + (n.fn || '?') + '(' + n.args.join(', ') + ')';
      head(n, tr('mgCall', label));
      const gL = layouts.get(callee);
      const base = C.L.size + gL.bufs;
      const cv = (name) => gL.vars.get(name);
      const sh = (v) => Object.assign({}, v, { len: base + v.len, base: base + v.base });
      // Parameter
      callee.params.forEach((p, i) => {
        const v = cv(p.name);
        if (!v) return;
        const src = tryParse(n.args[i] || '');
        const m = mark();
        if (v.kind === 'arr') {
          const arr = src ? arrayVarOf(src) : null;
          if (!arr) { unsup('bfBadArg'); return; }
          const dst = sh(v);
          arrEach(arr, arr.len, bodyCopy(arr.base - dst.base));
          copyTo(arr.len, [dst.len]);
        } else if (v.kind === 'text') {
          buildText(sh(v), src, null, true);
        } else if (v.kind === 'num') {
          // erst in Hilfszellen rechnen, dann mit je einer Schleife in den neuen Rahmen
          const d = tmpPair();
          if (src) {
            evalNorm(src, d);
          }
          moveTo(d.p, [base + v.p]);
          moveTo(d.n, [base + v.n]);
        } else unsup('bfNoTextArray');
        release(m);
      });
      const cont = newBlock(tr('bfCont', n.fn));
      inc(base + H.RUN);
      addConstWith(base + H.RET, blockId(cont), base + H.T);
      addConstWith(base + H.PC, blockId(entryOf.get(callee)), base + H.T);
      go(base + H.E);
      flush();
      // Fortsetzung: Zeiger steht noch im Rahmen des Unterprogramms
      startBlock(cont, base + H.E);
      const later = [];
      // zuerst InOut-Parameter und Arrays, dann das Ergebnis (wie in der Simulation gewinnt das Ergebnis)
      callee.params.forEach((p, i) => {
        const v = cv(p.name);
        if (!v) return;
        const src = tryParse(n.args[i] || '');
        if (v.kind === 'arr') {
          const arr = src ? arrayVarOf(src) : null;
          const cs = sh(v);
          if (arr) arrEach(cs, cs.len, bodyClearMove(cs.base - arr.base));
          else arrEach(cs, cs.len, bodyClear);
          clr(cs.len);
        } else if (v.kind === 'text') {
          const cs = sh(v);
          const tgt = p.byRef && src ? strip(src) : null;
          const tv2 = tgt && tgt.k === 'id' ? varOf(tgt.name) : null;
          if (tv2 && tv2.kind === 'text') { textClear(tv2); moveBuf(cs, tv2); }
          else textClear(cs);
        } else if (v.kind === 'num') {
          const s = src ? strip(src) : null;
          if (p.byRef && s && (s.k === 'id' || s.k === 'idx')) { const d = tmpPair(); moveTo(base + v.p, [d.p]); moveTo(base + v.n, [d.n]); later.push([s, d]); }
          else { clr(base + v.p); clr(base + v.n); }
        }
      });
      if (callee.returnType !== 'void') {
        const rv = cv('result');
        const tgt = n.target && n.target.trim() ? tryTarget(n.target) : null;
        const tt = tgt ? typeOf(tgt) : null;
        if (rv && rv.kind === 'num') {
          if (tgt && tt !== 'string' && !A.isArrayType(tt)) { const d = tmpPair(); moveTo(base + rv.p, [d.p]); moveTo(base + rv.n, [d.n]); later.push([tgt, d]); }
          else if (tgt && tt === 'string' && tgt.k === 'id' && varOf(tgt.name) && varOf(tgt.name).kind === 'text') { const d = tmpPair(); moveTo(base + rv.p, [d.p]); moveTo(base + rv.n, [d.n]); later.push([tgt, d]); }
          else { clr(base + rv.p); clr(base + rv.n); }
        } else if (rv && rv.kind === 'text') {
          const src = sh(rv);
          const tv2 = tgt && tgt.k === 'id' ? varOf(tgt.name) : null;
          if (tv2 && tv2.kind === 'text') { textClear(tv2); moveBuf(src, tv2); }
          else if (tgt && tt !== 'string' && !A.isArrayType(tt)) { const d = tmpPair(); textToNum(src, d); textClear(src); later.push([tgt, d]); }
          else { if (tgt) unsup('bfNoTextArray'); textClear(src); }
        }
      }
      clr(base + H.RUN);
      go(H.E);
      for (const [tgt, d] of later) storeNum(tgt, d);
    }

    // ---- Unterprogramm-Ende: alles außer Ergebnis, InOut und Arrays löschen, PC = RET
    function epilogue(fn) {
      note(tr('bfEndSub', fn.name));
      for (const v of C.L.vars.values()) {
        const sv = v.sv;
        if (sv.kind === 'result' || (sv.kind === 'param' && (sv.byRef || v.kind === 'arr'))) continue;
        if (v.kind === 'num') { clr(v.p); clr(v.n); }
        else if (v.kind === 'text') textClear(v);
        else if (v.kind === 'arr') arrClear(v);
      }
      moveTo(H.RET, [H.PC]);
      go(H.E);
      flush();
    }

    // ---- Zusammenbau
    const ctxs = new Map();
    const newCtx = (fn) => { const c = { fn, L: layouts.get(fn), tmpTop: 0, maxTemp: 0, tbTop: 0, maxTb: 0 }; ctxs.set(fn, c); return c; };
    let mainItems = [];
    if (dispatch) {
      for (const f of [main, ...subs]) entryOf.set(f, newBlock(f === main ? tr('mgMainHead') : tr('mgSub', f.name, f.params.map((p) => p.name).join(', '))));
      C = newCtx(main);
      startBlock(entryOf.get(main));
      genSeq(main.body);
      note(tr('mgCmtEnd'));
      clr(H.RUN);
      go(H.E);
      flush();
      for (const f of subs) {
        C = newCtx(f);
        startBlock(entryOf.get(f));
        if (f.returnType !== 'void' && String(f.resultInit || '').trim()) {
          note('result = ' + f.resultInit);
          assign('result', tryParse(f.resultInit));
        }
        genSeq(f.body);
        epilogue(f);
      }
    } else {
      C = newCtx(main);
      B = newBuilder(-layouts.get(main).bufs, 0);
      genSeq(main.body);
      flush();
      mainItems = B.items;
      for (const f of subs) newCtx(f);
    }

    // ---- Text zusammensetzen
    const lines = [];
    const put = (items) => {
      for (const it of items) {
        const ind = '  '.repeat(it.ind);
        if (it.cmt !== undefined) { lines.push(ind + it.cmt); continue; }
        const w = Math.max(20, WRAP - ind.length);
        for (let i = 0; i < it.code.length; i += w) lines.push(ind + it.code.slice(i, i + w));
      }
    };
    const mainL = layouts.get(main);
    // Bandbedarf: Rahmen entlang der tiefsten Aufrufkette (Rekursion einmal gezählt)
    const need = (f, seen) => {
      if (seen.has(f)) return 0;
      const s2 = new Set(seen); s2.add(f);
      let mx = 0;
      BBE.model.walkSeq(f.body, (n) => { if (n.kind === 'call' && fnByName.has(n.fn)) mx = Math.max(mx, need(fnByName.get(n.fn), s2)); });
      return layouts.get(f).bufs + layouts.get(f).size + mx;
    };
    const head0 = [tr('bfHeader1'), tr('bfHeader2'), tr('bfHeader3'), tr('bfHeader4', need(main, new Set()) + 12 * IU), tr('bfHeader5', TEXT_CAP, ARRAY_CAP), tr('bfHeader6')];
    for (const h of head0) lines.push(safe(h));
    for (const f of [main, ...subs]) {
      const L = layouts.get(f);
      const vs = [...L.vars].filter(([, v]) => v.kind !== 'none').map(([nm, v]) =>
        v.kind === 'num' ? v.p + '/' + v.n + ' ' + nm : v.len + ' ' + nm + ' (' + tr(v.kind === 'text' ? 'bfText' : 'bfArray') + ')');
      lines.push(safe(tr('bfFrame', f.isMain ? tr('mgMainHead') : f.name, L.bufs + L.size, vs.join('; ') || '–')));
    }
    if (unsupported.length) lines.push(safe('⚠ ' + unsupported.join(' ')));
    lines.push('');
    if (!dispatch) put(mainItems);
    else {
      const N = blocks.length;
      const ids = blocks.map((b) => ({ id: blockId(b), b })).sort((x, y) => y.id - x.id);
      B = newBuilder(-mainL.bufs, 0);
      C = ctxs.get(main);
      note(tr('bfStart'));
      inc(H.RUN);
      addConstWith(H.PC, blockId(entryOf.get(main)), H.T);
      go(H.RUN);
      note(tr('bfDispatch'));
      code('[>[->+<]>>+<');
      code(rep('[-', N - 1));
      flush();
      put(B.items);
      for (const { id, b } of ids) {
        lines.push('>[-');
        put(b.B ? b.B.items : []);
        lines.push(']<' + (id > 0 ? ']' : '<<]'));
      }
      if (!N) lines.push('<<]');
    }
    const text = lines.join('\n') + '\n';
    const fnHints = fns.map((f) => { const c = ctxs.get(f); return { maxTemp: c ? c.maxTemp : 0, maxTb: c ? c.maxTb : 0 }; });
    return { code: text, unsupported, hints: { fns: fnHints, nBlocks: blocks.length } };
  }

  // ======================================================================= Interpreter

  /**
   * Führt ein Brainfuck-Programm aus (Zellmodell wie im Kopf der erzeugten Programme):
   * Zellen ≥ 0 ohne Obergrenze (ein negativer Wert ist ein Fehler), Band ab Zelle 0 nach rechts,
   * ',' liefert Bytes der UTF-8-codierten Eingabe, bei Dateiende 0.
   * @param src  Quelltext
   * @param io   { stdin: string | input(): string|null (eine Zeile), output(text), maxSteps }
   * @returns    { steps, error }
   */
  function run(src, io = {}) {
    const text = String(src);
    const ops = [];
    const stack = [];
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') { line++; continue; }
      if (c === '+' || c === '-') {
        const d = c === '+' ? 1 : -1;
        const last = ops[ops.length - 1];
        if (last && last.t === 0 && !last.fixed) last.k += d; else ops.push({ t: 0, k: d, line });
      } else if (c === '>' || c === '<') {
        const d = c === '>' ? 1 : -1;
        const last = ops[ops.length - 1];
        if (last && last.t === 1 && !last.fixed) last.k += d; else ops.push({ t: 1, k: d, line });
      } else if (c === '.') ops.push({ t: 2, line });
      else if (c === ',') ops.push({ t: 3, line });
      else if (c === '[') { stack.push(ops.length); ops.push({ t: 4, line }); }
      else if (c === ']') {
        if (!stack.length) return { steps: 0, error: 'Zeile ' + line + ': ] ohne [' };
        const open = stack.pop();
        const ol = ops[open].line;
        const body = ops.slice(open + 1);
        if (body.length && body.every((o) => o.t === 0 || o.t === 1)) {
          let p = 0;
          const delta = new Map();
          for (const o of body) { if (o.t === 1) p += o.k; else delta.set(p, (delta.get(p) || 0) + o.k); }
          if (p === 0 && delta.get(0) === -1) {
            ops.length = open;
            const terms = [...delta].filter(([o, k]) => o !== 0 && k !== 0);
            ops.push(terms.length ? { t: 6, terms, fixed: true, line: ol } : { t: 5, fixed: true, line: ol });
            continue;
          }
          if (body.length === 1 && body[0].t === 1) { ops.length = open; ops.push({ t: 7, k: body[0].k, fixed: true, line: ol }); continue; }
        }
        ops.push({ t: 8, to: open, fixed: true, line });
        ops[open].to = ops.length - 1;
      }
    }
    if (stack.length) return { steps: 0, error: 'Zeile ' + ops[stack[stack.length - 1]].line + ': [ ohne ]' };

    let mem = new Float64Array(1 << 16);
    const LIMIT = 1 << 24;
    const grow = (q) => {
      if (q >= LIMIT) throw new Error('Band zu lang');
      let n = mem.length;
      while (n <= q) n *= 2;
      const m2 = new Float64Array(n);
      m2.set(mem);
      mem = m2;
    };
    // Eingabe
    let inBytes;
    if (io.stdin != null) inBytes = utf8(String(io.stdin));
    else inBytes = [];
    let inPos = 0;
    const readByte = () => {
      if (inPos < inBytes.length) return inBytes[inPos++];
      if (io.stdin == null && io.input) {
        const l = io.input();
        if (l != null) { inBytes = utf8(String(l) + '\n'); inPos = 0; return inBytes[inPos++]; }
      }
      return 0;
    };
    // Ausgabe (UTF-8 → Text, zeilenweise weitergeben)
    const outBytes = [];
    const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    const flush = (final) => {
      if (!outBytes.length && !final) return;
      let s;
      if (dec) s = dec.decode(new Uint8Array(outBytes), { stream: !final });
      else { try { s = decodeURIComponent(escape(String.fromCharCode(...outBytes))); } catch (e) { s = String.fromCharCode(...outBytes); } }
      outBytes.length = 0;
      if (s && io.output) io.output(s);
    };
    const max = io.maxSteps || 1e9;
    let p = 0, pc = 0, steps = 0;
    const n = ops.length;
    const neg = (q) => new Error('Zelle ' + q + ' würde negativ');
    try {
      while (pc < n) {
        if (++steps > max) { flush(true); return { steps, error: 'Schrittgrenze erreicht' }; }
        const o = ops[pc];
        switch (o.t) {
          case 0: { const v = mem[p] + o.k; if (v < 0) throw neg(p); mem[p] = v; break; }
          case 1: p += o.k; if (p < 0) throw new Error('Zeiger links von Zelle 0'); if (p >= mem.length) grow(p + 64); break;
          case 2: outBytes.push(mem[p] % 256); if (mem[p] === 10) flush(false); break;
          case 3: mem[p] = readByte(); break;
          case 4: if (mem[p] === 0) pc = o.to; break;
          case 8: if (mem[p] !== 0) pc = o.to; break;
          case 5: mem[p] = 0; break;
          case 6: {
            const v = mem[p];
            if (v !== 0) {
              const terms = o.terms;
              for (let k = 0; k < terms.length; k++) {
                const q = p + terms[k][0];
                if (q < 0) throw new Error('Zeiger links von Zelle 0');
                if (q >= mem.length) grow(q + 64);
                const r = mem[q] + terms[k][1] * v;
                if (r < 0) throw neg(q);
                mem[q] = r;
              }
              mem[p] = 0;
            }
            break;
          }
          case 7: {
            const k = o.k;
            while (mem[p] !== 0) { p += k; if (p < 0) throw new Error('Zeiger links von Zelle 0'); if (p >= mem.length) grow(p + 64); }
            break;
          }
          default: break;
        }
        pc++;
      }
      flush(true);
      return { steps };
    } catch (e) {
      flush(true);
      return { steps, error: (ops[pc] ? 'Zeile ' + ops[pc].line + ': ' : '') + e.message };
    }
  }

  BBE.bfgen = { generate, run };
})(typeof window !== 'undefined' ? window : globalThis);
