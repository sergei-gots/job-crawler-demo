import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getSearch, getSuggest } from "./vacancies.controller.js";

export const vacanciesRouter = Router();

vacanciesRouter.use(requireAuth);
vacanciesRouter.get("/search", getSearch);
vacanciesRouter.get("/suggest", getSuggest);
