import { fail, guardHandover, parseBigId } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";
import { shiftWindow } from "@/lib/shift-handover";

type Ctx = { params: Promise<{ id: string }> };

// Adds an operator-log entry, but only one from the shift being handed over.
export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardHandover((await params).id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const body = (await request.json().catch(() => null)) as { logId?: unknown } | null;
  const logId = typeof body?.logId === "string" ? parseBigId(body.logId) : null;
  if (logId === null) return fail("Invalid log entry", 400);

  const log = await prisma.operatorLog.findUnique({ where: { id: logId } });
  if (!log) return fail("Log entry not found", 404);

  const { from, to } = shiftWindow(guard.handover.startTime);
  if (log.eventTime < from || log.eventTime > to) {
    return fail("Only logs from the 8 hours before the handover can be added", 400);
  }

  await prisma.shiftHandoverLog.createMany({
    data: [{ handoverId: guard.id, logId }],
    skipDuplicates: true,
  });
  return Response.json({ status: "added" }, { status: 201 });
}
