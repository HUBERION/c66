// Grenzfälle für Parser, Interpreter, Prüfung und C-Generator.
// Aufruf: node tests/unit.cjs [ausgabe-ordner-fuer-c]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const BBE = require('./load.cjs');
const { model: M, expr: E, interp: I, analyze: A, cgen: C } = BBE;

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.log('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
};
const S = (...st) => ({ type: 'Statements', statements: st });
const decl = (t, n, init) => ({ type: 'DeclarationStatement', variableType: t, variableName: n, initializationValue: init, isArray: false });
const arr = (t, n, len) => ({ type: 'DeclarationStatement', variableType: t, variableName: n, arrayLength: len, isArray: true });
const set = (v, e) => ({ type: 'AssignmentStatement', variableName: v, assignmentValue: e });
const out = (e) => ({ type: 'OutputStatement', outputString: e });
const inp = (p, v) => ({ type: 'InputStatement', prompt: p, variableName: v });
const call = (fn, args, target) => ({ type: 'FunctionCallStatement', functionName: fn, parameters: args.map((value) => ({ value })), variableName: target });
const IF = (c, t, e) => ({ type: 'IfStatement', condition: c, thenStatements: S(...t), elseStatements: e ? S(...e) : null });
const FOR = (v, a, b, s, ...body) => ({ type: 'ForStatement', counterName: v, fromValue: a, toValue: b, counterShift: s, loopStatements: S(...body) });
const SW = (v, cases, els) => ({ type: 'SwitchStatement', variableName: v, casesStatements: cases.map(([c, b]) => ({ caseValue: c, caseStatements: S(...b) })), elseStatements: els ? S(...els) : null });
const fnDef = (rt, params, init, ...body) => ({ parameters: params, statements: S(...body), returnType: rt, resultInitializationValue: init });
const par = (type, name, inout) => ({ type, name, onlyIn: !inout });
const prog = (o) => M.programFromBB(JSON.parse(JSON.stringify(o)));

// ---------------------------------------------------------------- Parser
test('parser: precedence and parens', () => {
  const a = E.parse('1 + 2 * (3 - x) >= 4 && !ok');
  assert.strictEqual(a.op, '&&');
  assert.strictEqual(a.a.op, '>=');
});
test('parser: single = is explained', () => {
  assert.throws(() => E.parse('a = 3'), (e) => e.key === 'exprSingleEquals');
});
test('parser: unterminated string', () => {
  assert.throws(() => E.parse('"abc'), (e) => e.key === 'exprUnterminatedString');
});
test('parser: <> suggests !=', () => {
  assert.throws(() => E.parse('a <> b'), (e) => e.key === 'exprUseNotEqual');
});
test('parser: target must be variable or element', () => {
  assert.ok(E.parseTarget('werte[i + 1]'));
  assert.throws(() => E.parseTarget('a + 1'), (e) => e.key === 'exprNotAssignable');
});

// ---------------------------------------------------------------- Interpreter
test('run: for with negative step counts down', () => {
  const p = prog({ main: S(decl('integer', 'i', '0'), decl('string', 's', '""'), FOR('i', '5', '1', '-2', set('s', 's + i')), out('s')) });
  assert.deepStrictEqual(BBE.runProgram(p).out, ['531']);
});
test('run: division by zero reports error with snapshot', () => {
  const p = prog({ main: S(decl('integer', 'a', '4'), decl('integer', 'b', '0'), set('a', 'a / b')) });
  let err;
  try { BBE.runProgram(p); } catch (e) { err = e; }
  assert.ok(err instanceof I.RunError);
  assert.strictEqual(err.key, 'rDivZero');
  assert.strictEqual(err.snapshot[0].vars.length, 2);
});
test('run: index out of range', () => {
  const p = prog({ main: S(arr('integer[]', 'a', '3'), set('a[3]', '1')) });
  assert.throws(() => BBE.runProgram(p), (e) => e.key === 'rIndexRange');
});
test('run: endless recursion becomes stack overflow', () => {
  const p = prog({ main: S(call('f', [])), f: fnDef('void', [], undefined, call('f', [])) });
  assert.throws(() => BBE.runProgram(p, [], { maxSteps: 100000 }), (e) => e.key === 'rStackOverflow');
});
test('run: array element passed by reference', () => {
  const p = prog({
    main: S(arr('integer[]', 'z', '3'), set('z[1]', '5'), call('inc', ['z[1]']), out('z[1]')),
    inc: fnDef('void', [par('integer', 'x', true)], undefined, set('x', 'x + 10'))
  });
  assert.deepStrictEqual(BBE.runProgram(p).out, ['15']);
});
test('run: text function result and text InOut', () => {
  const p = prog({
    main: S(decl('string', 'n', '"Ada"'), decl('string', 'g', '""'), call('gruss', ['n'], 'g'), call('anhaengen', ['g']), out('g')),
    gruss: fnDef('string', [par('string', 'name', false)], '""', set('result', '"Hallo " + name')),
    anhaengen: fnDef('void', [par('string', 't', true)], undefined, set('t', 't + "!"'))
  });
  assert.deepStrictEqual(BBE.runProgram(p).out, ['Hallo Ada!']);
});
test('run: text In parameter is a copy', () => {
  const p = prog({
    main: S(decl('string', 'a', '"x"'), call('aendern', ['a']), out('a')),
    aendern: fnDef('void', [par('string', 's', false)], undefined, set('s', '"geändert"'), out('s'))
  });
  assert.deepStrictEqual(BBE.runProgram(p).out, ['geändert', 'x']);
});
test('run: switch on text with else', () => {
  const p = prog({ main: S(decl('string', 'w', '"b"'), SW('w', [['"a"', [out('1')]], ['"b"', [out('2')]]], [out('3')])) });
  assert.deepStrictEqual(BBE.runProgram(p).out, ['2']);
});
test('run: cancelled input keeps start value', () => {
  const p = prog({ main: S(decl('integer', 'n', '7'), inp('"n: "', 'n'), out('n')) });
  const outv = [];
  const it = new I.Interpreter(p, { output: (s) => outv.push(s) });
  const gen = it.run();
  let r = gen.next();
  while (r.value.type !== 'input') r = gen.next();
  r = gen.next(null);
  while (!r.done) r = gen.next();
  assert.deepStrictEqual(outv, ['7']);
});
test('run: breakpoint yields before the block', () => {
  const p = prog({ main: S(decl('integer', 'n', '1'), set('n', '2')) });
  const target = p.fns[0].body[1].id;
  const it = new I.Interpreter(p, { breakpoints: new Set([target]) });
  const gen = it.run();
  let r = gen.next();
  while (r.value.type !== 'break') r = gen.next();
  assert.strictEqual(r.value.nodeId, target);
  assert.strictEqual(it.frames[0].vars.get('n').cell.value, 1);
});
test('run: skipChecks hides condition steps', () => {
  const p = prog({ main: S(decl('integer', 'i', '0'), { type: 'WhileStatement', condition: 'i < 3', loopStatements: S(set('i', 'i + 1')) }) });
  const normal = BBE.runProgram(p).steps;
  const skip = BBE.runProgram(p, [], { skipChecks: true }).steps;
  assert.ok(skip < normal, skip + ' < ' + normal);
});
test('run: number input with decimals and text concatenation like JS', () => {
  const p = prog({ main: S(decl('integer', 'x', '0'), inp('""', 'x'), out('"x=" + x * 2 + 1')) });
  assert.deepStrictEqual(BBE.runProgram(p, ['1.5']).out, ['x=31']);
});
test('run: declaration later in function is reported', () => {
  const p = prog({ main: S(set('a', '1'), decl('integer', 'a', '0')) });
  assert.throws(() => BBE.runProgram(p), (e) => e.key === 'rNotYetDeclared');
});

// ---------------------------------------------------------------- Prüfung
test('check: unknown variable and empty fields', () => {
  const p = prog({ main: S(set('x', 'y + 1'), out('')) });
  const keys = A.analyze(p).problems.map((x) => x.key).sort();
  assert.deepStrictEqual(keys, ['pEmpty', 'pUnknownVar', 'pUnknownVar']);
});
test('check: call with unknown function and wrong InOut argument', () => {
  const p = prog({
    main: S(call('nix', []), call('f', ['1 + 2'])),
    f: fnDef('void', [par('integer', 'a', true)], undefined)
  });
  const keys = A.analyze(p).problems.map((x) => x.key).sort();
  assert.deepStrictEqual(keys, ['exprNotAssignable', 'pUnknownFunction']);
});
test('check: original examples format round trip keeps file keys', () => {
  const p = prog({ main: S(decl('integer', 'n', '0')), f: fnDef('integer', [par('integer[]', 'a', true)], '0') });
  const bb = M.programToBB(p);
  assert.deepStrictEqual(Object.keys(bb), ['main', 'f']);
  assert.strictEqual(bb.f.parameters[0].onlyIn, false);
  assert.strictEqual(bb.main.statements[0].isArray, false);
});
test('model: display type names from old files are accepted', () => {
  const p = prog({ main: S(), f: { parameters: [{ type: 'Zahl', name: 'x', onlyIn: true }, { type: 'Text[]', name: 't', onlyIn: false }], statements: S(), returnType: 'Number', resultInitializationValue: '0' } });
  assert.strictEqual(p.fns[1].params[0].type, 'integer');
  assert.strictEqual(p.fns[1].params[1].type, 'string[]');
  assert.strictEqual(p.fns[1].returnType, 'integer');
});

// ---------------------------------------------------------------- C-Code für gcc
const tricky = prog({
  main: S(
    decl('string', 'name', '"Ada"'),
    decl('string', 'gruss', '""'),
    decl('integer', 'n', '3'),
    arr('string[]', 'woerter', 'n'),
    arr('integer[]', 'z', '4'),
    call('gruss_fuer', ['name'], 'gruss'),
    call('anhaengen', ['gruss']),
    out('gruss'),
    FOR('n', '0', 'woerter.length - 1', '+1', set('woerter[n]', '"w" + n')),
    out('woerter[2] + " " + woerter.length + " " + name.length'),
    IF('name == "Ada"', [decl('integer', 'innen', '5'), set('innen', 'innen * 2'), out('innen')], [out('"?"')]),
    set('z[1]', '41'),
    call('inc', ['z[1]']),
    out('"z1=" + z[1]'),
    SW('name', [['"Bob"', [out('"bob"')]], ['"Ada"', [out('"ada"')]]], [out('"else"')]),
    { type: 'WhileStatement', condition: 'name + "x" != "Adaxx"', loopStatements: S(set('name', 'name + "x"')) },
    out('name'),
    set('name', 'name + name'),
    out('name'),
    FOR('n', '10', '0', '-5', out('n'))
  ),
  gruss_fuer: fnDef('string', [par('string', 'wer', false)], '""', set('wer', '"liebe " + wer'), set('result', '"Hallo " + wer')),
  anhaengen: fnDef('void', [par('string', 't', true)], undefined, set('t', 't + "!"')),
  inc: fnDef('void', [par('integer', 'x', true)], undefined, set('x', 'x + 1'))
});
test('run: tricky program', () => {
  const res = BBE.runProgram(tricky);
  assert.deepStrictEqual(res.out, ['Hallo liebe Ada!', 'w2 3 3', '10', 'z1=42', 'ada', 'Adax', 'AdaxAdax', '10', '5', '0']);
});
test('check: tricky program has no errors', () => {
  const an = A.analyze(tricky);
  assert.strictEqual(an.count.error, 0, JSON.stringify(an.problems));
});
const cdir = process.argv[2];
if (cdir) {
  fs.writeFileSync(path.join(cdir, 'tricky.c'), C.generate(tricky, { t: BBE.i18n.t }));
  fs.writeFileSync(path.join(cdir, 'tricky.expected'), BBE.runProgram(tricky).out.join('\n') + '\n');
}

console.log(passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
