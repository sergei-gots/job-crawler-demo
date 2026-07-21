import "dotenv/config";
import cors from "cors";
import express from "express";
import { authRouter } from "./auth/auth.routes.js";
import { logger } from "./config/logger.js";
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

app.listen(port, () => {
  logger.info(`API listening on http://localhost:${port}`);
});
