import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { postClearCache, postClearSearchData } from "./admin.controller.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.post("/clear-search-data", postClearSearchData);
adminRouter.post("/clear-cache", postClearCache);
