/* Blockbild-Editor – Übersetzung nach COBOL (GnuCOBOL 3, freies Format)
 *
 *   Jedes Unterprogramm wird ein eigenes Programm (RECURSIVE, LOCAL-STORAGE) in derselben Datei;
 *   Aufruf mit CALL … USING: In → BY CONTENT (Kopie), InOut und Arrays → BY REFERENCE,
 *   der Rückgabewert kommt als letzter Parameter (BY REFERENCE) zurück.
 *   Zahl → PIC S9(18).
 *   Text → PIC X(256) + Länge NAME-LEN (sonst gingen Leerzeichen am Ende verloren); Wert = NAME(1:NAME-LEN).
 *   Array → Tabelle mit 1000 Plätzen + Anzahl NAME-LEN; Text-Arrays haben je Element eine Länge NAME-L.
 *   COBOL zählt ab 1: aus a[i] wird A(I + 1). Zahlen werden für Texte über ein Druckfeld (PIC -(18)9) aufbereitet.
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip } = BBE.expr;
  const A = BBE.analyze;

  const IND = '    ';
  const NUM = 'PIC S9(18)';
  const TXT = 'PIC X(256)';
  const TLEN = 'PIC 9(3)';
  const EDIT = 'PIC -(18)9';
  const MAXARR = 1000;
  // Reservierte Wörter von GnuCOBOL (cobc --list-reserved)
  const RESERVED = new Set('3-D ABSENT ACCEPT ACCESS ACTION ACTIVE-CLASS ACTIVE-X ACTUAL ADD ADDRESS ADJUSTABLE-COLUMNS ADVANCING AFTER ALIGNED ALIGNMENT ALL ALLOCATE ALLOWING ALPHABET ALPHABETIC ALPHABETIC-LOWER ALPHABETIC-UPPER ALPHANUMERIC ALPHANUMERIC-EDITED ALSO ALTER ALTERNATE AND ANY ANYCASE APPLY ARE AREA AREAS ARGUMENT-NUMBER ARGUMENT-VALUE ARITHMETIC AS ASCENDING ASCII ASSIGN AT ATTRIBUTE ATTRIBUTES AUTHOR AUTO AUTO-DECIMAL AUTO-SKIP AUTO-SPIN AUTOMATIC AUTOTERMINATE AWAY-FROM-ZERO B-AND B-NOT B-OR B-XOR BACKGROUND-COLOR BACKGROUND-COLOUR BACKGROUND-HIGH BACKGROUND-LOW BACKGROUND-STANDARD BAR BASED BEEP BEFORE BELL BINARY BINARY-C-LONG BINARY-CHAR BINARY-DOUBLE BINARY-INT BINARY-LONG BINARY-LONG-LONG BINARY-SEQUENTIAL BINARY-SHORT BIT BITMAP BITMAP-END BITMAP-HANDLE BITMAP-NUMBER BITMAP-START BITMAP-TIMER BITMAP-TRAILING BITMAP-TRANSPARENT-COLOR BITMAP-WIDTH BLANK BLINK BLOCK BOOLEAN BOTTOM BOX BOXED BULK-ADDITION BUSY BUTTONS BY BYTE-LENGTH C CALENDAR-FONT CALL CANCEL CANCEL-BUTTON CAPACITY CARD-PUNCH CARD-READER CASSETTE CCOL CD CELL CELL-COLOR CELL-DATA CELL-FONT CELL-PROTECTION CELLS CENTER CENTERED CENTERED-HEADINGS CENTURY-DATE CF CH CHAIN CHAINING CHANGED CHARACTER CHARACTERS CHECK-BOX CLASS CLASS-ID CLASSIFICATION CLEAR-SELECTION CLINE CLINES CLOSE COB-CRT-STATUS COBOL CODE CODE-SET COL COLLATING COLOR COLORS COLOURS COLS COLUMN COLUMN-COLOR COLUMN-DIVIDERS COLUMN-FONT COLUMN-HEADINGS COLUMN-PROTECTION COLUMNS COMBO-BOX COMMA COMMAND-LINE COMMIT COMMON COMMUNICATION COMP COMP-0 COMP-1 COMP-2 COMP-3 COMP-4 COMP-5 COMP-6 COMP-N COMP-X COMPUTATIONAL COMPUTATIONAL-0 COMPUTATIONAL-1 COMPUTATIONAL-2 COMPUTATIONAL-3 COMPUTATIONAL-4 COMPUTATIONAL-5 COMPUTATIONAL-6 COMPUTATIONAL-N COMPUTATIONAL-X COMPUTE CONDITION CONFIGURATION CONSTANT CONTAINS CONTENT CONTINUE CONTROL CONTROLS CONVERSION CONVERTING COPY COPY-SELECTION CORE-INDEX CORR CORRESPONDING COUNT CRT CRT-UNDER CSIZE CURRENCY CURSOR CURSOR-COL CURSOR-COLOR CURSOR-FRAME-WIDTH CURSOR-ROW CURSOR-X CURSOR-Y CUSTOM-PRINT-TEMPLATE CYCLE CYL-INDEX CYL-OVERFLOW DASHED DATA DATA-COLUMNS DATA-POINTER DATA-TYPES DATE DATE-COMPILED DATE-ENTRY DATE-MODIFIED DATE-WRITTEN DAY DAY-OF-WEEK DE DEBUG-ITEM DEBUGGING DECIMAL-POINT DECLARATIVES DEFAULT DEFAULT-BUTTON DEFAULT-FONT DELETE DELIMITED DELIMITER DEPENDING DESCENDING DESTINATION DESTROY DETAIL DISABLE DISC DISK DISP DISPLAY DISPLAY-COLUMNS DISPLAY-FORMAT DIVIDE DIVIDER-COLOR DIVIDERS DIVISION DOTDASH DOTTED DOUBLE DOWN DRAG-COLOR DROP-DOWN DROP-LIST DUPLICATES DYNAMIC EBCDIC EC ECHO EGI ELEMENT ELSE EMI EMPTY-CHECK ENABLE ENCODING ENCRYPTION END END-ACCEPT END-ADD END-CALL END-CHAIN END-COLOR END-COMPUTE END-DELETE END-DISPLAY END-DIVIDE END-EVALUATE END-IF END-JSON END-MODIFY END-MULTIPLY END-OF-PAGE END-PERFORM END-READ END-RECEIVE END-RETURN END-REWRITE END-SEARCH END-START END-STRING END-SUBTRACT END-UNSTRING END-WRITE END-XML ENGRAVED ENSURE-VISIBLE ENTRY ENTRY-CONVENTION ENTRY-FIELD ENTRY-REASON ENVIRONMENT ENVIRONMENT-NAME ENVIRONMENT-VALUE EO EOL EOP EOS EQUAL EQUALS ERASE ERROR ESCAPE ESCAPE-BUTTON ESI EVALUATE EVENT EVENT-LIST EVERY EXCEPTION EXCEPTION-OBJECT EXCEPTION-VALUE EXCLUSIVE EXHIBIT EXIT EXPAND EXPANDS EXTEND EXTENDED-SEARCH EXTERN EXTERNAL EXTERNAL-FORM F FACTORY FALSE FD FH--FCD FH--KEYDEF FILE FILE-CONTROL FILE-ID FILE-LIMIT FILE-LIMITS FILE-NAME FILE-POS FILL-COLOR FILL-COLOR2 FILL-PERCENT FILLER FINAL FINISH-REASON FIRST FIXED FIXED-FONT FIXED-WIDTH FLAT FLAT-BUTTONS FLOAT FLOAT-BINARY-128 FLOAT-BINARY-32 FLOAT-BINARY-64 FLOAT-DECIMAL-16 FLOAT-DECIMAL-34 FLOAT-EXTENDED FLOAT-INFINITY FLOAT-LONG FLOAT-NOT-A-NUMBER FLOAT-SHORT FLOATING FONT FOOTING FOR FOREGROUND-COLOR FOREGROUND-COLOUR FOREVER FORMAT FRAME FRAMED FREE FROM FULL FULL-HEIGHT FUNCTION FUNCTION-ID FUNCTION-POINTER GENERATE GET GIVING GLOBAL GO GO-BACK GO-FORWARD GO-HOME GO-SEARCH GOBACK GRAPHICAL GREATER GRID GROUP GROUP-USAGE GROUP-VALUE HANDLE HAS-CHILDREN HEADING HEADING-COLOR HEADING-DIVIDER-COLOR HEADING-FONT HEAVY HEIGHT-IN-CELLS HIDDEN-DATA HIGH-COLOR HIGH-VALUE HIGH-VALUES HIGHLIGHT HOT-TRACK HSCROLL HSCROLL-POS I-O I-O-CONTROL ICON ID IDENTIFICATION IDENTIFIED IF IGNORE IGNORING IMPLEMENTS IN INDEPENDENT INDEX INDEXED INDICATE INHERITS INITIAL INITIALISE INITIALISED INITIALIZE INITIALIZED INITIATE INPUT INPUT-OUTPUT INQUIRE INSERT-ROWS INSERTION-INDEX INSPECT INSTALLATION INTERFACE INTERFACE-ID INTERMEDIATE INTO INTRINSIC INVALID INVOKE IS ITEM ITEM-TEXT ITEM-TO-ADD ITEM-TO-DELETE ITEM-TO-EMPTY ITEM-VALUE JSON JSON-CODE JUST JUSTIFIED KEPT KEY KEYBOARD LABEL LABEL-OFFSET LARGE-FONT LARGE-OFFSET LAST LAST-ROW LAYOUT-DATA LAYOUT-MANAGER LEADING LEADING-SHIFT LEAVE LEFT LEFT-JUSTIFY LEFT-TEXT LEFTLINE LENGTH LENGTH-CHECK LESS LIKE LIMIT LIMITS LINAGE LINAGE-COUNTER LINE LINE-COUNTER LINE-SEQUENTIAL LINES LINES-AT-ROOT LINKAGE LIST-BOX LM-RESIZE LOC LOCAL-STORAGE LOCALE LOCK LOCK-HOLDING LONG-DATE LOW-COLOR LOW-VALUE LOW-VALUES LOWER LOWERED LOWLIGHT MAGNETIC-TAPE MANUAL MASS-UPDATE MASTER-INDEX MAX-LINES MAX-PROGRESS MAX-TEXT MAX-VAL MEDIUM-FONT MEMORY MENU MERGE MESSAGE METHOD METHOD-ID MIN-VAL MINUS MODE MODIFY MODULES MOVE MULTILINE MULTIPLE MULTIPLY NAME NAMED NAMESPACE NAMESPACE-PREFIX NATIONAL NATIONAL-EDITED NATIVE NAVIGATE-URL NEAREST-AWAY-FROM-ZERO NEAREST-EVEN NEAREST-TOWARD-ZERO NEGATIVE NESTED NEW NEXT NEXT-ITEM NO NO-AUTO-DEFAULT NO-AUTOSEL NO-BOX NO-DIVIDERS NO-ECHO NO-F4 NO-FOCUS NO-GROUP-TAB NO-KEY-LETTER NO-SEARCH NO-UPDOWN NOMINAL NONE NONNUMERIC NORMAL NOT NOTAB NOTHING NOTIFY NOTIFY-CHANGE NOTIFY-DBLCLICK NOTIFY-SELCHANGE NULL NULLS NUM-COL-HEADINGS NUM-ROWS NUMBER NUMBER-OF-CALL-PARAMETERS NUMBERS NUMERIC NUMERIC-EDITED OBJECT OBJECT-COMPUTER OBJECT-REFERENCE OCCURS OF OFF OK-BUTTON OMITTED ON ONLY OPEN OPTIONAL OPTIONS OR ORDER ORGANISATION ORGANIZATION OTHER OTHERS OUTPUT OVERFLOW OVERLAP-LEFT OVERLAP-TOP OVERLINE OVERRIDE PACKED-DECIMAL PADDING PAGE PAGE-COUNTER PAGE-SETUP PAGED PARAGRAPH PARENT PARSE PASCAL PASSWORD PERFORM PERMANENT PF PH PHYSICAL PIC PICTURE PIXEL PIXELS PLACEMENT PLUS POINTER POP-UP POS POSITION POSITION-SHIFT POSITIVE PREFIXED PRESENT PREVIOUS PRINT PRINT-NO-PROMPT PRINT-PREVIEW PRINTER PRINTER-1 PRINTING PRIORITY PROCEDURE PROCEDURE-POINTER PROCEDURES PROCEED PROCESSING PROGRAM PROGRAM-ID PROGRAM-POINTER PROGRESS PROHIBITED PROMPT PROPERTIES PROPERTY PROTECTED PROTOTYPE PURGE PUSH-BUTTON QUERY-INDEX QUEUE QUOTE QUOTES RADIO-BUTTON RAISE RAISED RAISING RANDOM RD READ READ-ONLY READERS RECEIVE RECORD RECORD-DATA RECORD-OVERFLOW RECORD-TO-ADD RECORD-TO-DELETE RECORDING RECORDS RECURSIVE REDEFINES REEL REFERENCE REFERENCES REFRESH REGION-COLOR RELATION RELATIVE RELEASE REMAINDER REMARKS REMOVAL RENAMES REORG-CRITERIA REPLACE REPLACING REPORT REPORTING REPORTS REPOSITORY REQUIRED REREAD RERUN RESERVE RESET RESET-GRID RESET-LIST RESET-TABS RESUME RETRY RETURN RETURN-CODE RETURNING REVERSE REVERSE-VIDEO REVERSED REWIND REWRITE RF RH RIGHT RIGHT-ALIGN RIGHT-JUSTIFY RIMMED ROLLBACK ROUNDED ROUNDING ROW-COLOR ROW-COLOR-PATTERN ROW-DIVIDERS ROW-FONT ROW-HEADINGS ROW-PROTECTION RUN S SAME SAVE-AS SAVE-AS-NO-PROMPT SCREEN SCROLL SCROLL-BAR SD SEARCH SEARCH-OPTIONS SEARCH-TEXT SECONDS SECTION SECURE SECURITY SEGMENT SEGMENT-LIMIT SELECT SELECT-ALL SELECTION-INDEX SELECTION-TEXT SELF SELF-ACT SEND SENTENCE SEPARATE SEPARATION SEQUENCE SEQUENTIAL SET SHADING SHADOW SHARING SHORT-DATE SHOW-LINES SHOW-NONE SHOW-SEL-ALWAYS SIGN SIGNED SIGNED-INT SIGNED-LONG SIGNED-SHORT SIZE SMALL-FONT SORT SORT-MERGE SORT-ORDER SORT-RETURN SOURCE SOURCE-COMPUTER SOURCES SPACE SPACE-FILL SPACES SPECIAL-NAMES SPINNER SQUARE STANDARD STANDARD-1 STANDARD-2 STANDARD-BINARY STANDARD-DECIMAL START START-X START-Y STATEMENT STATIC STATIC-LIST STATUS STATUS-BAR STATUS-TEXT STDCALL STEP STOP STRING STRONG STYLE SUB-QUEUE-1 SUB-QUEUE-2 SUB-QUEUE-3 SUBTRACT SUBWINDOW SUM SUPER SUPPRESS SYMBOL SYMBOLIC SYNC SYNCHRONISED SYNCHRONIZED SYSTEM-DEFAULT SYSTEM-INFO SYSTEM-OFFSET TAB TAB-TO-ADD TAB-TO-DELETE TABLE TALLY TALLYING TAPE TEMPORARY TERMINAL-INFO TERMINATE TERMINATION-VALUE TEST TEXT THAN THEN THREAD THREADS THROUGH THRU THUMB-POSITION TILED-HEADINGS TIME TIME-OUT TIMEOUT TIMES TITLE TITLE-POSITION TO TOP TOWARD-GREATER TOWARD-LESSER TRACK TRACK-AREA TRACK-LIMIT TRACKS TRADITIONAL-FONT TRAILING TRAILING-SHIFT TRAILING-SIGN TRANSFORM TRANSPARENT TREE-VIEW TRUE TRUNCATION TYPE TYPEDEF U UCS-4 UNBOUNDED UNDERLINE UNFRAMED UNIT UNIVERSAL UNLOCK UNSIGNED UNSIGNED-INT UNSIGNED-LONG UNSIGNED-SHORT UNSORTED UNSTRING UNTIL UP UPDATE UPDATERS UPON UPPER USAGE USE USE-ALT USE-RETURN USE-TAB USER USER-DEFAULT USING UTF-16 UTF-8 V VAL-STATUS VALID VALIDATE VALIDATE-STATUS VALIDATING VALUE VALUE-FORMAT VALUES VARIABLE VARIANT VARYING VERTICAL VERY-HEAVY VIRTUAL-WIDTH VOLATILE VPADDING VSCROLL VSCROLL-BAR VSCROLL-POS VTOP WAIT WEB-BROWSER WHEN WHEN-COMPILED WIDTH WIDTH-IN-CELLS WINDOW WITH WORDS WORKING-STORAGE WRAP WRITE WRITE-ONLY WRITE-VERIFY WRITERS X XML XML-CODE XML-DECLARATION Y YYYYDDD YYYYMMDD ZERO ZERO-FILL ZEROES ZEROS'.split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };
  const bytes = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length);

  /** COBOL-Literal(e) mit Länge: "…" mit verdoppeltem ", Steuerzeichen als X"0A". */
  function litParts(s) {
    const out = [];
    let cur = '';
    const flush = () => { if (cur) out.push({ op: '"' + cur.replace(/"/g, '""') + '"', len: bytes(cur) }); cur = ''; };
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c === 127) { flush(); out.push({ op: 'X"' + c.toString(16).toUpperCase().padStart(2, '0') + '"', len: 1 }); }
      else cur += ch;
    }
    flush();
    return out;
  }

  function cobName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase();
    if (!/^[A-Z]/.test(s) || s.startsWith('BB-')) s = 'V-' + s;
    s = s.slice(0, 24).replace(/-+$/, '');
    if (RESERVED.has(s)) s += '-V';
    return s;
  }

  /** Summe von Längen (Zahlen werden zusammengefasst). */
  function sumLens(lens) {
    let c = 0;
    const rest = [];
    for (const l of lens) { if (typeof l === 'number') c += l; else rest.push(l); }
    if (c || !rest.length) rest.push(String(c));
    return rest.join(' + ');
  }

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const used = { num: false };
    const P = tr('genArgPrompt').toUpperCase();
    const V = tr('genArgValue').toUpperCase();
    const HN = { prog: tr('cobolHelperNum'), prompt: P + '-TEXT', plen: P + '-LEN', line: V + '-TEXT', value: V + '-NUM' };
    const progNames = new Set([tr('cobolMain'), HN.prog]);
    const fnName = new Map();
    for (const f of program.fns.filter((x) => !x.isMain)) {
      let n = cobName(f.name);
      while (progNames.has(n)) n += '-P';
      progNames.add(n);
      fnName.set(f.name, n);
    }
    const programs = [];

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.rename.get(n) || cobName(n);

    function line(ctx, s) { ctx.lines.push(IND.repeat(ctx.ind) + s); }
    function block(ctx, seq) {
      ctx.ind++;
      const before = ctx.lines.length;
      for (const n of seq) genStmt(ctx, n);
      if (ctx.lines.length === before) line(ctx, 'CONTINUE');
      ctx.ind--;
    }

    /** Hilfsfeld; wird pro Anweisung neu gezählt. Z = Druckfeld, N = Zahl, T = Text (+ -LEN), B = true/false */
    function temp(ctx, kind) {
      ctx.cnt[kind] = (ctx.cnt[kind] || 0) + 1;
      ctx.max[kind] = Math.max(ctx.max[kind] || 0, ctx.cnt[kind]);
      return 'BB-' + kind + ctx.cnt[kind];
    }

    // ------------------------------------------------------------ Programme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const rename = new Map();
      const taken = new Set();
      const suffixes = (t) => (t === 'string' ? ['-LEN'] : t === 'integer[]' ? ['-TAB', '-LEN'] : t === 'string[]' ? ['-TAB', '-LEN', '-EL', '-L'] : []);
      const claim = (base, type) => {
        let b = base;
        let i = 2;
        const free = (x) => !taken.has(x) && suffixes(type).every((s) => !taken.has(x + s));
        while (!free(b)) b = base.slice(0, 20) + '-' + i++;
        taken.add(b);
        for (const s of suffixes(type)) taken.add(b + s);
        return b;
      };
      for (const [n, v] of scope) rename.set(n, claim(n === 'result' && !fn.isMain ? 'RESULT' : cobName(n), v.type));
      const ctx = { fn, scope, rename, ind: 1, lines: [], cnt: {}, max: {}, values: new Map(), valued: new Set() };
      // erste Deklarationen auf oberster Ebene mit einfachem Startwert → VALUE
      const seen = new Set();
      for (const n of fn.body) {
        if (n.kind !== 'decl' || !n.name || seen.has(n.name)) continue;
        seen.add(n.name);
        if (n.vtype.endsWith('[]')) continue;
        const ast = tryParse(n.init);
        const s = ast && strip(ast);
        if (!String(n.init || '').trim()) ctx.values.set(n.name, null);
        else if (n.vtype === 'integer' && s && (s.k === 'num' || (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num'))) {
          const v = A.literalValue(s);
          if (!Number.isInteger(v)) continue;
          ctx.values.set(n.name, String(v));
        } else if (n.vtype === 'string' && s && s.k === 'str' && bytes(s.v) <= 256) {
          const l = litParts(s.v);
          if (l.length > 1) continue;
          ctx.values.set(n.name, l.length ? l[0] : null);
        } else continue;
        ctx.valued.add(n);
      }

      if (!fn.isMain && fn.returnType !== 'void') {
        const dst = fn.returnType === 'string' ? { field: 'RESULT', len: 'RESULT-LEN' } : 'RESULT';
        assign(ctx, dst, fn.returnType, fn.resultInit);
      }
      for (const n of fn.body) genStmt(ctx, n);

      const pid = fn.isMain ? tr('cobolMain') : fnName.get(fn.name);
      const out = ['IDENTIFICATION DIVISION.', 'PROGRAM-ID. ' + pid + (fn.isMain ? '' : ' RECURSIVE') + '.', 'DATA DIVISION.'];
      const local = [];
      const link = [];
      const usingList = [];
      const field = (list, nm, type, value, init) => {
        const v = (x) => (init ? ' VALUE ' + x : '');
        if (type === 'integer') list.push('01 ' + nm + ' ' + NUM + v(value ? value : '0') + '.');
        else if (type === 'string') {
          list.push('01 ' + nm + ' ' + TXT + v(value ? value.op : 'SPACES') + '.');
          list.push('01 ' + nm + '-LEN ' + TLEN + v(value ? value.len : 0) + '.');
        } else {
          list.push('01 ' + nm + '-TAB.');
          if (type === 'integer[]') list.push('   05 ' + nm + ' ' + NUM + ' OCCURS ' + MAXARR + '.');
          else list.push('   05 ' + nm + '-EL OCCURS ' + MAXARR + '.', '      10 ' + nm + ' ' + TXT + '.', '      10 ' + nm + '-L ' + TLEN + '.');
          list.push('01 ' + nm + '-LEN ' + NUM + v(0) + '.');
        }
      };
      const usingOf = (nm, type) => (type === 'integer' ? [nm] : type === 'string' ? [nm, nm + '-LEN'] : [nm + '-TAB', nm + '-LEN']);
      for (const p of fn.params) {
        const nm = name(ctx, p.name || 'p');
        field(link, nm, p.type, null, false);
        usingList.push(...usingOf(nm, p.type));
      }
      if (!fn.isMain && fn.returnType !== 'void') { field(link, 'RESULT', fn.returnType, null, false); usingList.push(...usingOf('RESULT', fn.returnType)); }
      for (const [n, v] of scope) if (v.kind === 'decl') field(local, name(ctx, n), v.type, ctx.values.get(n), true);
      for (const k of ['Z', 'N', 'T', 'B']) {
        for (let i = 1; i <= (ctx.max[k] || 0); i++) {
          if (k === 'T') local.push('01 BB-T' + i + ' ' + TXT + '.', '01 BB-T' + i + '-LEN ' + TLEN + '.');
          else local.push('01 BB-' + k + i + ' ' + (k === 'Z' ? EDIT : k === 'N' ? NUM : 'PIC X(5)') + '.');
        }
      }
      if (local.length) out.push((fn.isMain ? 'WORKING-STORAGE' : 'LOCAL-STORAGE') + ' SECTION.', ...local);
      if (link.length) out.push('LINKAGE SECTION.', ...link);
      out.push('PROCEDURE DIVISION' + (usingList.length ? ' USING ' + usingList.join(' ') : '') + '.');
      out.push(...ctx.lines);
      out.push(IND + (fn.isMain ? 'STOP RUN.' : 'GOBACK.'));
      out.push('END PROGRAM ' + pid + '.');
      programs.push(out.join('\n'));
    }

    // ------------------------------------------------------------ Ausdrücke

    const simpleNum = (s) => s.k === 'num' || s.k === 'id' || (s.k === 'un' && s.op === '-' && strip(s.a).k === 'num');

    function sub(ctx, idx) {
      const s = strip(idx);
      if (s.k === 'num' && Number.isInteger(s.v)) return String(s.v + 1);
      // a[j + 1] → A(J + 2), a[j - 1] → A(J)
      if (s.k === 'bin' && (s.op === '+' || s.op === '-') && strip(s.b).k === 'num' && Number.isInteger(strip(s.b).v)) {
        const k = (s.op === '+' ? strip(s.b).v : -strip(s.b).v) + 1;
        const base = num(ctx, s.a, 5);
        return k === 0 ? base : base + (k > 0 ? ' + ' + k : ' - ' + (-k));
      }
      return num(ctx, idx, 5) + ' + 1';
    }

    /** Text-Variable oder -Element als { field, len }; field ist das ganze (mit Leerzeichen aufgefüllte) Feld. */
    function textRef(ctx, s) {
      if (s.k === 'id') { const nm = name(ctx, s.name); return { field: nm, len: nm + '-LEN' }; }
      const nm = name(ctx, strip(s.obj).name);
      const i = sub(ctx, s.index);
      return { field: nm + '(' + i + ')', len: nm + '-L(' + i + ')' };
    }
    const isTextRef = (ctx, s) => (s.k === 'id' || s.k === 'idx') && typeOf(ctx, s) === 'string';

    /** Rechenausdruck (Zahl). */
    function num(ctx, a, minPrec = 0) {
      const wrap = (s, p) => (p < minPrec ? '(' + s + ')' : s);
      switch (a.k) {
        case 'num': return a.raw;
        case 'paren': return '(' + num(ctx, a.e) + ')';
        case 'id':
          if (typeOf(ctx, a) === 'string') return 'FUNCTION NUMVAL(' + name(ctx, a.name) + ')';
          return name(ctx, a.name);
        case 'idx':
          if (typeOf(ctx, a) === 'string') return 'FUNCTION NUMVAL(' + textRef(ctx, a).field + ')';
          return name(ctx, strip(a.obj).name) + '(' + sub(ctx, a.index) + ')';
        case 'len': {
          const o = strip(a.obj);
          if (A.isArrayType(typeOf(ctx, o))) return name(ctx, o.name) + '-LEN';
          if (isTextRef(ctx, o)) return textRef(ctx, o).len;
          return '(' + sumLens(textParts(ctx, o).map((p) => p.len)) + ')';
        }
        case 'un':
          if (a.op === '+') return num(ctx, a.a, minPrec);
          return strip(a.a).k === 'num' ? wrap('-' + strip(a.a).raw, 7) : '(- ' + num(ctx, a.a, 7) + ')';
        case 'bin': {
          if (a.op === '/') return 'FUNCTION INTEGER-PART(' + num(ctx, a.a, 6) + ' / ' + num(ctx, a.b, 7) + ')';
          if (a.op === '%') return 'FUNCTION REM(' + num(ctx, a.a) + ', ' + num(ctx, a.b) + ')';
          if (a.op === '+' && typeOf(ctx, a) === 'string') return 'FUNCTION NUMVAL(' + textOperand(ctx, a) + ')';
          if (!'+-*'.includes(a.op)) return '0';
          const p = a.op === '*' ? 6 : 5;
          return wrap(num(ctx, a.a, p) + ' ' + a.op + ' ' + num(ctx, a.b, p + 1), p);
        }
        default: return '0';
      }
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [ast];
    }

    /** Teile eines Text-Ausdrucks als { op, len } (Zahlen werden vorher in Druckfelder gerechnet). */
    function textParts(ctx, ast) {
      const out = [];
      for (const p of parts(ctx, ast)) {
        const s = strip(p);
        const t = typeOf(ctx, s);
        if (s.k === 'str') out.push(...litParts(s.v));
        else if (isTextRef(ctx, s)) { const r = textRef(ctx, s); out.push({ op: r.field + '(1:' + r.len + ')', len: r.len }); }
        else if (t === 'bool') {
          const b = temp(ctx, 'B');
          line(ctx, 'IF ' + cond(ctx, s) + ' MOVE "true" TO ' + b + ' ELSE MOVE "false" TO ' + b + ' END-IF');
          out.push({ op: 'FUNCTION TRIM(' + b + ')', len: 'FUNCTION LENGTH(FUNCTION TRIM(' + b + '))' });
        } else {
          const z = temp(ctx, 'Z');
          line(ctx, simpleNum(s) ? 'MOVE ' + num(ctx, s) + ' TO ' + z : 'COMPUTE ' + z + ' = ' + num(ctx, s));
          out.push({ op: 'FUNCTION TRIM(' + z + ')', len: 'FUNCTION LENGTH(FUNCTION TRIM(' + z + '))' });
        }
      }
      return out;
    }

    /** Ein Operand für einen Text-Ausdruck (Feld, Teil oder FUNCTION CONCATENATE). */
    function textOperand(ctx, ast) {
      const s = strip(ast);
      if (isTextRef(ctx, s)) return textRef(ctx, s).field;
      const ps = textParts(ctx, s);
      if (!ps.length) return 'SPACES';
      if (ps.length === 1) return ps[0].op;
      return 'FUNCTION CONCATENATE(' + ps.map((p) => p.op).join(', ') + ')';
    }

    /** Operand für Vergleiche: Texte werden mit Leerzeichen aufgefüllt verglichen. */
    function cmpText(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'str' && s.v === '') return 'SPACES';
      return textOperand(ctx, s);
    }

    const CMP = { '==': '=', '!=': 'NOT =', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };

    function cond(ctx, s, minPrec = 0) {
      const wrap = (x, p) => (p < minPrec ? '(' + x + ')' : x);
      if (s.k === 'paren') return '(' + cond(ctx, s.e) + ')';
      if (s.k === 'un' && s.op === '!') return 'NOT (' + cond(ctx, strip(s.a)) + ')';
      if (s.k === 'bin') {
        if (s.op === '&&') return wrap(cond(ctx, s.a, 2) + ' AND ' + cond(ctx, s.b, 2), 2);
        if (s.op === '||') return wrap(cond(ctx, s.a, 1) + ' OR ' + cond(ctx, s.b, 1), 1);
        if (CMP[s.op]) {
          if (typeOf(ctx, s.a) === 'string' || typeOf(ctx, s.b) === 'string') return cmpText(ctx, s.a) + ' ' + CMP[s.op] + ' ' + cmpText(ctx, s.b);
          return num(ctx, s.a) + ' ' + CMP[s.op] + ' ' + num(ctx, s.b);
        }
      }
      if (typeOf(ctx, s) === 'string') return cmpText(ctx, s) + ' NOT = SPACES';
      return num(ctx, s) + ' NOT = 0';
    }

    function condFrom(ctx, src) {
      const ast = tryParse(src);
      return ast ? cond(ctx, strip(ast)) : '1 = 1';
    }

    /** Text in { field, len } schreiben. */
    function assignText(ctx, dst, ast) {
      const s = ast && strip(ast);
      if (s && isTextRef(ctx, s)) {
        const r = textRef(ctx, s);
        line(ctx, 'MOVE ' + r.field + ' TO ' + dst.field);
        line(ctx, 'MOVE ' + r.len + ' TO ' + dst.len);
        return;
      }
      const ps = s ? textParts(ctx, s) : [];
      if (!ps.length) { line(ctx, 'MOVE SPACES TO ' + dst.field); line(ctx, 'MOVE 0 TO ' + dst.len); return; }
      line(ctx, 'MOVE ' + (ps.length === 1 ? ps[0].op : 'FUNCTION CONCATENATE(' + ps.map((p) => p.op).join(', ') + ')') + ' TO ' + dst.field);
      const sum = sumLens(ps.map((p) => p.len));
      line(ctx, /^\d+$/.test(sum) ? 'MOVE ' + sum + ' TO ' + dst.len : 'COMPUTE ' + dst.len + ' = ' + sum);
    }

    /** Wert zuweisen; dst ist ein Feldname (Zahl) oder { field, len } (Text). */
    function assign(ctx, dst, type, src) {
      const ast = tryParse(src);
      if (type === 'string') { assignText(ctx, dst, ast); return; }
      if (!ast) { line(ctx, 'MOVE 0 TO ' + dst); return; }
      const s = strip(ast);
      if (typeOf(ctx, s) === 'string') { line(ctx, 'COMPUTE ' + dst + ' = FUNCTION NUMVAL(' + textOperand(ctx, s) + ')'); return; }
      if (simpleNum(s)) line(ctx, 'MOVE ' + num(ctx, s) + ' TO ' + dst);
      else line(ctx, 'COMPUTE ' + dst + ' = ' + num(ctx, s));
    }

    /** Ziel einer Zuweisung: Feldname (Zahl) oder { field, len } (Text). */
    function dest(ctx, src) {
      const t = tryTarget(src);
      if (!t) return String(src || '').trim().toUpperCase() || 'X';
      if (typeOf(ctx, t) === 'string') return textRef(ctx, t);
      if (t.k === 'id') return name(ctx, t.name);
      return name(ctx, strip(t.obj).name) + '(' + sub(ctx, t.index) + ')';
    }
    const targetType = (ctx, src) => { const t = tryTarget(src); return t ? typeOf(ctx, t) : '?'; };
    const refs = (d) => (typeof d === 'string' ? d : d.field + ' ' + d.len);

    // ------------------------------------------------------------ Anweisungen

    function genStmt(ctx, n) {
      ctx.cnt = {};
      if (n.comment && n.kind !== 'comment') line(ctx, '*> ' + n.comment.replace(/\s+/g, ' '));
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, '*> ' + l);
          return;
        case 'decl': {
          const nm = name(ctx, n.name || 'variable');
          if (n.vtype.endsWith('[]')) {
            assign(ctx, nm + '-LEN', 'integer', tryParse(n.length) ? n.length : '0');
            line(ctx, 'INITIALIZE ' + nm + '-TAB');
          } else if (!ctx.valued.has(n)) assign(ctx, n.vtype === 'string' ? { field: nm, len: nm + '-LEN' } : nm, n.vtype, n.init);
          return;
        }
        case 'assign':
          assign(ctx, dest(ctx, n.target), targetType(ctx, n.target), n.expr);
          return;
        case 'input': {
          const tt = targetType(ctx, n.target);
          const p = tryParse(n.prompt);
          const d = dest(ctx, n.target);
          if (tt === 'integer') {
            used.num = true;
            const t = temp(ctx, 'T');
            assignText(ctx, { field: t, len: t + '-LEN' }, p);
            line(ctx, 'CALL "' + HN.prog + '" USING BY CONTENT ' + t + ' ' + t + '-LEN BY REFERENCE ' + d);
          } else {
            const ps = p ? textParts(ctx, strip(p)) : [];
            if (ps.length) line(ctx, 'DISPLAY ' + ps.map((x) => x.op).join(' ') + ' WITH NO ADVANCING');
            line(ctx, 'MOVE SPACES TO ' + d.field);
            line(ctx, 'ACCEPT ' + d.field);
            line(ctx, 'COMPUTE ' + d.len + ' = FUNCTION LENGTH(FUNCTION TRIM(' + d.field + ' TRAILING))');
          }
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          const ps = ast ? textParts(ctx, strip(ast)) : [];
          line(ctx, 'DISPLAY ' + (ps.length ? ps.map((x) => x.op).join(' ') : '""'));
          return;
        }
        case 'if': {
          // WENN … SONST WENN … → EVALUATE TRUE
          const chain = [{ cond: n.cond, body: n.then }];
          let rest = n.else;
          while (rest && rest.length === 1 && rest[0].kind === 'if' && !rest[0].comment) { chain.push({ cond: rest[0].cond, body: rest[0].then }); rest = rest[0].else; }
          if (chain.length > 2) {
            const cs = chain.map((c) => condFrom(ctx, c.cond));
            line(ctx, 'EVALUATE TRUE');
            chain.forEach((c, i) => { line(ctx, 'WHEN ' + cs[i]); block(ctx, c.body); });
            if (rest && rest.length) { line(ctx, 'WHEN OTHER'); block(ctx, rest); }
            line(ctx, 'END-EVALUATE');
            return;
          }
          line(ctx, 'IF ' + condFrom(ctx, n.cond));
          block(ctx, n.then);
          if (n.else && n.else.length) { line(ctx, 'ELSE'); block(ctx, n.else); }
          line(ctx, 'END-IF');
          return;
        }
        case 'while':
        case 'until': {
          const at = ctx.lines.length;
          const c = condFrom(ctx, n.cond);
          const pre = ctx.lines.splice(at);
          if (!pre.length) {
            line(ctx, n.kind === 'while' ? 'PERFORM UNTIL NOT (' + c + ')' : 'PERFORM WITH TEST AFTER UNTIL ' + c);
            block(ctx, n.body);
          } else {
            // Bedingung braucht Hilfsfelder → bei jedem Durchlauf neu berechnen
            const test = () => {
              for (const l of pre) ctx.lines.push(IND + l);
              ctx.ind++; line(ctx, (n.kind === 'while' ? 'IF NOT (' + c + ')' : 'IF ' + c) + ' EXIT PERFORM END-IF'); ctx.ind--;
            };
            line(ctx, 'PERFORM FOREVER');
            if (n.kind === 'while') test();
            block(ctx, n.body);
            if (n.kind === 'until') test();
          }
          line(ctx, 'END-PERFORM');
          return;
        }
        case 'for': {
          const k = dest(ctx, n.counter);
          const operand = (src, dflt) => {
            const ast = tryParse(src);
            if (!ast) return dflt;
            const s = strip(ast);
            if (simpleNum(s)) return num(ctx, s);
            const tmp = temp(ctx, 'N');
            line(ctx, 'COMPUTE ' + tmp + ' = ' + num(ctx, s));
            return tmp;
          };
          const from = operand(n.from, '0');
          const stepAst = tryParse(n.step);
          const lit = stepAst ? A.literalValue(stepAst) : 1;
          const step = typeof lit === 'number' ? String(lit) : operand(n.step, '1');
          const toAst = tryParse(n.to);
          const to = toAst ? num(ctx, strip(toAst)) : '0';
          let until;
          if (typeof lit === 'number') until = k + (lit >= 0 ? ' > ' : ' < ') + to;
          else until = '(' + step + ' > 0 AND ' + k + ' > ' + to + ') OR (' + step + ' < 0 AND ' + k + ' < ' + to + ')';
          line(ctx, 'PERFORM VARYING ' + k + ' FROM ' + from + ' BY ' + step + ' UNTIL ' + until);
          block(ctx, n.body);
          line(ctx, 'END-PERFORM');
          return;
        }
        case 'switch': {
          const sel = tryParse(n.expr);
          const isText = sel && typeOf(ctx, sel) === 'string';
          const val = (a) => (isText ? cmpText(ctx, a) : num(ctx, strip(a)));
          const subj = sel ? val(sel) : '0';
          const vals = n.cases.map((c) => { const v = tryParse(c.value); return v ? val(v) : '0'; });
          line(ctx, 'EVALUATE ' + subj);
          n.cases.forEach((c, i) => { line(ctx, 'WHEN ' + vals[i]); block(ctx, c.body); });
          if (n.else) { line(ctx, 'WHEN OTHER'); block(ctx, n.else); }
          line(ctx, 'END-EVALUATE');
          return;
        }
        case 'call': {
          const callee = program.fns.find((f) => !f.isMain && f.name === n.fn);
          if (!callee) { line(ctx, '*> ' + (n.fn || '?') + '(…)'); return; }
          const using = [];
          callee.params.forEach((p, i) => {
            const src = n.args[i] || '';
            if (A.isArrayType(p.type)) {
              const t = tryTarget(src);
              const nm = t ? name(ctx, t.k === 'id' ? t.name : strip(t.obj).name) : cobName(src);
              using.push('BY REFERENCE ' + nm + '-TAB ' + nm + '-LEN');
            } else if (p.byRef) using.push('BY REFERENCE ' + refs(dest(ctx, src)));
            else {
              const ast = tryParse(src);
              const s = ast && strip(ast);
              if (s && (s.k === 'id' || s.k === 'idx') && typeOf(ctx, s) === p.type) using.push('BY CONTENT ' + refs(p.type === 'string' ? textRef(ctx, s) : num(ctx, s)));
              else if (p.type === 'string') {
                const tmp = temp(ctx, 'T');
                assignText(ctx, { field: tmp, len: tmp + '-LEN' }, ast);
                using.push('BY CONTENT ' + tmp + ' ' + tmp + '-LEN');
              } else {
                const tmp = temp(ctx, 'N');
                assign(ctx, tmp, 'integer', src);
                using.push('BY CONTENT ' + tmp);
              }
            }
          });
          let after = null;
          if (callee.returnType !== 'void') {
            const tt = n.target && n.target.trim() ? targetType(ctx, n.target) : null;
            const d = tt ? dest(ctx, n.target) : null;
            if (tt === callee.returnType) using.push('BY REFERENCE ' + refs(d));
            else if (callee.returnType === 'string') {
              const tmp = temp(ctx, 'T');
              using.push('BY REFERENCE ' + tmp + ' ' + tmp + '-LEN');
              if (d) after = () => line(ctx, 'COMPUTE ' + d + ' = FUNCTION NUMVAL(' + tmp + ')');
            } else {
              const tmp = temp(ctx, 'N');
              using.push('BY REFERENCE ' + tmp);
              if (d) {
                after = () => {
                  const z = temp(ctx, 'Z');
                  line(ctx, 'MOVE ' + tmp + ' TO ' + z);
                  line(ctx, 'MOVE FUNCTION TRIM(' + z + ') TO ' + d.field);
                  line(ctx, 'COMPUTE ' + d.len + ' = FUNCTION LENGTH(FUNCTION TRIM(' + z + '))');
                };
              }
            }
          }
          line(ctx, 'CALL "' + fnName.get(callee.name) + '"' + (using.length ? ' USING ' + using.join(' ') : ''));
          if (after) after();
          return;
        }
        default: return;
      }
    }

    // ------------------------------------------------------------ Zusammenbau

    genFunction(program.fns.find((f) => f.isMain));
    for (const fn of program.fns.filter((f) => !f.isMain)) genFunction(fn);

    if (used.num) {
      programs.push([
        '*> ' + tr('javaHelperNumDoc'),
        'IDENTIFICATION DIVISION.',
        'PROGRAM-ID. ' + HN.prog + '.',
        'DATA DIVISION.',
        'LOCAL-STORAGE SECTION.',
        '01 ' + HN.line + ' ' + TXT + '.',
        'LINKAGE SECTION.',
        '01 ' + HN.prompt + ' ' + TXT + '.',
        '01 ' + HN.plen + ' ' + TLEN + '.',
        '01 ' + HN.value + ' ' + NUM + '.',
        'PROCEDURE DIVISION USING ' + HN.prompt + ' ' + HN.plen + ' ' + HN.value + '.',
        IND + 'PERFORM FOREVER',
        IND + IND + 'DISPLAY ' + HN.prompt + '(1:' + HN.plen + ') WITH NO ADVANCING',
        IND + IND + 'MOVE SPACES TO ' + HN.line,
        IND + IND + 'ACCEPT ' + HN.line,
        IND + IND + IND + 'ON EXCEPTION',
        IND + IND + IND + IND + 'MOVE 0 TO ' + HN.value,
        IND + IND + IND + IND + 'GOBACK',
        IND + IND + 'END-ACCEPT',
        IND + IND + 'IF ' + HN.line + ' NOT = SPACES AND FUNCTION TEST-NUMVAL(' + HN.line + ') = 0',
        IND + IND + IND + 'MOVE FUNCTION NUMVAL(' + HN.line + ') TO ' + HN.value,
        IND + IND + IND + 'GOBACK',
        IND + IND + 'END-IF',
        IND + IND + 'DISPLAY ' + litParts(tr('javaNeedInt'))[0].op,
        IND + 'END-PERFORM.',
        'END PROGRAM ' + HN.prog + '.'
      ].join('\n'));
    }

    const head = ['       >>SOURCE FORMAT FREE', '*> ' + tr('cobolHeader1'), '*> ' + tr('cobolHeader2'), ''];
    return head.join('\n') + programs.join('\n\n') + '\n';
  }

  BBE.cobolgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
