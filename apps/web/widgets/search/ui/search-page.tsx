"use client";

import { useState } from "react";
import { VacancyCard, vacancyKey } from "@/entities/vacancy";
import { useVacancySearch } from "@/features/search-vacancies";
import { useRequireAuth } from "@/entities/session";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageTitle } from "@/shared/ui/page-title";
import { FacetGroup } from "./facet-group";

const VACANCIES_PAGE_SIZE = 10;

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
    hits,
    facets,
    loading,
    error,
  } = useVacancySearch({ token, handleUnauthorized });
  const [hitsPage, setHitsPage] = useState(1);
  const [expandedRawVacancyIds, setExpandedRawVacancyIds] = useState<Set<string>>(new Set());

  function toggleRawVacancy(key: string) {
    setExpandedRawVacancyIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const pagedHits = (hits ?? []).slice(
    (hitsPage - 1) * VACANCIES_PAGE_SIZE,
    hitsPage * VACANCIES_PAGE_SIZE,
  );
  const totalHitsPages = Math.ceil((hits?.length ?? 0) / VACANCIES_PAGE_SIZE);

  // Any filter change should jump back to page 1 of the (new) results — cheapest way to keep
  // that true without a dedicated effect is to reset here whenever the filters that feed
  // useVacancySearch's query change, ahead of the paged slice above using a stale page number.
  const filtersKey = `${query}|${[...specialization].sort()}|${[...seniority].sort()}|${[...remote].sort()}|${[...location].sort()}|${[...company].sort()}`;
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey);
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey);
    if (hitsPage !== 1) setHitsPage(1);
  }

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <PageTitle>Search</PageTitle>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Input
          placeholder="Search title, company, description..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
                  {pagedHits.map((vacancy, index) => {
                    const key = vacancyKey(vacancy);
                    const ordinal = (hitsPage - 1) * VACANCIES_PAGE_SIZE + index + 1;
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
              {hits && hits.length > VACANCIES_PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={hitsPage === 1}
                    onClick={() => setHitsPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Page {hitsPage} of {totalHitsPages}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={hitsPage >= totalHitsPages}
                    onClick={() => setHitsPage((p) => p + 1)}
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
