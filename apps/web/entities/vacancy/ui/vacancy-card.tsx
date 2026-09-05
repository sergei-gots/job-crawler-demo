"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { renderHighlighted } from "../lib/highlight";
import { vacancyKey } from "../lib/vacancy-key";
import type { Vacancy } from "../lib/vacancy-types";

interface VacancyCardProps {
  vacancy: Vacancy;
  ordinal: number;
  isRawExpanded: boolean;
  onToggleRaw: () => void;
}

/** A single vacancy's card, shared by the Source detail page and the Search page (Increment 3b)
 * so the two never drift out of sync with each other. */
export function VacancyCard({ vacancy, ordinal, isRawExpanded, onToggleRaw }: VacancyCardProps) {
  const key = vacancyKey(vacancy);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="text-muted-foreground">{ordinal}. </span>
          <a
            href={vacancy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-link hover:underline"
          >
            {renderHighlighted(vacancy.title, vacancy.highlight?.title)}
          </a>
        </p>
        {vacancy.isRemote && (
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            Remote
          </span>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-1.5 w-fit"
        title={`http://localhost:9200/crawler_results/_doc/${key}`}
        onClick={onToggleRaw}
      >
        {isRawExpanded ? "Hide raw ES data" : "View raw ES data"}
      </Button>
      {isRawExpanded && (
        <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border bg-muted p-2 text-xs text-foreground">
          {JSON.stringify(vacancy, null, 2)}
        </pre>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {vacancy.company ? renderHighlighted(vacancy.company, vacancy.highlight?.company) : "Unknown company"}
        {vacancy.location && ` - ${vacancy.location}`}
        {vacancy.postedAt && ` - posted ${new Date(vacancy.postedAt).toLocaleDateString()}`}
      </p>
      {vacancy.skillsSummary && (
        <p className="mt-1.5 text-xs text-muted-foreground">{vacancy.skillsSummary}</p>
      )}
      {vacancy.description && (
        <div className="mt-1.5">
          <p className={cn("text-xs text-foreground", !isDescriptionExpanded && "line-clamp-2")}>
            {renderHighlighted(vacancy.description, vacancy.highlight?.description)}
          </p>
          <button
            type="button"
            onClick={() => setIsDescriptionExpanded((expanded) => !expanded)}
            className="mt-0.5 text-xs text-link hover:underline"
          >
            {isDescriptionExpanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
