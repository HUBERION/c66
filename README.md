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
js/ui/                Oberfläche (Darstellung, Drag & Drop, Seitenleiste, Dialoge, App)
tools/serve.cjs       lokaler Webserver:  node tools/serve.cjs  →  http://localhost:8765/
tools/build.mjs       baut dist/blockbild-editor.html
tests/                Tests (Node, keine Abhängigkeiten)
```

Tests:

```bash
node tests/unit.cjs
node tests/examples.cjs
node tests/smoke-original.cjs <ordner-mit-alten-.bb-dateien>
```

`node tests/examples.cjs <ordner>` schreibt zusätzlich die C-Dateien samt Eingaben; mit
`sh tests/compile-c.sh <ordner>` (Linux/WSL mit gcc) werden sie übersetzt und ausgeführt.

## Herkunft

Neu geschrieben; das Dateiformat und die Bedienidee stammen vom Blockbild-Editor 2.2
([eggers97/block-diagram-editor](https://github.com/eggers97/block-diagram-editor), GPL-3.0).
Aus dem alten Projekt wurde kein Code übernommen.
