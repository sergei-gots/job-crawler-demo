"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/entities/session";
import { getCurrentUser, type CurrentUser } from "@/entities/user";
import { ChangePasswordForm, UpdateProfileForm } from "@/features/profile";
import { ApiError } from "@/shared/lib/api";

export function ProfilePage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(() => {
    if (!token) return;
    getCurrentUser(token)
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError("Failed to load profile");
      });
  }, [token, handleUnauthorized]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <h1 className="text-2xl font-semibold">Profile</h1>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {user ? (
          <>
            <UpdateProfileForm user={user} token={token} onUpdated={setUser} />
            <ChangePasswordForm token={token} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </div>
    </main>
  );
}
