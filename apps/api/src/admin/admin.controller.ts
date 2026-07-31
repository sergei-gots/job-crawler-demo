import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import { clearCache, clearSearchData } from "./admin.service.js";

export async function postClearSearchData(_req: Request, res: Response): Promise<void> {
  try {
    await clearSearchData();
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "admin");
  }
}

export async function postClearCache(_req: Request, res: Response): Promise<void> {
  try {
    await clearCache();
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "admin");
  }
}
