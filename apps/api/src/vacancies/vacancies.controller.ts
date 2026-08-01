import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import { searchAllVacancies } from "./vacancies.service.js";

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

export async function getSearch(req: Request, res: Response): Promise<void> {
  try {
    const result = await searchAllVacancies({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      specialization: toStringArray(req.query.specialization),
      seniority: toStringArray(req.query.seniority),
      isRemote: toBooleanArray(req.query.isRemote),
      location: toStringArray(req.query.location),
      company: toStringArray(req.query.company),
    });
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, "vacancies");
  }
}
