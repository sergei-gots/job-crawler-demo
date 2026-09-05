"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/entities/session";
import { getCurrentUser, setCachedUser, type CurrentUser } from "@/entities/user";
import { ChangePasswordForm, UpdateProfileForm } from "@/features/profile";
import { ApiError } from "@/shared/lib/api";
import { Card, CardContent } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/shared/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export function ProfilePage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(() => {
    if (!token) return;
    getCurrentUser(token)
      .then((result) => {
        setUser(result);
        setCachedUser(result);
      })
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
        <PageTitle>Profile</PageTitle>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {user ? (
          <Card>
            <CardContent>
              <Tabs defaultValue="account">
                <TabsList>
                  <Tooltip>
                    <TooltipTrigger className="cursor-pointer border-none">
                      <TabsTab value="account">Account</TabsTab>
                    </TooltipTrigger>
                    <TooltipContent>Account Details - update your name and email.</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger className="cursor-pointer border-none">
                      <TabsTab value="password">Password</TabsTab>
                    </TooltipTrigger>
                    <TooltipContent>Change Password - update your account password.</TooltipContent>
                  </Tooltip>
                </TabsList>

                <TabsPanel value="account">
                  <UpdateProfileForm
                    user={user}
                    token={token}
                    onUpdated={(updated) => {
                      setUser(updated);
                      setCachedUser(updated);
                    }}
                  />
                </TabsPanel>

                <TabsPanel value="password">
                  <ChangePasswordForm token={token} />
                </TabsPanel>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </div>
    </main>
  );
}
