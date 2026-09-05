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
- **PR descriptions are short.** A squash-merge only carries the *commit* message onto `main`
  (confirmed: a merged PR's own body text does not appear in `git log` on `main`, only the commit
  message does) — the PR itself isn't lost either way (GitHub keeps merged PRs permanently,
  browsable by number/URL), but a long PR body's only real audience is the user reviewing it right
  before clicking merge. So: put the "why" in the **commit message** (this already happens per the
  message-drafting guidance above, and that's what's permanent in `git log`), and keep the **PR
  body** to a brief summary (a few bullets of what changed) plus a short **test plan** (commands
  run, what was verified live, anything not covered by automated checks) — not a full step-by-step
  narrative or a formal review checklist by default. Expand it only if the user asks for more
  detail on a specific PR.
- **Branch cleanup after a merge is split**: once a PR is merged and `main` is updated (e.g. during
  an explicit "update/rebase"), Claude deletes the now-merged **local** feature branch
  (`git branch -d`) as a normal part of that step. The **remote/GitHub** branch is the user's to
  delete themselves — don't run `git push origin --delete` unless explicitly asked to.
