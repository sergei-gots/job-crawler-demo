"use client";

import { useRequireAuth } from "@/entities/session";
import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";

const STACK_GROUPS = [
  { label: "Backend", items: "Node.js, Express, TypeScript" },
  { label: "Frontend", items: "Next.js, React, Tailwind CSS" },
  { label: "Crawling", items: "Puppeteer, Axios + Cheerio" },
  { label: "Data", items: "PostgreSQL, Elasticsearch, Redis" },
  { label: "Auth", items: "JWT" },
  { label: "AI enrichment", items: "Claude API" },
];

export function About() {
  const { token } = useRequireAuth();

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <PageTitle>About</PageTitle>
        <Card>
          <CardHeader>
            <CardDescription>
              <a
                href="https://github.com/sergei-gots/job-crawler-demo"
                target="_blank"
                rel="noopener noreferrer"
                title="https://github.com/sergei-gots/job-crawler-demo"
                className="text-link hover:underline"
              >
                Job-Crawler-Demo
              </a>{" "}
              - a modular demonstration web application showcasing a modern web crawling and data
              processing stack.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {STACK_GROUPS.map((group) => (
                <li key={group.label}>
                  <span className="font-medium text-foreground">{group.label}: </span>
                  <span className="text-muted-foreground">{group.items}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
