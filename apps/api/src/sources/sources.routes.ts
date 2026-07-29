import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getRun,
  getSource,
  getSources,
  getVacancies,
  postCrawl,
  postCrawlAll,
  postCrawlStop,
} from "./sources.controller.js";

export const sourcesRouter = Router();

sourcesRouter.use(requireAuth);
sourcesRouter.get("/", getSources);
sourcesRouter.post("/crawl-all", postCrawlAll);
sourcesRouter.get("/:id", getSource);
sourcesRouter.get("/:id/vacancies", getVacancies);
sourcesRouter.get("/:id/run", getRun);
sourcesRouter.post("/:id/crawl", postCrawl);
sourcesRouter.post("/:id/crawl/stop", postCrawlStop);
