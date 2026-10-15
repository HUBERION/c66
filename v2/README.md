# Blockbild-Editor 2.2 (Original)

Dieser Ordner enthält den **ursprünglichen Blockbild-Editor 2.2** von **Stefan Egger** und **Michael Delfser**,
unverändert so, wie er auf https://c65.at/BE/pages/Blocks-Editor.html läuft (Stand: Oktober 2026).

- Quelltext und Lizenz: https://github.com/eggers97/block-diagram-editor – **GPL-3.0** (siehe [LICENSE](LICENSE)).
- Die Fassung auf c65.at weicht leicht vom GitHub-Stand ab (jQuery UI 1.11.4 statt 1.13.2, zusätzliche Tastenkürzel,
  `pages/addon.js`/`pages/addon.css` mit Konsole und Dunkelmodus). Übernommen wurde die laufende Fassung, damit Bilder
  und Ansicht genau so aussehen wie gewohnt.
- Mitgelieferte Bibliotheken des Originals: jQuery, jQuery UI, jQuery UI Touch Punch, jquery-ui-contextmenu,
  FileSaver.js, js-beautify, jQuery Timer, jQuery.tabbable, jquery-selectorator (jeweils mit ihren eigenen Lizenzen).

**Nicht Teil des Originals** ist nur `pages/bbe3-bruecke.html`: Sie übergibt ein Programm aus dem Blockbild-Editor 3
an den alten Editor (Menü *Exportieren → Im alten Editor öffnen* bzw. *Bild in alter Optik*). Sie legt das Programm in
`localStorage` („autoSavedDiagram“) ab, betätigt „Letztes Diagramm wiederherstellen“ und erzeugt bei Bedarf je
Unterprogramm ein PNG der „fertigen“ Ansicht. Die Originaldateien werden dabei nicht verändert.

Vielen Dank an Stefan Egger und Michael Delfser!
