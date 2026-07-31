"use client";

import { useRequireAuth } from "@/entities/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";

export function SearchPage() {
  const { token } = useRequireAuth();

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageTitle>Search</PageTitle>
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Free-text search and facets (Specialization, Seniority level, Remote/On-site,
              Location, Company) across every crawled vacancy - planned for Increment 3b. See{" "}
              <code>.claude/features/FEATURE_CRAWL_SEARCH_SEPARATION.md</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
