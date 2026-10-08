// Lädt die Original-Beispiele (.bb) und prüft Simulation, Rundreise und C-Code.
// Aufruf: node tests/smoke-original.cjs <ordner-mit-bb-dateien> [ausgabe-ordner-fuer-c]
const fs = require('fs');
const path = require('path');
const BBE = require('./load.cjs');

const dir = process.argv[2];
const cdir = process.argv[3];
const inputs = {
  'Example002_IO.bb': [40],
  'Example003_If.bb': [-7],
  'Example005_Loops_RangeCheck.bb': [9, 3, 7, 2],
  'Example006_Switch.bb': [2],
  'Example007_Loop_and_Function.bb': [4],
  'Example008_Euklid_with_Functions.bb': [-12, 18],
  'Example009_CallByReference.bb': [4],
  'Example009_RekursiveSumme.bb': [5],
  'Example010a_ArrayRuntimeLength.bb': [3, 7],
  'Example010b_Arrays_DynamicLength.bb': [3, 7]
};

let fail = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.bb')).sort()) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const obj = BBE.model.parseBB(text);
  const program = BBE.model.programFromBB(obj);
  const an = BBE.analyze.analyze(program);
  let res;
  try {
    res = BBE.runProgram(program, inputs[f] || []);
  } catch (e) {
    fail++;
    console.log('FAIL', f, e.key || e.message, e.args || '');
    continue;
  }
  // Rundreise: speichern und wieder laden muss dieselbe Ausgabe liefern
  const again = BBE.model.programFromBB(JSON.parse(JSON.stringify(BBE.model.programToBB(program))));
  const res2 = BBE.runProgram(again, inputs[f] || []);
  const same = JSON.stringify(res.out) === JSON.stringify(res2.out);
  if (!same) fail++;
  const c = BBE.cgen.generate(program, { t: BBE.i18n.t });
  if (cdir) fs.writeFileSync(path.join(cdir, f.replace(/\.bb$/, '.c')), c);
  const probs = an.problems.map((p) => `${p.sev}:${p.key}(${p.args.join(',')})`).join(' ');
  console.log((same ? 'ok  ' : 'DIFF') + ' ' + f.padEnd(40) + ' steps=' + String(res.steps).padStart(4) + ' | ' + res.out.join(' / ') + (probs ? '   [' + probs + ']' : ''));
}
process.exit(fail ? 1 : 0);
