import { patchJson } from "@/shared/lib/api";
import type { CurrentUser } from "@/entities/user";
import type { UpdateProfileFormValues } from "../model/update-profile-schema";

export function updateProfile(
  values: UpdateProfileFormValues,
  token: string,
): Promise<{ user: CurrentUser }> {
  return patchJson<{ user: CurrentUser }>("/users/me", values, token);
}
