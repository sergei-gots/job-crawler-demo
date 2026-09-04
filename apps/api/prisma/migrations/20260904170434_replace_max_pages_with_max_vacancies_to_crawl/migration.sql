-- AlterTable
ALTER TABLE "crawl_sources" DROP COLUMN "maxPagesToCrawl",
DROP COLUMN "supportsPageLimit",
ADD COLUMN     "maxVacanciesToCrawl" INTEGER NOT NULL DEFAULT 25;
