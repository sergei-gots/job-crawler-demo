"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getToken } from "@/entities/session";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/about" : "/login");
  }, [router]);

  return null;
}
