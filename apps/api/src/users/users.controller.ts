import type { Request, Response } from "express";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/errors.js";
import { changePassword, updateProfile } from "./users.service.js";
import { changePasswordSchema, updateProfileSchema } from "./users.schemas.js";

function handleError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`Unexpected users error: ${String(error)}`);
  res.status(500).json({ error: "Internal server error" });
}

export async function patchProfile(req: Request, res: Response): Promise<void> {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const user = await updateProfile(req.userId!, parsed.data);
    res.status(200).json({ user });
  } catch (error) {
    handleError(res, error);
  }
}

export async function patchPassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    await changePassword(req.userId!, parsed.data);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
}
