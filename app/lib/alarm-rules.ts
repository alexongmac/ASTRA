export type AlarmSeverity = "CRITICAL" | "WARNING" | "INFO";

export type OeeEvent = {
  v: number;
  ts: string;
  // null when the machine reports outside a production run.
  run_id: number | null;
  machine: string;
  event: string;
  detail: string | null;
  state?: { gear?: string; conveyor?: string; output?: string };
  oee?: number;
};

export type OeeSummary = {
  v: number;
  ts: string;
  // null when the machine reports outside a production run.
  run_id: number | null;
  machine: string;
  product?: string;
  availability?: number;
  performance?: number;
  quality?: number;
  oee?: number;
  total?: number;
  good?: number;
  defect?: number;
  elapsed_s?: number;
  downtime_s?: number;
  setup_s?: number;
  runtime_s?: number;
  planned_time_min?: number;
  ideal_cycle_s?: number;
};

export type RuleVerdict = {
  ruleKey: string;
  severity: AlarmSeverity;
  title: string;
  active: boolean;
  detail?: string;
};

export const DEFECT_RATE_THRESHOLD = 0.05;
export const OEE_THRESHOLD = 65;

const isDown = (value: string | undefined) => value === "down";

export function evaluateEventRules(event: OeeEvent): RuleVerdict[] {
  const { gear, conveyor, output } = event.state ?? {};

  return [
    {
      ruleKey: "gear_down",
      severity: "CRITICAL",
      title: "Gear stopped during run",
      active: isDown(gear),
      detail: `gear=${gear ?? "unknown"}`,
    },
    {
      ruleKey: "conveyor_output_down",
      severity: "WARNING",
      title: "Production stopped due to conveyor",
      active: isDown(conveyor) && isDown(output),
      detail: `conveyor=${conveyor ?? "unknown"}, output=${output ?? "unknown"}`,
    },
    {
      ruleKey: "output_down",
      severity: "WARNING",
      title: "Output stopped",
      active: isDown(output),
      detail: `output=${output ?? "unknown"}`,
    },
  ];
}

export function evaluateSummaryRules(summary: OeeSummary): RuleVerdict[] {
  const verdicts: RuleVerdict[] = [];

  const { total, defect, oee } = summary;
  if (typeof total === "number" && total > 0 && typeof defect === "number") {
    const rate = defect / total;
    verdicts.push({
      ruleKey: "defect_spike",
      severity: "WARNING",
      title: "Defect rate above limit",
      active: rate >= DEFECT_RATE_THRESHOLD,
      detail: `${(rate * 100).toFixed(1)}% (${defect}/${total}), limit ${DEFECT_RATE_THRESHOLD * 100}%`,
    });
  }

  if (typeof oee === "number") {
    verdicts.push({
      ruleKey: "oee_out_of_range",
      severity: "WARNING",
      title: "OEE out of range",
      active: oee < OEE_THRESHOLD,
      detail: `oee=${oee.toFixed(1)}, threshold ${OEE_THRESHOLD}`,
    });
  }

  return verdicts;
}

export function isSummaryPayload(payload: unknown): payload is OeeSummary {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  // Summary messages carry production counters; event messages carry an `event` name.
  return typeof p.total === "number" || typeof p.availability === "number";
}

export function isEventPayload(payload: unknown): payload is OeeEvent {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.event === "string";
}
