# uni-pdf press kit

## Facts

| | |
|---|---|
| **Name** | uni-pdf (lowercase, with a hyphen) |
| **What** | A free PDF reader for taking notes on lecture slides |
| **Platform** | Web app / PWA. Any modern browser on Windows, macOS, Linux, ChromeOS, Android, iPad/iOS. Offline download available. |
| **Price** | Free, no paid tier |
| **License** | Public domain (Unlicense), open source |
| **Data** | No server or account. Files and notes stay on the user's device. |
| **Website** | https://arsimsaliu.github.io/uni-pdf/ |
| **Source** | https://github.com/ArsimSaliu/uni-pdf |
| **Maker** | Arsim Saliu |
| **First release** | v1.0.0, November 2026 |

## Boilerplate

**50 words:**
uni-pdf is a free, open-source PDF reader built for lectures. Students highlight slides, attach notes to specific sentences, diagrams or formulas, search their notes, and export one PDF with their notes next to every slide. It runs in the browser, works offline, needs no account, and never uploads files.

**15 words:**
A free, private PDF reader that puts your lecture notes right next to the slides.

## Key features

1. Notes anchored to the exact text you selected, in four highlight colours
2. Area notes for diagrams, formulas and images
3. Notes for each slide and for the whole lecture, all searchable
4. Export: annotated PDF (notes column beside every slide), editable PDF (reopen and keep editing on any computer), Markdown, JSON backup
5. Private by design: no server, analytics or account
6. Offline, installable as an app, dark mode, keyboard shortcuts, works on phones and tablets

## Assets

| File | Use |
|---|---|
| `app/icons/icon.svg`, `icon-512.png` | Logo / app icon |
| `site/assets/og-image.png` (1200×630) | Link previews, social posts |
| `site/assets/demo.mp4`, `demo.gif` | Product demo (about 27 s) |
| `site/assets/reader.png`, `area-note.png`, `search.png`, `dark.png`, `mobile.png` | Screenshots (2×) |
| `site/assets/export-page.png`, `example-export.pdf` | What the exported PDF looks like |
| `marketing/assets/product-hunt-1..4.png` (1270×760) | Product Hunt gallery |
| `marketing/assets/square.png` (1080×1080), `story.png` (1080×1920) | Instagram, LinkedIn, stories |
| `marketing/assets/flyer-en.pdf`, `flyer-de.pdf` | Printable A4 posters with QR code |
| `marketing/assets/qr-homepage.svg` | QR code to the homepage |

Brand colour: `#2f6fde` (blue), highlight `#ffd600` (yellow), ink `#1b2333`.

To regenerate everything after UI changes: `npm run screenshots && node scripts/make-marketing.js`.
