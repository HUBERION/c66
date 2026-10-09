// Übersetzt die Python-Beispiele in tests/python/ und vergleicht die Ausgabe mit echtem Python.
// Aufruf: node tests/python.cjs [python-befehl]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const BBE = require('./load.cjs');

const dir = path.join(__dirname, 'python');
const py = process.argv[2] || (process.platform === 'win32' ? 'py' : 'python3');
// input() ohne Ausgabe der Frage, damit nur print-Ausgaben verglichen werden
const runner = "import builtins,sys\nbuiltins.input=lambda p='': sys.stdin.readline().rstrip('\\n')\nexec(compile(open(sys.argv[1],encoding='utf-8').read(),sys.argv[1],'exec'),{'__name__':'__main__'})";

let fail = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.py')).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const inFile = path.join(dir, f.replace(/\.py$/, '.in'));
  const input = fs.existsSync(inFile) ? fs.readFileSync(inFile, 'utf8') : '';
  const inputs = input.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '');

  const real = spawnSync(py, ['-X', 'utf8', '-c', runner, path.join(dir, f)], { input, encoding: 'utf8' });
  if (real.status !== 0) { console.log('PYTHON FAIL', f, real.stderr); fail++; continue; }
  const expected = real.stdout.replace(/\r/g, '').replace(/\n$/, '').split('\n');

  let res, conv;
  try {
    conv = BBE.pyimport.convert(src, { t: BBE.i18n.t });
    const program = BBE.model.programFromBB(JSON.parse(JSON.stringify(conv.bb)));
    const an = BBE.analyze.analyze(program);
    if (an.count.error) console.log('  check errors:', an.problems.filter((p) => p.sev === 'error').map((p) => p.key + '(' + p.args + ')@' + p.field).join(' '));
    res = BBE.runProgram(program, inputs);
  } catch (e) {
    console.log('FAIL', f, e.key || e.message, e.args || '', e.line || '', e.stack && !e.key ? e.stack.split('\n').slice(0, 3).join(' | ') : '');
    fail++;
    continue;
  }
  const same = JSON.stringify(res.out) === JSON.stringify(expected);
  if (!same) fail++;
  console.log((same ? 'ok  ' : 'DIFF') + ' ' + f + (conv.warnings.length ? '  [' + conv.warnings.map((w) => w.line + ':' + w.key).join(', ') + ']' : ''));
  if (!same) {
    console.log('   python: ' + JSON.stringify(expected));
    console.log('   blocks: ' + JSON.stringify(res.out));
  }
}
process.exit(fail ? 1 : 0);
