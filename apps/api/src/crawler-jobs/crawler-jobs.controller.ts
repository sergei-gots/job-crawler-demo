import type { Request, Response } from "express";
import { handleError } from "../utils/errors.js";
import {
  createJob,
  getJob,
  getJobVacancies,
  listJobs,
  startJob,
  stopJob,
} from "./crawler-jobs.service.js";
import { createJobSchema } from "./crawler-jobs.schemas.js";

function parseJobId(req: Request, res: Response): number | undefined {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid crawler job id" });
    return undefined;
  }
  return id;
}

export async function getJobs(req: Request, res: Response): Promise<void> {
  try {
    const jobs = await listJobs(req.userId!);
    res.status(200).json({ jobs });
  } catch (error) {
    handleError(res, error, "crawler-jobs");
  }
}

export async function getJobById(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const job = await getJob(req.userId!, id);
    res.status(200).json({ job });
  } catch (error) {
    handleError(res, error, "crawler-jobs");
  }
}

export async function postJob(req: Request, res: Response): Promise<void> {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const job = await createJob(req.userId!, parsed.data);
    res.status(201).json({ job });
  } catch (error) {
    handleError(res, error, "crawler-jobs");
  }
}

export async function postStart(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const job = await startJob(req.userId!, id);
    res.status(200).json({ job });
  } catch (error) {
    handleError(res, error, "crawler-jobs");
  }
}

export async function postStop(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const job = await stopJob(req.userId!, id);
    res.status(200).json({ job });
  } catch (error) {
    handleError(res, error, "crawler-jobs");
  }
}

export async function getVacancies(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const vacancies = await getJobVacancies(req.userId!, id);
    res.status(200).json({ vacancies });
  } catch (error) {
    handleError(res, error, "crawler-jobs");
  }
}
