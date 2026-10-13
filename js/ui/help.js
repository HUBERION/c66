/* Blockbild-Editor – Hilfetexte */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  const de = `
<nav aria-label="Inhalt">
  <a href="#h-start">Erste Schritte</a>
  <a href="#h-blocks">Bausteine</a>
  <a href="#h-expr">Ausdrücke</a>
  <a href="#h-sub">Unterprogramme</a>
  <a href="#h-arrays">Arrays</a>
  <a href="#h-run">Ausführen</a>
  <a href="#h-c">Code (16 Sprachen)</a>
  <a href="#h-mg">MARTIN GOES</a>
  <a href="#h-files">Dateien</a>
  <a href="#h-python">Python übernehmen</a>
  <a href="#h-keys">Tastenkürzel</a>
</nav>
<div>
<section id="h-start">
  <h3>Erste Schritte</h3>
  <p>Ein Blockbild (Struktogramm) beschreibt ein Programm als Blöcke, die von oben nach unten ausgeführt werden.
  Zieh einen Baustein aus der Palette links in das Diagramm – die blaue Linie zeigt, wo er landet.
  Ein Klick auf einen Baustein fügt ihn direkt <b>nach dem markierten Block</b> ein (ohne Markierung am Ende).</p>
  <ul>
    <li>Felder direkt anklicken und tippen. Rot unterstrichene Felder enthalten einen Fehler – der Tooltip erklärt ihn.</li>
    <li>Blöcke lassen sich verschieben: einfach ziehen. Mit gedrückter <kbd>Strg</kbd>-Taste wird kopiert.</li>
    <li>Rechtsklick oder die Schaltfläche <b>⋯</b> neben dem markierten Block öffnet weitere Aktionen
    (Kommentar, Duplizieren, SONST hinzufügen, in WENN einpacken, Haltepunkt …).</li>
    <li>Auf Tablets: Baustein antippen zum Einfügen, <b>lange drücken</b> zum Ziehen.</li>
    <li>Leere Bereiche zeigen <code>∅</code> – ein Klick darauf fügt dort einen Block ein.</li>
  </ul>
</section>
<section id="h-blocks">
  <h3>Bausteine</h3>
  <table>
    <tr><th>Baustein</th><th>Bedeutung</th><th>Beispiel</th></tr>
    <tr><td>DEKLARATION</td><td>legt eine Variable mit Typ und Startwert an</td><td><code>Zahl : n = 0</code></td></tr>
    <tr><td>ZUWEISUNG</td><td>berechnet einen Wert und speichert ihn</td><td><code>summe = summe + i</code></td></tr>
    <tr><td>EINGABE</td><td>zeigt eine Frage und liest einen Wert ein</td><td><code>"Alter: " , alter</code></td></tr>
    <tr><td>AUSGABE</td><td>zeigt Text und Werte in der Konsole</td><td><code>"Summe: " + summe</code></td></tr>
    <tr><td>WENN … DANN … SONST</td><td>Verzweigung; SONST ist optional</td><td><code>n % 2 == 0</code></td></tr>
    <tr><td>FALLS … FALL … SONST</td><td>Mehrfachauswahl nach einem Wert</td><td><code>note</code> mit Fällen 1, 2, 3 …</td></tr>
    <tr><td>SOLANGE</td><td>prüft zuerst – 0 bis n Durchläufe</td><td><code>i &lt;= n</code></td></tr>
    <tr><td>FÜR</td><td>Zählschleife – genau n Durchläufe</td><td><code>i VON 1 BIS n SCHRITT +1</code></td></tr>
    <tr><td>WIEDERHOLE … BIS</td><td>prüft am Ende – 1 bis n Durchläufe; endet, wenn die Bedingung <b>wahr</b> ist</td><td><code>BIS note &gt;= 1 &amp;&amp; note &lt;= 5</code></td></tr>
    <tr><td>AUFRUF</td><td>startet ein Unterprogramm</td><td><code>g = ggt(a, b)</code></td></tr>
    <tr><td>KOMMENTAR</td><td>Notiz ohne Wirkung, z. B. für Eingabe – Verarbeitung – Ausgabe</td><td><code>// Verarbeitung</code></td></tr>
  </table>
  <p>SONST und FALL sind keine eigenen Anweisungen: zieh sie auf einen WENN- bzw. FALLS-Block.</p>
</section>
<section id="h-expr">
  <h3>Ausdrücke</h3>
  <p>Texte stehen in Anführungszeichen (<code>"Hallo"</code>), Zahlen ohne (<code>42</code>, <code>1.25</code>).
  <code>+</code> verbindet Texte: <code>"Du bist " + alter + " Jahre alt"</code>.</p>
  <table>
    <tr><th>Art</th><th>Ergebnis</th><th>Operatoren</th></tr>
    <tr><td>numerisch</td><td>Zahl</td><td><code>+ - * / %</code> und Klammern</td></tr>
    <tr><td>logisch</td><td>wahr/falsch</td><td><code>== != &lt; &lt;= &gt; &gt;= &amp;&amp; || !</code></td></tr>
    <tr><td>Text</td><td>Text</td><td><code>+</code> zum Verketten, <code>text.length</code></td></tr>
  </table>
  <p>Vergleiche brauchen <code>==</code>; ein einzelnes <code>=</code> gibt es nur im Zuweisungsblock.
  <code>&amp;&amp;</code> und <code>||</code> werten nur so weit aus wie nötig (Kurzschlussauswertung).</p>
</section>
<section id="h-sub">
  <h3>Unterprogramme</h3>
  <p>Mit <b>+ Unterprogramm</b> entsteht ein neuer Reiter. Oben legst du Rückgabetyp, Namen und Parameter fest.</p>
  <ul>
    <li><b>In</b> ↓ – das Unterprogramm erhält eine Kopie des Wertes (call by value).</li>
    <li><b>InOut</b> ↕ – das Unterprogramm arbeitet mit dem Original (call by reference). Beim Aufruf muss eine Variable stehen.</li>
    <li>Mit Rückgabetyp <i>Zahl</i> oder <i>Text</i> gibt es automatisch die Variable <code>result</code>; ihr Wert wird am Ende zurückgegeben. Den Startwert legst du in der ersten Zeile fest.</li>
    <li>Der AUFRUF-Block zeigt die Parameter des gewählten Unterprogramms als Felder an.</li>
  </ul>
  <p>Unterprogramme dürfen sich selbst aufrufen (Rekursion). Im Stack siehst du jeden Aufruf als eigenen Rahmen.</p>
</section>
<section id="h-arrays">
  <h3>Arrays</h3>
  <p>Typ <i>Zahl[]</i> oder <i>Text[]</i> wählen und die Länge angeben – die Länge darf auch eine Variable sein, z. B. aus einer Eingabe.
  Elemente sprichst du mit <code>werte[i]</code> an (Index von 0 bis Länge − 1), die Länge mit <code>werte.length</code>.
  Arrays werden immer als Original (InOut) übergeben.</p>
</section>
<section id="h-run">
  <h3>Ausführen und beobachten</h3>
  <ul>
    <li><b>Start</b> führt das Programm mit dem gewählten Tempo aus, <b>Schritt</b> geht Block für Block, <b>Stopp</b> bricht ab.</li>
    <li>Der gelb markierte Block wurde gerade ausgeführt. Rechts siehst du den <b>Stack</b>: jede Variable mit Wert, bei Bedarf mit Adresse (Schalter <code>0x</code>). Geänderte Werte leuchten kurz auf.</li>
    <li>InOut-Parameter erscheinen kursiv mit Pfeil auf die Originalvariable – beide haben dieselbe Adresse.</li>
    <li><b>Haltepunkte</b> (<kbd>F9</kbd> oder Kontextmenü) halten das Programm vor einem Block an.</li>
    <li>Eingaben tippst du unten in der Konsole. <kbd>Esc</kbd> bricht eine Eingabe ab – die Variable behält dann ihren Startwert. Deshalb lohnt es sich, immer sinnvolle Startwerte zu vergeben.</li>
    <li>Bei einem Laufzeitfehler (z. B. Division durch 0, Index außerhalb des Arrays) wird der Block rot markiert und erklärt.</li>
  </ul>
</section>
<section id="h-c">
  <h3>Code in 16 Sprachen</h3>
  <p>Der Reiter <b>Code</b> zeigt das Programm in der Sprache, die in der Auswahlliste gewählt ist; <i>Exportieren</i> und
  der Knopf <i>Herunterladen</i> speichern die Datei.</p>
  <table>
    <tr><th>Gruppe</th><th>Sprachen</th></tr>
    <tr><td>Verbreitet</td><td>C, C++, C#, Java, Python, JavaScript</td></tr>
    <tr><td>Skriptsprachen</td><td>bash, csh (tcsh), Lua</td></tr>
    <tr><td>Systemnah</td><td>Rust, x86-Assembler für MS-DOS (NASM, .COM-Programm)</td></tr>
    <tr><td>Klassiker</td><td>Fortran, COBOL, BASIC (QBasic-Stil), RPG IV (IBM i)</td></tr>
    <tr><td>Lehrmaschine</td><td>MARTIN GOES (siehe eigenes Kapitel)</td></tr>
  </table>
  <p>Alle Übersetzungen rechnen wie C mit ganzen Zahlen (<code>7 / 2</code> ergibt 3). Einschränkungen: x86-Assembler rechnet mit
  16 Bit (−32768 … 32767), COBOL und RPG kennen höchstens 1000 Array-Elemente, RPG gibt über <code>DSPLY</code> aus
  (höchstens 52 Zeichen pro Zeile), csh kennt keine Funktionen (Unterprogramme werden zu Sprungmarken mit <code>goto</code>),
  MARTIN GOES kennt keine Texte.</p>
  <p>
  In C++ werden InOut-Parameter zu Referenzen (<code>int&amp; a</code>), in C# zu <code>ref</code>, in Fortran zu <code>intent(inout)</code>,
  in COBOL zu <code>BY REFERENCE</code>. JavaScript läuft mit <code>node datei.js</code>, Fortran mit <code>gfortran</code>,
  COBOL mit GnuCOBOL (<code>cobc -x datei.cob</code>; Arrays dort mit höchstens 1000 Elementen).
  In Java heißt die Klasse wie die Datei, InOut-Zahlen stehen dort in einem Array mit einem Element. In Python geben Unterprogramme
  InOut-Werte zurück (<code>x, y = tausche(x, y)</code>).</p>
  <p>Der Reiter <b>C-Code</b> zeigt das Programm als C99-Quelltext, der sich mit <code>gcc</code> übersetzen lässt.
  Dabei wird <i>Zahl</i> zu <code>int</code> (Nachkommastellen fallen weg), <i>Text</i> zu <code>char[MAX_STRING_SIZE]</code>,
  InOut-Zahlen werden zu Zeigern und Arrays bekommen eine zusätzliche Größenvariable <code>nameSize</code>.</p>
</section>
<section id="h-mg">
  <h3>MARTIN GOES</h3>
  <p>MARTIN GOES ist eine kleine Lehrmaschine (Definition: Martin): nur Zellen, ganze Zahlen und Sprünge.
  Der Code-Reiter übersetzt ein Blockbild in diese Sprache – so sieht man, was ein Compiler aus WENN, Schleifen,
  Unterprogrammen und Arrays macht.</p>
  <h4>Speicher</h4>
  <p>Unendlich viele Zellen 0, 1, 2, … Jede Zelle hält eine beliebig große ganze Zahl, auch negativ, und ist am Anfang 0.</p>
  <h4>Programm</h4>
  <p>Eine Liste von Befehlen mit optionalen Labels (<code>name:</code>). Die Ausführung startet beim ersten Befehl und läuft
  der Reihe nach, außer ein Sprung lenkt um. Läuft das Programm über den letzten Befehl hinaus, endet es wie bei <code>T</code>.
  Kommentare beginnen mit <code>;</code>.</p>
  <h4>Operanden</h4>
  <table>
    <tr><th>Schreibweise</th><th>Bedeutung</th></tr>
    <tr><td><code>#5</code></td><td>Konstante 5 (nur als Quelle)</td></tr>
    <tr><td><code>5</code></td><td>Zelle 5</td></tr>
    <tr><td><code>@5</code></td><td>Zelle, deren Adresse in Zelle 5 steht (indirekt)</td></tr>
  </table>
  <p>Das indirekte <code>@</code> macht Arrays, Stapel und „Band“ möglich.</p>
  <h4>Befehle</h4>
  <table>
    <tr><th>Befehl</th><th>Name</th><th>Wirkung</th></tr>
    <tr><td><code>M x y</code></td><td>Multiply</td><td>x := x · y</td></tr>
    <tr><td><code>A x y</code></td><td>Add</td><td>x := x + y</td></tr>
    <tr><td><code>R x y</code></td><td>Reduce</td><td>x := x − y</td></tr>
    <tr><td><code>T</code></td><td>Terminate</td><td>Programm beenden</td></tr>
    <tr><td><code>I x</code></td><td>Input</td><td>Zahl einlesen nach x</td></tr>
    <tr><td><code>N x</code></td><td>Negate</td><td>x := −x</td></tr>
    <tr><td><code>G L</code></td><td>Goto</td><td>springe zu Label L</td></tr>
    <tr><td><code>O x</code></td><td>Output</td><td>x ausgeben</td></tr>
    <tr><td><code>E x L</code></td><td>Equal zero?</td><td>wenn x = 0, springe zu L</td></tr>
    <tr><td><code>S x y</code></td><td>Set/Store</td><td>x := y (kopieren, mit @ auch Laden/Speichern)</td></tr>
  </table>
  <p><b>Turing-Vollständigkeit:</b> <code>A x #1</code>, <code>R x #1</code> und <code>E</code> auf unbegrenzten Zellen ergeben eine
  Minsky-Maschine, und die ist Turing-vollständig. M, N, G, S, I und O sind Komfort.</p>
  <h4>Beispiel: Fakultät</h4>
  <pre>      I  0          ; n einlesen
      S  1 #1       ; ergebnis := 1
loop: E  0 ende     ; n = 0? -&gt; fertig
      M  1 0        ; ergebnis := ergebnis · n
      R  0 #1       ; n := n − 1
      G  loop
ende: O  1          ; ergebnis ausgeben
      T</pre>
  <p>Bei Eingabe 5 kommt 120 heraus.</p>
  <h4>So übersetzt der Editor</h4>
  <ul>
    <li>Variablen des Hauptprogramms liegen in den Zellen 0, 1, 2, … (der Kopf des Programms zeigt, welche Zelle welche Variable ist).</li>
    <li><b>Vergleiche:</b> <code>E</code> prüft nur auf 0. „Kleiner als“ wird mit einer Schleife nachgebaut: die Differenz d wird
    gleichzeitig hinauf- und hinuntergezählt (d+k, d−k) – wird zuerst d−k zu 0, war d ≥ 0, sonst war d &lt; 0.</li>
    <li><b>Division und Rest</b> entstehen durch wiederholtes Abziehen (Ergebnis Richtung 0 abgeschnitten, wie in C).</li>
    <li><b>Unterprogramme</b> bekommen einen Rahmen auf einem Stapel ab Zelle 1000000 (Rücksprung-Nummer, alter Rahmenzeiger,
    Parameter, Variablen). Weil <code>G</code> nur feste Labels kennt, springt jedes Unterprogramm am Ende zu <code>zurueck</code>,
    das die Rücksprung-Nummer mit <code>E</code>-Befehlen der richtigen Aufrufstelle zuordnet. InOut-Parameter bekommen die
    Adresse der Variablen – Zugriff mit <code>@</code>. Rekursion funktioniert.</li>
    <li><b>Arrays</b> liegen auf einer Halde: erst die Länge, dann die Elemente. Die Variable enthält die Adresse.</li>
    <li><b>Texte</b> gibt es nicht: Text-Teile von Ausgaben werden zu Kommentaren, die Zahlen darin werden ausgegeben.
    Text-Variablen, -Eingaben und -Vergleiche lassen sich nicht übersetzen (Hinweis im Kopf des Programms).</li>
  </ul>
</section>
<section id="h-files">
  <h3>Dateien</h3>
  <ul>
    <li><b>Speichern</b> legt eine <code>.bb</code>-Datei an. Sie ist mit dem bisherigen Blockbild-Editor (Version 2.x) kompatibel – alte Dateien lassen sich öffnen und umgekehrt.</li>
    <li>Beim Öffnen kannst du statt des ganzen Diagramms auch nur die Unterprogramme übernehmen, um sie wiederzuverwenden.</li>
    <li>Eine <code>.bb</code>-Datei kann auch einfach auf das Fenster gezogen werden.</li>
    <li>Der Browser sichert dein Diagramm automatisch und stellt es beim nächsten Öffnen wieder her.</li>
    <li><b>Exportieren</b> erzeugt C-Code oder ein PNG-Bild des aktuellen Diagramms, z. B. für Protokolle.</li>
  </ul>
</section>
<section id="h-python">
  <h3>Python-Programme übernehmen</h3>
  <p>Beim <b>Öffnen</b> kannst du auch eine <code>.py</code>-Datei wählen (oder auf das Fenster ziehen). Sie wird automatisch in ein Blockbild übersetzt:</p>
  <ul>
    <li>Zuweisungen werden zu DEKLARATION bzw. ZUWEISUNG, <code>input()</code> und <code>int(input())</code> zu EINGABE, <code>print()</code> und f-Strings zu AUSGABE.</li>
    <li><code>if/elif/else</code> → WENN, <code>while</code> → SOLANGE, <code>while True: … if …: break</code> → WIEDERHOLE … BIS, <code>for i in range(…)</code> → FÜR, <code>match/case</code> → FALLS.</li>
    <li><code>def</code> wird zum Unterprogramm, <code>return</code> zur Ergebnisvariable <code>result</code>; Listen wie <code>[0] * n</code> werden zu Arrays.</li>
    <li>Was es im Blockbild nicht gibt (Klassen, <code>append</code>, <code>break</code> mitten in Schleifen …), steht danach als ⚠-Kommentar im Diagramm. Eine Liste zeigt alle Stellen.</li>
  </ul>
</section>
<section id="h-keys">
  <h3>Tastenkürzel</h3>
  <div class="keys">
    <span><kbd>F5</kbd></span><span>Start / Pause / Weiter</span>
    <span><kbd>F10</kbd></span><span>Ein Schritt</span>
    <span><kbd>Shift</kbd> + <kbd>F5</kbd></span><span>Stopp</span>
    <span><kbd>F9</kbd></span><span>Haltepunkt am markierten Block</span>
    <span><kbd>Strg</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd></span><span>Rückgängig / Wiederholen</span>
    <span><kbd>Strg</kbd> + <kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd></span><span>Kopieren / Ausschneiden / Einfügen</span>
    <span><kbd>Strg</kbd> + <kbd>D</kbd></span><span>Duplizieren</span>
    <span><kbd>Entf</kbd></span><span>Markierte Blöcke löschen</span>
    <span><kbd>↑</kbd> <kbd>↓</kbd></span><span>Vorheriger / nächster Block</span>
    <span><kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></span><span>Block nach oben / unten verschieben</span>
    <span><kbd>Enter</kbd></span><span>Erstes Feld des Blocks bearbeiten; im Feld: fertig</span>
    <span><kbd>Strg</kbd> + <kbd>Leertaste</kbd></span><span>Variablennamen vorschlagen</span>
    <span><kbd>Strg</kbd> + <kbd>S</kbd> / <kbd>O</kbd></span><span>Speichern / Öffnen</span>
    <span><kbd>Strg</kbd> + Mausrad</span><span>Zoom</span>
  </div>
</section>
</div>`;

  const en = `
<nav aria-label="Contents">
  <a href="#h-start">Getting started</a>
  <a href="#h-blocks">Blocks</a>
  <a href="#h-expr">Expressions</a>
  <a href="#h-sub">Subprograms</a>
  <a href="#h-arrays">Arrays</a>
  <a href="#h-run">Running</a>
  <a href="#h-c">Code (16 languages)</a>
  <a href="#h-mg">MARTIN GOES</a>
  <a href="#h-files">Files</a>
  <a href="#h-python">Importing Python</a>
  <a href="#h-keys">Shortcuts</a>
</nav>
<div>
<section id="h-start">
  <h3>Getting started</h3>
  <p>A block diagram (structogram) describes a program as blocks that run from top to bottom.
  Drag a block from the palette into the diagram – the blue line shows where it lands.
  Clicking a palette block inserts it <b>after the selected block</b> (or at the end).</p>
  <ul>
    <li>Click a field and type. Fields underlined in red contain an error – the tooltip explains it.</li>
    <li>Drag blocks to move them. Hold <kbd>Ctrl</kbd> to copy instead.</li>
    <li>Right-click or the <b>⋯</b> button next to the selected block opens more actions
    (comment, duplicate, add ELSE, wrap in IF, breakpoint …).</li>
    <li>On tablets: tap a palette block to insert it, <b>long-press</b> to drag.</li>
    <li>Empty areas show <code>∅</code> – click it to insert a block there.</li>
  </ul>
</section>
<section id="h-blocks">
  <h3>Blocks</h3>
  <table>
    <tr><th>Block</th><th>Meaning</th><th>Example</th></tr>
    <tr><td>DECLARATION</td><td>creates a variable with type and start value</td><td><code>Number : n = 0</code></td></tr>
    <tr><td>ASSIGNMENT</td><td>computes a value and stores it</td><td><code>sum = sum + i</code></td></tr>
    <tr><td>INPUT</td><td>asks a question and reads a value</td><td><code>"Age: " , age</code></td></tr>
    <tr><td>OUTPUT</td><td>shows text and values in the console</td><td><code>"Sum: " + sum</code></td></tr>
    <tr><td>IF … THEN … ELSE</td><td>branch; ELSE is optional</td><td><code>n % 2 == 0</code></td></tr>
    <tr><td>SWITCH … CASE … ELSE</td><td>multiple choice by value</td><td><code>grade</code> with cases 1, 2, 3 …</td></tr>
    <tr><td>WHILE</td><td>checks first – 0 to n iterations</td><td><code>i &lt;= n</code></td></tr>
    <tr><td>FOR</td><td>counting loop – exactly n iterations</td><td><code>i = 1 TO n BY +1</code></td></tr>
    <tr><td>REPEAT … UNTIL</td><td>checks at the end – 1 to n iterations; stops when the condition is <b>true</b></td><td><code>UNTIL grade &gt;= 1 &amp;&amp; grade &lt;= 5</code></td></tr>
    <tr><td>CALL</td><td>runs a subprogram</td><td><code>g = gcd(a, b)</code></td></tr>
    <tr><td>COMMENT</td><td>note without effect, e.g. for input – processing – output</td><td><code>// processing</code></td></tr>
  </table>
  <p>ELSE and CASE are not statements of their own: drop them onto an IF or SWITCH block.</p>
</section>
<section id="h-expr">
  <h3>Expressions</h3>
  <p>Texts go in quotes (<code>"Hello"</code>), numbers don’t (<code>42</code>, <code>1.25</code>).
  <code>+</code> joins texts: <code>"You are " + age + " years old"</code>.</p>
  <table>
    <tr><th>Kind</th><th>Result</th><th>Operators</th></tr>
    <tr><td>numeric</td><td>Number</td><td><code>+ - * / %</code> and parentheses</td></tr>
    <tr><td>logical</td><td>true/false</td><td><code>== != &lt; &lt;= &gt; &gt;= &amp;&amp; || !</code></td></tr>
    <tr><td>text</td><td>Text</td><td><code>+</code> to join, <code>text.length</code></td></tr>
  </table>
  <p>Comparisons need <code>==</code>; a single <code>=</code> only exists in the assignment block.
  <code>&amp;&amp;</code> and <code>||</code> only evaluate as far as needed (short-circuit evaluation).</p>
</section>
<section id="h-sub">
  <h3>Subprograms</h3>
  <p><b>+ Subprogram</b> adds a new tab. At the top you set return type, name and parameters.</p>
  <ul>
    <li><b>In</b> ↓ – the subprogram receives a copy of the value (call by value).</li>
    <li><b>InOut</b> ↕ – the subprogram works on the original (call by reference). The call must pass a variable.</li>
    <li>With return type <i>Number</i> or <i>Text</i> the variable <code>result</code> is created automatically; its value is returned at the end. Set its start value in the first row.</li>
    <li>The CALL block shows one field per parameter of the chosen subprogram.</li>
  </ul>
  <p>Subprograms may call themselves (recursion). The stack shows each call as its own frame.</p>
</section>
<section id="h-arrays">
  <h3>Arrays</h3>
  <p>Choose type <i>Number[]</i> or <i>Text[]</i> and enter the length – it may be a variable, e.g. from an input.
  Access elements with <code>values[i]</code> (index from 0 to length − 1) and the length with <code>values.length</code>.
  Arrays are always passed as the original (InOut).</p>
</section>
<section id="h-run">
  <h3>Running and watching</h3>
  <ul>
    <li><b>Run</b> executes at the chosen speed, <b>Step</b> goes block by block, <b>Stop</b> aborts.</li>
    <li>The yellow block has just been executed. On the right you see the <b>stack</b>: every variable with its value, optionally with its address (toggle <code>0x</code>). Changed values light up.</li>
    <li>InOut parameters appear in italics with an arrow to the original variable – both share the same address.</li>
    <li><b>Breakpoints</b> (<kbd>F9</kbd> or context menu) pause the program before a block.</li>
    <li>Type inputs at the bottom of the console. <kbd>Esc</kbd> cancels an input – the variable keeps its start value. That is why sensible start values matter.</li>
    <li>Runtime errors (e.g. division by 0, index outside the array) mark the block in red and explain the problem.</li>
  </ul>
</section>
<section id="h-c">
  <h3>Code in 16 languages</h3>
  <p>The <b>Code</b> tab shows the program in the language chosen in the list; <i>Export</i> and the <i>Download</i>
  button save the file.</p>
  <table>
    <tr><th>Group</th><th>Languages</th></tr>
    <tr><td>Popular</td><td>C, C++, C#, Java, Python, JavaScript</td></tr>
    <tr><td>Scripting</td><td>bash, csh (tcsh), Lua</td></tr>
    <tr><td>Systems</td><td>Rust, x86 assembler for MS-DOS (NASM, .COM program)</td></tr>
    <tr><td>Classics</td><td>Fortran, COBOL, BASIC (QBasic style), RPG IV (IBM i)</td></tr>
    <tr><td>Teaching machine</td><td>MARTIN GOES (see its own chapter)</td></tr>
  </table>
  <p>All translations compute with whole numbers like C (<code>7 / 2</code> gives 3). Limits: x86 assembler uses 16 bit
  (−32768 … 32767), COBOL and RPG allow at most 1000 array elements, RPG prints via <code>DSPLY</code> (at most 52 characters
  per line), csh has no functions (subprograms become labels with <code>goto</code>), MARTIN GOES has no texts.</p>
  <p>
  In C++ InOut parameters become references (<code>int&amp; a</code>), in C# <code>ref</code>, in Fortran <code>intent(inout)</code>,
  in COBOL <code>BY REFERENCE</code>. JavaScript runs with <code>node file.js</code>, Fortran with <code>gfortran</code>,
  COBOL with GnuCOBOL (<code>cobc -x file.cob</code>; arrays there hold at most 1000 elements).
  In Java the class is named after the file and InOut numbers live in a one-element array. In Python subprograms
  return InOut values (<code>x, y = swap(x, y)</code>).</p>
  <p>The <b>C code</b> tab shows the program as C99 source that compiles with <code>gcc</code>.
  <i>Number</i> becomes <code>int</code> (decimals are dropped), <i>Text</i> becomes <code>char[MAX_STRING_SIZE]</code>,
  InOut numbers become pointers and arrays get an extra size variable <code>nameSize</code>.</p>
</section>
<section id="h-mg">
  <h3>MARTIN GOES</h3>
  <p>MARTIN GOES is a tiny teaching machine (defined by Martin): only cells, whole numbers and jumps.
  The Code tab translates a diagram into this language – so you can see what a compiler makes of IF, loops,
  subprograms and arrays.</p>
  <h4>Memory</h4>
  <p>Infinitely many cells 0, 1, 2, … Every cell holds an arbitrarily large whole number, also negative, and starts at 0.</p>
  <h4>Program</h4>
  <p>A list of commands with optional labels (<code>name:</code>). Execution starts at the first command and runs in order
  unless a jump redirects it. Running past the last command ends the program like <code>T</code>. Comments start with <code>;</code>.</p>
  <h4>Operands</h4>
  <table>
    <tr><th>Notation</th><th>Meaning</th></tr>
    <tr><td><code>#5</code></td><td>constant 5 (source only)</td></tr>
    <tr><td><code>5</code></td><td>cell 5</td></tr>
    <tr><td><code>@5</code></td><td>the cell whose address is in cell 5 (indirect)</td></tr>
  </table>
  <p>Indirect <code>@</code> makes arrays, stacks and a “tape” possible.</p>
  <h4>Commands</h4>
  <table>
    <tr><th>Command</th><th>Name</th><th>Effect</th></tr>
    <tr><td><code>M x y</code></td><td>Multiply</td><td>x := x · y</td></tr>
    <tr><td><code>A x y</code></td><td>Add</td><td>x := x + y</td></tr>
    <tr><td><code>R x y</code></td><td>Reduce</td><td>x := x − y</td></tr>
    <tr><td><code>T</code></td><td>Terminate</td><td>end the program</td></tr>
    <tr><td><code>I x</code></td><td>Input</td><td>read a number into x</td></tr>
    <tr><td><code>N x</code></td><td>Negate</td><td>x := −x</td></tr>
    <tr><td><code>G L</code></td><td>Goto</td><td>jump to label L</td></tr>
    <tr><td><code>O x</code></td><td>Output</td><td>output x</td></tr>
    <tr><td><code>E x L</code></td><td>Equal zero?</td><td>if x = 0, jump to L</td></tr>
    <tr><td><code>S x y</code></td><td>Set/Store</td><td>x := y (copy; with @ also load/store)</td></tr>
  </table>
  <p><b>Turing completeness:</b> <code>A x #1</code>, <code>R x #1</code> and <code>E</code> on unbounded cells form a Minsky machine,
  which is Turing complete. M, N, G, S, I and O are for comfort.</p>
  <h4>Example: factorial</h4>
  <pre>      I  0          ; read n
      S  1 #1       ; result := 1
loop: E  0 done     ; n = 0? -&gt; finished
      M  1 0        ; result := result · n
      R  0 #1       ; n := n − 1
      G  loop
done: O  1          ; output result
      T</pre>
  <p>Input 5 gives 120.</p>
  <h4>How the editor translates</h4>
  <ul>
    <li>Variables of the main program live in cells 0, 1, 2, … (the program header lists which cell holds which variable).</li>
    <li><b>Comparisons:</b> <code>E</code> only tests for 0. “Less than” is built with a loop: the difference d is counted up and
    down at the same time (d+k, d−k) – if d−k reaches 0 first, d ≥ 0, otherwise d &lt; 0.</li>
    <li><b>Division and remainder</b> use repeated subtraction (result cut toward 0, like C).</li>
    <li><b>Subprograms</b> get a frame on a stack starting at cell 1000000 (return number, old frame pointer, parameters,
    variables). Since <code>G</code> only knows fixed labels, every subprogram finally jumps to <code>back</code>, which maps the
    return number to the right call site with <code>E</code> commands. InOut parameters receive the variable's address –
    accessed with <code>@</code>. Recursion works.</li>
    <li><b>Arrays</b> live on a heap: first the length, then the elements. The variable holds the address.</li>
    <li><b>Texts</b> do not exist: text parts of outputs become comments, the numbers in them are output.
    Text variables, text input and text comparisons cannot be translated (note in the program header).</li>
  </ul>
</section>
<section id="h-files">
  <h3>Files</h3>
  <ul>
    <li><b>Save</b> writes a <code>.bb</code> file compatible with the previous block diagram editor (version 2.x) – old files open here and vice versa.</li>
    <li>When opening you can take over only the subprograms instead of the whole diagram, to reuse them.</li>
    <li>You can also drop a <code>.bb</code> file onto the window.</li>
    <li>The browser saves your diagram automatically and restores it next time.</li>
    <li><b>Export</b> creates C code or a PNG image of the current diagram, e.g. for reports.</li>
  </ul>
</section>
<section id="h-python">
  <h3>Importing Python programs</h3>
  <p>With <b>Open</b> you can also pick a <code>.py</code> file (or drop it onto the window). It is translated into a block diagram automatically:</p>
  <ul>
    <li>Assignments become DECLARATION or ASSIGNMENT, <code>input()</code> and <code>int(input())</code> become INPUT, <code>print()</code> and f-strings become OUTPUT.</li>
    <li><code>if/elif/else</code> → IF, <code>while</code> → WHILE, <code>while True: … if …: break</code> → REPEAT … UNTIL, <code>for i in range(…)</code> → FOR, <code>match/case</code> → SWITCH.</li>
    <li><code>def</code> becomes a subprogram, <code>return</code> the result variable <code>result</code>; lists like <code>[0] * n</code> become arrays.</li>
    <li>Anything block diagrams cannot express (classes, <code>append</code>, <code>break</code> in the middle of loops …) appears as a ⚠ comment in the diagram. A list shows every place.</li>
  </ul>
</section>
<section id="h-keys">
  <h3>Keyboard shortcuts</h3>
  <div class="keys">
    <span><kbd>F5</kbd></span><span>Run / pause / continue</span>
    <span><kbd>F10</kbd></span><span>One step</span>
    <span><kbd>Shift</kbd> + <kbd>F5</kbd></span><span>Stop</span>
    <span><kbd>F9</kbd></span><span>Breakpoint on the selected block</span>
    <span><kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd></span><span>Undo / redo</span>
    <span><kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd></span><span>Copy / cut / paste</span>
    <span><kbd>Ctrl</kbd> + <kbd>D</kbd></span><span>Duplicate</span>
    <span><kbd>Del</kbd></span><span>Delete selected blocks</span>
    <span><kbd>↑</kbd> <kbd>↓</kbd></span><span>Previous / next block</span>
    <span><kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></span><span>Move block up / down</span>
    <span><kbd>Enter</kbd></span><span>Edit the block’s first field; in a field: done</span>
    <span><kbd>Ctrl</kbd> + <kbd>Space</kbd></span><span>Suggest variable names</span>
    <span><kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>O</kbd></span><span>Save / open</span>
    <span><kbd>Ctrl</kbd> + mouse wheel</span><span>Zoom</span>
  </div>
</section>
</div>`;

  BBE.help = { de, en };
})(window);
