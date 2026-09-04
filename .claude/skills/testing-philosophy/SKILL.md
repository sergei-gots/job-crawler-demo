---
name: testing-philosophy
description: Use when testing a change, verifying a feature works, or about to mark a feature "Done" in this repo — covers the manual-testing-first policy, the browser-automation restriction, manual testing goals, and the required Manual Testing Checklist. Triggers on "test this", "verify", "is this done", "mark as done".
---

# Testing Philosophy

- Primary testing method: **Manual testing** through the browser.
- The developer will manually check the web interface, user flows, and visual appearance.
- Do not use Claude Chrome Extension or any browser automation tools for regular development and testing unless explicitly requested.
- Automated tests exist for `apps/api`'s crawler/search logic (Vitest — run with `npm run test`
  inside `apps/api`, e.g. `apps/api/src/search/suggestVacancies.test.ts`); expand them for
  critical paths and regressions as the codebase grows.

**Manual Testing Goals:**

- Evaluate real User Experience (UX)
- Check visual layout and responsiveness
- Verify business workflows and usability
- Catch issues that automated tools often miss

**Before marking a feature as "Done":**

- Developer must perform manual testing
- Provide a short **Manual Testing Checklist** for the implemented feature
