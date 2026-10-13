# Blockbild-Editor 3

Neuentwicklung des Blockbild-Editors (Struktogramme / Nassi-Shneiderman-Diagramme) für den
Programmierunterricht. Läuft komplett im Browser, ohne Server, ohne externe Bibliotheken und
**liest und schreibt die `.bb`-Dateien des bisherigen Editors (Version 2.x)**.

## Bereitstellen

```bash
node tools/build.mjs
```

Erzeugt `dist/blockbild-editor.html` – eine einzige Datei (≈ 300 KB) mit allem drin.
Diese Datei auf den Webserver kopieren, z. B. als Ersatz für `/BE/pages/Blocks-Editor.html`
oder daneben als `/BE/pages/neu.html`. Sie funktioniert auch per Doppelklick lokal.

Liegt die neue Seite auf derselben Domain wie der alte Editor, bietet *Exportieren → Diagramm
der alten Version wiederherstellen* das zuletzt automatisch gesicherte Diagramm des alten Editors an.

## Was ist neu gegenüber Version 2.2

**Bearbeiten**
- Modernes Layout mit Palette, Zeichenfläche (Millimeterpapier, Zoom) und Seitenleiste; Hell/Dunkel; Deutsch/Englisch
- Drag & Drop mit Einfügelinie – auch auf Tablets (lange drücken); Blöcke **verschieben** (Strg = kopieren)
- Bausteine per Klick nach dem markierten Block einfügen, `∅`-Felder zum Einfügen in leere Zweige
- Rückgängig/Wiederholen, Kopieren/Ausschneiden/Einfügen (auch zwischen Fenstern), Duplizieren, Alt+↑/↓
- Kontextmenü: Kommentar, SONST/FALL hinzufügen/entfernen, in WENN/SOLANGE einpacken, Rahmen entfernen …
- Live-Prüfung: unbekannte Variablen, leere Felder, Syntaxfehler (z. B. `=` statt `==`), falsche Parameter,
  doppelte Namen – direkt am Feld markiert und als Liste im Reiter *Prüfung*
- Autovervollständigung für Variablennamen; Typen und Unterprogramme als Auswahlliste
- Umbenennen eines Unterprogramms passt alle Aufrufe an
- Darstellung wählbar: *Blockbild* (Beschriftung links wie bisher) oder *Nassi-Shneiderman* (Zweige nebeneinander), farbig oder schwarz-weiß

**Ausführen**
- Start / Pause / Einzelschritt / Stopp, Tempo-Regler bis „sofort", Haltepunkte (F9), „Bis hier ausführen"
- Konsole statt `alert`/`prompt`: Ausgaben bleiben stehen, Eingaben direkt unten; Esc bricht eine Eingabe ab
  (die Variable behält ihren Startwert)
- Stack-Ansicht mit Rahmen pro Aufruf, geänderte Werte leuchten auf, Arrays als Zellen, optional Adressen,
  InOut-Parameter mit Pfeil auf die Originalvariable
- Laufzeitfehler (Division durch 0, Index außerhalb, Stapelüberlauf bei endloser Rekursion …) werden am Block erklärt

**C-Code**
- Live-Vorschau mit Hervorhebung, Kopieren, Download
- Erzeugter Code kompiliert mit `gcc -std=c99 -Wall -Wextra` (getestet mit allen Beispielen):
  `strcmp` für Textvergleiche, `snprintf` für Verkettungen, `scanf(" %254[^\n]")` statt `gets`,
  Zeiger für InOut-Zahlen, Größenvariablen für Arrays, FALLS mit Text als `if`/`else if`

**Export in 16 Sprachen** – C, C++, C#, Java, Python, JavaScript, bash, csh, Lua, Rust, x86-Assembler (MS-DOS), Fortran,
COBOL, BASIC, RPG IV und MARTIN GOES (Auswahlliste im Reiter *Code*)
- bash 4.3+: Funktionen mit `local`, Arrays als Namensreferenz (`local -n`), Rückgabe/InOut über `_ret`
- csh/tcsh: keine Funktionen – Unterprogramme sind Sprungmarken (`goto`), Rücksprung über eine Liste, Rekursion mit eigenem Stapel
- Lua 5.3+: Arrays als Tabelle ab Index 0 (Länge in `.n`), InOut als Rückgabewerte, Division wie C
- Rust: `i64`, `String`, `Vec`, InOut als `&mut` (zwei Elemente desselben Arrays werden kopiert und zurückgeschrieben)
- x86-Assembler (NASM, MS-DOS .COM, 8086): 16-Bit-Zahlen, Stapelrahmen mit BP, Texte mit Längenbyte, Arrays auf dem Heap,
  kleine Laufzeitbibliothek (INT 21h); getestet mit DOSBox
- BASIC im QBasic-Stil (SUB/FUNCTION, SELECT CASE, `\` und `MOD`) – für FreeBASIC `fbc -lang qb` gedacht
- RPG IV (vollständig freies Format, IBM i 7.3+): Prozeduren, `varchar`, `dim(1000)`, Ein-/Ausgabe über `DSPLY`
- MARTIN GOES: Zellen, ganze Zahlen, Texte und Sprünge (Definition unten); Text → Zahl lässt sich nicht übersetzen
- JavaScript: läuft mit `node datei.js` (oder im Browser über `prompt`), InOut-Werte werden zurückgegeben (`[x, y] = tausche(x, y)`)
- Fortran 2008: ein Programm mit `contains`, Texte als `character(len=:), allocatable`, Arrays ab Index 0, InOut als `intent(inout)`
- COBOL (GnuCOBOL 3, freies Format): jedes Unterprogramm ein eigenes `RECURSIVE`-Programm, `CALL … USING BY CONTENT/BY REFERENCE`,
  Texte mit Längenfeld `NAME-LEN`, Arrays mit höchstens 1000 Elementen (`A(I + 1)`)
- C++: `string`, `vector`, `cin`/`cout`, InOut als Referenz (`int& a`)
- C#: eine Klasse `Program`, InOut als `ref`, Arrays mit `.Length`
- Reiter *Code* mit Sprachwahl, Download über *Exportieren*
- Java: eine Klasse mit statischen Methoden, `Scanner` für Eingaben, InOut-Zahlen über ein Array mit einem Element
- Python 3.10+: f-Strings, `range`, `match/case`; InOut-Werte werden zurückgegeben (`x, y = tausche(x, y)`)
- `node tests/export.cjs` übersetzt 44 Programme, führt sie mit echtem Python, javac/java, dotnet, node, g++, gfortran, cobc,
  bash, tcsh, lua5.4, rustc, nasm + DOSBox und dem MARTIN-GOES-Interpreter aus und vergleicht mit der Simulation
  (BASIC nur mit installiertem FreeBASIC; RPG lässt sich ohne IBM i nicht ausführen)

**MARTIN GOES** (Lehrmaschine, Definition: Martin)
- Speicher: unendlich viele Zellen 0, 1, 2, …; jede Zelle hält eine beliebig große ganze Zahl (auch negativ), am Anfang 0.
- Texte liegen ebenfalls in Zellen: ab Zelle a die Länge n, dann in a+1 … a+n die Zeichencodes (Unicode). 0 = leerer Text.
- Programm: eine Liste von Befehlen mit optionalen Labels (`name:`), Kommentare mit `;`. Die Ausführung startet beim ersten
  Befehl und läuft der Reihe nach, außer ein Sprung lenkt um. Läuft das Programm über den letzten Befehl hinaus, endet es wie bei `T`.
- Operanden: `#5` Konstante 5 (nur als Quelle), `5` Zelle 5, `@5` Zelle, deren Adresse in Zelle 5 steht (indirekt – macht Arrays,
  Stapel, Texte und „Band“ möglich), `"Hallo"` Textkonstante (nur als Quelle; `\n`, `\"`, `\`), `$5` der Text ab Zelle 5,
  `$@5` der Text ab der Adresse in Zelle 5.
- Befehle: `M x y` (Multiply, x := x · y), `A x y` (Add, x := x + y), `R x y` (Reduce, x := x − y), `T` (Terminate),
  `I x` (Input: Zeile lesen, ganze Zahl nach x; ungültig/Ende → 0), `I $x` (Zeile als Text ab Zelle x), `N x` (Negate, x := −x),
  `G L` (Goto), `O x` (Output: Zahl), `O "…"` / `O $x` (Text ausgeben), `E x L` (Equal zero? – wenn x = 0, springe zu L),
  `S x y` (Set/Store, x := y), `S $x "…"` (Textkonstante ab Zelle x ablegen).
- `O` schreibt ohne Zeilenumbruch, `O "\n"` macht einen. Texte bringen keine neuen Befehle, nur Operanden – die Buchstaben bleiben M A R T I N G O E S.
- Turing-vollständig: `A x #1`, `R x #1` und `E` auf unbegrenzten Zellen ergeben eine Minsky-Maschine; M, N, G, S, I und O sind Komfort.
- Beispiel Fakultät (Eingabe 5 → 120):
  ```
        I  0          ; n einlesen
        S  1 #1       ; ergebnis := 1
  loop: E  0 ende     ; n = 0? -> fertig
        M  1 0        ; ergebnis := ergebnis · n
        R  0 #1       ; n := n − 1
        G  loop
  ende: O  1          ; ergebnis ausgeben
        T
  ```
- Beispiel Begrüßung (Eingabe Ada → „Hallo Ada! Dein Name hat 3 Zeichen.“):
  ```
        O  "Wie heißt du? "
        I  $100       ; Text ab Zelle 100
        O  "Hallo "
        O  $100
        O  "! Dein Name hat "
        O  100        ; Zelle 100 = Länge
        O  " Zeichen.\n"
        T
  ```
- Übersetzung aus dem Blockbild: „kleiner als“ über eine Zählschleife (E prüft nur auf 0), Division durch wiederholtes Abziehen,
  Unterprogramme mit Rahmen auf einem Stapel ab Zelle 1000000 und Rücksprung über eine Nummer, Arrays und Texte auf einer Halde,
  eingebaute Routinen `txt_cat`, `txt_num`, `txt_cmp` für Verkettung, Zahl → Text und Textvergleich.
  Ein Interpreter steckt in `js/core/mggen.js` (`BBE.mggen.run`).

**Python → Blockbild**
- *Öffnen* nimmt auch `.py`-Dateien: Zuweisungen, `input`/`print`, f-Strings, `if/elif/else`, `while`,
  `while True … break` (→ WIEDERHOLE … BIS), `for … in range`, `for x in liste`, `match/case`, `def`/`return`,
  Listen (`[0] * n`, `[1, 2, 3]`), `len`, `min`/`max`/`abs`, Tupel-Tausch
- Nicht übertragbare Zeilen bleiben als ⚠-Kommentar im Diagramm, eine Liste zeigt alle Stellen
- Getestet: die übersetzten Beispielprogramme in `tests/python/` liefern dieselbe Ausgabe wie echtes Python

**Dateien**
- `.bb` öffnen (Dialog, Drag & Drop aufs Fenster oder Einfügen) – ganz oder nur die Unterprogramme
- Speichern als `.bb` (in Chrome/Edge direkt in dieselbe Datei), automatische Sicherung im Browser
- Diagramm als PNG-Bild exportieren
- 12 eingebaute Beispiele (Hallo Welt bis Bubblesort)

## Verhalten und Kompatibilität

- Die Ergebnisvariable von Funktionen heißt immer `result` (wie in den bisherigen Beispieldateien).
- *Zahl* rechnet in der Simulation mit Kommastellen (wie bisher); im C-Code wird daraus `int`.
- Variablen gelten im ganzen Unterprogramm; eine Variable muss deklariert sein, bevor sie verwendet wird.
- Alte Dateien, in denen Typen als Anzeigenamen gespeichert wurden (`Number`, `Zahl`, `Text[]` …), werden erkannt.
- Neue Dateien enthalten nur Felder, die der alte Editor kennt – er kann sie weiterhin öffnen.

## Entwicklung

```
index.html            Einstieg für die Entwicklung (lädt die Einzeldateien)
css/app.css           Gestaltung (Farb-Tokens für Hell/Dunkel oben)
js/core/              ohne DOM, auch in Node lauffähig
  i18n.js             Texte Deutsch/Englisch
  expr.js             Tokenizer und Parser für Ausdrücke
  model.js            Datenmodell, .bb-Format (laden/speichern)
  analyze.js          Gültigkeitsbereiche, Typen, Live-Prüfung
  interp.js           Interpreter (Generator, ein yield pro sichtbarem Schritt)
  cgen.js             Übersetzung nach C99
  examples.js         eingebaute Beispiele
  pyimport.js         Python → Blockbild (Tokenizer, Parser, Übersetzung)
js/ui/                Oberfläche (Darstellung, Drag & Drop, Seitenleiste, Dialoge, App)
tools/serve.cjs       lokaler Webserver:  node tools/serve.cjs  →  http://localhost:8765/
tools/build.mjs       baut dist/blockbild-editor.html
tests/                Tests (Node, keine Abhängigkeiten)
```

Tests:

```bash
node tests/unit.cjs
node tests/examples.cjs
node tests/python.cjs          # braucht Python 3.10+ (py oder python3)
node tests/smoke-original.cjs <ordner-mit-alten-.bb-dateien>
```

`node tests/examples.cjs <ordner>` schreibt zusätzlich die C-Dateien samt Eingaben; mit
`sh tests/compile-c.sh <ordner>` (Linux/WSL mit gcc) werden sie übersetzt und ausgeführt.

## Dank und Herkunft

Der ursprüngliche Blockbild-Editor wurde von **Stefan Egger** und **Michael Delfser** entwickelt
(Version 1.0 im März 2016, Version 2.2 im September 2018) und wird seit Jahren im Programmierunterricht
eingesetzt: [eggers97/block-diagram-editor](https://github.com/eggers97/block-diagram-editor) (GPL-3.0).
Idee, Bedienkonzept und das `.bb`-Dateiformat stammen von ihnen – vielen Dank für diese Grundlage!

Die Idee, den Editor als **Version 3.0** neu zu bauen, stammt von **Martin Huber** – danke dafür!
Version 3 ist eine Neuentwicklung; aus dem alten Projekt wurde kein Code übernommen.
Im Editor stehen die Credits unter *Einstellungen* und am Ende der *Hilfe*.

Für die Weiterentwicklung (auch mit KI-Assistenten) siehe [CLAUDE.md](CLAUDE.md).
