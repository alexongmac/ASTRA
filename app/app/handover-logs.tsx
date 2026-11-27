"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useState, useTransition } from "react";
import { BTN_SECONDARY } from "./field-styles";
import { Section } from "./handover-section";
import { LocalTime } from "./local-time";
import { LOG_PRIORITY_STYLES, LOG_STATUS_STYLES } from "@/lib/operator-logs";

export type HandoverLogRow = {
  id: string;
  eventTime: string; // ISO
  area: string;
  machine: string | null;
  category: string;
  priority: string | null;
  author: string | null;
  message: string;
  status: string;
};

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap pb-2 pr-4 font-medium">{children}</th>
);

function Cells({ log }: { log: HandoverLogRow }) {
  const nowrap = "whitespace-nowrap py-2 pr-4 align-top";
  return (
    <>
      <td className={`${nowrap} text-slate-100`}><LocalTime iso={log.eventTime} /></td>
      <td className={`${nowrap} text-slate-100`}>{log.area}</td>
      <td className={`${nowrap} text-slate-100`}>{log.machine ?? "—"}</td>
      <td className={`${nowrap} text-slate-100`}>{log.category}</td>
      <td className={`${nowrap} font-semibold ${LOG_PRIORITY_STYLES[log.priority ?? ""] ?? "text-slate-100"}`}>
        {log.priority ?? "—"}
      </td>
      <td className={`${nowrap} text-slate-100`}>{log.author ?? "—"}</td>
      <td className="w-full max-w-0 truncate py-2 pr-4 align-top text-slate-100" title={log.message}>{log.message}</td>
      <td className={`${nowrap} ${LOG_STATUS_STYLES[log.status] ?? "text-slate-400"}`}>{log.status}</td>
    </>
  );
}

const HEAD = ["Event Time", "Area", "Machine", "Category", "Priority", "Author", "Message", "Status"];

// Operator-log entries attached to the handover. "+" lists every entry not yet
// attached, newest first, whatever its event time.
export function HandoverLogs({
  handoverId,
  logs,
  eligible,
  editable,
}: {
  handoverId: string;
  logs: HandoverLogRow[];
  eligible: HandoverLogRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    return () => setOpen(false);
  }, []);

  const call = (method: "POST" | "DELETE", logId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          method === "POST"
            ? `/api/shift-handovers/${handoverId}/logs`
            : `/api/shift-handovers/${handoverId}/logs/${logId}`,
          {
            method,
            headers: { "Content-Type": "application/json" },
            body: method === "POST" ? JSON.stringify({ logId }) : undefined,
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? `Failed (${response.status})`);
          return;
        }
      } catch {
        setError("Network error - try again");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Section title="Operations Logs">
      <table className="w-full text-left text-xs">
        <thead className="text-blue-400">
          <tr>
            <Th />
            {HEAD.map((h) => <Th key={h}>{h}</Th>)}
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t border-slate-700">
              <td className="py-2 pr-3 align-top">
                {editable ? (
                  <button
                    onClick={() => call("DELETE", log.id)}
                    disabled={pending}
                    title="Remove from handover"
                    aria-label="Remove from handover"
                    className="text-slate-300 hover:text-red-400 disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                    </svg>
                  </button>
                ) : null}
              </td>
              <Cells log={log} />
            </tr>
          ))}
          {logs.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-4 text-center text-slate-500">No log entries added.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {editable ? (
        <div className="mt-3">
          <button
            onClick={() => setOpen((o) => !o)}
            title="Add entries from the operator log"
            aria-expanded={open}
            className={BTN_SECONDARY}
          >
            {open ? "− Close" : "+ Add log entry"}
          </button>

          {open ? (
            <div className="mt-3 rounded border border-slate-700 bg-slate-900 p-3">
              <p className="mb-2 text-xs text-slate-400">Newest first. Any log entry can be added.</p>
              <table className="w-full text-left text-xs">
                <thead className="text-blue-400">
                  <tr>
                    <Th />
                    {HEAD.map((h) => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {eligible.map((log) => (
                    <tr key={log.id} className="border-t border-slate-700">
                      <td className="py-2 pr-3 align-top">
                        <button
                          onClick={() => call("POST", log.id)}
                          disabled={pending}
                          className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Add
                        </button>
                      </td>
                      <Cells log={log} />
                    </tr>
                  ))}
                  {eligible.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-slate-500">
                        No other log entries from this shift.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
          {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
        </div>
      ) : null}
    </Section>
  );
}
