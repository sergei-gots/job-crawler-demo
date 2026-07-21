import { getJson } from "@/shared/lib/api";

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export async function getCurrentUser(token: string): Promise<CurrentUser> {
  const res = await getJson<{ user: CurrentUser }>("/auth/me", token);
  return res.user;
}
