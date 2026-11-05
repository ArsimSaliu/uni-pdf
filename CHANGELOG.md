# Changelog

All notable changes to uni-pdf. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Added
- **Default note colour:** pick the colour for new highlights and notes in *More (⋯) → Default note color* or from the command palette. It is remembered on this device and used by the **Note** button, `H` and `N`. The Note button shows the current colour.

### Fixed
- After clicking **Note** on selected text, the note box is ready for typing right away in every browser (Safari and Firefox could lose the cursor).

## [1.1.0] - 2026-11-05

The study release: features for revising, not just reading.

### Added
- **Drawing mode** (`D` or **✏ Draw**): draw on slides with a pen or highlighter in five colours and three sizes, erase strokes, and undo with `Ctrl+Z`. Works with a mouse, a touchscreen or a stylus. Drawings stay sharp at every zoom level, can get a note like any highlight, become flashcards, and are exported as vector lines in the PDF.
- **Study mode (flashcards):** every highlight or area with a note becomes a card. Reveal the answer, grade it (Again / Good / Easy), and spaced repetition schedules the next review. Diagram cards show the boxed part of the slide. Open it with **🎓 Study** or `S`.
- **Flashcards for Anki:** *Export → Flashcards for Anki* saves a file that Anki imports directly, tagged by lecture and page.
- **Search in the slides** (`Ctrl+F`): finds text on every page, including ones that aren't rendered yet, highlights all matches, and steps through them with `Enter` / `Shift+Enter`.
- **Page thumbnails and outline** (`T`): a sidebar with all pages, showing which ones have notes or flags, plus the PDF's table of contents when it has one.
- **Page flags:** mark slides ⭐ *exam-relevant* (`E`) or ❓ *question to ask* (`Q`). Filter by them in *All notes*. They appear in the Markdown and PDF exports and in the library.
- **Library search:** search the notes of all your lectures at once and jump straight to the right page.
- **Full backup:** back up every PDF and note in one file, and restore it on another computer or after clearing the browser.

### Changed
- **A fresh, modern design.**
  - The Inter font and a consistent icon set (Lucide) replace emoji icons.
  - Softer colours and depth, smooth animations, and a dark mode that looks the same everywhere.
  - A theme option: light, dark, or the same as your device.
- **A tidier toolbar.**
  - A Select / Area / Draw switcher, with Study and Export at the top.
  - Page navigation and zoom moved to a small floating bar over the slides.
  - Everything else lives in the ⋯ menu.
- **Command palette** (`Ctrl+K`): search and run every action, or jump to any lecture.
- **Library as cards:** a preview of each lecture, a progress bar, and badges for exam pages, questions and cards due. Lectures can be grouped into **courses**.
- **Proper dialogs** instead of browser pop-ups for important choices (which notes to keep, removing a lecture, restoring a backup).
- The text selection popover can also **copy** the text or **search** the slides for it.
- **On phones**, the notes panel is a bottom sheet you can drag up and down.
- The library shows exam and question counts and how many cards are due for review.

## [1.0.0] - 2026-11-05

The first public release.

### Added
- **Hosted web app and homepage** on GitHub Pages, plus an offline download (`uni-pdf.zip`) on every release.
- **Install as an app (PWA)** with full offline support. When installed in Chrome or Edge, PDFs can be opened straight from the file manager.
- **Demo lecture**: one click on the start screen opens a realistic sample deck to try everything on.
- **Keyboard shortcut help** (`?` or the toolbar button) and an *O* shortcut for opening a PDF.
- **Undo** after deleting a highlight or note.
- **Touch support**: long-press text on phones and tablets to get the highlight toolbar, with larger touch targets.
- New start screen with a short how-to, and links to the source and the bug tracker.
- App icon, social preview image, and accessibility labels on toolbar buttons and menus.
- End-to-end test suite (Playwright), linting, and CI.

### Changed
- Renamed to **uni-pdf**. Existing notes, backups and editable PDFs from *Lecture Notes PDF* keep working.
- Area mode now turns itself off after drawing one box.
- The toolbar stays on one row on laptop screens and is more compact on phones.
- Deleting a highlight no longer asks for confirmation (use Undo instead).

### Earlier
- Text highlights in four colours, notes anchored to text, area notes, per-page and lecture notes, search, PDF / editable PDF / Markdown / JSON export, dark mode, and local storage in IndexedDB.
