# Lecture Notes PDF

A PDF reader with a notes panel on the side, so you can follow lecture slides and take notes in one app.

## Start

Double-click **`index.html`**. It opens in Chrome or Edge and needs no install and no internet connection.

> Notes are saved in the browser you open it with. Keep using the same browser, and the same way of opening it, or your notes won't show up.

## How to use

| Action | How |
|---|---|
| Open a PDF | **Open PDF** button, or drag a PDF onto the window |
| Note on a word/sentence | Select the text → **✎ Note** (or press `N`) |
| Highlight only | Select the text → click a colour (or press `H`) |
| Note on a diagram/image | **▭ Area** (or `A`, or hold `Alt` while dragging) and drag a box |
| Note for the whole page/slide | Press `P` or type in *Notes for this page* |
| General notes for the lecture | **Lecture notes** tab |
| See/search everything | **All notes** tab |
| Jump to a highlight | Click it in the sidebar. Clicking a highlight in the PDF opens its note |

When you go to a page, its highlights show up in the PDF and the sidebar shows that page's notes. Hover a highlight to see its note.

**Keys:** `←`/`→` previous/next page · `+`/`-`/`0` zoom/fit · `Ctrl+scroll` zoom · `\` hide/show the notes panel · `L` library · `Esc` leave a text box

## Your data

- PDFs and notes are stored only on this computer, in the browser's IndexedDB. Nothing is uploaded.
- Each PDF is identified by its content. Opening the same file again, even from another folder, brings back its notes.
- **Export → PDF with highlights & notes** saves a real PDF: each slide with your highlights drawn on it (numbered), and a notes column on the right with that page's notes. Long notes continue on an extra page, and your lecture notes go at the end. The slide text stays selectable and searchable.
- **Export → Editable PDF** looks the same in any PDF reader, but it also carries the original slides and your notes inside it. Open it in this app again, even on another computer or after clearing the browser, and you get the clean slides back with every note and highlight editable. If the app already has different notes for that lecture, it asks which version to keep.
- **Export → Notes as Markdown** saves study-friendly notes. **Export → Backup** saves a `.json` file you can restore later, which is worth doing before you clear browser data.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `export-pdf.js`: builds the annotated PDF
- `vendor/`: bundled so everything works offline: [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (Apache-2.0), [pdf-lib](https://pdf-lib.js.org) 1.17.1 + fontkit (MIT), DejaVu Sans font (free licence, covers Greek and math symbols)
- `sample-lecture.pdf`: a small demo file
