"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DeleteLogButton({ logId }: { logId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    if (!window.confirm("Delete this log entry? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/operator-logs/${logId}`, { method: "DELETE" });
        // 404 means it is already gone; refreshing drops the stale row.
        if (!response.ok && response.status !== 404) {
          setError(`Failed (${response.status})`);
          return;
        }
      } catch {
        setError("Network error");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <button
        onClick={remove}
        disabled={pending}
        title="Delete"
        aria-label="Delete log entry"
        className="text-slate-300 hover:text-red-400 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
        </svg>
      </button>
      {error ? <span className="ml-1 text-red-500">{error}</span> : null}
    </>
  );
}
