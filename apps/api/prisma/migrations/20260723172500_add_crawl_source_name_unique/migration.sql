-- AlterTable: enforce uniqueness on crawl_sources.name so seeding can upsert by name
CREATE UNIQUE INDEX "crawl_sources_name_key" ON "crawl_sources"("name");
