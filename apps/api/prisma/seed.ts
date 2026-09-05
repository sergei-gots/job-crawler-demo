import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sources: {
  name: string;
  baseUrl: string;
  defaultDelayMs: number;
  // Caps how many vacancies from a crawl's listing pass get enriched/upserted, regardless of how
  // the underlying source paginates (or doesn't) its listing. Applied inside each strategy's
  // crawl() — see apps/api/src/crawler/vacancyCap.ts. 25 is a sane default for a demo-scale
  // corpus; raised per source later if needed.
  maxVacanciesToCrawl: number;
}[] = [
  {
    name: "Habr Career",
    baseUrl: "https://career.habr.com",
    defaultDelayMs: 12000,
    maxVacanciesToCrawl: 25,
  },
  {
    name: "RemoteOK",
    baseUrl: "https://remoteok.com",
    defaultDelayMs: 11000,
    maxVacanciesToCrawl: 25,
  },
  {
    name: "WeWorkRemotely",
    baseUrl: "https://weworkremotely.com",
    defaultDelayMs: 11000,
    maxVacanciesToCrawl: 25,
  },
  {
    name: "Craigslist",
    // Must be the "www" host - the bare apex domain 404s on /search/area/... (it only serves a
    // geo-redirect page at /area/<country>), confirmed live 2026-09-05.
    baseUrl: "https://www.craigslist.org",
    defaultDelayMs: 11000,
    maxVacanciesToCrawl: 25,
  },
];

// Named, independently-crawlable sub-targets within a source (see .claude/features/
// 09_FEATURE_CRAWL_LISTINGS.md) — additive only, most sources have none. subPath is resolved
// against the parent source's baseUrl by weWorkRemotelyStrategy.ts/craigslistStrategy.ts, not
// stored as an absolute URL, so the same seed entry still works if baseUrl ever changes. Each
// entry's target URL (and, for WWR, its matching .rss feed) is live-verified before being added
// here, per this project's standing rule of never seeding an unverified selector/URL.
const listings: { sourceName: string; label: string; subPath: string }[] = [
  {
    sourceName: "WeWorkRemotely",
    label: "Full-Stack",
    subPath: "/categories/remote-full-stack-programming-jobs",
  },
  {
    sourceName: "WeWorkRemotely",
    label: "Backend",
    subPath: "/categories/remote-back-end-programming-jobs",
  },
  // cat=sof is craigslist's "software / qa / dba / etc" job category - the tech-relevant slice of
  // an otherwise general-purpose classifieds site (see .claude/features/10_FEATURE_CRAIGSLIST.md).
  // Cities are limited to ones with confirmed non-zero live results as of 2026-09-05; e.g. austin
  // was checked and excluded for returning zero.
  {
    sourceName: "Craigslist",
    label: "SF Bay Area",
    subPath: "/search/area/sfbay?cat=sof",
  },
  {
    sourceName: "Craigslist",
    label: "New York",
    subPath: "/search/area/newyork?cat=sof",
  },
  {
    sourceName: "Craigslist",
    label: "Seattle",
    subPath: "/search/area/seattle?cat=sof",
  },
  {
    sourceName: "Craigslist",
    label: "Los Angeles",
    subPath: "/search/area/losangeles?cat=sof",
  },
  {
    sourceName: "Craigslist",
    label: "Chicago",
    subPath: "/search/area/chicago?cat=sof",
  },
];

async function main() {
  for (const source of sources) {
    await prisma.crawlSource.upsert({
      where: { name: source.name },
      update: source,
      create: source,
    });
  }

  for (const listing of listings) {
    const source = await prisma.crawlSource.findUniqueOrThrow({
      where: { name: listing.sourceName },
    });
    await prisma.crawlListing.upsert({
      where: { sourceId_subPath: { sourceId: source.id, subPath: listing.subPath } },
      update: { label: listing.label },
      create: { sourceId: source.id, label: listing.label, subPath: listing.subPath },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
