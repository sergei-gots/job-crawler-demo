import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import { getSourceById, getSourceVacancies, listSources } from "./sources.service.js";

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
