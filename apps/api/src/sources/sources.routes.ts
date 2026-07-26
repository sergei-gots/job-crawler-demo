import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getSource, getSources, getVacancies } from "./sources.controller.js";

export const sourcesRouter = Router();

sourcesRouter.use(requireAuth);
sourcesRouter.get("/", getSources);
sourcesRouter.get("/:id", getSource);
sourcesRouter.get("/:id/vacancies", getVacancies);
