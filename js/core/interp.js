/* Blockbild-Editor – Interpreter für die schrittweise Simulation
 *
 * Der Interpreter ist ein Generator: jeder `yield` ist ein sichtbarer Schritt.
 *   { type: 'step',  fnId, nodeId, part }        Block (oder Teil davon) wurde ausgeführt
 *   { type: 'input', fnId, nodeId, prompt, numeric }  wartet auf Eingabe (Antwort per gen.next(wert|null))
 *   { type: 'break', fnId, nodeId }               Haltepunkt erreicht (vor der Ausführung)
 *   { type: 'tick' }                               unsichtbarer Takt (verhindert Endlosschleifen ohne Schritt)
 * Speicher: jede Variable belegt 8 Byte; Rahmen werden beim Rücksprung wieder freigegeben.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, ExprError } = BBE.expr;
  const RESULT = 'result';
  const SLOT = 8;
  const MAX_DEPTH = 400;

  class RunError extends Error {
    constructor(key, args) {
      super(key);
      this.key = key;
      this.args = args || [];
    }
  }

  const hex = (n) => '0x' + n.toString(16).padStart(4, '0');
  const elemAddr = (cell, i) => hex(parseInt(cell.addr, 16) + i * SLOT);

  const fmtNumber = (v) => {
    if (Number.isInteger(v)) return String(v);
    const s = String(Number(v.toPrecision(12)));
    return s;
  };

  /** Darstellung eines Wertes für Ausgabe und Stack-Ansicht. */
  function show(v) {
    if (typeof v === 'number') return fmtNumber(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v == null) return '';
    return String(v);
  }

  class Interpreter {
    /**
     * @param program  Programm-Modell
     * @param opts     { output(text), skipChecks: bool, breakpoints: Set<nodeId> }
     */
    constructor(program, opts = {}) {
      this.program = program;
      this.output = opts.output || (() => {});
      this.skipChecks = !!opts.skipChecks;
      this.breakpoints = opts.breakpoints || new Set();
      this.frames = [];
      this.sp = 1;
      this.changed = new Set();
      this.changedElems = new Set();
      this.fnByName = new Map(program.fns.filter((f) => !f.isMain).map((f) => [f.name, f]));
      this.current = null;
    }

    *run() {
      const main = this.program.fns.find((f) => f.isMain);
      yield* this.callFunction(main, [], null);
    }

    // ------------------------------------------------------------- Speicher

    newCell(frame, name, type, value, size) {
      const cell = { name, type, value, addr: hex(this.sp * SLOT), frame };
      this.sp += Math.max(1, size || 1);
      this.changed.add(cell);
      return cell;
    }

    lookup(frame, name, pos) {
      const e = frame.vars.get(name);
      if (!e) {
        const declaredLater = this.isDeclared(frame.fn, name);
        throw new RunError(declaredLater ? 'rNotYetDeclared' : 'rUnknownVar', [name]);
      }
      return e.cell;
    }

    isDeclared(fn, name) {
      let hit = false;
      BBE.model.walkSeq(fn.body, (n) => { if (n.kind === 'decl' && n.name === name) hit = true; });
      return hit;
    }

    // ------------------------------------------------------------- Ausdrücke

    parse(src) {
      try { return parseCached(src); } catch (e) {
        if (e instanceof ExprError) throw new RunError('rSyntax', [String(src)]);
        throw e;
      }
    }

    evalSrc(src, frame) {
      if (src == null || String(src).trim() === '') throw new RunError('rEmptyField');
      return this.eval(this.parse(src), frame);
    }

    eval(a, frame) {
      switch (a.k) {
        case 'num': return a.v;
        case 'str': return a.v;
        case 'paren': return this.eval(a.e, frame);
        case 'id': {
          const cell = this.lookup(frame, a.name, a.pos);
          if (Array.isArray(cell.value)) throw new RunError('rArrayValue', [a.name]);
          return cell.value;
        }
        case 'idx': {
          const { arr, i, label } = this.element(a, frame);
          return arr[i];
        }
        case 'len': {
          const v = a.obj.k === 'id' ? this.lookup(frame, a.obj.name).value : this.eval(a.obj, frame);
          if (Array.isArray(v) || typeof v === 'string') return v.length;
          throw new RunError('rLength');
        }
        case 'un': {
          const v = this.eval(a.a, frame);
          if (a.op === '!') return !truthy(v);
          const n = this.num(v);
          return a.op === '-' ? -n : n;
        }
        case 'bin': return this.binary(a, frame);
        default: throw new RunError('rSyntax', ['?']);
      }
    }

    binary(a, frame) {
      const op = a.op;
      if (op === '&&') return truthy(this.eval(a.a, frame)) ? truthy(this.eval(a.b, frame)) : false;
      if (op === '||') return truthy(this.eval(a.a, frame)) ? true : truthy(this.eval(a.b, frame));
      const x = this.eval(a.a, frame);
      const y = this.eval(a.b, frame);
      switch (op) {
        case '+':
          if (typeof x === 'string' || typeof y === 'string') return show(x) + show(y);
          return this.num(x) + this.num(y);
        case '-': return this.num(x) - this.num(y);
        case '*': return this.num(x) * this.num(y);
        case '/': { const d = this.num(y); if (d === 0) throw new RunError('rDivZero'); return this.num(x) / d; }
        case '%': { const d = this.num(y); if (d === 0) throw new RunError('rDivZero'); return this.num(x) % d; }
        // eslint-disable-next-line eqeqeq
        case '==': return x == y;
        // eslint-disable-next-line eqeqeq
        case '!=': return x != y;
        case '<': return x < y;
        case '<=': return x <= y;
        case '>': return x > y;
        case '>=': return x >= y;
        default: throw new RunError('rSyntax', [op]);
      }
    }

    num(v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      const n = Number(v);
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(n)) return n;
      throw new RunError('rNotANumber', [show(v)]);
    }

    element(a, frame) {
      const cell = a.obj.k === 'id' ? this.lookup(frame, a.obj.name) : null;
      const arr = cell ? cell.value : this.eval(a.obj, frame);
      const name = a.obj.k === 'id' ? a.obj.name : '?';
      if (!Array.isArray(arr)) throw new RunError('rNotArray', [name]);
      const raw = this.num(this.eval(a.index, frame));
      if (!Number.isInteger(raw)) throw new RunError('rIndexInt', [show(raw)]);
      if (raw < 0 || raw >= arr.length) throw new RunError('rIndexRange', [name, raw, arr.length]);
      return { arr, i: raw, cell, label: name + '[' + raw + ']' };
    }

    /** Referenz auf ein Ziel (Variable oder Array-Element) mit get/set. */
    ref(src, frame) {
      let t;
      try { t = parseTarget(src); } catch (e) {
        if (e instanceof ExprError) throw new RunError('rNotAssignable', [String(src)]);
        throw e;
      }
      if (t.k === 'id') {
        const cell = this.lookup(frame, t.name);
        return {
          type: cell.type, label: t.name, cell,
          get: () => cell.value,
          set: (v) => { cell.value = v; this.changed.add(cell); }
        };
      }
      const { arr, i, cell, label } = this.element(t, frame);
      const type = cell ? cell.type.slice(0, -2) : (typeof arr[i] === 'string' ? 'string' : 'integer');
      return {
        type, label, cell, index: i,
        get: () => arr[i],
        set: (v) => { arr[i] = v; this.changedElems.add(elemAddr(cell, i)); }
      };
    }

    coerce(v, type, what) {
      if (type === 'integer') {
        if (Array.isArray(v)) throw new RunError('rArrayValue', [what || '?']);
        return this.num(v);
      }
      if (type === 'string') return show(v);
      throw new RunError('rArrayAssign');
    }

    // ------------------------------------------------------------- Unterprogramme

    *callFunction(fn, args, callNode) {
      if (this.frames.length >= MAX_DEPTH) throw new RunError('rStackOverflow', [MAX_DEPTH]);
      const frame = { fn, vars: new Map(), base: this.sp, id: BBE.model.uid('fr') };
      // Parameter binden
      fn.params.forEach((p, i) => {
        const arg = args[i];
        if (arg.byRef) {
          frame.vars.set(p.name, { cell: arg.cell, ref: true, via: arg.label, index: arg.index });
        } else {
          const cell = this.newCell(frame, p.name, p.type, this.coerce(arg.value, p.type, p.name));
          frame.vars.set(p.name, { cell, ref: false });
        }
      });
      this.frames.push(frame);
      try {
        if (!fn.isMain && fn.returnType !== 'void') {
          this.current = { fnId: fn.id, nodeId: fn.id, part: 'result' };
          const init = this.coerce(this.evalSrc(fn.resultInit, frame), fn.returnType, RESULT);
          const cell = this.newCell(frame, RESULT, fn.returnType, init);
          frame.vars.set(RESULT, { cell, ref: false, result: true });
          yield { type: 'step', fnId: fn.id, nodeId: fn.id, part: 'result' };
        } else if (!fn.isMain) {
          yield { type: 'step', fnId: fn.id, nodeId: fn.id, part: 'head' };
        }
        yield* this.seq(fn.body, frame);
        // Ende von main: letzter Stand bleibt sichtbar
        if (fn.isMain) yield { type: 'step', fnId: fn.id, nodeId: fn.id, part: 'end' };
        let ret;
        if (!fn.isMain && fn.returnType !== 'void') {
          ret = frame.vars.get(RESULT).cell.value;
          yield { type: 'step', fnId: fn.id, nodeId: fn.id, part: 'return' };
        }
        return ret;
      } catch (e) {
        this.keepSnapshot(e);
        throw e;
      } finally {
        this.frames.pop();
        this.sp = frame.base;
      }
    }

    // ------------------------------------------------------------- Anweisungen

    *seq(list, frame) {
      for (const n of list) yield* this.stmt(n, frame);
    }

    *check(frame, n, part) {
      if (this.skipChecks) yield { type: 'tick' };
      else yield { type: 'step', fnId: frame.fn.id, nodeId: n.id, part };
    }

    /** Anweisung ausführen; bei Fehlern den Speicherstand vor dem Abbau der Rahmen sichern. */
    *stmt(n, frame) {
      try {
        yield* this.exec(n, frame);
      } catch (e) {
        this.keepSnapshot(e);
        throw e;
      }
    }

    keepSnapshot(e) {
      if (e && typeof e === 'object' && !e.snapshot) {
        try { e.snapshot = this.snapshot(); e.where = this.current; } catch (x) { /* egal */ }
      }
    }

    *exec(n, frame) {
      if (n.kind === 'comment') return;
      const fnId = frame.fn.id;
      this.current = { fnId, nodeId: n.id };
      if (this.breakpoints.has(n.id)) yield { type: 'break', fnId, nodeId: n.id };
      this.current = { fnId, nodeId: n.id };
      const step = (part) => ({ type: 'step', fnId, nodeId: n.id, part });

      switch (n.kind) {
        case 'decl': {
          if (!n.name) throw new RunError('rEmptyField');
          if (n.vtype.endsWith('[]')) {
            const len = this.num(this.evalSrc(n.length, frame));
            if (!Number.isInteger(len) || len < 0) throw new RunError('rArrayLength', [show(len)]);
            if (len > 10000) throw new RunError('rArrayTooLong', [len]);
            const fill = n.vtype === 'integer[]' ? 0 : '';
            const existing = frame.vars.get(n.name);
            const value = new Array(len).fill(fill);
            if (existing && !existing.ref && existing.cell.type === n.vtype && existing.cell.value.length === len) {
              existing.cell.value = value;
              this.changed.add(existing.cell);
            } else {
              frame.vars.set(n.name, { cell: this.newCell(frame, n.name, n.vtype, value, len), ref: false });
            }
          } else {
            const v = this.coerce(this.evalSrc(n.init, frame), n.vtype, n.name);
            const existing = frame.vars.get(n.name);
            if (existing && !existing.ref && existing.cell.type === n.vtype) {
              existing.cell.value = v;
              this.changed.add(existing.cell);
            } else {
              frame.vars.set(n.name, { cell: this.newCell(frame, n.name, n.vtype, v), ref: false });
            }
          }
          yield step();
          return;
        }

        case 'assign': {
          const r = this.ref(n.target, frame);
          const v = this.evalSrc(n.expr, frame);
          r.set(this.coerce(v, r.type, r.label));
          yield step();
          return;
        }

        case 'input': {
          const r = this.ref(n.target, frame);
          if (r.type.endsWith('[]')) throw new RunError('rArrayAssign');
          const prompt = n.prompt && n.prompt.trim() ? show(this.evalSrc(n.prompt, frame)) : '';
          const answer = yield { type: 'input', fnId, nodeId: n.id, prompt, numeric: r.type === 'integer', label: r.label };
          if (answer !== null && answer !== undefined) r.set(this.coerce(answer, r.type, r.label));
          return;
        }

        case 'output': {
          this.output(show(this.evalSrc(n.expr, frame)));
          yield step();
          return;
        }

        case 'if': {
          const c = truthy(this.evalSrc(n.cond, frame));
          yield* this.check(frame, n, 'head');
          if (c) yield* this.seq(n.then, frame);
          else if (n.else) yield* this.seq(n.else, frame);
          return;
        }

        case 'while': {
          for (;;) {
            const c = truthy(this.evalSrc(n.cond, frame));
            yield* this.check(frame, n, 'head');
            if (!c) return;
            yield* this.seq(n.body, frame);
          }
        }

        case 'until': {
          for (;;) {
            yield* this.seq(n.body, frame);
            const c = truthy(this.evalSrc(n.cond, frame));
            yield* this.check(frame, n, 'foot');
            if (c) return;
          }
        }

        case 'for': {
          const counter = this.ref(n.counter, frame);
          if (counter.type !== 'integer') throw new RunError('rCounterType');
          counter.set(this.num(this.evalSrc(n.from, frame)));
          yield step('head');
          for (;;) {
            const stepV = this.num(this.evalSrc(n.step, frame));
            if (stepV === 0) throw new RunError('rStepZero');
            const to = this.num(this.evalSrc(n.to, frame));
            const cur = this.num(counter.get());
            const go = stepV > 0 ? cur <= to : cur >= to;
            yield* this.check(frame, n, 'head');
            if (!go) return;
            yield* this.seq(n.body, frame);
            this.current = { fnId, nodeId: n.id };
            counter.set(this.num(counter.get()) + this.num(this.evalSrc(n.step, frame)));
            yield step('head');
          }
        }

        case 'switch': {
          const v = this.evalSrc(n.expr, frame);
          let hit = null;
          for (const c of n.cases) {
            const cv = this.evalSrc(c.value, frame);
            // eslint-disable-next-line eqeqeq
            if (cv == v) { hit = c; break; }
          }
          yield* this.check(frame, n, 'head');
          if (hit) yield* this.seq(hit.body, frame);
          else if (n.else) yield* this.seq(n.else, frame);
          return;
        }

        case 'call': {
          const fn = this.fnByName.get(n.fn);
          if (!fn) throw new RunError(n.fn ? 'rUnknownFunction' : 'rNoFunction', [n.fn]);
          const args = fn.params.map((p, i) => {
            const src = n.args[i];
            if (p.byRef || p.type.endsWith('[]')) {
              const r = this.ref(src, frame);
              if (p.type.endsWith('[]')) {
                if (!Array.isArray(r.get())) throw new RunError('rArrayArg', [p.name]);
                return { byRef: true, cell: r.cell, label: r.label };
              }
              if (r.index !== undefined) {
                // Element eines Arrays per Referenz: eigene Zelle, die auf das Element zeigt
                const arrCell = r.cell;
                const i0 = r.index;
                const self = this;
                const elemCell = {
                  name: r.label, type: p.type, addr: elemAddr(arrCell, i0), frame: arrCell.frame,
                  get value() { return arrCell.value[i0]; },
                  set value(v) { arrCell.value[i0] = v; self.changedElems.add(elemAddr(arrCell, i0)); }
                };
                return { byRef: true, cell: elemCell, label: r.label, index: i0 };
              }
              return { byRef: true, cell: r.cell, label: r.label };
            }
            return { byRef: false, value: this.evalSrc(src, frame) };
          });
          yield step();
          const ret = yield* this.callFunction(fn, args, n);
          this.current = { fnId, nodeId: n.id };
          if (fn.returnType !== 'void' && n.target && n.target.trim()) {
            const r = this.ref(n.target, frame);
            r.set(this.coerce(ret, r.type, r.label));
          }
          yield step('return');
          return;
        }

        default:
          return;
      }
    }

    /** Momentaufnahme des Stacks für die Anzeige (oberster Rahmen zuerst). */
    snapshot() {
      return this.frames.slice().reverse().map((fr) => ({
        id: fr.id,
        fnId: fr.fn.id,
        name: fr.fn.name,
        isMain: fr.fn.isMain,
        vars: Array.from(fr.vars.entries()).map(([name, e]) => ({
          name,
          type: e.cell.type,
          value: Array.isArray(e.cell.value) ? e.cell.value.slice() : e.cell.value,
          isArray: Array.isArray(e.cell.value),
          addr: e.cell.addr,
          ref: e.ref,
          via: e.ref ? e.via + (e.cell.frame && e.cell.frame.fn ? ' · ' + e.cell.frame.fn.name : '') : null,
          result: !!e.result,
          cell: e.cell
        }))
      }));
    }
  }

  function truthy(v) {
    if (typeof v === 'string') return v.length > 0;
    return !!v;
  }

  BBE.interp = { Interpreter, RunError, show };
})(typeof window !== 'undefined' ? window : globalThis);
