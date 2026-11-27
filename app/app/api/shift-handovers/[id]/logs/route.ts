import { fail, guardHandover, parseBigId } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

// Adds an operator-log entry to the handover. Any entry can be added,
// whatever its event time.
export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardHandover((await params).id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const body = (await request.json().catch(() => null)) as { logId?: unknown } | null;
  const logId = typeof body?.logId === "string" ? parseBigId(body.logId) : null;
  if (logId === null) return fail("Invalid log entry", 400);

  const log = await prisma.operatorLog.findUnique({ where: { id: logId } });
  if (!log) return fail("Log entry not found", 404);

  await prisma.shiftHandoverLog.createMany({
    data: [{ handoverId: guard.id, logId }],
    skipDuplicates: true,
  });
  return Response.json({ status: "added" }, { status: 201 });
}
