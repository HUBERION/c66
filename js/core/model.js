/* Blockbild-Editor – Datenmodell, Traversierung und .bb-Dateiformat
 *
 * Programm:  { fns: [main, ...unterprogramme] }
 * Funktion:  { id, name, isMain, returnType: 'void'|'integer'|'string', params: [...], resultInit, body: [...] }
 * Parameter: { id, type, name, byRef, doc }
 * Blöcke:    { id, kind, ...felder }  – kind: decl input output assign if while until for switch call comment
 *
 * Das .bb-Format ist mit dem Blockbild-Editor 2.x kompatibel (Laden und Speichern).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  let counter = 0;
  const uid = (p = 'b') => p + (++counter).toString(36) + Math.random().toString(36).slice(2, 5);

  const KINDS = ['decl', 'input', 'output', 'assign', 'if', 'else', 'switch', 'case', 'while', 'for', 'until', 'call', 'comment'];
  const CATEGORY = {
    decl: 'data', assign: 'data',
    input: 'io', output: 'io',
    if: 'branch', else: 'branch', switch: 'branch', case: 'branch',
    while: 'loop', for: 'loop', until: 'loop',
    call: 'call', comment: 'cmt'
  };
  /** Bausteine, die selbst keine Anweisung sind, sondern an WENN/FALLS andocken. */
  const COMPONENTS = ['else', 'case'];

  function createNode(kind) {
    const n = { id: uid(), kind };
    switch (kind) {
      case 'decl': Object.assign(n, { vtype: 'integer', name: '', init: '0', length: '' }); break;
      case 'input': Object.assign(n, { prompt: '', target: '' }); break;
      case 'output': Object.assign(n, { expr: '' }); break;
      case 'assign': Object.assign(n, { target: '', expr: '' }); break;
      case 'if': Object.assign(n, { cond: '', then: [], else: [] }); break;
      case 'while': Object.assign(n, { cond: '', body: [] }); break;
      case 'until': Object.assign(n, { cond: '', body: [] }); break;
      case 'for': Object.assign(n, { counter: '', from: '', to: '', step: '+1', body: [] }); break;
      case 'switch': Object.assign(n, { expr: '', cases: [createCase(), createCase()], else: [] }); break;
      case 'call': Object.assign(n, { fn: '', target: '', args: [] }); break;
      case 'comment': Object.assign(n, { text: '' }); break;
      default: throw new Error('unknown kind ' + kind);
    }
    if (kind !== 'comment') n.comment = '';
    return n;
  }

  const createCase = () => ({ id: uid('c'), value: '', body: [] });

  function createFunction(name) {
    return { id: uid('f'), name, isMain: false, returnType: 'void', params: [], resultInit: '0', body: [] };
  }

  const createParam = () => ({ id: uid('p'), type: 'integer', name: '', byRef: false, doc: '' });

  function createProgram() {
    return { fns: [{ id: 'main', name: 'main', isMain: true, returnType: 'void', params: [], resultInit: '', body: [] }] };
  }

  /** Alle Kind-Sequenzen eines Blocks, jeweils mit Schlüssel (für Drag & Drop und Rendering). */
  function childSeqs(n) {
    switch (n.kind) {
      case 'if': return n.else ? [{ key: 'then', seq: n.then }, { key: 'else', seq: n.else }] : [{ key: 'then', seq: n.then }];
      case 'while': case 'until': case 'for': return [{ key: 'body', seq: n.body }];
      case 'switch': {
        const out = n.cases.map((c) => ({ key: 'case:' + c.id, seq: c.body, caseRef: c }));
        if (n.else) out.push({ key: 'else', seq: n.else });
        return out;
      }
      default: return [];
    }
  }

  /** Besucht alle Blöcke einer Sequenz rekursiv: fn(node, seq, index, depth). */
  function walkSeq(seq, fn, depth = 0) {
    for (let i = 0; i < seq.length; i++) {
      const n = seq[i];
      if (fn(n, seq, i, depth) === false) continue;
      for (const c of childSeqs(n)) walkSeq(c.seq, fn, depth + 1);
    }
  }

  function findNode(program, id) {
    for (const fn of program.fns) {
      let hit = null;
      walkSeq(fn.body, (n, seq, index) => {
        if (!hit && n.id === id) hit = { node: n, seq, index, fn };
      });
      if (hit) return hit;
    }
    return null;
  }

  function findFn(program, id) {
    return program.fns.find((f) => f.id === id) || null;
  }

  function fnOfNode(program, id) {
    const hit = findNode(program, id);
    return hit ? hit.fn : null;
  }

  /** Liefert die Sequenz zu (Besitzer, Schlüssel). Besitzer ist eine Funktions-ID oder Block-ID. */
  function getSeq(program, owner, key) {
    const fn = findFn(program, owner);
    if (fn) return fn.body;
    const hit = findNode(program, owner);
    if (!hit) return null;
    const n = hit.node;
    if (key === 'then') return n.then;
    if (key === 'else') return n.else;
    if (key === 'body') return n.body;
    if (key && key.startsWith('case:')) {
      const c = n.cases.find((x) => x.id === key.slice(5));
      return c ? c.body : null;
    }
    return null;
  }

  function contains(node, id) {
    let found = false;
    for (const c of childSeqs(node)) walkSeq(c.seq, (n) => { if (n.id === id) found = true; });
    return found;
  }

  /** Tiefe Kopie mit neuen IDs. */
  function cloneNode(n) {
    const c = JSON.parse(JSON.stringify(n));
    reId(c);
    return c;
  }

  function reId(n) {
    n.id = uid();
    if (n.kind === 'switch') n.cases.forEach((c) => { c.id = uid('c'); });
    for (const s of childSeqs(n)) s.seq.forEach(reId);
  }

  // ---------------------------------------------------------------- .bb-Format

  const TYPE_ALIASES = {
    integer: 'integer', string: 'string', number: 'integer', zahl: 'integer', text: 'string', int: 'integer'
  };

  /** Typnamen tolerant einlesen (alte Dateien enthielten teilweise Anzeigenamen wie "Number" oder "Zahl"). */
  function normType(t, allowVoid) {
    if (t == null) return allowVoid ? 'void' : 'integer';
    const s = String(t).trim();
    if (allowVoid && (s === '' || s.toLowerCase() === 'void')) return 'void';
    const arr = s.endsWith('[]');
    const base = TYPE_ALIASES[(arr ? s.slice(0, -2) : s).toLowerCase()];
    if (!base) return allowVoid ? 'void' : 'integer';
    return arr ? base + '[]' : base;
  }

  const str = (v) => (v == null ? '' : String(v).trim());
  const statementsOf = (s) => (s && Array.isArray(s.statements) ? s.statements : []);

  function seqFromBB(statements) {
    return statementsOf(statements).map(stmtFromBB).filter(Boolean);
  }

  function stmtFromBB(s) {
    if (!s || typeof s !== 'object') return null;
    const c = str(s.comment);
    switch (s.type) {
      case 'CommentStatement':
        return { id: uid(), kind: 'comment', text: str(s.comment) };
      case 'DeclarationStatement': {
        const vtype = normType(s.variableType);
        const isArr = vtype.endsWith('[]');
        const n = { id: uid(), kind: 'decl', vtype, name: str(s.variableName), init: isArr ? '' : str(s.initializationValue), length: isArr ? str(s.arrayLength) : '', comment: c };
        if (s.documentation) n.doc = String(s.documentation);
        return n;
      }
      case 'InputStatement':
        return { id: uid(), kind: 'input', prompt: str(s.prompt), target: str(s.variableName), comment: c };
      case 'OutputStatement':
        return { id: uid(), kind: 'output', expr: str(s.outputString), comment: c };
      case 'AssignmentStatement':
        return { id: uid(), kind: 'assign', target: str(s.variableName), expr: str(s.assignmentValue), comment: c };
      case 'IfStatement':
        return { id: uid(), kind: 'if', cond: str(s.condition), then: seqFromBB(s.thenStatements), else: s.elseStatements ? seqFromBB(s.elseStatements) : null, comment: c };
      case 'WhileStatement':
        return { id: uid(), kind: 'while', cond: str(s.condition), body: seqFromBB(s.loopStatements), comment: c };
      case 'DoWhileStatement':
        return { id: uid(), kind: 'until', cond: str(s.condition), body: seqFromBB(s.loopStatements), comment: c };
      case 'ForStatement':
        return { id: uid(), kind: 'for', counter: str(s.counterName), from: str(s.fromValue), to: str(s.toValue), step: str(s.counterShift) || '+1', body: seqFromBB(s.loopStatements), comment: c };
      case 'SwitchStatement':
        return {
          id: uid(), kind: 'switch', expr: str(s.variableName),
          cases: (Array.isArray(s.casesStatements) ? s.casesStatements : []).map((cs) => ({ id: uid('c'), value: str(cs.caseValue), body: seqFromBB(cs.caseStatements) })),
          else: s.elseStatements ? seqFromBB(s.elseStatements) : null, comment: c
        };
      case 'FunctionCallStatement':
        return { id: uid(), kind: 'call', fn: str(s.functionName), target: str(s.variableName), args: (Array.isArray(s.parameters) ? s.parameters : []).map((p) => str(p && p.value)), comment: c };
      default:
        return null;
    }
  }

  function fnFromBB(name, f) {
    const fn = createFunction(String(name));
    fn.returnType = normType(f.returnType, true);
    if (fn.returnType.endsWith('[]')) fn.returnType = 'void';
    fn.params = (Array.isArray(f.parameters) ? f.parameters : []).map((p) => {
      const type = normType(p.type);
      return { id: uid('p'), type, name: str(p.name), byRef: type.endsWith('[]') ? true : p.onlyIn === false, doc: str(p.documentation) };
    });
    fn.resultInit = fn.returnType === 'void' ? '0' : (str(f.resultInitializationValue) || (fn.returnType === 'string' ? '""' : '0'));
    fn.body = seqFromBB(f.statements);
    return fn;
  }

  /** Liest den Inhalt einer .bb-Datei. Wirft bei ungültigem JSON. */
  function parseBB(text) {
    const clean = String(text).replace(/^﻿/, '');
    const obj = JSON.parse(clean);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a diagram');
    return obj;
  }

  function programFromBB(obj) {
    const program = createProgram();
    if (obj.main) program.fns[0].body = seqFromBB(obj.main);
    for (const key of Object.keys(obj)) {
      if (key === 'main') continue;
      if (obj[key] && typeof obj[key] === 'object') program.fns.push(fnFromBB(key, obj[key]));
    }
    return program;
  }

  /** Nur die Unterprogramme aus einer Datei. */
  function functionsFromBB(obj) {
    return Object.keys(obj).filter((k) => k !== 'main' && obj[k] && typeof obj[k] === 'object').map((k) => fnFromBB(k, obj[k]));
  }

  const opt = (v) => (v ? v : undefined);

  function seqToBB(seq) {
    return { type: 'Statements', statements: seq.map(stmtToBB) };
  }

  function stmtToBB(n) {
    const comment = opt(n.comment);
    switch (n.kind) {
      case 'comment': return { type: 'CommentStatement', comment: n.text };
      case 'decl': {
        const isArray = n.vtype.endsWith('[]');
        const o = { type: 'DeclarationStatement', variableType: n.vtype, variableName: n.name };
        if (isArray) o.arrayLength = n.length; else o.initializationValue = n.init;
        if (n.doc) o.documentation = n.doc;
        o.isArray = isArray;
        o.comment = comment;
        return o;
      }
      case 'input': return { type: 'InputStatement', prompt: n.prompt, variableName: n.target, comment };
      case 'output': return { type: 'OutputStatement', outputString: n.expr, comment };
      case 'assign': return { type: 'AssignmentStatement', variableName: n.target, assignmentValue: n.expr, comment };
      case 'if': return { type: 'IfStatement', thenStatements: seqToBB(n.then), elseStatements: n.else ? seqToBB(n.else) : null, condition: n.cond, comment };
      case 'while': return { type: 'WhileStatement', condition: n.cond, loopStatements: seqToBB(n.body), comment };
      case 'until': return { type: 'DoWhileStatement', condition: n.cond, loopStatements: seqToBB(n.body), comment };
      case 'for': return { type: 'ForStatement', counterName: n.counter, fromValue: n.from, toValue: n.to, counterShift: n.step, loopStatements: seqToBB(n.body), comment };
      case 'switch': return {
        type: 'SwitchStatement', variableName: n.expr,
        casesStatements: n.cases.map((c) => ({ caseValue: c.value, caseStatements: seqToBB(c.body) })),
        elseStatements: n.else ? seqToBB(n.else) : null, comment
      };
      case 'call': return { type: 'FunctionCallStatement', variableName: opt(n.target), functionName: n.fn, parameters: n.args.map((value) => ({ value })), comment };
      default: throw new Error('unknown kind ' + n.kind);
    }
  }

  function programToBB(program) {
    const out = {};
    for (const fn of program.fns) {
      if (fn.isMain) {
        out.main = seqToBB(fn.body);
        continue;
      }
      const o = {
        parameters: fn.params.map((p) => {
          const po = { type: p.type, name: p.name, onlyIn: !p.byRef };
          if (p.doc) po.documentation = p.doc;
          return po;
        }),
        statements: seqToBB(fn.body),
        returnType: fn.returnType
      };
      if (fn.returnType !== 'void') o.resultInitializationValue = fn.resultInit;
      out[fn.name] = o;
    }
    return out;
  }

  /** Text für Zwischenablage / Kopieren einzelner Blöcke. */
  function clipboardPayload(nodes) {
    return JSON.stringify({ bbeClipboard: 1, statements: seqToBB(nodes) });
  }

  function clipboardNodes(text) {
    try {
      const o = JSON.parse(text);
      if (o && o.bbeClipboard) return seqFromBB(o.statements);
    } catch (e) { /* kein Blockbild-Inhalt */ }
    return null;
  }

  BBE.model = {
    uid, KINDS, CATEGORY, COMPONENTS,
    createNode, createCase, createFunction, createParam, createProgram,
    childSeqs, walkSeq, findNode, findFn, fnOfNode, getSeq, contains, cloneNode,
    normType, parseBB, programFromBB, functionsFromBB, programToBB, seqToBB, seqFromBB,
    clipboardPayload, clipboardNodes
  };
})(typeof window !== 'undefined' ? window : globalThis);
