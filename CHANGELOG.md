# Changelog

All notable changes to uni-pdf. Versions follow [semantic versioning](https://semver.org).

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
