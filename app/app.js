/* uni-pdf: a PDF reader with a notes panel and text-anchored notes.
 * Everything is stored locally in IndexedDB (PDF files + notes). */
(() => {
  'use strict';

  const pdfjsLib = window.pdfjsLib;
  const WORKER_SRC = 'vendor/pdf.worker.min.js';
  const COLORS = ['yellow', 'green', 'blue', 'pink'];
  const INK_COLORS = { black: '#1f2328', red: '#e03131', blue: '#2f6fde', green: '#2b9a4b', yellow: '#f5c400' };
  const INK_SIZES = { pen: [1.2, 2.4, 4.8], marker: [9, 15, 24] }; // stroke width in PDF points
  const SVGNS = 'http://www.w3.org/2000/svg';
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 5;
  const MAX_RENDERED_PAGES = 14;
  const VERSION = '1.1.0';
  const DAY = 864e5;
  const SRS_DAYS = [0, 1, 3, 7, 14, 30, 60, 120];

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
  // <svg class="ic"><use href="#i-name"/></svg> from the inline Lucide sprite in index.html
  const icon = (name, cls) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  };

  // Styled replacement for confirm()/prompt(). Resolves true/false, or the text (or null) with opts.input.
  function ask(opts) {
    const dlg = $('#askDialog');
    $('#askTitle').textContent = opts.title || '';
    $('#askBody').textContent = opts.body || '';
    $('#askBody').hidden = !opts.body;
    const ok = $('#askOk');
    const cancel = $('#askCancel');
    ok.textContent = opts.ok || 'OK';
    cancel.textContent = opts.cancel || 'Cancel';
    ok.classList.toggle('danger', !!opts.danger);
    const input = $('#askInput');
    input.hidden = !opts.input;
    const list = $('#askList');
    list.textContent = '';
    if (opts.input) {
      input.value = opts.input.value || '';
      input.placeholder = opts.input.placeholder || '';
      for (const v of opts.input.list || []) { const o = document.createElement('option'); o.value = v; list.appendChild(o); }
    }
    return new Promise((resolve) => {
      const done = () => {
        dlg.removeEventListener('close', done);
        const yes = dlg.returnValue === 'ok';
        resolve(opts.input ? (yes ? input.value.trim() : null) : yes);
      };
      dlg.returnValue = '';
      dlg.addEventListener('close', done);
      dlg.showModal();
      (opts.input ? input : ok).focus();
      if (opts.input) input.select();
    });
  }
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
    allFilter: 'all',   // All notes tab filter: 'all' | 'exam' | 'ask'
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
        pageFlags: {},
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
      const bytes = b64ToBytes(b64);
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
    const same = JSON.stringify([rec.docNote || '', rec.pageNotes || {}, rec.pageFlags || {}, rec.annotations])
      === JSON.stringify([notes.docNote || '', notes.pageNotes || {}, notes.pageFlags || {}, notes.annotations]);
    if (same) { toast('Opened your editable PDF. Notes are up to date.', 3000); return; }
    if (hasNotes(rec)) {
      const when = notes.exportedAt ? new Date(notes.exportedAt).toLocaleString() : 'earlier';
      const ok = await ask({
        title: 'Which notes do you want to keep?',
        body: `This PDF contains notes saved ${when}, but this lecture already has different notes in uni-pdf.`,
        ok: 'Use the notes from the PDF',
        cancel: 'Keep the notes in the app',
      });
      if (!ok) return;
    }
    rec.docNote = notes.docNote || '';
    rec.pageNotes = notes.pageNotes || {};
    rec.pageFlags = notes.pageFlags || {};
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

  // opts.page: jump to this page instead of where the student stopped last time.
  async function openDoc(id, opts = {}) {
    if (S.doc && S.doc.id === id && S.pdf) { showReader(); if (opts.page) goToPage(opts.page, false); return; }
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
    rec.pageFlags = rec.pageFlags || {};
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
      const inkLayer = document.createElementNS(SVGNS, 'svg');
      inkLayer.setAttribute('class', 'inkLayer');
      inkLayer.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
      inkLayer.setAttribute('preserveAspectRatio', 'none');
      div.appendChild(inkLayer);
      pagesEl.appendChild(div);
      const findLayer = el('div', 'findLayer');
      div.appendChild(findLayer);
      return { num: i + 1, page, div, hlLayer, inkLayer, findLayer, baseW: vp.width, baseH: vp.height, canvas: null, textLayer: null, textDivs: null, renderedScale: null, token: null, renderTask: null, textContent: null };
    });

    $('#docTitle').textContent = baseName(rec.name);
    $('#docTitle').title = rec.name;
    document.title = baseName(rec.name) + ' · uni-pdf';
    $('#pageCount').textContent = String(pdf.numPages);
    $('#docNote').value = rec.docNote;

    showReader();
    computeScale();
    layoutPages();
    buildThumbs();
    S.pages.forEach((p) => { renderHighlights(p.num); io.observe(p.div); });
    if (!$('#findBar').hidden && $('#findInput').value.trim()) runFind();

    if (!rec.thumb) makeLibThumb(S.pages[0], rec);
    const start = clamp(opts.page || rec.lastPage || 1, 1, pdf.numPages);
    S.currentPage = 0;
    S.sbPage = 0;
    goToPage(start, false);
    updatePageIndicator();
    renderPagePanel();
    if (S.tab === 'all') renderAllPanel();
    scheduleSave();
  }

  async function closeDoc() {
    if (D.on) setDrawMode(false);
    S.visible.clear();
    io.disconnect();
    clearThumbs();
    resetFind();
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
    libDocs = (await DB.all('docs')).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    drawLibrary();
  }

  function drawLibrary() {
    const docs = libDocs;
    const groupsEl = $('#libGroups');
    groupsEl.textContent = '';
    document.body.classList.toggle('no-lectures', !docs.length);
    $('#libEmpty').hidden = docs.length > 0;
    $('#libTools').hidden = !docs.length;
    $('#libBar').hidden = !docs.length;

    const courses = [...new Set(docs.map((d) => (d.course || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (S.libCourse && !courses.includes(S.libCourse)) S.libCourse = '';
    const chips = $('#courseChips');
    chips.textContent = '';
    if (courses.length) {
      for (const c of [''].concat(courses)) {
        const b = el('button', 'chip' + (c === (S.libCourse || '') ? ' active' : ''));
        if (c) b.appendChild(icon('folder'));
        b.appendChild(document.createTextNode(c || 'All courses'));
        b.addEventListener('click', () => { S.libCourse = c; drawLibrary(); });
        chips.appendChild(b);
      }
    }

    const q = $('#libSearch').value.trim().toLowerCase();
    const hitDocs = drawLibHits(q);
    const shown = docs.filter((d) => (!q || d.name.toLowerCase().includes(q) || hitDocs.has(d.id))
      && (!S.libCourse || (d.course || '').trim() === S.libCourse));
    // Group by course; lectures without a course go last.
    const groups = new Map();
    for (const d of shown) {
      const c = (d.course || '').trim();
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(d);
    }
    const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || a.localeCompare(b));
    for (const c of keys) {
      const sec = el('section', 'lib-group');
      if (courses.length) {
        const h = el('h2', 'lib-group-head');
        h.appendChild(icon(c ? 'folder' : 'file-text'));
        h.appendChild(document.createTextNode(c || 'Other lectures'));
        h.appendChild(el('span', 'n', String(groups.get(c).length)));
        sec.appendChild(h);
      }
      const ul = el('ul', 'lib-list');
      for (const d of groups.get(c)) ul.appendChild(libCard(d, courses));
      sec.appendChild(ul);
      groupsEl.appendChild(sec);
    }
  }

  function libCard(d, courses) {
    const li = el('li', 'lib-item');
    li.tabIndex = 0;
    const thumb = el('div', 'lib-thumb');
    if (d.thumb) { const img = el('img'); img.src = d.thumb; img.alt = ''; img.loading = 'lazy'; thumb.appendChild(img); }
    else thumb.appendChild(icon('file-text'));
    li.appendChild(thumb);
    const prog = el('div', 'lib-progress');
    const bar = el('i');
    bar.style.width = (d.numPages ? Math.round((clamp(d.lastPage || 1, 1, d.numPages) / d.numPages) * 100) : 0) + '%';
    prog.appendChild(bar);
    prog.title = d.numPages ? `Page ${d.lastPage || 1} of ${d.numPages}` : '';
    li.appendChild(prog);

    const body = el('div', 'lib-body');
    body.appendChild(el('div', 'lib-name', baseName(d.name)));
    const nAnn = (d.annotations || []).length;
    const bits = [];
    if (d.numPages) bits.push(d.numPages + ' pages');
    bits.push(nAnn + ' note' + (nAnn === 1 ? '' : 's'));
    bits.push('opened ' + fmtDate(d.lastOpened || d.addedAt));
    body.appendChild(el('div', 'lib-meta', bits.join(' · ')));
    const badges = el('div', 'lib-badges');
    const badge = (cls, ic, text, title) => {
      const b = el('span', 'badge ' + cls);
      b.appendChild(icon(ic));
      b.appendChild(document.createTextNode(text));
      b.title = title;
      badges.appendChild(b);
    };
    const flags = Object.values(d.pageFlags || {});
    const nExam = flags.filter((f) => f.exam).length;
    const nAsk = flags.filter((f) => f.ask).length;
    const nDue = (d.annotations || []).filter((a) => a.note && a.note.trim() && (!a.srs || a.srs.due <= Date.now())).length;
    if (nDue) badge('due', 'graduation-cap', nDue + ' to review', 'Flashcards due for review');
    if (nExam) badge('exam', 'star', String(nExam), 'Exam-relevant pages');
    if (nAsk) badge('ask', 'message-circle-question-mark', String(nAsk), 'Pages with a question to ask');
    if (badges.childNodes.length) body.appendChild(badges);
    li.appendChild(body);

    const actions = el('div', 'lib-card-actions');
    const courseBtn = el('button', 'lib-course');
    courseBtn.title = d.course ? `Course: ${d.course} (change)` : 'Add to a course';
    courseBtn.setAttribute('aria-label', courseBtn.title);
    courseBtn.appendChild(icon('folder'));
    courseBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const v = await ask({
        title: 'Course',
        body: 'Group lectures by course, e.g. "Operating Systems". Leave it empty to remove the course.',
        ok: 'Save',
        input: { value: d.course || '', placeholder: 'Course name', list: courses },
      });
      if (v === null) return;
      const rec = await DB.get('docs', d.id);
      if (!rec) return;
      rec.course = v;
      if (S.doc && S.doc.id === d.id) S.doc.course = v;
      await DB.put('docs', rec);
      renderLibrary();
    });
    const del = el('button', 'lib-del');
    del.title = 'Remove from library';
    del.setAttribute('aria-label', 'Remove from library');
    del.appendChild(icon('trash-2'));
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const yes = await ask({
        title: `Remove "${baseName(d.name)}"?`,
        body: 'The PDF and all of its notes will be deleted from this browser. Tip: use Export → Back up first if you want to keep the notes.',
        ok: 'Remove',
        danger: true,
      });
      if (!yes) return;
      if (S.doc && S.doc.id === d.id) { clearTimeout(saveTimer); await closeDoc(); }
      await DB.del('docs', d.id);
      await DB.del('files', d.id);
      renderLibrary();
    });
    actions.append(courseBtn, del);
    li.appendChild(actions);
    li.addEventListener('click', () => openDoc(d.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDoc(d.id); });
    return li;
  }

  // Small preview of page 1 for the library card, made once per lecture.
  async function makeLibThumb(p, rec) {
    try {
      const scale = 360 / p.baseW;
      const vp = p.page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (S.doc !== rec) return;
      rec.thumb = c.toDataURL('image/jpeg', 0.78);
      scheduleSave();
    } catch (err) {
      console.warn('No library preview', err);
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
      const textDivs = [];
      await pdfjsLib.renderTextLayer({ textContentSource: p.textContent, container: tl, viewport, textDivs }).promise;
      tl.appendChild(el('div', 'endOfContent'));
      if (p.token !== token) { tl.remove(); return; }
      if (p.textLayer) p.textLayer.remove();
      p.textLayer = tl;
      p.textDivs = textDivs;
    } catch (err) {
      console.warn('Text layer failed for page', p.num, err);
    }
    p.renderedScale = scale;
    p.token = null;
    renderFindHits(p);
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
        if (p.textLayer) { p.textLayer.remove(); p.textLayer = null; p.textDivs = null; }
        p.findLayer.textContent = '';
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
    markCurrentThumb();
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
    updateThumb(n);
    p.hlLayer.textContent = '';
    for (const a of annotsOnPage(n)) {
      a.rects.forEach((r, i) => {
        const d = el('div', `hl ${a.color}${a.type === 'area' ? ' area' : a.type === 'ink' ? ' ink' : ''}`);
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
    renderInk(p);
    updateAllCount();
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
      if (a.type === 'ink' && !nearInk(a, x, y, 5)) continue;
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
  const annotLabel = (a, short) => (a.text ? `“${a.text}”`
    : a.type === 'ink' ? (short ? '✏ Drawing' : '✏ Drawing on page ' + a.page)
      : (short ? '▭ Area' : '▭ Area on page ' + a.page));

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
        const focusTa = () => {
          if (!ta.isConnected || document.activeElement === ta) return;
          ta.focus({ preventScroll: true });
          ta.setSelectionRange(ta.value.length, ta.value.length);
        };
        // Focus right away (phones only open the keyboard inside the tap), and again
        // after the next frame in case the click that created the note moved focus.
        focusTa();
        requestAnimationFrame(focusTa);
      }
    }
  }

  // ------------------------------------------------------------------ text selection → annotation
  const selToolbar = $('#selToolbar');

  // Default color for new highlights and notes (Note button, H and N). Saved on this device.
  let noteColor = 'yellow';
  try { const c = localStorage.getItem('noteColor'); if (COLORS.includes(c)) noteColor = c; } catch (_) { /* ignore */ }
  function syncNoteColor() {
    $$('[data-note-color]').forEach((b) => {
      const on = b.dataset.noteColor === noteColor;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('.swatch', selToolbar).forEach((b) => {
      const on = b.dataset.color === noteColor;
      b.classList.toggle('default', on);
      b.title = `Highlight ${b.dataset.color}` + (on ? ' (H)' : '');
    });
    $('#selNote').dataset.color = noteColor;
  }
  function setNoteColor(c) {
    if (!COLORS.includes(c)) return;
    noteColor = c;
    try { localStorage.setItem('noteColor', c); } catch (_) { /* ignore */ }
    syncNoteColor();
  }
  $$('[data-note-color]').forEach((b) => b.addEventListener('click', () => setNoteColor(b.dataset.noteColor)));
  syncNoteColor();

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
    // Clear the PDF selection *before* the note box gets focus: clearing it afterwards
    // takes the caret out of the box again in some browsers (Safari, Firefox).
    window.getSelection().removeAllRanges();
    hideSelToolbar();
    addAnnotation({ page: +pageDiv.dataset.page, type: 'text', rects, text, color }, withNote);
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

  function syncTools() {
    const tool = S.areaMode ? 'area' : (typeof D !== 'undefined' && D.on) ? 'draw' : 'select';
    for (const [id, t] of [['#btnSelect', 'select'], ['#btnArea', 'area'], ['#btnDraw', 'draw']]) {
      $(id).classList.toggle('active', tool === t);
      $(id).setAttribute('aria-pressed', String(tool === t));
    }
  }

  function setAreaMode(on) {
    if (on && D.on) setDrawMode(false);
    S.areaMode = on;
    document.body.classList.toggle('area-mode', on);
    syncTools();
    if (on) toast('Area mode: drag a box over a diagram, formula or image. Esc to cancel.', 4000);
    else if (!$('#toast').hidden && $('#toastMsg').textContent.startsWith('Area mode')) $('#toast').hidden = true;
  }

  // ------------------------------------------------------------------ PDF mouse interactions
  const pagesEl = $('#pages');
  let suppressClick = false;

  pagesEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || D.on) return;
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
  $('#selNote').addEventListener('click', () => createFromSelection(noteColor, true));
  const selectionText = () => (S.pendingRange ? S.pendingRange.toString() : '').replace(/\s+/g, ' ').trim();
  $('#selCopy').addEventListener('click', async () => {
    const t = selectionText();
    if (!t) return;
    try { await navigator.clipboard.writeText(t); toast('Copied.'); } catch (_) { toast('Copying is not allowed here. Use Ctrl+C.'); }
  });
  $('#selFind').addEventListener('click', () => {
    const t = selectionText();
    hideSelToolbar();
    window.getSelection().removeAllRanges();
    findInput.value = t.slice(0, 80);
    openFind();
    runFind();
  });

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

    const quote = el('div', 'annot-quote', annotLabel(a));
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
    const palette = a.type === 'ink' ? Object.keys(INK_COLORS) : COLORS;
    for (const c of palette) {
      const s = el('button', 'mini-swatch' + (c === a.color ? ' sel' : ''));
      s.dataset.color = c;
      s.title = c;
      s.addEventListener('click', () => {
        a.color = c;
        palette.forEach((k) => card.classList.remove(k));
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
    const flags = S.doc.pageFlags[S.sbPage] || {};
    $$('#flagExam, #flagAsk').forEach((b) => b.setAttribute('aria-pressed', String(!!flags[b.dataset.flag])));
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

  function updateAllCount() {
    if (!S.doc) return;
    const n = S.doc.annotations.length + Object.values(S.doc.pageNotes).filter((v) => v && v.trim()).length;
    $('#allCount').textContent = n ? String(n) : '';
  }

  function renderAllPanel() {
    if (!S.doc) return;
    const q = $('#searchInput').value.trim().toLowerCase();
    const list = $('#allList');
    list.textContent = '';
    const match = (s) => !q || (s || '').toLowerCase().includes(q);
    let any = false;
    for (let n = 1; n <= S.doc.numPages; n++) {
      const flags = S.doc.pageFlags[n] || {};
      if (S.allFilter !== 'all' && !flags[S.allFilter]) continue;
      const pnote = (S.doc.pageNotes[n] || '').trim();
      const annots = annotsOnPage(n).filter((a) => match(a.text) || match(a.note));
      const showPN = pnote && match(pnote);
      const flaggedOnly = !q && (flags.exam || flags.ask);
      if (!showPN && !annots.length && !flaggedOnly) continue;
      any = true;
      const g = el('div', 'all-group');
      const h = el('h4', null, 'Page ' + n);
      if (flags.exam) h.appendChild(icon('star', 'flag-ic exam'));
      if (flags.ask) h.appendChild(icon('message-circle-question-mark', 'flag-ic ask'));
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
        appendMarked(qd, annotLabel(a, true), q);
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
    if (!any) {
      const msg = q ? 'Nothing matches your search.'
        : S.allFilter === 'exam' ? 'No pages marked as exam-relevant yet. Press E on a slide to mark it.'
          : S.allFilter === 'ask' ? 'No questions marked yet. Press Q on a slide when something is unclear.'
            : 'No notes yet. Notes and highlights for every page will appear here.';
      list.appendChild(el('p', 'muted small', msg));
    }
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#searchInput').addEventListener('input', renderAllPanel);

  $('#pageNote').addEventListener('input', (e) => {
    const v = e.target.value;
    const had = !!(S.doc.pageNotes[S.sbPage] || '').trim();
    if (v) S.doc.pageNotes[S.sbPage] = v;
    else delete S.doc.pageNotes[S.sbPage];
    if (had !== !!v.trim()) updateThumb(S.sbPage);
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

  // ------------------------------------------------------------------ page flags (⭐ exam / ❓ ask)
  const FLAG_ICONS = { exam: '⭐', ask: '❓' };
  function flagIcons(flags) {
    const icons = Object.keys(FLAG_ICONS).filter((k) => flags && flags[k]).map((k) => FLAG_ICONS[k]).join('');
    return icons ? ' ' + icons : '';
  }

  function toggleFlag(kind, n = S.sbPage) {
    if (!S.doc || !n) return;
    const f = { ...(S.doc.pageFlags[n] || {}) };
    if (f[kind]) delete f[kind];
    else f[kind] = true;
    if (Object.keys(f).length) S.doc.pageFlags[n] = f;
    else delete S.doc.pageFlags[n];
    scheduleSave();
    updateThumb(n);
    if (n === S.sbPage) {
      const flags = S.doc.pageFlags[n] || {};
      $$('#flagExam, #flagAsk').forEach((b) => b.setAttribute('aria-pressed', String(!!flags[b.dataset.flag])));
    }
    if (S.tab === 'all') renderAllPanel();
    const on = !!f[kind];
    toast(kind === 'exam'
      ? (on ? `Page ${n} marked as exam-relevant.` : `Page ${n}: exam mark removed.`)
      : (on ? `Page ${n} marked: you have a question about it.` : `Page ${n}: question mark removed.`));
  }

  // ------------------------------------------------------------------ thumbnails & outline
  const thumbsEl = $('#thumbs');
  const thumbList = $('#thumbList');
  const THUMB_W = 132;
  let thumbIO = null;
  const thumbTasks = new Set();

  function clearThumbs() {
    if (thumbIO) thumbIO.disconnect();
    thumbIO = null;
    for (const t of thumbTasks) t.cancel();
    thumbTasks.clear();
    thumbList.textContent = '';
    $('#outlineList').textContent = '';
    $('#thumbsTabs').hidden = true;
    switchThumbTab('pages');
  }

  function buildThumbs() {
    thumbList.textContent = '';
    thumbIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        renderThumb(S.pages[+e.target.dataset.page - 1]);
        thumbIO.unobserve(e.target);
      }
    }, { root: thumbList, rootMargin: '400px 0px' });
    for (const p of S.pages) {
      const b = el('button', 'thumb');
      b.dataset.page = String(p.num);
      b.setAttribute('aria-label', 'Page ' + p.num);
      const img = el('div', 'thumb-img');
      img.style.aspectRatio = `${p.baseW} / ${p.baseH}`;
      b.appendChild(img);
      const lab = el('div', 'thumb-label');
      lab.appendChild(el('span', 'thumb-num', String(p.num)));
      lab.appendChild(el('span', 'thumb-badges'));
      b.appendChild(lab);
      b.addEventListener('click', () => goToPage(p.num));
      p.thumb = b;
      thumbList.appendChild(b);
      thumbIO.observe(b);
    }
    loadOutline(S.pdf);
  }

  async function renderThumb(p) {
    if (!p || p.thumbDone || !p.thumb) return;
    p.thumbDone = true;
    const scale = (THUMB_W * Math.min(window.devicePixelRatio || 1, 2)) / p.baseW;
    const vp = p.page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const task = p.page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    thumbTasks.add(task);
    try {
      await task.promise;
    } catch (err) {
      p.thumbDone = false;
      return;
    } finally {
      thumbTasks.delete(task);
    }
    p.thumb.firstChild.appendChild(c);
  }

  function updateThumb(n) {
    const p = S.pages[n - 1];
    if (!p || !p.thumb || !S.doc) return;
    const notes = S.doc.annotations.filter((a) => a.page === n).length + ((S.doc.pageNotes[n] || '').trim() ? 1 : 0);
    const b = $('.thumb-badges', p.thumb);
    b.textContent = '';
    const f = S.doc.pageFlags[n] || {};
    if (f.exam) b.appendChild(icon('star', 'flag-ic exam'));
    if (f.ask) b.appendChild(icon('message-circle-question-mark', 'flag-ic ask'));
    if (notes) { b.appendChild(icon('sticky-note')); b.appendChild(document.createTextNode(String(notes))); }
  }

  function markCurrentThumb() {
    $$('.thumb.current', thumbList).forEach((t) => t.classList.remove('current'));
    const p = S.pages[S.currentPage - 1];
    if (!p || !p.thumb) return;
    p.thumb.classList.add('current');
    if (thumbsEl.hidden || thumbList.hidden) return;
    const t = p.thumb;
    if (t.offsetTop < thumbList.scrollTop) thumbList.scrollTop = t.offsetTop - 8;
    else if (t.offsetTop + t.offsetHeight > thumbList.scrollTop + thumbList.clientHeight) {
      thumbList.scrollTop = t.offsetTop + t.offsetHeight - thumbList.clientHeight + 8;
    }
  }

  function setThumbsOpen(on) {
    thumbsEl.hidden = !on;
    $('#btnThumbs').setAttribute('aria-pressed', String(on));
    $('#btnThumbs').classList.toggle('active', on);
    try { localStorage.setItem('thumbsOpen', on ? '1' : '0'); } catch (_) { /* ignore */ }
    if (on) requestAnimationFrame(markCurrentThumb);
  }

  function switchThumbTab(t) {
    $$('.ttab').forEach((b) => b.classList.toggle('active', b.dataset.ttab === t));
    thumbList.hidden = t !== 'pages';
    $('#outlineList').hidden = t !== 'outline';
    if (t === 'pages') requestAnimationFrame(markCurrentThumb);
  }

  async function loadOutline(pdf) {
    let outline = null;
    try { outline = await pdf.getOutline(); } catch (_) { /* no outline */ }
    if (pdf !== S.pdf || !outline || !outline.length) return;
    const root = $('#outlineList');
    root.textContent = '';
    const build = (items, depth) => {
      for (const it of items) {
        const b = el('button', 'outline-item', it.title || '(untitled)');
        b.style.paddingLeft = 10 + depth * 14 + 'px';
        b.addEventListener('click', async () => {
          const n = await destPage(pdf, it.dest);
          if (n && pdf === S.pdf) goToPage(n);
        });
        root.appendChild(b);
        if (it.items && it.items.length) build(it.items, depth + 1);
      }
    };
    build(outline, 0);
    $('#thumbsTabs').hidden = false;
  }

  async function destPage(pdf, dest) {
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return 0;
      const ref = dest[0];
      return (typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)) + 1;
    } catch (_) {
      return 0;
    }
  }

  // ------------------------------------------------------------------ drawing (pen, highlighter, eraser)
  // A drawing is an annotation of type 'ink': strokes are flat [x0, y0, x1, y1, ...] arrays in
  // page coordinates (0..1), so they stay attached to the slide at every zoom level.
  const D = {
    on: false,
    tool: 'pen',
    colors: { pen: 'black', marker: 'yellow' },
    sizes: { pen: 1, marker: 1 },
    live: null,     // stroke being drawn right now
    session: null,  // {id, page, key}: strokes in a row on one page join one drawing
    undo: [],
  };
  try { Object.assign(D, JSON.parse(localStorage.getItem('drawPrefs') || '{}')); } catch (_) { /* ignore */ }
  D.on = false;
  D.live = null;
  D.session = null;
  D.undo = [];
  if (!['pen', 'marker', 'eraser'].includes(D.tool)) D.tool = 'pen';
  const drawBar = $('#drawBar');

  function saveDrawPrefs() {
    try { localStorage.setItem('drawPrefs', JSON.stringify({ tool: D.tool, colors: D.colors, sizes: D.sizes })); } catch (_) { /* ignore */ }
  }

  function strokePath(pts, W, H) {
    const n = pts.length / 2;
    const X = (i) => (pts[2 * i] * W).toFixed(2);
    const Y = (i) => (pts[2 * i + 1] * H).toFixed(2);
    if (n === 1) return `M${X(0)} ${Y(0)}l0.01 0`;
    let d = `M${X(0)} ${Y(0)}`;
    if (n === 2) return d + `L${X(1)} ${Y(1)}`;
    for (let i = 1; i < n - 1; i++) {
      const mx = (((pts[2 * i] + pts[2 * i + 2]) / 2) * W).toFixed(2);
      const my = (((pts[2 * i + 1] + pts[2 * i + 3]) / 2) * H).toFixed(2);
      d += `Q${X(i)} ${Y(i)} ${mx} ${my}`;
    }
    return d + `L${X(n - 1)} ${Y(n - 1)}`;
  }

  function strokeStyle(el2, a, baseW) {
    el2.setAttribute('stroke', INK_COLORS[a.color] || INK_COLORS.black);
    el2.setAttribute('stroke-width', String(a.width * baseW));
    el2.setAttribute('class', a.tool === 'marker' ? 'ink marker' : 'ink');
  }

  function renderInk(p) {
    if (!p.inkLayer || !S.doc) return;
    p.inkLayer.textContent = '';
    for (const a of S.doc.annotations) {
      if (a.page !== p.num || a.type !== 'ink') continue;
      const g = document.createElementNS(SVGNS, 'g');
      g.dataset.id = a.id;
      if (a.id === S.activeId) g.classList.add('active');
      for (const pts of a.strokes) {
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', strokePath(pts, p.baseW, p.baseH));
        strokeStyle(path, a, p.baseW);
        g.appendChild(path);
      }
      p.inkLayer.appendChild(g);
    }
  }

  function drawInkOnCanvas(ctx, a, W, H) {
    ctx.strokeStyle = INK_COLORS[a.color] || INK_COLORS.black;
    ctx.lineWidth = a.width * W;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a.tool === 'marker' ? 0.4 : 1;
    if (a.tool === 'marker') ctx.globalCompositeOperation = 'multiply';
    for (const pts of a.strokes) ctx.stroke(new Path2D(strokePath(pts, W, H)));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Distance (in PDF points) from a point to the nearest stroke of a drawing.
  function inkDistance(a, x, y, strokeIndex) {
    const p = S.pages[a.page - 1];
    const W = p.baseW;
    const H = p.baseH;
    const px = x * W;
    const py = y * H;
    let best = Infinity;
    a.strokes.forEach((pts, si) => {
      if (strokeIndex !== undefined && si !== strokeIndex) return;
      for (let i = 0; i < pts.length; i += 2) {
        const ax = pts[i] * W;
        const ay = pts[i + 1] * H;
        const bx = (i + 2 < pts.length ? pts[i + 2] : pts[i]) * W;
        const by = (i + 2 < pts.length ? pts[i + 3] : pts[i + 1]) * H;
        const dx = bx - ax;
        const dy = by - ay;
        const t = dx || dy ? clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
        best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
      }
    });
    return best;
  }
  const nearInk = (a, x, y, tol) => inkDistance(a, x, y) <= tol + (a.width * S.pages[a.page - 1].baseW) / 2;

  function inkBounds(a) {
    const p = S.pages[a.page - 1];
    const padX = a.width / 2 + 0.004;
    const padY = (a.width * p.baseW) / p.baseH / 2 + 0.004;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const pts of a.strokes) {
      for (let i = 0; i < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
        y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
      }
    }
    x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY);
    x1 = Math.min(1, x1 + padX); y1 = Math.min(1, y1 + padY);
    return [[+x0.toFixed(5), +y0.toFixed(5), +(x1 - x0).toFixed(5), +(y1 - y0).toFixed(5)]];
  }

  const snapshot = (a) => (a ? JSON.parse(JSON.stringify(a)) : null);

  function afterInkChange(pages) {
    scheduleSave();
    for (const n of pages) renderHighlights(n);
    if (pages.has(S.sbPage)) renderPagePanel();
    if (S.tab === 'all') renderAllPanel();
  }

  function setDrawMode(on) {
    if (on && !S.doc) return;
    if (on && S.areaMode) setAreaMode(false);
    D.on = on;
    D.session = null;
    D.live = null;
    if (!on) D.undo = [];
    document.body.classList.toggle('draw-mode', on);
    syncTools();
    drawBar.hidden = !on;
    if (on) {
      hideSelToolbar();
      window.getSelection().removeAllRanges();
      syncDrawBar();
    }
  }

  function syncDrawBar() {
    const t = D.tool === 'eraser' ? null : D.tool;
    $$('.dtool', drawBar).forEach((b) => b.classList.toggle('active', b.dataset.tool === D.tool));
    $$('.dcolor', drawBar).forEach((b) => {
      b.classList.toggle('active', !!t && b.dataset.color === D.colors[t]);
      b.disabled = !t;
    });
    $$('.dsize', drawBar).forEach((b) => {
      b.classList.toggle('active', !!t && +b.dataset.size === D.sizes[t]);
      b.disabled = !t;
      b.classList.toggle('marker', D.tool === 'marker');
    });
    $('#drawUndo').disabled = !D.undo.length;
    document.body.classList.toggle('erasing', D.tool === 'eraser');
  }

  function pagePoint(e, live) {
    return {
      x: clamp((e.clientX - live.rect.left) / live.rect.width, 0, 1),
      y: clamp((e.clientY - live.rect.top) / live.rect.height, 0, 1),
    };
  }

  function eraseAt(live, e) {
    const pt = pagePoint(e, live);
    const tol = (10 / live.rect.width) * live.p.baseW; // ~10 screen pixels, in PDF points
    let changed = false;
    for (let i = S.doc.annotations.length - 1; i >= 0; i--) {
      const a = S.doc.annotations[i];
      if (a.type !== 'ink' || a.page !== live.p.num) continue;
      const half = (a.width * live.p.baseW) / 2;
      const keep = a.strokes.filter((_, si) => inkDistance(a, pt.x, pt.y, si) > tol + half);
      if (keep.length === a.strokes.length) continue;
      if (!live.before.has(a.id)) live.before.set(a.id, snapshot(a));
      changed = true;
      if (keep.length) {
        a.strokes = keep;
        a.rects = inkBounds(a);
      } else {
        S.doc.annotations.splice(i, 1);
        if (S.activeId === a.id) S.activeId = null;
      }
    }
    if (changed) afterInkChange(new Set([live.p.num]));
  }

  function addLivePoint(e) {
    const live = D.live;
    if (Math.hypot(e.clientX - live.lastX, e.clientY - live.lastY) < 1.5) return;
    live.lastX = e.clientX;
    live.lastY = e.clientY;
    const pt = pagePoint(e, live);
    live.pts.push(+pt.x.toFixed(4), +pt.y.toFixed(4));
  }

  let inkRaf = 0;
  function paintLive() {
    inkRaf = 0;
    const live = D.live;
    if (live && live.path) live.path.setAttribute('d', strokePath(live.pts, live.p.baseW, live.p.baseH));
  }

  function finishStroke() {
    const live = D.live;
    D.live = null;
    if (!live) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (live.tool === 'eraser') {
      if (live.before.size) D.undo.push([...live.before].map(([id, before]) => ({ id, before })));
      syncDrawBar();
      return;
    }
    if (live.path) live.path.remove();
    if (!live.pts.length) return;
    const n = live.p.num;
    const key = `${live.tool}|${live.color}|${live.width}`;
    let a = D.session && D.session.page === n && D.session.key === key && S.doc.annotations.find((x) => x.id === D.session.id);
    D.undo.push([{ id: a ? a.id : null, before: snapshot(a) }]);
    if (a) {
      a.strokes.push(live.pts);
      a.updatedAt = Date.now();
    } else {
      a = { id: uid(), type: 'ink', page: n, tool: live.tool, color: live.color, width: live.width, strokes: [live.pts], text: '', note: '', createdAt: Date.now() };
      S.doc.annotations.push(a);
      D.undo[D.undo.length - 1][0].id = a.id;
      D.session = { id: a.id, page: n, key };
    }
    a.rects = inkBounds(a);
    afterInkChange(new Set([n]));
    syncDrawBar();
  }

  function drawUndo() {
    const entry = D.undo.pop();
    if (!entry || !S.doc) return;
    const pages = new Set();
    for (const { id, before } of entry.slice().reverse()) {
      const i = S.doc.annotations.findIndex((x) => x.id === id);
      if (i >= 0) pages.add(S.doc.annotations[i].page);
      if (!before) { if (i >= 0) S.doc.annotations.splice(i, 1); }
      else if (i >= 0) S.doc.annotations[i] = before;
      else S.doc.annotations.push(before);
      if (before) pages.add(before.page);
    }
    D.session = null;
    afterInkChange(pages);
    syncDrawBar();
  }

  pagesEl.addEventListener('pointerdown', (e) => {
    if (!D.on || !S.doc || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pageDiv = e.target.closest('.page');
    if (!pageDiv) return;
    e.preventDefault();
    const p = S.pages[+pageDiv.dataset.page - 1];
    try { pageDiv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const tool = D.tool;
    D.live = { p, pointerId: e.pointerId, tool, rect: pageDiv.getBoundingClientRect(), pts: [], lastX: -1e9, lastY: -1e9, before: new Map() };
    if (tool === 'eraser') { eraseAt(D.live, e); return; }
    D.live.color = D.colors[tool];
    D.live.width = +(INK_SIZES[tool][D.sizes[tool]] / p.baseW).toFixed(5);
    const path = document.createElementNS(SVGNS, 'path');
    strokeStyle(path, D.live, p.baseW);
    p.inkLayer.appendChild(path);
    D.live.path = path;
    addLivePoint(e);
    paintLive();
  });
  pagesEl.addEventListener('pointermove', (e) => {
    const live = D.live;
    if (!live || e.pointerId !== live.pointerId) return;
    live.rect = live.p.div.getBoundingClientRect();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      if (live.tool === 'eraser') eraseAt(live, ev);
      else addLivePoint(ev);
    }
    if (live.tool !== 'eraser' && !inkRaf) inkRaf = requestAnimationFrame(paintLive);
  });
  ['pointerup', 'pointercancel'].forEach((t) => pagesEl.addEventListener(t, (e) => {
    if (D.live && e.pointerId === D.live.pointerId) finishStroke();
  }));

  $('#btnDraw').addEventListener('click', () => setDrawMode(!D.on));
  $('#drawDone').addEventListener('click', () => setDrawMode(false));
  $('#drawUndo').addEventListener('click', drawUndo);
  $$('.dtool', drawBar).forEach((b) => b.addEventListener('click', () => { D.tool = b.dataset.tool; D.session = null; saveDrawPrefs(); syncDrawBar(); }));
  $$('.dcolor', drawBar).forEach((b) => b.addEventListener('click', () => {
    if (D.tool === 'eraser') return;
    D.colors[D.tool] = b.dataset.color;
    D.session = null;
    saveDrawPrefs();
    syncDrawBar();
  }));
  $$('.dsize', drawBar).forEach((b) => b.addEventListener('click', () => {
    if (D.tool === 'eraser') return;
    D.sizes[D.tool] = +b.dataset.size;
    D.session = null;
    saveDrawPrefs();
    syncDrawBar();
  }));

  // ------------------------------------------------------------------ search in the slides
  // The browser's own Ctrl+F only sees pages that are rendered, so search the PDF text directly.
  const F = { q: '', matches: [], idx: -1, run: 0 };
  const findBar = $('#findBar');
  const findInput = $('#findInput');

  // Lower-case character by character so offsets stay aligned with the original text.
  function fold(str) {
    let out = '';
    for (const ch of str) {
      const l = ch.toLowerCase();
      out += l.length === ch.length ? l : ch;
    }
    return out.replace(/\s/g, ' ');
  }

  // A page's text as one string, plus where each text-layer span starts in it.
  function pageTextIndex(p) {
    if (p.textIndex) return p.textIndex;
    let text = '';
    const starts = [];
    const lens = [];
    for (const it of p.textContent.items) {
      if (it.str === undefined) continue;
      starts.push(text.length);
      lens.push(it.str.length);
      text += it.str;
      if (it.hasEOL) text += ' ';
    }
    p.textIndex = { folded: fold(text), starts, lens };
    return p.textIndex;
  }

  function locate(p, idx, off, isEnd) {
    for (let i = 0; i < idx.starts.length; i++) {
      const a = idx.starts[i];
      const b = a + idx.lens[i];
      if (isEnd ? (off > a && off <= b) : (off >= a && off < b)) {
        const t = p.textDivs[i] && p.textDivs[i].firstChild;
        return t ? [t, Math.min(off - a, t.length)] : [null, 0];
      }
    }
    return [null, 0];
  }

  function renderFindHits(p) {
    if (!p || !p.findLayer) return;
    p.findLayer.textContent = '';
    if (!F.q || !F.matches.length || !p.textDivs || !p.textContent) return;
    const idx = pageTextIndex(p);
    const pr = p.div.getBoundingClientRect();
    F.matches.forEach((m, k) => {
      if (m.page !== p.num) return;
      const [sn, so] = locate(p, idx, m.start, false);
      const [en, eo] = locate(p, idx, m.end, true);
      if (!sn || !en) return;
      const range = document.createRange();
      try { range.setStart(sn, so); range.setEnd(en, eo); } catch (_) { return; }
      const raw = Array.from(range.getClientRects())
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .map((r) => ({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height }));
      for (const q of mergeRects(raw)) {
        const d = el('div', 'find-hit' + (k === F.idx ? ' current' : ''));
        d.dataset.k = String(k);
        d.style.left = (q.x / pr.width) * 100 + '%';
        d.style.top = (q.y / pr.height) * 100 + '%';
        d.style.width = (q.w / pr.width) * 100 + '%';
        d.style.height = (q.h / pr.height) * 100 + '%';
        p.findLayer.appendChild(d);
      }
    });
  }

  function updateFindCount() {
    const n = F.matches.length;
    $('#findCount').textContent = !F.q ? '' : n ? `${F.idx + 1} of ${n}` : 'No matches';
    findInput.classList.toggle('no-match', !!F.q && !n);
  }

  async function runFind() {
    const q = fold(findInput.value.trim()).replace(/ +/g, ' ');
    const run = ++F.run;
    F.q = q;
    F.matches = [];
    F.idx = -1;
    S.pages.forEach((p) => { p.findLayer.textContent = ''; });
    if (!q || !S.doc) { updateFindCount(); return; }
    $('#findCount').textContent = 'Searching…';
    const pages = S.pages;
    for (const p of pages) {
      if (!p.textContent) {
        try { p.textContent = await p.page.getTextContent(); } catch (_) { continue; }
      }
      if (run !== F.run || pages !== S.pages) return;
      const { folded } = pageTextIndex(p);
      for (let i = folded.indexOf(q); i >= 0; i = folded.indexOf(q, i + q.length)) {
        F.matches.push({ page: p.num, start: i, end: i + q.length });
      }
    }
    if (!F.matches.length) { updateFindCount(); return; }
    const from = F.matches.findIndex((m) => m.page >= S.currentPage);
    S.pages.forEach(renderFindHits);
    showMatch(from < 0 ? 0 : from);
  }

  async function showMatch(k) {
    if (!F.matches.length) return;
    F.idx = (k + F.matches.length) % F.matches.length;
    updateFindCount();
    const m = F.matches[F.idx];
    const p = S.pages[m.page - 1];
    $$('.find-hit.current').forEach((d) => d.classList.remove('current'));
    if (S.currentPage !== m.page || !p.textDivs) goToPage(m.page, false);
    for (let i = 0; i < 80 && !(p.textDivs && p.renderedScale === S.scale); i++) await new Promise((r) => setTimeout(r, 50));
    if (F.matches[F.idx] !== m) return;
    renderFindHits(p);
    const hit = $('.find-hit.current', p.findLayer);
    if (!hit) return;
    const y = p.div.offsetTop + hit.offsetTop;
    if (y < viewer.scrollTop + 30 || y + hit.offsetHeight > viewer.scrollTop + viewer.clientHeight - 30) {
      S.navLock = true;
      clearTimeout(navLockTimer);
      navLockTimer = setTimeout(() => { S.navLock = false; }, 100);
      viewer.scrollTop = y - viewer.clientHeight * 0.35;
    }
    const x = p.div.offsetLeft + hit.offsetLeft;
    if (x < viewer.scrollLeft || x > viewer.scrollLeft + viewer.clientWidth - 40) viewer.scrollLeft = x - 40;
    if (S.currentPage !== m.page) setCurrentPage(m.page);
  }

  function openFind() {
    if (!S.doc) return;
    const sel = selectionInTextLayer();
    findBar.hidden = false;
    if (sel) {
      const t = sel.toString().replace(/\s+/g, ' ').trim();
      if (t && t.length < 80) findInput.value = t;
    }
    findInput.focus();
    findInput.select();
    if (findInput.value.trim() && fold(findInput.value.trim()).replace(/ +/g, ' ') !== F.q) runFind();
  }

  function resetFind() {
    F.run++;
    F.q = '';
    F.matches = [];
    F.idx = -1;
    updateFindCount();
  }

  function closeFind() {
    findBar.hidden = true;
    resetFind();
    S.pages.forEach((p) => { p.findLayer.textContent = ''; });
    viewer.focus({ preventScroll: true });
  }

  let findTimer = 0;
  findInput.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(runFind, 250);
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(findTimer);
      if (fold(findInput.value.trim()).replace(/ +/g, ' ') !== F.q) runFind();
      else showMatch(F.idx + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  $('#findNext').addEventListener('click', () => showMatch(F.idx + 1));
  $('#findPrev').addEventListener('click', () => showMatch(F.idx - 1));
  $('#findClose').addEventListener('click', closeFind);
  $('#btnFind').addEventListener('click', () => (findBar.hidden ? openFind() : closeFind()));

  // ------------------------------------------------------------------ study mode (flashcards)
  // Every highlight with a note is a card. Simple spaced repetition (Leitner boxes).
  const studyDialog = $('#studyDialog');
  const ST = { queue: [], cur: null, shown: false, reviewed: 0, again: 0, dir: 'hl', crops: new Map() };
  const studyCards = () => S.doc.annotations.filter(hasNote);
  const isDue = (a) => !a.srs || a.srs.due <= Date.now();
  const onExamPage = (a) => !!(S.doc.pageFlags[a.page] || {}).exam;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function showStudyPane(which) {
    $('#studySetup').hidden = which !== 'setup';
    $('#studyCard').hidden = which !== 'card';
    $('#studyDone').hidden = which !== 'done';
  }

  function openStudy() {
    if (!S.doc) return;
    flushSave();
    hideSelToolbar();
    const all = studyCards();
    const due = all.filter(isDue).length;
    const exam = all.filter(onExamPage).length;
    $('#studySummary').textContent = all.length
      ? `${plural(all.length, 'card')} in this lecture · ${due} due for review${exam ? ` · ${exam} on exam pages` : ''}`
      : 'No cards yet. Highlight something on a slide and write a note about it, and it becomes a flashcard.';
    $('#studyOptions').hidden = !all.length;
    $('#studyScope').value = due ? 'due' : 'all';
    $('#studyProgress').textContent = '';
    showStudyPane('setup');
    if (!studyDialog.open) studyDialog.showModal();
    if (all.length) $('#studyStart').focus();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function startStudy() {
    const scope = $('#studyScope').value;
    ST.dir = $('#studyDir').value;
    let list = studyCards();
    if (scope === 'due') list = list.filter(isDue);
    if (scope === 'exam') list = list.filter(onExamPage);
    if (!list.length) {
      toast(scope === 'due' ? 'Nothing is due right now. Choose "All cards" to practise anyway.' : 'No cards on exam pages yet.', 4000);
      return;
    }
    ST.queue = shuffle(list.slice());
    ST.total = list.length;
    ST.reviewed = 0;
    ST.again = 0;
    nextCard();
  }

  async function cropArea(a) {
    const key = a.id + JSON.stringify(a.rects[0]);
    if (ST.crops.has(key)) return ST.crops.get(key);
    const p = S.pages[a.page - 1];
    let [x, y, w, h] = a.rects[0];
    if (a.type === 'ink') { // a little context around a drawing
      const m = 0.04;
      x = Math.max(0, x - m); y = Math.max(0, y - m);
      w = Math.min(1 - x, w + 2 * m); h = Math.min(1 - y, h + 2 * m);
    }
    const scale = clamp(900 / Math.max(1, w * p.baseW), 0.5, 4);
    const vp = p.page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * vp.width));
    c.height = Math.max(1, Math.round(h * vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await p.page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x * vp.width, -y * vp.height] }).promise;
    if (a.type === 'ink') {
      ctx.setTransform(scale, 0, 0, scale, -x * vp.width, -y * vp.height);
      drawInkOnCanvas(ctx, a, p.baseW, p.baseH);
    }
    const url = c.toDataURL('image/png');
    ST.crops.set(key, url);
    return url;
  }

  function fillFace(box, a, kind) {
    box.textContent = '';
    if (kind === 'note') {
      box.appendChild(el('div', 'face-note', a.note.trim()));
      return;
    }
    if (a.type === 'area' || a.type === 'ink') {
      const img = el('img', 'face-img');
      img.alt = 'Area on page ' + a.page;
      box.appendChild(img);
      cropArea(a).then((url) => { img.src = url; }).catch(() => { img.replaceWith(el('div', 'face-quote', annotLabel(a))); });
    } else {
      box.appendChild(el('div', 'face-quote', `“${a.text}”`));
    }
  }

  function nextCard() {
    const a = ST.queue.shift();
    if (!a) { finishStudy(); return; }
    ST.cur = a;
    ST.shown = false;
    showStudyPane('card');
    $('#studyProgress').textContent = `${ST.queue.length + 1} left`;
    $('#cardWhere').textContent = 'Page ' + a.page + (onExamPage(a) ? ' · exam page' : '');
    fillFace($('#cardFront'), a, ST.dir === 'hl' ? 'hl' : 'note');
    fillFace($('#cardBack'), a, ST.dir === 'hl' ? 'note' : 'hl');
    $('#cardBack').hidden = true;
    $('#cardReveal').hidden = false;
    $('#cardGrade').hidden = true;
    $('#btnReveal').focus();
  }

  function revealCard() {
    if (!ST.cur || ST.shown) return;
    ST.shown = true;
    $('#cardBack').hidden = false;
    $('#cardReveal').hidden = true;
    $('#cardGrade').hidden = false;
    $('#cardGrade [data-grade="good"]').focus();
  }

  function gradeCard(g) {
    const a = ST.cur;
    if (!a || !ST.shown) return;
    const box = a.srs ? a.srs.box : 0;
    const nb = clamp(g === 'again' ? 0 : g === 'good' ? box + 1 : box + 2, 0, SRS_DAYS.length - 1);
    a.srs = { box: nb, due: g === 'again' ? Date.now() : Date.now() + SRS_DAYS[nb] * DAY, last: Date.now() };
    ST.reviewed++;
    if (g === 'again') {
      ST.again++;
      ST.queue.splice(Math.min(3, ST.queue.length), 0, a); // show it again in a moment
    }
    scheduleSave();
    nextCard();
  }

  function finishStudy() {
    ST.cur = null;
    showStudyPane('done');
    $('#studyProgress').textContent = '';
    const future = studyCards().filter((a) => !isDue(a)).map((a) => a.srs.due);
    let when = '';
    if (future.length) {
      const days = Math.max(1, Math.round((Math.min(...future) - Date.now()) / DAY));
      when = days === 1 ? ' Next review: tomorrow.' : ` Next review: in ${days} days.`;
    }
    $('#studyDoneText').textContent = `Done! You reviewed ${plural(ST.reviewed, 'card')}`
      + (ST.again ? ` (${ST.again} needed another try)` : '') + '.' + when;
    $('#studyFinish').focus();
  }

  function exportAnki() {
    const d = S.doc;
    const list = studyCards().sort((a, b) => a.page - b.page);
    if (!list.length) { toast('No flashcards yet: write a note on a highlight first.', 4000); return; }
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const deck = baseName(d.name).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'lecture';
    const lines = ['#separator:tab', '#html:true', '#tags column:3'];
    for (const a of list) {
      const front = (a.text ? esc(a.text) : `<i>${a.type === 'ink' ? 'Drawing' : 'Area'} on page ${a.page}</i>`) + `<br><small>${esc(baseName(d.name))}, page ${a.page}</small>`;
      const tags = [`uni-pdf::${deck}`, `page_${a.page}`].concat(onExamPage(a) ? ['exam'] : []).join(' ');
      lines.push(`${front}\t${esc(a.note.trim())}\t${tags}`);
    }
    download(`${baseName(d.name)} - flashcards (Anki).txt`, lines.join('\n') + '\n', 'text/plain');
    toast(`${plural(list.length, 'flashcard')} saved. In Anki: File → Import, then choose this file.`, 5000);
  }

  $('#btnStudy').addEventListener('click', openStudy);
  $('#studyStart').addEventListener('click', startStudy);
  $('#studyClose').addEventListener('click', () => studyDialog.close());
  $('#studyFinish').addEventListener('click', () => studyDialog.close());
  $('#studyAgain').addEventListener('click', openStudy);
  $('#btnReveal').addEventListener('click', revealCard);
  $$('#cardGrade [data-grade]').forEach((b) => b.addEventListener('click', () => gradeCard(b.dataset.grade)));
  $('#cardOpen').addEventListener('click', () => {
    const a = ST.cur;
    studyDialog.close();
    if (a) { selectAnnot(a.id, false); scrollToAnnot(a); }
  });
  studyDialog.addEventListener('keydown', (e) => {
    if ($('#studyCard').hidden || e.target.tagName === 'SELECT') return;
    if ((e.key === ' ' || e.key === 'Enter') && !ST.shown) { e.preventDefault(); revealCard(); }
    else if (ST.shown && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); gradeCard(['again', 'good', 'easy'][+e.key - 1]); }
  });
  studyDialog.addEventListener('close', () => { ST.queue = []; ST.cur = null; });

  // ------------------------------------------------------------------ library: search + full backup
  let libDocs = [];
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  function snippet(text, q) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length <= 160) return t;
    const start = Math.max(0, t.toLowerCase().indexOf(q) - 60);
    return (start > 0 ? '…' : '') + t.slice(start, start + 160) + (start + 160 < t.length ? '…' : '');
  }

  function libraryHits(q) {
    const hits = [];
    const has = (t) => (t || '').toLowerCase().includes(q);
    for (const d of libDocs) {
      if (has(d.docNote)) hits.push({ d, page: 0, text: d.docNote, label: 'Lecture notes' });
      for (const [n, t] of Object.entries(d.pageNotes || {})) if (has(t)) hits.push({ d, page: +n, text: t });
      for (const a of d.annotations || []) {
        if (has(a.note) || has(a.text)) hits.push({ d, page: a.page, text: has(a.note) ? a.note : a.text });
      }
    }
    return hits.sort((x, y) => (x.d.name.localeCompare(y.d.name)) || (x.page - y.page));
  }

  function drawLibHits(q) {
    const box = $('#libHits');
    box.textContent = '';
    box.hidden = !q;
    if (!q) return new Set();
    const hits = libraryHits(q);
    box.appendChild(el('div', 'lib-hits-head small muted', hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'} in your notes` : 'No notes match.'));
    for (const h of hits.slice(0, 100)) {
      const it = el('button', 'lib-hit');
      it.appendChild(el('div', 'lib-hit-where', baseName(h.d.name) + ' · ' + (h.label || 'page ' + h.page)));
      const body = el('div', 'lib-hit-text');
      appendMarked(body, snippet(h.text, q), q);
      it.appendChild(body);
      it.addEventListener('click', async () => {
        await openDoc(h.d.id, h.page ? { page: h.page } : {});
        if (!h.page) { showSidebar(); switchTab('doc'); }
      });
      box.appendChild(it);
    }
    return new Set(hits.map((h) => h.d.id));
  }

  async function backupAll() {
    await flushSave();
    const docs = await DB.all('docs');
    if (!docs.length) return;
    toast('Preparing backup…', 60000);
    try {
      const parts = [`{"app":"uni-pdf-library","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"docs":[`];
      for (let i = 0; i < docs.length; i++) {
        const blob = await DB.get('files', docs[i].id);
        const pdf = blob ? await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1]);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        }) : null;
        parts.push((i ? ',' : '') + JSON.stringify({ rec: docs[i], pdf }));
      }
      parts.push(']}');
      download(`uni-pdf backup ${new Date().toISOString().slice(0, 10)}.json`, new Blob(parts), 'application/json');
      toast(`Backed up ${plural(docs.length, 'lecture')} with all notes. Keep the file somewhere safe.`, 5000);
    } catch (err) {
      toast('Backup failed: ' + err.message, 5000);
    }
  }

  async function restoreAll(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app === 'lecture-pdf-notes') throw new Error('this is a backup of a single lecture. Open that PDF, then use Export → Restore notes from backup.');
      if (data.app !== 'uni-pdf-library' || !Array.isArray(data.docs)) throw new Error('not a uni-pdf full backup file.');
      const existing = new Map((await DB.all('docs')).map((d) => [d.id, d]));
      const notesOf = (r) => JSON.stringify([r.docNote || '', r.pageNotes || {}, r.pageFlags || {}, r.annotations || []]);
      const conflicts = data.docs.filter(({ rec }) => rec && existing.has(rec.id) && notesOf(existing.get(rec.id)) !== notesOf(rec));
      let replace = true;
      if (conflicts.length) {
        replace = await ask({
          title: 'Some lectures are already here',
          body: `${plural(conflicts.length, 'lecture')} in the backup ${conflicts.length === 1 ? 'is' : 'are'} already in your library with different notes.`,
          ok: 'Use the notes from the backup',
          cancel: 'Keep my current notes',
        });
      }
      if (S.doc) { clearTimeout(saveTimer); saveTimer = null; await closeDoc(); }
      let added = 0;
      let updated = 0;
      for (const { rec, pdf } of data.docs) {
        if (!rec || !rec.id) continue;
        const hasFile = !!(await DB.get('files', rec.id));
        if (!hasFile && !pdf) continue;
        if (!hasFile) await DB.put('files', new Blob([b64ToBytes(pdf)], { type: 'application/pdf' }), rec.id);
        const had = existing.get(rec.id);
        if (!had) { await DB.put('docs', rec); added++; }
        else if (replace && notesOf(had) !== notesOf(rec)) {
          await DB.put('docs', { ...had, docNote: rec.docNote || '', pageNotes: rec.pageNotes || {}, pageFlags: rec.pageFlags || {}, annotations: rec.annotations || [] });
          updated++;
        }
      }
      await renderLibrary();
      toast(`Backup restored: ${added} added, ${updated} updated.`, 4000);
    } catch (err) {
      toast('Restore failed: ' + err.message, 6000);
    }
  }

  let libTimer = 0;
  $('#libSearch').addEventListener('input', () => { clearTimeout(libTimer); libTimer = setTimeout(drawLibrary, 150); });
  $('#btnBackupAll').addEventListener('click', backupAll);
  $('#btnRestoreAll').addEventListener('click', () => $('#restoreAllInput').click());
  $('#restoreAllInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) restoreAll(f);
  });

  // Panels: thumbnails, flags, filter chips
  $('#btnThumbs').addEventListener('click', () => setThumbsOpen(thumbsEl.hidden));
  $$('.ttab').forEach((b) => b.addEventListener('click', () => switchThumbTab(b.dataset.ttab)));
  try { if (localStorage.getItem('thumbsOpen') === '1') setThumbsOpen(true); } catch (_) { /* ignore */ }
  $$('#flagExam, #flagAsk').forEach((b) => b.addEventListener('click', () => toggleFlag(b.dataset.flag)));
  $$('.chip[data-filter]').forEach((c) => c.addEventListener('click', () => {
    S.allFilter = c.dataset.filter;
    $$('.chip[data-filter]').forEach((x) => x.classList.toggle('active', x === c));
    renderAllPanel();
  }));

  // ------------------------------------------------------------------ command palette (Ctrl+K)
  const cmdk = $('#cmdk');
  const cmdkInput = $('#cmdkInput');
  const cmdkList = $('#cmdkList');
  let cmdItems = [];
  let cmdSel = 0;

  function commands() {
    const inDoc = !!S.doc && !$('#reader').hidden;
    const c = [];
    const add = (group, ic, title, run, hint, when = true) => { if (when) c.push({ group, ic, title, run, hint }); };
    add('Actions', 'file-plus', 'Open a PDF…', () => $('#fileInput').click(), 'O');
    add('Actions', 'search', 'Search in the slides', openFind, 'Ctrl F', inDoc);
    add('Actions', 'graduation-cap', 'Study flashcards', openStudy, 'S', inDoc);
    add('Actions', 'pencil', 'Draw', () => setDrawMode(true), 'D', inDoc);
    add('Actions', 'square-dashed', 'Area note', () => setAreaMode(true), 'A', inDoc);
    add('Actions', 'sticky-note', 'Write a note for this page', () => { showSidebar(); switchTab('page'); $('#pageNote').focus(); }, 'P', inDoc);
    add('Actions', 'star', 'Mark page as exam-relevant', () => toggleFlag('exam'), 'E', inDoc);
    add('Actions', 'message-circle-question-mark', 'Mark page: question to ask', () => toggleFlag('ask'), 'Q', inDoc);
    add('Actions', 'panel-left', 'Show or hide page thumbnails', () => setThumbsOpen(thumbsEl.hidden), 'T', inDoc);
    add('Actions', 'panel-right', 'Show or hide the notes panel', () => $('#btnSidebar').click(), '\\', inDoc);
    add('Export', 'file-down', 'Export PDF with notes', () => exportPdf(false), '', inDoc);
    add('Export', 'file-text', 'Export editable PDF', () => exportPdf(true), '', inDoc);
    add('Export', 'notebook-pen', 'Export notes as Markdown', exportMarkdown, '', inDoc);
    add('Export', 'sparkles', 'Export flashcards for Anki', exportAnki, '', inDoc);
    add('Export', 'hard-drive-download', 'Back up this lecture', exportJson, '', inDoc);
    add('Library', 'library', 'Go to the library', showLibrary, 'L', inDoc);
    add('Library', 'hard-drive-download', 'Back up everything', backupAll, '', libDocs.length > 0);
    add('Library', 'sparkles', 'Open the demo lecture', openSample);
    for (const t of ['light', 'dark', 'system']) {
      add('Theme', t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor', `Theme: ${t === 'system' ? 'same as my device' : t}`, () => $(`[data-theme-set="${t}"]`).click());
    }
    for (const nc of COLORS) {
      add('Note color', 'highlighter', `Default note color: ${nc}`, () => { setNoteColor(nc); toast(`New notes will be ${nc}.`); }, nc === noteColor ? '✓' : '');
    }
    add('Help', 'keyboard', 'Keyboard shortcuts', openHelp, '?');
    for (const d of libDocs) add('Lectures', 'file-text', baseName(d.name), () => openDoc(d.id), d.course || '');
    return c;
  }

  function drawCmdk() {
    const q = cmdkInput.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    cmdItems = commands().filter((c) => words.every((w) => (c.title + ' ' + c.group + ' ' + (c.hint || '')).toLowerCase().includes(w)));
    cmdSel = clamp(cmdSel, 0, Math.max(0, cmdItems.length - 1));
    cmdkList.textContent = '';
    if (!cmdItems.length) { cmdkList.appendChild(el('div', 'cmdk-empty', 'Nothing found.')); return; }
    let group = null;
    cmdItems.forEach((c, i) => {
      if (c.group !== group) { group = c.group; cmdkList.appendChild(el('div', 'cmdk-group', group)); }
      const b = el('button', 'cmdk-item' + (i === cmdSel ? ' sel' : ''));
      b.setAttribute('role', 'option');
      b.appendChild(icon(c.ic));
      b.appendChild(el('span', 't', c.title));
      if (c.hint) b.appendChild(el(c.group === 'Lectures' ? 'span' : 'kbd', c.group === 'Lectures' ? 'muted small' : null, c.hint));
      b.addEventListener('click', () => runCmd(i));
      b.addEventListener('mousemove', () => { if (cmdSel !== i) { cmdSel = i; markCmd(); } });
      cmdkList.appendChild(b);
    });
  }

  function markCmd() {
    $$('.cmdk-item', cmdkList).forEach((b, i) => b.classList.toggle('sel', i === cmdSel));
    const cur = $$('.cmdk-item', cmdkList)[cmdSel];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function runCmd(i) {
    const c = cmdItems[i];
    cmdk.close();
    if (c) setTimeout(() => c.run(), 0);
  }

  async function openCmdk() {
    if (cmdk.open) return;
    for (const d of [helpDialog, studyDialog]) if (d.open) d.close();
    setMenu(false);
    cmdkInput.value = '';
    cmdSel = 0;
    drawCmdk();
    cmdk.showModal();
    cmdkInput.focus();
    // Refresh the lecture list in the background so typing is never lost.
    try { libDocs = (await DB.all('docs')).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)); } catch (_) { /* keep */ }
    if (cmdk.open) drawCmdk();
  }

  cmdkInput.addEventListener('input', () => { cmdSel = 0; drawCmdk(); });
  cmdkInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdSel = Math.min(cmdItems.length - 1, cmdSel + 1); markCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSel = Math.max(0, cmdSel - 1); markCmd(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdSel); }
  });
  cmdk.addEventListener('click', (e) => { if (e.target === cmdk) cmdk.close(); });

  // ------------------------------------------------------------------ phone: notes panel as a bottom sheet
  (() => {
    const handle = $('#sheetHandle');
    const sheet = $('#sidebar');
    const SNAP = [18, 42, 80];
    let snap = 1;
    const setH = (pct) => sheet.style.setProperty('--sheet-h', pct + '%');
    handle.addEventListener('pointerdown', (e) => {
      const startY = e.clientY;
      const startH = sheet.getBoundingClientRect().height;
      const total = $('#reader').getBoundingClientRect().height;
      let moved = false;
      handle.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
      const move = (ev) => {
        if (Math.abs(ev.clientY - startY) > 4) moved = true;
        setH(clamp(((startH + startY - ev.clientY) / total) * 100, 12, 88));
      };
      const up = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        sheet.classList.remove('dragging');
        if (!moved) snap = (snap + 1) % SNAP.length;
        else {
          const pct = ((startH + startY - ev.clientY) / total) * 100;
          snap = SNAP.reduce((best, v, i) => (Math.abs(v - pct) < Math.abs(SNAP[best] - pct) ? i : best), 0);
        }
        setH(SNAP[snap]);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  })();

  // The page pill fades while you read and comes back when you move the mouse.
  (() => {
    const pill = $('#pagePill');
    let t = 0;
    const wake = () => {
      pill.classList.remove('idle');
      clearTimeout(t);
      t = setTimeout(() => pill.classList.add('idle'), 2500);
    };
    viewer.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => pill.classList.add('idle'), 900); }, { passive: true });
    $('.viewer-wrap').addEventListener('pointermove', wake, { passive: true });
    wake();
  })();

  // ------------------------------------------------------------------ export / import
  function exportMarkdown() {
    const d = S.doc;
    const lines = [`# ${baseName(d.name)}`, '', `_Exported ${new Date().toLocaleString()}_`, ''];
    if (d.docNote.trim()) lines.push('## Lecture notes', '', d.docNote.trim(), '');
    const flagged = (k) => Object.keys(d.pageFlags).filter((n) => d.pageFlags[n][k]).map(Number).sort((a, b) => a - b);
    if (flagged('exam').length) lines.push(`**⭐ Exam-relevant:** page ${flagged('exam').join(', ')}`, '');
    if (flagged('ask').length) lines.push(`**❓ Questions to ask:** page ${flagged('ask').join(', ')}`, '');
    for (let n = 1; n <= d.numPages; n++) {
      const pn = (d.pageNotes[n] || '').trim();
      const annots = annotsOnPage(n);
      const flags = d.pageFlags[n] || {};
      if (!pn && !annots.length && !flags.exam && !flags.ask) continue;
      lines.push(`## Page ${n}${flagIcons(flags)}`, '');
      if (pn) lines.push(pn, '');
      for (const a of annots) {
        lines.push(a.text ? `> ${a.text}` : a.type === 'ink' ? '> _(drawing)_' : '> _(area highlight)_');
        if (a.note && a.note.trim()) lines.push('', a.note.trim().split('\n').map((l) => '  ' + l).join('\n').replace(/^ {2}/, '- '));
        lines.push('');
      }
    }
    download(`${baseName(d.name)} - notes.md`, lines.join('\n'), 'text/markdown');
  }

  function notesPayload(d) {
    return {
      app: 'lecture-pdf-notes', version: 1, exportedAt: new Date().toISOString(),
      docId: d.id, name: d.name, docNote: d.docNote, pageNotes: d.pageNotes, pageFlags: d.pageFlags, annotations: d.annotations,
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
      if (data.docId !== S.doc.id && !(await ask({
        title: 'This backup is for a different PDF',
        body: `It was made for "${data.name}", which is a different file from the open lecture. Apply it anyway?`,
        ok: 'Apply anyway',
      }))) return;
      if (!(await ask({ title: 'Restore this backup?', body: 'The current notes of this lecture will be replaced by the ones in the backup.', ok: 'Replace notes', danger: true }))) return;
      S.doc.docNote = data.docNote || '';
      S.doc.pageNotes = data.pageNotes || {};
      S.doc.pageFlags = data.pageFlags || {};
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
  const moreMenu = $('#moreMenu');
  const MENUS = [[exportMenu, '#btnExport'], [moreMenu, '#btnMore']];
  const setMenu = (open, which) => {
    for (const [m, btn] of MENUS) {
      const show = !!open && m === which;
      m.hidden = !show;
      $(btn).setAttribute('aria-expanded', String(show));
    }
  };
  $('#btnExport').addEventListener('click', (e) => { e.stopPropagation(); setMenu(exportMenu.hidden, exportMenu); });
  $('#btnMore').addEventListener('click', (e) => { e.stopPropagation(); setMenu(moreMenu.hidden, moreMenu); });
  moreMenu.addEventListener('click', (e) => { if (e.target.closest('.theme-seg, .note-color-seg')) e.stopPropagation(); });
  document.addEventListener('click', () => setMenu(false));
  $$('[data-more]', moreMenu).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.more;
    if (k === 'open') $('#fileInput').click();
    else if (k === 'cmdk') openCmdk();
    else if (k === 'help') openHelp();
  }));
  $$('[data-export]', exportMenu).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.export;
    if (k === 'pdf') exportPdf(false);
    else if (k === 'pdf-edit') exportPdf(true);
    else if (k === 'md') exportMarkdown();
    else if (k === 'json') exportJson();
    else if (k === 'anki') exportAnki();
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
  $('#btnSelect').addEventListener('click', () => { setAreaMode(false); setDrawMode(false); });
  $('#btnSidebar').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('sidebar-hidden');
    $('#btnSidebar').setAttribute('aria-pressed', String(!hidden));
    try { localStorage.setItem('sidebarHidden', hidden ? '1' : '0'); } catch (_) { /* ignore */ }
  });

  // Theme: light, dark, or follow the device ("system")
  (() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let pref = 'system';
    try { pref = localStorage.getItem('theme') || 'system'; } catch (_) { /* ignore */ }
    const apply = () => {
      document.documentElement.dataset.theme = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
      document.documentElement.dataset.themePref = pref;
      $$('[data-theme-set]').forEach((b) => b.classList.toggle('active', b.dataset.themeSet === pref));
    };
    $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
      pref = b.dataset.themeSet;
      try { localStorage.setItem('theme', pref); } catch (_) { /* ignore */ }
      apply();
    }));
    media.addEventListener('change', () => { if (pref === 'system') apply(); });
    apply();
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
      if (D.on && !isTyping(e.target)) setDrawMode(false);
      hideSelToolbar();
      setMenu(false);
      if (!findBar.hidden && !isTyping(e.target)) closeFind();
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openCmdk(); return; }
    if ($('#cmdk').open || $('#askDialog').open) return;
    const readerOpen = S.doc && !$('#reader').hidden && !helpDialog.open && !studyDialog.open;
    if (readerOpen && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(); return; }
    if (readerOpen && F.matches.length && (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')))) {
      e.preventDefault();
      showMatch(F.idx + (e.shiftKey ? -1 : 1));
      return;
    }
    if (readerOpen && D.on && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !isTyping(e.target)) {
      e.preventDefault();
      drawUndo();
      return;
    }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || helpDialog.open || studyDialog.open) return;
    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key === 'o' || e.key === 'O') { e.preventDefault(); $('#fileInput').click(); return; }
    if (!S.doc || $('#reader').hidden) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); goToPage(S.currentPage + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); goToPage(S.currentPage - 1); }
    else if (k === '+' || k === '=') zoomBy(1.15);
    else if (k === '-') zoomBy(1 / 1.15);
    else if (k === '0') applyZoom('fit');
    else if (k === 'h' || k === 'H') { if (selectionInTextLayer() || S.pendingRange) createFromSelection(noteColor, false); }
    else if (k === 'n' || k === 'N') {
      e.preventDefault();
      if (selectionInTextLayer() || S.pendingRange) createFromSelection(noteColor, true);
      else { showSidebar(); switchTab('page'); $('#pageNote').focus(); }
    }
    else if (k === 'p' || k === 'P') { e.preventDefault(); showSidebar(); switchTab('page'); $('#pageNote').focus(); }
    else if (k === 'a' || k === 'A') setAreaMode(!S.areaMode);
    else if (k === 'd' || k === 'D') setDrawMode(!D.on);
    else if (k === '\\') $('#btnSidebar').click();
    else if (k === 'l' || k === 'L') showLibrary();
    else if (k === 't' || k === 'T') setThumbsOpen(thumbsEl.hidden);
    else if (k === 'e' || k === 'E') toggleFlag('exam');
    else if (k === 'q' || k === 'Q') toggleFlag('ask');
    else if (k === 's' || k === 'S') { e.preventDefault(); openStudy(); }
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
