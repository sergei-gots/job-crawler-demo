import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  deleteJobHandler,
  getJobById,
  getJobs,
  getVacancies,
  patchJob,
  postJob,
  postStart,
  postStop,
} from "./crawler-jobs.controller.js";

export const crawlerJobsRouter = Router();

crawlerJobsRouter.use(requireAuth);
crawlerJobsRouter.get("/", getJobs);
crawlerJobsRouter.post("/", postJob);
crawlerJobsRouter.get("/:id", getJobById);
crawlerJobsRouter.patch("/:id", patchJob);
crawlerJobsRouter.delete("/:id", deleteJobHandler);
crawlerJobsRouter.post("/:id/start", postStart);
crawlerJobsRouter.post("/:id/stop", postStop);
crawlerJobsRouter.get("/:id/vacancies", getVacancies);
