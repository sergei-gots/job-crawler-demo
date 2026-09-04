---
name: git-workflow
description: Use when creating commits or preparing/opening a pull request for this repo — covers commit message conventions, branch naming, PR description format (step-by-step account + review checklist), and the no-auto-merge rule. Triggers on "commit", "create a PR", "merge", "push".
---

# Git & Development Workflow

- Use meaningful commit messages in English.
- Work in feature branches (e.g. `feat/crawl-search-separation-3a`, `fix/crawler-rate-limit`).
- Keep `main` branch stable.
- Commit often, push regularly.
- All code must be in English.
- Claude drafts the commit message(s) and the pull request description for each step of work,
  in the usual format: a summary of what changed and why, plus a test plan / checklist of what
  still needs manual review or testing (e.g. "not yet covered by automated tests — verify
  manually: ..."). By default the user reviews the draft and creates the actual PR themselves.
  Claude may open the PR itself via `gh pr create` **only when explicitly asked** to do so in that
  moment (e.g. "create the PR", "open it via the link") — this is not a standing default, so ask
  again next time rather than assuming carryover. This does not change the merge rule below.
- **No automatic merges, ever.** Every change lands on a feature branch and goes through a PR;
  `main` only moves when the user reviews and merges it themselves. Claude never merges a PR,
  even if asked to "just finish it up" — merging is always a manual, explicit user action.
- Every PR description must include, in full: (1) a step-by-step account of what was actually
  done (not just a summary — enough detail that the user can follow the reasoning without
  re-reading the diff), and (2) a **review checklist** of concrete things the user should verify
  before merging (commands to run, URLs to open, edge cases to try, anything not covered by
  automated checks).
