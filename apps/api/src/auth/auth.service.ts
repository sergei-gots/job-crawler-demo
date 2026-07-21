import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../utils/errors.js";
import { signToken } from "./jwt.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

const SALT_ROUNDS = 10;

export interface PublicUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

function toPublicUser(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}): PublicUser {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
}

export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiError(409, "Email is already registered");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash },
  });

  return {
    accessToken: signToken({ userId: user.id }),
    user: toPublicUser(user),
  };
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid email or password");
  }

  return {
    accessToken: signToken({ userId: user.id }),
    user: toPublicUser(user),
  };
}

export async function getUserById(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(401, "User no longer exists");
  }
  return toPublicUser(user);
}
