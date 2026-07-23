import { PrismaClient, SourceType } from "@prisma/client";

const prisma = new PrismaClient();

const sources: { name: string; baseUrl: string; type: SourceType; defaultDelayMs: number }[] = [
  { name: "Habr Career", baseUrl: "https://career.habr.com", type: "DYNAMIC", defaultDelayMs: 2500 },
  { name: "Moikrug", baseUrl: "https://moikrug.ru", type: "STATIC", defaultDelayMs: 2000 },
  { name: "Craigslist", baseUrl: "https://craigslist.org", type: "STATIC", defaultDelayMs: 1500 },
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
