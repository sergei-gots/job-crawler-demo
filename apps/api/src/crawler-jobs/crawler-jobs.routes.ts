import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getJobById, getJobs, postJob, postStart, postStop } from "./crawler-jobs.controller.js";

export const crawlerJobsRouter = Router();

crawlerJobsRouter.use(requireAuth);
crawlerJobsRouter.get("/", getJobs);
crawlerJobsRouter.post("/", postJob);
crawlerJobsRouter.get("/:id", getJobById);
crawlerJobsRouter.post("/:id/start", postStart);
crawlerJobsRouter.post("/:id/stop", postStop);
