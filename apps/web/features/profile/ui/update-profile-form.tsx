"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { CurrentUser } from "@/entities/user";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PasswordInput } from "@/shared/ui/password-input";
import { updateProfile } from "../api/update-profile";
import { updateProfileSchema, type UpdateProfileFormValues } from "../model/update-profile-schema";

interface UpdateProfileFormProps {
  user: CurrentUser;
  token: string;
  onUpdated: (user: CurrentUser) => void;
}

export function UpdateProfileForm({ user, token, onUpdated }: UpdateProfileFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    values: { name: user.name ?? "", email: user.email, currentPassword: "" },
  });

  // Only name/email count towards "changed" - currentPassword has no "previous value" to compare
  // against (it's always blank, a re-auth confirmation field, not loaded data), so typing into it
  // alone shouldn't be what enables Save.
  const hasChanges = Boolean(dirtyFields.name || dirtyFields.email);

  async function onSubmit(values: UpdateProfileFormValues) {
    setServerError(null);
    setSuccess(false);
    try {
      const result = await updateProfile(values, token);
      onUpdated(result.user);
      setSuccess(true);
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} />
        {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentPassword">Current password</Label>
        {/* autoComplete="new-password" - without it, browsers treat this password-type field as a
            login field and silently autofill it with the user's own saved password for this site
            on page load, before they've typed anything. Plain autoComplete="off" does NOT stop
            this in modern Chrome (confirmed live - it still autofilled); "new-password" is the
            standard, actually-effective workaround, even though this field re-confirms an
            existing password rather than creating one. */}
        <PasswordInput id="currentPassword" autoComplete="new-password" {...register("currentPassword")} />
        {errors.currentPassword && (
          <p className="text-sm text-red-500">{errors.currentPassword.message}</p>
        )}
      </div>
      {serverError && <p className="text-sm text-red-500">{serverError}</p>}
      {success && <p className="text-sm text-green-600">Profile updated.</p>}
      <Button type="submit" disabled={isSubmitting || !hasChanges} className="w-fit">
        {isSubmitting ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
