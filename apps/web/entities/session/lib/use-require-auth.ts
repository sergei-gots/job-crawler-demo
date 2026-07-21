"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
    router.replace("/login");
  }, [router]);

  return { token, handleUnauthorized };
}
