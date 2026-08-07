import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import { searchAllVacancies, suggestAllVacancies } from "./vacancies.service.js";

/** Normalizes an Express query param that may be absent, a single value, or repeated
 * (`?specialization=A&specialization=B`) into a plain string array. */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const strings = values.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}

function toBooleanArray(value: unknown): boolean[] | undefined {
  const strings = toStringArray(value);
  if (!strings) return undefined;
  return strings.map((s) => s === "true");
}

/** Parses a positive-integer query param (`page`/`pageSize`); ignores absent or malformed values
 * and lets the search layer apply its defaults and clamps. */
function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function getSearch(req: Request, res: Response): Promise<void> {
  try {
    const result = await searchAllVacancies({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      specialization: toStringArray(req.query.specialization),
      seniority: toStringArray(req.query.seniority),
      isRemote: toBooleanArray(req.query.isRemote),
      location: toStringArray(req.query.location),
      company: toStringArray(req.query.company),
      page: toPositiveInt(req.query.page),
      pageSize: toPositiveInt(req.query.pageSize),
    });
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, "vacancies");
  }
}

export async function getSuggest(req: Request, res: Response): Promise<void> {
  try {
    const suggestions = await suggestAllVacancies(typeof req.query.q === "string" ? req.query.q : "");
    res.status(200).json({ suggestions });
  } catch (error) {
    handleError(res, error, "vacancies");
  }
}
