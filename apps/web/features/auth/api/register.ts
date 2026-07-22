import { postJson } from "@/shared/lib/api";
import type { RegisterFormValues } from "../model/register-schema";
import type { AuthResponse } from "./login";

export function register(values: RegisterFormValues): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/register", values);
}
