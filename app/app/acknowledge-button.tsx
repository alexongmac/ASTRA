"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AcknowledgeButton({ alarmId }: { alarmId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const acknowledge = () => {
    setError(null);
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(`/api/alarms/${alarmId}/acknowledge`, { method: "POST" });
      } catch {
        setError("Network error - try again");
        return;
      }

      if (!response.ok) {
        // A 409 means the worker already cleared this alarm, so the row on
        // screen is stale; refresh to drop it rather than leaving a button
        // that can only keep failing.
        const detail = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => null);
        setError(detail ?? `Failed (${response.status})`);
        if (response.status === 409 || response.status === 404) router.refresh();
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={acknowledge}
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Acknowledging…" : "Acknowledge"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
