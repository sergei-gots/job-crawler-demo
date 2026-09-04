-- CreateTable
CREATE TABLE "crawl_listings" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "subPath" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crawl_listings_sourceId_subPath_key" ON "crawl_listings"("sourceId", "subPath");

-- AlterTable
ALTER TABLE "crawl_runs" ADD COLUMN     "listingId" INTEGER;

-- AddForeignKey
ALTER TABLE "crawl_listings" ADD CONSTRAINT "crawl_listings_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "crawl_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "crawl_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
