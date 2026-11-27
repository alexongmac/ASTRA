"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

export type KeyPoint = {
  t: number; // ms since epoch
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
};

const SERIES = [
  { key: "oee", label: "OEE %", color: "#3b82f6" },
  { key: "availability", label: "Availability %", color: "#f97316" },
  { key: "performance", label: "Performance %", color: "#22c55e" },
  { key: "quality", label: "Quality %", color: "#ef4444" },
] as const;

const W = 800;
const H = 240;
const M = { l: 44, r: 12, t: 10, b: 26 };

const HOUR = 3_600_000;

// Quick ranges, counted back from the end of the shift window.
const PRESETS = [
  { label: "Full shift", ms: null },
  { label: "Last 6 hours", ms: 6 * HOUR },
  { label: "Last 3 hours", ms: 3 * HOUR },
  { label: "Last 1 hour", ms: HOUR },
  { label: "Last 30 minutes", ms: 30 * 60_000 },
  { label: "Last 15 minutes", ms: 15 * 60_000 },
] as const;

type Range =
  | { kind: "preset"; label: string; ms: number | null }
  | { kind: "custom"; from: number; to: number };

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in the viewer's zone.
const toLocalInput = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const shortTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

// Grafana-style time range picker: quick ranges plus an absolute From / To.
function RangePicker({
  range,
  bounds,
  onChange,
}: {
  range: Range;
  bounds: { from: number; to: number };
  onChange: (r: Range) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Cache Components keeps a navigated-away page mounted but hidden: close the
  // menu when this page is hidden.
  useLayoutEffect(() => {
    return () => setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current =
    range.kind === "custom"
      ? { from: range.from, to: range.to }
      : { from: range.ms === null ? bounds.from : Math.max(bounds.from, bounds.to - range.ms), to: bounds.to };
  const label = range.kind === "custom" ? `${shortTime(range.from)} → ${shortTime(range.to)}` : range.label;

  const toggle = () => {
    if (!open) {
      setFromText(toLocalInput(current.from));
      setToText(toLocalInput(current.to));
      setError(null);
    }
    setOpen(!open);
  };

  const apply = () => {
    const from = new Date(fromText).getTime();
    const to = new Date(toText).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return setError("Enter both a From and a To time");
    if (from >= to) return setError("From must be before To");
    // Only the shift's own window has data, so keep the range inside it.
    const cf = Math.max(from, bounds.from);
    const ct = Math.min(to, bounds.to);
    if (cf >= ct) return setError("That range is outside this shift");
    onChange({ kind: "custom", from: cf, to: ct });
    setOpen(false);
  };

  const input = "w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-100 hover:bg-slate-700"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {label}
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Time range"
          className="absolute right-0 z-20 mt-1 flex w-[min(30rem,90vw)] flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs shadow-lg sm:flex-row"
        >
          <div className="flex-1 space-y-2">
            <div className="font-semibold text-white">Absolute time range</div>
            <label className="block">
              <span className="mb-1 block text-slate-400">From</span>
              <input type="datetime-local" value={fromText} onChange={(e) => setFromText(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-slate-400">To</span>
              <input type="datetime-local" value={toText} onChange={(e) => setToText(e.target.value)} className={input} />
            </label>
            {error ? <p className="text-red-400">{error}</p> : null}
            <button
              type="button"
              onClick={apply}
              className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-500"
            >
              Apply time range
            </button>
          </div>
          <ul className="sm:w-40 sm:border-l sm:border-slate-700 sm:pl-3">
            {PRESETS.map((p) => {
              const active = range.kind === "preset" && range.label === p.label;
              return (
                <li key={p.label}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ kind: "preset", label: p.label, ms: p.ms });
                      setOpen(false);
                    }}
                    className={`w-full rounded px-2 py-1.5 text-left hover:bg-slate-700 ${active ? "bg-slate-700 text-white" : "text-slate-300"}`}
                  >
                    {p.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// Line chart of the four OEE measures. Time labels are formatted in the
// browser's zone, so they are only drawn once mounted (the server renders UTC).
export function KeyValuesChart({
  points: all,
  windowFrom,
  windowTo,
}: {
  points: KeyPoint[];
  windowFrom: number;
  windowTo: number;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [range, setRange] = useState<Range>({ kind: "preset", label: "Full shift", ms: null });

  if (all.length === 0) return null;
  const bounds = { from: windowFrom, to: windowTo };
  const t0 =
    range.kind === "custom" ? range.from : range.ms === null ? windowFrom : Math.max(windowFrom, windowTo - range.ms);
  const t1 = range.kind === "custom" ? range.to : windowTo;
  const points = all.filter((p) => p.t >= t0 && p.t <= t1);
  const span = Math.max(1, t1 - t0);
  const max = Math.max(
    100,
    ...points.flatMap((p) => [p.oee, p.availability, p.performance, p.quality].map((v) => v ?? 0)),
  );
  const x = (t: number) => M.l + ((t - t0) / span) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / max) * (H - M.t - M.b);

  const path = (key: (typeof SERIES)[number]["key"]) => {
    let d = "";
    let pen = false;
    for (const p of points) {
      const v = p[key];
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const ticks = Array.from({ length: 5 }, (_, i) => t0 + (span * i) / 4);
  // On a short span, minutes alone repeat ("8:00 PM" twice), so add seconds.
  const withSeconds = span < 15 * 60_000;
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" as const } : {}),
    });

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-200">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <RangePicker range={range} bounds={bounds} onChange={setRange} />
      </div>
      {points.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-500">No OEE data in this range.</p>
      ) : (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="OEE, availability, performance and quality over the selected range">
      <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="#0f172a" />
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={M.l} x2={W - M.r} y1={y(g)} y2={y(g)} stroke="#334155" strokeWidth="1" />
          <text x={M.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{g}%</text>
        </g>
      ))}
      {SERIES.map((s) => (
        <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" />
      ))}
      {mounted
        ? ticks.map((t, i) => (
            <text key={i} x={x(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize="10" fill="#94a3b8">
              {fmt(t)}
            </text>
          ))
        : null}
    </svg>
      )}
    </div>
  );
}
