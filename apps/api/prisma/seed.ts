import { PrismaClient, SourceType } from "@prisma/client";

const prisma = new PrismaClient();

const sources: {
  name: string;
  baseUrl: string;
  type: SourceType;
  defaultDelayMs: number;
  // Whether maxPagesToCrawl bounds this source's listing fetches at all. RemoteOK's listing has
  // no real pagination (confirmed by spike in Increment 4 — `?page=2` returns the same 50 rows
  // as page 1), so `crawl()` always fetches it exactly once regardless of maxPagesToCrawl; the
  // field would be misleading if left editable in the UI for this source.
  supportsPageLimit: boolean;
}[] = [
  {
    name: "Habr Career",
    baseUrl: "https://career.habr.com",
    type: "STATIC",
    defaultDelayMs: 12000,
    supportsPageLimit: true,
  },
  {
    name: "RemoteOK",
    baseUrl: "https://remoteok.com",
    type: "DYNAMIC",
    defaultDelayMs: 11000,
    supportsPageLimit: false,
  },
  {
    name: "WeWorkRemotely",
    baseUrl: "https://weworkremotely.com",
    type: "STATIC",
    defaultDelayMs: 11000,
    supportsPageLimit: true,
  },
  {
    name: "Craigslist",
    baseUrl: "https://craigslist.org",
    type: "STATIC",
    defaultDelayMs: 11000,
    supportsPageLimit: true,
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
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
