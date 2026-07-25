"use client";

import { useRequireAuth } from "@/entities/session";
import { PageTitle } from "@/shared/ui/page-title";

export function Dashboard() {
  const { token } = useRequireAuth();

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <PageTitle>JobCrawler Demo</PageTitle>
        <p className="text-sm text-muted-foreground">
          Crawler jobs, search and AI enrichment will live here in the next iterations.
        </p>
      </div>
    </main>
  );
}
