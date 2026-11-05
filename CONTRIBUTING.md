# Contributing to uni-pdf

Thanks for helping. uni-pdf is built for students, so feedback from real lectures is the most valuable contribution.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/ArsimSaliu/uni-pdf/issues/new/choose). For bugs, include your browser and device, and whether you use the online version, the installed app, or the offline download. If the bug only happens with one PDF, say so. Please don't attach PDFs that are private or copyrighted.

## Working on the code

The app is plain HTML, CSS and JavaScript with no build step. Edit the files in `app/` and reload.

```bash
npm install
npm start      # http://localhost:8080/app/
npm test       # Playwright end-to-end tests
npm run lint
```

Guidelines:

- **Keep it private and offline.** No network requests to other services, no analytics, no CDN links. New libraries go in `app/vendor/` together with their licence.
- **Keep it working from `file://`.** The offline download is opened by double-clicking `index.html`, where web workers, `fetch()` and service workers are unavailable. The test suite has a `file://` test.
- **Don't break saved data.** Notes live in IndexedDB (`lecture-pdf-notes`), and backups and editable PDFs use the `app: 'lecture-pdf-notes'` format. Changes must stay compatible with them.
- If you add a file the app loads, add it to the cache list in `app/sw.js`.
- If you change the UI, run `npm run screenshots` to refresh the homepage images (needs ffmpeg for the video).
- Add or update a test in `tests/` for behaviour changes.

By contributing you agree that your contribution is released into the public domain under the [Unlicense](LICENSE).
