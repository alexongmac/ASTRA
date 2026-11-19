import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.operatorId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const alarmId = BigInt(id);

  const alarm = await prisma.alarm.findUnique({ where: { id: alarmId } });
  if (!alarm) return Response.json({ error: "Not found" }, { status: 404 });
  if (alarm.status !== "raised") {
    return Response.json({ error: `Alarm is already ${alarm.status}` }, { status: 409 });
  }

  await prisma.alarm.update({
    where: { id: alarmId },
    data: {
      status: "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedById: session.user.operatorId,
    },
  });

  return Response.json({ status: "acknowledged" });
}
