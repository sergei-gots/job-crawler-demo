import type { Request, Response } from "express";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/errors.js";
import { getSourceById, listSources } from "./sources.service.js";

function handleError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`Unexpected sources error: ${String(error)}`);
  res.status(500).json({ error: "Internal server error" });
}

export async function getSources(_req: Request, res: Response): Promise<void> {
  try {
    const sources = await listSources();
    res.status(200).json({ sources });
  } catch (error) {
    handleError(res, error);
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
    handleError(res, error);
  }
}
