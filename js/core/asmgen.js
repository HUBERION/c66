/* Blockbild-Editor – Übersetzung nach x86-Assembler für MS-DOS (NASM, .COM-Programm)
 *
 *   Übersetzen:  nasm -f bin -o prog.com datei.asm      Ausführen: prog (DOS, DOSBox, FreeDOS …)
 *   Nur 8086-Befehle (cpu 8086), 16-Bit-Real-Mode, Ein-/Ausgabe über INT 21h (AH=3Fh/40h auf Handle 0/1,
 *   damit auch umgeleitete Ein-/Ausgabe "prog < ein.txt > aus.txt" funktioniert).
 *
 *   Speicher (.COM: CS = DS = ES = SS, 64 KB):
 *     100h …        Programm, Laufzeitbibliothek, Daten (Texte)
 *     heap_start …  Heap (wächst nach oben): Arrays. Jedes Unterprogramm merkt sich beim Eintritt den
 *                   Heap-Zeiger (hp_mark) und setzt ihn beim Rücksprung zurück – Arrays leben so lange wie
 *                   ihr Unterprogramm (sie werden nur nach unten weitergereicht, nie zurückgegeben).
 *     … FFFEh       Stack (wächst nach unten): ein Rahmen je Aufruf, Rekursion funktioniert.
 *   Zahl  = 16-Bit-Wort mit Vorzeichen (-32768 … 32767; größere Werte laufen über), / schneidet ab (IDIV),
 *           % hat das Vorzeichen des Dividenden.
 *   Text  = 256 Byte: Längenbyte + höchstens 255 Zeichen (UTF-8-Bytes werden unverändert ausgegeben).
 *   Array = auf dem Heap: Länge (Wort) + Elemente (Zahl: 2 Byte, Text: 256 Byte). Die Variable hält die Adresse.
 *
 *   Aufrufkonvention: Parameter von links nach rechts mit push auf den Stack; In-Zahl als Wert,
 *   In-Text als Adresse (das Unterprogramm kopiert ihn in den eigenen Rahmen), InOut und Arrays als Adresse.
 *   Text-Ergebnis: der Aufrufer legt vorher die Adresse eines Puffers ab (result zeigt dorthin).
 *   Zahl-Ergebnis kommt in AX zurück. Das Unterprogramm räumt die Parameter mit "ret n" ab.
 *   Rahmen: [bp+4…] Parameter, [bp-2] Heap-Marke, darunter Variablen und Hilfsspeicher (tmp_n, wrd_n);
 *   die Namen werden mit %define vergeben (v_name = bp-n), damit der Code lesbar bleibt.
 *   Registerverwendung: Ergebnis eines Ausdrucks in AX; Routinen der Laufzeitbibliothek erhalten alle
 *   Register außer ihren Ergebnisregistern.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip, walk } = BBE.expr;
  const A = BBE.analyze;

  const TAB = '        ';
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const INV = { e: 'ne', ne: 'e', l: 'ge', ge: 'l', le: 'g', g: 'le' };
  const CC = { '==': 'e', '!=': 'ne', '<': 'l', '<=': 'le', '>': 'g', '>=': 'ge' };
  const STRSIZE = 256;

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const utf8 = (s) => (typeof TextEncoder !== 'undefined' ? Array.from(new TextEncoder().encode(s)) : Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)));
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /** Bezeichner für NASM: nur ASCII-Buchstaben, Ziffern und _. */
  function asciiName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    return s || 'x';
  }

  /** Zahl → 16-Bit-Wert mit Vorzeichen (Kommastellen fallen weg, wie in C). */
  function word(v) {
    let x = Math.trunc(Number(v) || 0) % 65536;
    if (x < 0) x += 65536;
    return x >= 32768 ? x - 65536 : x;
  }

  /** Bytes eines Textes als NASM-db-Liste (druckbare ASCII-Zeichen und UTF-8 in "…", Rest als Zahl). */
  function dbList(bytes) {
    const out = [];
    let cur = [];
    const flush = () => { if (cur.length) out.push('"' + Buffer_from(cur) + '"'); cur = []; };
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 32 && b !== 34 && b !== 127) cur.push(b);
      else { flush(); out.push(String(b)); }
    }
    flush();
    return out;
  }
  // UTF-8-Bytes wieder als JS-Text (für die Quelldatei, die als UTF-8 gespeichert wird)
  function Buffer_from(bytes) {
    try { return decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join('')); } catch (e) {
      return bytes.map((b) => String.fromCharCode(b)).join('');
    }
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const kw = (k) => tr('kw.' + k);
    const typeName = (t) => tr('type.' + t);

    // ------------------------------------------------------------ Texte (Daten)
    const lits = new Map();
    function lit(s) {
      s = String(s);
      if (!lits.has(s)) {
        let bytes = utf8(s);
        // höchstens 255 Bytes, keine halben UTF-8-Zeichen
        if (bytes.length > 255) { bytes = bytes.slice(0, 255); while (bytes.length && (bytes[bytes.length - 1] & 0xC0) === 0x80) bytes.pop(); if (bytes.length && bytes[bytes.length - 1] >= 0xC0) bytes.pop(); }
        lits.set(s, { label: 'txt_' + (lits.size + 1), bytes });
      }
      return lits.get(s).label;
    }
    const shortText = (s) => { const t = JSON.stringify(String(s)); return t.length > 40 ? t.slice(0, 37) + '…"' : t; };

    // ------------------------------------------------------------ Unterprogramm-Namen
    const procName = new Map();
    const usedProc = new Set();
    for (const f of program.fns) {
      if (f.isMain) { procName.set(f, 'main'); continue; }
      let n = 'fn_' + asciiName(f.name);
      while (usedProc.has(n)) n += '_';
      usedProc.add(n);
      procName.set(f, n);
    }
    const findFn = (name) => program.fns.find((f) => !f.isMain && f.name === name);

    // ------------------------------------------------------------ Ausgabezeilen
    const I = (ctx, ins, cmt) => ctx.lines.push(TAB + (cmt ? ins.padEnd(28) + '; ' + cmt : ins));
    const Lbl = (ctx, l, cmt) => ctx.lines.push(cmt ? (l + ':').padEnd(36) + '; ' + cmt : l + ':');
    const Cm = (ctx, text) => ctx.lines.push(TAB + '; ' + text);
    const newId = (ctx) => ++ctx.lab;

    /** springt nach target, wenn die Bedingung cc NICHT erfüllt ist (8086: bedingte Sprünge reichen nur ±127 Byte). */
    function jmpUnless(ctx, cc, target) {
      const ok = '.ok' + newId(ctx);
      I(ctx, 'j' + cc + ' ' + ok);
      I(ctx, 'jmp ' + target);
      Lbl(ctx, ok);
    }

    // ------------------------------------------------------------ Typen (mit Hilfsfeldern slot/sslot)
    function ty(ctx, a) {
      if (!a) return '?';
      switch (a.k) {
        case 'slot': return 'integer';
        case 'sslot': return 'string';
        case 'num': return 'integer';
        case 'str': return 'string';
        case 'paren': return ty(ctx, a.e);
        case 'id': { const v = ctx.scope.get(a.name); return v ? v.type : '?'; }
        case 'idx': return A.elemType(ty(ctx, a.obj));
        case 'len': return 'integer';
        case 'un': return a.op === '!' ? 'bool' : 'integer';
        case 'bin': {
          if (a.op === '+') {
            const x = ty(ctx, a.a), y = ty(ctx, a.b);
            if (x === 'string' || y === 'string') return 'string';
            if (x === '?' || y === '?') return '?';
            return 'integer';
          }
          if ('-*/%'.includes(a.op)) return 'integer';
          return 'bool';
        }
        default: return '?';
      }
    }

    // ------------------------------------------------------------ Hilfsspeicher (pro Anweisung neu gezählt)
    function tmpStr(ctx) { ctx.tcnt++; ctx.tmax = Math.max(ctx.tmax, ctx.tcnt); return 'tmp_' + ctx.tcnt; }
    function tmpWord(ctx) { ctx.wcnt++; ctx.wmax = Math.max(ctx.wmax, ctx.wcnt); return 'wrd_' + ctx.wcnt; }

    const varOf = (ctx, name) => ctx.vars.get(name);

    // ------------------------------------------------------------ Texte: Adressen und Aufbau

    /** einfacher Text: Literal, Text-Variable oder Hilfspuffer – Adresse ohne Nebenwirkungen in jedes Register */
    function isSimpleStr(ctx, a) {
      const s = strip(a);
      if (!s) return false;
      if (s.k === 'str' || s.k === 'sslot') return true;
      if (s.k === 'id') { const v = varOf(ctx, s.name); return !!v && v.type === 'string' && (v.mode === 'buf' || v.mode === 'ref'); }
      return false;
    }
    function strSimple(ctx, a, reg) {
      const s = strip(a);
      if (s.k === 'str') { I(ctx, 'mov ' + reg + ', ' + lit(s.v), shortText(s.v)); return; }
      if (s.k === 'sslot') { I(ctx, 'lea ' + reg + ', [' + s.def + ']'); return; }
      const v = varOf(ctx, s.name);
      if (v.mode === 'ref') I(ctx, 'mov ' + reg + ', [' + v.def + ']', s.name + ' (' + tr('asmAddr') + ')');
      else I(ctx, 'lea ' + reg + ', [' + v.def + ']', s.name);
    }

    /** Adresse eines Text-Ausdrucks nach SI (zusammengesetzte Texte werden in einem Hilfspuffer gebaut). */
    function strOperand(ctx, a) {
      const s = strip(a);
      if (isSimpleStr(ctx, s)) { strSimple(ctx, s, 'si'); return; }
      if (s.k === 'idx' && ty(ctx, s) === 'string') { elemAddr(ctx, s); I(ctx, 'mov si, bx'); return; }
      const t = tmpStr(ctx);
      buildStr(ctx, s, t);
      I(ctx, 'lea si, [' + t + ']');
    }

    /** Teile einer Text-Verkettung von links nach rechts. */
    function parts(ctx, ast) {
      const s = strip(ast);
      if (s && s.k === 'bin' && s.op === '+' && ty(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [s];
    }

    /** Text-Ausdruck in den Rahmen-Puffer dst bauen (dst = Name aus %define). from = erster Teil, der angehängt wird. */
    function buildStr(ctx, ast, dst, from = 0) {
      const ps = ast ? parts(ctx, ast) : [];
      let diOk = false;
      const di = () => { if (!diOk) I(ctx, 'lea di, [' + dst + ']'); diOk = true; };
      if (from === 0) { di(); I(ctx, 'mov byte [di], 0', tr('asmEmpty')); }
      for (const p of ps.slice(from)) {
        const t = ty(ctx, p);
        if (t === 'string' && isSimpleStr(ctx, p)) { strSimple(ctx, p, 'si'); di(); I(ctx, 'call str_append'); }
        else if (t === 'string') { strOperand(ctx, p); diOk = false; di(); I(ctx, 'call str_append'); }
        else if (t === 'bool') { boolValue(ctx, p); diOk = false; di(); I(ctx, 'call str_append_bool'); }
        else {
          const simple = p.k === 'num' || p.k === 'slot' || (p.k === 'id' && varOf(ctx, p.name) && varOf(ctx, p.name).mode !== 'buf');
          num(ctx, p);
          if (!simple) diOk = false;
          di();
          I(ctx, 'call str_append_num');
        }
      }
    }

    const mentions = (ast, name) => { let hit = false; walk(ast, (x) => { if (x.k === 'id' && x.name === name) hit = true; }); return hit; };

    // ------------------------------------------------------------ Zahlen

    /** Operand, der direkt in einem Befehl stehen kann (Konstante oder Wort im Rahmen). */
    function simpleOperand(ctx, a) {
      const s = strip(a);
      if (!s) return null;
      if (s.k === 'num') return String(word(s.v));
      if (s.k === 'slot') return 'word [' + s.def + ']';
      if (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num') return String(word(-strip(s.a).v));
      if (s.k === 'id') { const v = varOf(ctx, s.name); if (v && v.type === 'integer' && v.mode === 'val') return 'word [' + v.def + ']'; }
      return null;
    }

    /** Kommazahl-Literal als gekürzter Bruch { p, q } (beide 16 Bit), sonst null */
    function frac(a) {
      const s = strip(a);
      if (!s || s.k !== 'num' || Number.isInteger(s.v)) return null;
      let q = 1;
      while (!Number.isInteger(Math.round(s.v * q * 1e9) / 1e9) && q < 10000) q *= 10;
      let p = Math.round(s.v * q);
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      const g = gcd(Math.abs(p), q) || 1;
      p /= g; q /= g;
      if (Math.abs(p) > 32767 || p === 0) return null;
      return { p, q, raw: s.raw };
    }

    /** Zahl-Ausdruck → AX */
    function num(ctx, a) {
      const s = strip(a);
      if (!s) { I(ctx, 'xor ax, ax'); return; }
      const t = ty(ctx, s);
      if (t === 'string') { strOperand(ctx, s); I(ctx, 'call str_to_num', tr('asmTextToNum')); return; }
      if (t === 'bool') { boolValue(ctx, s); return; }
      switch (s.k) {
        case 'num': I(ctx, 'mov ax, ' + word(s.v)); return;
        case 'slot': I(ctx, 'mov ax, [' + s.def + ']'); return;
        case 'id': {
          const v = varOf(ctx, s.name);
          if (!v || A.isArrayType(v.type)) { I(ctx, 'xor ax, ax', '? ' + s.name); return; }
          if (v.mode === 'ref') { I(ctx, 'mov bx, [' + v.def + ']', s.name + ' (' + tr('asmAddr') + ')'); I(ctx, 'mov ax, [bx]'); }
          else I(ctx, 'mov ax, [' + v.def + ']', s.name);
          return;
        }
        case 'idx': elemAddr(ctx, s); I(ctx, 'mov ax, [bx]'); return;
        case 'len': {
          const o = strip(s.obj);
          if (A.isArrayType(ty(ctx, o))) { arrPtr(ctx, o); I(ctx, 'mov ax, [bx]', tr('asmLength')); return; }
          strOperand(ctx, o);
          I(ctx, 'mov al, [si]', tr('asmLength'));
          I(ctx, 'mov ah, 0');
          return;
        }
        case 'un':
          num(ctx, s.a);
          if (s.op === '-') I(ctx, 'neg ax');
          return;
        case 'bin': {
          // Kommazahl als Faktor (x * 1.25, x / 2.5): als Bruch p/q mit 32-Bit-Zwischenergebnis (DX:AX), wie (int) in C
          const fb = frac(s.b), fa = frac(s.a);
          if ((s.op === '*' && (fa || fb)) || (s.op === '/' && fb)) {
            const f = s.op === '*' ? (fb || fa) : fb;
            num(ctx, s.op === '*' && !fb ? s.b : s.a);
            const [m, d] = s.op === '*' ? [f.p, f.q] : [f.q, f.p];
            I(ctx, 'mov bx, ' + m);
            I(ctx, 'imul bx', 'dx:ax = ax * ' + m);
            I(ctx, 'mov bx, ' + d);
            I(ctx, 'idiv bx', 'ax = dx:ax / ' + d + '  (' + (s.op === '*' ? '* ' : '/ ') + f.raw + ')');
            return;
          }
          num(ctx, s.a);
          const so = simpleOperand(ctx, s.b);
          if ((s.op === '+' || s.op === '-') && so) { I(ctx, (s.op === '+' ? 'add' : 'sub') + ' ax, ' + so); return; }
          if (so) I(ctx, 'mov bx, ' + so);
          else { I(ctx, 'push ax'); num(ctx, s.b); I(ctx, 'mov bx, ax'); I(ctx, 'pop ax'); }
          switch (s.op) {
            case '+': I(ctx, 'add ax, bx'); return;
            case '-': I(ctx, 'sub ax, bx'); return;
            case '*': I(ctx, 'imul bx', 'dx:ax = ax * bx'); return;
            case '/': I(ctx, 'call num_div', 'ax = ax / bx'); return;
            case '%': I(ctx, 'call num_div', 'dx = ax % bx'); I(ctx, 'mov ax, dx'); return;
            default: I(ctx, 'xor ax, ax'); return;
          }
        }
        default: I(ctx, 'xor ax, ax'); return;
      }
    }

    /** Wahrheitswert → AX (1 = true, 0 = false) */
    function boolValue(ctx, a) {
      const id = newId(ctx);
      cjump(ctx, a, '.f' + id, false);
      I(ctx, 'mov ax, 1');
      I(ctx, 'jmp short .b' + id);
      Lbl(ctx, '.f' + id);
      I(ctx, 'xor ax, ax');
      Lbl(ctx, '.b' + id);
    }

    /** Vergleich: setzt die Flags, liefert die Sprungbedingung für "wahr". */
    function compare(ctx, s) {
      const ta = ty(ctx, s.a), tb = ty(ctx, s.b);
      if (ta === 'string' && tb === 'string') {
        if (isSimpleStr(ctx, s.b)) { strOperand(ctx, s.a); strSimple(ctx, s.b, 'di'); }
        else { strOperand(ctx, s.b); I(ctx, 'push si'); strOperand(ctx, s.a); I(ctx, 'pop di'); }
        I(ctx, 'call str_cmp', tr('asmCmp'));
        I(ctx, 'cmp ax, 0');
        return CC[s.op];
      }
      num(ctx, s.a);
      const so = simpleOperand(ctx, s.b);
      if (so) I(ctx, 'cmp ax, ' + so);
      else { I(ctx, 'push ax'); num(ctx, s.b); I(ctx, 'mov bx, ax'); I(ctx, 'pop ax'); I(ctx, 'cmp ax, bx'); }
      return CC[s.op];
    }

    /** Springt nach label, wenn der Wahrheitswert von a gleich when ist; sonst geht es weiter. */
    function cjump(ctx, a, label, when) {
      const s = strip(a);
      if (!s) { if (!when) return; I(ctx, 'jmp ' + label); return; }
      if (s.k === 'un' && s.op === '!') { cjump(ctx, s.a, label, !when); return; }
      if (s.k === 'bin' && (s.op === '&&' || s.op === '||')) {
        const and = s.op === '&&';
        if (and !== when) { cjump(ctx, s.a, label, when); cjump(ctx, s.b, label, when); return; }
        const skip = '.s' + newId(ctx);
        cjump(ctx, s.a, skip, !when);
        cjump(ctx, s.b, label, when);
        Lbl(ctx, skip);
        return;
      }
      let cc;
      if (s.k === 'bin' && CC[s.op]) cc = compare(ctx, s);
      else if (ty(ctx, s) === 'string') { strOperand(ctx, s); I(ctx, 'cmp byte [si], 0', tr('asmNotEmpty')); cc = 'ne'; }
      else { num(ctx, s); I(ctx, 'cmp ax, 0'); cc = 'ne'; }
      jmpUnless(ctx, when ? INV[cc] : cc, label);
    }

    // ------------------------------------------------------------ Arrays und Ziele

    /** Adresse des Arrays (Kopf: Länge) nach BX */
    function arrPtr(ctx, o) {
      const v = o && o.k === 'id' ? varOf(ctx, o.name) : null;
      if (!v || v.mode !== 'arr') { I(ctx, 'xor bx, bx', '?'); return; }
      I(ctx, 'mov bx, [' + v.def + ']', o.name);
    }

    /** Adresse von a[i] nach BX (mit Prüfung der Grenzen) */
    function elemAddr(ctx, s) {
      num(ctx, s.index);
      const o = strip(s.obj);
      arrPtr(ctx, o);
      const t = ty(ctx, o);
      I(ctx, 'call ' + (t === 'string[]' ? 'arr_text_elem' : 'arr_num_elem'), 'bx = &' + (o.name || '?') + '[ax]');
    }

    /** Adresse eines Ziels (Variable oder Element) in reg */
    function dstAddr(ctx, tgt, reg) {
      if (tgt.k === 'idx') { elemAddr(ctx, tgt); if (reg !== 'bx') I(ctx, 'mov ' + reg + ', bx'); return; }
      const v = varOf(ctx, tgt.name);
      if (!v) { I(ctx, 'mov ' + reg + ', scratch', '? ' + tgt.name); return; }
      if (v.mode === 'ref') I(ctx, 'mov ' + reg + ', [' + v.def + ']', tgt.name + ' (' + tr('asmAddr') + ')');
      else I(ctx, 'lea ' + reg + ', [' + v.def + ']', tgt.name);
    }

    /** AX in ein Zahl-Ziel schreiben */
    function storeNum(ctx, tgt) {
      if (tgt.k === 'id') {
        const v = varOf(ctx, tgt.name);
        if (!v) { Cm(ctx, '? ' + tgt.name); return; }
        if (v.mode === 'ref') { I(ctx, 'mov bx, [' + v.def + ']', tgt.name + ' (' + tr('asmAddr') + ')'); I(ctx, 'mov [bx], ax'); }
        else I(ctx, 'mov [' + v.def + '], ax', tgt.name);
        return;
      }
      I(ctx, 'push ax');
      elemAddr(ctx, tgt);
      I(ctx, 'pop ax');
      I(ctx, 'mov [bx], ax');
    }

    /** Text-Ausdruck in ein Text-Ziel schreiben */
    function storeStr(ctx, tgt, expr) {
      const v = tgt.k === 'id' ? varOf(ctx, tgt.name) : null;
      if (tgt.k === 'id' && !v) { Cm(ctx, '? ' + tgt.name); return; }
      if (v && v.mode === 'buf') {
        if (!expr) { I(ctx, 'mov byte [' + v.def + '], 0'); return; }
        if (isSimpleStr(ctx, expr)) { strSimple(ctx, expr, 'si'); I(ctx, 'lea di, [' + v.def + ']', tgt.name); I(ctx, 'call str_copy'); return; }
        const ps = ty(ctx, expr) === 'string' ? parts(ctx, expr) : [];
        if (ps.length > 1 && ps[0].k === 'id' && ps[0].name === tgt.name && !ps.slice(1).some((p) => mentions(p, tgt.name))) {
          buildStr(ctx, expr, v.def, 1);   // s = s + … → direkt anhängen
          return;
        }
        if (!mentions(expr, tgt.name)) { buildStr(ctx, expr, v.def); return; }
        const t = tmpStr(ctx);
        buildStr(ctx, expr, t);
        I(ctx, 'lea si, [' + t + ']');
        I(ctx, 'lea di, [' + v.def + ']', tgt.name);
        I(ctx, 'call str_copy');
        return;
      }
      // InOut-Text, result oder Array-Element: erst fertig bauen, dann kopieren
      if (expr && isSimpleStr(ctx, expr)) {
        strSimple(ctx, expr, 'si');
        if (tgt.k === 'idx') { I(ctx, 'push si'); dstAddr(ctx, tgt, 'di'); I(ctx, 'pop si'); } else dstAddr(ctx, tgt, 'di');
        I(ctx, 'call str_copy');
        return;
      }
      const t = tmpStr(ctx);
      buildStr(ctx, expr, t);
      dstAddr(ctx, tgt, 'di');
      I(ctx, 'lea si, [' + t + ']');
      I(ctx, 'call str_copy');
    }

    /** Zuweisung ziel = ausdruck (Typ des Ziels entscheidet) */
    function assignTo(ctx, tgt, expr) {
      if (!tgt) { Cm(ctx, '?'); return; }
      const tt = ty(ctx, tgt);
      if (tt === 'string') storeStr(ctx, tgt, expr);
      else if (A.isArrayType(tt)) Cm(ctx, '?');
      else { num(ctx, expr); storeNum(ctx, tgt); }
    }

    /** Ausgabe ohne Zwischenpuffer: jeden Teil einzeln ausgeben */
    function printParts(ctx, ast) {
      for (const p of parts(ctx, ast)) {
        const t = ty(ctx, p);
        if (t === 'string') { strOperand(ctx, p); I(ctx, 'call print_str'); }
        else if (t === 'bool') { boolValue(ctx, p); I(ctx, 'call print_bool'); }
        else { num(ctx, p); I(ctx, 'call print_num'); }
      }
    }

    // ------------------------------------------------------------ Anweisungen

    function seq(ctx, list) { for (const n of list || []) genStmt(ctx, n); }

    function genStmt(ctx, n) {
      ctx.tcnt = 0;
      ctx.wcnt = 0;
      if (n.kind !== 'comment') ctx.lines.push('');
      if (n.comment && n.kind !== 'comment') Cm(ctx, oneLine(n.comment));
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) Cm(ctx, l);
          return;
        case 'decl': {
          const isArr = A.isArrayType(n.vtype);
          Cm(ctx, kw('decl') + ' ' + typeName(n.vtype) + ' ' + (n.name || '?') + (isArr ? '[' + oneLine(n.length) + ']' : ' = ' + oneLine(n.init)));
          const v = varOf(ctx, n.name);
          if (!v) return;
          if (isArr) {
            if (v.mode !== 'arr') return;
            num(ctx, tryParse(n.length));
            I(ctx, 'mov cx, ' + (n.vtype === 'string[]' ? STRSIZE : 2), tr('asmElemSize'));
            I(ctx, 'mov bx, [' + v.def + ']', tr('asmOldArray'));
            I(ctx, 'call arr_new');
            I(ctx, 'mov [' + v.def + '], bx', n.name);
            return;
          }
          assignTo(ctx, { k: 'id', name: n.name }, tryParse(n.init));
          return;
        }
        case 'assign':
          Cm(ctx, oneLine(n.target) + ' = ' + oneLine(n.expr));
          assignTo(ctx, tryTarget(n.target), tryParse(n.expr));
          return;
        case 'input': {
          Cm(ctx, kw('input') + ' ' + (oneLine(n.prompt) ? oneLine(n.prompt) + ' → ' : '') + oneLine(n.target));
          const tgt = tryTarget(n.target);
          if (!tgt) return;
          const p = tryParse(n.prompt);
          if (ty(ctx, tgt) === 'string') {
            if (p) printParts(ctx, p);
            dstAddr(ctx, tgt, 'di');
            I(ctx, 'call read_line', tr('asmReadLine'));
          } else {
            if (!p) I(ctx, 'xor si, si');
            else if (isSimpleStr(ctx, p)) strSimple(ctx, p, 'si');
            else { const t = tmpStr(ctx); buildStr(ctx, p, t); I(ctx, 'lea si, [' + t + ']'); }
            I(ctx, 'call read_num', tr('asmReadNum'));
            storeNum(ctx, tgt);
          }
          return;
        }
        case 'output': {
          Cm(ctx, kw('output') + ' ' + oneLine(n.expr));
          const ast = tryParse(n.expr);
          if (ast) printParts(ctx, ast);
          I(ctx, 'call print_newline');
          return;
        }
        case 'if': {
          const id = newId(ctx);
          const hasElse = n.else && n.else.length;
          Cm(ctx, kw('if') + ' ' + oneLine(n.cond));
          cjump(ctx, tryParse(n.cond), hasElse ? '.if' + id + '_else' : '.if' + id + '_end', false);
          seq(ctx, n.then);
          if (hasElse) {
            I(ctx, 'jmp .if' + id + '_end');
            Lbl(ctx, '.if' + id + '_else', kw('else'));
            seq(ctx, n.else);
          }
          Lbl(ctx, '.if' + id + '_end');
          return;
        }
        case 'while': {
          const id = newId(ctx);
          Lbl(ctx, '.while' + id, kw('while') + ' ' + oneLine(n.cond));
          cjump(ctx, tryParse(n.cond), '.while' + id + '_end', false);
          seq(ctx, n.body);
          I(ctx, 'jmp .while' + id);
          Lbl(ctx, '.while' + id + '_end');
          return;
        }
        case 'until': {
          const id = newId(ctx);
          Lbl(ctx, '.repeat' + id, kw('until'));
          seq(ctx, n.body);
          ctx.tcnt = 0;
          ctx.wcnt = 0;
          ctx.lines.push('');
          Cm(ctx, kw('untilFoot') + ' ' + oneLine(n.cond));
          cjump(ctx, tryParse(n.cond), '.repeat' + id, false);
          return;
        }
        case 'for': {
          const id = newId(ctx);
          const L = '.for' + id;
          Cm(ctx, kw('for') + ' ' + oneLine(n.counter) + ' ' + kw('forFrom') + ' ' + oneLine(n.from) + ' ' + kw('forTo') + ' ' + oneLine(n.to) + ' ' + kw('forStep') + ' ' + oneLine(n.step));
          const k = tryTarget(n.counter);
          if (!k) return;
          num(ctx, tryParse(n.from));
          storeNum(ctx, k);
          const stepAst = tryParse(n.step) || { k: 'num', v: 1, raw: '1' };
          const to = tryParse(n.to);
          const lv = A.literalValue(stepAst);
          // Bedingung bei jedem Durchlauf neu prüfen (Ende kann sich ändern, wie in C)
          const test = (cc) => {
            num(ctx, to);
            I(ctx, 'push ax', kw('forTo'));
            num(ctx, k);
            I(ctx, 'pop bx');
            I(ctx, 'cmp ax, bx');
            jmpUnless(ctx, cc, L + '_end');
          };
          Lbl(ctx, L);
          if (typeof lv === 'number') test(lv >= 0 ? 'le' : 'ge');
          else {
            num(ctx, stepAst);
            I(ctx, 'cmp ax, 0', kw('forStep') + ' < 0 ?');
            jmpUnless(ctx, 'ge', L + '_down');
            test('le');
            I(ctx, 'jmp ' + L + '_body');
            Lbl(ctx, L + '_down');
            test('ge');
            Lbl(ctx, L + '_body');
          }
          seq(ctx, n.body);
          ctx.tcnt = 0;
          ctx.wcnt = 0;
          ctx.lines.push('');
          const kv = k.k === 'id' && varOf(ctx, k.name) && varOf(ctx, k.name).mode === 'val' ? varOf(ctx, k.name) : null;
          if (typeof lv === 'number') Cm(ctx, oneLine(n.counter) + ' = ' + oneLine(n.counter) + (lv < 0 ? ' - ' + word(-lv) : ' + ' + word(lv)));
          else Cm(ctx, oneLine(n.counter) + ' = ' + oneLine(n.counter) + ' + (' + oneLine(n.step) + ')');
          if (kv && lv === 1) I(ctx, 'inc word [' + kv.def + ']', k.name);
          else if (kv && lv === -1) I(ctx, 'dec word [' + kv.def + ']', k.name);
          else if (kv && typeof lv === 'number') I(ctx, 'add word [' + kv.def + '], ' + word(lv), k.name);
          else if (kv) { num(ctx, stepAst); I(ctx, 'add [' + kv.def + '], ax', k.name); }
          else { num(ctx, stepAst); I(ctx, 'push ax'); num(ctx, k); I(ctx, 'pop bx'); I(ctx, 'add ax, bx'); storeNum(ctx, k); }
          I(ctx, 'jmp ' + L);
          Lbl(ctx, L + '_end');
          return;
        }
        case 'switch': {
          const id = newId(ctx);
          const L = '.switch' + id;
          Cm(ctx, kw('switch') + ' ' + oneLine(n.expr));
          let sel = tryParse(n.expr);
          if (sel && !isSimpleStr(ctx, sel) && !simpleOperand(ctx, sel)) {
            // Wert einmal berechnen und merken
            if (ty(ctx, sel) === 'string') { const t = tmpStr(ctx); buildStr(ctx, sel, t); sel = { k: 'sslot', def: t }; }
            else { const w = tmpWord(ctx); num(ctx, sel); I(ctx, 'mov [' + w + '], ax'); sel = { k: 'slot', def: w }; }
          }
          n.cases.forEach((c, i) => {
            const next = L + '_' + (i + 1);
            ctx.lines.push('');
            Cm(ctx, kw('case') + ' ' + oneLine(c.value));
            const v = tryParse(c.value);
            if (sel && v) cjump(ctx, { k: 'bin', op: '==', a: sel, b: v }, next, false);
            seq(ctx, c.body);
            I(ctx, 'jmp ' + L + '_end');
            Lbl(ctx, next);
          });
          if (n.else) { Cm(ctx, kw('else')); seq(ctx, n.else); }
          Lbl(ctx, L + '_end');
          return;
        }
        case 'call': {
          const callee = findFn(n.fn);
          Cm(ctx, kw('call') + ' ' + (n.target && n.target.trim() && callee && callee.returnType !== 'void' ? oneLine(n.target) + ' = ' : '') + (n.fn || '?') + '(' + (n.args || []).map(oneLine).join(', ') + ')');
          if (!callee) return;
          let res = null;
          if (callee.returnType === 'string') {
            res = tmpStr(ctx);
            I(ctx, 'lea ax, [' + res + ']', tr('asmResultBuf'));
            I(ctx, 'push ax');
          }
          callee.params.forEach((p, i) => {
            const src = (n.args || [])[i] || '';
            const pn = p.name || '?';
            if (A.isArrayType(p.type)) {
              const t = tryTarget(src);
              const v = t && t.k === 'id' ? varOf(ctx, t.name) : null;
              if (v && v.mode === 'arr') I(ctx, 'push word [' + v.def + ']', pn + ' = ' + t.name);
              else { I(ctx, 'xor ax, ax'); I(ctx, 'push ax'); }
              return;
            }
            if (p.byRef) {
              const t = tryTarget(src);
              if (t && (t.k === 'idx' || varOf(ctx, t.name))) {
                if (t.k === 'id' && varOf(ctx, t.name).mode === 'ref') I(ctx, 'push word [' + varOf(ctx, t.name).def + ']', pn + ' = ' + t.name + ' (' + tr('asmAddr') + ')');
                else { dstAddr(ctx, t, 'ax'); I(ctx, 'push ax', pn + ' = &' + oneLine(src)); }
              } else {
                // kein Ziel: Wert in einen Hilfsspeicher legen und dessen Adresse übergeben
                if (p.type === 'string') { const tt = tmpStr(ctx); buildStr(ctx, tryParse(src), tt); I(ctx, 'lea ax, [' + tt + ']'); }
                else { const w = tmpWord(ctx); num(ctx, tryParse(src)); I(ctx, 'mov [' + w + '], ax'); I(ctx, 'lea ax, [' + w + ']'); }
                I(ctx, 'push ax');
              }
              return;
            }
            const ast = tryParse(src);
            if (p.type === 'string') {
              if (ast && isSimpleStr(ctx, ast)) { strSimple(ctx, ast, 'ax'); I(ctx, 'push ax', pn); }
              else { const tt = tmpStr(ctx); buildStr(ctx, ast, tt); I(ctx, 'lea ax, [' + tt + ']'); I(ctx, 'push ax', pn); }
              return;
            }
            const so = simpleOperand(ctx, ast);
            if (so && so.startsWith('word')) { I(ctx, 'push ' + so, pn); return; }
            num(ctx, ast);
            I(ctx, 'push ax', pn);
          });
          I(ctx, 'call ' + procName.get(callee));
          if (callee.returnType !== 'void' && n.target && n.target.trim()) {
            const tgt = tryTarget(n.target);
            if (!tgt) return;
            if (callee.returnType === 'string') assignTo(ctx, tgt, { k: 'sslot', def: res });
            else if (ty(ctx, tgt) === 'string') { const w = tmpWord(ctx); I(ctx, 'mov [' + w + '], ax', tr('asmResult')); assignTo(ctx, tgt, { k: 'slot', def: w }); }
            else storeNum(ctx, tgt);
          }
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Unterprogramme
    const procs = [];

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const ctx = { fn, scope, vars: new Map(), lines: [], lab: 0, tcnt: 0, tmax: 0, wcnt: 0, wmax: 0 };
      const defs = [];
      const taken = new Set();
      const defName = (prefix, n) => {
        let d = prefix + asciiName(n);
        while (taken.has(d)) d += '_';
        taken.add(d);
        return d;
      };
      let frame = 2;
      const local = (size) => { frame += size; return 'bp-' + frame; };
      const np = fn.params.length;
      const hidden = !fn.isMain && fn.returnType === 'string';
      const copies = [];
      const kindText = (p) => (A.isArrayType(p.type) ? tr('asmAddr') : p.byRef ? 'InOut, ' + tr('asmAddr') : 'In');

      fn.params.forEach((p, i) => {
        if (!p.name || ctx.vars.has(p.name)) return;
        const at = 'bp+' + (4 + 2 * (np - 1 - i));
        const d = defName('v_', p.name);
        if (A.isArrayType(p.type)) { ctx.vars.set(p.name, { type: p.type, mode: 'arr', def: d }); defs.push([d, at, p.name + ': ' + typeName(p.type) + ' (' + kindText(p) + ')']); }
        else if (p.byRef) { ctx.vars.set(p.name, { type: p.type, mode: 'ref', def: d }); defs.push([d, at, p.name + ': ' + typeName(p.type) + ' (' + kindText(p) + ')']); }
        else if (p.type === 'string') {
          const pd = defName('p_', p.name);
          defs.push([pd, at, p.name + ': ' + typeName(p.type) + ' (In, ' + tr('asmAddr') + ')']);
          ctx.vars.set(p.name, { type: 'string', mode: 'buf', def: d });
          defs.push([d, local(STRSIZE), p.name + ': ' + tr('asmCopy')]);
          copies.push([pd, d, p.name]);
        } else { ctx.vars.set(p.name, { type: p.type, mode: 'val', def: d }); defs.push([d, at, p.name + ': ' + typeName(p.type) + ' (In)']); }
      });
      if (!fn.isMain && fn.returnType !== 'void') {
        const d = defName('v_', 'result');
        if (fn.returnType === 'string') { ctx.vars.set('result', { type: 'string', mode: 'ref', def: d }); defs.push([d, 'bp+' + (4 + 2 * np), 'result: ' + typeName('string') + ' (' + tr('asmAddr') + ')']); }
        else { ctx.vars.set('result', { type: 'integer', mode: 'val', def: d }); defs.push([d, local(2), 'result: ' + typeName('integer')]); }
      }
      for (const [n, v] of scope) {
        if (v.kind !== 'decl' || ctx.vars.has(n)) continue;
        const d = defName('v_', n);
        if (A.isArrayType(v.type)) { ctx.vars.set(n, { type: v.type, mode: 'arr', def: d }); defs.push([d, local(2), n + ': ' + typeName(v.type) + ' (' + tr('asmAddr') + ')']); }
        else if (v.type === 'string') { ctx.vars.set(n, { type: 'string', mode: 'buf', def: d }); defs.push([d, local(STRSIZE), n + ': ' + typeName('string')]); }
        else { ctx.vars.set(n, { type: 'integer', mode: 'val', def: d }); defs.push([d, local(2), n + ': ' + typeName('integer')]); }
      }

      // Rumpf erzeugen (danach ist bekannt, wie viel Hilfsspeicher nötig ist)
      if (!fn.isMain && fn.returnType !== 'void') {
        ctx.lines.push('');
        Cm(ctx, 'result = ' + oneLine(fn.resultInit));
        assignTo(ctx, { k: 'id', name: 'result' }, tryParse(fn.resultInit));
      }
      seq(ctx, fn.body);
      for (let i = 1; i <= ctx.wmax; i++) defs.push(['wrd_' + i, local(2), tr('asmTemp')]);
      for (let i = 1; i <= ctx.tmax; i++) defs.push(['tmp_' + i, local(STRSIZE), tr('asmTemp')]);
      if (frame % 2) frame++;

      const name = procName.get(fn);
      const head = [];
      const sig = fn.isMain ? tr('fn.main') : tr('fn.sub') + ' ' + fn.name + '(' + fn.params.map((p) => (p.byRef && !A.isArrayType(p.type) ? 'InOut ' : '') + (p.name || '?') + ': ' + typeName(p.type)).join(', ') + ')' +
        (fn.returnType !== 'void' ? ' → ' + typeName(fn.returnType) : '');
      head.push('; ' + '='.repeat(70), '; ' + sig, '; ' + '='.repeat(70));
      head.push('%define ' + 'hp_mark'.padEnd(14) + ' bp-2'.padEnd(10) + ' ; ' + tr('asmHeapMark'));
      for (const [d, at, c] of defs) head.push('%define ' + d.padEnd(14) + ' ' + at.padEnd(9) + ' ; ' + c);
      head.push('');
      head.push(name + ':');
      const H = (ins, c) => head.push(TAB + (c ? ins.padEnd(28) + '; ' + c : ins));
      H('push bp', tr('asmPrologue'));
      H('mov bp, sp');
      H('sub sp, ' + frame, tr('asmFrameSize'));
      H('call check_stack');
      H('mov di, sp');
      H('mov cx, ' + frame / 2);
      H('xor ax, ax');
      H('rep stosw', tr('asmZeroFrame'));
      H('mov ax, [heap_ptr]');
      H('mov [hp_mark], ax', tr('asmHeapMark'));
      for (const [pd, d, pn] of copies) {
        H('mov si, [' + pd + ']', pn + ': ' + tr('asmCopy'));
        H('lea di, [' + d + ']');
        H('call str_copy');
      }
      const tail = [''];
      const T = (ins, c) => tail.push(TAB + (c ? ins.padEnd(28) + '; ' + c : ins));
      T('mov ax, [hp_mark]', tr('asmEpilogue'));
      T('mov [heap_ptr], ax');
      if (!fn.isMain && fn.returnType === 'integer') T('mov ax, [' + ctx.vars.get('result').def + ']', 'result → ax');
      T('mov sp, bp');
      T('pop bp');
      const pbytes = 2 * (np + (hidden ? 1 : 0));
      T(pbytes ? 'ret ' + pbytes : 'ret', pbytes ? tr('asmRetN') : '');
      procs.push(head.concat(ctx.lines, tail).join('\n'));
    }

    const mainFn = program.fns.find((f) => f.isMain);
    genFunction(mainFn);
    for (const f of program.fns) if (!f.isMain) genFunction(f);

    // ------------------------------------------------------------ Zusammenbau
    lit('true'); lit('false');
    const out = [];
    out.push('; ' + tr('asmHeader1'));
    out.push('; ' + tr('asmHeader2'));
    out.push('; ' + tr('asmHeader3'));
    out.push('');
    out.push(TAB + 'cpu 8086');
    out.push(TAB + 'org 100h');
    out.push('');
    out.push('start:');
    out.push(TAB + 'cld'.padEnd(28) + '; ' + tr('asmStart'));
    out.push(TAB + 'call main');
    out.push(TAB + 'mov ax, 4C00h'.padEnd(28) + '; ' + tr('asmExit'));
    out.push(TAB + 'int 21h');
    out.push('');
    out.push(procs.join('\n\n'));
    out.push('');
    out.push(runtime(tr, lit));
    out.push('');
    out.push('; ' + '='.repeat(70));
    out.push('; ' + tr('asmData'));
    out.push('; ' + '='.repeat(70));
    for (const [, v] of lits) out.push((v.label + ':').padEnd(10) + 'db ' + [String(v.bytes.length)].concat(dbList(v.bytes)).join(', '));
    out.push('');
    out.push('heap_ptr:'.padEnd(14) + 'dw heap_start');
    out.push('heap_start:'.padEnd(36) + '; ' + tr('asmHeapStart'));
    return out.join('\n') + '\n';
  }

  // ------------------------------------------------------------ Laufzeitbibliothek
  function runtime(tr, lit) {
    const need = lit(tr('javaNeedInt'));
    const eMem = lit(tr('asmErrMemory'));
    const eDiv = lit(tr('asmErrDivZero'));
    const eIdx = lit(tr('asmErrIndex'));
    const crlf = lit('\r\n');
    const doc = (k) => '; ' + tr(k);
    return [
      '; ' + '='.repeat(70),
      '; ' + tr('asmRuntime'),
      '; ' + '='.repeat(70),
      '',
      doc('asmDocPrintStr'),
      'print_str:',
      '        push ax',
      '        push bx',
      '        push cx',
      '        push dx',
      '        mov cl, [si]',
      '        mov ch, 0',
      '        jcxz .done',
      '        lea dx, [si+1]',
      '        mov bx, 1                   ; handle 1 = stdout',
      '        mov ah, 40h',
      '        int 21h',
      '.done:  pop dx',
      '        pop cx',
      '        pop bx',
      '        pop ax',
      '        ret',
      '',
      doc('asmDocNewline'),
      'print_newline:',
      '        push si',
      '        mov si, ' + crlf,
      '        call print_str',
      '        pop si',
      '        ret',
      '',
      doc('asmDocPrintNum'),
      'print_num:',
      '        push si',
      '        push di',
      '        mov di, num_text',
      '        mov byte [di], 0',
      '        call str_append_num',
      '        mov si, di',
      '        call print_str',
      '        pop di',
      '        pop si',
      '        ret',
      '',
      doc('asmDocPrintBool'),
      'print_bool:',
      '        push si',
      '        mov si, ' + lit('false'),
      '        cmp ax, 0',
      '        je .p',
      '        mov si, ' + lit('true'),
      '.p:     call print_str',
      '        pop si',
      '        ret',
      '',
      doc('asmDocCopy'),
      'str_copy:',
      '        push cx',
      '        push si',
      '        push di',
      '        mov cl, [si]',
      '        mov ch, 0',
      '        inc cx',
      '        rep movsb',
      '        pop di',
      '        pop si',
      '        pop cx',
      '        ret',
      '',
      doc('asmDocAppend'),
      'str_append:',
      '        push ax',
      '        push bx',
      '        push cx',
      '        push si',
      '        push di',
      '        mov al, [di]',
      '        mov ah, 0                   ; ax = ' + tr('asmLength'),
      '        mov cl, [si]',
      '        mov ch, 0',
      '        mov bx, ax',
      '        add bx, cx',
      '        cmp bx, 255',
      '        jbe .fits',
      '        mov cx, 255',
      '        sub cx, ax                  ; max. 255',
      '.fits:  add [di], cl',
      '        add di, ax',
      '        inc di',
      '        inc si',
      '        rep movsb',
      '        pop di',
      '        pop si',
      '        pop cx',
      '        pop bx',
      '        pop ax',
      '        ret',
      '',
      doc('asmDocAppendNum'),
      'str_append_num:',
      '        push ax',
      '        push bx',
      '        push cx',
      '        push dx',
      '        push si',
      '        mov bx, ax                  ; ' + tr('asmSign'),
      '        cmp ax, 0',
      '        jge .pos',
      '        neg ax',
      '.pos:   mov si, num_digits_end',
      '        mov cx, 10',
      '.digit: xor dx, dx',
      '        div cx                      ; dx = ax % 10, ax = ax / 10',
      '        add dl, \'0\'',
      '        dec si',
      '        mov [si], dl',
      '        cmp ax, 0',
      '        jne .digit',
      '        cmp bx, 0',
      '        jge .len',
      '        dec si',
      '        mov byte [si], \'-\'',
      '.len:   mov ax, num_digits_end',
      '        sub ax, si',
      '        dec si',
      '        mov [si], al',
      '        call str_append',
      '        pop si',
      '        pop dx',
      '        pop cx',
      '        pop bx',
      '        pop ax',
      '        ret',
      '',
      doc('asmDocAppendBool'),
      'str_append_bool:',
      '        push si',
      '        mov si, ' + lit('false'),
      '        cmp ax, 0',
      '        je .a',
      '        mov si, ' + lit('true'),
      '.a:     call str_append',
      '        pop si',
      '        ret',
      '',
      doc('asmDocCmp'),
      'str_cmp:',
      '        push bx',
      '        push cx',
      '        push si',
      '        push di',
      '        mov bl, [si]',
      '        mov bh, [di]',
      '        mov cl, bl',
      '        cmp cl, bh',
      '        jbe .min',
      '        mov cl, bh',
      '.min:   mov ch, 0',
      '        inc si',
      '        inc di',
      '        jcxz .lens',
      '        repe cmpsb',
      '        jne .diff',
      '.lens:  cmp bl, bh',
      '        je .eq',
      '.diff:  jb .less',
      '        mov ax, 1',
      '        jmp short .done',
      '.less:  mov ax, -1',
      '        jmp short .done',
      '.eq:    xor ax, ax',
      '.done:  pop di',
      '        pop si',
      '        pop cx',
      '        pop bx',
      '        ret',
      '',
      doc('asmDocToNum'),
      'str_to_num:',
      '        push bx',
      '        push cx',
      '        push dx',
      '        push si',
      '        mov cl, [si]',
      '        mov ch, 0',
      '        inc si',
      '        xor bx, bx                  ; bx = ' + tr('genArgValue'),
      '        xor dx, dx                  ; dl = 1: -, dh = 1: ' + tr('asmDigits'),
      '.lead:  jcxz .end',
      '        cmp byte [si], \' \'',
      '        jne .sign',
      '        inc si',
      '        dec cx',
      '        jmp .lead',
      '.sign:  cmp byte [si], \'-\'',
      '        jne .plus',
      '        mov dl, 1',
      '        jmp short .skip',
      '.plus:  cmp byte [si], \'+\'',
      '        jne .digits',
      '.skip:  inc si',
      '        dec cx',
      '.digits: jcxz .end',
      '        mov al, [si]',
      '        cmp al, \' \'',
      '        je .trail',
      '        sub al, \'0\'',
      '        jb .bad',
      '        cmp al, 9',
      '        ja .bad',
      '        mov ah, 0',
      '        push dx',
      '        xchg ax, bx                 ; ax = ' + tr('genArgValue') + ', bx = ' + tr('asmDigits'),
      '        mov dx, 10',
      '        mul dx',
      '        pop dx',
      '        jc .bad',
      '        add ax, bx',
      '        jc .bad',
      '        mov bx, ax',
      '        cmp bx, 32768',
      '        ja .bad',
      '        mov dh, 1',
      '        inc si',
      '        dec cx',
      '        jmp .digits',
      '.trail: cmp byte [si], \' \'',
      '        jne .bad',
      '        inc si',
      '        dec cx',
      '        jcxz .end',
      '        jmp .trail',
      '.end:   cmp dh, 0',
      '        je .bad',
      '        cmp dl, 0',
      '        je .posv',
      '        neg bx',
      '        jmp short .ok',
      '.posv:  cmp bx, 32767',
      '        ja .bad',
      '.ok:    mov ax, bx',
      '        clc',
      '        jmp short .ret',
      '.bad:   xor ax, ax',
      '        stc',
      '.ret:   pop si',
      '        pop dx',
      '        pop cx',
      '        pop bx',
      '        ret',
      '',
      doc('asmDocReadLine'),
      'read_line:',
      '        push ax',
      '        push bx',
      '        push cx',
      '        push dx',
      '        push si',
      '        mov si, di',
      '        mov byte [si], 0',
      '.next:  mov ah, 3Fh',
      '        xor bx, bx                  ; handle 0 = stdin',
      '        mov cx, 1',
      '        mov dx, read_char',
      '        int 21h',
      '        jc .eof',
      '        cmp ax, 0',
      '        je .eof',
      '        mov al, [read_char]',
      '        cmp al, 10',
      '        je .done',
      '        cmp al, 13',
      '        je .next',
      '        cmp al, 26                  ; Ctrl-Z',
      '        je .eof',
      '        cmp byte [si], 255',
      '        jae .next',
      '        inc byte [si]',
      '        mov bl, [si]',
      '        mov bh, 0',
      '        mov [si+bx], al',
      '        jmp .next',
      '.eof:   cmp byte [si], 0',
      '        jne .done',
      '        stc',
      '        jmp short .ret',
      '.done:  clc',
      '.ret:   pop si',
      '        pop dx',
      '        pop cx',
      '        pop bx',
      '        pop ax',
      '        ret',
      '',
      doc('asmDocReadNum'),
      'read_num:',
      '        push di',
      '.again: cmp si, 0',
      '        je .read',
      '        call print_str',
      '.read:  mov di, line_buf',
      '        call read_line',
      '        jc .eof',
      '        push si',
      '        mov si, di',
      '        call str_to_num',
      '        pop si',
      '        jnc .ok',
      '        push si',
      '        mov si, ' + need,
      '        call print_str',
      '        call print_newline',
      '        pop si',
      '        jmp .again',
      '.eof:   xor ax, ax',
      '.ok:    pop di',
      '        ret',
      '',
      doc('asmDocDiv'),
      'num_div:',
      '        cmp bx, 0',
      '        je .zero',
      '        cmp bx, -1',
      '        jne .div',
      '        neg ax',
      '        xor dx, dx',
      '        ret',
      '.div:   cwd',
      '        idiv bx',
      '        ret',
      '.zero:  mov si, ' + eDiv,
      '        jmp fatal',
      '',
      doc('asmDocAlloc'),
      'heap_alloc:',
      '        push ax',
      '        push cx',
      '        push di',
      '        mov bx, [heap_ptr]',
      '        mov ax, bx',
      '        add ax, cx',
      '        jc .full',
      '        mov di, sp',
      '        sub di, 512',
      '        cmp ax, di',
      '        ja .full',
      '        mov [heap_ptr], ax',
      '        mov di, bx',
      '        mov al, 0',
      '        rep stosb',
      '        pop di',
      '        pop cx',
      '        pop ax',
      '        ret',
      '.full:  jmp out_of_memory',
      '',
      doc('asmDocArrNew'),
      'arr_new:',
      '        push ax',
      '        push cx',
      '        push dx',
      '        push di',
      '        cmp bx, 0',
      '        je .new',
      '        cmp [bx], ax',
      '        jne .new',
      '        mul cx                      ; ' + tr('asmReuse'),
      '        mov cx, ax',
      '        lea di, [bx+2]',
      '        mov al, 0',
      '        rep stosb',
      '        jmp short .done',
      '.new:   cmp ax, 0',
      '        jl .full',
      '        mov di, ax',
      '        mul cx',
      '        jc .full',
      '        add ax, 2',
      '        jc .full',
      '        mov cx, ax',
      '        call heap_alloc',
      '        mov [bx], di',
      '.done:  pop di',
      '        pop dx',
      '        pop cx',
      '        pop ax',
      '        ret',
      '.full:  jmp out_of_memory',
      '',
      doc('asmDocElem'),
      'arr_num_elem:',
      '        cmp bx, 0',
      '        je .bad',
      '        cmp ax, [bx]',
      '        jae .bad',
      '        push ax',
      '        shl ax, 1',
      '        add bx, ax',
      '        add bx, 2',
      '        pop ax',
      '        ret',
      '.bad:   jmp index_error',
      '',
      'arr_text_elem:',
      '        cmp bx, 0',
      '        je .bad',
      '        cmp ax, [bx]',
      '        jae .bad',
      '        push ax',
      '        mov ah, al',
      '        mov al, 0                   ; ax = ' + tr('asmIndex') + ' * 256',
      '        add bx, ax',
      '        add bx, 2',
      '        pop ax',
      '        ret',
      '.bad:   jmp index_error',
      '',
      doc('asmDocStack'),
      'check_stack:',
      '        push ax',
      '        mov ax, [heap_ptr]',
      '        add ax, 256',
      '        cmp sp, ax',
      '        pop ax',
      '        jae .ok',
      '        jmp out_of_memory',
      '.ok:    ret',
      '',
      doc('asmDocFatal'),
      'out_of_memory:',
      '        mov si, ' + eMem,
      '        jmp fatal',
      'index_error:',
      '        mov si, ' + eIdx,
      'fatal:  call print_str',
      '        call print_newline',
      '        mov ax, 4C01h',
      '        int 21h',
      '',
      'read_char:    db 0',
      'num_digits:   times 7 db 0',
      'num_digits_end:',
      'num_text:     times 8 db 0',
      'line_buf:     times 256 db 0',
      'scratch:      times 256 db 0'
    ].join('\n');
  }

  BBE.asmgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
