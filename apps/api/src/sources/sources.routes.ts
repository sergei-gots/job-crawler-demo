import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getListingRunHandler,
  getListingVacanciesHandler,
  getRun,
  getSource,
  getSources,
  getVacancies,
  patchListing,
  patchSource,
  postClearData,
  postCrawl,
  postCrawlAll,
  postCrawlStop,
  postListingCrawl,
  postListingCrawlStop,
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
sourcesRouter.post("/:id/listings/:listingId/crawl", postListingCrawl);
sourcesRouter.post("/:id/listings/:listingId/crawl/stop", postListingCrawlStop);
sourcesRouter.get("/:id/listings/:listingId/run", getListingRunHandler);
sourcesRouter.get("/:id/listings/:listingId/vacancies", getListingVacanciesHandler);
sourcesRouter.patch("/:id/listings/:listingId", patchListing);
