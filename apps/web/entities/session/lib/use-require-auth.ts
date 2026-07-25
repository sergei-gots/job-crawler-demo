"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
// Deliberate, narrow exception to the FSD "no sideways entity imports" rule: this is the single
// chokepoint every widget already routes 401s and logout through, so it's the only place that can
// clear the cached current-user (entities/user/lib/user-store.ts) without duplicating the call at
// every one of the 5 call sites. See CLAUDE.md UI Design Guidelines / architecture note.
import { setCachedUser } from "@/entities/user";
import { clearToken, getToken } from "./token-storage";

export function useRequireAuth() {
  const router = useRouter();
  // Deliberately synced from an effect, not read during render: localStorage isn't available
  // during SSR, so reading it synchronously in the render body causes a hydration mismatch
  // (server renders null, client renders the real token). Reading it once after mount avoids that.
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = getToken();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setToken(stored);
    if (!stored) {
      router.replace("/login");
    }
  }, [router]);

  const handleUnauthorized = useCallback(() => {
    clearToken();
    setCachedUser(null);
    router.replace("/login");
  }, [router]);

  return { token, handleUnauthorized };
}
