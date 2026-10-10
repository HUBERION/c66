// Lädt die Kernmodule (ohne Browser) für Tests in Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js', 'core');
for (const f of ['i18n.js', 'expr.js', 'model.js', 'analyze.js', 'interp.js', 'cgen.js', 'pygen.js', 'javagen.js', 'csgen.js', 'cppgen.js', 'jsgen.js', 'fortgen.js', 'cobolgen.js', 'examples.js', 'pyimport.js']) {
  const file = path.join(root, f);
  if (!fs.existsSync(file)) continue;
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
module.exports = globalThis.BBE;

/** Führt ein Programm komplett aus; inputs werden der Reihe nach verbraucht. */
module.exports.runProgram = function runProgram(program, inputs = [], opts = {}) {
  const BBE = globalThis.BBE;
  const out = [];
  const it = new BBE.interp.Interpreter(program, { output: (s) => out.push(s), skipChecks: !!opts.skipChecks });
  const gen = it.run();
  let send;
  let steps = 0;
  const queue = inputs.slice();
  const maxSteps = opts.maxSteps || 200000;
  for (;;) {
    const r = gen.next(send);
    send = undefined;
    if (r.done) break;
    if (r.value.type !== 'tick') steps++;
    if (steps > maxSteps) throw new Error('too many steps');
    if (r.value.type === 'input') {
      if (!queue.length) throw new Error('missing input for ' + r.value.prompt);
      send = String(queue.shift());
    }
  }
  return { out, steps };
};
