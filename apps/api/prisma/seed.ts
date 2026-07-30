import { PrismaClient, SourceType } from "@prisma/client";

const prisma = new PrismaClient();

const sources: { name: string; baseUrl: string; type: SourceType; defaultDelayMs: number }[] = [
  { name: "Habr Career", baseUrl: "https://career.habr.com", type: "STATIC", defaultDelayMs: 12000 },
  { name: "RemoteOK", baseUrl: "https://remoteok.com", type: "DYNAMIC", defaultDelayMs: 11000 },
  { name: "WeWorkRemotely", baseUrl: "https://weworkremotely.com", type: "STATIC", defaultDelayMs: 11000 },
  { name: "Craigslist", baseUrl: "https://craigslist.org", type: "STATIC", defaultDelayMs: 11000 },
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
