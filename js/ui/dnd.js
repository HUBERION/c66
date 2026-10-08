/* Blockbild-Editor – Ziehen und Ablegen mit Pointer-Events (Maus, Stift, Touch per langem Drücken) */
(function (G) {
  'use strict';
  const BBE = G.BBE = G.BBE || {};

  const MOVE_THRESHOLD = 5;
  const TOUCH_DELAY = 360;
  const EDGE = 48;

  function init(opts) {
    const { app, getCanvas } = opts;
    let canvas = getCanvas();
    let pending = null;   // gedrückt, aber noch nicht gezogen
    let drag = null;      // laufender Ziehvorgang
    let suppressClick = false;
    let line = null;

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', (e) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) cancel(); });
    document.addEventListener('touchmove', (e) => { if (drag && e.cancelable) e.preventDefault(); }, { passive: false });
    // Android öffnet bei langem Drücken das Kontextmenü – während des Ziehens unterdrücken
    document.addEventListener('contextmenu', (e) => {
      if (drag || (pending && pending.type === 'touch')) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    function sourceOf(target) {
      if (!(target instanceof Element)) return null;
      if (target.closest('input, select, textarea, button:not(.pal-item), .param, .fn-head, .menu, dialog, .bp-dot')) return null;
      const pal = target.closest('.pal-item');
      if (pal) return { type: 'new', kind: pal.dataset.kind, el: pal };
      const blk = target.closest('.canvas .blk[data-id]');
      if (blk && !app.isRunning()) return { type: 'move', id: blk.dataset.id, el: blk };
      return null;
    }

    function onDown(e) {
      if (e.button !== 0 || drag) return;
      const src = sourceOf(e.target);
      if (!src) return;
      canvas = getCanvas();
      pending = { src, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, timer: null };
      if (e.pointerType === 'touch') {
        pending.timer = setTimeout(() => {
          if (pending) {
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* egal */ } }
            begin(pending.x, pending.y);
          }
        }, TOUCH_DELAY);
      }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    }

    function onMove(e) {
      if (pending && e.pointerId === pending.pointerId && !drag) {
        const dx = e.clientX - pending.x, dy = e.clientY - pending.y;
        const dist = Math.hypot(dx, dy);
        if (pending.type === 'touch') {
          if (dist > 10) clearPending();
          return;
        }
        if (dist > MOVE_THRESHOLD) begin(e.clientX, e.clientY);
      }
      if (drag && e.pointerId === drag.pointerId) {
        e.preventDefault();
        drag.x = e.clientX;
        drag.y = e.clientY;
        moveGhost();
        updateTarget();
      }
    }

    function onUp(e) {
      if (drag && e.pointerId === drag.pointerId) {
        drop(e.ctrlKey || e.metaKey || e.altKey);
      }
      clearPending();
    }

    function onCancel(e) {
      if (drag && e.pointerId === drag.pointerId) cancel();
      clearPending();
    }

    function clearPending() {
      if (pending && pending.timer) clearTimeout(pending.timer);
      pending = null;
      if (!drag) detach();
    }

    function detach() {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    }

    function begin(x, y) {
      const src = pending.src;
      let ids = null;
      let kind = src.kind;
      if (src.type === 'move') {
        ids = app.dragIds(src.id);
        const n = app.nodeById(ids[0]);
        kind = n ? n.kind : 'decl';
      }
      if (pending.timer) clearTimeout(pending.timer);
      drag = { src, ids, kind, pointerId: pending.pointerId, x, y, target: null, isComponent: BBE.model.COMPONENTS.includes(kind) };
      pending = null;
      drag.ghost = BBE.render.ghost({ t: app.t }, kind, ids ? ids.length : 1);
      document.body.appendChild(drag.ghost);
      document.body.classList.add('is-dragging');
      if (ids) ids.forEach((id) => { const el = canvas.querySelector('.blk[data-id="' + id + '"]'); if (el) el.classList.add('dragging-src'); });
      app.closePopups();
      moveGhost();
      updateTarget();
      tickScroll();
    }

    function moveGhost() {
      drag.ghost.style.left = drag.x + 'px';
      drag.ghost.style.top = drag.y + 'px';
    }

    function clearMarks() {
      if (line) { line.remove(); line = null; }
      canvas.querySelectorAll('.drop-zone').forEach((el) => el.classList.remove('drop-zone'));
      canvas.querySelectorAll('.drop-target-comp').forEach((el) => el.classList.remove('drop-target-comp'));
    }

    function updateTarget() {
      clearMarks();
      drag.target = null;
      const el = document.elementFromPoint(drag.x, drag.y);
      if (!el || !canvas.contains(el)) return;

      if (drag.isComponent) {
        const blk = el.closest('.blk-if, .blk-switch');
        if (!blk) return;
        const node = app.nodeById(blk.dataset.id);
        if (!node) return;
        const ok = drag.kind === 'case' ? node.kind === 'switch' : !node.else;
        if (!ok) return;
        blk.classList.add('drop-target-comp');
        drag.target = { comp: node.id };
        return;
      }

      let seqEl = el.closest('.seq');
      if (!seqEl) {
        // neben dem Diagramm: an den Anfang oder ans Ende des Hauptablaufs
        seqEl = canvas.querySelector('.seq.root');
        if (!seqEl) return;
      }
      if (drag.ids && drag.ids.some((id) => { const b = canvas.querySelector('.blk[data-id="' + id + '"]'); return b && b.contains(seqEl); })) return;

      const kids = Array.from(seqEl.children).filter((c) => c.classList.contains('blk'));
      let index = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (drag.y < r.top + r.height / 2) { index = i; break; }
      }
      drag.target = { owner: seqEl.dataset.owner, key: seqEl.dataset.key, index };

      if (!kids.length) {
        seqEl.classList.add('drop-zone');
        return;
      }
      const cr = canvas.getBoundingClientRect();
      const sr = seqEl.getBoundingClientRect();
      let y;
      if (index < kids.length) y = kids[index].getBoundingClientRect().top;
      else y = kids[kids.length - 1].getBoundingClientRect().bottom;
      line = document.createElement('div');
      line.className = 'drop-line';
      line.style.left = (sr.left - cr.left + canvas.scrollLeft + 4) + 'px';
      line.style.width = Math.max(30, sr.width - 8) + 'px';
      line.style.top = (y - cr.top + canvas.scrollTop - 2) + 'px';
      canvas.appendChild(line);
    }

    function tickScroll() {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (drag.x > r.left && drag.x < r.right) {
        if (drag.y < r.top + EDGE && drag.y > r.top - 40) dy = -Math.ceil((r.top + EDGE - drag.y) / 4);
        else if (drag.y > r.bottom - EDGE && drag.y < r.bottom + 40) dy = Math.ceil((drag.y - (r.bottom - EDGE)) / 4);
      }
      if (drag.y > r.top && drag.y < r.bottom) {
        if (drag.x < r.left + EDGE && drag.x > r.left - 20) dx = -Math.ceil((r.left + EDGE - drag.x) / 4);
        else if (drag.x > r.right - EDGE && drag.x < r.right + 20) dx = Math.ceil((drag.x - (r.right - EDGE)) / 4);
      }
      if (dx || dy) {
        canvas.scrollLeft += dx;
        canvas.scrollTop += dy;
        updateTarget();
      }
      drag.raf = requestAnimationFrame(tickScroll);
    }

    function finish() {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      drag.ghost.remove();
      document.body.classList.remove('is-dragging');
      canvas.querySelectorAll('.dragging-src').forEach((el) => el.classList.remove('dragging-src'));
      clearMarks();
      drag = null;
      detach();
    }

    function cancel() {
      finish();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }

    function drop(copy) {
      const d = drag;
      finish();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (!d.target) {
        if (d.isComponent) app.componentHint(d.kind);
        return;
      }
      if (d.target.comp) { app.addComponent(d.kind, d.target.comp); return; }
      const { owner, key, index } = d.target;
      if (d.src.type === 'new') app.insertNew(d.kind, owner, key, index);
      else app.moveNodes(d.ids, owner, key, index, copy);
    }

    return { isDragging: () => !!drag };
  }

  BBE.dnd = { init };
})(window);
