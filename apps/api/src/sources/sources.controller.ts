import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import { updateListingActiveSchema, updateSourceSettingsSchema } from "./sources.schemas.js";
import {
  clearListingCache,
  clearSourceData,
  getListingRun,
  getListingVacancies,
  getSourceByIdWithStrategyInfo,
  getSourceRun,
  getSourceVacancies,
  listSources,
  startAllSourcesCrawl,
  startListingCrawl,
  startSourceCrawl,
  stopListingCrawl,
  stopSourceCrawl,
  updateListingActive,
  updateSourceSettings,
} from "./sources.service.js";

/** Parses and validates the `:id`/`:listingId` route params shared by every listing route. */
function parseListingParams(
  req: Request,
  res: Response,
): { sourceId: number; listingId: number } | null {
  const sourceId = Number(req.params.id);
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(sourceId) || !Number.isInteger(listingId)) {
    res.status(400).json({ error: "Invalid source or listing id" });
    return null;
  }
  return { sourceId, listingId };
}

export async function getSources(_req: Request, res: Response): Promise<void> {
  try {
    const sources = await listSources();
    res.status(200).json({ sources });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function getSource(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  try {
    const source = await getSourceByIdWithStrategyInfo(id);
    res.status(200).json({ source });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function patchSource(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  const parsed = updateSourceSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const source = await updateSourceSettings(id, parsed.data);
    res.status(200).json({ source });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function getVacancies(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  try {
    const vacancies = await getSourceVacancies(id);
    res.status(200).json({ vacancies });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function getRun(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  try {
    const run = await getSourceRun(id);
    res.status(200).json({ run });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postCrawl(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  try {
    const run = await startSourceCrawl(id);
    res.status(200).json({ run });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postCrawlStop(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  try {
    const run = await stopSourceCrawl(id);
    res.status(200).json({ run });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postClearData(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  try {
    await clearSourceData(id);
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postCrawlAll(_req: Request, res: Response): Promise<void> {
  try {
    const runs = await startAllSourcesCrawl();
    res.status(200).json({ runs });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postListingCrawl(req: Request, res: Response): Promise<void> {
  const params = parseListingParams(req, res);
  if (!params) return;

  try {
    const run = await startListingCrawl(params.sourceId, params.listingId);
    res.status(200).json({ run });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postListingCrawlStop(req: Request, res: Response): Promise<void> {
  const params = parseListingParams(req, res);
  if (!params) return;

  try {
    const run = await stopListingCrawl(params.sourceId, params.listingId);
    res.status(200).json({ run });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function getListingRunHandler(req: Request, res: Response): Promise<void> {
  const params = parseListingParams(req, res);
  if (!params) return;

  try {
    const run = await getListingRun(params.sourceId, params.listingId);
    res.status(200).json({ run });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function getListingVacanciesHandler(req: Request, res: Response): Promise<void> {
  const params = parseListingParams(req, res);
  if (!params) return;

  try {
    const vacancies = await getListingVacancies(params.sourceId, params.listingId);
    res.status(200).json({ vacancies });
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function postClearListingCache(req: Request, res: Response): Promise<void> {
  const params = parseListingParams(req, res);
  if (!params) return;

  try {
    await clearListingCache(params.sourceId, params.listingId);
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "sources");
  }
}

export async function patchListing(req: Request, res: Response): Promise<void> {
  const params = parseListingParams(req, res);
  if (!params) return;

  const parsed = updateListingActiveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const listing = await updateListingActive(params.sourceId, params.listingId, parsed.data.isActive);
    res.status(200).json({ listing });
  } catch (error) {
    handleError(res, error, "sources");
  }
}
