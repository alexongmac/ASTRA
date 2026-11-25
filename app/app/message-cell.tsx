"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export type LogDetails = {
  eventTime: string; // ISO
  area: string;
  machine: string | null;
  category: string;
  priority: string | null;
  status: string;
  author: string | null;
  message: string;
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "medium" };

// One line of the message in the table; double-click opens the full entry.
export function MessageCell({ log }: { log: LogDetails }) {
  const [open, setOpen] = useState(false);

  // Cache Components keeps a navigated-away page mounted but hidden, so close
  // the window when this page is hidden rather than leaving it open on return.
  useLayoutEffect(() => {
    return () => setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const rows: [string, string][] = [
    ["Event Time", new Date(log.eventTime).toLocaleString("en-US", TIME_FORMAT)],
    ["Area", log.area],
    ["Machine", log.machine ?? "—"],
    ["Category", log.category],
    ["Priority", log.priority ?? "—"],
    ["Status", log.status],
    ["Author", log.author ?? "—"],
  ];

  return (
    <>
      <div
        onDoubleClick={() => setOpen(true)}
        title="Double-click to view details"
        className="cursor-pointer select-none truncate"
      >
        {log.message}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Log entry details"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-slate-700 bg-slate-800 p-4 text-xs text-slate-100 shadow-lg"
          >
            <h2 className="mb-3 text-sm font-semibold text-white">Log entry</h2>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-blue-400">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <dt className="text-blue-400">Message</dt>
              <dd className="whitespace-pre-wrap break-words">{log.message}</dd>
            </dl>
            <button
              onClick={() => setOpen(false)}
              className="mt-4 rounded border border-slate-600 bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
