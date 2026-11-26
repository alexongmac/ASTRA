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

// The full entry in a modal window. Shared by the double-click on the message
// and the eye icon in the Actions column.
function DetailsDialog({ log, onClose }: { log: LogDetails; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Log entry details"
      onClick={onClose}
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
          onClick={onClose}
          className="mt-4 rounded border border-slate-600 bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// Open state shared by both entry points. Cache Components keeps a
// navigated-away page mounted but hidden, so close the window when this page
// is hidden rather than leaving it open on return.
function useOpen() {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    return () => setOpen(false);
  }, []);
  return [open, setOpen] as const;
}

// One line of the message in the table; double-click opens the full entry.
export function MessageCell({ log }: { log: LogDetails }) {
  const [open, setOpen] = useOpen();

  return (
    <>
      <div
        onDoubleClick={() => setOpen(true)}
        title="Double-click to view details"
        className="cursor-pointer select-none truncate"
      >
        {log.message}
      </div>
      {open ? <DetailsDialog log={log} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// The eye icon shown in place of Edit for Closed and Cancelled entries.
export function ViewLogButton({ log }: { log: LogDetails }) {
  const [open, setOpen] = useOpen();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View"
        aria-label="View log entry"
        className="text-slate-300 hover:text-amber-300"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {open ? <DetailsDialog log={log} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
