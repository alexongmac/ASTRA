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

// ---------------------------------------------------------------------------
// Time range picker, modelled on Grafana's: "now-1h" / "now" expressions,
// absolute dates, quick ranges, shift back / forward, zoom out and a time zone
// switch. Only the shift's own window has data, so "now" means the END OF THE
// SHIFT here and every range is kept inside that window.
// ---------------------------------------------------------------------------

type Zone = "local" | "utc";
type Sel = { from: string; to: string };

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

// Grafana's quick ranges that fit inside an 8 hour shift.
const QUICK = [
  { label: "Last 5 minutes", from: "now-5m" },
  { label: "Last 15 minutes", from: "now-15m" },
  { label: "Last 30 minutes", from: "now-30m" },
  { label: "Last 1 hour", from: "now-1h" },
  { label: "Last 3 hours", from: "now-3h" },
  { label: "Last 6 hours", from: "now-6h" },
  { label: "Last 8 hours", from: "now-8h" },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD HH:mm:ss" in the chosen zone, the format Grafana shows.
function formatAbs(ms: number, zone: Zone) {
  const d = new Date(ms);
  return zone === "utc"
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Understands now, now-5m, now+1h, "2026-11-26 14:30[:00]" and epoch milliseconds.
function parseExpr(text: string, now: number, zone: Zone): number {
  const t = text.trim().toLowerCase();
  if (t === "now") return now;
  const rel = /^now\s*([+-])\s*(\d+)\s*([smhdw])$/.exec(t);
  if (rel) return now + (rel[1] === "-" ? -1 : 1) * Number(rel[2]) * UNIT_MS[rel[3] as keyof typeof UNIT_MS];
  const abs = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (abs) {
    const [y, mo, d, h, mi, sec] = abs.slice(1).map((v) => Number(v ?? 0));
    return zone === "utc" ? Date.UTC(y, mo - 1, d, h, mi, sec) : new Date(y, mo - 1, d, h, mi, sec).getTime();
  }
  if (/^\d{12,13}$/.test(t)) return Number(t);
  return NaN;
}

function zoneInfo(zone: Zone) {
  const tz = zone === "utc" ? "UTC" : undefined;
  const part = (style: "short" | "long") =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: style })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const off = zone === "utc" ? 0 : -new Date().getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const offset = `UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return zone === "utc"
    ? { name: "Coordinated Universal Time", short: "UTC", extra: "UTC, GMT", offset }
    : { name: part("long"), short: part("short"), extra: part("short"), offset };
}

const BTN =
  "flex h-8 items-center justify-center rounded border border-white/20 bg-white/10 px-2 text-xs text-[#ccccdc] hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40";

function Icon({ d, className = "h-3.5 w-3.5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function RangePicker({
  sel,
  setSel,
  zone,
  setZone,
  windowFrom,
  windowTo,
  mounted,
}: {
  sel: Sel;
  setSel: (s: Sel) => void;
  zone: Zone;
  setZone: (z: Zone) => void;
  windowFrom: number;
  windowTo: number;
  mounted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fromText, setFromText] = useState(sel.from);
  const [toText, setToText] = useState(sel.to);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoneOpen, setZoneOpen] = useState(false);
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

  const resolved = resolveRange(sel, windowFrom, windowTo, zone);
  const width = resolved.to - resolved.from;
  const quick = QUICK.find((q) => q.from === sel.from && sel.to === "now");
  const label = quick ? quick.label : `${sel.from} to ${sel.to}`;

  const setAbsolute = (from: number, to: number) => {
    const f = Math.max(from, windowFrom);
    const t = Math.min(to, windowTo);
    if (f >= t) return;
    setSel({ from: formatAbs(f, zone), to: formatAbs(t, zone) });
  };

  const toggle = () => {
    if (!open) {
      setFromText(sel.from);
      setToText(sel.to);
      setError(null);
      setQuery("");
      setZoneOpen(false);
    }
    setOpen(!open);
  };

  const apply = () => {
    const now = windowTo;
    const f = parseExpr(fromText, now, zone);
    const t = parseExpr(toText, now, zone);
    if (Number.isNaN(f)) return setError("From is not a valid date");
    if (Number.isNaN(t)) return setError("To is not a valid date");
    if (f >= t) return setError("From must be before To");
    if (Math.min(t, windowTo) <= Math.max(f, windowFrom)) return setError("That range is outside this shift");
    setSel({ from: fromText.trim(), to: toText.trim() });
    setOpen(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ from: fromText, to: toText }));
    } catch {
      /* clipboard may be blocked */
    }
  };
  const paste = async () => {
    try {
      const v = JSON.parse(await navigator.clipboard.readText()) as Partial<Sel>;
      if (typeof v.from === "string" && typeof v.to === "string") {
        setFromText(v.from);
        setToText(v.to);
        setError(null);
      }
    } catch {
      /* nothing usable on the clipboard */
    }
  };

  const zi = mounted ? zoneInfo(zone) : null;
  const q = query.trim().toLowerCase();
  const list = QUICK.filter((x) => x.label.toLowerCase().includes(q));
  const field =
    "h-8 w-full rounded border border-[#2c3235] bg-[#111217] px-2 text-xs text-[#ccccdc] outline-none focus:border-[#3871dc]";

  return (
    <div ref={box} className="relative flex items-center gap-1">
      <button type="button" className={BTN} title="Shift time range backwards" aria-label="Shift time range backwards"
        disabled={resolved.from <= windowFrom}
        onClick={() => setAbsolute(resolved.from - width, resolved.to - width)}>
        <Icon d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
      </button>
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} className={`${BTN} gap-1.5`}>
        <Icon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v4l3 2" />
        {label}
        {zi ? <span className="font-semibold text-[#ff9830]">{zi.short}</span> : null}
        <Icon d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} className="h-3 w-3" />
      </button>
      <button type="button" className={BTN} title="Shift time range forwards" aria-label="Shift time range forwards"
        disabled={resolved.to >= windowTo}
        onClick={() => setAbsolute(resolved.from + width, resolved.to + width)}>
        <Icon d="m13 17 5-5-5-5M6 17l5-5-5-5" />
      </button>
      <button type="button" className={BTN} title="Zoom out time range" aria-label="Zoom out time range"
        disabled={resolved.from <= windowFrom && resolved.to >= windowTo}
        onClick={() => setAbsolute(resolved.from - width / 2, resolved.to + width / 2)}>
        <Icon d="M21 21l-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8 11h6" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Select time range"
          className="absolute right-0 top-full z-20 mt-1 w-[min(34rem,92vw)] overflow-hidden rounded border border-[#2c3235] bg-[#181b1f] text-xs text-[#ccccdc] shadow-xl"
        >
          <div className="flex flex-col sm:flex-row">
            <div className="flex-1 space-y-3 p-3">
              <div className="text-sm font-medium text-white">Absolute time range</div>
              <div>
                <div className="mb-1 text-[#ccccdc]">From</div>
                <div className="flex gap-1">
                  <input value={fromText} onChange={(e) => setFromText(e.target.value)} className={field} aria-label="From" />
                  <CalendarButton zone={zone} onPick={setFromText} />
                </div>
              </div>
              <div>
                <div className="mb-1 text-[#ccccdc]">To</div>
                <div className="flex gap-1">
                  <input value={toText} onChange={(e) => setToText(e.target.value)} className={field} aria-label="To" />
                  <CalendarButton zone={zone} onPick={setToText} />
                </div>
              </div>
              {error ? <p className="text-[#ff5286]">{error}</p> : null}
              <div className="flex items-center gap-1">
                <button type="button" onClick={copy} title="Copy time range to clipboard" aria-label="Copy time range to clipboard" className={BTN}>
                  <Icon d="M9 9h10v10H9zM5 15V5h10" />
                </button>
                <button type="button" onClick={paste} title="Paste time range" aria-label="Paste time range" className={BTN}>
                  <Icon d="M9 4h6v3H9zM7 5H5v15h14V5h-2" />
                </button>
                <button type="button" onClick={apply} className="h-8 rounded bg-[#3871dc] px-3 text-xs font-medium text-white hover:bg-[#4b80e3]">
                  Apply time range
                </button>
              </div>
            </div>

            <div className="flex w-full flex-col border-t border-[#2c3235] sm:w-56 sm:border-l sm:border-t-0">
              <div className="p-2">
                <div className="flex h-8 items-center gap-2 rounded border border-[#2c3235] bg-[#111217] px-2">
                  <Icon d="M21 21l-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" className="h-3.5 w-3.5 text-[#8e8e9e]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search quick ranges"
                    aria-label="Search quick ranges"
                    className="w-full bg-transparent text-xs text-[#ccccdc] outline-none placeholder:text-[#8e8e9e]"
                  />
                </div>
              </div>
              <ul className="max-h-64 flex-1 overflow-y-auto">
                {list.map((x) => {
                  const active = x === quick;
                  return (
                    <li key={x.label}>
                      <button
                        type="button"
                        onClick={() => {
                          setSel({ from: x.from, to: "now" });
                          setOpen(false);
                        }}
                        className={`block w-full border-l-2 px-3 py-2 text-left hover:bg-white/5 ${active ? "border-[#ff9830] bg-white/10 text-white" : "border-transparent"}`}
                      >
                        {x.label}
                      </button>
                    </li>
                  );
                })}
                {list.length === 0 ? <li className="px-3 py-2 text-[#8e8e9e]">No quick ranges match</li> : null}
              </ul>
            </div>
          </div>

          {zoneOpen && zi ? (
            <div className="border-t border-[#2c3235] p-2">
              {(["local", "utc"] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => {
                    // Re-express an absolute range in the new zone so it stays the same moment.
                    const r = resolveRange(sel, windowFrom, windowTo, zone);
                    if (!QUICK.some((x) => x.from === sel.from && sel.to === "now")) {
                      setSel({ from: formatAbs(r.from, z), to: formatAbs(r.to, z) });
                    }
                    setZone(z);
                    setZoneOpen(false);
                  }}
                  className={`block w-full rounded px-2 py-1.5 text-left hover:bg-white/5 ${zone === z ? "bg-white/10 text-white" : ""}`}
                >
                  {z === "utc" ? "Coordinated Universal Time (UTC)" : "Browser time"}
                </button>
              ))}
            </div>
          ) : null}
          {zi ? (
            <div className="flex items-center justify-between gap-2 border-t border-[#2c3235] px-3 py-2">
              <div className="min-w-0 truncate">
                <span className="text-white">{zi.name}</span> <span className="text-[#8e8e9e]">{zi.extra}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[#8e8e9e]">{zi.offset}</span>
                <button type="button" onClick={() => setZoneOpen(!zoneOpen)} className={`${BTN} h-7 gap-1`}>
                  Change time settings
                  <Icon d={zoneOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} className="h-3 w-3" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Calendar icon beside a From / To field: opens the browser's own date and time picker.
function CalendarButton({ zone, onPick }: { zone: Zone; onPick: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={`${BTN} w-8 shrink-0 px-0`}
        aria-label={`Pick a date (${zone === "utc" ? "UTC" : "browser time"})`}
        onClick={() => ref.current?.showPicker?.()}
      >
        <Icon d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
      </button>
      <input
        ref={ref}
        type="datetime-local"
        step={1}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(e) => {
          if (e.target.value) {
            const v = e.target.value.replace("T", " ");
            onPick(v.length === 16 ? `${v}:00` : v);
          }
        }}
      />
    </>
  );
}

// Resolves the picker's expressions to real times, kept inside the shift window.
function resolveRange(sel: Sel, windowFrom: number, windowTo: number, zone: Zone) {
  const f = parseExpr(sel.from, windowTo, zone);
  const t = parseExpr(sel.to, windowTo, zone);
  const from = Math.max(Number.isNaN(f) ? windowFrom : f, windowFrom);
  const to = Math.min(Number.isNaN(t) ? windowTo : t, windowTo);
  return from < to ? { from, to } : { from: windowFrom, to: windowTo };
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
  const [sel, setSel] = useState<Sel>({ from: "now-8h", to: "now" });
  const [zone, setZone] = useState<Zone>("local");

  if (all.length === 0) return null;
  const { from: t0, to: t1 } = resolveRange(sel, windowFrom, windowTo, zone);
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
      timeZone: zone === "utc" ? "UTC" : undefined,
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
        <RangePicker sel={sel} setSel={setSel} zone={zone} setZone={setZone} windowFrom={windowFrom} windowTo={windowTo} mounted={mounted} />
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
