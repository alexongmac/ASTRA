"use client";

import { useSyncExternalStore } from "react";

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
const M = { l: 44, r: 12, t: 28, b: 26 };

// Line chart of the four OEE measures. Time labels are formatted in the
// browser's zone, so they are only drawn once mounted (the server renders UTC).
export function KeyValuesChart({ points }: { points: KeyPoint[] }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (points.length === 0) return null;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="OEE, availability, performance and quality over the shift">
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
      {SERIES.map((s, i) => (
        <g key={s.key} transform={`translate(${M.l + i * 130}, 12)`}>
          <circle r="4" fill={s.color} />
          <text x="9" y="3.5" fontSize="10" fill="#e2e8f0">{s.label}</text>
        </g>
      ))}
    </svg>
  );
}
