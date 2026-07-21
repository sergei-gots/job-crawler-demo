import { postJson } from "@/shared/lib/api";
import type { LoginFormValues } from "../model/login-schema";

export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string };
}

export function login(values: LoginFormValues): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/login", values);
}
