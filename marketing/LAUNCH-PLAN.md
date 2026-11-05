# uni-pdf launch plan

A realistic plan for a free student tool built by one person. The goal for launch: **the first 500 students who actually use it**, and feedback from them. The ready-to-post copy is in [POSTS.md](POSTS.md) and the assets are in [assets/](assets/).

## 0. Before launch (one evening)

- [ ] **Make the repository public** (Settings → General → Danger zone → Change visibility). Free GitHub Pages needs it, and "open source" in the posts depends on it.
- [ ] **Turn on GitHub Pages:** Settings → Pages → Source: **GitHub Actions**. Push to `main` and check that https://arsimsaliu.github.io/uni-pdf/ loads.
- [ ] **Publish v1.0.0:** `git tag v1.0.0 && git push origin --tags`. Check that the release has `uni-pdf.zip` attached.
- [ ] Repo **About** box (gear icon on the repo page): description *"Take lecture notes right on your slides. Free, private, offline PDF reader for students."*, website set to the Pages URL, and topics `pdf`, `pdf-viewer`, `note-taking`, `students`, `study`, `university`, `annotations`, `pwa`, `offline-first`, `privacy`.
- [ ] Settings → General → **Social preview**: upload `site/assets/og-image.png`.
- [ ] Optional: enable **Discussions** for questions and ideas.
- [ ] Test the whole flow yourself on a phone and on a laptop with a real lecture PDF from your course.
- [ ] Give it to **3–5 classmates** for one real lecture each. Fix whatever confuses them. This is the most valuable step on the list.
- [ ] Optional: a custom domain (such as `unipdf.app`, if available) makes the posts and flyers look more trustworthy. Add it under Settings → Pages, then update the URLs in `site/index.html`, `scripts/build-site.js`, the QR code and these posts.

> **Name check:** "UniPDF" is also the name of a commercial PDF library for developers (by UniDoc). The audiences are different, but searching "unipdf" will show theirs first. Write it as **uni-pdf** everywhere, and consider a more distinctive name or domain before you put serious money or time into promotion.

## 1. Launch week

Post at most one or two channels per day, so you have time to reply to every comment. Replying fast and personally is what makes small launches work.

| Day | Channel | Notes |
|---|---|---|
| Mon | Your own network: WhatsApp/Discord groups of your courses, friends at other universities | Ask people to try it in their next lecture and tell you one thing that annoyed them. |
| Tue | Reddit: r/GetStudying, r/studytips | Read each subreddit's self-promotion rules first. Post as a person ("I built this for my own lectures"), include the GIF, and answer every comment. |
| Wed | **Show HN** (Hacker News) | Post between 14:00 and 16:00 UTC on a weekday. The privacy, no-server, works-from-`file://` angle does well there. Stay online for the first 3 hours. |
| Thu | Reddit: r/college, r/UniUK, r/EngineeringStudents, r/medicalschool (check rules), and a German-language sub like r/Studium | Change the first sentence for each community. Don't cross-post the identical text. |
| Fri | LinkedIn and X/Twitter thread | Use the "built it because…" story. Tag your university if allowed. |
| Sat | r/webdev "Showoff Saturday", r/opensource, r/selfhosted (offline/self-host angle) | A technical angle: pdf.js + pdf-lib, no backend, PWA. |
| Next Tue | **Product Hunt** | Launches start 00:01 Pacific time. Gallery images are in `assets/product-hunt-*.png`. Line up 5–10 friends to leave honest comments, not just upvotes. |

## 2. On campus (often works better than the internet)

- Print `assets/flyer-en.pdf` / `flyer-de.pdf` (A4, QR code included) for notice boards, the library and study rooms. Ask before posting.
- Ask your **student union / Studierendenvertretung (ÖH/AStA)** to share it in their newsletter or Instagram. Free, private and no account are exactly what they like to recommend. A template is in POSTS.md.
- Ask a **lecturer** you get along with whether they'd mention it, or put the link in the course page next to the slides.
- Course group chats at the start of semester and before exams (search, export) are the two moments with the most interest.

## 3. Directories (one-time, slow but steady traffic)

Submit to: AlternativeTo (as an alternative to Notability, GoodNotes, Adobe Acrobat Reader, LiquidText, MarginNote, Zotero's PDF reader), Product Hunt, SaaSHub, a "free tools for students" list, awesome-lists on GitHub (`awesome-pwa`, `awesome-selfhosted` if it fits, education lists), and Indie Hackers (as a build story).

## 4. After launch

- Reply to every GitHub issue within a day or two during the first weeks.
- Keep a short public **roadmap** issue and close it out loud ("You asked for X, it's in v1.1").
- Each release: update CHANGELOG.md, tag, and post a short "what's new" in the places that liked it.
- What to measure without analytics: GitHub stars, release download counts (`gh release view v1.0.0`), Pages traffic (repo → Insights → Traffic), issues, and replies. If you ever add analytics, use a privacy-friendly, cookie-less tool and update PRIVACY.md, because "no analytics" is currently a promise on the homepage.

## Ideas students will probably ask for

- Sync between devices (could work via a file in OneDrive or Dropbox without a server)
- Handwriting / pen input on tablets
- Bulk export of a whole course
- Flashcards from highlights (e.g. Anki export)
- Opening several PDFs in tabs
