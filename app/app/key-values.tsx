import { prisma } from "@/lib/prisma";
import { Section } from "./handover-section";
import { KeyValuesChart, type KeyPoint } from "./key-values-chart";

const MAX_POINTS = 150;

const pct = (v: number | null | undefined) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—");

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 px-3 py-2">
      <div className={`text-base font-semibold ${tone ?? "text-white"}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

// The machine's figures for the shift: the latest values at the end of the shift
// window and how OEE, availability, performance and quality moved during it.
export async function KeyValues({ machine, from, to }: { machine: string | null; from: Date; to: Date }) {
  if (!machine) {
    return (
      <Section title="Key Values">
        <p className="text-xs text-slate-500">No machine was selected for this handover.</p>
      </Section>
    );
  }

  const [summaries, lastEvent] = await Promise.all([
    prisma.oeeSummary.findMany({
      where: { machine, ts: { gte: from, lte: to } },
      orderBy: { ts: "asc" },
      select: { ts: true, oee: true, availability: true, performance: true, quality: true, good: true, defect: true },
    }),
    prisma.machineEvent.findFirst({
      where: { machine, ts: { gte: from, lte: to } },
      orderBy: { ts: "desc" },
      select: { gear: true, conveyor: true, output: true },
    }),
  ]);

  const latest = summaries.at(-1);

  // Any of gear, conveyor or output reporting "down" means the machine is not running.
  const status = !lastEvent
    ? { text: "No data", tone: "text-slate-400" }
    : [lastEvent.gear, lastEvent.conveyor, lastEvent.output].includes("down")
      ? { text: "Stopped", tone: "text-red-500" }
      : { text: "Running", tone: "text-green-400" };

  // Keep the chart light: at most MAX_POINTS evenly spaced samples.
  const step = Math.max(1, Math.ceil(summaries.length / MAX_POINTS));
  const points: KeyPoint[] = summaries
    .filter((_, i) => i % step === 0 || i === summaries.length - 1)
    .map((s) => ({
      t: s.ts.getTime(),
      oee: s.oee,
      availability: s.availability,
      performance: s.performance,
      quality: s.quality,
    }));

  return (
    <Section title={`Key Values · ${machine}`}>
      <p className="mb-2 text-xs text-slate-500">Machine at the end of the shift</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Tile label="Status" value={status.text} tone={status.tone} />
        <Tile label="OEE" value={pct(latest?.oee)} />
        <Tile label="Availability" value={pct(latest?.availability)} />
        <Tile label="Performance" value={pct(latest?.performance)} />
        <Tile label="Quality" value={pct(latest?.quality)} />
        <Tile
          label="Good / defect parts"
          value={latest ? `${latest.good ?? "—"} / ${latest.defect ?? "—"}` : "—"}
        />
      </div>
      <div className="mt-3">
        {points.length > 0 ? (
          <KeyValuesChart points={points} windowFrom={from.getTime()} windowTo={to.getTime()} />
        ) : (
          <p className="text-xs text-slate-500">No OEE data for {machine} in this shift.</p>
        )}
      </div>
    </Section>
  );
}
