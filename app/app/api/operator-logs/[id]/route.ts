import { auth } from "@/auth";
import { isLocked, parseLogInput } from "@/lib/operator-logs";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

function parseId(id: string): bigint | null {
  return /^\d+$/.test(id) ? BigInt(id) : null;
}

export async function PUT(request: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.operatorId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logId = parseId((await params).id);
  if (logId === null) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = parseLogInput(await request.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const existing = await prisma.operatorLog.findUnique({ where: { id: logId } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (isLocked(existing.status)) {
    return Response.json({ error: `${existing.status} entries cannot be edited` }, { status: 409 });
  }

  await prisma.operatorLog.update({ where: { id: logId }, data: parsed.data });
  return Response.json({ status: "updated" });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.operatorId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logId = parseId((await params).id);
  if (logId === null) return Response.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.operatorLog.findUnique({ where: { id: logId } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (isLocked(existing.status)) {
    return Response.json({ error: `${existing.status} entries cannot be deleted` }, { status: 409 });
  }

  const inHandover = await prisma.shiftHandoverLog.count({ where: { logId } });
  if (inHandover > 0) {
    return Response.json({ error: "This entry is part of a shift handover" }, { status: 409 });
  }

  await prisma.operatorLog.deleteMany({ where: { id: logId } });
  return Response.json({ status: "deleted" });
}
