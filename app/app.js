/* uni-pdf: a PDF reader with a notes panel and text-anchored notes.
 * Everything is stored locally in IndexedDB (PDF files + notes). */
(() => {
  'use strict';

  const pdfjsLib = window.pdfjsLib;
  const WORKER_SRC = 'vendor/pdf.worker.min.js';
  const COLORS = ['yellow', 'green', 'blue', 'pink'];
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 5;
  const MAX_RENDERED_PAGES = 14;
  const VERSION = '1.0.0';

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isTyping = (t) => t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'button') || t.isContentEditable);
  const fmtTime = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  const baseName = (name) => name.replace(/\.pdf$/i, '');

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:*?"<>|]+/g, '_');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  let toastTimer;
  // toast(msg, ms, {label, run}) shows an optional action button (e.g. Undo).
  function toast(msg, ms = 2200, action) {
    const t = $('#toast');
    const btn = $('#toastAction');
    $('#toastMsg').textContent = msg;
    btn.hidden = !action;
    btn.onclick = null;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = () => { t.hidden = true; action.run(); };
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ storage
  const DB = {
    db: null,
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('lecture-pdf-notes', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('docs', { keyPath: 'id' });
          db.createObjectStore('files');
        };
        req.onsuccess = () => { this.db = req.result; resolve(); };
        req.onerror = () => reject(req.error);
      });
    },
    req(store, mode, fn) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    get(store, key) { return this.req(store, 'readonly', (s) => s.get(key)); },
    put(store, val, key) { return this.req(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))); },
    del(store, key) { return this.req(store, 'readwrite', (s) => s.delete(key)); },
    all(store) { return this.req(store, 'readonly', (s) => s.getAll()); },
  };

  // ------------------------------------------------------------------ state
  const S = {
    doc: null,          // persisted record: {id, name, numPages, docNote, pageNotes, annotations, ...}
    pdf: null,          // pdf.js document
    pages: [],          // per-page view state
    zoom: 'fit',        // 'fit' or a number
    scale: 1,
    currentPage: 1,
    sbPage: 1,          // page shown in the "This page" panel
    activeId: null,
    tab: 'page',
    areaMode: false,
    pendingRange: null, // text selection waiting for the toolbar
    visible: new Set(),
  };

  // ------------------------------------------------------------------ saving
  let saveTimer = null;
  function scheduleSave() {
    if (!S.doc) return;
    $('#saveState').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!S.doc) return;
    try {
      await DB.put('docs', S.doc);
      $('#saveState').textContent = 'Saved ✓';
    } catch (err) {
      console.error(err);
      $('#saveState').textContent = 'Save failed!';
      toast('Could not save notes: ' + err.message, 5000);
    }
  }

  // ------------------------------------------------------------------ opening files
  async function docIdFor(buf, file) {
    try {
      if (window.crypto && crypto.subtle) {
        const h = await crypto.subtle.digest('SHA-256', buf);
        return 'sha-' + Array.from(new Uint8Array(h).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) { /* fall through */ }
    return 'f-' + file.name + '-' + file.size;
  }

  async function importFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      toast('That is not a PDF file.');
      return;
    }
    let buf = await file.arrayBuffer();
    let name = file.name;
    // An "Editable PDF" export carries the original slides + notes inside it.
    const embedded = await readEmbeddedNotes(buf);
    if (embedded) {
      buf = embedded.original;
      name = embedded.notes.name || name;
    }
    const id = await docIdFor(buf, { name, size: buf.byteLength });
    if (embedded && S.doc && S.doc.id === id) { await flushSave(); await closeDoc(); }
    let rec = await DB.get('docs', id);
    if (!rec) {
      rec = {
        id,
        name,
        size: buf.byteLength,
        addedAt: Date.now(),
        lastOpened: Date.now(),
        lastPage: 1,
        zoom: 'fit',
        numPages: 0,
        docNote: '',
        pageNotes: {},
        annotations: [],
      };
      await DB.put('files', new Blob([buf], { type: 'application/pdf' }), id);
      await DB.put('docs', rec);
    } else if (!(await DB.get('files', id))) {
      await DB.put('files', new Blob([buf], { type: 'application/pdf' }), id);
    }
    if (embedded) await applyEmbeddedNotes(rec, embedded.notes);
    await openDoc(id);
  }

  async function openSample() {
    try {
      if (!window.UNIPDF_SAMPLE) await loadScript('sample-lecture.js');
      const { name, b64 } = window.UNIPDF_SAMPLE;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await importFile(new File([bytes], name, { type: 'application/pdf' }));
      toast('This is a demo lecture. Select some text to highlight it, or press ? for shortcuts.', 6000);
    } catch (err) {
      console.error(err);
      toast('Could not open the demo: ' + err.message, 5000);
    }
  }

  async function readEmbeddedNotes(buf) {
    try {
      await ensureWorker();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
      try {
        const att = await pdf.getAttachments();
        const json = att && att['lecture-notes.json'];
        const orig = att && att['lecture-notes-original.pdf'];
        if (!json || !orig) return null;
        const notes = JSON.parse(new TextDecoder().decode(json.content));
        if (notes.app !== 'lecture-pdf-notes' || !Array.isArray(notes.annotations)) return null;
        return { notes, original: orig.content.slice().buffer };
      } finally {
        pdf.destroy();
      }
    } catch (err) {
      console.warn('Could not check for embedded notes', err);
      return null;
    }
  }

  async function applyEmbeddedNotes(rec, notes) {
    const hasNotes = (r) => r.annotations.length || Object.values(r.pageNotes || {}).some((v) => v && v.trim()) || (r.docNote || '').trim();
    const same = JSON.stringify([rec.docNote || '', rec.pageNotes || {}, rec.annotations])
      === JSON.stringify([notes.docNote || '', notes.pageNotes || {}, notes.annotations]);
    if (same) { toast('Opened your editable PDF. Notes are up to date.', 3000); return; }
    if (hasNotes(rec)) {
      const when = notes.exportedAt ? new Date(notes.exportedAt).toLocaleString() : 'earlier';
      const ok = confirm(`This PDF contains notes saved ${when}, but this lecture already has different notes here.\n\n`
        + 'OK: use the notes from the PDF (replaces the ones in the app)\nCancel: keep the notes already in the app');
      if (!ok) return;
    }
    rec.docNote = notes.docNote || '';
    rec.pageNotes = notes.pageNotes || {};
    rec.annotations = notes.annotations;
    await DB.put('docs', rec);
    toast('Notes loaded from the PDF. You can keep editing them.', 3500);
  }

  let workerReady = null;
  function ensureWorker() {
    if (!workerReady) {
      if (location.protocol === 'file:') {
        // Browsers refuse to start Web Workers from file:// URLs, so run pdf.js on the main thread.
        workerReady = loadScript(WORKER_SRC);
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        workerReady = Promise.resolve();
      }
    }
    return workerReady;
  }

  async function openDoc(id) {
    if (S.doc && S.doc.id === id && S.pdf) { showReader(); return; }
    await flushSave();
    await closeDoc();

    const rec = await DB.get('docs', id);
    const blob = await DB.get('files', id);
    if (!rec || !blob) { toast('PDF not found in library.'); return; }

    await ensureWorker();
    let pdf;
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      // isEvalSupported:false hardens pdf.js against malicious font programs.
      pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    } catch (err) {
      console.error(err);
      toast('Could not open PDF: ' + err.message, 5000);
      return;
    }

    rec.pageNotes = rec.pageNotes || {};
    rec.annotations = rec.annotations || [];
    rec.docNote = rec.docNote || '';
    rec.numPages = pdf.numPages;
    rec.lastOpened = Date.now();
    S.doc = rec;
    S.pdf = pdf;
    S.zoom = rec.zoom || 'fit';
    S.activeId = null;

    const pageObjs = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
    const pagesEl = $('#pages');
    pagesEl.textContent = '';
    S.pages = pageObjs.map((page, i) => {
      const vp = page.getViewport({ scale: 1 });
      const div = el('div', 'page loading');
      div.dataset.page = String(i + 1);
      div.appendChild(el('div', 'page-label', String(i + 1)));
      const hlLayer = el('div', 'hlLayer');
      div.appendChild(hlLayer);
      pagesEl.appendChild(div);
      return { num: i + 1, page, div, hlLayer, baseW: vp.width, baseH: vp.height, canvas: null, textLayer: null, renderedScale: null, token: null, renderTask: null, textContent: null };
    });

    $('#docTitle').textContent = baseName(rec.name);
    $('#docTitle').title = rec.name;
    document.title = baseName(rec.name) + ' · uni-pdf';
    $('#pageCount').textContent = String(pdf.numPages);
    $('#docNote').value = rec.docNote;

    showReader();
    computeScale();
    layoutPages();
    S.pages.forEach((p) => { renderHighlights(p.num); io.observe(p.div); });

    const start = clamp(rec.lastPage || 1, 1, pdf.numPages);
    S.currentPage = 0;
    S.sbPage = 0;
    goToPage(start, false);
    updatePageIndicator();
    renderPagePanel();
    if (S.tab === 'all') renderAllPanel();
    scheduleSave();
  }

  async function closeDoc() {
    S.visible.clear();
    io.disconnect();
    for (const p of S.pages) if (p.renderTask) p.renderTask.cancel();
    S.pages = [];
    $('#pages').textContent = '';
    if (S.pdf) { try { await S.pdf.destroy(); } catch (_) { /* ignore */ } }
    S.pdf = null;
    S.doc = null;
  }

  // ------------------------------------------------------------------ views
  function showReader() {
    $('#library').hidden = true;
    $('#reader').hidden = false;
    document.body.classList.add('has-doc');
  }
  async function showLibrary() {
    await flushSave();
    $('#reader').hidden = true;
    $('#library').hidden = false;
    document.body.classList.remove('has-doc');
    document.title = 'uni-pdf: lecture slides and your notes, side by side';
    hideSelToolbar();
    renderLibrary();
  }

  async function renderLibrary() {
    const docs = (await DB.all('docs')).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    const list = $('#libList');
    list.textContent = '';
    $('#libEmpty').hidden = docs.length > 0;
    for (const d of docs) {
      const li = el('li', 'lib-item');
      const main = el('div', 'lib-main');
      main.appendChild(el('div', 'lib-name', baseName(d.name)));
      const nAnn = (d.annotations || []).length;
      const nPageNotes = Object.values(d.pageNotes || {}).filter((v) => v && v.trim()).length;
      const bits = [];
      if (d.numPages) bits.push(d.numPages + ' pages');
      bits.push(nAnn + ' highlight' + (nAnn === 1 ? '' : 's'));
      bits.push(nPageNotes + ' page note' + (nPageNotes === 1 ? '' : 's'));
      bits.push('opened ' + fmtDate(d.lastOpened || d.addedAt));
      main.appendChild(el('div', 'lib-meta', bits.join(' · ')));
      li.appendChild(main);
      const del = el('button', 'lib-del', '🗑');
      del.title = 'Remove from library (deletes its notes too)';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove "${d.name}" and all of its notes from this browser?\n\nTip: use Export → Backup first if you want to keep the notes.`)) return;
        if (S.doc && S.doc.id === d.id) { clearTimeout(saveTimer); await closeDoc(); }
        await DB.del('docs', d.id);
        await DB.del('files', d.id);
        renderLibrary();
      });
      li.appendChild(del);
      li.addEventListener('click', () => openDoc(d.id));
      list.appendChild(li);
    }
  }

  // ------------------------------------------------------------------ layout & rendering
  const viewer = $('#viewer');

  function computeScale() {
    if (!S.pages.length) return;
    if (S.zoom === 'fit') {
      const maxW = Math.max(...S.pages.map((p) => p.baseW));
      const avail = viewer.clientWidth - 48;
      S.scale = clamp(avail / maxW, MIN_SCALE, MAX_SCALE);
    } else {
      S.scale = clamp(S.zoom, MIN_SCALE, MAX_SCALE);
    }
    $('#btnZoomLabel').textContent = Math.round(S.scale * 100) + '%';
  }

  function layoutPages() {
    for (const p of S.pages) {
      p.div.style.width = Math.floor(p.baseW * S.scale) + 'px';
      p.div.style.height = Math.floor(p.baseH * S.scale) + 'px';
      p.div.style.setProperty('--scale-factor', String(S.scale));
    }
    for (const n of S.visible) renderPage(S.pages[n - 1]);
  }

  // Apply a zoom while keeping the same spot of the current page in view.
  function applyZoom(zoom) {
    if (!S.pages.length) return;
    const p = S.pages[S.currentPage - 1];
    const frac = (viewer.scrollTop - p.div.offsetTop) / p.div.offsetHeight;
    const xFrac = viewer.scrollWidth > viewer.clientWidth ? (viewer.scrollLeft + viewer.clientWidth / 2) / viewer.scrollWidth : 0.5;
    S.zoom = zoom;
    const old = S.scale;
    computeScale();
    if (Math.abs(old - S.scale) < 1e-4) return;
    layoutPages();
    viewer.scrollTop = p.div.offsetTop + frac * p.div.offsetHeight;
    viewer.scrollLeft = xFrac * viewer.scrollWidth - viewer.clientWidth / 2;
    S.doc.zoom = zoom;
    scheduleSave();
  }
  const zoomBy = (f) => applyZoom(clamp(Math.round(S.scale * f * 100) / 100, MIN_SCALE, MAX_SCALE));

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = +e.target.dataset.page;
      if (e.isIntersecting) { S.visible.add(n); renderPage(S.pages[n - 1]); }
      else S.visible.delete(n);
    }
  }, { root: viewer, rootMargin: '600px 0px' });

  async function renderPage(p) {
    if (!p || p.renderedScale === S.scale || (p.token && p.token.scale === S.scale)) return;
    const scale = S.scale;
    const token = { scale };
    p.token = token;
    if (p.renderTask) p.renderTask.cancel();

    const viewport = p.page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const task = p.page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    p.renderTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.error(err);
      if (p.token === token) p.token = null;
      return;
    } finally {
      if (p.renderTask === task) p.renderTask = null;
    }
    if (p.token !== token) return;

    if (p.canvas) p.canvas.remove();
    p.div.insertBefore(canvas, p.div.firstChild);
    p.canvas = canvas;
    p.div.classList.remove('loading');

    // Selectable text layer
    try {
      if (!p.textContent) p.textContent = await p.page.getTextContent();
      if (p.token !== token) return;
      const tl = el('div', 'textLayer');
      p.div.insertBefore(tl, p.hlLayer);
      await pdfjsLib.renderTextLayer({ textContentSource: p.textContent, container: tl, viewport, textDivs: [] }).promise;
      tl.appendChild(el('div', 'endOfContent'));
      if (p.token !== token) { tl.remove(); return; }
      if (p.textLayer) p.textLayer.remove();
      p.textLayer = tl;
    } catch (err) {
      console.warn('Text layer failed for page', p.num, err);
    }
    p.renderedScale = scale;
    p.token = null;
    evictFarPages();
  }

  // Keep memory bounded on long PDFs by dropping canvases far from view.
  function evictFarPages() {
    const rendered = S.pages.filter((p) => p.canvas);
    if (rendered.length <= MAX_RENDERED_PAGES) return;
    rendered
      .filter((p) => !S.visible.has(p.num))
      .sort((a, b) => Math.abs(b.num - S.currentPage) - Math.abs(a.num - S.currentPage))
      .slice(0, rendered.length - MAX_RENDERED_PAGES)
      .forEach((p) => {
        p.canvas.remove(); p.canvas = null;
        if (p.textLayer) { p.textLayer.remove(); p.textLayer = null; }
        p.renderedScale = null;
        p.div.classList.add('loading');
      });
  }

  // ------------------------------------------------------------------ navigation
  // Explicit navigation switches the notes panel right away (not after the smooth
  // scroll ends), so typing straight after pressing → lands on the new page.
  let navLockTimer = 0;
  function goToPage(n, smooth = true) {
    n = clamp(n, 1, S.pages.length);
    const p = S.pages[n - 1];
    if (!p) return;
    setCurrentPage(n);
    S.navLock = true;
    clearTimeout(navLockTimer);
    navLockTimer = setTimeout(() => { S.navLock = false; }, smooth ? 900 : 50);
    viewer.scrollTo({ top: p.div.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  }

  function setCurrentPage(n) {
    if (n === S.currentPage && S.sbPage === n) return;
    S.currentPage = n;
    updatePageIndicator();
    S.doc.lastPage = n;
    scheduleSave();
    if (S.sbPage !== n) { S.sbPage = n; renderPagePanel(); }
  }

  function updatePageIndicator() {
    const inp = $('#pageInput');
    if (document.activeElement !== inp) inp.value = String(S.currentPage);
  }

  let scrollRaf = 0;
  viewer.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!S.pages.length) return;
      positionSelToolbar();
      if (S.navLock) return;
      // Current page = the one taking up the most of the viewport.
      const top = viewer.scrollTop;
      const bottom = top + viewer.clientHeight;
      let cur = S.currentPage || 1;
      let bestVis = -1;
      for (const p of S.pages) {
        const pt = p.div.offsetTop;
        const pb = pt + p.div.offsetHeight;
        if (pb < top) continue;
        if (pt > bottom) break;
        const vis = Math.min(pb, bottom) - Math.max(pt, top);
        if (vis > bestVis + 1) { bestVis = vis; cur = p.num; }
      }
      if (cur !== S.currentPage) setCurrentPage(cur);
    });
  }, { passive: true });
  viewer.addEventListener('scrollend', () => { S.navLock = false; });

  // ------------------------------------------------------------------ highlights in the PDF
  function annotsOnPage(n) {
    return S.doc.annotations
      .filter((a) => a.page === n)
      .sort((a, b) => (a.rects[0][1] - b.rects[0][1]) || (a.rects[0][0] - b.rects[0][0]));
  }

  function renderHighlights(n) {
    const p = S.pages[n - 1];
    if (!p) return;
    p.hlLayer.textContent = '';
    for (const a of annotsOnPage(n)) {
      a.rects.forEach((r, i) => {
        const d = el('div', `hl ${a.color}${a.type === 'area' ? ' area' : ''}`);
        if (a.note && a.note.trim()) d.classList.add('has-note');
        if (i === a.rects.length - 1) d.classList.add('last');
        if (a.id === S.activeId) d.classList.add('active');
        d.dataset.id = a.id;
        d.style.left = r[0] * 100 + '%';
        d.style.top = r[1] * 100 + '%';
        d.style.width = r[2] * 100 + '%';
        d.style.height = r[3] * 100 + '%';
        p.hlLayer.appendChild(d);
      });
    }
  }

  function normPoint(e, pageDiv) {
    const r = pageDiv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function hitTest(pageNum, x, y) {
    const pad = 0.003;
    let best = null;
    let bestArea = Infinity;
    for (const a of S.doc.annotations) {
      if (a.page !== pageNum) continue;
      for (const r of a.rects) {
        if (x >= r[0] - pad && x <= r[0] + r[2] + pad && y >= r[1] - pad && y <= r[1] + r[3] + pad) {
          const area = a.rects.reduce((s, q) => s + q[2] * q[3], 0);
          if (area < bestArea) { best = a; bestArea = area; }
        }
      }
    }
    return best;
  }

  function flashAnnot(id) {
    $$(`.hl[data-id="${id}"]`).forEach((d) => {
      d.classList.remove('flash');
      void d.offsetWidth;
      d.classList.add('flash');
    });
  }

  function scrollToAnnot(a) {
    const p = S.pages[a.page - 1];
    if (!p) return;
    const y = p.div.offsetTop + a.rects[0][1] * p.div.offsetHeight;
    setCurrentPage(a.page);
    S.navLock = true;
    clearTimeout(navLockTimer);
    navLockTimer = setTimeout(() => { S.navLock = false; }, 900);
    viewer.scrollTo({ top: y - viewer.clientHeight * 0.3, behavior: 'smooth' });
    setTimeout(() => flashAnnot(a.id), 250);
  }

  const hasNote = (a) => !!(a.note && a.note.trim());

  // Highlights without a note only get a card while they are selected.
  function pruneEmptyCard(id) {
    const a = id && S.doc && S.doc.annotations.find((x) => x.id === id);
    if (!a || hasNote(a)) return;
    const card = $(`.annot[data-id="${id}"]`);
    if (card && !card.contains(document.activeElement)) card.remove();
  }

  function setActive(id) {
    const prev = S.activeId;
    S.activeId = id;
    if (prev && prev !== id) pruneEmptyCard(prev);
    $$('.hl.active').forEach((d) => d.classList.remove('active'));
    $$('.annot.active').forEach((d) => d.classList.remove('active'));
    if (!id) return;
    $$(`.hl[data-id="${id}"]`).forEach((d) => d.classList.add('active'));
    const card = $(`.annot[data-id="${id}"]`);
    if (card) card.classList.add('active');
  }

  // Open an annotation's card in the sidebar (e.g. after clicking it in the PDF).
  function selectAnnot(id, focusNote) {
    const a = S.doc.annotations.find((x) => x.id === id);
    if (!a) return;
    showSidebar();
    switchTab('page');
    if (S.sbPage !== a.page) { S.sbPage = a.page; }
    S.activeId = id;
    renderPagePanel();
    setActive(id);
    const card = $(`.annot[data-id="${id}"]`);
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (focusNote) {
        const ta = $('.annot-note', card);
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }

  // ------------------------------------------------------------------ text selection → annotation
  const selToolbar = $('#selToolbar');

  function selectionInTextLayer() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    if (!startEl || !startEl.closest('#pages .textLayer')) return null;
    if (!range.toString().trim()) return null;
    return range;
  }

  function showSelToolbar(range) {
    S.pendingRange = range.cloneRange();
    selToolbar.hidden = false;
    positionSelToolbar();
  }
  function hideSelToolbar() {
    selToolbar.hidden = true;
    S.pendingRange = null;
  }
  function positionSelToolbar() {
    if (selToolbar.hidden || !S.pendingRange) return;
    const rects = S.pendingRange.getClientRects();
    const r = rects.length ? rects[0] : S.pendingRange.getBoundingClientRect();
    const vr = viewer.getBoundingClientRect();
    const tw = selToolbar.offsetWidth;
    const th = selToolbar.offsetHeight;
    let top = r.top - th - 8;
    if (top < vr.top + 4) top = S.pendingRange.getBoundingClientRect().bottom + 8;
    const left = clamp(r.left, vr.left + 4, vr.right - tw - 4);
    selToolbar.style.top = top + 'px';
    selToolbar.style.left = left + 'px';
    // Hide when the selection has scrolled out of view.
    selToolbar.style.visibility = (r.bottom < vr.top || r.top > vr.bottom) ? 'hidden' : 'visible';
  }

  // Collect per-line rectangles of a range (relative to the page, 0..1).
  function rangeRects(range, pageDiv) {
    const pr = pageDiv.getBoundingClientRect();
    const raw = [];
    const common = range.commonAncestorContainer;
    const nodes = [];
    if (common.nodeType === 3) nodes.push(common);
    else {
      const w = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) if (range.intersectsNode(n)) nodes.push(n);
    }
    let text = '';
    let last = null;
    for (const node of nodes) {
      if (!pageDiv.contains(node) || !node.parentElement.closest('.textLayer')) continue;
      const r = document.createRange();
      r.selectNodeContents(node);
      if (node === range.startContainer) r.setStart(node, range.startOffset);
      if (node === range.endContainer) r.setEnd(node, range.endOffset);
      const piece = r.toString();
      const crs = Array.from(r.getClientRects()).filter((cr) => cr.width >= 0.5 && cr.height >= 0.5);
      if (!crs.length) continue;
      // pdf.js splits text into many spans; add a space when we jump to a new line or a gap.
      const first = crs[0];
      if (last && text && !/\s$/.test(text)) {
        const newLine = Math.abs(first.top - last.top) > last.height * 0.5;
        const gap = first.left - last.right > last.height * 0.15;
        if (newLine || gap) text += ' ';
      }
      text += piece;
      last = crs[crs.length - 1];
      for (const cr of crs) raw.push({ x: cr.left - pr.left, y: cr.top - pr.top, w: cr.width, h: cr.height });
    }
    rangeRects.lastText = text.replace(/\s+/g, ' ').trim();
    return mergeRects(raw).map((q) => [
      +(q.x / pr.width).toFixed(5), +(q.y / pr.height).toFixed(5),
      +(q.w / pr.width).toFixed(5), +(q.h / pr.height).toFixed(5),
    ]);
  }

  // Merge rectangles on the same line into one continuous highlight.
  function mergeRects(rects) {
    rects.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const out = [];
    for (const r of rects) {
      const prev = out.find((o) => {
        const overlap = Math.min(o.y + o.h, r.y + r.h) - Math.max(o.y, r.y);
        const sameLine = overlap > 0.5 * Math.min(o.h, r.h);
        const gap = Math.max(r.x - (o.x + o.w), o.x - (r.x + r.w));
        return sameLine && gap < 0.8 * Math.max(o.h, r.h);
      });
      if (prev) {
        const x1 = Math.min(prev.x, r.x), y1 = Math.min(prev.y, r.y);
        const x2 = Math.max(prev.x + prev.w, r.x + r.w), y2 = Math.max(prev.y + prev.h, r.y + r.h);
        Object.assign(prev, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      } else out.push({ ...r });
    }
    return out;
  }

  // Grow a range so it never starts or ends in the middle of a word.
  function snapToWords(range) {
    const word = /[\p{L}\p{N}_'’-]/u;
    const sc = range.startContainer;
    if (sc.nodeType === 3) {
      let i = range.startOffset;
      while (i > 0 && word.test(sc.data[i - 1]) && word.test(sc.data[i] || '')) i--;
      range.setStart(sc, i);
    }
    const ec = range.endContainer;
    if (ec.nodeType === 3) {
      let j = range.endOffset;
      while (j < ec.length && j > 0 && word.test(ec.data[j - 1]) && word.test(ec.data[j])) j++;
      range.setEnd(ec, j);
    }
  }

  function createFromSelection(color, withNote) {
    const range = S.pendingRange || selectionInTextLayer();
    if (!range) return;
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const pageDiv = startEl.closest('.page');
    if (!pageDiv) return;
    snapToWords(range);
    const rects = rangeRects(range, pageDiv);
    if (!rects.length) return;
    const text = rangeRects.lastText || range.toString().replace(/\s+/g, ' ').trim();
    addAnnotation({ page: +pageDiv.dataset.page, type: 'text', rects, text, color }, withNote);
    window.getSelection().removeAllRanges();
    hideSelToolbar();
  }

  function addAnnotation(partial, withNote) {
    const a = { id: uid(), note: '', createdAt: Date.now(), ...partial };
    S.doc.annotations.push(a);
    scheduleSave();
    renderHighlights(a.page);
    if (S.tab === 'all') renderAllPanel();
    if (withNote) selectAnnot(a.id, true);
    else {
      if (S.sbPage === a.page) renderPagePanel();
      flashAnnot(a.id);
    }
    return a;
  }

  function deleteAnnotation(id) {
    const i = S.doc.annotations.findIndex((a) => a.id === id);
    if (i < 0) return;
    const [a] = S.doc.annotations.splice(i, 1);
    if (S.activeId === id) S.activeId = null;
    scheduleSave();
    renderHighlights(a.page);
    renderPagePanel();
    if (S.tab === 'all') renderAllPanel();
    const docId = S.doc.id;
    toast(hasNote(a) ? 'Highlight and note deleted.' : 'Highlight deleted.', 6000, {
      label: 'Undo',
      run: () => {
        if (!S.doc || S.doc.id !== docId) return;
        S.doc.annotations.splice(Math.min(i, S.doc.annotations.length), 0, a);
        scheduleSave();
        renderHighlights(a.page);
        renderPagePanel();
        if (S.tab === 'all') renderAllPanel();
        flashAnnot(a.id);
      },
    });
  }

  // ------------------------------------------------------------------ area (box) annotations
  let drawing = null;

  function startDraw(e, pageDiv) {
    const box = el('div', 'draw-box');
    pageDiv.appendChild(box);
    const r = pageDiv.getBoundingClientRect();
    drawing = { pageDiv, box, x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top };
    updateDraw();
  }
  function updateDraw() {
    const d = drawing;
    Object.assign(d.box.style, {
      left: Math.min(d.x0, d.x1) + 'px', top: Math.min(d.y0, d.y1) + 'px',
      width: Math.abs(d.x1 - d.x0) + 'px', height: Math.abs(d.y1 - d.y0) + 'px',
    });
  }
  function finishDraw() {
    const d = drawing;
    drawing = null;
    d.box.remove();
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    if (w < 8 || h < 8) return false;
    const pr = d.pageDiv.getBoundingClientRect();
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    // Grab any text that falls inside the box to use as the quote.
    const words = [];
    $$('.textLayer span', d.pageDiv).forEach((s) => {
      const sr = s.getBoundingClientRect();
      const cx = sr.left + sr.width / 2 - pr.left;
      const cy = sr.top + sr.height / 2 - pr.top;
      if (cx >= x && cx <= x + w && cy >= y && cy <= y + h && s.textContent.trim()) words.push(s.textContent.trim());
    });
    addAnnotation({
      page: +d.pageDiv.dataset.page,
      type: 'area',
      rects: [[+(x / pr.width).toFixed(5), +(y / pr.height).toFixed(5), +(w / pr.width).toFixed(5), +(h / pr.height).toFixed(5)]],
      text: words.join(' ').slice(0, 400),
      color: 'blue',
    }, true);
    return true;
  }

  function setAreaMode(on) {
    S.areaMode = on;
    document.body.classList.toggle('area-mode', on);
    $('#btnArea').classList.toggle('active', on);
    if (on) toast('Area mode: drag a box over a diagram, formula or image. Esc to cancel.', 4000);
    else if (!$('#toast').hidden && $('#toastMsg').textContent.startsWith('Area mode')) $('#toast').hidden = true;
  }

  // ------------------------------------------------------------------ PDF mouse interactions
  const pagesEl = $('#pages');
  let suppressClick = false;

  pagesEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const pageDiv = e.target.closest('.page');
    if (!pageDiv) return;
    if (S.areaMode || e.altKey) {
      e.preventDefault();
      window.getSelection().removeAllRanges();
      hideSelToolbar();
      startDraw(e, pageDiv);
      return;
    }
    const tl = e.target.closest('.textLayer');
    if (!tl) return;
    if (e.target === tl || e.target.classList.contains('endOfContent')) {
      // Started in blank space: browsers won't begin a selection there, so drive it ourselves.
      const anchor = nearestCaret(tl, e.clientX, e.clientY);
      if (!anchor) return;
      e.preventDefault();
      hideSelToolbar();
      marginSel = { tl, anchor };
      window.getSelection().setBaseAndExtent(anchor.node, anchor.offset, anchor.node, anchor.offset);
      return;
    }
    const eoc = $('.endOfContent', tl);
    if (eoc) eoc.classList.add('active');
  });

  let marginSel = null;

  // Closest text position to a point: same line first, then nearest line.
  function nearestCaret(tl, x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const s of tl.querySelectorAll('span')) {
      const t = s.firstChild;
      if (!t || t.nodeType !== 3 || !t.length) continue;
      const r = s.getBoundingClientRect();
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const score = dy * 1000 + dx;
      if (score < bestScore) { bestScore = score; best = { s, t, r }; }
    }
    if (!best) return null;
    const { t, r } = best;
    if (x <= r.left) return { node: t, offset: 0 };
    if (x >= r.right) return { node: t, offset: t.length };
    const cr = document.caretRangeFromPoint && document.caretRangeFromPoint(x, r.top + r.height / 2);
    if (cr && cr.startContainer === t) return { node: t, offset: cr.startOffset };
    return { node: t, offset: Math.round(((x - r.left) / r.width) * t.length) };
  }

  document.addEventListener('mousemove', (e) => {
    if (drawing) {
      const r = drawing.pageDiv.getBoundingClientRect();
      drawing.x1 = clamp(e.clientX - r.left, 0, r.width);
      drawing.y1 = clamp(e.clientY - r.top, 0, r.height);
      updateDraw();
      return;
    }
    if (marginSel) {
      const f = nearestCaret(marginSel.tl, e.clientX, e.clientY);
      if (f) window.getSelection().setBaseAndExtent(marginSel.anchor.node, marginSel.anchor.offset, f.node, f.offset);
      return;
    }
    // Hover feedback + note tooltip on highlights.
    if (e.buttons || !S.doc) return;
    const pageDiv = e.target.closest && e.target.closest('#pages .page');
    if (!pageDiv) return;
    const pt = normPoint(e, pageDiv);
    const a = hitTest(+pageDiv.dataset.page, pt.x, pt.y);
    pageDiv.classList.toggle('hl-hover', !!a);
    pageDiv.title = a ? (a.note && a.note.trim() ? a.note : '(click to add a note)') : '';
  });

  document.addEventListener('mouseup', (e) => {
    $$('.endOfContent.active').forEach((n) => n.classList.remove('active'));
    if (marginSel) {
      marginSel = null;
      if (!window.getSelection().isCollapsed) suppressClick = true;
    }
    if (drawing) {
      if (finishDraw()) {
        suppressClick = true;
        if (S.areaMode) setAreaMode(false); // one box per click of "Area"
      }
      return;
    }
    if (selToolbar.contains(e.target)) return;
    setTimeout(() => {
      const range = selectionInTextLayer();
      if (range) showSelToolbar(range);
      else if (!selToolbar.hidden) hideSelToolbar();
    }, 0);
  });

  // Touch devices: text is selected by long-press and adjusted with handles, with no
  // mouseup. Show the toolbar once the selection settles.
  let selTimer = 0;
  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; }, true);
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (pointerDown || drawing || marginSel) return;
      const range = selectionInTextLayer();
      if (range) showSelToolbar(range);
    }, 350);
  });

  pagesEl.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pageDiv = e.target.closest('.page');
    if (!pageDiv) return;
    const pt = normPoint(e, pageDiv);
    const a = hitTest(+pageDiv.dataset.page, pt.x, pt.y);
    if (a) selectAnnot(a.id, true);
    else {
      setActive(null);
      const n = +pageDiv.dataset.page;
      if (S.sbPage !== n) { S.sbPage = n; renderPagePanel(); }
    }
  });

  // Keep the selection alive while clicking toolbar buttons.
  selToolbar.addEventListener('mousedown', (e) => e.preventDefault());
  $$('.swatch', selToolbar).forEach((b) => b.addEventListener('click', () => createFromSelection(b.dataset.color, false)));
  $('#selNote').addEventListener('click', () => createFromSelection(S.lastColor || 'yellow', true));

  viewer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !S.pages.length) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  new ResizeObserver(() => {
    if (S.zoom !== 'fit' || !S.pages.length) return;
    const old = S.scale;
    computeScale();
    if (Math.abs(old - S.scale) > 0.005) {
      const p = S.pages[S.currentPage - 1];
      const frac = (viewer.scrollTop - p.div.offsetTop) / p.div.offsetHeight;
      layoutPages();
      viewer.scrollTop = p.div.offsetTop + frac * p.div.offsetHeight;
    }
  }).observe(viewer);

  // ------------------------------------------------------------------ sidebar
  function switchTab(tab) {
    S.tab = tab;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    if (tab === 'all') renderAllPanel();
    if (tab === 'page') renderPagePanel();
  }

  function showSidebar() {
    document.body.classList.remove('sidebar-hidden');
    try { localStorage.setItem('sidebarHidden', '0'); } catch (_) { /* ignore */ }
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  function buildCard(a) {
    const card = el('div', `annot ${a.color}`);
    card.dataset.id = a.id;
    if (a.id === S.activeId) card.classList.add('active');
    // Leaving an empty card hides it again (the highlight stays in the PDF).
    card.addEventListener('focusout', (e) => {
      if (card.contains(e.relatedTarget) || hasNote(a)) return;
      if (S.activeId === a.id) setActive(null);
      card.remove();
    });

    const quote = el('div', 'annot-quote', a.text ? `“${a.text}”` : '▭ Area on page ' + a.page);
    quote.title = 'Show in PDF';
    quote.addEventListener('click', () => { setActive(a.id); scrollToAnnot(a); });
    card.appendChild(quote);

    const ta = el('textarea', 'annot-note');
    ta.rows = 1;
    ta.placeholder = 'Add a note about this…';
    ta.value = a.note || '';
    ta.addEventListener('input', () => {
      const hadNote = !!(a.note && a.note.trim());
      a.note = ta.value;
      a.updatedAt = Date.now();
      autosize(ta);
      scheduleSave();
      if (hadNote !== !!a.note.trim()) renderHighlights(a.page);
    });
    ta.addEventListener('focus', () => setActive(a.id));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { ta.blur(); viewer.focus({ preventScroll: true }); }
    });
    card.appendChild(ta);
    requestAnimationFrame(() => autosize(ta));

    const foot = el('div', 'annot-foot');
    foot.appendChild(el('span', 'time', fmtTime(a.createdAt)));
    for (const c of COLORS) {
      const s = el('button', 'mini-swatch' + (c === a.color ? ' sel' : ''));
      s.dataset.color = c;
      s.title = c;
      s.addEventListener('click', () => {
        a.color = c;
        S.lastColor = c;
        COLORS.forEach((k) => card.classList.remove(k));
        card.classList.add(c);
        $$('.mini-swatch', foot).forEach((m) => m.classList.toggle('sel', m.dataset.color === c));
        renderHighlights(a.page);
        scheduleSave();
      });
      foot.appendChild(s);
    }
    const del = el('button', 'annot-del', 'Delete');
    del.addEventListener('click', () => deleteAnnotation(a.id));
    foot.appendChild(del);
    card.appendChild(foot);
    return card;
  }

  function renderPagePanel() {
    if (!S.doc) return;
    $('#sbPageNum').textContent = String(S.sbPage);
    const pn = $('#pageNote');
    const val = S.doc.pageNotes[S.sbPage] || '';
    if (pn.value !== val) pn.value = val;
    const list = $('#pageAnnots');
    list.textContent = '';
    const annots = annotsOnPage(S.sbPage);
    annots.filter((a) => hasNote(a) || a.id === S.activeId).forEach((a) => list.appendChild(buildCard(a)));
    $('#pageAnnotsEmpty').hidden = annots.length > 0;
  }

  function appendMarked(parent, text, q) {
    if (!q) { parent.textContent = text; return; }
    const lower = text.toLowerCase();
    let i = 0;
    while (true) {
      const j = lower.indexOf(q, i);
      if (j < 0) break;
      parent.appendChild(document.createTextNode(text.slice(i, j)));
      parent.appendChild(el('mark', null, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    parent.appendChild(document.createTextNode(text.slice(i)));
  }

  function renderAllPanel() {
    if (!S.doc) return;
    const q = $('#searchInput').value.trim().toLowerCase();
    const list = $('#allList');
    list.textContent = '';
    const match = (s) => !q || (s || '').toLowerCase().includes(q);
    let any = false;
    for (let n = 1; n <= S.doc.numPages; n++) {
      const pnote = (S.doc.pageNotes[n] || '').trim();
      const annots = annotsOnPage(n).filter((a) => match(a.text) || match(a.note));
      const showPN = pnote && match(pnote);
      if (!showPN && !annots.length) continue;
      any = true;
      const g = el('div', 'all-group');
      const h = el('h4', null, 'Page ' + n);
      h.addEventListener('click', () => { goToPage(n); });
      g.appendChild(h);
      if (showPN) {
        const d = el('div', 'all-pagenote');
        appendMarked(d, pnote, q);
        d.addEventListener('click', () => { goToPage(n); S.sbPage = n; switchTab('page'); });
        g.appendChild(d);
      }
      for (const a of annots) {
        const it = el('div', `all-item ${a.color}`);
        const qd = el('div', 'q');
        appendMarked(qd, a.text ? `“${a.text}”` : '▭ Area', q);
        it.appendChild(qd);
        if (a.note && a.note.trim()) {
          const nd = el('div', 'n');
          appendMarked(nd, a.note.trim(), q);
          it.appendChild(nd);
        }
        it.addEventListener('click', () => { scrollToAnnot(a); selectAnnot(a.id, false); });
        g.appendChild(it);
      }
      list.appendChild(g);
    }
    if (!any) list.appendChild(el('p', 'muted small', q ? 'Nothing matches your search.' : 'No notes yet. Notes and highlights for every page will appear here.'));
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#searchInput').addEventListener('input', renderAllPanel);

  $('#pageNote').addEventListener('input', (e) => {
    const v = e.target.value;
    if (v) S.doc.pageNotes[S.sbPage] = v;
    else delete S.doc.pageNotes[S.sbPage];
    scheduleSave();
  });
  $('#docNote').addEventListener('input', (e) => {
    S.doc.docNote = e.target.value;
    scheduleSave();
  });
  [$('#pageNote'), $('#docNote')].forEach((ta) => ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ta.blur(); viewer.focus({ preventScroll: true }); }
  }));

  // Resizable sidebar
  (() => {
    const divider = $('#divider');
    try {
      const w = localStorage.getItem('sidebarW');
      if (w) document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      if (localStorage.getItem('sidebarHidden') === '1') document.body.classList.add('sidebar-hidden');
    } catch (_) { /* ignore */ }
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      divider.classList.add('dragging');
      const move = (ev) => {
        const w = clamp(window.innerWidth - ev.clientX, 260, window.innerWidth * 0.7);
        document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      };
      const up = () => {
        divider.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        try { localStorage.setItem('sidebarW', String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10))); } catch (_) { /* ignore */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  })();

  // ------------------------------------------------------------------ export / import
  function exportMarkdown() {
    const d = S.doc;
    const lines = [`# ${baseName(d.name)}`, '', `_Exported ${new Date().toLocaleString()}_`, ''];
    if (d.docNote.trim()) lines.push('## Lecture notes', '', d.docNote.trim(), '');
    for (let n = 1; n <= d.numPages; n++) {
      const pn = (d.pageNotes[n] || '').trim();
      const annots = annotsOnPage(n);
      if (!pn && !annots.length) continue;
      lines.push(`## Page ${n}`, '');
      if (pn) lines.push(pn, '');
      for (const a of annots) {
        lines.push(a.text ? `> ${a.text}` : '> _(area highlight)_');
        if (a.note && a.note.trim()) lines.push('', a.note.trim().split('\n').map((l) => '  ' + l).join('\n').replace(/^ {2}/, '- '));
        lines.push('');
      }
    }
    download(`${baseName(d.name)} - notes.md`, lines.join('\n'), 'text/markdown');
  }

  function notesPayload(d) {
    return {
      app: 'lecture-pdf-notes', version: 1, exportedAt: new Date().toISOString(),
      docId: d.id, name: d.name, docNote: d.docNote, pageNotes: d.pageNotes, annotations: d.annotations,
    };
  }

  function exportJson() {
    const d = S.doc;
    const data = notesPayload(d);
    download(`${baseName(d.name)} - notes backup.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  let exportLibs = null;
  async function exportPdf(editable) {
    const d = S.doc;
    await flushSave();
    toast('Building PDF…', 60000);
    try {
      if (!exportLibs) {
        exportLibs = (async () => {
          for (const src of ['vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/dejavu-fonts.js', 'export-pdf.js']) await loadScript(src);
        })();
        exportLibs.catch(() => { exportLibs = null; });
      }
      await exportLibs;
      const blob = await DB.get('files', d.id);
      const opts = editable ? { notes: notesPayload(d) } : {};
      const bytes = await window.PdfNotesExport.build(new Uint8Array(await blob.arrayBuffer()), d, opts);
      download(`${baseName(d.name)} - ${editable ? 'notes (editable)' : 'with notes'}.pdf`, bytes, 'application/pdf');
      toast(editable ? 'Editable PDF saved. Open it here again to keep editing your notes.' : 'PDF saved.', 4000);
    } catch (err) {
      console.error(err);
      toast('Could not build the PDF: ' + err.message, 6000);
    }
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'lecture-pdf-notes' || !Array.isArray(data.annotations)) throw new Error('Not a notes backup file.');
      if (data.docId !== S.doc.id && !confirm(`This backup was made for "${data.name}", which is a different file from the open PDF.\nApply it anyway?`)) return;
      if (!confirm('Replace the current notes of this PDF with the backup?')) return;
      S.doc.docNote = data.docNote || '';
      S.doc.pageNotes = data.pageNotes || {};
      S.doc.annotations = data.annotations;
      $('#docNote').value = S.doc.docNote;
      S.pages.forEach((p) => renderHighlights(p.num));
      renderPagePanel();
      if (S.tab === 'all') renderAllPanel();
      await flushSave();
      toast('Notes restored.');
    } catch (err) {
      toast('Restore failed: ' + err.message, 4000);
    }
  }

  const exportMenu = $('#exportMenu');
  const setMenu = (open) => { exportMenu.hidden = !open; $('#btnExport').setAttribute('aria-expanded', String(open)); };
  $('#btnExport').addEventListener('click', (e) => { e.stopPropagation(); setMenu(exportMenu.hidden); });
  document.addEventListener('click', () => setMenu(false));
  $$('[data-export]', exportMenu).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.export;
    if (k === 'pdf') exportPdf(false);
    else if (k === 'pdf-edit') exportPdf(true);
    else if (k === 'md') exportMarkdown();
    else if (k === 'json') exportJson();
    else $('#importInput').click();
  }));
  $('#importInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importJson(f);
  });

  // ------------------------------------------------------------------ toolbar wiring
  ['#fileInput', '#fileInput2'].forEach((sel) => $(sel).addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    importFile(f).catch((err) => { console.error(err); toast('Error: ' + err.message, 5000); });
  }));
  $('#btnSample').addEventListener('click', openSample);
  const helpDialog = $('#helpDialog');
  const openHelp = () => { if (!helpDialog.open) helpDialog.showModal(); };
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnHelp2').addEventListener('click', openHelp);
  helpDialog.addEventListener('click', (e) => { if (e.target === helpDialog) helpDialog.close(); });
  $('#appVersion').textContent = 'uni-pdf v' + VERSION;
  $('#btnLibrary').addEventListener('click', showLibrary);
  $('#btnPrev').addEventListener('click', () => goToPage(S.currentPage - 1));
  $('#btnNext').addEventListener('click', () => goToPage(S.currentPage + 1));
  $('#pageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = parseInt(e.target.value, 10);
      if (n) goToPage(n, false);
      e.target.blur();
    }
  });
  $('#pageInput').addEventListener('blur', updatePageIndicator);
  $('#btnZoomIn').addEventListener('click', () => zoomBy(1.15));
  $('#btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.15));
  $('#btnZoomLabel').addEventListener('click', () => applyZoom('fit'));
  $('#btnArea').addEventListener('click', () => setAreaMode(!S.areaMode));
  $('#btnSidebar').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('sidebar-hidden');
    try { localStorage.setItem('sidebarHidden', hidden ? '1' : '0'); } catch (_) { /* ignore */ }
  });

  // Theme
  (() => {
    let theme = null;
    try { theme = localStorage.getItem('theme'); } catch (_) { /* ignore */ }
    if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    $('#btnTheme').addEventListener('click', () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem('theme', t); } catch (_) { /* ignore */ }
    });
  })();

  // Drag & drop
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('dragover'); } });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragover');
    const f = Array.from(e.dataTransfer.files).find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
    if (f) importFile(f).catch((err) => toast('Error: ' + err.message, 5000));
    else toast('Drop a PDF file.');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.areaMode) setAreaMode(false);
      hideSelToolbar();
      setMenu(false);
    }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || helpDialog.open) return;
    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key === 'o' || e.key === 'O') { e.preventDefault(); $('#fileInput').click(); return; }
    if (!S.doc || $('#reader').hidden) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); goToPage(S.currentPage + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); goToPage(S.currentPage - 1); }
    else if (k === '+' || k === '=') zoomBy(1.15);
    else if (k === '-') zoomBy(1 / 1.15);
    else if (k === '0') applyZoom('fit');
    else if (k === 'h' || k === 'H') { if (selectionInTextLayer() || S.pendingRange) createFromSelection(S.lastColor || 'yellow', false); }
    else if (k === 'n' || k === 'N') {
      e.preventDefault();
      if (selectionInTextLayer() || S.pendingRange) createFromSelection(S.lastColor || 'yellow', true);
      else { showSidebar(); switchTab('page'); $('#pageNote').focus(); }
    }
    else if (k === 'p' || k === 'P') { e.preventDefault(); showSidebar(); switchTab('page'); $('#pageNote').focus(); }
    else if (k === 'a' || k === 'A') setAreaMode(!S.areaMode);
    else if (k === '\\') $('#btnSidebar').click();
    else if (k === 'l' || k === 'L') showLibrary();
  });

  window.addEventListener('beforeunload', () => { if (saveTimer) flushSave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flushSave(); });

  // ------------------------------------------------------------------ boot
  // Offline support + "Install app" when served over http(s). Not available from file://.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/[?&]nosw\b/.test(location.search)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err)));
  }

  (async () => {
    try {
      await DB.open();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      // Installed app launched by opening a PDF from the OS ("Open with uni-pdf").
      if ('launchQueue' in window) {
        window.launchQueue.setConsumer(async (params) => {
          for (const h of params.files || []) {
            try { await importFile(await h.getFile()); } catch (err) { toast('Could not open file: ' + err.message, 5000); }
            break;
          }
        });
      }
      const docs = await DB.all('docs');
      if (location.hash === '#demo') {
        // Linked from the homepage's "Try the demo lecture" button.
        history.replaceState(null, '', location.pathname + location.search);
        renderLibrary();
        await openSample();
      } else if (docs.length) {
        // Re-open whatever was open last time.
        const last = docs.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))[0];
        renderLibrary();
        await openDoc(last.id);
      } else {
        renderLibrary();
      }
    } catch (err) {
      console.error(err);
      toast('Storage unavailable: ' + err.message, 6000);
    }
  })();
})();
