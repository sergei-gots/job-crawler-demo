"use client";

import { useRequireAuth } from "@/entities/session";
import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";

interface StackItem {
  name: string;
  tooltip: string;
}

interface StackGroup {
  label: string;
  items: StackItem[];
}

const STACK_GROUPS: StackGroup[] = [
  {
    label: "Backend",
    items: [
      { name: "Node.js", tooltip: "JavaScript runtime environment for running server-side code" },
      {
        name: "Express",
        tooltip: "Minimal web framework for Node.js — routing, middleware, HTTP request handling",
      },
      {
        name: "TypeScript",
        tooltip: "Typed superset of JavaScript that compiles down to plain JavaScript",
      },
    ],
  },
  {
    label: "Frontend",
    items: [
      {
        name: "Next.js",
        tooltip: "React framework with file-based routing and both client- and server-rendered pages",
      },
      { name: "React", tooltip: "JavaScript library for building UIs out of reusable components" },
      {
        name: "Tailwind CSS",
        tooltip: "Utility-first CSS framework — styles are applied via small, composable class names",
      },
    ],
  },
  {
    label: "Crawling",
    items: [
      {
        name: "Puppeteer",
        tooltip: "Headless-browser automation library, used to crawl pages that need JavaScript to render",
      },
      {
        name: "Axios + Cheerio",
        tooltip:
          "Axios (HTTP client) fetches raw HTML, Cheerio parses it jQuery-style — used for pages that are already fully rendered by the server",
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        name: "PostgreSQL",
        tooltip: "Relational database — source of truth for users, sources, and crawl run/log history",
      },
      {
        name: "Elasticsearch",
        tooltip: "Search engine storing crawled vacancies, powering full-text search and facets",
      },
      {
        name: "Redis",
        tooltip: "In-memory store used here for per-source rate limiting and short-lived page caching",
      },
    ],
  },
  {
    label: "Auth",
    items: [
      {
        name: "JWT",
        tooltip: "JSON Web Token — a signed token proving who's logged in, sent with each API request",
      },
    ],
  },
  {
    label: "AI enrichment",
    items: [
      {
        name: "Claude API",
        tooltip:
          "Anthropic's LLM API, planned for summarizing vacancies and extracting skills — not implemented yet",
      },
    ],
  },
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
                  <span className="text-muted-foreground">
                    {group.items.map((item, index) => (
                      <span key={item.name}>
                        <span title={item.tooltip}>{item.name}</span>
                        {index < group.items.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
