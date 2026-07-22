import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../utils/errors.js";
import type { PublicUser } from "../auth/auth.service.js";
import type { ChangePasswordInput, UpdateProfileInput } from "./users.schemas.js";

const SALT_ROUNDS = 10;

function toPublicUser(user: { id: string; email: string; name: string | null }): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(401, "User no longer exists");
  }

  const passwordMatches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, "Current password is incorrect");
  }

  if (input.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError(409, "Email is already registered");
    }
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name: input.name, email: input.email },
    });
    return toPublicUser(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "Email is already registered");
    }
    throw error;
  }
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(401, "User no longer exists");
  }

  const currentMatches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw new ApiError(401, "Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
