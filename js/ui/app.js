/* Blockbild-Editor – Anwendung: Zustand, Befehle, Ausführung */
(function (G) {
  'use strict';
  const BBE = G.BBE;
  const { h, autosize, autosizeAll, debounce, store, download, copyText, toast, inSandboxViewer, hScroll } = BBE.dom;
  const { icon, kindIcon, brandMark } = BBE.icons;
  const M = BBE.model;
  const A = BBE.analyze;
  const I18N = BBE.i18n;
  const t = (...a) => I18N.t(...a);
  /** Tastennamen je nach Sprache */
  const kb = (s) => (I18N.lang === 'en' ? s.replace('Strg', 'Ctrl').replace('Entf', 'Del') : s);

  const VERSION = '3.0';
  const KEY_AUTOSAVE = 'bbe3.autosave';
  const KEY_SETTINGS = 'bbe3.settings';
  const KEY_OLD = 'autoSavedDiagram';
  const SPEEDS = [2000, 1200, 800, 500, 300, 150, 60, 0];
  const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

  const PALETTE = [
    { grp: 'grp.data', items: ['decl', 'assign'] },
    { grp: 'grp.io', items: ['input', 'output'] },
    { grp: 'grp.branch', items: ['if', 'else', 'switch', 'case'] },
    { grp: 'grp.loop', items: ['while', 'for', 'until'] },
    { grp: 'grp.misc', items: ['call', 'comment'] }
  ];
  const STATEMENT_KINDS = ['decl', 'assign', 'input', 'output', 'if', 'switch', 'while', 'for', 'until', 'call', 'comment'];
  const CODE_LANGS = [
    { id: 'c', label: 'C', ext: '.c', mime: 'text/x-c' },
    { id: 'cpp', label: 'C++', ext: '.cpp', mime: 'text/x-c++src' },
    { id: 'cs', label: 'C#', ext: '.cs', mime: 'text/x-csharp' },
    { id: 'java', label: 'Java', ext: '.java', mime: 'text/x-java' },
    { id: 'python', label: 'Python', ext: '.py', mime: 'text/x-python' }
  ];

  const defaults = {
    lang: I18N.detect(), theme: 'system', layout: 'bb', colors: true, addresses: false,
    skipChecks: false, follow: true, speed: 3, zoom: 1, side: 'run'
  };

  const S = {
    program: M.createProgram(),
    activeFnId: 'main',
    sel: new Set(),
    anchor: null,
    clipboard: null,
    hist: [],
    hi: -1,
    dirty: false,
    fileName: 'blockbild',
    fileHandle: null,
    settings: Object.assign({}, defaults, store.get(KEY_SETTINGS, {})),
    analysis: null,
    codeStale: true,
    breakpoints: new Set(),
    fnNames: new Map(),
    savedAt: null,
    run: { state: 'idle', interp: null, gen: null, timer: null, hl: null, steps: 0, error: null, send: undefined, mode: 'run', frames: null, tempBreak: null }
  };
  I18N.lang = S.settings.lang;

  const el = {};
  let con = null;
  let dndCtl = null;

  // ================================================================ Hilfsfunktionen

  const activeFn = () => M.findFn(S.program, S.activeFnId) || S.program.fns[0];
  const isRunning = () => ['running', 'paused', 'input'].includes(S.run.state);
  const nodeById = (id) => { const hit = M.findNode(S.program, id); return hit ? hit.node : null; };
  const saveSettings = () => store.set(KEY_SETTINGS, S.settings);
  const isEditable = (e) => e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable);
  const programIsEmpty = () => S.program.fns.length === 1 && S.program.fns[0].body.length === 0;

  function slug(s) {
    return String(s || 'blockbild').trim().replace(/\.(bb|json|c)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'blockbild';
  }

  // ================================================================ Oberfläche aufbauen

  function btn(iconName, label, onClick, opts = {}) {
    const b = h('button.btn' + (opts.cls ? '.' + opts.cls : '') + (opts.text ? '' : '.icon'), {
      type: 'button', title: label + (opts.key ? '  (' + opts.key + ')' : ''), 'aria-label': label
    }, icon(iconName), opts.text ? h('span.lbl-hide', null, label) : null);
    b.addEventListener('click', onClick);
    return b;
  }

  function buildShell() {
    const root = document.getElementById('app');
    root.textContent = '';
    root.className = 'app';

    // ---- Werkzeugleiste
    el.fileName = h('input.file-name', { type: 'text', value: S.fileName, 'aria-label': t('tb.fileName'), title: t('tb.fileName'), spellcheck: 'false' });
    el.fileName.addEventListener('input', () => { S.fileName = el.fileName.value; updateTitle(); scheduleSave(); });
    el.fileName.addEventListener('change', () => { S.fileName = slug(el.fileName.value); el.fileName.value = S.fileName; updateTitle(); });
    el.dirty = h('span.dirty-dot', { title: '', hidden: true }, '●');

    el.btnUndo = btn('undo', t('tb.undo'), undo, { key: kb('Strg+Z') });
    el.btnRedo = btn('redo', t('tb.redo'), redo, { key: kb('Strg+Y') });
    el.btnRun = btn('play', t('tb.run'), () => onRunButton(), { text: true, cls: 'run', key: kb('F5') });
    el.btnStep = btn('step', t('tb.step'), () => stepRun(), { text: true, key: kb('F10') });
    el.btnStop = btn('stop', t('tb.stop'), () => stopRun(true), { key: kb('Shift+F5') });
    el.speed = h('input', { type: 'range', min: '0', max: String(SPEEDS.length - 1), step: '1', 'aria-label': t('tb.speed') });
    el.speedOut = h('input.speed-ms', { type: 'number', min: '0', max: '10000', step: '50', inputmode: 'numeric', 'aria-label': t('tb.delay'), title: t('tb.delay') });
    el.speed.addEventListener('input', () => setDelay(SPEEDS[Number(el.speed.value)], 'slider'));
    el.speedOut.addEventListener('input', () => {
      const v = Number(el.speedOut.value);
      if (el.speedOut.value !== '' && Number.isFinite(v)) setDelay(v, 'field');
    });
    el.speedOut.addEventListener('change', () => updateSpeedLabel());
    el.btnTheme = btn(effectiveTheme() === 'dark' ? 'sun' : 'moon', t('tb.theme'), toggleTheme);
    el.btnExport = btn('share', t('tb.export'), (e) => openExportMenu(e.currentTarget), { text: true });

    const topbar = h('header.topbar', null,
      h('div.brand', null, brandMark(),
        h('div.brand-text', null, h('span.brand-name', null, t('appName')), h('span', null, el.fileName, el.dirty))),
      h('div.tb-group', null,
        btn('newfile', t('tb.new'), newDiagram),
        btn('open', t('tb.open'), openFile, { key: kb('Strg+O') }),
        btn('save', t('tb.save'), saveFile, { key: kb('Strg+S') }),
        btn('book', t('tb.examples'), showExamples, { text: true }),
        el.btnExport),
      h('span.tb-sep'),
      h('div.tb-group', null, el.btnUndo, el.btnRedo),
      h('span.tb-sep'),
      h('div.tb-group', null, el.btnRun, el.btnStep, el.btnStop,
        h('div.speed', { title: t('tb.speed') }, el.speed, h('label.speed-field', null, el.speedOut, h('span.speed-unit', null, 'ms')))),
      h('span.tb-spacer'),
      h('div.tb-group', null,
        btn('sliders', t('tb.settings'), showSettings),
        btn('help', t('tb.help'), showHelp, { key: kb('F1') }),
        el.btnTheme));

    // ---- Palette
    el.palette = h('aside.palette', { 'aria-label': t('pal.title') },
      h('div.pal-head', null, h('h2.pal-title', null, t('pal.title')), h('span.pal-hint', null, t('pal.hint'))));
    for (const g of PALETTE) {
      const grp = h('div.pal-group', null, h('h3.pal-group-title', null, t(g.grp)));
      for (const kind of g.items) {
        const item = h('button.pal-item', {
          type: 'button', class: 'cat-' + M.CATEGORY[kind] + (M.COMPONENTS.includes(kind) ? ' component' : ''),
          dataset: { kind }, title: t('pal.' + kind + '.d')
        }, h('span.pal-ic', null, kindIcon(kind)),
        h('span.pal-txt', null, h('span.pal-name', null, t('pal.' + kind)), h('span.pal-desc', null, t('pal.' + kind + '.d'))));
        item.addEventListener('click', () => paletteClick(kind));
        grp.appendChild(item);
      }
      el.palette.appendChild(grp);
    }

    // ---- Arbeitsfläche
    el.tabs = h('nav.tabs', { 'aria-label': t('fn.sub') });
    el.zoomVal = h('button.zoom-val', { type: 'button', title: t('st.zoom') + ' 100 %' });
    el.zoomVal.addEventListener('click', () => setZoom(1));
    const zoomOut = h('button.btn.sm.icon', { type: 'button', title: 'Zoom −', 'aria-label': 'Zoom −' }, icon('zoomOut'));
    const zoomIn = h('button.btn.sm.icon', { type: 'button', title: 'Zoom +', 'aria-label': 'Zoom +' }, icon('zoomIn'));
    zoomOut.addEventListener('click', () => stepZoom(-1));
    zoomIn.addEventListener('click', () => stepZoom(1));
    el.zoombox = h('div.zoombox');
    el.canvasInner = h('div.canvas-inner', null, el.zoombox);
    el.canvas = h('div.canvas', { tabindex: '-1' }, h('div.canvas-tools', null, zoomOut, el.zoomVal, zoomIn), el.canvasInner);
    // Aktionsleiste für Touch-Geräte (statt Rechtsklick/Tastatur)
    const sb = (iconName, label, fn, cls) => {
      const b = h('button.btn.icon' + (cls ? '.' + cls : ''), { type: 'button', title: label, 'aria-label': label }, icon(iconName));
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      return b;
    };
    el.selBar = h('div.sel-bar', { hidden: true, role: 'toolbar', 'aria-label': t('tb.more') },
      sb('up', t('ctx.moveUp'), () => moveSelection(-1)),
      sb('down', t('ctx.moveDown'), () => moveSelection(1)),
      sb('duplicate', t('ctx.duplicate'), duplicateSelection),
      sb('trash', t('ctx.delete'), deleteSelection, 'danger'),
      sb('more', t('tb.more'), (b) => openBlockMenu(nodeById(S.anchor), b, null)));
    const work = h('section.work', null, el.tabs, el.canvas, el.selBar);

    // ---- Seitenleiste
    el.sideTabs = {};
    const sideTab = (id, iconName, label) => {
      const b = h('button.side-tab', { type: 'button', dataset: { panel: id } }, h('span.tab-ic', null, icon(iconName)), h('span.side-label', null, label));
      b.addEventListener('click', () => setSide(id));
      el.sideTabs[id] = b;
      return b;
    };
    el.probBadge = h('span.badge.ok', null, '0');
    const tabProblems = sideTab('problems', 'check', t('side.problems'));
    tabProblems.appendChild(el.probBadge);

    el.stack = h('div.pane-body');
    el.consoleList = h('div.console');
    el.consoleBody = h('div.pane-body', null, el.consoleList);
    el.ciPrompt = h('span.ci-prompt');
    el.ciInput = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('console.inputPh') });
    el.ciForm = h('form.console-input', { hidden: true }, el.ciPrompt, el.ciInput,
      h('button.btn.sm.primary', { type: 'submit' }, t('console.send')));
    const clearBtn = h('button.btn.sm.subtle', { type: 'button' }, t('console.clear'));
    clearBtn.addEventListener('click', () => con.clear());

    el.addrToggle = h('button.btn.sm.subtle', { type: 'button', title: t('set.addresses') }, '0x');
    el.addrToggle.addEventListener('click', () => { S.settings.addresses = !S.settings.addresses; saveSettings(); renderStackPanel(); });

    const runPanel = h('div.side-panel', { dataset: { panel: 'run' } },
      h('div.run-panel', null,
        h('div.pane', null,
          h('div.pane-head', null, h('h2.pane-title', null, icon('stack'), t('stack.title')), h('span.pane-sub', null, t('stack.grows')),
            h('div.pane-actions', null, el.addrToggle)),
          el.stack),
        h('div.pane', null,
          h('div.pane-head', null, h('h2.pane-title', null, icon('terminal'), t('console.title')), h('div.pane-actions', null, clearBtn)),
          el.consoleBody, el.ciForm)));

    el.code = h('pre.code');
    const copyBtn = h('button.btn.sm', { type: 'button', title: t('code.copy') }, icon('copy'), h('span.lbl-hide', null, t('code.copy')));
    copyBtn.addEventListener('click', async () => { const ok = await copyText(currentCode()); toast(ok ? t('code.copied') : t('dlg.copy')); });
    const dlBtn = h('button.btn.sm', { type: 'button', title: t('code.download') }, icon('download'), h('span.lbl-hide', null, t('code.download')));
    dlBtn.addEventListener('click', () => exportCode(codeLang()));
    // Sprachwahl für den Export
    el.langSeg = h('div.lang-seg', { role: 'radiogroup', 'aria-label': t('code.lang') },
      CODE_LANGS.map((l) => {
        const b = h('button', { type: 'button', role: 'radio', dataset: { lang: l.id } }, l.label);
        b.addEventListener('click', () => { S.settings.codeLang = l.id; saveSettings(); renderCode(); });
        return b;
      }));
    const codePanel = h('div.side-panel', { dataset: { panel: 'code' }, hidden: true },
      h('div.pane-head.code-head', null, el.langSeg, h('div.pane-actions', null, copyBtn, dlBtn)),
      h('div.code-wrap', null, el.code));

    el.problems = h('div.pane-body');
    const probPanel = h('div.side-panel', { dataset: { panel: 'problems' }, hidden: true }, el.problems);

    el.sideToggle = h('button.side-toggle', { type: 'button' }, icon('chevron'));
    el.sideToggle.addEventListener('click', () => setSideCollapsed(!S.settings.sideCollapsed));
    const sideTabs = h('div.side-tabs', { role: 'tablist' }, sideTab('run', 'play', t('side.run')), sideTab('code', 'code', t('side.code')), tabProblems, el.sideToggle);
    el.side = h('aside.side', null, sideTabs, runPanel, codePanel, probPanel);
    for (const bar of [topbar, el.palette, el.tabs, sideTabs]) hScroll(bar);

    // ---- Statusleiste
    el.stProblems = h('button.st-item', { type: 'button' });
    el.stProblems.addEventListener('click', () => setSide('problems'));
    el.stRunDot = h('span.st-dot');
    el.stRun = h('span');
    el.stSteps = h('span.st-item.st-hide-sm');
    el.stSaved = h('span.st-item.st-hide-sm');
    el.status = h('footer.statusbar', null, el.stProblems, h('span.st-item', null, el.stRunDot, el.stRun), el.stSteps,
      h('span.st-right', null, el.stSaved));

    el.main = h('div.main', null, el.palette, work, el.side);
    root.appendChild(topbar);
    root.appendChild(el.main);
    root.appendChild(el.status);

    con = new BBE.panels.Console({ t, body: el.consoleBody, list: el.consoleList, form: el.ciForm, input: el.ciInput, promptEl: el.ciPrompt });

    // ---- Ereignisse der Arbeitsfläche
    el.canvas.addEventListener('click', onCanvasClick);
    el.canvas.addEventListener('contextmenu', onCanvasContext);
    el.canvas.addEventListener('dblclick', onCanvasDblClick);
    el.canvas.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    el.canvas.addEventListener('focusin', (e) => {
      const blk = e.target.closest && e.target.closest('.blk[data-id]');
      if (blk && isEditable(e.target) && !S.sel.has(blk.dataset.id)) { S.sel = new Set([blk.dataset.id]); S.anchor = blk.dataset.id; applySelection(); }
      if (e.target.matches && e.target.matches('input.fn-name')) S.fnNames.set(S.activeFnId, activeFn().name);
    });
    BBE.ui.attachAutocomplete(el.canvas, (inp) => {
      const scope = A.scopeOf(activeFn());
      return Array.from(scope.entries()).map(([name, v]) => ({ label: name, type: t('type.' + v.type) }));
    });
    el.canvas.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      if (e.target.matches && e.target.matches('input.f') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); el.canvas.focus({ preventScroll: true }); }
      if (e.target.matches && e.target.matches('input.f') && e.key === 'Escape') { e.target.blur(); el.canvas.focus({ preventScroll: true }); }
    });


    if (!dndCtl) dndCtl = BBE.dnd.init({ app: API, getCanvas: () => el.canvas });

    updateSpeedLabel();
    setSide(S.settings.side || 'run', true);
    setSideCollapsed(!!S.settings.sideCollapsed);
  }

  // Einmalige globale Ereignisse
  function bindGlobal() {
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopyEvent);
    document.addEventListener('cut', onCutEvent);

    // Datei auf das Fenster ziehen
    let dropOverlay = null;
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      if (!dropOverlay) { dropOverlay = h('div.file-drop', null, t('tb.open') + ' (.bb)'); document.body.appendChild(dropOverlay); }
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth && dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
    });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
      const f = e.dataTransfer.files[0];
      if (f) f.text().then((txt) => loadFileText(txt, f.name, null));
    });

    el.fileInput = h('input', { type: 'file', accept: '.bb,.json,.txt,.py,application/json,text/x-python', hidden: true });
    el.fileInput.addEventListener('change', () => {
      const f = el.fileInput.files[0];
      if (f) f.text().then((txt) => loadFileText(txt, f.name, null));
      el.fileInput.value = '';
    });
    document.body.appendChild(el.fileInput);

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const upd = () => { if (el.btnTheme) el.btnTheme.replaceChildren(icon(effectiveTheme() === 'dark' ? 'sun' : 'moon')); };
      if (mq.addEventListener) mq.addEventListener('change', upd);
    }
  }

  // ================================================================ Darstellung

  function renderAll() {
    renderTabs();
    renderCanvas();
    renderSidePanels();
    updateToolbar();
    updateStatus();
    updateTitle();
    setZoom(S.settings.zoom, true);
  }

  function renderTabs() {
    el.tabs.textContent = '';
    for (const fn of S.program.fns) {
      const tab = h('button.tab' + (fn.id === S.activeFnId ? '.active' : ''), { type: 'button', role: 'tab', dataset: { fn: fn.id }, 'aria-selected': String(fn.id === S.activeFnId) });
      if (S.run.hl && S.run.hl.fnId === fn.id && isRunning()) tab.appendChild(h('span.tab-run'));
      tab.appendChild(h('span.tab-ic' + (fn.isMain ? '.main' : ''), null, fn.isMain ? icon('home') : kindIcon('call')));
      tab.appendChild(h('span.tab-name', null, fn.isMain ? 'main' : (fn.name || '?')));
      if (!fn.isMain) tab.appendChild(h('span.tab-par', null, '()'));
      tab.title = fn.isMain ? t('fn.main') : t('fn.sub') + ' ' + (fn.name || '');
      if (!fn.isMain) {
        const x = h('span.tab-x', { role: 'button', title: t('tab.close'), 'aria-label': t('tab.close') }, icon('x'));
        x.addEventListener('click', (e) => { e.stopPropagation(); deleteFunction(fn); });
        tab.appendChild(x);
      }
      tab.addEventListener('click', () => setActiveFn(fn.id));
      tab.addEventListener('dblclick', () => {
        if (fn.isMain) return;
        const inp = el.zoombox.querySelector('input.fn-name');
        if (inp) { inp.focus(); inp.select(); }
      });
      el.tabs.appendChild(tab);
    }
    if (S.program.fns.length) el.tabs.appendChild(h('span.tab-sep'));
    const add = h('button.tab-add', { type: 'button', title: t('tab.add') }, icon('plus'), t('fn.sub'));
    add.addEventListener('click', addFunction);
    el.tabs.appendChild(add);
  }

  function renderCanvas() {
    const fn = activeFn();
    S.fnNames.set(fn.id, fn.name);
    const R = { t, app: API, program: S.program, fn, static: false, locked: isRunning() };
    const view = BBE.render.renderFunction(R, fn);
    el.zoombox.replaceChildren(view);
    if (R.locked) {
      el.zoombox.querySelectorAll('input.f').forEach((i) => { i.readOnly = true; });
      el.zoombox.querySelectorAll('select, .add-param, .x-btn, .dir-btn').forEach((b) => { b.disabled = true; });
    }
    autosizeAll(el.zoombox);
    applyProblems();
    applySelection();
    applyRunVisuals(false);
  }

  function setActiveFn(id, keepScroll) {
    if (!M.findFn(S.program, id)) id = 'main';
    if (S.activeFnId === id) return;
    S.activeFnId = id;
    S.sel.clear();
    S.anchor = null;
    renderTabs();
    renderCanvas();
    if (!keepScroll) el.canvas.scrollTo({ top: 0, left: 0 });
  }

  function setSideCollapsed(v) {
    S.settings.sideCollapsed = !!v;
    saveSettings();
    el.main.classList.toggle('side-collapsed', !!v);
    el.sideToggle.title = v ? t('side.expand') : t('side.collapse');
    el.sideToggle.setAttribute('aria-label', el.sideToggle.title);
    if (!v) renderSidePanels();
  }

  function setSide(id, silent) {
    if (S.settings.sideCollapsed && !silent) setSideCollapsed(false);
    S.settings.side = id;
    if (!silent) saveSettings();
    for (const [k, b] of Object.entries(el.sideTabs)) {
      b.classList.toggle('active', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    el.side.querySelectorAll('.side-panel').forEach((p) => { p.hidden = p.dataset.panel !== id; });
    renderSidePanels();
  }

  function renderSidePanels() {
    const side = S.settings.side;
    if (side === 'run') renderStackPanel();
    if (side === 'code') renderCode();
    if (side === 'problems') renderProblemList();
    updateProblemBadge();
  }

  function renderStackPanel() {
    el.addrToggle.classList.toggle('primary', !!S.settings.addresses);
    el.addrToggle.setAttribute('aria-pressed', String(!!S.settings.addresses));
    const it = S.run.interp;
    const frames = isRunning() && it ? it.snapshot() : S.run.frames;
    BBE.panels.renderStack(el.stack, frames, {
      t, showAddr: S.settings.addresses, live: isRunning(),
      changed: it ? it.changed : null, changedElems: it ? it.changedElems : null
    });
  }

  const codeLang = () => (CODE_LANGS.some((l) => l.id === S.settings.codeLang) ? S.settings.codeLang : 'c');
  const javaClass = () => BBE.javagen.className(S.fileName);

  /** Quelltext in der gewünschten Sprache (zwischengespeichert, bis sich das Diagramm ändert). */
  function currentCode(lang = codeLang()) {
    if (S.codeStale || !S.codeCache) { S.codeCache = {}; S.codeStale = false; }
    if (!(lang in S.codeCache)) {
      try {
        if (lang === 'java') S.codeCache[lang] = BBE.javagen.generate(S.program, { t, className: javaClass() });
        else if (lang === 'cs') S.codeCache[lang] = BBE.csgen.generate(S.program, { t, className: javaClass() });
        else if (lang === 'cpp') S.codeCache[lang] = BBE.cppgen.generate(S.program, { t });
        else if (lang === 'python') S.codeCache[lang] = BBE.pygen.generate(S.program, { t });
        else S.codeCache[lang] = BBE.cgen.generate(S.program, { t });
      } catch (e) {
        console.error(e);
        S.codeCache[lang] = (lang === 'python' ? '# ' : '// ') + t('rInternal', e.message) + '\n';
      }
    }
    return S.codeCache[lang];
  }
  const currentC = () => currentCode('c');

  function renderCode() {
    const lang = codeLang();
    if (el.langSeg) el.langSeg.querySelectorAll('button').forEach((b) => { const on = b.dataset.lang === lang; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    const code = currentCode(lang);
    if (el.code.dataset.lang !== lang) { el.code.dataset.lang = lang; el.code.dataset.src = ''; }
    if (el.code.dataset.src !== code) {
      BBE.panels.highlight(el.code, code, lang);
      el.code.dataset.src = code;
    }
  }

  function renderProblemList() {
    BBE.panels.renderProblems(el.problems, S.analysis, { t, program: S.program, onPick: revealProblem });
  }

  function updateProblemBadge() {
    const an = S.analysis;
    const errs = an ? an.count.error : 0;
    const warns = an ? an.count.warn : 0;
    el.probBadge.textContent = String(errs || warns || 0);
    el.probBadge.className = 'badge ' + (errs ? 'err' : warns ? 'warn' : 'ok');
    el.stProblems.replaceChildren();
    if (!errs && !warns) {
      el.stProblems.append(icon('check'), h('span.st-ok', null, t('st.ok')));
    } else {
      el.stProblems.append(icon(errs ? 'error' : 'warn'));
      if (errs) el.stProblems.append(h('span.st-err', null, t(errs === 1 ? 'st.problems.1' : 'st.problems', errs)));
      if (warns) el.stProblems.append(h('span.st-warn', null, t(warns === 1 ? 'st.warnings.1' : 'st.warnings', warns)));
    }
  }

  function updateToolbar() {
    el.btnUndo.disabled = S.hi <= 0 || isRunning();
    el.btnRedo.disabled = S.hi >= S.hist.length - 1 || isRunning();
    const st = S.run.state;
    const running = st === 'running';
    el.btnRun.classList.toggle('pause', running);
    el.btnRun.replaceChildren(icon(running ? 'pause' : 'play'), h('span.lbl-hide', null,
      running ? t('tb.pause') : (st === 'paused' || st === 'input') ? t('tb.continue') : t('tb.run')));
    el.btnRun.title = (running ? t('tb.pause') : (st === 'paused' ? t('tb.continue') : t('tb.run'))) + '  (F5)';
    el.btnRun.disabled = st === 'input';
    el.btnStep.disabled = st === 'running' || st === 'input';
    el.btnStop.disabled = !isRunning();
    el.palette.classList.toggle('locked', isRunning());
  }

  function updateStatus() {
    const st = S.run.state;
    const map = { idle: 'st.ready', running: 'st.running', paused: S.run.atBreak ? 'st.breakpoint' : 'st.paused', input: 'st.input', done: 'st.done', error: 'st.error' };
    el.stRun.textContent = t(map[st] || 'st.ready');
    el.stRunDot.className = 'st-dot ' + st;
    el.stSteps.textContent = S.run.steps && st !== 'idle' ? t('st.steps', S.run.steps) : '';
    el.stSaved.textContent = S.savedAt ? t('st.saved') + ' · ' + S.savedAt : '';
    el.dirty.hidden = !S.dirty;
  }

  function updateTitle() {
    document.title = (S.fileName || 'blockbild') + ' · ' + t('appName');
  }

  /** Verzögerung pro Schritt in ms (0 = sofort). */
  const getDelay = () => (Number.isFinite(S.settings.delay) ? S.settings.delay : SPEEDS[S.settings.speed] ?? 500);

  function setDelay(ms, from) {
    S.settings.delay = Math.max(0, Math.min(10000, Math.round(ms)));
    saveSettings();
    if (from !== 'field') el.speedOut.value = String(S.settings.delay);
    if (from !== 'slider') el.speed.value = String(nearestSpeed(S.settings.delay));
    el.speedOut.title = S.settings.delay === 0 ? t('speed.max') : t('tb.delay');
    if (S.run.state === 'running') { clearTimer(); scheduleLoop(); }
  }

  function nearestSpeed(ms) {
    let best = 0;
    SPEEDS.forEach((s, i) => { if (Math.abs(s - ms) < Math.abs(SPEEDS[best] - ms)) best = i; });
    return best;
  }

  function updateSpeedLabel() {
    const ms = getDelay();
    el.speedOut.value = String(ms);
    el.speed.value = String(nearestSpeed(ms));
    el.speedOut.title = ms === 0 ? t('speed.max') : t('tb.delay');
  }

  // ---- Zoom
  function setZoom(z, silent) {
    S.settings.zoom = Math.min(2, Math.max(0.5, z));
    el.zoombox.style.setProperty('--zoom', String(S.settings.zoom));
    el.zoomVal.textContent = Math.round(S.settings.zoom * 100) + ' %';
    if (!silent) saveSettings();
  }
  function stepZoom(d) {
    const cur = S.settings.zoom;
    let i = ZOOMS.findIndex((z) => z >= cur - 0.001);
    if (i < 0) i = ZOOMS.length - 1;
    if (ZOOMS[i] > cur + 0.001 && d > 0) i--;
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + d))]);
  }

  // ---- Theme
  function effectiveTheme() {
    if (S.settings.theme === 'light' || S.settings.theme === 'dark') return S.settings.theme;
    const host = document.documentElement.getAttribute('data-theme');
    if (host === 'light' || host === 'dark') return host;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  let themeSetByApp = false;
  function applyTheme() {
    const r = document.documentElement;
    if (S.settings.theme === 'light' || S.settings.theme === 'dark') {
      r.setAttribute('data-theme', S.settings.theme);
      themeSetByApp = true;
    } else if (themeSetByApp) {
      // nur zurücksetzen, was die App selbst gesetzt hat (eine einbettende Seite darf das Schema vorgeben)
      r.removeAttribute('data-theme');
      themeSetByApp = false;
    }
    if (el.btnTheme) el.btnTheme.replaceChildren(icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'));
  }
  function toggleTheme() {
    S.settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  }

  // ================================================================ Prüfung

  const scheduleAnalyze = debounce(() => analyzeNow(), 220);

  function analyzeNow() {
    try {
      S.analysis = A.analyze(S.program);
    } catch (e) {
      console.error(e);
      S.analysis = { problems: [], byKey: new Map(), count: { error: 0, warn: 0 } };
    }
    S.codeStale = true;
    applyProblems();
    renderSidePanels();
  }

  function applyProblems() {
    const an = S.analysis;
    if (!an) return;
    el.zoombox.querySelectorAll('[data-pkey]').forEach((inp) => {
      const p = an.byKey.get(inp.dataset.pkey);
      if (inp.dataset.title0 === undefined) inp.dataset.title0 = inp.title || '';
      inp.classList.toggle('bad', !!p && p.sev === 'error');
      inp.classList.toggle('warn', !!p && p.sev === 'warn');
      inp.title = p ? t(p.key, p.args) : inp.dataset.title0;
    });
  }

  function revealProblem(p) {
    setActiveFn(p.fnId, true);
    const sel = '[data-pkey="' + CSS.escape(p.nodeId + ':' + p.field) + '"]';
    const inp = el.zoombox.querySelector(sel);
    if (p.nodeId !== p.fnId) { S.sel = new Set([p.nodeId]); S.anchor = p.nodeId; applySelection(); }
    if (inp) {
      inp.scrollIntoView({ block: 'center', inline: 'nearest' });
      inp.focus({ preventScroll: true });
      if (inp.select) inp.select();
    }
  }

  // ================================================================ Verlauf und Sicherung

  function snapshot() {
    return JSON.stringify({ fns: S.program.fns });
  }

  function resetHistory() {
    S.hist = [snapshot()];
    S.hi = 0;
    updateToolbar();
  }

  function commit() {
    scheduleCommit.cancel();
    const snap = snapshot();
    if (S.hist[S.hi] === snap) return;
    S.hist = S.hist.slice(0, S.hi + 1);
    S.hist.push(snap);
    if (S.hist.length > 200) S.hist.shift();
    S.hi = S.hist.length - 1;
    S.dirty = true;
    scheduleSave();
    updateToolbar();
    updateStatus();
  }
  const scheduleCommit = debounce(commit, 700);

  function restore(snap) {
    S.program = JSON.parse(snap);
    if (!M.findFn(S.program, S.activeFnId)) S.activeFnId = 'main';
    S.sel = new Set(Array.from(S.sel).filter((id) => nodeById(id)));
    S.dirty = true;
    clearRunError();
    renderAll();
    analyzeNow();
    scheduleSave();
  }

  function undo() {
    if (isRunning()) return;
    commit();
    if (S.hi <= 0) return;
    S.hi--;
    restore(S.hist[S.hi]);
  }

  function redo() {
    if (isRunning() || S.hi >= S.hist.length - 1) return;
    S.hi++;
    restore(S.hist[S.hi]);
  }

  const scheduleSave = debounce(saveNow, 600);
  function saveNow() {
    const ok = store.set(KEY_AUTOSAVE, {
      v: 3, fileName: S.fileName, active: activeFn().name, bb: M.programToBB(S.program),
      at: Date.now(), dirty: S.dirty
    });
    if (ok) {
      S.savedAt = new Date().toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' });
      if (el.stSaved) updateStatus();
    }
  }

  /** Änderung an der Struktur: anwenden, merken, neu zeichnen. */
  function mutate(fn, opts = {}) {
    if (isRunning()) { toast(t('toast.locked')); return false; }
    clearRunError();
    fn();
    commit();
    if (opts.tabs) renderTabs();
    renderCanvas();
    analyzeNow();
    return true;
  }

  // ================================================================ Rückrufe aus der Darstellung

  function fieldInput(inp, obj, key) {
    S.dirty = true;
    if (S.run.error) clearRunError(true);
    scheduleAnalyze();
    scheduleCommit();
    S.codeStale = true;
    if (el.dirty.hidden) updateStatus();
  }

  function fieldCommit() {
    commit();
    scheduleAnalyze.flush();
  }

  function changeDeclType(n, v) {
    mutate(() => {
      const was = n.vtype;
      n.vtype = v;
      if (!v.endsWith('[]')) {
        if (v === 'string' && (n.init === '0' || n.init === '' || was.endsWith('[]'))) n.init = '""';
        if (v === 'integer' && (n.init === '""' || n.init === '' || was.endsWith('[]'))) n.init = '0';
      } else if (!n.length) {
        n.length = '';
      }
    });
    focusField(n.id, v.endsWith('[]') ? 'length' : 'name');
  }

  function changeReturnType(fn, v) {
    mutate(() => {
      fn.returnType = v;
      if (v === 'string' && (fn.resultInit === '0' || !fn.resultInit)) fn.resultInit = '""';
      if (v === 'integer' && (fn.resultInit === '""' || !fn.resultInit)) fn.resultInit = '0';
      if (v === 'void') forEachCall(fn.name, (c) => { c.target = ''; });
    });
  }

  function renameFunctionLive(fn) {
    const prev = S.fnNames.get(fn.id);
    if (prev !== undefined && prev !== fn.name && !S.program.fns.some((f) => f !== fn && f.name === prev)) {
      forEachCall(prev, (c) => { c.fn = fn.name; });
    }
    S.fnNames.set(fn.id, fn.name);
    renderTabs();
  }

  function forEachCall(name, cb) {
    for (const f of S.program.fns) M.walkSeq(f.body, (n) => { if (n.kind === 'call' && n.fn === name) cb(n); });
  }

  function addParam(fn) {
    const p = M.createParam();
    mutate(() => { fn.params.push(p); });
    const inp = el.zoombox.querySelector('[data-pkey="' + CSS.escape(fn.id + ':param:' + p.id) + '"]');
    if (inp) inp.focus();
  }

  function removeParam(fn, p) {
    mutate(() => {
      const i = fn.params.indexOf(p);
      if (i < 0) return;
      fn.params.splice(i, 1);
      forEachCall(fn.name, (c) => { if (c.args.length > i) c.args.splice(i, 1); });
    });
  }

  function toggleParamDir(fn, p) {
    if (p.type.endsWith('[]')) return;
    mutate(() => { p.byRef = !p.byRef; });
  }

  function changeParamType(fn, p, v) {
    mutate(() => {
      p.type = v;
      if (v.endsWith('[]')) p.byRef = true;
    });
  }

  function changeCallTarget(n, name) {
    mutate(() => {
      n.fn = name;
      const callee = S.program.fns.find((f) => !f.isMain && f.name === name);
      if (callee) {
        while (n.args.length < callee.params.length) n.args.push('');
        n.args.length = callee.params.length;
        if (callee.returnType === 'void') n.target = '';
      }
    });
    const blk = el.zoombox.querySelector('.blk[data-id="' + n.id + '"] input.f');
    if (blk) blk.focus();
  }

  function addElse(n) { mutate(() => { if (!n.else) n.else = []; }); }

  function focusField(id, field) {
    const inp = el.zoombox.querySelector('[data-pkey="' + CSS.escape(id + ':' + field) + '"]');
    if (inp) inp.focus();
  }

  // ================================================================ Einfügen, Verschieben, Löschen

  /** Einfügestelle: nach dem markierten Block oder am Ende des aktiven Ablaufs. */
  function insertionPoint() {
    if (S.anchor) {
      const hit = M.findNode(S.program, S.anchor);
      if (hit && hit.fn.id === S.activeFnId) return { seq: hit.seq, index: hit.index + 1 };
    }
    const fn = activeFn();
    return { seq: fn.body, index: fn.body.length };
  }

  function paletteClick(kind) {
    if (isRunning()) { toast(t('toast.locked')); return; }
    if (M.COMPONENTS.includes(kind)) {
      const target = S.anchor ? nodeById(S.anchor) : null;
      if (target && (kind === 'case' ? target.kind === 'switch' : (target.kind === 'if' || target.kind === 'switch') && !target.else)) {
        addComponent(kind, target.id);
      } else {
        componentHint(kind);
      }
      return;
    }
    const p = insertionPoint();
    insertNodeAt(M.createNode(kind), p.seq, p.index);
  }

  function insertNodeAt(node, seq, index) {
    mutate(() => { seq.splice(index, 0, node); });
    selectAndFocus(node);
  }

  function insertNew(kind, owner, key, index) {
    const seq = M.getSeq(S.program, owner, key);
    if (!seq) return;
    insertNodeAt(M.createNode(kind), seq, index);
  }

  function selectAndFocus(node) {
    S.sel = new Set([node.id]);
    S.anchor = node.id;
    applySelection();
    const blk = el.zoombox.querySelector('.blk[data-id="' + node.id + '"]');
    if (!blk) return;
    blk.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const first = blk.querySelector('input.f:not(.f-cmt), select');
    if (first) first.focus({ preventScroll: true });
  }

  function moveNodes(ids, owner, key, index, copy) {
    const target = M.getSeq(S.program, owner, key);
    if (!target) return;
    const hits = ids.map((id) => M.findNode(S.program, id)).filter(Boolean);
    if (!hits.length) return;
    // nicht in sich selbst verschieben
    for (const hit of hits) {
      if (M.contains(hit.node, owner) || hit.node.id === owner) return;
    }
    let newIds = ids;
    const ok = mutate(() => {
      let idx = index;
      if (copy) {
        const clones = hits.map((hit) => M.cloneNode(hit.node));
        target.splice(idx, 0, ...clones);
        newIds = clones.map((c) => c.id);
        return;
      }
      const nodes = hits.map((hit) => hit.node);
      for (const n of nodes) {
        const hit = M.findNode(S.program, n.id);
        const i = hit.seq.indexOf(n);
        hit.seq.splice(i, 1);
        if (hit.seq === target && i < idx) idx--;
      }
      target.splice(idx, 0, ...nodes);
    });
    if (ok) {
      S.sel = new Set(newIds);
      S.anchor = newIds[newIds.length - 1];
      applySelection();
    }
  }

  function addComponent(kind, nodeId) {
    const n = nodeById(nodeId);
    if (!n) return;
    mutate(() => {
      if (kind === 'case' && n.kind === 'switch') n.cases.push(M.createCase());
      else if (kind === 'else' && !n.else) n.else = [];
    });
    if (kind === 'case') {
      const c = n.cases[n.cases.length - 1];
      focusField(n.id, 'case:' + c.id);
    }
  }

  function componentHint(kind) {
    toast(t('toast.componentHint', t('kw.' + kind), kind === 'case' ? t('kw.switch') : t('kw.if') + ' / ' + t('kw.switch')));
  }

  /** Markierte Blöcke in Dokumentreihenfolge. */
  function selectedHits() {
    const hits = [];
    for (const fn of S.program.fns) {
      M.walkSeq(fn.body, (n, seq, index) => {
        if (S.sel.has(n.id)) { hits.push({ node: n, seq, index, fn }); return false; }
        return undefined;
      });
    }
    return hits;
  }

  function deleteSelection() {
    const hits = selectedHits();
    if (!hits.length) return;
    mutate(() => {
      for (const hit of hits) {
        const i = hit.seq.indexOf(hit.node);
        if (i >= 0) hit.seq.splice(i, 1);
        S.breakpoints.delete(hit.node.id);
      }
    });
    S.sel.clear();
    S.anchor = null;
    applySelection();
    toast(t('toast.deleted', hits.length), { action: { label: t('toast.undo'), run: undo } });
  }

  function copySelection(cut) {
    const hits = selectedHits();
    if (!hits.length) return false;
    S.clipboard = JSON.stringify(hits.map((x) => x.node));
    copyText(M.clipboardPayload(hits.map((x) => x.node))).catch(() => {});
    if (cut) deleteSelection();
    else toast(t('toast.copied'));
    return true;
  }

  function pasteNodes(nodes) {
    if (!nodes || !nodes.length) { toast(t('toast.nothingToPaste')); return; }
    if (isRunning()) { toast(t('toast.locked')); return; }
    const fresh = nodes.map((n) => M.cloneNode(n));
    const p = insertionPoint();
    mutate(() => { p.seq.splice(p.index, 0, ...fresh); });
    S.sel = new Set(fresh.map((n) => n.id));
    S.anchor = fresh[fresh.length - 1].id;
    applySelection();
  }

  function pasteInternal() {
    pasteNodes(S.clipboard ? JSON.parse(S.clipboard) : null);
  }

  function duplicateSelection() {
    const hits = selectedHits();
    if (!hits.length) return;
    const clones = [];
    mutate(() => {
      for (const hit of hits.slice().reverse()) {
        const c = M.cloneNode(hit.node);
        hit.seq.splice(hit.seq.indexOf(hit.node) + 1, 0, c);
        clones.unshift(c);
      }
    });
    S.sel = new Set(clones.map((c) => c.id));
    S.anchor = clones[clones.length - 1].id;
    applySelection();
  }

  function moveSelection(dir) {
    const hits = selectedHits();
    if (hits.length !== 1) return;
    const { node, seq } = hits[0];
    const i = seq.indexOf(node);
    const j = i + dir;
    if (j < 0 || j >= seq.length) return;
    mutate(() => { seq.splice(i, 1); seq.splice(j, 0, node); });
    applySelection();
    const blk = el.zoombox.querySelector('.blk[data-id="' + node.id + '"]');
    if (blk) blk.scrollIntoView({ block: 'nearest' });
  }

  function wrapSelection(kind) {
    const hits = selectedHits();
    if (!hits.length) return;
    const seq = hits[0].seq;
    if (!hits.every((x) => x.seq === seq)) return;
    const wrapper = M.createNode(kind);
    mutate(() => {
      const nodes = hits.map((x) => x.node);
      const first = Math.min(...nodes.map((n) => seq.indexOf(n)));
      for (const n of nodes) seq.splice(seq.indexOf(n), 1);
      if (kind === 'if') wrapper.then.push(...nodes);
      else wrapper.body.push(...nodes);
      seq.splice(first, 0, wrapper);
    });
    selectAndFocus(wrapper);
  }

  function unwrap(n) {
    const hit = M.findNode(S.program, n.id);
    if (!hit) return;
    mutate(() => {
      const inner = [];
      for (const c of M.childSeqs(n)) inner.push(...c.seq);
      hit.seq.splice(hit.seq.indexOf(n), 1, ...inner);
    });
    S.sel.clear();
    applySelection();
  }

  // ================================================================ Auswahl

  function applySelection() {
    if (el.selBar) el.selBar.hidden = !S.sel.size || isRunning() || !S.anchor;
    el.zoombox.querySelectorAll('.blk.sel').forEach((b) => b.classList.remove('sel'));
    el.zoombox.querySelectorAll('.blk-more').forEach((b) => b.remove());
    for (const id of S.sel) {
      const b = el.zoombox.querySelector('.blk[data-id="' + id + '"]');
      if (!b) continue;
      b.classList.add('sel');
      if (id === S.anchor) {
        const more = h('button.blk-more', { type: 'button', title: t('tb.more'), 'aria-label': t('tb.more') }, icon('more'));
        more.addEventListener('click', (e) => { e.stopPropagation(); openBlockMenu(nodeById(id), more, null); });
        b.appendChild(more);
      }
    }
  }

  function onCanvasClick(e) {
    if (e.target.closest('input, select, button, .param, .fn-head, textarea')) return;
    const blk = e.target.closest('.blk[data-id]');
    if (!blk) {
      if (S.sel.size) { S.sel.clear(); S.anchor = null; applySelection(); }
      return;
    }
    const id = blk.dataset.id;
    if (e.ctrlKey || e.metaKey) {
      if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
      S.anchor = id;
    } else if (e.shiftKey && S.anchor) {
      const a = M.findNode(S.program, S.anchor);
      const b = M.findNode(S.program, id);
      if (a && b && a.seq === b.seq) {
        const [i, j] = [a.index, b.index].sort((x, y) => x - y);
        S.sel = new Set(a.seq.slice(i, j + 1).map((n) => n.id));
      } else {
        S.sel = new Set([id]);
      }
    } else {
      S.sel = new Set([id]);
      S.anchor = id;
    }
    applySelection();
    el.canvas.focus({ preventScroll: true });
  }

  function onCanvasDblClick(e) {
    if (e.target.closest('input, select, button')) return;
    const blk = e.target.closest('.blk[data-id]');
    if (!blk) return;
    const first = blk.querySelector('input.f:not(.f-cmt)');
    if (first) { first.focus(); first.select(); }
  }

  function flatIds() {
    const out = [];
    M.walkSeq(activeFn().body, (n) => { out.push(n.id); });
    return out;
  }

  function moveCursor(dir) {
    const ids = flatIds();
    if (!ids.length) return;
    let i = S.anchor ? ids.indexOf(S.anchor) : -1;
    i = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + dir));
    S.sel = new Set([ids[i]]);
    S.anchor = ids[i];
    applySelection();
    const b = el.zoombox.querySelector('.blk[data-id="' + ids[i] + '"]');
    if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ================================================================ Kontextmenüs

  function onCanvasContext(e) {
    if (e.target.closest('input.f, select') && !e.target.closest('.case-lbl')) return; // Textfelder: normales Menü
    const blk = e.target.closest('.blk[data-id]');
    const ph = e.target.closest('.seq-ph');
    e.preventDefault();
    if (ph) { quickInsert(ph.dataset.owner, ph.dataset.key, { x: e.clientX, y: e.clientY }); return; }
    if (!blk) {
      BBE.ui.menu([
        { label: t('ctx.paste'), icon: 'paste', key: kb('Strg+V'), disabled: !S.clipboard || isRunning(), action: pasteInternal },
        { label: t('seq.add'), icon: 'plus', disabled: isRunning(), action: () => { const fn = activeFn(); quickInsert(fn.id, 'body', { x: e.clientX, y: e.clientY }, fn.body.length); } }
      ], { x: e.clientX, y: e.clientY });
      return;
    }
    const id = blk.dataset.id;
    if (!S.sel.has(id)) { S.sel = new Set([id]); S.anchor = id; applySelection(); }
    const caseLbl = e.target.closest('.case-lbl[data-case-id]');
    openBlockMenu(nodeById(id), { x: e.clientX, y: e.clientY }, caseLbl ? caseLbl.dataset.caseId : null);
  }

  function openBlockMenu(n, anchor, caseId) {
    if (!n) return;
    const run = isRunning();
    const multi = S.sel.size > 1;
    const items = [];
    if (n.kind !== 'comment' && !multi) items.push({ label: t('ctx.comment'), icon: 'comment', disabled: run, action: () => editComment(n) });
    items.push('-',
      { label: t('ctx.duplicate'), icon: 'duplicate', key: kb('Strg+D'), disabled: run, action: duplicateSelection },
      { label: t('ctx.copy'), icon: 'copy', key: kb('Strg+C'), action: () => copySelection(false) },
      { label: t('ctx.cut'), icon: 'cut', key: kb('Strg+X'), disabled: run, action: () => copySelection(true) },
      { label: t('ctx.pasteAfter'), icon: 'paste', key: kb('Strg+V'), disabled: run || !S.clipboard, action: pasteInternal },
      '-',
      { label: t('ctx.moveUp'), icon: 'up', key: kb('Alt+↑'), disabled: run || multi, action: () => moveSelection(-1) },
      { label: t('ctx.moveDown'), icon: 'down', key: kb('Alt+↓'), disabled: run || multi, action: () => moveSelection(1) });
    if (!multi) {
      if (n.kind === 'if') {
        items.push('-', n.else
          ? { label: t('ctx.removeElse'), icon: 'x', disabled: run, action: () => mutate(() => { n.else = null; }) }
          : { label: t('ctx.addElse'), icon: 'plus', disabled: run, action: () => addElse(n) });
      }
      if (n.kind === 'switch') {
        items.push('-', { label: t('ctx.addCase'), icon: 'plus', disabled: run, action: () => addComponent('case', n.id) });
        if (caseId) items.push({ label: t('ctx.removeCase'), icon: 'x', disabled: run, action: () => mutate(() => { n.cases = n.cases.filter((c) => c.id !== caseId); }) });
        items.push(n.else
          ? { label: t('ctx.removeElse'), icon: 'x', disabled: run, action: () => mutate(() => { n.else = null; }) }
          : { label: t('ctx.addElse'), icon: 'plus', disabled: run, action: () => addElse(n) });
      }
      if (M.childSeqs(n).length) items.push({ label: t('ctx.unwrap'), icon: 'wrap', disabled: run, action: () => unwrap(n) });
    }
    items.push('-',
      { label: t('ctx.wrapIf'), icon: 'wrap', disabled: run, action: () => wrapSelection('if') },
      { label: t('ctx.wrapWhile'), icon: 'wrap', disabled: run, action: () => wrapSelection('while') });
    if (!multi && n.kind !== 'comment') {
      items.push('-',
        { label: t('ctx.breakpoint'), icon: 'dot', key: kb('F9'), action: () => toggleBreakpoint(n.id) },
        { label: t('ctx.runTo'), icon: 'runTo', disabled: S.run.state === 'running' || S.run.state === 'input', action: () => runTo(n.id) });
    }
    items.push('-', { label: t('ctx.delete'), icon: 'trash', key: kb('Entf'), danger: true, disabled: run, action: deleteSelection });
    BBE.ui.menu(items, anchor);
  }

  function editComment(n) {
    const blk = el.zoombox.querySelector('.blk[data-id="' + n.id + '"]');
    if (!blk) return;
    const wrap = blk.querySelector(':scope > .ln .cmt-wrap, :scope > .head .cmt-wrap, :scope > .foot .cmt-wrap');
    if (!wrap) return;
    wrap.classList.add('show');
    const inp = wrap.querySelector('input');
    autosize(inp);
    inp.focus();
  }

  function quickInsert(owner, key, anchor, index) {
    if (isRunning()) { toast(t('toast.locked')); return; }
    const seq = M.getSeq(S.program, owner, key);
    if (!seq) return;
    const at = index == null ? seq.length : index;
    const items = [{ title: t('seq.add') }].concat(STATEMENT_KINDS.map((kind) => ({
      label: t('pal.' + kind), kind, cat: M.CATEGORY[kind], action: () => insertNew(kind, owner, key, at)
    })));
    BBE.ui.menu(items, anchor, { grid: true });
  }

  function openExportMenu(anchor) {
    const items = [
      { label: t('exp.bb'), icon: 'save', key: kb('Strg+S'), action: saveFile },
      { label: t('exp.copyBB'), icon: 'clipboard', action: async () => { const ok = await copyText(bbText()); toast(ok ? t('toast.copied') : t('dlg.copy')); } },
      '-',
      { label: t('exp.c'), icon: 'code', action: exportC },
      { label: t('exp.cpp'), icon: 'code', action: () => exportCode('cpp') },
      { label: t('exp.cs'), icon: 'code', action: () => exportCode('cs') },
      { label: t('exp.java'), icon: 'code', action: () => exportCode('java') },
      { label: t('exp.py'), icon: 'code', action: () => exportCode('python') },
      { label: t('exp.png'), icon: 'image', action: exportPng }
    ];
    if (store.getRaw(KEY_OLD)) items.push('-', { label: t('exp.recoverOld'), icon: 'history', action: recoverOld });
    BBE.ui.menu(items, anchor);
  }

  // ================================================================ Tastatur

  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const inField = isEditable(document.activeElement);
    const inDialog = !!document.querySelector('dialog[open]');

    if (k === 'F1') { e.preventDefault(); showHelp(); return; }
    if (inDialog) return;

    if (k === 'F5' && !e.shiftKey) { e.preventDefault(); onRunButton(); return; }
    if (k === 'F5' && e.shiftKey) { e.preventDefault(); stopRun(true); return; }
    if (k === 'F10') { e.preventDefault(); stepRun(); return; }
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); if (inField) document.activeElement.blur(); saveFile(); return; }
    if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); openFile(); return; }

    if (inField) return;
    if (con && con.waiting && document.activeElement === el.ciInput) return;

    if (mod && !e.shiftKey && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
    if (mod && ((e.shiftKey && (k === 'z' || k === 'Z')) || k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (k === 'F9') { e.preventDefault(); if (S.anchor) toggleBreakpoint(S.anchor); return; }
    if (k === 'Escape') { if (S.sel.size) { S.sel.clear(); S.anchor = null; applySelection(); } return; }
    if (isRunning() && !['ArrowUp', 'ArrowDown'].includes(k)) return;

    if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSelection(); return; }
    if ((k === 'Delete' || k === 'Backspace') && S.sel.size) { e.preventDefault(); deleteSelection(); return; }
    if (e.altKey && k === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
    if (e.altKey && k === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
    if (k === 'ArrowUp' && !mod) { e.preventDefault(); moveCursor(-1); return; }
    if (k === 'ArrowDown' && !mod) { e.preventDefault(); moveCursor(1); return; }
    if (k === 'Enter' && S.anchor) {
      const blk = el.zoombox.querySelector('.blk[data-id="' + S.anchor + '"]');
      const first = blk && blk.querySelector('input.f:not(.f-cmt)');
      if (first) { e.preventDefault(); first.focus(); first.select(); }
    }
  }

  function onCopyEvent(e) {
    if (isEditable(document.activeElement) || !S.sel.size || window.getSelection().toString()) return;
    const hits = selectedHits();
    S.clipboard = JSON.stringify(hits.map((x) => x.node));
    e.clipboardData.setData('text/plain', M.clipboardPayload(hits.map((x) => x.node)));
    e.preventDefault();
    toast(t('toast.copied'));
  }

  function onCutEvent(e) {
    if (isEditable(document.activeElement) || !S.sel.size || isRunning()) return;
    const hits = selectedHits();
    S.clipboard = JSON.stringify(hits.map((x) => x.node));
    e.clipboardData.setData('text/plain', M.clipboardPayload(hits.map((x) => x.node)));
    e.preventDefault();
    deleteSelection();
  }

  function onPaste(e) {
    if (isEditable(document.activeElement) || document.querySelector('dialog[open]')) return;
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    const nodes = text ? M.clipboardNodes(text) : null;
    e.preventDefault();
    if (nodes) { pasteNodes(nodes); return; }
    // ganze .bb-Datei eingefügt?
    if (text && text.trim().startsWith('{')) {
      try { M.parseBB(text); loadFileText(text, S.fileName, null); return; } catch (err) { /* kein Diagramm */ }
    }
    pasteInternal();
  }

  // ================================================================ Unterprogramme

  function addFunction() {
    if (isRunning()) { toast(t('toast.locked')); return; }
    const base = t('fn.defaultName');
    let name = base;
    let i = 2;
    while (S.program.fns.some((f) => f.name === name)) name = base + i++;
    const fn = M.createFunction(name);
    mutate(() => { S.program.fns.push(fn); }, { tabs: true });
    S.activeFnId = fn.id;
    renderTabs();
    renderCanvas();
    const inp = el.zoombox.querySelector('input.fn-name');
    if (inp) { inp.focus(); inp.select(); }
  }

  async function deleteFunction(fn) {
    if (isRunning()) { toast(t('toast.locked')); return; }
    const res = fn.body.length || fn.params.length
      ? await BBE.ui.dialog({ t, title: t('dlg.delFnTitle', fn.name), body: t('dlg.delFnText'), actions: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.delFnOk'), value: 'ok', danger: true }] })
      : 'ok';
    if (res !== 'ok') return;
    mutate(() => {
      S.program.fns = S.program.fns.filter((f) => f !== fn);
      if (S.activeFnId === fn.id) S.activeFnId = 'main';
    }, { tabs: true });
  }

  // ================================================================ Haltepunkte

  function hasBreakpoint(id) { return S.breakpoints.has(id); }
  function toggleBreakpoint(id) {
    if (S.breakpoints.has(id)) S.breakpoints.delete(id); else S.breakpoints.add(id);
    renderCanvas();
  }

  // ================================================================ Ausführung

  function onRunButton() {
    const st = S.run.state;
    if (st === 'running') { pauseRun(); return; }
    if (st === 'paused') { continueRun(); return; }
    if (st === 'input') return;
    startRun('run');
  }

  async function startRun(mode) {
    if (isRunning()) return;
    commit();
    analyzeNow();
    if (S.analysis.count.error) {
      const res = await BBE.ui.dialog({
        t, title: t('dlg.runErrorsTitle'), body: t('dlg.runErrorsText', S.analysis.count.error),
        actions: [{ label: t('dlg.showProblems'), value: 'show' }, { label: t('dlg.runAnyway'), value: 'run', primary: true }]
      });
      if (res === 'show') { setSide('problems'); const p = S.analysis.problems.find((x) => x.sev === 'error'); if (p) revealProblem(p); return; }
      if (res !== 'run') return;
    }
    clearRunError();
    BBE.ui.closeMenu();
    const r = S.run;
    r.interp = new BBE.interp.Interpreter(S.program, {
      output: (s) => con.print(s),
      skipChecks: S.settings.skipChecks,
      breakpoints: S.breakpoints
    });
    r.gen = r.interp.run();
    r.steps = 0;
    r.hl = null;
    r.send = undefined;
    r.frames = null;
    r.atBreak = false;
    r.mode = mode;
    con.sys('▶ ' + new Date().toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    if (S.settings.side !== 'run' || S.settings.sideCollapsed) setSide('run');
    r.state = mode === 'step' ? 'paused' : 'running';
    renderCanvas();
    updateToolbar();
    if (mode === 'step') {
      advanceVisible();
      refreshRun();
    } else {
      scheduleLoop(true);
    }
  }

  function clearTimer() {
    if (S.run.timer) { clearTimeout(S.run.timer); S.run.timer = null; }
  }

  function scheduleLoop(immediate) {
    clearTimer();
    const delay = getDelay();
    S.run.timer = setTimeout(loop, immediate ? 0 : delay);
  }

  function loop() {
    S.run.timer = null;
    if (S.run.state !== 'running') return;
    const delay = getDelay();
    if (S.run.interp) { S.run.interp.changed.clear(); S.run.interp.changedElems.clear(); }
    if (delay > 0) {
      advanceVisible(true);
    } else {
      const t0 = performance.now();
      let ev;
      do { ev = advanceVisible(true); } while (S.run.state === 'running' && ev && performance.now() - t0 < 14);
    }
    refreshRun();
    if (S.run.state === 'running') S.run.timer = setTimeout(loop, delay > 0 ? delay : 0);
  }

  /** Läuft bis zum nächsten sichtbaren Schritt. Liefert das Ereignis oder null. */
  function advanceVisible(noClear) {
    const r = S.run;
    if (!r.gen) return null;
    if (!noClear && r.interp) { r.interp.changed.clear(); r.interp.changedElems.clear(); }
    r.atBreak = false;
    let ticks = 0;
    for (;;) {
      let res;
      try {
        const send = r.send;
        r.send = undefined;
        res = r.gen.next(send);
      } catch (e) {
        runFailed(e);
        return null;
      }
      if (res.done) { runFinished(); return null; }
      const ev = res.value;
      if (ev.type === 'tick') {
        if (++ticks > 20000) return ev;
        continue;
      }
      r.steps++;
      if (ev.type === 'step') {
        r.hl = { fnId: ev.fnId, nodeId: ev.nodeId, part: ev.part };
        if (ev.part === 'end') r.frames = r.interp.snapshot();
        return ev;
      }
      if (ev.type === 'break') {
        r.hl = { fnId: ev.fnId, nodeId: ev.nodeId, part: undefined };
        if (r.tempBreak === ev.nodeId) { S.breakpoints.delete(ev.nodeId); r.tempBreak = null; renderCanvas(); }
        r.atBreak = true;
        r.state = 'paused';
        clearTimer();
        return ev;
      }
      if (ev.type === 'input') {
        r.hl = { fnId: ev.fnId, nodeId: ev.nodeId, part: undefined };
        const resume = r.state;
        r.state = 'input';
        clearTimer();
        con.ask(ev.prompt, ev.numeric, ev.label, (value) => {
          if (S.run.state !== 'input') return;
          S.run.send = value;
          S.run.state = resume === 'running' ? 'running' : 'paused';
          updateToolbar();
          updateStatus();
          if (S.run.state === 'running') scheduleLoop(true);
          else { advanceVisible(); refreshRun(); }
        });
        return ev;
      }
    }
  }

  function refreshRun() {
    applyRunVisuals(true);
    renderStackPanel();
    updateToolbar();
    updateStatus();
  }

  function pauseRun() {
    if (S.run.state !== 'running') return;
    clearTimer();
    S.run.state = 'paused';
    refreshRun();
  }

  function continueRun() {
    if (S.run.state !== 'paused') return;
    S.run.state = 'running';
    S.run.atBreak = false;
    updateToolbar();
    scheduleLoop(true);
  }

  function stepRun() {
    const st = S.run.state;
    if (st === 'running' || st === 'input') return;
    if (st === 'paused') { advanceVisible(); refreshRun(); return; }
    startRun('step');
  }

  function runTo(id) {
    S.breakpoints.add(id);
    S.run.tempBreak = id;
    if (S.run.state === 'paused') continueRun();
    else if (!isRunning()) startRun('run');
    renderCanvas();
  }

  function endRun(state) {
    const r = S.run;
    clearTimer();
    if (r.gen) { try { r.gen.return(); } catch (e) { /* egal */ } }
    r.gen = null;
    r.state = state;
    r.hl = null;
    r.atBreak = false;
    if (r.tempBreak) { S.breakpoints.delete(r.tempBreak); r.tempBreak = null; }
    con.abort();
    renderTabs();
    renderCanvas();
    renderStackPanel();
    updateToolbar();
    updateStatus();
  }

  function runFinished() {
    con.sys(t('console.finished'));
    endRun('done');
  }

  function stopRun(user) {
    if (!isRunning()) return;
    S.run.frames = S.run.interp ? S.run.interp.snapshot() : null;
    con.sys(t('console.stopped'));
    endRun('idle');
  }

  function runFailed(e) {
    const r = S.run;
    const where = (e && e.where) || (r.interp && r.interp.current ? r.interp.current : null);
    let msg;
    if (e instanceof BBE.interp.RunError) msg = t(e.key, e.args);
    else { console.error(e); msg = t('rInternal', e && e.message ? e.message : String(e)); }
    r.frames = (e && e.snapshot) || (r.interp ? r.interp.snapshot() : null);
    r.error = where ? { fnId: where.fnId, nodeId: where.nodeId, part: where.part, msg } : { msg };
    con.error(t('console.error') + ': ' + msg);
    endRun('error');
    if (where && where.fnId !== S.activeFnId) setActiveFn(where.fnId, true);
    applyRunVisuals(true);
  }

  function clearRunError(visualOnly) {
    if (!S.run.error) return;
    S.run.error = null;
    if (S.run.state === 'error') S.run.state = 'idle';
    if (visualOnly) {
      el.zoombox.querySelectorAll('.rt-error').forEach((b) => b.classList.remove('rt-error'));
      el.zoombox.querySelectorAll('.rt-msg').forEach((m) => m.remove());
      updateStatus();
    }
  }

  function findRunTarget(hl) {
    if (!hl) return null;
    const fnView = el.zoombox;
    if (hl.nodeId === hl.fnId || hl.part === 'result' || hl.part === 'end') {
      if (hl.part === 'result') return fnView.querySelector('.result-row');
      if (hl.part === 'return') return fnView.querySelector('.fn-foot');
      if (hl.part === 'head') return fnView.querySelector('.fn-head');
      return null;
    }
    const blk = fnView.querySelector('.blk[data-id="' + hl.nodeId + '"]');
    if (!blk) return null;
    if (hl.part === 'head') return blk.querySelector(':scope > .head') || blk;
    if (hl.part === 'foot') return blk.querySelector(':scope > .foot') || blk;
    return blk;
  }

  function applyRunVisuals(scroll) {
    const box = el.zoombox;
    box.querySelectorAll('.is-running').forEach((x) => x.classList.remove('is-running'));
    box.querySelectorAll('.at-break').forEach((x) => x.classList.remove('at-break'));
    box.querySelectorAll('.rt-error').forEach((x) => x.classList.remove('rt-error'));
    box.querySelectorAll('.rt-msg').forEach((x) => x.remove());
    const r = S.run;
    if (isRunning() && r.hl) {
      if (r.hl.fnId !== S.activeFnId && S.settings.follow && r.hl.part !== 'end') {
        S.activeFnId = r.hl.fnId;
        S.sel.clear();
        renderTabs();
        renderCanvas();
        applyRunVisuals(scroll);
        return;
      }
      const target = r.hl.fnId === S.activeFnId ? findRunTarget(r.hl) : null;
      if (target) {
        target.classList.add('is-running');
        if (r.atBreak) (target.closest('.blk') || target).classList.add('at-break');
        if (scroll) scrollIntoViewIfNeeded(target);
      }
      el.tabs.querySelectorAll('.tab-run').forEach((d) => d.remove());
      const tab = el.tabs.querySelector('.tab[data-fn="' + r.hl.fnId + '"]');
      if (tab && !tab.querySelector('.tab-run')) tab.prepend(h('span.tab-run'));
    }
    if (r.error && r.error.fnId === S.activeFnId) {
      const target = findRunTarget({ fnId: r.error.fnId, nodeId: r.error.nodeId, part: r.error.part === 'result' ? 'result' : undefined });
      const blk = target ? (target.closest('.blk') || target) : null;
      if (blk) {
        blk.classList.add('rt-error');
        const msg = h('div.rt-msg', null, icon('error'), h('span', null, r.error.msg));
        const anchor = blk.querySelector(':scope > .head, :scope > .ln, :scope > .foot');
        if (anchor && anchor.nextSibling && !blk.classList.contains('blk-if') && !blk.classList.contains('blk-switch')) anchor.after(msg);
        else blk.appendChild(msg);
        if (scroll) scrollIntoViewIfNeeded(blk);
      }
    }
  }

  function scrollIntoViewIfNeeded(target) {
    const cr = el.canvas.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (r.top < cr.top + 30 || r.bottom > cr.bottom - 20 || r.left < cr.left || r.left > cr.right - 40) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  // ================================================================ Dateien

  /** Download im Artifact-Viewer über die downloads-Fähigkeit (erlaubt nur bestimmte Endungen). */
  let dlNs;
  async function viewerSave(name, data) {
    if (!G.claude || typeof G.claude.use !== 'function') return 'none';
    if (dlNs === undefined) { try { dlNs = await G.claude.use('downloads'); } catch (e) { dlNs = null; } }
    if (!dlNs) return 'none';
    // nur bestimmte Endungen sind im Viewer erlaubt
    const safe = name.replace(/\.bb$/, '.bb.json').replace(/\.(c|cpp|cs|java|py)$/, '.$1.txt');
    try { await dlNs.save({ filename: safe, data }); return 'saved'; } catch (e) { return e && e.code === 'declined' ? 'declined' : 'none'; }
  }

  function bbText() {
    return JSON.stringify(M.programToBB(S.program));
  }

  async function saveFile() {
    commit();
    const text = bbText();
    const name = slug(S.fileName) + '.bb';
    if (inSandboxViewer()) {
      const r = await viewerSave(name, text);
      if (r === 'none') showTextDialog(t('dlg.saveTitle'), t('dlg.saveText'), text);
      if (r !== 'saved') return;
      S.dirty = false; saveNow(); updateStatus(); toast(t('toast.saved', name));
      return;
    }
    try {
      if (S.fileHandle && S.fileHandle.createWritable) {
        const w = await S.fileHandle.createWritable();
        await w.write(text);
        await w.close();
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Blockbild', accept: { 'application/json': ['.bb'] } }] });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        S.fileHandle = handle;
        S.fileName = slug(handle.name);
        el.fileName.value = S.fileName;
        updateTitle();
      } else {
        download(name, text, 'application/json');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      download(name, text, 'application/json');
    }
    S.dirty = false;
    saveNow();
    updateStatus();
    toast(t('toast.saved', S.fileHandle ? S.fileHandle.name : name));
  }

  async function openFile() {
    if (!inSandboxViewer() && window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Blockbild', accept: { 'application/json': ['.bb', '.json'] } }, { description: 'Python', accept: { 'text/x-python': ['.py'] } }] });
        const f = await handle.getFile();
        loadFileText(await f.text(), f.name, /[.]py$/i.test(f.name) ? null : handle);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    el.fileInput.click();
  }

  /** Python-Datei übersetzen und als Blockbild laden. */
  async function loadPython(text, name) {
    let res;
    try {
      res = BBE.pyimport.convert(text, { t });
    } catch (e) {
      const msg = e instanceof BBE.pyimport.PyError ? t('dlg.pyFail', e.line || '?', t(e.key, e.args)) : t('rInternal', e.message);
      BBE.ui.dialog({ t, title: t('tb.open'), body: msg, actions: [{ label: t('dlg.ok'), value: null, primary: true }] });
      return;
    }
    if (!programIsEmpty() && S.dirty) {
      const ok = await BBE.ui.dialog({ t, title: t('dlg.newTitle'), body: t('dlg.newText'), actions: [{ label: t('dlg.cancel'), value: null }, { label: t('tb.open'), value: 'ok', primary: true }] });
      if (ok !== 'ok') return;
    }
    // .py wird nie überschrieben: Speichern legt eine neue .bb-Datei an
    loadProgram(M.programFromBB(res.bb), slug(name.replace(/[.]py$/i, '')), null, { dirty: true });
    toast(t('toast.pyLoaded', name));
    if (res.warnings.length) {
      const list = h('ul.py-warn');
      for (const w of res.warnings) list.appendChild(h('li', null, h('b', null, t('dlg.pyLine', w.line)), ' ', t(w.key, w.args)));
      BBE.ui.dialog({ t, title: t('dlg.pyTitle', name), body: [t('dlg.pyText'), list], actions: [{ label: t('dlg.ok'), value: null, primary: true }] });
    }
  }

  const looksLikePython = (text) => !/^\s*[{[]/.test(text) && /^[ \t]*(def |import |from |print\(|#|[A-Za-z_]\w*[ \t]*=|if |for |while )/m.test(text);

  async function loadFileText(text, name, handle) {
    if (/[.]py$/i.test(name || '') || (!/[.](bb|json)$/i.test(name || '') && looksLikePython(text))) {
      loadPython(text, name || 'programm.py');
      return;
    }
    let obj;
    try {
      obj = M.parseBB(text);
    } catch (e) {
      BBE.ui.dialog({ t, title: t('tb.open'), body: t('dlg.openFail'), actions: [{ label: t('dlg.ok'), value: null, primary: true }] });
      return;
    }
    if (isRunning()) stopRun();
    const subs = Object.keys(obj).filter((k) => k !== 'main');
    let mode = 'whole';
    if (subs.length && !programIsEmpty()) {
      mode = await BBE.ui.dialog({
        t, title: t('dlg.openTitle', name), body: [t('dlg.openText')],
        actions: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.openSubs'), value: 'subs' }, { label: t('dlg.openWhole'), value: 'whole', primary: true }]
      });
      if (!mode) return;
    }
    if (mode === 'subs') {
      const fns = M.functionsFromBB(obj);
      const skipped = [];
      let added = 0;
      mutate(() => {
        for (const f of fns) {
          if (S.program.fns.some((x) => x.name === f.name)) skipped.push(f.name);
          else { S.program.fns.push(f); added++; }
        }
      }, { tabs: true });
      toast(t('dlg.imported', added) + (skipped.length ? ' · ' + t('dlg.importSkipped', skipped.join(', ')) : ''), { ms: 4500 });
      return;
    }
    loadProgram(M.programFromBB(obj), slug(name), handle);
  }

  function loadProgram(program, fileName, handle, opts = {}) {
    if (isRunning()) endRun('idle');
    S.program = program;
    S.activeFnId = 'main';
    S.sel.clear();
    S.anchor = null;
    S.breakpoints.clear();
    S.fileName = fileName || 'blockbild';
    S.fileHandle = handle || null;
    S.dirty = !!opts.dirty;
    S.run.frames = null;
    S.run.error = null;
    S.run.state = 'idle';
    if (el.fileName) el.fileName.value = S.fileName;
    resetHistory();
    renderAll();
    analyzeNow();
    saveNow();
    el.canvas.scrollTo({ top: 0, left: 0 });
  }

  async function newDiagram() {
    if (!programIsEmpty()) {
      const res = await BBE.ui.dialog({ t, title: t('dlg.newTitle'), body: t('dlg.newText'), actions: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.newOk'), value: 'ok', primary: true }] });
      if (res !== 'ok') return;
    }
    loadProgram(M.createProgram(), 'blockbild', null);
  }

  function recoverOld() {
    const raw = store.getRaw(KEY_OLD);
    if (!raw) return;
    try {
      loadProgram(M.programFromBB(M.parseBB(raw)), 'blockbild', null, { dirty: true });
      toast(t('toast.oldRecovered'));
    } catch (e) {
      toast(t('dlg.openFail'));
    }
  }

  /** Quelltext als Datei: .c, .java (Dateiname = Klassenname) oder .py */
  async function exportCode(lang) {
    const code = currentCode(lang);
    const L = CODE_LANGS.find((x) => x.id === lang) || CODE_LANGS[0];
    const ext = L.ext;
    const name = (lang === 'java' || lang === 'cs' ? javaClass() : slug(S.fileName)) + ext;
    if (inSandboxViewer()) {
      const r = await viewerSave(name, code);
      if (r === 'none') showTextDialog(t('side.code'), t('dlg.saveText').replace('.bb', ext), code);
      return;
    }
    download(name, code, L.mime + ';charset=utf-8');
  }
  const exportC = () => exportCode('c');

  function showTextDialog(title, text, content) {
    const ta = h('textarea', { readonly: true, spellcheck: 'false' });
    ta.value = content;
    BBE.ui.dialog({
      t, title, body: [text, ta],
      actions: [{ label: t('dlg.close'), value: null }, { label: t('dlg.copy'), value: 'copy', primary: true }],
      onClose: async (v) => { if (v === 'copy') { const ok = await copyText(content); toast(ok ? t('toast.copied') : t('dlg.copy')); } },
      onOpen: () => { ta.focus(); ta.select(); }
    });
  }

  /** Diagramm als PNG: statische Darstellung in ein SVG (foreignObject) und dann auf ein Canvas. */
  async function exportPng() {
    const fn = activeFn();
    const R = { t, app: API, program: S.program, fn, static: true };
    const view = BBE.render.renderFunction(R, fn);
    const wrap = h('div.export-root', null, view);
    const holder = h('div', { style: { position: 'fixed', left: '-10000px', top: '0' } }, wrap);
    holder.setAttribute('data-theme', 'light');
    document.body.appendChild(holder);
    const rect = wrap.getBoundingClientRect();
    const w = Math.ceil(rect.width) + 2;
    const hgt = Math.ceil(rect.height) + 2;
    const css = exportCss();
    const xhtml = new XMLSerializer().serializeToString(wrap);
    holder.remove();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + hgt + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml"><style>' + css.replace(/<\/style/gi, '') + '</style>' + xhtml + '</div>' +
      '</foreignObject></svg>';
    const img = new Image();
    img.decoding = 'sync';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const scale = 2;
      const canvas = h('canvas', { width: w * scale, height: hgt * scale });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      const name = slug(S.fileName) + (fn.isMain ? '' : '-' + fn.name) + '.png';
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (inSandboxViewer() && (await viewerSave(name, blob)) !== 'none') return;
      if (inSandboxViewer()) {
        BBE.ui.dialog({ t, title: t('dlg.imageTitle'), wide: true, body: [t('dlg.imageText'), h('img.export-img', { src: dataUrl, alt: name })], actions: [{ label: t('dlg.close'), value: null, primary: true }] });
      } else {
        download(name, blob);
      }
    } catch (e) {
      console.error(e);
      toast(t('toast.imageFail'));
    }
  }

  function exportCss() {
    let out = '';
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(rules)) {
        if (rule.media && /prefers-color-scheme/.test(rule.media.mediaText)) continue;
        if (rule.selectorText && /data-theme="dark"/.test(rule.selectorText)) continue;
        if (rule.media && /max-width|reduced-motion/.test(rule.media.mediaText)) continue;
        out += rule.cssText + '\n';
      }
    }
    return out;
  }

  // ================================================================ Dialoge: Beispiele, Einstellungen, Hilfe

  function showExamples() {
    const list = h('div.ex-list');
    let choose;
    for (const ex of BBE.examples.list) {
      const lang = I18N.lang === 'en' ? 'en' : 'de';
      const card = h('button.ex-card', { type: 'button' },
        h('span.ex-title', null, ex.title[lang]),
        h('span.ex-desc', null, ex.desc[lang]),
        h('span.ex-meta', null, h('span.lvl', { 'aria-label': 'Level ' + ex.level }, [1, 2, 3, 4].map((i) => h('i' + (i <= ex.level ? '.on' : ''))))));
      card.addEventListener('click', () => choose(ex.id));
      list.appendChild(card);
    }
    BBE.ui.dialog({
      t, title: t('dlg.examplesTitle'), wide: true, body: [t('dlg.examplesText'), list],
      onOpen: (dlg, done) => { choose = (id) => done(id); }, noAutofocus: true
    }).then(async (id) => {
      if (!id) return;
      const ex = BBE.examples.list.find((e) => e.id === id);
      const lang = I18N.lang === 'en' ? 'en' : 'de';
      if (S.dirty && !programIsEmpty()) {
        const ok = await BBE.ui.dialog({ t, title: t('dlg.exampleTitle'), body: t('dlg.exampleText', ex.title[lang]), actions: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.exampleOk'), value: 'ok', primary: true }] });
        if (ok !== 'ok') return;
      }
      loadExample(id);
      toast(t('toast.exampleLoaded', ex.title[lang]));
    });
  }

  function loadExample(id) {
    const ex = BBE.examples.list.find((e) => e.id === id);
    const lang = I18N.lang === 'en' ? 'en' : 'de';
    loadProgram(M.programFromBB(BBE.examples.build(id, lang)), slug((lang === 'en' ? 'example-' : 'beispiel-') + ex.id), null);
  }

  function showSettings() {
    const s = S.settings;
    const radio = (name, value, label, checked, onChange) => {
      const inp = h('input', { type: 'radio', name, value, checked });
      inp.addEventListener('change', () => { if (inp.checked) onChange(value); });
      return h('label', null, inp, h('span', null, label));
    };
    const check = (id, label, small, checked, onChange) => {
      const inp = h('input', { type: 'checkbox', id, checked });
      inp.addEventListener('change', () => onChange(inp.checked));
      return h('label.check', { for: id }, inp, h('span', null, label, small ? h('small', null, small) : null));
    };
    const body = h('div.set-list', null,
      h('div.set-row', null, h('span.set-label', null, t('set.language')),
        h('div.seg', null,
          radio('lang', 'de', 'Deutsch', s.lang === 'de', (v) => setLanguage(v)),
          radio('lang', 'en', 'English', s.lang === 'en', (v) => setLanguage(v)))),
      h('div.set-row', null, h('span.set-label', null, t('set.theme')),
        h('div.seg', null,
          radio('theme', 'system', t('set.theme.system'), s.theme === 'system', (v) => { s.theme = v; saveSettings(); applyTheme(); }),
          radio('theme', 'light', t('set.theme.light'), s.theme === 'light', (v) => { s.theme = v; saveSettings(); applyTheme(); }),
          radio('theme', 'dark', t('set.theme.dark'), s.theme === 'dark', (v) => { s.theme = v; saveSettings(); applyTheme(); }))),
      h('div.set-row', null, h('span.set-label', null, t('set.layout')),
        h('div.seg', null,
          radio('layout', 'bb', t('set.layout.bb'), s.layout !== 'ns', (v) => { s.layout = v; saveSettings(); renderCanvas(); }),
          radio('layout', 'ns', t('set.layout.ns'), s.layout === 'ns', (v) => { s.layout = v; saveSettings(); renderCanvas(); }))),
      check('set-colors', t('set.colors'), t('set.colors.d'), s.colors, (v) => { s.colors = v; saveSettings(); renderCanvas(); }),
      check('set-addr', t('set.addresses'), null, s.addresses, (v) => { s.addresses = v; saveSettings(); renderStackPanel(); }),
      check('set-skip', t('set.skipChecks'), null, s.skipChecks, (v) => { s.skipChecks = v; saveSettings(); if (S.run.interp) S.run.interp.skipChecks = v; }),
      check('set-follow', t('set.follow'), null, s.follow, (v) => { s.follow = v; saveSettings(); }),
      aboutBlock(),
      h('p.set-foot', null, t('set.version', VERSION) + ' · ' + t('set.compat')));
    BBE.ui.dialog({ t, title: t('set.title'), body, actions: [{ label: t('dlg.close'), value: null, primary: true }] });
  }

  function aboutBlock() {
    return h('section.about', { 'aria-label': t('about.title') },
      h('h3', null, t('about.title')),
      h('p', null, t('about.credit')),
      h('p', null, t('about.thanks')),
      h('a', { href: 'https://github.com/eggers97/block-diagram-editor', target: '_blank', rel: 'noopener' }, t('about.original') + ' ↗'));
  }

  function setLanguage(lang) {
    S.settings.lang = lang;
    I18N.lang = lang;
    saveSettings();
    document.documentElement.lang = lang;
    const dlg = document.querySelector('dialog[open]');
    if (dlg) dlg.querySelector('.dlg-head .x-btn').click();
    buildShell();
    renderAll();
    analyzeNow();
    showSettings();
  }

  function showHelp() {
    const html = BBE.help && BBE.help[I18N.lang === 'en' ? 'en' : 'de'];
    const body = h('div.help');
    body.innerHTML = html || '';
    const about = aboutBlock();
    about.id = 'h-about';
    const navAbout = h('a', { href: '#h-about' }, t('about.title'));
    const nav = body.querySelector('nav');
    if (nav) nav.appendChild(navAbout);
    const content = body.querySelector(':scope > div');
    if (content) content.appendChild(about);
    body.addEventListener('click', (e) => {
      const a = e.target.closest('nav a');
      if (!a) return;
      e.preventDefault();
      const sec = body.querySelector(a.getAttribute('href'));
      if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    BBE.ui.dialog({ t, title: t('help.title'), wide: true, body, actions: [{ label: t('dlg.close'), value: null, primary: true }] });
  }

  // ================================================================ Schnittstelle für Darstellung und Ziehen

  const API = {
    t,
    get settings() { return S.settings; },
    fieldInput, fieldCommit, changeDeclType, changeReturnType, renameFunctionLive,
    addParam, removeParam, toggleParamDir, changeParamType, changeCallTarget, addElse,
    quickInsert, hasBreakpoint, toggleBreakpoint,
    isRunning, nodeById,
    dragIds(id) {
      if (S.sel.has(id) && S.sel.size > 1) {
        const hits = selectedHits();
        const own = hits.find((x) => x.node.id === id);
        if (own) return hits.filter((x) => x.seq === own.seq).map((x) => x.node.id);
      }
      return [id];
    },
    closePopups() { BBE.ui.closeMenu(); },
    componentHint, addComponent, insertNew, moveNodes,
    deleteIds(ids) {
      S.sel = new Set(ids);
      S.anchor = ids[ids.length - 1];
      deleteSelection();
    },
    selectionIds() { return Array.from(S.sel); },
    setSelection(ids) {
      const same = ids.length === S.sel.size && ids.every((id) => S.sel.has(id));
      if (same) return;
      S.sel = new Set(ids);
      S.anchor = ids.length ? ids[ids.length - 1] : null;
      applySelection();
    }
  };

  // ================================================================ Start

  /** iOS zoomt beim Antippen kleiner Eingabefelder hinein – verhindern (Pinch-Zoom bleibt möglich). */
  function preventIosInputZoom() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios) return;
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
    const content = meta.getAttribute('content') || 'width=device-width, initial-scale=1, viewport-fit=cover';
    if (!/maximum-scale/.test(content)) meta.setAttribute('content', content + ', maximum-scale=1');
  }

  function boot() {
    preventIosInputZoom();
    if (S.settings.sideCollapsed === undefined && window.innerWidth <= 560) S.settings.sideCollapsed = true;
    applyTheme();
    document.documentElement.lang = I18N.lang;
    buildShell();
    bindGlobal();

    const saved = store.get(KEY_AUTOSAVE, null);
    let restored = false;
    if (saved && saved.bb) {
      try {
        S.program = M.programFromBB(saved.bb);
        S.fileName = saved.fileName || 'blockbild';
        S.dirty = !!saved.dirty;
        const fn = S.program.fns.find((f) => f.name === saved.active);
        if (fn) S.activeFnId = fn.id;
        restored = true;
      } catch (e) { restored = false; }
    }
    if (!restored) {
      const lang = I18N.lang === 'en' ? 'en' : 'de';
      S.program = M.programFromBB(BBE.examples.build('loops', lang));
      S.fileName = (lang === 'en' ? 'example-' : 'beispiel-') + 'loops';
    }
    el.fileName.value = S.fileName;
    resetHistory();
    renderAll();
    analyzeNow();
  }

  BBE.app = { boot, state: S, api: API };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
