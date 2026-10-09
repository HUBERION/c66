// Führt alle eingebauten Beispiele aus (DE + EN), prüft die Live-Prüfung und schreibt C-Code + Eingaben.
// Aufruf: node tests/examples.cjs [ausgabe-ordner-fuer-c]
const fs = require('fs');
const path = require('path');
const BBE = require('./load.cjs');

const cdir = process.argv[2];
const inputs = {
  hello: [], eva: [7, 3], even: [-9], loops: [6], grade: [8, 0, 2], max: [4, 11], ggt: [-48, 18],
  swap: [], quick: [], fak: [6], avg: [3, 4, 8, 15], sort: [], words: { de: ['Ada', 'vielleicht', 'ja'], en: ['Ada', 'maybe', 'yes'] }
};

let fail = 0;
for (const lang of ['de', 'en']) {
  BBE.i18n.lang = lang;
  for (const ex of BBE.examples.list) {
    const program = BBE.model.programFromBB(BBE.examples.build(ex.id, lang));
    const an = BBE.analyze.analyze(program);
    const inp = Array.isArray(inputs[ex.id]) ? inputs[ex.id] : inputs[ex.id][lang];
    let res;
    try {
      res = BBE.runProgram(program, inp);
    } catch (e) {
      fail++;
      console.log('FAIL', lang, ex.id, e.key || e.message, e.args || '');
      continue;
    }
    const probs = an.problems.map((p) => `${p.sev}:${p.key}(${p.args.join(',')})@${p.field}`).join(' ');
    if (an.count.error) fail++;
    console.log(lang + ' ' + ex.id.padEnd(6) + ' steps=' + String(res.steps).padStart(4) + ' | ' + res.out.join(' / ') + (probs ? '   [' + probs + ']' : ''));
    if (cdir) {
      fs.writeFileSync(path.join(cdir, lang + '_' + ex.id + '.c'), BBE.cgen.generate(program, { t: BBE.i18n.t }));
      fs.writeFileSync(path.join(cdir, lang + '_' + ex.id + '.in'), inp.join('\n') + '\n');
    }
  }
}
process.exit(fail ? 1 : 0);
