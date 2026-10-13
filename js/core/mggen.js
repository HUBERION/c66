/* Blockbild-Editor – Übersetzung nach MARTIN GOES (+ Interpreter)
 *
 *   MARTIN GOES: unendlich viele Zellen 0, 1, 2, … mit beliebig großen ganzen Zahlen (am Anfang 0).
 *   Befehle: M x y (x·=y), A x y (x+=y), R x y (x−=y), T (Ende), I x (einlesen), N x (x=−x), G L (Sprung),
 *            O x (ausgeben), E x L (wenn x = 0 → L), S x y (x:=y).
 *   Operanden: #5 Konstante, 5 Zelle 5, @5 Zelle, deren Adresse in Zelle 5 steht.
 *
 *   Übersetzung:
 *   - Variablen des Hauptprogramms liegen in den Zellen 0, 1, 2, … (Kommentar am Anfang zeigt welche).
 *   - Danach Hilfszellen: SP (Stapelzeiger), FP (Rahmenzeiger), HP (Haldenzeiger), RV (Rückgabewert),
 *     RID (Rücksprung-Nummer) und Zwischenergebnisse.
 *   - Unterprogramme: Rahmen auf dem Stapel (ab Zelle 1000000): [Rücksprung-Nr., alter FP, Parameter, Variablen].
 *     Zugriff indirekt über @. Da es nur G mit festem Label gibt, springt jedes Unterprogramm am Ende
 *     zu "zurueck", das die Rücksprung-Nummer mit E-Befehlen der passenden Aufrufstelle zuordnet.
 *   - InOut-Parameter bekommen die Adresse der Variablen, Arrays die Adresse ihres Speichers auf der Halde
 *     ([Länge, Element 0, Element 1, …]); neue Arrays sind immer frisch (Zellen sind 0).
 *   - Vergleiche: nur E (= 0) existiert. x < 0 wird mit einer Schleife geprüft (x+k und x−k, bis eines 0 wird).
 *   - Division/Rest: wiederholtes Abziehen mit Vorzeichenbehandlung (schneidet ab wie C).
 *   - Texte gibt es nicht: Text-Ausgaben werden zu Kommentaren, Zahlen darin werden ausgegeben.
 *     Text-Variablen, -Eingaben und -Vergleiche sind nicht übersetzbar (Kommentar + Meldung).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;

  const STACK = 1000000;
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const labelName = (n) => {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(s)) s = 'u' + s;
    return s;
  };

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const unsupported = [];
    const code = [];          // { label, op, args: [], cmt } oder { text } (Kommentarzeile)
    let labelNo = 0;
    const newLabel = (hint) => (hint || 'L') + (++labelNo);
    const RET = tr('mgReturnLabel');
    const END = tr('mgEndLabel');
    const fnLabel = new Map();
    for (const f of program.fns.filter((x) => !x.isMain)) {
      let n = labelName(f.name);
      while ([...fnLabel.values()].includes(n) || /^(L|zu)\d+$/.test(n) || n === RET || n === END) n += '_';
      fnLabel.set(f.name, n);
    }

    // ---- Zellen
    const main = program.fns.find((f) => f.isMain);
    const mainScope = A.scopeOf(main);
    const mainCell = new Map();
    for (const [n] of mainScope) mainCell.set(n, mainCell.size);
    const base = mainCell.size;
    const R = { SP: base, FP: base + 1, HP: base + 2, RV: base + 3, RID: base + 4 };
    const TEMP0 = base + 5;
    let maxTemp = 0;
    const usedReg = new Set();
    let usesHeap = false, usesStack = false;
    const callSites = [];

    let pendingLabel = null;
    function emit(op, args, cmt) {
      code.push({ label: pendingLabel, op, args: args || [], cmt });
      pendingLabel = null;
    }
    function label(l) {
      if (pendingLabel) emit('G', [l]); // zwei Labels hintereinander: leerer Sprung (wird später entfernt)
      pendingLabel = l;
    }
    function note(text) { code.push({ text }); }

    // ---- Kontext je Unterprogramm
    function frameOf(fn) {
      const scope = A.scopeOf(fn);
      const slot = new Map();
      let k = 2;
      for (const p of fn.params) slot.set(p.name, k++);
      for (const [n] of scope) if (!slot.has(n)) slot.set(n, k++);
      return { scope, slot, size: k };
    }

    function temp(ctx) {
      const t = TEMP0 + ctx.tmp++;
      maxTemp = Math.max(maxTemp, ctx.tmp);
      return t;
    }
    const reg = (r) => { usedReg.add(r); return R[r]; };
    const typeOf = (ctx, a) => A.typeOf(a, ctx.scope);

    /** Zelle (Operand) einer Variablen zum Lesen/Schreiben. */
    function varOperand(ctx, n) {
      if (ctx.fn.isMain) return String(mainCell.get(n) ?? 0);
      const slot = ctx.frame.slot.get(n) ?? 2;
      const t = temp(ctx);
      emit('S', [String(t), String(reg('FP'))]);
      emit('A', [String(t), '#' + slot]);
      const v = ctx.scope.get(n);
      if (v && v.kind === 'param' && v.byRef && !A.isArrayType(v.type)) emit('S', [String(t), '@' + t], tr('mgCmtAddr', n));
      return '@' + t;
    }

    /** Operand, der den Wert liefert (#k, Zelle oder @t). */
    function val(ctx, a) {
      const s = strip(a);
      if (s.k === 'num' && Number.isInteger(s.v)) return '#' + s.v;
      if (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num' && Number.isInteger(strip(s.a).v)) return '#-' + strip(s.a).v;
      if (s.k === 'id') return varOperand(ctx, s.name);
      if (s.k === 'idx') return elemOperand(ctx, s);
      if (s.k === 'len') {
        const o = strip(s.obj);
        if (!A.isArrayType(typeOf(ctx, o))) { unsupported.push(tr('mgNoText')); return '#0'; }
        const t = temp(ctx);
        emit('S', [String(t), val(ctx, o)]);
        return '@' + t;
      }
      return String(evalInto(ctx, s));
    }

    /** Element a[i]: Adresse = Basis + i + 1 */
    function elemOperand(ctx, s) {
      const t = temp(ctx);
      emit('S', [String(t), val(ctx, s.obj)]);
      const i = strip(s.index);
      if (i.k === 'num' && Number.isInteger(i.v)) emit('A', [String(t), '#' + (i.v + 1)]);
      else { emit('A', [String(t), val(ctx, i)]); emit('A', [String(t), '#1']); }
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
      if (typeOf(ctx, s) === 'string') { unsupported.push(tr('mgNoText')); emit('S', [T, '#0']); return t; }
      // Wahrheitswert → 0/1
      const yes = newLabel(), no = newLabel();
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
      const loop = newLabel();
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
      const L = (h) => newLabel(h);
      const aPos = L(), bChk = L(), bPos = L(), loop = L(), done = L(), aNeg = L(), bNeg = L(), stop = L();
      emit('S', [b, d], op === '/' ? tr('mgCmtDiv') : tr('mgCmtMod'));
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
      void stop;
    }

    /** Bedingung als Sprünge. */
    function condJump(ctx, a, yes, no) {
      const s = strip(a);
      if (s.k === 'bin' && s.op === '&&') { const mid = newLabel(); condJump(ctx, s.a, mid, no); label(mid); condJump(ctx, s.b, yes, no); return; }
      if (s.k === 'bin' && s.op === '||') { const mid = newLabel(); condJump(ctx, s.a, yes, mid); label(mid); condJump(ctx, s.b, yes, no); return; }
      if (s.k === 'un' && s.op === '!') { condJump(ctx, s.a, no, yes); return; }
      if (s.k === 'bin' && ['==', '!=', '<', '<=', '>', '>='].includes(s.op)) {
        if (typeOf(ctx, s.a) === 'string' || typeOf(ctx, s.b) === 'string') { unsupported.push(tr('mgNoText')); emit('G', [no]); return; }
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
      if (typeOf(ctx, s) === 'string') { unsupported.push(tr('mgNoText')); emit('G', [no]); return; }
      const v = val(ctx, s);
      if (v.startsWith('#')) { emit('G', [v === '#0' ? no : yes]); return; }
      emit('E', [v, no]);
      emit('G', [yes]);
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
      if (typeOf(ctx, tgt) === 'string') { unsupported.push(tr('mgNoText')); note('; ' + tr('mgSkipped')); return; }
      if (!ast) { const d = lval(ctx, tgt); emit('S', [d, '#0']); return; }
      const s = strip(ast);
      if (typeOf(ctx, s) === 'string') { unsupported.push(tr('mgNoText')); note('; ' + tr('mgSkipped')); return; }
      // x = x + y → A x y (bei Zellen des Hauptprogramms)
      if (tgt.k === 'id' && ctx.fn.isMain && s.k === 'bin' && '+-*'.includes(s.op) && strip(s.a).k === 'id' && strip(s.a).name === tgt.name &&
          !isFrac(strip(s.b))) {
        const y = val(ctx, s.b);
        emit({ '+': 'A', '-': 'R', '*': 'M' }[s.op], [String(mainCell.get(tgt.name)), y]);
        return;
      }
      const v = val(ctx, s);
      const d = lval(ctx, tgt);
      emit('S', [d, v]);
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
          if (n.vtype === 'string' || n.vtype === 'string[]') { unsupported.push(tr('mgNoText')); head(tr('mgTextVar', n.name)); return; }
          if (n.vtype === 'integer[]') {
            head(n.name + ' = ' + tr('mgNewArray', n.length));
            usesHeap = true;
            const len = tryParse(n.length);
            const tgt = { k: 'id', name: n.name };
            const hp = String(reg('HP'));
            const lenV = len ? val(ctx, len) : '#0';
            const t = String(temp(ctx));
            emit('S', [t, lenV]);
            emit('S', ['@' + hp, t], tr('mgCmtLen'));
            const d = lval(ctx, tgt);
            emit('S', [d, hp]);
            emit('A', [hp, t]);
            emit('A', [hp, '#1']);
            return;
          }
          head(n.name + ' = ' + (String(n.init || '').trim() || '0'));
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
          if (!tgt || typeOf(ctx, tgt) !== 'integer') { unsupported.push(tr('mgNoText')); return; }
          emit('I', [lval(ctx, tgt)]);
          return;
        }
        case 'output': {
          head(tr('mgOutput', n.expr));
          const ast = tryParse(n.expr);
          if (!ast) return;
          const ps = [];
          const walkParts = (x) => {
            const s = strip(x);
            if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') { walkParts(s.a); walkParts(s.b); } else ps.push(s);
          };
          walkParts(ast);
          for (const p of ps) {
            const t = typeOf(ctx, p);
            if (t === 'string' || t === 'bool') { if (p.k !== 'str') unsupported.push(tr('mgNoText')); continue; }
            ctx.tmp = 0;
            emit('O', [val(ctx, p)]);
          }
          return;
        }
        case 'if': {
          head(tr('mgIf', n.cond));
          const yes = newLabel(), no = newLabel(), end = newLabel();
          condFrom(ctx, n.cond, yes, no);
          label(yes);
          genSeq(ctx, n.then);
          if (n.else && n.else.length) { emit('G', [end]); label(no); genSeq(ctx, n.else); label(end); }
          else { label(no); }
          return;
        }
        case 'while': {
          head(tr('mgWhile', n.cond));
          const top = newLabel(), body = newLabel(), end = newLabel();
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
          const top = newLabel(), end = newLabel();
          label(top);
          genSeq(ctx, n.body);
          ctx.tmp = 0;
          condFrom(ctx, n.cond, end, top);
          label(end);
          return;
        }
        case 'for': {
          head(tr('mgFor', n.counter, n.from, n.to, String(n.step || '1').trim() || '1'));
          const top = newLabel(), body = newLabel(), end = newLabel();
          store(ctx, n.counter, tryParse(n.from));
          const stepAst = tryParse(n.step) || { k: 'num', v: 1, raw: '1' };
          const lit = A.literalValue(stepAst);
          const k = tryParse(n.counter), to = tryParse(n.to) || { k: 'num', v: 0, raw: '0' };
          label(top);
          ctx.tmp = 0;
          if (typeof lit === 'number') condJump(ctx, { k: 'bin', op: lit >= 0 ? '<=' : '>=', a: k, b: to }, body, end);
          else {
            const pos = newLabel(), neg = newLabel();
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
          if (!sel || typeOf(ctx, sel) === 'string') { unsupported.push(tr('mgNoText')); return; }
          const end = newLabel();
          const labels = n.cases.map(() => newLabel());
          const other = newLabel();
          const sv = String(temp(ctx));
          emit('S', [sv, val(ctx, sel)]);
          n.cases.forEach((c, i) => {
            const v = tryParse(c.value);
            const d = String(temp(ctx));
            emit('S', [d, sv]);
            emit('R', [d, v ? val(ctx, v) : '#0']);
            emit('E', [d, labels[i]]);
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
          const SP = String(reg('SP')), FP = String(reg('FP'));
          // Argumente in den neuen Rahmen schreiben (ab SP)
          callee.params.forEach((p, i) => {
            ctx.tmp = 0;
            const src = tryParse(n.args[i] || '') || { k: 'num', v: 0, raw: '0' };
            if (p.type === 'string' || p.type === 'string[]') { unsupported.push(tr('mgNoText')); return; }
            const v = A.isArrayType(p.type) ? val(ctx, src) : p.byRef ? addrValue(ctx, src) : val(ctx, src);
            const a = String(temp(ctx));
            emit('S', [a, SP]);
            emit('A', [a, '#' + fr.slot.get(p.name)]);
            emit('S', ['@' + a, v], p.name);
          });
          ctx.tmp = 0;
          const id = callSites.length + 1;
          const back = newLabel('zu');
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
            if (tgt && callee.returnType === 'integer' && typeOf(ctx, tgt) === 'integer') emit('S', [lval(ctx, tgt), String(reg('RV'))]);
            else unsupported.push(tr('mgNoText'));
          }
          return;
        }
        default: return;
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
      if (fn.returnType !== 'void') {
        ctx.tmp = 0;
        if (fn.returnType === 'integer') store(ctx, 'result', tryParse(fn.resultInit) || { k: 'num', v: 0, raw: '0' });
        else unsupported.push(tr('mgNoText'));
      }
      genSeq(ctx, fn.body);
      ctx.tmp = 0;
      if (fn.returnType === 'integer') emit('S', [String(reg('RV')), varOperand(ctx, 'result')], tr('mgCmtResult'));
      const SP = String(reg('SP')), FP = String(reg('FP')), RID = String(reg('RID'));
      const t = String(temp(ctx));
      emit('S', [SP, FP], tr('mgCmtPop'));
      emit('S', [RID, '@' + FP]);
      emit('S', [t, FP]);
      emit('A', [t, '#1']);
      emit('S', [FP, '@' + t]);
      emit('G', [RET]);
    }

    if (callSites.length) {
      note('');
      note('; ' + tr('mgCmtDispatch'));
      const RID = String(reg('RID'));
      label(RET);
      callSites.forEach((l) => { emit('R', [RID, '#1']); emit('E', [RID, l]); });
      emit('T');
    }
    label(END);
    emit('T');

    // Startwerte für Stapel und Halde vor das Hauptprogramm
    const heapBase = Math.ceil((TEMP0 + maxTemp + 1) / 100) * 100;
    const init = [];
    if (usesStack) init.push({ op: 'S', args: [String(R.SP), '#' + STACK], cmt: tr('mgCmtStack') });
    if (usesHeap) init.push({ op: 'S', args: [String(R.HP), '#' + heapBase], cmt: tr('mgCmtHeap') });
    code.splice(initAt, 0, ...init);

    // Leere Sprünge zum direkt folgenden Label entfernen
    for (let i = 0; i < code.length - 1; i++) {
      const c = code[i];
      if (c.op === 'G' && !c.label) {
        let j = i + 1;
        while (j < code.length && code[j].text !== undefined) j++;
        if (j < code.length && code[j].label === c.args[0]) { code.splice(i, 1); i--; }
      }
    }
    // Labels, die nur auf leere Sprünge zeigen, bleiben – sie sind harmlos.

    // Ausgabe
    const out = ['; ' + tr('mgHeader1'), '; ' + tr('mgHeader2'), ';'];
    const cells = [...mainCell].map(([n, c]) => c + ' = ' + n);
    if (cells.length) out.push('; ' + tr('mgCells') + ' ' + cells.join(', '));
    const regs = Object.entries(R).filter(([k]) => usedReg.has(k)).map(([k, c]) => c + ' = ' + k);
    if (regs.length || maxTemp) out.push('; ' + tr('mgRegs') + ' ' + regs.concat(maxTemp ? [TEMP0 + '…' + (TEMP0 + maxTemp - 1) + ' = ' + tr('mgTemps')] : []).join(', '));
    const uniq = [...new Set(unsupported)];
    if (uniq.length) out.push(';', '; ⚠ ' + uniq.join(' '));
    out.push('');
    for (const c of code) {
      if (c.text !== undefined) { out.push(c.text); continue; }
      const lab = c.label ? (c.label + ':').padEnd(10) : ' '.repeat(10);
      const ins = (c.op + '  ' + c.args.join(' ')).trimEnd();
      out.push((lab + (c.cmt ? ins.padEnd(18) + '; ' + c.cmt : ins)).trimEnd());
    }
    const text = out.join('\n') + '\n';
    return opts.report ? { code: text, unsupported: uniq } : text;
  }

  // ------------------------------------------------------------ Interpreter

  /**
   * Führt ein MARTIN-GOES-Programm aus.
   * @param src     Quelltext
   * @param io      { input(): BigInt|number|null, output(BigInt), maxSteps }
   * @returns       { steps, error }
   */
  function run(src, io = {}) {
    const prog = [];
    const labels = new Map();
    String(src).split('\n').forEach((raw, lineNo) => {
      let s = raw.replace(/;.*$/, '').trim();
      const m = /^([A-Za-z_]\w*)\s*:\s*/.exec(s);
      if (m) { labels.set(m[1], prog.length); s = s.slice(m[0].length); }
      if (!s) return;
      const [op, ...args] = s.split(/\s+/);
      prog.push({ op: op.toUpperCase(), args, line: lineNo + 1 });
    });
    const mem = new Map();
    const get = (a) => mem.get(a.toString()) || 0n;
    const set = (a, v) => mem.set(a.toString(), v);
    const addr = (o, ins) => {
      if (o.startsWith('@')) return get(BigInt(o.slice(1)));
      if (o.startsWith('#')) throw new Error('Zeile ' + ins.line + ': Konstante als Ziel');
      return BigInt(o);
    };
    const value = (o, ins) => (o.startsWith('#') ? BigInt(o.slice(1)) : get(addr(o, ins)));
    const jump = (l, ins) => { if (!labels.has(l)) throw new Error('Zeile ' + ins.line + ': Label ' + l + ' fehlt'); return labels.get(l); };
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
          case 'I': { const v = io.input ? io.input() : null; set(addr(x, ins), v == null ? 0n : BigInt(v)); break; }
          case 'N': set(addr(x, ins), -get(addr(x, ins))); break;
          case 'G': pc = jump(x, ins); break;
          case 'O': if (io.output) io.output(value(x, ins)); break;
          case 'E': if (value(x, ins) === 0n) pc = jump(y, ins); break;
          case 'S': set(addr(x, ins), value(y, ins)); break;
          default: throw new Error('Zeile ' + ins.line + ': unbekannter Befehl ' + ins.op);
        }
      }
      return { steps };
    } catch (e) {
      return { steps, error: e.message };
    }
  }

  BBE.mggen = { generate, run };
})(typeof window !== 'undefined' ? window : globalThis);
