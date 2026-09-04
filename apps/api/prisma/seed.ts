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
    baseUrl: "https://craigslist.org",
    defaultDelayMs: 11000,
    maxVacanciesToCrawl: 25,
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
