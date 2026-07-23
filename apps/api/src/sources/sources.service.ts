import type { CrawlSource } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../utils/errors.js";

export function listSources(): Promise<CrawlSource[]> {
  return prisma.crawlSource.findMany({ orderBy: { name: "asc" } });
}

export async function getSourceById(id: number): Promise<CrawlSource> {
  const source = await prisma.crawlSource.findUnique({ where: { id } });
  if (!source) {
    throw new ApiError(404, "Source not found");
  }
  return source;
}
