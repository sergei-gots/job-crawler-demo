import { patchJson } from "@/shared/lib/api";
import type { ChangePasswordFormValues } from "../model/change-password-schema";

export function changePassword(values: ChangePasswordFormValues, token: string): Promise<void> {
  const { currentPassword, newPassword } = values;
  return patchJson<void>("/users/me/password", { currentPassword, newPassword }, token);
}
