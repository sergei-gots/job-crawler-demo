"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, useRequireAuth } from "@/entities/session";
import { getCurrentUser, type CurrentUser } from "@/entities/user";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";

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

  const displayName = user?.firstName ? user.firstName : user?.email;

  return (
    <aside className="flex w-full flex-col gap-6 border-b p-4 md:w-56 md:border-b-0 md:border-r">
      <div className="text-sm">
        <p className="font-medium">{displayName ?? "Loading..."}</p>
        {user && <p className="text-zinc-500">{user.email}</p>}
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-2 py-1 text-sm ${
              pathname === item.href
                ? "bg-zinc-100 font-medium dark:bg-zinc-800"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <Button
        variant="outline"
        size="sm"
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
