import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getRun,
  getSource,
  getSources,
  getVacancies,
  patchSource,
  postClearData,
  postCrawl,
  postCrawlAll,
  postCrawlStop,
} from "./sources.controller.js";

export const sourcesRouter = Router();

sourcesRouter.use(requireAuth);
sourcesRouter.get("/", getSources);
sourcesRouter.post("/crawl-all", postCrawlAll);
sourcesRouter.get("/:id", getSource);
sourcesRouter.patch("/:id", patchSource);
sourcesRouter.get("/:id/vacancies", getVacancies);
sourcesRouter.get("/:id/run", getRun);
sourcesRouter.post("/:id/crawl", postCrawl);
sourcesRouter.post("/:id/crawl/stop", postCrawlStop);
sourcesRouter.post("/:id/clear-data", postClearData);
