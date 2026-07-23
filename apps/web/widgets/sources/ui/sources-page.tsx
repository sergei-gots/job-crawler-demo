"use client";

import { useEffect, useState } from "react";
import { useRequireAuth } from "@/entities/session";
import { getSources, type Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

function typeLabel(type: Source["type"]): string {
  return type === "DYNAMIC" ? "Puppeteer" : "Axios";
}

export function SourcesPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getSources(token)
      .then(setSources)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError("Failed to load sources");
      });
  }, [token, handleUnauthorized]);

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-2xl font-semibold">Sources</h1>
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
                        <td className="py-1.5 pr-4 text-muted-foreground">{source.baseUrl}</td>
                        <td className="py-1.5 pr-4">{typeLabel(source.type)}</td>
                        <td className="py-1.5 pr-4">{source.defaultDelayMs}ms</td>
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
