import type { Request, Response } from "express";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/errors.js";
import { createJob, getJob, listJobs, startJob, stopJob } from "./jobs.service.js";
import { createJobSchema } from "./jobs.schemas.js";

function handleError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`Unexpected jobs error: ${String(error)}`);
  res.status(500).json({ error: "Internal server error" });
}

function parseJobId(req: Request, res: Response): number | undefined {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return undefined;
  }
  return id;
}

export async function getJobs(req: Request, res: Response): Promise<void> {
  try {
    const jobs = await listJobs(req.userId!);
    res.status(200).json({ jobs });
  } catch (error) {
    handleError(res, error);
  }
}

export async function getJobById(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const job = await getJob(req.userId!, id);
    res.status(200).json({ job });
  } catch (error) {
    handleError(res, error);
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
    handleError(res, error);
  }
}

export async function postStart(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const job = await startJob(req.userId!, id);
    res.status(200).json({ job });
  } catch (error) {
    handleError(res, error);
  }
}

export async function postStop(req: Request, res: Response): Promise<void> {
  const id = parseJobId(req, res);
  if (id === undefined) return;

  try {
    const job = await stopJob(req.userId!, id);
    res.status(200).json({ job });
  } catch (error) {
    handleError(res, error);
  }
}
