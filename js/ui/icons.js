/* Blockbild-Editor – Symbole (inline SVG) */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  // 24er-Raster, Strichsymbole
  const P = {
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
    step: '<path d="M5 5v14l9-7z"/><path d="M18 5v14"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    open: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    newfile: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    paste: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    duplicate: '<rect width="12" height="12" x="9" y="9" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/><path d="M15 12v6M12 15h6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    stack: '<rect x="3" y="3.5" width="18" height="5" rx="1.2"/><rect x="3" y="10" width="18" height="5" rx="1.2"/><rect x="3" y="16.5" width="18" height="5" rx="1.2"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowDown: '<path d="M12 4v16"/><path d="m18 14-6 6-6-6"/>',
    arrowUpDown: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    arrowUp: '<path d="M12 20V4"/><path d="m6 10 6-6 6 6"/>',
    dot: '<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    lock: '<rect width="16" height="10" x="4" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    wrap: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="9" width="10" height="9" rx="1"/>',
    home: '<path d="m3 10.5 9-7.5 9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    runTo: '<path d="M5 12h10"/><path d="m11 6 6 6-6 6"/><path d="M20 4v16"/>'
  };

  // Mini-Struktogramme für die Bausteine (Raster 20)
  const K = {
    decl: '<rect x="2.5" y="5" width="15" height="10" rx="1"/><path d="M6 10h2.5M11 8.5v3M9.5 10h3"/>',
    assign: '<rect x="2.5" y="5" width="15" height="10" rx="1"/><path d="M6.5 9h7M6.5 11.5h7"/>',
    input: '<rect x="6" y="5" width="11.5" height="10" rx="1"/><path d="M1.5 10h7.5M6.5 7.5 9 10l-2.5 2.5"/>',
    output: '<rect x="2.5" y="5" width="11.5" height="10" rx="1"/><path d="M11 10h7.5M16 7.5l2.5 2.5-2.5 2.5"/>',
    if: '<rect x="2.5" y="3" width="15" height="14" rx="1"/><path d="M2.5 3 10 9.5 17.5 3M2.5 9.5h15M10 9.5V17"/>',
    else: '<rect x="2.5" y="3" width="15" height="14" rx="1"/><path d="M2.5 9.5h15M10 9.5V17"/><path d="M10.5 10h7v7h-7z" fill="currentColor" stroke="none" opacity=".35"/>',
    switch: '<rect x="2.5" y="3" width="15" height="14" rx="1"/><path d="M2.5 3 13 9.5M2.5 9.5h15M7.5 9.5V17M12.5 9.5V17"/>',
    case: '<rect x="2.5" y="3" width="15" height="14" rx="1"/><path d="M2.5 9.5h15M7.5 9.5V17M12.5 9.5V17"/><path d="M8 10h4.5v7H8z" fill="currentColor" stroke="none" opacity=".35"/>',
    while: '<path d="M2.5 3h15v5H7v9H2.5z"/><rect x="7" y="8" width="10.5" height="9"/>',
    for: '<path d="M2.5 3h15v5H7v9H2.5z"/><rect x="7" y="8" width="10.5" height="9"/><path d="M10 5.5h5"/>',
    until: '<path d="M2.5 3H7v9h10.5v5h-15z"/><rect x="7" y="3" width="10.5" height="9"/>',
    call: '<rect x="2.5" y="5" width="15" height="10" rx="1"/><path d="M5.5 5v10M14.5 5v10"/>',
    comment: '<path d="M7.5 5 4.5 15M12 5 9 15"/><path d="M13 9h4.5M13 12h3"/>'
  };

  const NS = 'http://www.w3.org/2000/svg';

  function icon(name, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = P[name] || '';
    return svg;
  }

  function kindIcon(kind) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = K[kind] || '';
    return svg;
  }

  function brandMark() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('class', 'brand-mark');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
      '<rect x="1" y="1" width="30" height="30" rx="7" fill="var(--accent)"/>' +
      '<g fill="none" stroke="var(--accent-ink)" stroke-width="1.6" stroke-linejoin="round">' +
      '<rect x="6.5" y="6.5" width="19" height="19" rx="1"/>' +
      '<path d="M6.5 11.5h19M6.5 11.5l9.5 6 9.5-6M16 17.5v8M6.5 17.5h19"/></g>';
    return svg;
  }

  BBE.icons = { icon, kindIcon, brandMark, P, K };
})(window);
