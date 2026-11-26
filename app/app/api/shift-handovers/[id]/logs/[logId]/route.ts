import { fail, guardHandover, parseBigId } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string; logId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, logId: rawLogId } = await params;
  const guard = await guardHandover(id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const logId = parseBigId(rawLogId);
  if (logId === null) return fail("Not found", 404);

  await prisma.shiftHandoverLog.deleteMany({ where: { handoverId: guard.id, logId } });
  return Response.json({ status: "removed" });
}
