"use client";

import { useState } from "react";
import { VacancyCard, vacancyKey } from "@/entities/vacancy";
import { useSuggestions, useVacancySearch, type VacancySuggestion } from "@/features/search-vacancies";
import { useRequireAuth } from "@/entities/session";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPositioner,
  ComboboxPortal,
  ComboboxRoot,
} from "@/shared/ui/combobox";
import { PageTitle } from "@/shared/ui/page-title";
import { FacetGroup } from "./facet-group";

function suggestionLabel(item: VacancySuggestion): string {
  return item.value;
}

function remoteLabel(value: string): string {
  return value === "true" ? "Remote" : "On-site";
}

export function SearchPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const {
    query,
    setQuery,
    specialization,
    toggleSpecialization,
    seniority,
    toggleSeniority,
    remote,
    toggleRemote,
    location,
    toggleLocation,
    company,
    toggleCompany,
    page,
    setPage,
    pageSize,
    hits,
    total,
    facets,
    loading,
    error,
  } = useVacancySearch({ token, handleUnauthorized });
  const { suggestions } = useSuggestions(query, { token, handleUnauthorized });
  const [expandedRawVacancyIds, setExpandedRawVacancyIds] = useState<Set<string>>(new Set());

  function toggleRawVacancy(key: string) {
    setExpandedRawVacancyIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // `hits` is already the current page from the server; pagination is driven by the total count.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <PageTitle>Search</PageTitle>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ComboboxRoot<VacancySuggestion>
          items={suggestions}
          filter={null}
          inputValue={query}
          onInputValueChange={(value) => setQuery(value)}
          onValueChange={(item) => {
            if (item) setQuery(item.value);
          }}
          itemToStringLabel={suggestionLabel}
          autoComplete="none"
        >
          <ComboboxInput placeholder="Search title, company, description..." />
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup>
                <ComboboxEmpty>No suggestions.</ComboboxEmpty>
                <ComboboxList>
                  {(item: VacancySuggestion) => (
                    <ComboboxItem key={`${item.field}:${item.value}`} value={item}>
                      <span className="truncate">{item.value}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{item.field}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </ComboboxRoot>
        <div className="flex flex-col gap-6 md:flex-row">
          <Card size="sm" className="h-fit w-full shrink-0 md:w-56">
            <CardHeader>
              <CardTitle>Facets</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FacetGroup
                title="Specialization"
                buckets={facets.specialization}
                selected={specialization}
                onToggle={toggleSpecialization}
              />
              <FacetGroup
                title="Seniority level"
                buckets={facets.seniority}
                selected={seniority}
                onToggle={toggleSeniority}
              />
              <FacetGroup
                title="Remote / On-site"
                buckets={facets.isRemote}
                selected={remote}
                onToggle={(value) => toggleRemote(value as "true" | "false")}
                labelFor={remoteLabel}
              />
              <FacetGroup
                title="Location"
                buckets={facets.location}
                selected={location}
                onToggle={toggleLocation}
              />
              <FacetGroup
                title="Company"
                buckets={facets.company}
                selected={company}
                onToggle={toggleCompany}
              />
              {facets.specialization.length === 0 &&
                facets.seniority.length === 0 &&
                facets.isRemote.length === 0 &&
                facets.location.length === 0 &&
                facets.company.length === 0 && (
                  <p className="text-sm text-muted-foreground">No facets yet.</p>
                )}
            </CardContent>
          </Card>

          <Card className="w-full">
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent>
              {!hits ? (
                <p className="text-sm text-muted-foreground">
                  {loading ? "Searching..." : "Loading..."}
                </p>
              ) : hits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No vacancies match this search.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {hits.map((vacancy, index) => {
                    const key = vacancyKey(vacancy);
                    const ordinal = (page - 1) * pageSize + index + 1;
                    return (
                      <VacancyCard
                        key={key}
                        vacancy={vacancy}
                        ordinal={ordinal}
                        isRawExpanded={expandedRawVacancyIds.has(key)}
                        onToggleRaw={() => toggleRawVacancy(key)}
                      />
                    );
                  })}
                </div>
              )}
              {total > pageSize && (
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
