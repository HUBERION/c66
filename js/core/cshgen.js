/* Blockbild-Editor – Übersetzung nach C-Shell (csh / tcsh)
 *
 *   csh kennt keine Funktionen und keine lokalen Variablen:
 *   - Unterprogramme sind Sprungmarken. Ein Aufruf legt eine Rücksprung-Nummer auf die Liste bb_ret
 *     und springt mit goto zur Marke; am Ende springt "goto bb_return" zur Marke bb_r<Nummer> zurück.
 *   - Alle Variablen sind global: Variablen eines Unterprogramms bekommen dessen Namen als Vorsilbe (summe_i).
 *     Kann der Aufgerufene (auch über Umwege) wieder den Aufrufer erreichen (Rekursion), sichert der Aufrufer
 *     seine Variablen vorher auf der Liste bb_stack und holt sie danach zurück.
 *   - Parameter: Werte werden vor dem Sprung in die Variablen des Unterprogramms kopiert; InOut-Parameter und
 *     Arrays werden nach dem Rücksprung zurückkopiert (copy-in/copy-out).
 *   - Zahl → ganze Zahl mit @ (Rechnung vollständig geklammert, csh rechnet sonst von rechts nach links).
 *     Text → Variable, immer in "…" verwendet; Literale in '…'. Array → Wortliste (csh zählt ab 1: a[i] → $a[i+1]).
 *   - Blöcke ohne Aufruf werden mit if/while/end geschrieben; Blöcke, in denen ein Aufruf steckt, mit goto
 *     (in ein while … end darf man nicht hineinspringen).
 */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};
  const { parseCached, parseTarget, strip, walk } = BBE.expr;
  const A = BBE.analyze;
  const M = BBE.model;

  const IND = '    ';
  // Variablen mit Sonderbedeutung in csh/tcsh (dürfen nicht überschrieben werden)
  const SPECIAL = new Set(('addsuffix afsuser ampm anyerror argv autocorrect autoexpand autolist autologout autorehash backslash_quote ' +
    'catalog cdpath cdtohome color colorcat command complete continue continue_args correct csubstnonl cwd dextract dirsfile dirstack ' +
    'dspmbyte dunique echo echo_style edit editors ellipsis euid euser fignore filec gid group highlight histchars histdup histfile ' +
    'histlit history home ignoreeof implicitcd inputmode killdup killring listflags listjobs listlinks listmax listmaxrows loginsh ' +
    'logout mail matchbeep nobeep noclobber noding noglob nokanji nonomatch nostat notify oid owd path printexitvalue prompt prompt2 ' +
    'prompt3 promptchars pushdtohome pushdsilent recexact recognize_only_executables rmstar rprompt savedirs savehist sched shell ' +
    'shlvl status symlinks tcsh term time tperiod tty uid user verbose version visiblebell vimode watch who wordchars ' +
    'if then else endif while end foreach switch case breaksw default endsw goto set setenv unset exit break').split(' '));
  const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const CMP = ['==', '!=', '<', '<=', '>', '>='];
  const AWK_NUM = "'NR == 1 && /^[ \\t]*[-+]?[0-9]+[ \\t]*$/ { printf \"%d\\n\", $1; exit } NR == 1 { print \"x\"; exit } END { if (NR == 0) print \"eof\" }'";

  const tryParse = (src) => { try { return parseCached(String(src || '').trim()); } catch (e) { return null; } };
  const tryTarget = (src) => { try { return parseTarget(String(src || '').trim()); } catch (e) { return null; } };

  /** Gültiger csh-Name (ASCII, Umlaute umschreiben). */
  function cshName(n) {
    let s = String(n || '').replace(/[äöüÄÖÜß]/g, (c) => FOLD[c]).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(s)) s = 'v' + s;
    return s || 'v';
  }

  /** Text-Literal in '…' ('  → '\'' , ! → \! , Zeilenumbruch → \ + Umbruch). */
  function lit(s) {
    s = String(s);
    if (s === '') return "''";
    return "'" + s.replace(/'/g, "'\\''").replace(/!/g, '\\!').replace(/\n/g, '\\\n') + "'";
  }

  /** Kommentartext für eine #-Zeile. */
  const commentText = (s) => String(s).replace(/\s+/g, ' ').replace(/\\+$/, '').trim();

  function hasCall(seq) {
    let hit = false;
    M.walkSeq(seq, (n) => { if (n.kind === 'call') hit = true; });
    return hit;
  }
  const stmtHasCall = (n) => hasCall([n]);

  function generate(program, opts = {}) {
    const tr = opts.t || ((k) => k);
    const mainFn = program.fns.find((f) => f.isMain);
    const subs = program.fns.filter((f) => !f.isMain);
    const byName = new Map(subs.map((f) => [f.name, f]));

    // ------------------------------------------------------------ Namen
    const taken = new Set(['bb_ret', 'bb_stack', 'bb_r', 'bb_n', 'bb_m', 'bb_c', 'bb_e', 'bb_top', 'bb_line', 'bb_num', 'bb_eof', 'bb_prompt', 'bb_len', 'bb_reader']);
    const labels = new Set(['bb_return']);
    // BSD-csh erlaubt höchstens 30 Zeichen lange Variablennamen
    const claim = (base, set) => {
      if (SPECIAL.has(base) || /^bb_/.test(base)) base = base + '_';
      base = base.slice(0, 30);
      let b = base;
      let i = 2;
      while (set.has(b) || SPECIAL.has(b)) b = base.slice(0, 27) + '_' + i++;
      set.add(b);
      return b;
    };
    const fnLabel = new Map();
    for (const f of subs) fnLabel.set(f.name, claim(cshName(f.name), labels));
    const varNames = new Map(); // fn -> Map(name -> cshName)
    for (const f of program.fns) {
      const m = new Map();
      const pfx = f.isMain ? '' : fnLabel.get(f.name) + '_';
      for (const n of A.scopeOf(f).keys()) m.set(n, claim(pfx + cshName(n), taken));
      varNames.set(f, m);
    }

    // ------------------------------------------------------------ Aufrufgraph: wer erreicht wen?
    const calls = new Map(program.fns.map((f) => [f, new Set()]));
    for (const f of program.fns) M.walkSeq(f.body, (n) => { if (n.kind === 'call' && byName.has(n.fn)) calls.get(f).add(byName.get(n.fn)); });
    const reach = new Map();
    for (const f of program.fns) {
      const seen = new Set();
      const todo = [f];
      while (todo.length) { const x = todo.pop(); for (const y of calls.get(x)) if (!seen.has(y)) { seen.add(y); todo.push(y); } }
      reach.set(f, seen);
    }
    // Aufrufer muss seine Variablen sichern, wenn der Aufgerufene ihn wieder erreichen kann
    const needSave = (caller, callee) => !caller.isMain && (callee === caller || reach.get(callee).has(caller));
    const saving = new Set(subs.filter((f) => [...calls.get(f)].some((g) => needSave(f, g))));
    const used = { stack: saving.size > 0, ret: subs.length > 0 };

    let labelNo = 0;
    let retNo = 0;
    let idxNo = 0;
    const newLabel = (kind) => 'bb_' + kind + (++labelNo);

    const typeOf = (ctx, ast) => (ast ? A.typeOf(ast, ctx.scope) : '?');
    const name = (ctx, n) => ctx.names.get(n) || cshName(n);

    function line(ctx, s) { ctx.lines.push(s === '' ? '' : IND.repeat(ctx.ind) + s); }
    function label(ctx, l) { ctx.lines.push(IND.repeat(ctx.ind) + l + ':'); }
    function temp(ctx) { ctx.cnt++; return 'bb_t' + ctx.cnt; }
    /** Code, den fn erzeugt, abfangen (für Bedingungen, die jedes Mal neu berechnet werden). */
    function capture(ctx, fn) {
      const at = ctx.lines.length;
      const r = fn();
      return { r, pre: ctx.lines.splice(at) };
    }

    // ------------------------------------------------------------ Ausdrücke

    /** Array-Index für csh (ab 1). */
    function index(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'num' && Number.isInteger(s.v)) return String(s.v + 1);
      const t = temp(ctx);
      line(ctx, '@ ' + t + ' = ( ' + num(ctx, s) + ' + 1 )');
      return '$' + t;
    }

    /** Text (Wortteil) → Zahl über awk (wie Number() für ganze Zahlen). */
    function toNum(ctx, frag) {
      const t = temp(ctx);
      line(ctx, 'set ' + t + " = `printf '%s\\n' " + frag + " | awk '{ printf \"%d\\n\", $1 }'`");
      return '$' + t;
    }

    function hasFloat(ast) {
      let hit = false;
      walk(ast, (x) => { if (x.k === 'num' && !Number.isInteger(x.v)) hit = true; });
      return hit;
    }

    /** Rechnung mit Kommazahl (z. B. betrag * 1.25): csh kann nur ganze Zahlen → awk rechnet, Ergebnis abgeschnitten wie in C. */
    function floatNum(ctx, a) {
      const ax = (e) => {
        const s = strip(e);
        if (!hasFloat(s)) {
          const v = num(ctx, s);
          if (/^-?\d+$/.test(v)) return '(' + v + ')';
          if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return "('\"" + v + "\"')";
          const t = temp(ctx);
          line(ctx, '@ ' + t + ' = ' + v);
          return "('\"$" + t + "\"')";
        }
        if (s.k === 'num') return s.raw;
        if (s.k === 'un') return s.op === '-' ? '(-' + ax(s.a) + ')' : ax(s.a);
        if (s.k === 'bin' && '+-*/%'.includes(s.op)) return '(' + ax(s.a) + ' ' + s.op + ' ' + ax(s.b) + ')';
        return '(' + num(ctx, s) + ')';
      };
      const x = ax(a);
      const t = temp(ctx);
      line(ctx, 'set ' + t + " = `awk 'BEGIN { printf \"%d\\n\", int(" + x + ") }'`");
      return '$' + t;
    }

    function boolNum(ctx, s) {
      const c = cond(ctx, s);
      const t = temp(ctx);
      line(ctx, 'set ' + t + ' = 0');
      line(ctx, 'if ( ' + c + ' ) set ' + t + ' = 1');
      return '$' + t;
    }

    /** Rechenausdruck für @ und if (Wörter mit Leerzeichen, jede Rechnung geklammert). */
    function num(ctx, a) {
      switch (a.k) {
        case 'num': return String(Math.trunc(a.v));
        case 'str': return toNum(ctx, lit(a.v));
        case 'paren': return num(ctx, a.e);
        case 'id': {
          const t = typeOf(ctx, a);
          if (t === 'string') return toNum(ctx, '$' + name(ctx, a.name) + ':q');
          return '$' + name(ctx, a.name);
        }
        case 'idx': {
          const ref = '$' + name(ctx, strip(a.obj).name) + '[' + index(ctx, a.index) + ']';
          if (typeOf(ctx, a) === 'string') return toNum(ctx, '"' + ref + ':s/x//"');
          return ref;
        }
        case 'len': {
          const o = strip(a.obj);
          if (A.isArrayType(typeOf(ctx, o))) return '$#' + name(ctx, o.name);
          const frag = text(ctx, o);
          const t = temp(ctx);
          line(ctx, 'set ' + t + " = `expr x" + frag + " : '.*'`");
          line(ctx, '@ ' + t + ' = ( $' + t + ' - 1 )');
          return '$' + t;
        }
        case 'un': {
          if (a.op === '!') return boolNum(ctx, a);
          const s = strip(a.a);
          if (a.op === '+') return num(ctx, a.a);
          if (s.k === 'num') return String(-Math.trunc(s.v));
          return '( 0 - ' + num(ctx, a.a) + ' )';
        }
        case 'bin': {
          if (a.op === '+' && typeOf(ctx, a) === 'string') return toNum(ctx, text(ctx, a));
          if ('+-*/%'.includes(a.op) && hasFloat(a)) return floatNum(ctx, a);
          if ('+-*/%'.includes(a.op)) return '( ' + num(ctx, a.a) + ' ' + a.op + ' ' + num(ctx, a.b) + ' )';
          return boolNum(ctx, a);
        }
        default: return '0';
      }
    }

    function parts(ctx, ast) {
      const s = strip(ast);
      if (s.k === 'bin' && s.op === '+' && typeOf(ctx, s) === 'string') return parts(ctx, s.a).concat(parts(ctx, s.b));
      return [s];
    }

    /** Text-Ausdruck als ein csh-Wort aus aneinandergehängten Teilen: 'Summe: '$s:q
     *  ($s:q statt "$s": "…" scheitert in csh an Zeilenumbrüchen im Wert). */
    function text(ctx, ast) {
      let out = '';
      for (const s of parts(ctx, ast)) {
        const t = typeOf(ctx, s);
        if (s.k === 'str') { if (s.v !== '') out += lit(s.v); continue; }
        if (s.k === 'num') { out += lit(BBE.interp ? BBE.interp.show(s.v) : String(s.v)); continue; }
        if (s.k === 'id' && t !== 'bool') { out += '$' + name(ctx, s.name) + (t === 'string' ? ':q' : ''); continue; }
        if (s.k === 'idx' && t !== 'bool') { out += '$' + name(ctx, strip(s.obj).name) + '[' + index(ctx, s.index) + ']' + (t === 'string' ? ':s/x//:q' : ''); continue; }
        if (t === 'bool') {
          const c = cond(ctx, s);
          const v = temp(ctx);
          line(ctx, 'set ' + v + ' = false');
          line(ctx, 'if ( ' + c + ' ) set ' + v + ' = true');
          out += '$' + v;
          continue;
        }
        const e = num(ctx, s);
        if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(e)) { out += e; continue; }
        const v = temp(ctx);
        line(ctx, '@ ' + v + ' = ' + e);
        out += '$' + v;
      }
      return out || "''";
    }

    const risky = (ast) => {
      let hit = false;
      walk(ast, (x) => { if (x.k === 'idx' || x.k === 'len' || (x.k === 'bin' && (x.op === '/' || x.op === '%'))) hit = true; });
      return hit;
    };

    /** Bedingung für if ( … ) / while ( … ); Hilfsrechnungen stehen davor. */
    function cond(ctx, a) {
      const s = strip(a);
      if (s.k === 'un' && s.op === '!') return '! ( ' + cond(ctx, s.a) + ' )';
      if (s.k === 'bin' && (s.op === '&&' || s.op === '||')) {
        const ca = cond(ctx, s.a);
        const { r: cb, pre } = capture(ctx, () => cond(ctx, s.b));
        if (!pre.length && !risky(s.b)) return '( ' + ca + ' ' + s.op + ' ' + cb + ' )';
        // csh setzt alle Variablen ein, bevor es rechnet → rechte Seite nur berechnen, wenn nötig
        const t = temp(ctx);
        const and = s.op === '&&';
        line(ctx, 'set ' + t + ' = ' + (and ? '0' : '1'));
        line(ctx, 'if ( ' + (and ? ca : '! ( ' + ca + ' )') + ' ) then');
        for (const l of pre) ctx.lines.push(IND + l);
        line(ctx, IND + 'if ( ' + (and ? cb : '! ( ' + cb + ' )') + ' ) set ' + t + ' = ' + (and ? '1' : '0'));
        line(ctx, 'endif');
        return '$' + t + ' == 1';
      }
      if (s.k === 'bin' && CMP.includes(s.op)) {
        if (typeOf(ctx, s.a) === 'string' || typeOf(ctx, s.b) === 'string') {
          const x = text(ctx, s.a);
          const y = text(ctx, s.b);
          if (s.op === '==' || s.op === '!=') return 'x' + x + ' ' + s.op + ' x' + y;
          // Textvergleich <, > … über expr (Byte-Reihenfolge wie in der Simulation)
          const t = temp(ctx);
          line(ctx, 'env LC_ALL=C expr x' + x + " '" + s.op + "' x" + y + ' > /dev/null');
          line(ctx, 'set ' + t + ' = $status');
          return '$' + t + ' == 0';
        }
        return num(ctx, s.a) + ' ' + s.op + ' ' + num(ctx, s.b);
      }
      if (typeOf(ctx, s) === 'string') return 'x' + text(ctx, s) + ' != x';
      return num(ctx, s) + ' != 0';
    }

    function condFrom(ctx, src) {
      const ast = tryParse(src);
      return ast ? cond(ctx, ast) : '1';
    }

    // ------------------------------------------------------------ Zuweisungen

    /** Ziel: { name, idx } (idx = csh-Index oder null) und Typ. */
    function dest(ctx, src) {
      const t = tryTarget(src);
      if (!t) return { name: cshName(String(src || '').trim() || 'x'), idx: null, type: '?' };
      if (t.k === 'id') return { name: name(ctx, t.name), idx: null, type: typeOf(ctx, t) };
      return { name: name(ctx, t.obj.name), idx: index(ctx, t.index), type: typeOf(ctx, t) };
    }
    const lhs = (d) => d.name + (d.idx ? '[' + d.idx + ']' : '');
    // Elemente von Text-Arrays tragen ein x davor (csh verliert leere Wörter in Listen)
    const rhs = (d) => '$' + d.name + (d.idx ? '[' + d.idx + ']' + (d.type === 'string' ? ':s/x//' : '') : '') + ':q';

    function setNum(ctx, d, e) {
      if (!d.idx && /^-?\d+$/.test(e)) line(ctx, 'set ' + d.name + ' = ' + e);
      else line(ctx, '@ ' + lhs(d) + ' = ' + e);
    }
    function setText(ctx, d, w) { line(ctx, 'set ' + lhs(d) + ' = ' + (d.idx ? 'x' : '') + w); }

    /** Wert eines Ausdrucks (Quelltext) im Typ type an d zuweisen. */
    function assign(ctx, d, type, src) {
      const ast = tryParse(src);
      if (type === 'string') { setText(ctx, d, ast ? text(ctx, ast) : "''"); return; }
      setNum(ctx, d, ast ? num(ctx, ast) : '0');
    }

    // ------------------------------------------------------------ Anweisungen

    function genSeq(ctx, seq) { for (const n of seq) genStmt(ctx, n); }
    function block(ctx, seq) { ctx.ind++; genSeq(ctx, seq); ctx.ind--; }

    function genStmt(ctx, n) {
      ctx.cnt = 0;
      if (n.comment && n.kind !== 'comment') line(ctx, '# ' + commentText(n.comment));
      const g = stmtHasCall(n);
      switch (n.kind) {
        case 'comment':
          for (const l of String(n.text || '').split('\n')) line(ctx, '# ' + commentText(l));
          return;
        case 'decl': {
          const d = { name: name(ctx, n.name || 'variable'), idx: null };
          if (A.isArrayType(n.vtype)) {
            const fill = n.vtype === 'integer[]' ? '0' : 'x';
            const lenAst = tryParse(n.length);
            const lv = lenAst ? A.literalValue(lenAst) : 0;
            if (typeof lv === 'number' && Number.isInteger(lv) && lv >= 0 && lv <= 16) {
              line(ctx, 'set ' + d.name + ' = (' + (' ' + fill).repeat(lv) + ' )');
            } else {
              line(ctx, '@ bb_len = ' + (lenAst ? num(ctx, lenAst) : '0'));
              line(ctx, 'set ' + d.name + ' = ( )');
              line(ctx, 'while ( $#' + d.name + ' < $bb_len )');
              line(ctx, IND + 'set ' + d.name + ' = ( $' + d.name + ':q ' + fill + ' )');
              line(ctx, 'end');
            }
          } else assign(ctx, d, n.vtype, n.init);
          return;
        }
        case 'assign': {
          const d = dest(ctx, n.target);
          assign(ctx, d, d.type, n.expr);
          return;
        }
        case 'input': {
          const d = dest(ctx, n.target);
          const p = tryParse(n.prompt);
          const prompt = p ? text(ctx, p) : null;
          if (d.type === 'integer') {
            // Zahl: so lange fragen, bis eine ganze Zahl kommt (bei Dateiende 0)
            if (prompt) line(ctx, 'set bb_prompt = ' + prompt);
            line(ctx, 'while ( 1 )');
            ctx.ind++;
            if (prompt) line(ctx, "printf '%s' $bb_prompt:q");
            // sh liest genau eine Zeile, awk prüft sie: Zahl, x (keine Zahl) oder eof (Dateiende)
            line(ctx, "set bb_num = `sh -c 'read -r l || [ -n \"$l\" ] && printf \"%s\\n\" \"$l\"' | awk " + AWK_NUM + '`');
            line(ctx, 'if ( "$bb_num" == eof ) set bb_num = 0');
            line(ctx, 'if ( "$bb_num" != x ) break');
            line(ctx, "printf '%s\\n' " + lit(tr('javaNeedInt')));
            ctx.ind--;
            line(ctx, 'end');
            setNum(ctx, d, '$bb_num');
          } else {
            if (prompt) line(ctx, "printf '%s' " + prompt);
            // $< liest eine Zeile (am Dateiende leer)
            if (d.type === 'string') setText(ctx, d, '"$<"');
            else { line(ctx, 'set bb_line = "$<"'); setNum(ctx, d, toNum(ctx, '$bb_line:q')); }
          }
          return;
        }
        case 'output': {
          const ast = tryParse(n.expr);
          line(ctx, "printf '%s\\n' " + (ast ? text(ctx, ast) : "''"));
          return;
        }
        case 'if': return g ? genIfGoto(ctx, n) : genIf(ctx, n);
        case 'while':
        case 'until':
          return g ? genLoopGoto(ctx, n) : genLoop(ctx, n);
        case 'for': return genFor(ctx, n, g);
        case 'switch': return genSwitch(ctx, n, g);
        case 'call': return genCall(ctx, n);
        default: return;
      }
    }

    function genIf(ctx, n) {
      line(ctx, 'if ( ' + condFrom(ctx, n.cond) + ' ) then');
      block(ctx, n.then);
      let rest = n.else;
      // SONST WENN → else if, solange die Bedingung keine Hilfsrechnung braucht
      while (rest && rest.length === 1 && rest[0].kind === 'if' && !rest[0].comment) {
        ctx.cnt = 0;
        const { r: c, pre } = capture(ctx, () => condFrom(ctx, rest[0].cond));
        if (pre.length) break;
        line(ctx, 'else if ( ' + c + ' ) then');
        block(ctx, rest[0].then);
        rest = rest[0].else;
      }
      if (rest && rest.length) { line(ctx, 'else'); block(ctx, rest); }
      line(ctx, 'endif');
    }

    function genIfGoto(ctx, n) {
      const lElse = newLabel('else');
      const lEnd = lElse.replace('else', 'endif');
      const hasElse = n.else && n.else.length;
      line(ctx, 'if ( ! ( ' + condFrom(ctx, n.cond) + ' ) ) goto ' + (hasElse ? lElse : lEnd));
      block(ctx, n.then);
      if (hasElse) {
        ctx.ind++; line(ctx, 'goto ' + lEnd); ctx.ind--;
        label(ctx, lElse); block(ctx, n.else);
      }
      label(ctx, lEnd);
    }

    function genLoop(ctx, n) {
      ctx.cnt = 0;
      const { r: c, pre } = capture(ctx, () => condFrom(ctx, n.cond));
      if (n.kind === 'while' && !pre.length) {
        line(ctx, 'while ( ' + c + ' )');
        block(ctx, n.body);
        line(ctx, 'end');
        return;
      }
      line(ctx, 'while ( 1 )');
      ctx.ind++;
      const test = () => {
        for (const l of pre) ctx.lines.push(IND + l);
        line(ctx, 'if ( ' + (n.kind === 'while' ? '! ( ' + c + ' )' : c) + ' ) break');
      };
      if (n.kind === 'while') test();
      genSeq(ctx, n.body);
      if (n.kind === 'until') test();
      ctx.ind--;
      line(ctx, 'end');
    }

    function genLoopGoto(ctx, n) {
      const lTop = newLabel(n.kind === 'while' ? 'while' : 'repeat');
      const lEnd = lTop.replace(/^bb_[a-z]+/, 'bb_end');
      ctx.cnt = 0;
      const { r: c, pre } = capture(ctx, () => condFrom(ctx, n.cond));
      label(ctx, lTop);
      ctx.ind++;
      if (n.kind === 'while') {
        for (const l of pre) ctx.lines.push(IND + l);
        line(ctx, 'if ( ! ( ' + c + ' ) ) goto ' + lEnd);
        genSeq(ctx, n.body);
        line(ctx, 'goto ' + lTop);
        ctx.ind--;
        label(ctx, lEnd);
      } else {
        genSeq(ctx, n.body);
        for (const l of pre) ctx.lines.push(IND + l);
        line(ctx, 'if ( ! ( ' + c + ' ) ) goto ' + lTop);
        ctx.ind--;
      }
    }

    function genFor(ctx, n, g) {
      const d = dest(ctx, n.counter);
      const fromAst = tryParse(n.from);
      setNum(ctx, d, fromAst ? num(ctx, fromAst) : '0');
      const k = d.idx ? '$' + lhs(d) : '$' + d.name;
      const stepAst = tryParse(n.step);
      const lit = stepAst ? A.literalValue(stepAst) : 1;
      const toAst = tryParse(n.to);
      ctx.cnt = 0;
      const { r: c, pre } = capture(ctx, () => {
        const to = toAst ? num(ctx, toAst) : '0';
        if (typeof lit === 'number') return k + (lit >= 0 ? ' <= ' : ' >= ') + to;
        const s = num(ctx, stepAst);
        return '( ( ' + s + ' > 0 && ' + k + ' <= ' + to + ' ) || ( ' + s + ' < 0 && ' + k + ' >= ' + to + ' ) )';
      });
      const inc = () => {
        if (typeof lit === 'number' && !d.idx) {
          const v = Math.trunc(lit);
          line(ctx, v === 1 ? '@ ' + d.name + '++' : v === -1 ? '@ ' + d.name + '--' : v >= 0 ? '@ ' + d.name + ' += ' + v : '@ ' + d.name + ' -= ' + (-v));
        } else {
          ctx.cnt = 0;
          const dd = dest(ctx, n.counter);
          setNum(ctx, dd, '( ' + k + ' + ' + (stepAst ? num(ctx, stepAst) : '1') + ' )');
        }
      };
      if (g) {
        const lTop = newLabel('for');
        const lEnd = lTop.replace('for', 'endfor');
        label(ctx, lTop);
        ctx.ind++;
        for (const l of pre) ctx.lines.push(IND + l);
        line(ctx, 'if ( ! ( ' + c + ' ) ) goto ' + lEnd);
        genSeq(ctx, n.body);
        inc();
        line(ctx, 'goto ' + lTop);
        ctx.ind--;
        label(ctx, lEnd);
        return;
      }
      if (!pre.length) {
        line(ctx, 'while ( ' + c + ' )');
      } else {
        line(ctx, 'while ( 1 )');
        for (const l of pre) ctx.lines.push(IND + l);
        line(ctx, IND + 'if ( ! ( ' + c + ' ) ) break');
      }
      ctx.ind++;
      genSeq(ctx, n.body);
      inc();
      ctx.ind--;
      line(ctx, 'end');
    }

    function genSwitch(ctx, n, g) {
      const sel = tryParse(n.expr);
      const isText = sel && typeOf(ctx, sel) === 'string';
      // Auswahlwert einmal berechnen
      let subj;
      if (!sel) subj = '0';
      else if (isText) {
        subj = text(ctx, sel);
        if (!/^\$[A-Za-z_][A-Za-z0-9_]*:q$/.test(subj)) { const t = temp(ctx); line(ctx, 'set ' + t + ' = ' + subj); subj = '$' + t + ':q'; }
      } else {
        subj = num(ctx, sel);
        if (!/^(\$[A-Za-z_][A-Za-z0-9_]*|-?\d+)$/.test(subj)) { const t = temp(ctx); line(ctx, '@ ' + t + ' = ' + subj); subj = '$' + t; }
      }
      const test = (c) => {
        const v = tryParse(c.value);
        if (isText) return 'x' + subj + ' == x' + (v ? text(ctx, v) : "''");
        return subj + ' == ' + (v ? num(ctx, v) : '0');
      };
      if (!g) {
        if (!n.cases.length) { if (n.else) genSeq(ctx, n.else); return; }
        n.cases.forEach((c, i) => {
          line(ctx, (i ? 'else if ( ' : 'if ( ') + test(c) + ' ) then');
          block(ctx, c.body);
        });
        if (n.else && n.else.length) { line(ctx, 'else'); block(ctx, n.else); }
        line(ctx, 'endif');
        return;
      }
      const base = newLabel('switch');
      const lEnd = base.replace('switch', 'endswitch');
      const lc = n.cases.map((c, i) => base.replace('switch', 'case') + '_' + (i + 1));
      const lElse = base.replace('switch', 'default');
      n.cases.forEach((c, i) => line(ctx, 'if ( ' + test(c) + ' ) goto ' + lc[i]));
      line(ctx, 'goto ' + (n.else && n.else.length ? lElse : lEnd));
      n.cases.forEach((c, i) => {
        label(ctx, lc[i]);
        block(ctx, c.body);
        ctx.ind++; line(ctx, 'goto ' + lEnd); ctx.ind--;
      });
      if (n.else && n.else.length) { label(ctx, lElse); block(ctx, n.else); }
      label(ctx, lEnd);
    }

    // ------------------------------------------------------------ Aufrufe

    function genCall(ctx, n) {
      const callee = byName.get(n.fn);
      if (!callee) { line(ctx, '# ' + (n.fn || '?') + '(…)'); return; }
      const save = needSave(ctx.fn, callee);
      const cn = varNames.get(callee);
      const cv = (nm) => cn.get(nm);
      line(ctx, '# ' + tr('cshCall', callee.name));
      // Ziele, die nach dem Rücksprung beschrieben werden (Index jetzt merken – wie in der Simulation)
      const outs = [];
      const keepIdx = (d) => {
        if (!d.idx || /^\d+$/.test(d.idx)) return d;
        const v = 'bb_i' + (++idxNo);
        ctx.extra.push(v);
        line(ctx, 'set ' + v + ' = ' + d.idx);
        return Object.assign({}, d, { idx: '$' + v });
      };
      const assigns = []; // Parameter belegen: { lines(ctx, dst) }
      callee.params.forEach((p, i) => {
        const src = n.args[i] || '';
        const pv = cv(p.name);
        if (A.isArrayType(p.type)) {
          const t = tryTarget(src);
          const an = t ? name(ctx, t.k === 'id' ? t.name : t.obj.name) : cshName(src);
          assigns.push({ array: true, from: '( $' + an + ':q )', to: pv });
          outs.push({ array: true, from: pv, to: an });
          return;
        }
        if (p.byRef) {
          const d = keepIdx(dest(ctx, src));
          assigns.push({ text: p.type === 'string', from: p.type === 'string' ? rhs(d) : (d.type === 'string' ? toNum(ctx, rhs(d)) : '$' + lhs(d)), to: pv });
          outs.push({ type: p.type, from: pv, to: d });
          return;
        }
        const ast = tryParse(src);
        if (p.type === 'string') assigns.push({ text: true, from: ast ? text(ctx, ast) : "''", to: pv });
        else assigns.push({ text: false, from: ast ? num(ctx, ast) : '0', to: pv });
      });
      if (callee.returnType !== 'void' && n.target && n.target.trim()) {
        const d = keepIdx(dest(ctx, n.target));
        outs.push({ type: callee.returnType, from: cv('result'), to: d });
      }
      const put = (to, a) => {
        if (a.array) line(ctx, 'set ' + to + ' = ' + a.from);
        else if (a.text) line(ctx, 'set ' + to + ' = ' + a.from);
        else setNum(ctx, { name: to, idx: null }, a.from);
      };
      if (save) {
        // erst alle Argumente berechnen, dann eigene Variablen sichern, dann Parameter belegen
        assigns.forEach((a, i) => put('bb_arg' + (i + 1), a));
        line(ctx, '# ' + tr('cshSave'));
        line(ctx, '\u0001SAVE');
        assigns.forEach((a, i) => line(ctx, 'set ' + a.to + ' = ' + (a.array ? '( $bb_arg' + (i + 1) + ':q )' : '$bb_arg' + (i + 1) + ':q')));
      } else {
        for (const a of assigns) put(a.to, a);
      }
      const r = ++retNo;
      line(ctx, 'set bb_ret = ( $bb_ret ' + r + ' )');
      line(ctx, 'goto ' + fnLabel.get(callee.name));
      label(ctx, 'bb_r' + r);
      // Ergebnisse zurückkopieren
      const back = (o, from) => {
        if (o.array) { line(ctx, 'set ' + o.to + ' = ( $' + from + ':q )'); return; }
        const d = o.to;
        const tt = d.type === '?' ? o.type : d.type;
        if (tt === 'string') setText(ctx, d, '$' + from + ':q');
        else if (o.type === 'string') setNum(ctx, d, toNum(ctx, '$' + from + ':q'));
        else setNum(ctx, d, '$' + from);
      };
      if (save) {
        outs.forEach((o, i) => line(ctx, 'set bb_out' + (i + 1) + ' = ' + (o.array ? '( $' + o.from + ':q )' : '$' + o.from + ':q')));
        line(ctx, '# ' + tr('cshRestore'));
        line(ctx, '\u0001RESTORE');
        outs.forEach((o, i) => back(o, 'bb_out' + (i + 1)));
      } else {
        for (const o of outs) back(o, o.from);
      }
    }

    // ------------------------------------------------------------ Unterprogramme

    function genFunction(fn) {
      const scope = A.scopeOf(fn);
      const names = varNames.get(fn);
      const lab = fn.isMain ? 'main' : fnLabel.get(fn.name);
      const ctx = { fn, scope, names, ind: fn.isMain ? 0 : 1, lines: [], cnt: 0, label: lab, extra: [], idxNo: 0 };
      if (!fn.isMain && fn.returnType !== 'void') {
        ctx.cnt = 0;
        assign(ctx, { name: names.get('result'), idx: null }, fn.returnType, fn.resultInit);
      }
      const head = ctx.lines.splice(0);
      genSeq(ctx, fn.body);
      const body = ctx.lines;

      const out = [];
      if (!fn.isMain) {
        const sig = fn.params.map((p) => (p.byRef && !A.isArrayType(p.type) ? 'InOut ' : '') + names.get(p.name)).join(', ');
        out.push('', '# ' + '-'.repeat(60), '# ' + tr('cshSub', fn.name + '(' + fn.params.map((p) => p.name).join(', ') + ')') + (sig ? '  →  ' + sig : ''));
        out.push(lab + ':');
      }
      // Variablen, die beim Sichern alle vorhanden sein müssen
      const vars = [];
      for (const [n, v] of scope) if (v.kind === 'decl') vars.push({ name: names.get(n), type: v.type });
      const all = [...fn.params.map((p) => ({ name: names.get(p.name), type: p.type })),
        ...(fn.isMain || fn.returnType === 'void' ? [] : [{ name: names.get('result'), type: fn.returnType }]),
        ...vars, ...ctx.extra.map((x) => ({ name: x, type: 'integer' }))];
      out.push(...head);
      if (saving.has(fn)) {
        for (const v of vars) out.push(IND + 'set ' + v.name + ' = ' + (A.isArrayType(v.type) ? '( )' : v.type === 'string' ? "''" : '0'));
        for (const x of ctx.extra) out.push(IND + 'set ' + x + ' = 0');
      }
      const arrays = all.filter((v) => A.isArrayType(v.type));
      const scalars = all.filter((v) => !A.isArrayType(v.type));
      for (const l of body) {
        const m = /^(\s*)\u0001(SAVE|RESTORE)$/.exec(l);
        if (!m) { out.push(l); continue; }
        const ind = m[1];
        if (m[2] === 'SAVE') {
          // x davor: csh verliert leere Wörter in Listen
          const words = arrays.map((v) => '$' + v.name + ':q $#' + v.name).concat(scalars.map((v) => 'x$' + v.name + ':q'));
          out.push(ind + 'set bb_stack = ( $bb_stack:q ' + words.join(' ') + ' )');
        } else {
          if (scalars.length) {
            out.push(ind + '@ bb_n = $#bb_stack - ' + scalars.length);
            out.push(ind + '@ bb_m = $bb_n + 1');
            out.push(ind + 'set bb_top = ( $bb_stack[$bb_m-]:q )');
            out.push(ind + 'set bb_stack = ( $bb_stack[1-$bb_n]:q )');
            scalars.forEach((v, i) => out.push(ind + 'set ' + v.name + ' = $bb_top[' + (i + 1) + ']:s/x//:q'));
          }
          for (const v of arrays.slice().reverse()) {
            out.push(ind + '@ bb_c = $bb_stack[$#bb_stack]');
            out.push(ind + '@ bb_e = $#bb_stack - 1');
            out.push(ind + '@ bb_n = $bb_e - $bb_c');
            out.push(ind + '@ bb_m = $bb_n + 1');
            out.push(ind + 'if ( $bb_c > 0 ) then');
            out.push(ind + IND + 'set ' + v.name + ' = ( $bb_stack[$bb_m-$bb_e]:q )');
            out.push(ind + 'else');
            out.push(ind + IND + 'set ' + v.name + ' = ( )');
            out.push(ind + 'endif');
            out.push(ind + 'set bb_stack = ( $bb_stack[1-$bb_n]:q )');
          }
        }
      }
      if (!fn.isMain) out.push(IND + 'goto bb_return');
      return out;
    }

    // ------------------------------------------------------------ Zusammenbau

    const mainLines = genFunction(mainFn);
    const subLines = [];
    for (const f of subs) subLines.push(...genFunction(f));

    const out = ['#!/bin/csh -f', '# ' + tr('cshHeader1')];
    if (subs.length) out.push('# ' + tr('cshHeader2'));
    out.push('', 'set noglob');
    if (used.ret) out.push('set bb_ret = ( 0 )');
    if (used.stack) out.push('set bb_stack = ( 0 )');
    out.push('');
    out.push(...mainLines);
    out.push('exit 0');
    if (subs.length) {
      out.push(...subLines);
      out.push('', '# ' + tr('cshReturn'), 'bb_return:');
      out.push(IND + 'set bb_r = $bb_ret[$#bb_ret]');
      out.push(IND + '@ bb_n = $#bb_ret - 1');
      out.push(IND + 'set bb_ret = ( $bb_ret[1-$bb_n] )');
      out.push(IND + 'goto bb_r$bb_r');
    }
    return out.join('\n') + '\n';
  }

  BBE.cshgen = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
