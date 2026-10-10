// Prüft den Export nach Python, Java, C#, C++, JavaScript, Fortran und COBOL: echte Compiler/Interpreter gegen die Simulation.
// Programme: alle eingebauten Beispiele (DE + EN), die übersetzten tests/python/*.py
// und optional ein Ordner mit alten .bb-Dateien.
//   node tests/export.cjs [ordner-mit-.bb-dateien]
// Benötigt (fehlende Werkzeuge werden übersprungen): python/py, javac+java, dotnet (SDK 6+), node,
// g++, gfortran, cobc (GnuCOBOL) – direkt oder unter Windows über WSL.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BBE = require('./load.cjs');

const win = process.platform === 'win32';
const py = win ? 'py' : 'python3';
const ok = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0; } catch (e) { return false; } };
const tools = {
  python: ok(py, ['--version']),
  java: ok('javac', ['-version']),
  cs: ok('dotnet', ['--list-sdks']),
  js: true
};
const unix = (cmd) => (ok(cmd, ['--version']) ? 'native' : (win && ok('wsl', ['-e', cmd, '--version']) ? 'wsl' : null));
tools.cpp = unix('g++');
tools.fortran = unix('gfortran');
tools.cobol = unix('cobc');
// nur bestimmte Sprachen prüfen:  BBE_ONLY=cobol,fortran node tests/export.cjs
if (process.env.BBE_ONLY) for (const k of Object.keys(tools)) if (!process.env.BBE_ONLY.split(',').includes(k)) tools[k] = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bbe-export-'));

// ------------------------------------------------------------------ Programme sammeln
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
if (process.argv[2]) {
  const oldDir = process.argv[2];
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

// ------------------------------------------------------------------ Simulation + Quelltexte erzeugen
const csDir = path.join(work, 'cs');
const dirs = { cpp: path.join(work, 'cpp'), fortran: path.join(work, 'f90'), cobol: path.join(work, 'cob') };
fs.mkdirSync(csDir);
for (const d of Object.values(dirs)) fs.mkdirSync(d);
for (const c of cases) {
  BBE.i18n.lang = c.lang;
  const program = BBE.model.programFromBB(JSON.parse(JSON.stringify(c.bb)));
  c.prompts = [];
  c.expected = [];
  const it = new BBE.interp.Interpreter(program, { output: (s) => c.expected.push(s) });
  const gen = it.run();
  const queue = c.inputs.slice();
  let send, r;
  while (!(r = gen.next(send)).done) {
    send = undefined;
    if (r.value.type === 'input') { c.prompts.push(r.value.prompt); send = queue.shift(); }
  }
  c.stdin = c.inputs.join('\n') + '\n';
  c.cls = BBE.javagen.className(c.name);
  c.results = [];
  fs.writeFileSync(path.join(work, c.name + '.py'), BBE.pygen.generate(program, { t: BBE.i18n.t }));
  fs.mkdirSync(path.join(work, c.name), { recursive: true });
  fs.writeFileSync(path.join(work, c.name, c.cls + '.java'), BBE.javagen.generate(program, { t: BBE.i18n.t, className: c.cls }));
  fs.writeFileSync(path.join(csDir, c.cls + '.cs'), BBE.csgen.generate(program, { t: BBE.i18n.t, className: c.cls }));
  fs.writeFileSync(path.join(work, c.name + '.js'), BBE.jsgen.generate(program, { t: BBE.i18n.t }));
  fs.writeFileSync(path.join(dirs.cpp, c.name + '.cpp'), BBE.cppgen.generate(program, { t: BBE.i18n.t }));
  fs.writeFileSync(path.join(dirs.fortran, c.name + '.f90'), BBE.fortgen.generate(program, { t: BBE.i18n.t }));
  if (BBE.cobolgen) fs.writeFileSync(path.join(dirs.cobol, c.name + '.cob'), BBE.cobolgen.generate(program, { t: BBE.i18n.t }));
  for (const d of Object.values(dirs)) fs.writeFileSync(path.join(d, c.name + '.in'), c.stdin);
}

const compare = (c, label, stdout) => {
  const got = stripPrompts(stdout, c.prompts);
  c.results.push(JSON.stringify(got) === JSON.stringify(c.expected) ? label + ' ok' : label.toUpperCase() + '-DIFF ' + JSON.stringify(got) + ' vs ' + JSON.stringify(c.expected));
};

// ------------------------------------------------------------------ Python und Java
for (const c of cases) {
  if (tools.python) {
    const pr = spawnSync(py, ['-X', 'utf8', path.join(work, c.name + '.py')], { input: c.stdin, encoding: 'utf8' });
    if (pr.status !== 0) c.results.push('PY-ERROR ' + pr.stderr.trim().split('\n').slice(-1)[0]); else compare(c, 'py', pr.stdout);
  }
  if (tools.js) {
    const jr = spawnSync(process.execPath, [path.join(work, c.name + '.js')], { input: c.stdin, encoding: 'utf8' });
    if (jr.status !== 0) c.results.push('JS-ERROR ' + jr.stderr.trim().split('\n').slice(0, 5).join(' | ')); else compare(c, 'js', jr.stdout);
  }
  if (tools.java) {
    const dir = path.join(work, c.name);
    const jc = spawnSync('javac', ['-encoding', 'UTF-8', '-Xlint:all', c.cls + '.java'], { cwd: dir, encoding: 'utf8' });
    if (jc.status !== 0) c.results.push('JAVAC-ERROR ' + jc.stderr.trim().split('\n').slice(0, 3).join(' | '));
    else {
      const jr = spawnSync('java', ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', dir, c.cls], { input: c.stdin, encoding: 'utf8' });
      if (jr.status !== 0) c.results.push('JAVA-ERROR ' + jr.stderr.trim().split('\n')[0]); else compare(c, 'java', jr.stdout);
    }
  }
}

// ------------------------------------------------------------------ C#: ein Projekt, alle Programme, Start über Reflection
if (tools.cs) {
  fs.writeFileSync(path.join(csDir, 'run.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings><StartupObject>Runner</StartupObject><NoWarn>CS7022</NoWarn>
  </PropertyGroup>
</Project>
`);
  fs.writeFileSync(path.join(csDir, 'Runner.cs'), `using System; using System.Reflection;
class Runner { static void Main(string[] a) {
  Console.OutputEncoding = System.Text.Encoding.UTF8;
  Type.GetType(a[0])!.GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)!.Invoke(null, null);
} }
`);
  const b = spawnSync('dotnet', ['build', '-nologo', '-v', 'q', '-o', path.join(csDir, 'bin')], { cwd: csDir, encoding: 'utf8' });
  const warn = (b.stdout.match(/warning [A-Z]+\d+[^\r\n]*/g) || []).filter((w) => !/Runner/.test(w));
  if (b.status !== 0) {
    const errs = b.stdout.split('\n').filter((l) => / error /.test(l));
    for (const c of cases) {
      const mine = errs.filter((l) => l.includes(c.cls + '.cs'));
      c.results.push(mine.length ? 'CS-ERROR ' + mine[0].trim().slice(0, 200) : 'cs (Build fehlgeschlagen)');
    }
  } else {
    for (const c of cases) {
      const r = spawnSync('dotnet', [path.join(csDir, 'bin', 'run.dll'), c.cls], { input: c.stdin, encoding: 'utf8' });
      if (r.status !== 0) c.results.push('CS-ERROR ' + r.stderr.trim().split('\n')[0]); else compare(c, 'cs', r.stdout);
      const mw = warn.filter((w) => w.includes(c.cls + '.cs'));
      if (mw.length) c.results.push('cs-warn: ' + mw[0].slice(0, 160));
    }
  }
}

// ------------------------------------------------------------------ C++, Fortran, COBOL (unter Windows über WSL)
function runUnix(lang, ext, compile) {
  const dir = dirs[lang];
  const script = 'ulimit -f 20000; cd "$1"; for f in *' + ext + '; do n=${f%' + ext + '}; if ' + compile + ' 2> "$n.err"; then timeout 10 "/tmp/bbe_$n" < "$n.in" > "$n.out" 2>> "$n.err"; ' +
    'echo $? > "$n.code"; else echo compile > "$n.code"; fi; done';
  fs.writeFileSync(path.join(dir, 'run.sh'), script);
  if (tools[lang] === 'wsl') {
    const wp = spawnSync('wsl', ['wslpath', '-a', dir.replace(/\\/g, '/')], { encoding: 'utf8' }).stdout.trim();
    spawnSync('wsl', ['sh', wp + '/run.sh', wp], { encoding: 'utf8', env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1' }) });
  } else {
    spawnSync('sh', [path.join(dir, 'run.sh'), dir], { encoding: 'utf8' });
  }
  const tag = { cpp: 'cpp', fortran: 'f90', cobol: 'cob' }[lang];
  for (const c of cases) {
    const read = (e) => { const p = path.join(dir, c.name + e); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
    const code = read('.code').trim();
    const err = read('.err').split('\n').filter((l) => !/_FORTIFY_SOURCE|command-line>/.test(l)).join('\n').trim();
    if (code === 'compile') c.results.push(tag.toUpperCase() + '-COMPILE ' + (err.split('\n').filter((l) => /rror/.test(l)).slice(0, 2).join(' | ') || err).slice(0, 300));
    else if (code !== '0') c.results.push(tag.toUpperCase() + '-ERROR exit ' + code + ' ' + err.split('\n').slice(0, 3).join(' | '));
    else compare(c, tag, read('.out'));
    const w = err.split('\n').filter((l) => /[Ww]arning/.test(l));
    if (code !== 'compile' && w.length) c.results.push(tag + '-warn: ' + w[0].replace(/^.*?[Ww]arning: /, '').slice(0, 120));
  }
}
if (tools.cpp) runUnix('cpp', '.cpp', 'g++ -std=c++11 -Wall -Wextra -o "/tmp/bbe_$n" "$f"');
if (tools.fortran) runUnix('fortran', '.f90', 'gfortran -std=f2008 -Wall -Wextra -o "/tmp/bbe_$n" "$f"');
if (tools.cobol && BBE.cobolgen) runUnix('cobol', '.cob', 'cp "$f" /tmp/bbe_prog.cob && cobc -x -Wall -o "/tmp/bbe_$n" /tmp/bbe_prog.cob');

// ------------------------------------------------------------------ Ergebnis
let fail = 0;
for (const c of cases) {
  const bad = c.results.some((x) => /ERROR|DIFF|COMPILE|fehlgeschlagen/.test(x));
  if (bad) fail++;
  console.log((bad ? 'FAIL ' : 'ok   ') + c.name.padEnd(40) + c.results.join('  '));
}
const missing = Object.entries(tools).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) console.log('Nicht geprüft (Werkzeug fehlt): ' + missing.join(', '));
console.log(cases.length + ' Programme, ' + fail + ' mit Fehlern · Dateien: ' + work);
process.exit(fail ? 1 : 0);
