---
name: feature-design-docs
description: Use when starting, implementing, or updating a non-trivial feature or increment in this repo — covers the naming convention, required contents, and sync rules for design docs in .claude/features/. Triggers on "new feature", "new increment", "design doc", "feature doc".
---

# Feature design docs (`.claude/features/`)

Every non-trivial feature or increment gets a design doc in `.claude/features/`, written (or
updated) as part of that work — not after. These docs are the durable record of **why**: the
code shows *what* was built, the doc captures the reasoning, the alternatives rejected, and the
decisions locked with the user so they aren't silently re-litigated later.

- **Naming**: `<NN>[letter]_FEATURE_<SHORT_NAME>.md`, uppercase snake case, prefixed with the
  increment number so the directory listing sorts in build order (e.g.
  `02_FEATURE_REAL_CRAWLER_REDIS_ES.md` for Increment 2, `02b_FEATURE_VACANCY_DETAIL_CRAWL.md`
  for the Increment 2.2 sub-increment that follows it, `03_FEATURE_CRAWL_SEARCH_SEPARATION.md` for
  Increment 3). Use a trailing lowercase letter (`b`, `c`, ...) for a `.N` sub-increment rather
  than a literal dot — a dot sorts *before* the parent increment's own file in a plain
  alphabetical listing (`ls`, `sort`), putting `2.2` ahead of `2`; a letter suffix sorts after it,
  so the listing order matches build order. The doc's own title/content still says "Increment
  2.2" in prose — only the filename uses the letter form. When starting a new top-level increment,
  take the next integer; when it's a sub-step of the increment you're currently in, append the
  next letter to that increment's number instead of incrementing.
- **Contents**, roughly in this order: a **Context/Overview** (the problem and intended outcome),
  a **Status** line (Planned / Implemented / etc.), **decisions locked with the user** (each with
  its rationale, so they read as settled, not open), explicit **scope boundaries** (what's
  deliberately out of scope and why), a phased **implementation plan / steps** as a checklist, and
  a **verification** section (how to test it end-to-end, per the `testing-philosophy` skill).
- **Keep it in sync**: when the work lands, update the doc's Status and check off its steps; when a
  later change invalidates a decision recorded there, update the doc in the same PR — same rule as
  for `CLAUDE.md`/`README.md`/`ARCHITECTURE.md` drift.
- A large effort may be split across several increments/PRs but share **one** feature doc with
  phased sections, rather than one doc per PR — keeps the whole reasoning in one place.
