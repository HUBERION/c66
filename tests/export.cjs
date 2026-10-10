// Prüft den Python- und Java-Export: Simulation vs. echtes Python bzw. javac/java.
// Programme: alle eingebauten Beispiele (DE + EN), die übersetzten tests/python/*.py
// und optional ein Ordner mit alten .bb-Dateien.
// Aufruf: node tests/export.cjs [ordner-mit-.bb-dateien]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BBE = require('./load.cjs');

const py = process.platform === 'win32' ? 'py' : 'python3';
const hasJava = spawnSync('javac', ['-version']).status === 0;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bbe-export-'));

const inputsFor = {
  hello: [], eva: [7, 3], even: [-9], loops: [6], grade: [8, 0, 2], max: [4, 11], ggt: [-48, 18],
  swap: [], quick: [], fak: [6], avg: [3, 4, 8, 15], sort: [], words: { de: ['Ada', 'vielleicht', 'ja'], en: ['Ada', 'maybe', 'yes'] }
};

const cases = [];
for (const lang of ['de', 'en']) {
  for (const ex of BBE.examples.list) {
    const inp = Array.isArray(inputsFor[ex.id]) ? inputsFor[ex.id] : inputsFor[ex.id][lang];
    cases.push({ name: lang + '_' + ex.id, lang, bb: BBE.examples.build(ex.id, lang), inputs: inp.map(String) });
  }
}
const pyDir = path.join(__dirname, 'python');
for (const f of fs.readdirSync(pyDir).filter((x) => x.endsWith('.py')).sort()) {
  const inFile = path.join(pyDir, f.replace(/\.py$/, '.in'));
  const inputs = fs.existsSync(inFile) ? fs.readFileSync(inFile, 'utf8').split('\n').filter((l, i, a) => i < a.length - 1 || l !== '') : [];
  cases.push({ name: 'py_' + f.replace(/\.py$/, ''), lang: 'de', bb: BBE.pyimport.convert(fs.readFileSync(path.join(pyDir, f), 'utf8'), { t: BBE.i18n.t }).bb, inputs });
}
const oldDir = process.argv[2];
if (oldDir) {
  const oldInputs = { Example002_IO: [40], Example003_If: [-7], Example005_Loops_RangeCheck: [9, 3, 7, 2], Example006_Switch: [2], Example007_Loop_and_Function: [4],
    Example008_Euklid_with_Functions: [-12, 18], Example009_CallByReference: [4], Example009_RekursiveSumme: [5], Example010a_ArrayRuntimeLength: [3, 7], Example010b_Arrays_DynamicLength: [3, 7] };
  for (const f of fs.readdirSync(oldDir).filter((x) => x.endsWith('.bb')).sort()) {
    const n = f.replace(/\.bb$/, '');
    cases.push({ name: 'old_' + n, lang: 'en', bb: BBE.model.parseBB(fs.readFileSync(path.join(oldDir, f), 'utf8')), inputs: (oldInputs[n] || []).map(String) });
  }
}

/** Ausgabe ohne die Eingabe-Fragen (die stehen ohne Zeilenumbruch vor der Eingabe). */
function stripPrompts(stdout, prompts) {
  let s = stdout.replace(/\r/g, '');
  for (const p of prompts) {
    if (!p) continue;
    const i = s.indexOf(p);
    if (i >= 0) s = s.slice(0, i) + s.slice(i + p.length);
  }
  return s.replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === ''));
}

let fail = 0;
for (const c of cases) {
  BBE.i18n.lang = c.lang;
  const program = BBE.model.programFromBB(JSON.parse(JSON.stringify(c.bb)));
  // Simulation (mit den Fragen, die gestellt werden)
  const prompts = [];
  const out = [];
  const it = new BBE.interp.Interpreter(program, { output: (s) => out.push(s) });
  const gen = it.run();
  const queue = c.inputs.slice();
  let send, r;
  while (!(r = gen.next(send)).done) {
    send = undefined;
    if (r.value.type === 'input') { prompts.push(r.value.prompt); send = queue.shift(); }
  }
  const stdin = c.inputs.join('\n') + '\n';
  const results = [];

  // Python
  const pyFile = path.join(work, c.name + '.py');
  fs.writeFileSync(pyFile, BBE.pygen.generate(program, { t: BBE.i18n.t }));
  const pr = spawnSync(py, ['-X', 'utf8', pyFile], { input: stdin, encoding: 'utf8' });
  if (pr.status !== 0) results.push('PY-ERROR ' + pr.stderr.trim().split('\n').slice(-1)[0]);
  else {
    const got = stripPrompts(pr.stdout, prompts);
    results.push(JSON.stringify(got) === JSON.stringify(out) ? 'py ok' : 'PY-DIFF ' + JSON.stringify(got) + ' vs ' + JSON.stringify(out));
  }

  // Java
  if (hasJava) {
    const cls = BBE.javagen.className(c.name);
    const dir = path.join(work, c.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, cls + '.java'), BBE.javagen.generate(program, { t: BBE.i18n.t, className: cls }));
    const jc = spawnSync('javac', ['-encoding', 'UTF-8', '-Xlint:all', cls + '.java'], { cwd: dir, encoding: 'utf8' });
    if (jc.status !== 0) results.push('JAVAC-ERROR ' + jc.stderr.trim().split('\n').slice(0, 3).join(' | '));
    else {
      const jr = spawnSync('java', ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', dir, cls], { input: stdin, encoding: 'utf8' });
      if (jr.status !== 0) results.push('JAVA-ERROR ' + jr.stderr.trim().split('\n')[0]);
      else {
        const got = stripPrompts(jr.stdout, prompts);
        results.push(JSON.stringify(got) === JSON.stringify(out) ? 'java ok' : 'JAVA-DIFF ' + JSON.stringify(got) + ' vs ' + JSON.stringify(out));
      }
      if (jc.stderr.trim()) results.push('javac-warn: ' + jc.stderr.trim().split('\n')[0]);
    }
  }
  const bad = results.some((x) => /ERROR|DIFF/.test(x));
  if (bad) fail++;
  console.log((bad ? 'FAIL ' : 'ok   ') + c.name.padEnd(42) + results.join('  '));
}
console.log(hasJava ? '' : '(javac nicht gefunden – Java-Export nicht geprüft)');
console.log('Dateien: ' + work);
process.exit(fail ? 1 : 0);
