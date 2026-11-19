"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The dashboard is a server component, so the worker raising or clearing an
// alarm is invisible until the page re-renders. This re-fetches it on an
// interval, and skips the work while the tab is in the background.
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const timer = setInterval(tick, intervalMs);

    // Catch up immediately when the operator comes back to the tab, rather
    // than leaving a stale screen for up to one interval.
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  return null;
}
