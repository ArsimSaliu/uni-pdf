/* Builds an annotated copy of a PDF: every page keeps the original content
 * (vector, text stays selectable) with highlights drawn on it, plus a notes
 * column on the right. Lecture notes are appended at the end.
 * Loaded on demand; needs vendor/pdf-lib.min.js, fontkit.umd.min.js, dejavu-fonts.js. */
(() => {
  'use strict';

  const HL = {
    yellow: [1.0, 0.84, 0.0],
    green: [0.31, 0.82, 0.43],
    blue: [0.27, 0.63, 1.0],
    pink: [1.0, 0.41, 0.71],
  };
  const SOLID = {
    yellow: [0.85, 0.66, 0.0],
    green: [0.2, 0.65, 0.33],
    blue: [0.2, 0.5, 0.9],
    pink: [0.88, 0.3, 0.6],
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  // Word-wrap text to a width; keeps blank lines, splits words that are too long.
  function wrap(text, font, size, maxW) {
    const out = [];
    for (const para of String(text).replace(/\r/g, '').split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        const cand = line + word;
        if (font.widthOfTextAtSize(cand, size) <= maxW) { line = cand; continue; }
        if (line.trim()) out.push(line.trimEnd());
        line = word.trimStart();
        while (line && font.widthOfTextAtSize(line, size) > maxW) {
          let i = line.length - 1;
          while (i > 1 && font.widthOfTextAtSize(line.slice(0, i), size) > maxW) i--;
          out.push(line.slice(0, i));
          line = line.slice(i);
        }
      }
      if (line.trim()) out.push(line.trimEnd());
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

  function clampLines(lines, max, font, size, maxW) {
    if (lines.length <= max) return lines;
    const kept = lines.slice(0, max);
    let last = kept[max - 1];
    while (last && font.widthOfTextAtSize(last + '…', size) > maxW) last = last.slice(0, -1);
    kept[max - 1] = last + '…';
    return kept;
  }

  // File names of the attachments that make an exported PDF editable again in the app.
  const EMBED_PDF = 'lecture-notes-original.pdf';
  const EMBED_JSON = 'lecture-notes.json';

  async function build(bytes, doc, opts = {}) {
    const { PDFDocument, rgb, degrees, BlendMode } = window.PDFLib;
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    out.registerFontkit(window.fontkit);
    const font = await out.embedFont(b64ToBytes(window.PDFNOTES_FONTS.regular), { subset: true });
    const bold = await out.embedFont(b64ToBytes(window.PDFNOTES_FONTS.bold), { subset: true });
    out.setTitle(doc.name.replace(/\.pdf$/i, '') + ' (with notes)');
    out.setCreator('uni-pdf');
    out.setProducer('uni-pdf (pdf-lib)');

    const srcPages = src.getPages();
    const boxes = srcPages.map((p) => {
      const c = p.getCropBox();
      return { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height };
    });
    const embedded = await out.embedPages(srcPages, boxes);

    const ink = rgb(0.12, 0.12, 0.12);
    const grey = rgb(0.42, 0.42, 0.4);
    const colBg = rgb(0.965, 0.965, 0.955);
    const line = rgb(0.85, 0.85, 0.82);

    const annotsByPage = {};
    for (const a of doc.annotations) (annotsByPage[a.page] = annotsByPage[a.page] || []).push(a);

    let lastSize = [595, 842];

    for (let i = 0; i < srcPages.length; i++) {
      const num = i + 1;
      const sp = srcPages[i];
      const emb = embedded[i];
      const w = emb.width, h = emb.height;
      const rot = ((sp.getRotation().angle % 360) + 360) % 360;
      const W = rot % 180 ? h : w;
      const H = rot % 180 ? w : h;

      const fs = clamp(H / 42, 7.5, 12);
      const pad = fs * 1.5;
      const colW = clamp(W * 0.42, 190, 420);
      const PW = W + colW;
      lastSize = [PW, H];

      const annots = (annotsByPage[num] || []).slice()
        .sort((a, b) => (a.rects[0][1] - b.rects[0][1]) || (a.rects[0][0] - b.rects[0][0]));
      const pageNote = (doc.pageNotes[num] || '').trim();
      // Only highlights with a note get a number and a place in the notes column.
      const noted = annots.filter((a) => a.note && a.note.trim());

      const page = out.addPage([PW, H]);
      // Original page, honouring /Rotate.
      const place = { 0: [0, 0], 90: [0, w], 180: [w, h], 270: [h, 0] }[rot] || [0, 0];
      page.drawPage(emb, { x: place[0], y: place[1], rotate: degrees(-rot) });

      // Highlights + numbered badges on the page.
      annots.forEach((a) => {
        const c = HL[a.color] || HL.yellow;
        for (const [x, y, rw, rh] of a.rects) {
          const r = { x: x * W, y: H - (y + rh) * H, width: rw * W, height: rh * H };
          if (a.type === 'area') {
            page.drawRectangle({ ...r, borderColor: rgb(...(SOLID[a.color] || SOLID.blue)), borderWidth: 1.5, color: rgb(...c), opacity: 0.08 });
          } else {
            page.drawRectangle({ ...r, color: rgb(...c), opacity: 0.4, blendMode: BlendMode.Multiply });
          }
        }
        const n = noted.indexOf(a) + 1;
        if (!n) return;
        const [x, y] = a.rects[0];
        const br = fs * 0.62;
        drawBadge(page, clamp(x * W - br * 0.6, br, W - br), clamp(H - y * H + br * 0.4, br, H - br), br, n, a.color);
      });

      // Notes column.
      let col = newColumn(page, W, colW, H, num, false);
      const ensure = (needed) => {
        if (col.y - needed >= pad) return;
        const cont = out.addPage([PW, H]);
        cont.drawText(`Notes for page ${num} continue →`, { x: pad * 2, y: H / 2, size: fs * 1.2, font, color: grey });
        col = newColumn(cont, W, colW, H, num, true);
      };
      const textW = colW - pad * 2;

      if (pageNote) {
        for (const l of wrap(pageNote, font, fs, textW)) {
          ensure(fs * 1.4);
          if (l) col.page.drawText(l, { x: W + pad, y: col.y - fs, size: fs, font, color: ink });
          col.y -= fs * 1.4;
        }
        col.y -= fs * 0.8;
      }

      noted.forEach((a, idx) => {
        const br = fs * 0.62;
        const indent = br * 2 + fs * 0.5;
        const quote = a.text ? `“${a.text}”` : 'Area highlight';
        const qs = fs * 0.88;
        const qLines = clampLines(wrap(quote, font, qs, textW - indent), 4, font, qs, textW - indent);
        const nLines = wrap(a.note.trim(), font, fs, textW - indent);
        ensure(Math.max(br * 2, qs * 1.35) + fs);
        drawBadge(col.page, W + pad + br, col.y - br, br, idx + 1, a.color);
        for (const l of qLines) {
          ensure(qs * 1.35);
          col.page.drawText(l, { x: W + pad + indent, y: col.y - qs, size: qs, font, color: grey });
          col.y -= qs * 1.35;
        }
        col.y -= fs * 0.25;
        for (const l of nLines) {
          ensure(fs * 1.4);
          if (l) col.page.drawText(l, { x: W + pad + indent, y: col.y - fs, size: fs, font, color: ink });
          col.y -= fs * 1.4;
        }
        col.y -= fs * 0.9;
      });

      if (!pageNote && !noted.length) {
        col.page.drawText('No notes', { x: W + pad, y: col.y - fs, size: fs * 0.9, font, color: line });
      }
    }

    // Lecture (whole-document) notes at the end.
    const docNote = (doc.docNote || '').trim();
    if (docNote) {
      const [PW, H] = lastSize;
      const fs = clamp(H / 50, 8, 11);
      const m = fs * 3;
      let page = null;
      let y = 0;
      const next = (first) => {
        page = out.addPage([PW, H]);
        y = H - m;
        page.drawText(first ? 'Lecture notes' : 'Lecture notes (continued)', { x: m, y: y - fs * 1.6, size: fs * 1.6, font: bold, color: ink });
        y -= fs * 3.2;
      };
      next(true);
      for (const l of wrap(docNote, font, fs, PW - m * 2)) {
        if (y - fs * 1.45 < m) next(false);
        if (l) page.drawText(l, { x: m, y: y - fs, size: fs, font, color: ink });
        y -= fs * 1.45;
      }
    }

    if (opts.notes) {
      // Editable export: carry the untouched original + the notes data inside the PDF.
      // Other PDF readers just show the annotated pages (and list these as attachments).
      await out.attach(bytes, EMBED_PDF, {
        mimeType: 'application/pdf',
        description: 'Original slides, used by uni-pdf to re-open your notes for editing',
      });
      await out.attach(new TextEncoder().encode(JSON.stringify(opts.notes)), EMBED_JSON, {
        mimeType: 'application/json',
        description: 'Editable notes for uni-pdf',
      });
    }

    return out.save();

    function newColumn(pg, W, colW, H, num, cont) {
      pg.drawRectangle({ x: W, y: 0, width: colW, height: H, color: colBg });
      pg.drawLine({ start: { x: W, y: 0 }, end: { x: W, y: H }, thickness: 0.75, color: line });
      const fs = clamp(H / 42, 7.5, 12);
      const pad = fs * 1.5;
      const hs = fs * 1.2;
      pg.drawText(cont ? `Page ${num} (continued)` : `Page ${num}`, { x: W + pad, y: H - pad - hs, size: hs, font: bold, color: ink });
      return { page: pg, y: H - pad - hs * 2.1 };
    }

    function drawBadge(pg, cx, cy, r, n, color) {
      pg.drawCircle({ x: cx, y: cy, size: r, color: rgb(...(SOLID[color] || SOLID.yellow)) });
      const s = r * 1.15;
      const t = String(n);
      pg.drawText(t, { x: cx - bold.widthOfTextAtSize(t, s) / 2, y: cy - s * 0.36, size: s, font: bold, color: rgb(1, 1, 1) });
    }
  }

  window.PdfNotesExport = { build, EMBED_PDF, EMBED_JSON };
})();
