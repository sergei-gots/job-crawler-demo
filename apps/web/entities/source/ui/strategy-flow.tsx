"use client";

import { Fragment, useState } from "react";
import type { StrategyStep } from "../lib/get-sources";
import { STRATEGY_GLOSSARY } from "../lib/strategy-glossary";
import { cn } from "@/shared/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const GLOSSARY_TOKEN = /\{\{([^}]+)\}\}/g;

/**
 * Parses `{{term}}` markup (see `strategy-glossary.ts`) into inline glossary tooltips. A term
 * with no matching glossary entry renders as plain bracketed text and logs a warning in
 * development, so an author who forgets to add the entry notices immediately rather than
 * shipping silently-broken-looking markup.
 */
function renderWithGlossary(text: string) {
  const parts = text.split(GLOSSARY_TOKEN);
  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    // String.split with a capturing global regex alternates plain text (even indices) and
    // captured group matches (odd indices).
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;

    const expansion = STRATEGY_GLOSSARY[part];
    if (!expansion) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`StrategyFlow: no glossary entry for "${part}" - add one to strategy-glossary.ts`);
      }
      return <Fragment key={index}>{`{{${part}}}`}</Fragment>;
    }

    return (
      <Tooltip key={index}>
        <TooltipTrigger>{part}</TooltipTrigger>
        <TooltipContent>{expansion}</TooltipContent>
      </Tooltip>
    );
  });
}

function StepBox({ step, defaultExpanded = false }: { step: StrategyStep; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetail = Boolean(step.detail);

  if (step.type === "decision") {
    return (
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "mx-auto block w-fit max-w-[85%] rounded-full border border-dashed border-border px-4 py-1.5 text-center text-xs italic text-muted-foreground",
          hasDetail && "cursor-pointer hover:border-foreground/40",
        )}
      >
        {renderWithGlossary(step.title)}
        {expanded && step.detail && (
          <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5 text-left not-italic">
            <p className="text-muted-foreground">{renderWithGlossary(step.detail.explanation)}</p>
            {step.detail.result && (
              <p className="font-medium text-foreground">{renderWithGlossary(step.detail.result)}</p>
            )}
          </div>
        )}
      </button>
    );
  }

  const boxClasses = cn(
    "w-full rounded-lg border px-3 py-2 text-left text-sm",
    step.type === "problem" && "border-destructive/40 text-destructive",
    step.type === "solution" && "border-border font-medium text-foreground",
    step.type === "process" && "border-border text-foreground",
    step.type === "terminal" && "border-dashed border-border text-muted-foreground",
  );

  return (
    <button type="button" disabled={!hasDetail} onClick={() => setExpanded((v) => !v)} className={cn(boxClasses, hasDetail && "cursor-pointer hover:border-foreground/40")}>
      <span className="flex items-center justify-between gap-2">
        {renderWithGlossary(step.title)}
        {hasDetail && <span className="text-xs text-muted-foreground">{expanded ? "▴" : "▾"}</span>}
      </span>
      {expanded && step.detail && (
        <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
          {step.detail.method && <p className="font-mono text-muted-foreground">{step.detail.method}</p>}
          <p className="text-muted-foreground">{renderWithGlossary(step.detail.explanation)}</p>
          {step.detail.result && (
            <p className="font-medium text-foreground">{renderWithGlossary(step.detail.result)}</p>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Renders one source's crawl-strategy step chain, click-to-expand per step. `steps` comes
 * straight from the API's `strategySteps` (see `CrawlStrategy.steps` in apps/api) — this
 * component has no data of its own, so it can never drift from the strategy code it describes.
 *
 * `defaultExpanded` starts every step's detail panel open instead of collapsed - each step stays
 * individually collapsible by click, this only changes the initial state. Useful when the whole
 * diagram needs to be visible at a glance (e.g. presenting it) rather than clicked through step by
 * step.
 */
export function StrategyFlow({ steps, defaultExpanded = false }: { steps: StrategyStep[]; defaultExpanded?: boolean }) {
  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {steps.map((step, index) => (
        <div key={index} className="flex flex-col items-center gap-1.5">
          <StepBox step={step} defaultExpanded={defaultExpanded} />
          {index < steps.length - 1 && <span className="text-muted-foreground">{"↓"}</span>}
        </div>
      ))}
    </div>
  );
}
