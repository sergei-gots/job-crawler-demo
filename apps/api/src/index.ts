import "dotenv/config";
import cors from "cors";
import express from "express";
import { authRouter } from "./auth/auth.routes.js";
import { logger } from "./config/logger.js";
import { crawlerJobsRouter } from "./crawler-jobs/crawler-jobs.routes.js";
import { sourcesRouter } from "./sources/sources.routes.js";
import { usersRouter } from "./users/users.routes.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "jobcrawler-api" });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/sources", sourcesRouter);
app.use("/crawler-jobs", crawlerJobsRouter);

app.listen(port, () => {
  logger.info(`API listening on http://localhost:${port}`);
});
