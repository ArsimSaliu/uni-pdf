#!/usr/bin/env node
/* Generates app/sample-lecture.pdf (the demo deck) and app/sample-lecture.js
 * (the same PDF as base64, so "Try the demo" also works when the app is opened
 * from file://, where fetch() is not allowed).
 *
 *   node scripts/make-sample.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('../app/vendor/pdf-lib.min.js');

const W = 960;
const H = 540;
const ACCENT = rgb(0.18, 0.44, 0.87);
const INK = rgb(0.11, 0.12, 0.14);
const MUTED = rgb(0.42, 0.44, 0.48);
const SOFT = rgb(0.93, 0.95, 0.99);

(async () => {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Lecture 3: Processes & Scheduling');
  pdf.setAuthor('uni-pdf demo');
  pdf.setCreator('uni-pdf');
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let num = 0;

  function slide(title) {
    const p = pdf.addPage([W, H]);
    num++;
    if (title) {
      p.drawText(title, { x: 60, y: H - 88, size: 34, font: bold, color: INK });
      p.drawRectangle({ x: 60, y: H - 108, width: 70, height: 5, color: ACCENT });
    }
    p.drawText('Operating Systems · Lecture 3', { x: 60, y: 26, size: 11, font, color: MUTED });
    const n = String(num);
    p.drawText(n, { x: W - 60 - font.widthOfTextAtSize(n, 11), y: 26, size: 11, font, color: MUTED });
    return p;
  }

  function bullets(p, items, y = H - 170, size = 22, gap = 46) {
    for (const it of items) {
      const sub = it.startsWith('-');
      const text = sub ? it.slice(1).trim() : it;
      const x = sub ? 110 : 80;
      p.drawCircle({ x: x - 4, y: y + size * 0.32, size: sub ? 2.5 : 4, color: sub ? MUTED : ACCENT });
      p.drawText(text, { x: x + 12, y, size: sub ? size - 4 : size, font, color: sub ? MUTED : INK });
      y -= sub ? gap - 8 : gap;
    }
    return y;
  }

  function box(p, x, y, w, h, label, fill = SOFT) {
    p.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: ACCENT, borderWidth: 2 });
    const tw = bold.widthOfTextAtSize(label, 18);
    p.drawText(label, { x: x + (w - tw) / 2, y: y + h / 2 - 6, size: 18, font: bold, color: INK });
  }

  function arrow(p, x1, y1, x2, y2, label) {
    p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 2, color: MUTED });
    const a = Math.atan2(y2 - y1, x2 - x1);
    const s = 10;
    for (const d of [0.45, -0.45]) {
      p.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - s * Math.cos(a + d), y: y2 - s * Math.sin(a + d) }, thickness: 2, color: MUTED });
    }
    if (label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      p.drawText(label, { x: mx - font.widthOfTextAtSize(label, 12) / 2, y: my + 8, size: 12, font, color: MUTED });
    }
  }

  // 1. Title
  {
    const p = slide(null);
    p.drawRectangle({ x: 0, y: 0, width: 18, height: H, color: ACCENT });
    p.drawText('Lecture 3', { x: 80, y: 330, size: 24, font: bold, color: ACCENT });
    p.drawText('Processes & Scheduling', { x: 80, y: 270, size: 52, font: bold, color: INK });
    p.drawText('How an operating system decides what runs next', { x: 80, y: 225, size: 22, font, color: MUTED });
    p.drawText('Prof. A. Example  ·  Winter term 2026', { x: 80, y: 130, size: 16, font, color: MUTED });
  }

  // 2. What is a process?
  {
    const p = slide('What is a process?');
    bullets(p, [
      'A process is a program in execution.',
      '- It has its own address space: code, data, heap and stack.',
      'The OS keeps a Process Control Block (PCB) for each one.',
      '- PCB: process ID, state, program counter, registers, open files.',
      'Many processes share one CPU by taking turns.',
      'Switching between them is called a context switch.',
    ]);
  }

  // 3. State diagram
  {
    const p = slide('The five process states');
    const bw = 150;
    const bh = 56;
    const y1 = 300;
    const y2 = 130;
    box(p, 70, y1, bw, bh, 'New');
    box(p, 310, y1, bw, bh, 'Ready');
    box(p, 560, y1, bw, bh, 'Running');
    box(p, 760, y1, bw, bh, 'Terminated');
    box(p, 435, y2, bw, bh, 'Waiting');
    arrow(p, 70 + bw, y1 + bh / 2, 310, y1 + bh / 2, 'admitted');
    arrow(p, 310 + bw, y1 + bh / 2 + 10, 560, y1 + bh / 2 + 10, 'dispatch');
    arrow(p, 560, y1 + bh / 2 - 12, 310 + bw, y1 + bh / 2 - 12, '');
    p.drawText('interrupt', { x: 485, y: y1 + 2, size: 12, font, color: MUTED });
    arrow(p, 560 + bw, y1 + bh / 2, 760, y1 + bh / 2, 'exit');
    arrow(p, 600, y1, 545, y2 + bh, '');
    p.drawText('I/O wait', { x: 590, y: 245, size: 12, font, color: MUTED });
    arrow(p, 470, y2 + bh, 390, y1, '');
    p.drawText('I/O done', { x: 360, y: 245, size: 12, font, color: MUTED });
    p.drawText('Only one process can be Running per CPU core at any moment.', { x: 70, y: 70, size: 18, font, color: INK });
  }

  // 4. Threads vs processes table
  {
    const p = slide('Processes vs. threads');
    const cols = [80, 380, 640];
    const rows = [
      ['', 'Process', 'Thread'],
      ['Memory', 'Own address space', 'Shared with its process'],
      ['Creation cost', 'High (fork, new PCB)', 'Low'],
      ['Communication', 'IPC: pipes, sockets', 'Shared variables'],
      ['Crash impact', 'Isolated', 'Can take down all threads'],
    ];
    let y = H - 175;
    rows.forEach((r, i) => {
      if (i === 0) p.drawRectangle({ x: 70, y: y - 14, width: 820, height: 44, color: SOFT });
      r.forEach((c, j) => p.drawText(c, { x: cols[j], y, size: 20, font: i === 0 || j === 0 ? bold : font, color: INK }));
      y -= 58;
      p.drawLine({ start: { x: 70, y: y + 30 }, end: { x: 890, y: y + 30 }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
    });
  }

  // 5. Scheduling + Gantt chart
  {
    const p = slide('CPU scheduling algorithms');
    bullets(p, [
      'FCFS: first come, first served. Simple, but long jobs block.',
      'SJF: shortest job first. Optimal average waiting time.',
      'Round Robin: each process gets a fixed time quantum.',
    ], H - 165, 20, 40);
    p.drawText('Round Robin, quantum = 2', { x: 80, y: 205, size: 16, font: bold, color: INK });
    const seq = [['P1', 2], ['P2', 2], ['P3', 1], ['P1', 2], ['P2', 1], ['P1', 1]];
    const fills = { P1: rgb(0.78, 0.86, 0.98), P2: rgb(0.8, 0.93, 0.83), P3: rgb(0.99, 0.88, 0.74) };
    let x = 80;
    let t = 0;
    const unit = 85;
    p.drawText('0', { x: x - 3, y: 108, size: 12, font, color: MUTED });
    for (const [name, d] of seq) {
      p.drawRectangle({ x, y: 128, width: d * unit, height: 56, color: fills[name], borderColor: INK, borderWidth: 1 });
      p.drawText(name, { x: x + (d * unit) / 2 - 9, y: 150, size: 16, font: bold, color: INK });
      x += d * unit;
      t += d;
      p.drawText(String(t), { x: x - 4, y: 108, size: 12, font, color: MUTED });
    }
    p.drawText('time (ms)', { x: x + 16, y: 108, size: 12, font, color: MUTED });
  }

  // 6. Summary
  {
    const p = slide('Summary');
    bullets(p, [
      'A process = program + execution state (stored in the PCB).',
      'States: new, ready, running, waiting, terminated.',
      'Threads share memory, which makes them cheap but risky.',
      'The scheduler trades off fairness, throughput and response time.',
    ]);
    p.drawRectangle({ x: 70, y: 80, width: 820, height: 70, color: rgb(1, 0.96, 0.82), borderColor: rgb(0.9, 0.7, 0.1), borderWidth: 1.5 });
    p.drawText('Exam tip: be able to draw the state diagram and compute', { x: 92, y: 120, size: 18, font: bold, color: INK });
    p.drawText('average waiting time for FCFS, SJF and Round Robin.', { x: 92, y: 96, size: 18, font, color: INK });
  }

  const bytes = await pdf.save({ useObjectStreams: false });
  const appDir = path.join(__dirname, '..', 'app');
  fs.writeFileSync(path.join(appDir, 'sample-lecture.pdf'), bytes);
  fs.writeFileSync(
    path.join(appDir, 'sample-lecture.js'),
    '/* Generated by scripts/make-sample.js. The demo deck as base64, for file:// use. */\n'
      + `window.UNIPDF_SAMPLE = ${JSON.stringify({ name: 'Lecture 3 - Processes & Scheduling (demo).pdf', b64: Buffer.from(bytes).toString('base64') })};\n`,
  );
  console.log(`sample-lecture.pdf: ${bytes.length} bytes, ${num} slides`);
})().catch((e) => { console.error(e); process.exit(1); });
