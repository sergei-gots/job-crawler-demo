"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { CurrentUser } from "@/entities/user";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
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
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    values: { name: user.name ?? "", email: user.email, currentPassword: "" },
  });

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
    <Card>
      <CardHeader>
        <CardTitle>Account details</CardTitle>
      </CardHeader>
      <CardContent>
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
            <PasswordInput id="currentPassword" {...register("currentPassword")} />
            {errors.currentPassword && (
              <p className="text-sm text-red-500">{errors.currentPassword.message}</p>
            )}
          </div>
          {serverError && <p className="text-sm text-red-500">{serverError}</p>}
          {success && <p className="text-sm text-green-600">Profile updated.</p>}
          <Button type="submit" disabled={isSubmitting} className="w-fit">
            {isSubmitting ? "Saving..." : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
