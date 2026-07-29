import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import {
  getSourceById,
  getSourceRun,
  getSourceVacancies,
  listSources,
  startAllSourcesCrawl,
  startSourceCrawl,
  stopSourceCrawl,
} from "./sources.service.js";

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
    const source = await getSourceById(id);
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

export async function postCrawlAll(_req: Request, res: Response): Promise<void> {
  try {
    const runs = await startAllSourcesCrawl();
    res.status(200).json({ runs });
  } catch (error) {
    handleError(res, error, "sources");
  }
}
