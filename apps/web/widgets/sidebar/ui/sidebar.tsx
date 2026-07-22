"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, useRequireAuth } from "@/entities/session";
import { getCurrentUser, type CurrentUser } from "@/entities/user";
import { ApiError } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
];

export function Sidebar() {
  const { token, handleUnauthorized } = useRequireAuth();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!token) return;
    getCurrentUser(token)
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
        }
      });
  }, [token, handleUnauthorized]);

  const displayName = user?.name ? user.name : user?.email;

  return (
    <aside className="flex w-full flex-col gap-4 border-b p-4 md:w-56 md:border-b-0 md:border-r">
      <Card size="sm">
        <CardContent className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">{displayName ?? "Loading..."}</p>
          {user && <p className="text-sm text-muted-foreground">{user.email}</p>}
        </CardContent>
      </Card>
      <Card size="sm">
        <CardContent>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
                    isActive
                      ? "border-border font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </CardContent>
      </Card>
      <Button
        variant="outline"
        size="sm"
        className="mt-auto"
        onClick={() => {
          clearToken();
          window.location.href = "/login";
        }}
      >
        Log out
      </Button>
    </aside>
  );
}
