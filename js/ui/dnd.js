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
    let trash = null;     // Lösch-Zone über dem Baukasten
    let mq = null;        // Auswahlrahmen

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
      if (!src) { marqueeStart(e); return; }
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
      if (src.type === 'move') showTrash();
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

    function showTrash() {
      const pal = document.querySelector('.palette');
      if (!pal) return;
      const r = pal.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return;
      trash = document.createElement('div');
      trash.className = 'trash-zone';
      trash.style.left = r.left + 'px';
      trash.style.top = r.top + 'px';
      trash.style.width = r.width + 'px';
      trash.style.height = r.height + 'px';
      trash.appendChild(BBE.icons.icon('trash'));
      const txt = document.createElement('span');
      txt.textContent = app.t('dnd.trash');
      trash.appendChild(txt);
      document.body.appendChild(trash);
      requestAnimationFrame(() => trash && trash.classList.add('on'));
    }

    function overTrash() {
      if (!trash) return false;
      const r = trash.getBoundingClientRect();
      return drag.x >= r.left && drag.x <= r.right && drag.y >= r.top && drag.y <= r.bottom;
    }

    function updateTarget() {
      clearMarks();
      drag.target = null;
      const hot = overTrash();
      if (trash) trash.classList.toggle('hot', hot);
      drag.ghost.classList.toggle('to-trash', hot);
      if (hot) { drag.target = { trash: true }; return; }
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
      if (trash) { const tz = trash; trash = null; tz.classList.remove('on'); setTimeout(() => tz.remove(), 160); }
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
      if (d.target.trash) { app.deleteIds(d.ids); return; }
      if (d.target.comp) { app.addComponent(d.kind, d.target.comp); return; }
      const { owner, key, index } = d.target;
      if (d.src.type === 'new') app.insertNew(d.kind, owner, key, index);
      else app.moveNodes(d.ids, owner, key, index, copy);
    }

    // ---------------------------------------------------------------- Auswahlrahmen (wie im Explorer)

    function marqueeStart(e) {
      const t = e.target;
      if (e.pointerType === 'touch' || !(t instanceof Element)) return false;
      canvas = getCanvas();
      if (!canvas.contains(t)) return false;
      if (t.closest('.blk, .fn-head, .canvas-tools, input, select, button, textarea, .sel-bar, .menu')) return false;
      const cr = canvas.getBoundingClientRect();
      // nicht auf den Scrollleisten starten
      if (e.clientX > cr.left + canvas.clientWidth || e.clientY > cr.top + canvas.clientHeight) return false;
      mq = {
        pointerId: e.pointerId, x: e.clientX, y: e.clientY,
        x0: e.clientX - cr.left + canvas.scrollLeft, y0: e.clientY - cr.top + canvas.scrollTop,
        additive: e.ctrlKey || e.metaKey || e.shiftKey, base: app.selectionIds(), box: null, raf: 0
      };
      window.addEventListener('pointermove', mqMove, true);
      window.addEventListener('pointerup', mqUp, true);
      window.addEventListener('pointercancel', mqUp, true);
      return true;
    }

    function mqMove(e) {
      if (!mq || e.pointerId !== mq.pointerId) return;
      mq.x = e.clientX;
      mq.y = e.clientY;
      if (!mq.box) {
        const cr = canvas.getBoundingClientRect();
        if (Math.hypot(mq.x - (mq.x0 + cr.left - canvas.scrollLeft), mq.y - (mq.y0 + cr.top - canvas.scrollTop)) < 4) return;
        mq.box = document.createElement('div');
        mq.box.className = 'marquee';
        canvas.appendChild(mq.box);
        document.body.classList.add('is-selecting');
        app.closePopups();
        mqTick();
      }
      e.preventDefault();
      mqUpdate();
    }

    function mqRect() {
      const cr = canvas.getBoundingClientRect();
      const x1 = mq.x - cr.left + canvas.scrollLeft, y1 = mq.y - cr.top + canvas.scrollTop;
      return { left: Math.min(mq.x0, x1), top: Math.min(mq.y0, y1), right: Math.max(mq.x0, x1), bottom: Math.max(mq.y0, y1), cr };
    }

    function mqUpdate() {
      const r = mqRect();
      Object.assign(mq.box.style, { left: r.left + 'px', top: r.top + 'px', width: (r.right - r.left) + 'px', height: (r.bottom - r.top) + 'px' });
      // in Bildschirmkoordinaten vergleichen
      const sx = r.cr.left - canvas.scrollLeft, sy = r.cr.top - canvas.scrollTop;
      const box = { left: r.left + sx, top: r.top + sy, right: r.right + sx, bottom: r.bottom + sy };
      const hits = [];
      const visit = (seqEl) => {
        for (const blk of seqEl.children) {
          if (!blk.classList.contains('blk') || !blk.dataset.id) continue;
          const b = blk.getBoundingClientRect();
          const meets = b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top;
          if (!meets) continue;
          const inside = b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom;
          const inner = blk.querySelectorAll(':scope > .seq');
          // ganz umrahmt oder einfacher Block → auswählen; sonst in die Zweige schauen
          if (inside || !inner.length) hits.push(blk.dataset.id);
          else inner.forEach(visit);
        }
      };
      canvas.querySelectorAll('.seq.root').forEach(visit);
      const ids = mq.additive ? Array.from(new Set(mq.base.concat(hits))) : hits;
      app.setSelection(ids);
    }

    function mqTick() {
      if (!mq || !mq.box) return;
      const r = canvas.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (mq.y < r.top + EDGE) dy = -Math.ceil((r.top + EDGE - mq.y) / 5);
      else if (mq.y > r.bottom - EDGE) dy = Math.ceil((mq.y - (r.bottom - EDGE)) / 5);
      if (mq.x < r.left + EDGE) dx = -Math.ceil((r.left + EDGE - mq.x) / 5);
      else if (mq.x > r.right - EDGE) dx = Math.ceil((mq.x - (r.right - EDGE)) / 5);
      if (dx || dy) { canvas.scrollLeft += dx; canvas.scrollTop += dy; mqUpdate(); }
      mq.raf = requestAnimationFrame(mqTick);
    }

    function mqUp(e) {
      if (!mq || e.pointerId !== mq.pointerId) return;
      window.removeEventListener('pointermove', mqMove, true);
      window.removeEventListener('pointerup', mqUp, true);
      window.removeEventListener('pointercancel', mqUp, true);
      cancelAnimationFrame(mq.raf);
      if (mq.box) {
        const box = mq.box;
        box.classList.add('out');
        setTimeout(() => box.remove(), 140);
        document.body.classList.remove('is-selecting');
        // der folgende Klick auf die Fläche würde die Auswahl wieder aufheben
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        canvas.focus({ preventScroll: true });
      }
      mq = null;
    }

    return { isDragging: () => !!drag };
  }

  BBE.dnd = { init };
})(window);
