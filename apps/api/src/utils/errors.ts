import type { Response } from "express";
import { logger } from "../config/logger.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleError(res: Response, error: unknown, context: string): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`Unexpected ${context} error: ${String(error)}`);
  res.status(500).json({ error: "Internal server error" });
}
