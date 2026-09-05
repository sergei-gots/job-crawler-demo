"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { PasswordInput } from "@/shared/ui/password-input";
import { changePassword } from "../api/change-password";
import { changePasswordSchema, type ChangePasswordFormValues } from "../model/change-password-schema";

interface ChangePasswordFormProps {
  token: string;
}

export function ChangePasswordForm({ token }: ChangePasswordFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const MIN_PASSWORD_LENGTH = 8;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) });

  // Enabled once new/confirm are both long enough AND match, independent of the full schema
  // (which also requires a non-empty currentPassword) - a quick, cheap "there's enough here to be
  // worth trying" gate rather than a full live-validity check on every keystroke; the schema's own
  // error message still catches a missing currentPassword on submit.
  const [newPassword, confirmNewPassword] = watch(["newPassword", "confirmNewPassword"]);
  const canSubmit =
    (newPassword?.length ?? 0) >= MIN_PASSWORD_LENGTH &&
    (confirmNewPassword?.length ?? 0) >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmNewPassword;

  async function onSubmit(values: ChangePasswordFormValues) {
    setServerError(null);
    setSuccess(false);
    try {
      await changePassword(values, token);
      setSuccess(true);
      reset();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        New password must be at least {MIN_PASSWORD_LENGTH} characters.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentPassword">Current password</Label>
        {/* autoComplete="new-password" - see update-profile-form.tsx's identical field for why. */}
        <PasswordInput id="currentPassword" autoComplete="new-password" {...register("currentPassword")} />
        {errors.currentPassword && (
          <p className="text-sm text-red-500">{errors.currentPassword.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword">New password</Label>
        <PasswordInput id="newPassword" autoComplete="new-password" {...register("newPassword")} />
        {errors.newPassword && (
          <p className="text-sm text-red-500">{errors.newPassword.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmNewPassword">Confirm new password</Label>
        <PasswordInput
          id="confirmNewPassword"
          autoComplete="new-password"
          {...register("confirmNewPassword")}
        />
        {errors.confirmNewPassword && (
          <p className="text-sm text-red-500">{errors.confirmNewPassword.message}</p>
        )}
      </div>
      {serverError && <p className="text-sm text-red-500">{serverError}</p>}
      {success && <p className="text-sm text-green-600">Password changed.</p>}
      <Button type="submit" disabled={isSubmitting || !canSubmit} className="w-fit">
        {isSubmitting ? "Saving..." : "Change password"}
      </Button>
    </form>
  );
}
