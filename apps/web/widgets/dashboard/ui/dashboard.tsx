"use client";

import { useRequireAuth } from "@/entities/session";

export function Dashboard() {
  const { token } = useRequireAuth();

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-center p-4">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <h1 className="text-2xl font-semibold">JobCrawler Demo</h1>
        <p className="text-sm text-zinc-500">
          Crawler jobs, search and AI enrichment will live here in the next iterations.
        </p>
      </div>
    </main>
  );
}
