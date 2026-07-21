import type { Request, Response } from "express";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/errors.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import { getUserById, loginUser, registerUser } from "./auth.service.js";

function handleAuthError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`Unexpected auth error: ${String(error)}`);
  res.status(500).json({ error: "Internal server error" });
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const result = await registerUser(parsed.data);
    res.status(201).json(result);
  } catch (error) {
    handleAuthError(res, error);
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const result = await loginUser(parsed.data);
    res.status(200).json(result);
  } catch (error) {
    handleAuthError(res, error);
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  try {
    const user = await getUserById(req.userId!);
    res.status(200).json({ user });
  } catch (error) {
    handleAuthError(res, error);
  }
}
