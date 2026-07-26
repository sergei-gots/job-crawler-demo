"use client";

import { useEffect, useState } from "react";
import { useRequireAuth } from "@/entities/session";
import { getSources, type Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";

function typeTooltip(type: Source["type"]): string {
  return type === "DYNAMIC"
    ? "Dynamic (JS-rendered) pages → uses Puppeteer"
    : "Static pages → uses Axios + Cheerio";
}

function formatDelay(delayMs: number): string {
  return `${delayMs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ms`;
}

export function SourcesPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const authToken = token;

    async function load() {
      try {
        const result = await getSources(authToken);
        setSources(result);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError("Failed to load sources");
      }
    }

    load();
  }, [token, handleUnauthorized]);

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageTitle>Sources</PageTitle>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Card>
          <CardHeader>
            <CardTitle>Predefined data sources</CardTitle>
          </CardHeader>
          <CardContent>
            {!sources ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1.5 pr-4 font-medium">Name</th>
                      <th className="py-1.5 pr-4 font-medium">Base URL</th>
                      <th className="py-1.5 pr-4 font-medium">Type</th>
                      <th className="py-1.5 pr-4 font-medium">Delay</th>
                      <th className="py-1.5 font-medium">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source) => (
                      <tr key={source.id} className="border-t border-border">
                        <td className="py-1.5 pr-4">{source.name}</td>
                        <td className="py-1.5 pr-4">
                          <a
                            href={source.baseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-link hover:underline"
                          >
                            {source.baseUrl}
                          </a>
                        </td>
                        <td className="py-1.5 pr-4" title={typeTooltip(source.type)}>
                          {source.type}
                        </td>
                        <td className="py-1.5 pr-4">{formatDelay(source.defaultDelayMs)}</td>
                        <td className="py-1.5">{source.isActive ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
