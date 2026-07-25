import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getJobById, getJobs, postJob, postStart, postStop } from "./jobs.controller.js";

export const jobsRouter = Router();

jobsRouter.use(requireAuth);
jobsRouter.get("/", getJobs);
jobsRouter.post("/", postJob);
jobsRouter.get("/:id", getJobById);
jobsRouter.post("/:id/start", postStart);
jobsRouter.post("/:id/stop", postStop);
