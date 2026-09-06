---
name: slides-pdf
description: Use when the presentation slide decks under .claude/doc/slides/ (job-crawler-demo-slides-light.html / -dark.html) have been edited and their PDF counterparts need to be regenerated. Covers the exact headless-Chrome print-to-pdf command and its options. Triggers on "regenerate the slides PDF", "export slides to PDF", "update the PDF", or right after editing either slides HTML file.
---

# Regenerating the slide-deck PDFs

The two PDFs (`job-crawler-demo-slides-light.pdf`, `job-crawler-demo-slides-dark.pdf`) are a
**static snapshot** of the matching HTML file — there is no build script or watcher that keeps
them in sync. Any edit to `job-crawler-demo-slides-light.html` / `-dark.html` must be followed by
regenerating its PDF as part of that same step, the same anti-drift principle as the rest of
`.claude/doc/` (see `.claude/doc/CLAUDE.md`).

Each slide's `@page { size: 1280px 720px; margin: 0; }` rule already fixes the correct page size
(confirmed live: renders as 7 pages at 960×540pt, one per `<section class="slide">`) — no extra
flags needed to get one page per slide at the right dimensions.

## Command

Run from the repo root, one call per file:

```bash
google-chrome --headless --disable-gpu --no-sandbox \
  --print-to-pdf=.claude/doc/slides/job-crawler-demo-slides-dark.pdf \
  --no-pdf-header-footer \
  "file://$(pwd)/.claude/doc/slides/job-crawler-demo-slides-dark.html"

google-chrome --headless --disable-gpu --no-sandbox \
  --print-to-pdf=.claude/doc/slides/job-crawler-demo-slides-light.pdf \
  --no-pdf-header-footer \
  "file://$(pwd)/.claude/doc/slides/job-crawler-demo-slides-light.html"
```

- `--no-sandbox` is needed when running as the sandboxed/CI user this environment normally runs
  as — omit it if running as a regular desktop user where the Chrome sandbox works normally.
- `--no-pdf-header-footer` strips Chrome's default page-number/date/URL header-footer, which the
  slides' own `@page` styling doesn't expect.
- `google-chrome` (binary at `/usr/bin/google-chrome`) was confirmed present in this environment;
  `chromium`/`chromium-browser` is a drop-in substitute if only that's installed.

## Verifying the result

```bash
pdfinfo .claude/doc/slides/job-crawler-demo-slides-dark.pdf
```

Expect `Pages: 7` (one per `<section class="slide">` — recount if slides were added/removed) and
`Page size: 960 x 540 pts` (the `1280x720` `@page` size converted to points). A mismatch here
usually means the `@page` rule was edited or removed.
