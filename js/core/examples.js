/* Blockbild-Editor – eingebaute Beispiele (im .bb-Format, Texte je nach Sprache) */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  const S = (...st) => ({ type: 'Statements', statements: st });
  const decl = (t, name, init, comment) => ({ type: 'DeclarationStatement', variableType: t, variableName: name, initializationValue: init, isArray: false, comment });
  const arr = (t, name, len) => ({ type: 'DeclarationStatement', variableType: t, variableName: name, arrayLength: len, isArray: true });
  const inp = (prompt, v) => ({ type: 'InputStatement', prompt, variableName: v });
  const out = (e) => ({ type: 'OutputStatement', outputString: e });
  const set = (v, e, comment) => ({ type: 'AssignmentStatement', variableName: v, assignmentValue: e, comment });
  const IF = (c, then, els) => ({ type: 'IfStatement', condition: c, thenStatements: S(...then), elseStatements: els ? S(...els) : null });
  const WHILE = (c, ...body) => ({ type: 'WhileStatement', condition: c, loopStatements: S(...body) });
  const UNTIL = (c, ...body) => ({ type: 'DoWhileStatement', condition: c, loopStatements: S(...body) });
  const FOR = (v, from, to, step, ...body) => ({ type: 'ForStatement', counterName: v, fromValue: from, toValue: to, counterShift: step, loopStatements: S(...body) });
  const SWITCH = (v, cases, els) => ({ type: 'SwitchStatement', variableName: v, casesStatements: cases.map(([val, body]) => ({ caseValue: val, caseStatements: S(...body) })), elseStatements: els ? S(...els) : null });
  const CALL = (fn, args, target) => ({ type: 'FunctionCallStatement', functionName: fn, parameters: args.map((value) => ({ value })), variableName: target });
  const NOTE = (text) => ({ type: 'CommentStatement', comment: text });
  const par = (type, name, inout, doc) => ({ type, name, onlyIn: !inout, documentation: doc });
  const FN = (returnType, params, resultInit, ...body) => ({ parameters: params, statements: S(...body), returnType, resultInitializationValue: resultInit });

  const list = [
    {
      id: 'hello', level: 1,
      title: { de: 'Hallo Welt', en: 'Hello world' },
      desc: { de: 'Die kleinste Ausgabe.', en: 'The smallest output.' },
      build: (L) => ({ main: S(out(L('"Hallo Welt!"', '"Hello world!"'))) })
    },
    {
      id: 'eva', level: 1,
      title: { de: 'Rechteck (EVA-Prinzip)', en: 'Rectangle (input–process–output)' },
      desc: { de: 'Eingabe, Verarbeitung, Ausgabe mit Kommentaren gegliedert.', en: 'Input, processing and output, structured with comments.' },
      build: (L) => ({
        main: S(
          NOTE(L('Eingabe', 'Input')),
          decl('integer', 'laenge', '0', L('in cm', 'in cm')),
          decl('integer', 'breite', '0', L('in cm', 'in cm')),
          inp(L('"Länge: "', '"Length: "'), 'laenge'),
          inp(L('"Breite: "', '"Width: "'), 'breite'),
          NOTE(L('Verarbeitung', 'Processing')),
          decl('integer', 'flaeche', 'laenge * breite'),
          decl('integer', 'umfang', '2 * (laenge + breite)'),
          NOTE(L('Ausgabe', 'Output')),
          out(L('"Fläche: " + flaeche + " cm²"', '"Area: " + flaeche + " cm²"')),
          out(L('"Umfang: " + umfang + " cm"', '"Perimeter: " + umfang + " cm"'))
        )
      })
    },
    {
      id: 'even', level: 1,
      title: { de: 'Gerade oder ungerade', en: 'Even or odd' },
      desc: { de: 'WENN mit Rest-Operator %.', en: 'IF with the remainder operator %.' },
      build: (L) => ({
        main: S(
          decl('integer', 'n', '0'),
          inp(L('"Ganze Zahl: "', '"Whole number: "'), 'n'),
          IF('n % 2 == 0',
            [out(L('n + " ist gerade"', 'n + " is even"'))],
            [out(L('n + " ist ungerade"', 'n + " is odd"'))])
        )
      })
    },
    {
      id: 'loops', level: 2,
      title: { de: 'Summe 1 bis n – drei Schleifen', en: 'Sum 1 to n – three loops' },
      desc: { de: 'Dieselbe Rechnung mit FÜR, SOLANGE und WIEDERHOLE … BIS.', en: 'The same sum with FOR, WHILE and REPEAT … UNTIL.' },
      build: (L) => ({
        main: S(
          decl('integer', 'n', '5'),
          decl('integer', 'i', '0'),
          decl('integer', 'summe', '0'),
          inp(L('"Bis zu welcher Zahl? "', '"Up to which number? "'), 'n'),
          NOTE(L('genau n Durchläufe', 'exactly n iterations')),
          FOR('i', '1', 'n', '+1', set('summe', 'summe + i')),
          out(L('"FÜR: " + summe', '"FOR: " + summe')),
          NOTE(L('0 bis n Durchläufe', '0 to n iterations')),
          set('summe', '0'),
          set('i', '1'),
          WHILE('i <= n', set('summe', 'summe + i'), set('i', 'i + 1')),
          out(L('"SOLANGE: " + summe', '"WHILE: " + summe')),
          NOTE(L('1 bis n Durchläufe', '1 to n iterations')),
          set('summe', '0'),
          set('i', '1'),
          UNTIL('i > n', set('summe', 'summe + i'), set('i', 'i + 1')),
          out(L('"WIEDERHOLE: " + summe', '"REPEAT: " + summe'))
        )
      })
    },
    {
      id: 'grade', level: 2,
      title: { de: 'Schulnote prüfen und benennen', en: 'Check and name a grade' },
      desc: { de: 'Eingabe absichern mit WIEDERHOLE … BIS, dann FALLS.', en: 'Validate input with REPEAT … UNTIL, then SWITCH.' },
      build: (L) => ({
        main: S(
          decl('integer', 'note', '0'),
          decl('string', 'text', '""'),
          UNTIL('note >= 1 && note <= 5',
            inp(L('"Note (1–5): "', '"Grade (1–5): "'), 'note'),
            IF('note < 1 || note > 5', [out(L('"Nur 1 bis 5 – bitte nochmal."', '"Only 1 to 5 – please try again."'))])),
          SWITCH('note', [
            ['1', [set('text', L('"Sehr gut"', '"Excellent"'))]],
            ['2', [set('text', L('"Gut"', '"Good"'))]],
            ['3', [set('text', L('"Befriedigend"', '"Satisfactory"'))]],
            ['4', [set('text', L('"Genügend"', '"Sufficient"'))]]
          ], [set('text', L('"Nicht genügend"', '"Insufficient"'))]),
          out('note + " = " + text')
        )
      })
    },
    {
      id: 'max', level: 2,
      title: { de: 'Unterprogramm mit Ergebnis', en: 'Subprogram with result' },
      desc: { de: 'maximum(a, b) liefert die größere Zahl über result.', en: 'maximum(a, b) returns the larger number via result.' },
      build: (L) => ({
        main: S(
          decl('integer', 'x', '0'),
          decl('integer', 'y', '0'),
          decl('integer', 'groesser', '0'),
          inp('"x: "', 'x'),
          inp('"y: "', 'y'),
          CALL('maximum', ['x', 'y'], 'groesser'),
          out(L('"Die größere Zahl ist " + groesser', '"The larger number is " + groesser'))
        ),
        maximum: FN('integer', [par('integer', 'a', false), par('integer', 'b', false)], 'a',
          IF('b > a', [set('result', 'b')]))
      })
    },
    {
      id: 'ggt', level: 3,
      title: { de: 'ggT nach Euklid', en: 'GCD after Euclid' },
      desc: { de: 'Zwei Unterprogramme, SOLANGE mit verschachteltem WENN.', en: 'Two subprograms, WHILE with a nested IF.' },
      build: (L) => ({
        main: S(
          decl('integer', 'a', '0'),
          decl('integer', 'b', '0'),
          decl('integer', 'g', '0'),
          inp('"a: "', 'a'),
          inp('"b: "', 'b'),
          NOTE(L('nur mit positiven Zahlen rechnen', 'only work with positive numbers')),
          CALL('betrag', ['a'], 'a'),
          CALL('betrag', ['b'], 'b'),
          CALL('ggt', ['a', 'b'], 'g'),
          out(L('"ggT(" + a + ", " + b + ") = " + g', '"gcd(" + a + ", " + b + ") = " + g'))
        ),
        betrag: FN('integer', [par('integer', 'n', false)], 'n',
          IF('n < 0', [set('result', '-n')])),
        ggt: FN('integer', [par('integer', 'a', false, L('a und b sind Kopien', 'a and b are copies')), par('integer', 'b', false)], '0',
          IF('a == 0 || b == 0',
            [set('result', 'a + b')],
            [WHILE('a != b', IF('a > b', [set('a', 'a - b')], [set('b', 'b - a')])), set('result', 'a')]))
      })
    },
    {
      id: 'swap', level: 3,
      title: { de: 'Tauschen (call by reference)', en: 'Swap (call by reference)' },
      desc: { de: 'InOut-Parameter ändern die Variablen des Aufrufers.', en: 'InOut parameters change the caller’s variables.' },
      build: (L) => ({
        main: S(
          decl('integer', 'x', '3'),
          decl('integer', 'y', '7'),
          out(L('"vorher:  x = " + x + ", y = " + y', '"before: x = " + x + ", y = " + y')),
          CALL('tausche', ['x', 'y']),
          out(L('"nachher: x = " + x + ", y = " + y', '"after:  x = " + x + ", y = " + y'))
        ),
        tausche: FN('void', [par('integer', 'a', true), par('integer', 'b', true)], undefined,
          decl('integer', 'hilf', 'a'),
          set('a', 'b'),
          set('b', 'hilf'))
      })
    },
    {
      id: 'fak', level: 3,
      title: { de: 'Fakultät (Rekursion)', en: 'Factorial (recursion)' },
      desc: { de: 'fak ruft sich selbst auf – beobachte den wachsenden Stack.', en: 'fak calls itself – watch the stack grow.' },
      build: (L) => ({
        main: S(
          decl('integer', 'n', '5'),
          decl('integer', 'f', '0'),
          inp('"n: "', 'n'),
          CALL('fak', ['n'], 'f'),
          out('n + "! = " + f')
        ),
        fak: FN('integer', [par('integer', 'n', false)], '1',
          IF('n > 1', [CALL('fak', ['n - 1'], 'result'), set('result', 'result * n')]))
      })
    },
    {
      id: 'avg', level: 3,
      title: { de: 'Messwerte im Array', en: 'Readings in an array' },
      desc: { de: 'Array einlesen, Summe im Unterprogramm, Durchschnitt.', en: 'Read an array, sum it in a subprogram, average.' },
      build: (L) => ({
        main: S(
          decl('integer', 'anzahl', '4'),
          inp(L('"Wie viele Werte? "', '"How many values? "'), 'anzahl'),
          arr('integer[]', 'werte', 'anzahl'),
          decl('integer', 'i', '0'),
          FOR('i', '0', 'werte.length - 1', '+1',
            inp(L('"Wert " + (i + 1) + ": "', '"Value " + (i + 1) + ": "'), 'werte[i]')),
          decl('integer', 's', '0'),
          CALL('summe', ['werte'], 's'),
          out(L('"Summe: " + s', '"Sum: " + s')),
          IF('werte.length > 0', [out(L('"Durchschnitt: " + s / werte.length', '"Average: " + s / werte.length'))])
        ),
        summe: FN('integer', [par('integer[]', 'zahlen', true)], '0',
          decl('integer', 'i', '0'),
          FOR('i', '0', 'zahlen.length - 1', '+1', set('result', 'result + zahlen[i]')))
      })
    },
    {
      id: 'sort', level: 4,
      title: { de: 'Sortieren (Bubblesort)', en: 'Sorting (bubble sort)' },
      desc: { de: 'Verschachtelte Schleifen und Tauschen von Array-Elementen.', en: 'Nested loops and swapping array elements.' },
      build: (L) => ({
        main: S(
          arr('integer[]', 'zahlen', '6'),
          decl('integer', 'i', '0'),
          decl('integer', 'j', '0'),
          NOTE(L('Testdaten erzeugen', 'Create test data')),
          FOR('i', '0', 'zahlen.length - 1', '+1', set('zahlen[i]', '(i * 7 + 3) % 10')),
          CALL('zeige', ['zahlen']),
          FOR('i', 'zahlen.length - 1', '1', '-1',
            FOR('j', '0', 'i - 1', '+1',
              IF('zahlen[j] > zahlen[j + 1]', [CALL('tausche', ['zahlen[j]', 'zahlen[j + 1]'])]))),
          CALL('zeige', ['zahlen'])
        ),
        tausche: FN('void', [par('integer', 'a', true), par('integer', 'b', true)], undefined,
          decl('integer', 'hilf', 'a'),
          set('a', 'b'),
          set('b', 'hilf')),
        zeige: FN('void', [par('integer[]', 'werte', true)], undefined,
          decl('string', 'zeile', '""'),
          decl('integer', 'k', '0'),
          FOR('k', '0', 'werte.length - 1', '+1', set('zeile', 'zeile + werte[k] + " "')),
          out('zeile'))
      })
    },
    {
      id: 'words', level: 2,
      title: { de: 'Texte vergleichen', en: 'Comparing texts' },
      desc: { de: 'Texte verketten, vergleichen und mit .length messen.', en: 'Concatenate, compare and measure texts with .length.' },
      build: (L) => ({
        main: S(
          decl('string', 'name', '""'),
          decl('string', 'antwort', '""'),
          inp(L('"Wie heißt du? "', '"What is your name? "'), 'name'),
          out(L('"Hallo " + name + "! Dein Name hat " + name.length + " Zeichen."', '"Hello " + name + "! Your name has " + name.length + " characters."')),
          UNTIL(L('antwort == "ja" || antwort == "nein"', 'antwort == "yes" || antwort == "no"'),
            inp(L('"Magst du Struktogramme? (ja/nein) "', '"Do you like structograms? (yes/no) "'), 'antwort')),
          IF(L('antwort == "ja"', 'antwort == "yes"'),
            [out(L('"Super, " + name + "!"', '"Great, " + name + "!"'))],
            [out(L('"Schade – probier mal die Beispiele aus."', '"Too bad – try the examples."'))])
        )
      })
    }
  ];

  function build(id, lang) {
    const ex = list.find((e) => e.id === id);
    if (!ex) return null;
    const L = (de, en) => (lang === 'en' ? en : de);
    return JSON.parse(JSON.stringify(ex.build(L)));
  }

  BBE.examples = { list, build };
})(typeof window !== 'undefined' ? window : globalThis);
