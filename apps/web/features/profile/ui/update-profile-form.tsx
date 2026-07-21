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
    values: { firstName: user.firstName ?? "", lastName: user.lastName ?? "" },
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
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Email</Label>
            <Input value={user.email} disabled />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" {...register("firstName")} />
            {errors.firstName && (
              <p className="text-sm text-red-500">{errors.firstName.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" {...register("lastName")} />
            {errors.lastName && <p className="text-sm text-red-500">{errors.lastName.message}</p>}
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
