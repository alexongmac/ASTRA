"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useState, useSyncExternalStore, useTransition } from "react";
import { LOG_CATEGORIES, LOG_MACHINES, LOG_PRIORITIES, LOG_STATUSES, MAX_MESSAGE } from "@/lib/operator-logs";

export type LogFormValues = {
  eventTime: string; // ISO
  area: string;
  machine: string;
  category: string;
  priority: string;
  status: string;
  message: string;
};

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in the viewer's zone.
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const FIELD =
  "w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 [color-scheme:dark] focus:border-blue-400 focus:outline-none";

export function LogForm({
  logId,
  initial,
  areas,
}: {
  logId?: string;
  initial?: LogFormValues;
  areas: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The picker value is in the viewer's zone, but the server renders in UTC,
  // so the default is only computed once mounted in the browser (the server
  // snapshot is false) to avoid a hydration mismatch. Edits override it.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [typedTime, setTypedTime] = useState<string | null>(null);
  const eventTime =
    typedTime ?? (mounted ? toLocalInput(initial ? new Date(initial.eventTime) : new Date()) : "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [machine, setMachine] = useState(initial?.machine ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "");
  const [status, setStatus] = useState(initial?.status ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");

  // Cache Components keeps a navigated-away page mounted (hidden) so its state
  // survives, which brought back the previous entry's text on the next "New
  // Entry". The cleanup runs when the page is hidden or unmounted, so the form
  // starts from its initial values the next time it is shown.
  useLayoutEffect(() => {
    return () => {
      setTypedTime(null);
      setArea(initial?.area ?? "");
      setMachine(initial?.machine ?? "");
      setCategory(initial?.category ?? "");
      setPriority(initial?.priority ?? "");
      setStatus(initial?.status ?? "");
      setMessage(initial?.message ?? "");
      setError(null);
    };
  }, [initial]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(logId ? `/api/operator-logs/${logId}` : "/api/operator-logs", {
          method: logId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // The picker value is in the viewer's zone; send an absolute time.
            eventTime: new Date(eventTime).toISOString(),
            area,
            machine,
            category,
            priority,
            status,
            message,
          }),
        });
      } catch {
        setError("Network error - try again");
        return;
      }
      if (!response.ok) {
        const detail = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => null);
        setError(detail ?? `Failed (${response.status})`);
        return;
      }
      router.push("/?tab=logs");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-3 text-xs text-blue-400">
          <label htmlFor="eventTime">Event Time</label>
          <input id="eventTime" type="datetime-local" required value={eventTime} onChange={(e) => setTypedTime(e.target.value)} className={FIELD} />

          <label htmlFor="status">Status</label>
          <select id="status" required value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {LOG_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>

          <label htmlFor="category">Category</label>
          <select id="category" required value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {LOG_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>

          <label htmlFor="priority">Priority</label>
          <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {LOG_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>

          <label htmlFor="area">Area</label>
          <select id="area" required value={area} onChange={(e) => setArea(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {(!area || areas.includes(area) ? areas : [area, ...areas]).map((a) => <option key={a}>{a}</option>)}
          </select>

          <label htmlFor="machine">Machine</label>
          <select id="machine" value={machine} onChange={(e) => setMachine(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {LOG_MACHINES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex flex-col text-xs text-blue-400">
          <label htmlFor="message" className="mb-2">Message</label>
          <textarea
            id="message"
            required
            rows={8}
            maxLength={MAX_MESSAGE}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={`${FIELD} min-h-40 flex-1`}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : logId ? "Save" : "Add entry"}
        </button>
        <Link
          href="/?tab=logs"
          className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700"
        >
          Exit
        </Link>
        {error ? <span className="text-xs text-red-500">{error}</span> : null}
      </div>
    </form>
  );
}
