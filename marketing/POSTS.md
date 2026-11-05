# Ready-to-post copy

Replace the URLs if you move to a custom domain. Change the first lines for each community, use your own words where it says *[your story]*, and only claim what's true for you.

- Homepage: https://arsimsaliu.github.io/uni-pdf/
- App: https://arsimsaliu.github.io/uni-pdf/app/
- Code: https://github.com/ArsimSaliu/uni-pdf
- Visuals: `site/assets/demo.gif`, `demo.mp4`, `og-image.png`, `marketing/assets/*`

---

## One-liners

- **Tagline (≤60 chars):** Take lecture notes right on your slides. Free & private.
- **Short:** A free, private PDF reader for lectures. Highlight slides, attach notes to any sentence or diagram, and export one PDF with your notes next to every slide.
- **Benefit-first:** Stop copying slides into your notes. Write the notes on the slides.
- **Privacy angle:** A lecture-notes PDF reader with no server. Your files never leave your device.
- **German:** Deine Mitschrift direkt auf den Folien. Kostenlos, offline, ohne Konto.

---

## Product Hunt

**Name:** uni-pdf
**Tagline:** Take lecture notes right on your slides. Free & private.
**Topics:** Education, Productivity, Note-taking, Open Source

**Description (≤260 chars):**
> A PDF reader built for lectures. Highlight slides, attach notes to any sentence or diagram, search everything, and export one PDF with your notes next to every slide. Runs in your browser, works offline, no account, nothing uploaded. Free and open source.

**Gallery:** `marketing/assets/product-hunt-1.png` … `-4.png`, plus `site/assets/demo.mp4`.

**Maker's first comment:**
> Hi Product Hunt! 👋
>
> I built uni-pdf because my lecture notes and my lecture slides never lived in the same place. I'd have the PDF open on one side and a notes app on the other, and two weeks later I had no idea which note belonged to which slide.
>
> uni-pdf puts a notes panel right next to the slide you're on:
> • Select a sentence and press N to attach a note to it
> • Draw a box around a diagram or formula to note that too
> • Search every note before the exam
> • Export one PDF with your highlights numbered and your notes in a column beside each slide
>
> There's no server: the PDF and your notes stay in your browser, and it works offline (you can even run it from a USB stick). It's free and open source.
>
> I'd love to hear what's missing for how *you* take notes. Sync? Pen input? Flashcards?

---

## Hacker News (Show HN)

**Title:** Show HN: uni-pdf – Take notes on lecture slides in the browser, nothing uploaded

**URL:** https://arsimsaliu.github.io/uni-pdf/

**Text (first comment):**
> I'm a student and built this for my own lectures: a PDF reader with a notes panel where notes are anchored to the exact text (or a drawn box) on the slide, and an export that produces a new PDF with the original pages embedded as vector content, the highlights drawn on and numbered, and a notes column beside each page.
>
> Some details that might be interesting:
> - No backend at all. pdf.js renders, pdf-lib builds the export, and everything is stored in IndexedDB. The PDF is keyed by a SHA-256 of its bytes, so reopening the same file from anywhere brings its notes back.
> - It also works from file:// (double-click index.html). Browsers won't start a worker there, so it falls back to running pdf.js on the main thread.
> - The "editable PDF" export attaches the untouched original plus a JSON of the notes as PDF file attachments. Any reader shows the annotated pages, and opening the file in uni-pdf again restores everything for editing, with no server or account needed for "sync".
> - It's a PWA, so it works offline once installed and registers as a PDF file handler on Chrome/Edge.
>
> Code (public domain): https://github.com/ArsimSaliu/uni-pdf
>
> Happy to hear criticism, especially from anyone who knows the pdf.js text layer better than I do.

---

## Reddit

Read each subreddit's rules first. Many only allow self-promotion in specific threads, or ask you to disclose that you made it. Post the GIF or video natively, not just a link.

### r/GetStudying / r/studytips

**Title:** I got tired of my notes and lecture slides being in two different places, so I made a free tool that puts them side by side

> *[your story, e.g. "I'm studying X at Y and…"]* My notes never matched up with the slides afterwards, so I built a PDF reader where the notes panel sits next to the slide you're on.
>
> What it does:
> - Highlight text on the slide in 4 colours, or attach a note to a specific sentence (select → N)
> - Draw a box around a diagram or formula and attach a note to that
> - A notes field for each slide, plus general notes for the lecture
> - Search all notes before the exam
> - Export one PDF with your notes printed next to every slide (great for printing or sending to someone who missed the lecture), or Markdown for Notion/Obsidian
>
> It's free, runs in the browser, works offline, and doesn't upload your files anywhere (there's no server). No account either.
>
> Link: https://arsimsaliu.github.io/uni-pdf/ (there's a demo lecture if you just want to try it)
>
> I made it, so I'd really appreciate honest feedback. What would make you actually switch to it?

### r/college / r/UniUK / r/EngineeringStudents

**Title:** Made a free, no-account PDF reader for taking notes on lecture slides. Looking for feedback from people who actually use slides in class

> *[1–2 sentences about your course and why you built it]*
>
> You open the slides, select a sentence and type a note, and it's attached right there. Next week you hover over the highlight and the note pops up. At the end you can export a PDF with all your notes in a column next to each slide.
>
> Free, open source, works offline, files never leave your laptop. https://arsimsaliu.github.io/uni-pdf/
>
> What's missing for your workflow?

### r/webdev (Showoff Saturday) / r/opensource / r/selfhosted

**Title:** uni-pdf: a lecture-notes PDF reader with no backend (pdf.js + pdf-lib + IndexedDB, works from file://)

> Static files only. Notes are anchored to text-layer ranges as normalised rects, the export embeds the original pages as Form XObjects with pdf-lib and draws a notes column, and the "editable PDF" carries the original and a JSON as attachments so it round-trips without a server. It's a PWA, works offline, and is tested with Playwright, including a file:// test.
>
> Self-hosting is just copying `app/` to any static host.
>
> Repo: https://github.com/ArsimSaliu/uni-pdf. Feedback on the code is very welcome.

### r/Studium / German-speaking groups

**Titel:** Ich hab ein kostenloses Tool gebaut, mit dem man Notizen direkt auf die Vorlesungsfolien schreibt (ohne Konto, offline)

> Meine Mitschrift und die Folien waren immer getrennt, und nach zwei Wochen wusste ich nicht mehr, welche Notiz zu welcher Folie gehört. Deshalb hab ich uni-pdf gebaut:
>
> - Text auf der Folie markieren und eine Notiz direkt an den Satz heften (markieren → N)
> - Kasten um Diagramme oder Formeln ziehen und dazu notieren
> - Notizen pro Folie und für die ganze Vorlesung
> - Alles durchsuchen, z. B. vor der Prüfung
> - Export als PDF mit deinen Notizen neben jeder Folie, oder als Markdown
>
> Läuft im Browser, funktioniert offline, nichts wird hochgeladen (es gibt keinen Server). Kostenlos und Open Source.
>
> https://arsimsaliu.github.io/uni-pdf/
>
> Ich freu mich über ehrliches Feedback!

---

## X / Twitter thread

1. I kept losing track of which notes belonged to which lecture slide, so I built uni-pdf: a free PDF reader where your notes live *on* the slides. 🧵 [attach demo.mp4]
2. Select a sentence → press N → type. The note is anchored to that exact text. Hover it next week and it pops up.
3. Diagrams and formulas aren't selectable text, so you can draw a box around them and attach a note to that instead. [area-note.png]
4. After the lecture, export one PDF: highlights numbered, your notes in a column next to every slide. Print it, revise from it, send it to a friend who skipped. [export-page.png]
5. No server, no account, no tracking. Your PDFs never leave your device. It works offline and you can install it as an app.
6. Free and open source → https://arsimsaliu.github.io/uni-pdf/
   What should I add next?

---

## LinkedIn

> I just released my first open-source tool: **uni-pdf**, a PDF reader built for taking notes in lectures.
>
> The problem: slides in one window, notes in another, and afterwards they never match up. uni-pdf puts a notes panel next to the slide you're on, anchors each note to the exact sentence or diagram, and exports one PDF with your notes next to every slide.
>
> A few decisions I'm proud of:
> 🔒 No server at all. Files and notes never leave the user's device
> ✈️ Works offline, and even runs from a USB stick
> 🧪 End-to-end tested with Playwright, with CI and automated releases
>
> It's free to use: https://arsimsaliu.github.io/uni-pdf/
> If you know a student who lives in lecture PDFs, I'd be grateful if you sent it to them.
>
> #opensource #students #webdevelopment #edtech

---

## Instagram / TikTok / Reels (15–25 s)

Use `marketing/assets/story.png` as the cover and screen-record yourself using the app with a real lecture.

1. **0–2 s:** Text on screen: "POV: your notes don't match your slides anymore". Show messy split-screen notes.
2. **2–8 s:** Open a lecture PDF in uni-pdf, select a sentence, press N, type a note.
3. **8–12 s:** Draw a box around a diagram and type a note.
4. **12–17 s:** Export, then show the exported PDF with the notes column. Text: "one PDF, notes next to every slide".
5. **17–22 s:** Text: "free · no account · works offline". Point at the link in your bio.

**Caption:** Free tool for taking notes directly on lecture slides 📚 no account, nothing uploaded. Link in bio. #studytips #studentlife #uni #studygram #notetaking

---

## Email to your student union / ÖH / AStA (German)

**Betreff:** Kostenloses Open-Source-Tool für Vorlesungsnotizen. Vielleicht was für euren Newsletter?

> Hallo liebes Team,
>
> ich studiere *[Studiengang]* und habe in meiner Freizeit **uni-pdf** gebaut, ein kostenloses Tool, mit dem man Notizen direkt auf die Vorlesungsfolien (PDF) schreibt und am Ende ein PDF mit allen Notizen neben den Folien exportiert.
>
> Was es für Studierende interessant macht:
> - komplett kostenlos und Open Source, ohne Konto und ohne Werbung
> - datenschutzfreundlich: Die Dateien werden nicht hochgeladen, alles bleibt auf dem eigenen Gerät
> - funktioniert offline und auf Laptop, Tablet und Handy
>
> Link: https://arsimsaliu.github.io/uni-pdf/
> Ein druckbares Plakat mit QR-Code hänge ich an.
>
> Wenn ihr es euren Studierenden weiterempfehlen wollt, würde mich das sehr freuen. Für Feedback bin ich jederzeit dankbar.
>
> Liebe Grüße
> *[Name]*

## Email to your student union (English)

**Subject:** A free, open-source tool for lecture notes. Maybe something for your newsletter?

> Hi,
>
> I'm a *[course]* student and built **uni-pdf** in my free time. It's a free tool for taking notes directly on lecture slides (PDFs) and exporting one PDF with all the notes next to the slides.
>
> Why it might be useful for students: it's free and open source, has no account or ads, never uploads files (everything stays on the student's device), and works offline on laptops, tablets and phones.
>
> Link: https://arsimsaliu.github.io/uni-pdf/. A printable poster with a QR code is attached.
>
> I'd be very happy if you shared it, and grateful for any feedback.
>
> Best,
> *[Name]*

## Message to a lecturer

> Hi Prof. *[Name]*, I built a small free tool that lets students take notes directly on the lecture PDFs and export them next to the slides: https://arsimsaliu.github.io/uni-pdf/. It's private (nothing is uploaded) and needs no account. If you think it's useful, would you consider mentioning it or linking it next to the slides on *[Moodle/LMS]*? Thanks either way!
