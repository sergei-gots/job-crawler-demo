import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { patchPassword, patchProfile } from "./users.controller.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);
usersRouter.patch("/me", patchProfile);
usersRouter.patch("/me/password", patchPassword);
