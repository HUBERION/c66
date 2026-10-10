# Blockbild-Editor 3 – Übergabe und Arbeitskontext

Diese Datei ist der Einstieg für Menschen **und KI-Assistenten**, die am Projekt weiterarbeiten.
Sie fasst zusammen, was gebaut wurde, warum, wie es zusammenhängt und worauf man achten muss.
Ansprechpartner ab jetzt: **Martin** (vorher: Markus Huber).

## Worum es geht

Ein Struktogramm-Editor (Nassi-Shneiderman / „Blockbild“) für den Programmierunterricht an Schulen.
Schüler bauen Programme aus Blöcken, führen sie Schritt für Schritt aus (mit Stack-Ansicht) und
exportieren sie als C-Code. Zielgruppe: Unterricht in Österreich, daher **Deutsch ist die Hauptsprache**
(Englisch als zweite Sprache).

- Live: **https://c66.xeox.at/** (GitHub Pages, Repo `HUBERION/c66`, Branch `main`, Ordner `/`, Datei `CNAME`)
- Vorgänger: Blockbild-Editor 2.2 von Stefan Egger und Michael Delfser
  (https://github.com/eggers97/block-diagram-editor, GPL-3.0, lief auf c65.at/BE/pages/Blocks-Editor.html).
  **Version 3 ist eine komplette Neuentwicklung** – kein Code übernommen, nur Bedienidee und Dateiformat.
  Die Credits für Egger/Delfser stehen in Einstellungen, Hilfe und README und sollen bleiben.

## Harte Anforderungen (nicht brechen)

1. **Keine Abhängigkeiten, kein Build-Zwang.** Reines HTML/CSS/JS, klassische `<script>`-Dateien
   (keine ES-Module, damit `index.html` auch per `file://` läuft). Keine CDNs, keine Google Fonts
   (DSGVO an Schulen) – nur System-Schriften.
2. **`.bb`-Dateiformat kompatibel mit Version 2.x** – in beide Richtungen.
   - Top-Level-Objekt: `main` + je ein Schlüssel pro Unterprogramm. **Keine weiteren Top-Level-Schlüssel
     hinzufügen** – der alte Editor hält jeden Schlüssel außer `main` für ein Unterprogramm.
   - Feldnamen der Anweisungen exakt wie im Original (`DeclarationStatement`, `variableName`,
     `initializationValue`, `DoWhileStatement` für WIEDERHOLE…BIS, `onlyIn: false` = InOut, …).
   - Typen intern `integer|string|integer[]|string[]`; beim Laden werden auch alte Anzeigenamen
     (`Number`, `Zahl`, `Text[]` …) akzeptiert (`model.normType`).
   - Die Ergebnisvariable heißt immer `result` (im alten DE-Modus hieß sie `resultat`, war dort aber kaputt).
3. **Simulation = C = C++ = C# = Java = Python = JavaScript = Fortran = COBOL.** Gleiche Eingaben müssen gleiche Ausgaben liefern.
   Das ist durch Tests abgesichert (siehe unten) – nach Änderungen an `interp.js`, `cgen.js` oder
   `pyimport.js` immer die Tests laufen lassen und den C-Code mit gcc übersetzen.
4. **Bedienbar auf Desktop, Tablet und Handy** (Touch: Antippen fügt ein, langes Drücken zieht).
5. Alle sichtbaren Texte über `BBE.i18n.t(key)` – **immer DE und EN** pflegen (`js/core/i18n.js`).

## Aufbau

```
index.html          Entwicklungs-Einstieg, lädt die Einzeldateien in fester Reihenfolge
css/app.css         gesamte Gestaltung; Farb-Tokens oben (:root hell, dunkel per Media-Query + [data-theme])
js/core/            ohne DOM, auch in Node lauffähig (Tests!)
  i18n.js           alle Texte DE/EN, t(key, ...args) mit {0}-Platzhaltern
  expr.js           Tokenizer + Pratt-Parser für Ausdrücke (gemeinsamer AST für Prüfung, Interpreter, C)
  model.js          Datenmodell, Traversierung (walkSeq, childSeqs, getSeq), .bb laden/speichern
  analyze.js        Gültigkeitsbereiche (Variablen gelten im ganzen Unterprogramm), Typen, Live-Prüfung
  interp.js         Interpreter als Generator: jeder yield = ein sichtbarer Schritt
  cgen.js           Übersetzung nach C99
  pygen.js          Übersetzung nach Python 3.10+ (InOut → Rückgabe als Tupel)
  javagen.js        Übersetzung nach Java 8+ (eine Klasse, InOut → Array mit einem Element)
  csgen.js          Übersetzung nach C# (InOut → ref, Arrays mit .Length, Klasse = Dateiname)
  cppgen.js         Übersetzung nach C++11 (string, vector, InOut → Referenz &, cin/cout)
  jsgen.js          Übersetzung nach JavaScript (Node.js/Browser, InOut wie Python als Rückgabe)
  fortgen.js        Übersetzung nach Fortran 2008 (contains, allocatable, intent(inout))
  cobolgen.js       Übersetzung nach COBOL (GnuCOBOL, freies Format, ein Programm je Unterprogramm)
  examples.js       eingebaute Beispiele (im .bb-Format, Texte je Sprache über L(de, en))
  pyimport.js       Python → Blockbild (eigener Tokenizer/Parser für die Schul-Teilmenge)
js/ui/              Oberfläche
  dom.js            h()-Helfer, Autosize von Feldern, Toasts, localStorage-Wrapper, Download
  icons.js          Inline-SVG-Icons (P) und Mini-Struktogramme der Bausteine (K)
  render.js         baut das Diagramm-DOM aus dem Modell (auch statisch für PNG-Export)
  dnd.js            Ziehen & Ablegen (Pointer-Events), Lösch-Zone über dem Baukasten, Auswahlrahmen
  panels.js         Stack-Ansicht, Konsole (mit Eingabezeile), C-Code-Hervorhebung, Prüfliste
  dialogs.js        Menüs, modale Dialoge, Autovervollständigung
  help.js           Hilfetexte DE/EN (HTML)
  app.js            Zustand, Befehle, Verlauf (Undo), Ausführung, Dateien, Einstellungen – der Kleber
tools/serve.cjs     lokaler Server:  node tools/serve.cjs  → http://localhost:8765/
tools/build.mjs     baut dist/blockbild-editor.html (eine Datei, alles inline)
tests/              Node-Tests ohne Abhängigkeiten (siehe unten)
dist/               gebaute Einzeldatei (wird mit eingecheckt); artifact.html ist ignoriert
```

Alle Module hängen an `window.BBE` (bzw. `globalThis.BBE` in Node). Reihenfolge in `index.html` und
`tests/load.cjs` beachten, wenn ein Modul dazukommt (core vor ui; `app.js` zuletzt).

### Datenmodell

```js
program = { fns: [ main, ...unterprogramme ] }
fn      = { id, name, isMain, returnType: 'void'|'integer'|'string', params: [{id,type,name,byRef,doc}], resultInit, body: [...] }
block   = { id, kind, ...felder, comment }
kind    = decl | input | output | assign | if | while | until | for | switch | call | comment
if: { cond, then: [], else: [] | null }        switch: { expr, cases: [{id, value, body}], else }
for: { counter, from, to, step, body }         call: { fn, target, args: [] }
```

Felder enthalten **Ausdrucks-Text** (z. B. `"Summe: " + s`); geparst wird bei Bedarf (`expr.parseCached`).
IDs sind nur zur Laufzeit da und werden nicht gespeichert.

### Ausführung (interp.js ↔ app.js)

`Interpreter.run()` ist ein Generator. Ereignisse: `step` (Block/Teil ausgeführt, `part` = head/foot/result/return/end),
`input` (Antwort per `gen.next(wert|null)`, `null` = abgebrochen → Variable behält Wert), `break` (Haltepunkt, vor dem Block),
`tick` (unsichtbar, verhindert Endlosschleifen ohne Schritt). `app.js` treibt den Generator per `setTimeout`
(Verzögerung = `settings.delay` in ms, 0 = so schnell wie möglich in 14-ms-Häppchen).
Laufzeitfehler sind `RunError(key, args)`; der Speicherstand wird beim Fehler gesichert (`e.snapshot`, `e.where`).
Speichermodell: jede Variable 8 Byte, Rahmen werden beim Rücksprung freigegeben; InOut-Parameter teilen die Zelle
des Aufrufers (gleiche Adresse in der Stack-Ansicht).

### C-Export (cgen.js)

Zahl → `int` (Kommastellen fallen weg – bekannter, dokumentierter Unterschied), Text → `char[MAX_STRING_SIZE]`,
InOut-Zahl → Zeiger, Arrays → `name[]` + `nameSize` (nur angelegt, wenn `.length` genutzt oder übergeben),
Text-Verkettung → `snprintf` (mit Hilfspuffer, wenn das Ziel selbst vorkommt), Textvergleich → `strcmp`,
FALLS mit Text → `if/else if`, verschachtelte Deklarationen werden an den Funktionsanfang gehoben.
Bekannte harmlose gcc-Hinweise mit `-Wall -Wextra`: `-Wformat-truncation` bei `snprintf`, ungenutzter
`…Size`-Parameter, wenn ein Unterprogramm die Array-Länge nicht braucht.

### Export nach C++, C#, Java, Python, JavaScript, Fortran, COBOL (cppgen, csgen, javagen, pygen, jsgen, fortgen, cobolgen)

Reiter *Code* hat eine Sprachwahl (`settings.codeLang`, Liste `CODE_LANGS` + `CODE_GEN` in app.js, Farben in `panels.js` LANGS),
*Exportieren* bietet alle Downloads.
- **C++:** Text + Zahl braucht `to_string`; Ausgaben werden als `cout << a << b` zerlegt. `using namespace std` –
  Namen, die mit std kollidieren (swap, max, count …), bekommen ein `_` angehängt. FALLS mit Text → if/else if.
- **C#:** InOut → `ref` (auch `ref werte[i]`), Textvergleich mit `==` bzw. `string.CompareOrdinal`, Hochziehen der
  Deklarationen wie bei Java (C# verbietet Überdecken lokaler Variablen).
- **Python:** Zahl bleibt int/float wie in der Simulation (`/` liefert float); wo eine Kommazahl entstehen kann,
  formatiert `als_text()` sie wie die Simulation (9.0 → 9). `zahl_eingeben()` fragt so lange, bis eine Zahl kommt.
  InOut-Zahlen/Texte werden am Ende zurückgegeben (`return result, a, b`), der Aufruf weist sie zu.
  ZÄHLE → `for … in range(…)` (Ende +1), FALLS → `match/case`, SONST-WENN → `elif`.
- **Java:** Zahl → int (wie C), Text → String (Vergleiche mit `equals`/`compareTo`), Arrays mit `.length`.
  InOut-Zahlen/Texte: Parameter ist `int[]`/`String[]` mit einem Element; der Aufruf packt den Wert in `boxN`
  und schreibt ihn danach zurück. Deklarationen in Blöcken werden an den Methodenanfang gehoben (Java verbietet
  Überdecken lokaler Variablen). Klassenname = Dateiname (`javagen.className`).
- **JavaScript:** rechnet wie die Simulation (die selbst JS ist). Eingabe über `zeileLesen()` (Node: `fs.readSync` auf stdin,
  Browser: `prompt`). InOut wie Python: `[x, y] = tausche(x, y)`. `let` gilt nur im Block → Hochziehen wie bei Java.
- **Fortran:** Zahl → `integer`, Text → `character(len=:), allocatable`, Arrays `allocate(a(0:n - 1))` (Untergrenze 0,
  Parameter `a(0:)`), Text-Arrays über `type(text)` mit Komponente `%v`. Alle Unterprogramme `recursive`, Funktionen mit
  `result(result)`. In-Parameter, die verändert werden, bekommen `value` (Zahl) bzw. eine Kopie `name_in` (Text).
  Groß-/Kleinschreibung zählt nicht → Namen werden bei Kollisionen mit `_` verlängert, Umlaute ersetzt. Zeilen > 120 Zeichen
  werden mit `&` umbrochen. Echtes `do k = a, b` nur, wenn Zähler und Grenze im Rumpf nicht geschrieben werden.
- **COBOL:** GnuCOBOL 3 (`>>SOURCE FORMAT FREE`). Ein Programm je Unterprogramm (`RECURSIVE`, `LOCAL-STORAGE`), In → `BY CONTENT`,
  InOut/Arrays → `BY REFERENCE`, Rückgabewert = letzter Parameter `RESULT`. Text = `PIC X(256)` + Länge `NAME-LEN` (`PIC 9(3)`),
  Wert immer als `NAME(1:NAME-LEN)` – sonst gehen Leerzeichen am Ende verloren. Arrays: `NAME-TAB` mit 1000 Plätzen + `NAME-LEN`,
  Index + 1 (`A(I + 1)`, `a[j+1]` → `A(J + 2)`). Zahlen in Texten über Druckfelder `BB-Zn` (`PIC -(18)9`, `FUNCTION TRIM`),
  `/` → `FUNCTION INTEGER-PART`, `%` → `FUNCTION REM` (Vorzeichen wie C). Hilfsfelder `BB-…` werden je Anweisung neu gezählt.
  Namen: reservierte Wörter (Liste aus `cobc --list-reserved`) bekommen `-V`. cobc-Eigenheit: `COMPUTE … NUMVAL` im
  Hilfsprogramm nach einem Programm mit `FUNCTION REM` erzeugte C-Code mit unbekanntem `cob_decimal` → dort `MOVE` statt `COMPUTE`.
  cobc warnt bei `CALL … BY REFERENCE A(J + 1) A(J + 2)` (»duplicate USING item«) – harmlos.
- Alle Generatoren: erst alle Hilfsfunktionen definieren, `run()` am Ende aufrufen (const-Funktionen sind vorher
  nicht initialisiert).

### Python-Import (pyimport.js)

Öffnen akzeptiert `.py` (oder Datei aufs Fenster ziehen). Unterstützt: Zuweisungen (erste Zuweisung → DEKLARATION,
in Blöcken an den Anfang gehoben), `input`/`int(input())`, `print` (inkl. `sep`), f-Strings, `if/elif/else`,
`while`, `while True … if c: break` → WIEDERHOLE…BIS, `for … in range(…)`, `for x in liste`, `match/case`,
`def`/`return` (frühes `if … return` wird zu WENN/SONST umgebaut), Listen `[0]*n` / `[1,2,3]`, `len`, `min`, `max`,
`abs`, Tupel-Tausch, `def main()` + `if __name__ == "__main__"`. Nicht Übertragbares wird zu einem
`⚠ Zeile n nicht übersetzt: …`-Kommentar und landet in der Warnliste (Dialog nach dem Import).
Typen werden in mehreren Durchläufen abgeleitet (Zuweisungen, Aufrufstellen, Rückgabewerte, Annotationen).

## Arbeiten am Projekt

```bash
node tools/serve.cjs                 # Entwicklung: http://localhost:8765/  (index.html mit Einzeldateien)
node tests/unit.cjs                  # 24 Grenzfälle: Parser, Interpreter, Prüfung, .bb-Format
node tests/examples.cjs [ordner]     # alle eingebauten Beispiele DE+EN; mit Ordner: .c + .in schreiben
node tests/python.cjs                # Python-Beispiele: Ausgabe von echtem Python vs. übersetztem Blockbild
node tests/export.cjs [alte-.bb]     # Export: python, javac/java, dotnet (ein Projekt), node, g++/gfortran/cobc (auch über WSL)
                                     # gegen die Simulation; nur einzelne Sprachen: BBE_ONLY=cobol,fortran node tests/export.cjs
node tests/smoke-original.cjs <ordner-mit-alten-.bb>   # Original-Beispiele des 2.x-Editors
sh tests/compile-c.sh <ordner>       # (Linux/WSL) gcc -std=c99 -Wall -Wextra + Ausführen mit .in-Dateien
node tools/build.mjs                 # vor jedem Commit: dist/blockbild-editor.html neu bauen
```

Deployment: `git push` auf `main` – GitHub Pages liefert `index.html` aus dem Repo-Root aus (Live nach ~1–2 Min.).
`dist/blockbild-editor.html` ist die Einzeldatei zum Hochladen auf andere Server oder zum Offline-Weitergeben.

Commit-Stil bisher: deutsche Betreffzeile, kurze Aufzählung im Text.

## Stolpersteine, die wir schon gefunden haben

- **CSS-Kaskade:** Die Kategorie-Farben laufen über `--kc`/`--tint` aus `.cat-*`-Klassen. Keine späteren
  Regeln mit gleicher Spezifität setzen, die diese Variablen überschreiben (hatte alle Farben gelöscht).
- **`font:`-Kurzschreibweise** setzt `font-variant-ligatures` zurück. Die Regel, die Ligaturen abschaltet
  (sonst zeigt „Cascadia Code“ `<=` als `≤`), steht deshalb **am Ende** von `app.css`.
- **SVG in `display:grid; place-items:center`** wurde in einem Fall an falscher Stelle gezeichnet (Reiter-Icon
  im Nachbarknopf) – Icon-Container mit Flexbox zentrieren.
- **`<dialog>`-`close`-Ereignis** kommt in verdeckten Fenstern erst beim Neuzeichnen. `dialogs.js` schließt
  deshalb selbst (`finish`) und hört zusätzlich auf `cancel`/`close`.
- **iOS:** Felder < 16 px zoomen beim Antippen hinein → `maximum-scale=1` wird nur auf iOS gesetzt.
  Ziffernblock (`inputmode=decimal`) hat kein Minus → Konsole nutzt die normale Tastatur.
- **Android:** langes Drücken öffnet das Kontextmenü → wird während des Ziehens unterdrückt (`dnd.js`).
- **Artifact-Vorschau (claude.ai):** Downloads, `alert/confirm/prompt`, `window.print` sind dort gesperrt.
  `dom.inSandboxViewer()` erkennt das; Speichern läuft dort über `claude.use('downloads')` mit erlaubten
  Endungen (`.bb.json`, `.c.txt`, `.png`). `tools/build.mjs` erzeugt dafür `dist/artifact.html`.
- **Shell-Escaping:** Beim Patchen per Heredoc/Node-Einzeiler gingen Backslashes in Regexen mehrfach kaputt –
  lieber Dateien direkt bearbeiten.

## Bedienkonzept (Kurzfassung)

Palette links (Klick fügt nach dem markierten Block ein, Ziehen legt gezielt ab; SONST/FALL dockt an WENN/FALLS an),
Zeichenfläche mit Zoom, Reiter pro Unterprogramm, rechts Ablauf (Stack + Konsole) / C-Code / Prüfung.
Blöcke verschieben (Strg = kopieren), auf den Baukasten ziehen = löschen, Auswahlrahmen auf freier Fläche,
Kontextmenü bzw. ⋯/Aktionsleiste (Touch), Undo/Redo, Haltepunkte (F9), Darstellung „Blockbild“ (Beschriftung
links, wie der Vorgänger) oder „Nassi-Shneiderman“ (Zweige nebeneinander), hell/dunkel, DE/EN.
Automatische Sicherung im `localStorage` (`bbe3.autosave`, `bbe3.settings`); das alte Autosave
(`autoSavedDiagram`) lässt sich über Exportieren wiederherstellen.

## Offene Ideen / mögliche nächste Schritte

- Echte Ganzzahl-Semantik für „Zahl“ als Einstellung (damit Simulation und C bei Division gleich rechnen).
- Python-Import erweitern (`break`/`continue` per Merker-Variable, String-Methoden, `+=` auf Listen).
- C-Export: ungenutzte `…Size`-Parameter mit `(void)` markieren; optional `double` statt `int`.
- Mehr Python-Testprogramme in `tests/python/` (jede neue Fähigkeit mit einem Vergleich gegen echtes Python absichern).
- Tests für die Oberfläche (bisher nur manuell im Browser bzw. per Skript gegen `BBE.app.api`).
