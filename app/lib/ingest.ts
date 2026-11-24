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

export async function processMessage(payload: unknown): Promise<void> {
  if (isSummaryPayload(payload)) {
    await storeSummary(payload);
    await reconcileAlarms(
      payload.machine,
      payload.run_id,
      payload.product ?? null,
      evaluateSummaryRules(payload),
    );
    return;
  }

  if (isEventPayload(payload)) {
    await storeEvent(payload);
    await reconcileAlarms(
      payload.machine,
      payload.run_id,
      null,
      evaluateEventRules(payload),
    );
    return;
  }

  throw new Error(
    `Unrecognised payload shape: ${JSON.stringify(payload).slice(0, 200)}`,
  );
}

async function storeEvent(event: OeeEvent) {
  await prisma.machineEvent.create({
    data: {
      v: event.v,
      ts: new Date(event.ts),
      runId: BigInt(event.run_id),
      machine: event.machine,
      event: event.event,
      detail: event.detail ?? null,
      gear: event.state?.gear ?? null,
      conveyor: event.state?.conveyor ?? null,
      output: event.state?.output ?? null,
      oee: event.oee ?? null,
    },
  });
}

async function storeSummary(summary: OeeSummary) {
  await prisma.oeeSummary.create({
    data: {
      v: summary.v,
      ts: new Date(summary.ts),
      runId: BigInt(summary.run_id),
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
      await prisma.alarm.create({
        data: {
          ruleKey: verdict.ruleKey,
          severity: verdict.severity,
          machine,
          product,
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
          product,
          title: verdict.title,
          detail: verdict.detail ?? null,
        });
      }
    } else if (!verdict.active && open) {
      await prisma.alarm.update({
        where: { id: open.id },
        data: { status: "cleared", clearedAt: new Date() },
      });
    }
  }
}
