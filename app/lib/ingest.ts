import { notifyDiscord } from "@/lib/discord";
import { prisma } from "@/lib/prisma";
import {
  evaluateEventRules,
  evaluateSummaryRules,
  isEventPayload,
  isSummaryPayload,
  type OeeEvent,
  type OeeSummary,
  type RuleVerdict,
} from "@/lib/alarm-rules";

// The machine reports run_id: null when no production run is active. The
// machine_events and oee_summaries tables declare run_id NOT NULL, so such a
// row cannot be stored - and BigInt(null) used to throw, which sent the message
// to the dead-letter queue after three tries and, for a gear_down event,
// dropped the alarm entirely. Alarms accept a null run, so the rules are still
// evaluated; only the raw row is skipped.
export async function processMessage(payload: unknown): Promise<void> {
  if (isSummaryPayload(payload)) {
    const runId = payload.run_id ?? undefined;
    if (runId !== undefined) await storeSummary(payload, runId);
    await reconcileAlarms(
      payload.machine,
      runId,
      payload.product ?? null,
      evaluateSummaryRules(payload),
    );
    return;
  }

  if (isEventPayload(payload)) {
    const runId = payload.run_id ?? undefined;
    if (runId !== undefined) await storeEvent(payload, runId);
    await reconcileAlarms(
      payload.machine,
      runId,
      payload.product ?? null,
      evaluateEventRules(payload),
    );
    return;
  }

  throw new Error(
    `Unrecognised payload shape: ${JSON.stringify(payload).slice(0, 200)}`,
  );
}

async function storeEvent(event: OeeEvent, runId: number) {
  await prisma.machineEvent.create({
    data: {
      v: event.v,
      ts: new Date(event.ts),
      runId: BigInt(runId),
      machine: event.machine,
      productName: event.product ?? null,
      event: event.event,
      detail: event.detail ?? null,
      gear: event.state?.gear ?? null,
      conveyor: event.state?.conveyor ?? null,
      output: event.state?.output ?? null,
      oee: event.oee ?? null,
    },
  });
}

async function storeSummary(summary: OeeSummary, runId: number) {
  await prisma.oeeSummary.create({
    data: {
      v: summary.v,
      ts: new Date(summary.ts),
      runId: BigInt(runId),
      machine: summary.machine,
      product: summary.product ?? null,
      availability: summary.availability ?? null,
      performance: summary.performance ?? null,
      quality: summary.quality ?? null,
      oee: summary.oee ?? null,
      total: summary.total ?? null,
      good: summary.good ?? null,
      defect: summary.defect ?? null,
      elapsedS: summary.elapsed_s ?? null,
      downtimeS: summary.downtime_s ?? null,
      setupS: summary.setup_s ?? null,
      runtimeS: summary.runtime_s ?? null,
      plannedTimeMin: summary.planned_time_min ?? null,
      idealCycleS: summary.ideal_cycle_s ?? null,
    },
  });
}

// The product the machine most recently reported in an OEE summary, preferring
// the same run. Never throws: a failed lookup must not stop an alarm being
// raised, it just leaves the product blank. With no run id (no run active) this
// is the machine's last known product, which may be from an earlier run.
async function latestProduct(
  machine: string,
  runId: number | undefined,
): Promise<string | null> {
  try {
    const row = await prisma.oeeSummary.findFirst({
      where: {
        machine,
        product: { not: null },
        ...(runId !== undefined ? { runId: BigInt(runId) } : {}),
      },
      orderBy: { ts: "desc" },
      select: { product: true },
    });
    return row?.product ?? null;
  } catch (error) {
    console.error("Product lookup failed:", (error as Error).message);
    return null;
  }
}

// Raises an alarm when a rule becomes active and no open alarm exists for it,
// and clears the open alarm once the same rule reports inactive.
async function reconcileAlarms(
  machine: string,
  runId: number | undefined,
  product: string | null,
  verdicts: RuleVerdict[],
) {
  for (const verdict of verdicts) {
    const open = await prisma.alarm.findFirst({
      where: {
        machine,
        ruleKey: verdict.ruleKey,
        status: { in: ["raised", "acknowledged"] },
      },
      orderBy: { raisedAt: "desc" },
    });

    if (verdict.active && !open) {
      // Event messages carry no product, so fall back to the one the machine
      // last reported in a summary. Looked up only when an alarm is actually
      // being raised, not on every message.
      const alarmProduct = product ?? (await latestProduct(machine, runId));
      await prisma.alarm.create({
        data: {
          ruleKey: verdict.ruleKey,
          severity: verdict.severity,
          machine,
          product: alarmProduct,
          runId: runId === undefined ? null : BigInt(runId),
          title: verdict.title,
          detail: verdict.detail ?? null,
        },
      });
      // Only CRITICAL alarms post to Discord. notifyDiscord never throws, so a
      // failed notification cannot stop the alarm from being stored.
      if (verdict.severity === "CRITICAL") {
        await notifyDiscord({
          severity: verdict.severity,
          machine,
          product: alarmProduct,
          title: verdict.title,
          detail: verdict.detail ?? null,
        });
      }
    } else if (!verdict.active && open) {
      await prisma.alarm.update({
        where: { id: open.id },
        data: { status: "cleared", clearedAt: new Date() },
      });
      // Mirror the raise message: tell Discord when a CRITICAL alarm clears.
      if (open.severity === "CRITICAL") {
        await notifyDiscord({
          severity: open.severity,
          machine: open.machine,
          product: open.product,
          title: open.title,
          detail: null,
          cleared: true,
          raisedAt: open.raisedAt,
        });
      }
    }
  }
}
