import { Fragment, type ReactNode } from "react";

// Kept in sync manually with HIGHLIGHT_PRE_TAG/HIGHLIGHT_POST_TAG in
// apps/api/src/search/queryVacancies.ts (no shared-types package in this repo). Plain marker
// strings, not real HTML tags - split out and rendered as our own <mark> element below, never via
// dangerouslySetInnerHTML, so nothing from an ES response is ever trusted as raw HTML.
const HIGHLIGHT_PRE_TAG = "@@HL_START@@";
const HIGHLIGHT_POST_TAG = "@@HL_END@@";

/** Splits a highlight fragment (e.g. "Senior @@HL_START@@Engineer@@HL_END@@ role") into text and
 * `<mark>` nodes for the matched substrings. Renders plain text unchanged when there's nothing to
 * highlight (no `highlighted` fragment, e.g. no active search query or no match in this field). */
export function renderHighlighted(text: string, highlighted?: string): ReactNode {
  if (!highlighted) return text;

  const parts = highlighted.split(new RegExp(`(${HIGHLIGHT_PRE_TAG}|${HIGHLIGHT_POST_TAG})`));
  const nodes: ReactNode[] = [];
  let isMatch = false;

  for (const part of parts) {
    if (part === HIGHLIGHT_PRE_TAG) {
      isMatch = true;
    } else if (part === HIGHLIGHT_POST_TAG) {
      isMatch = false;
    } else if (part) {
      nodes.push(isMatch ? <mark key={nodes.length}>{part}</mark> : <Fragment key={nodes.length}>{part}</Fragment>);
    }
  }

  return nodes;
}
