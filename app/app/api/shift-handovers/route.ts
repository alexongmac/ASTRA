import { auth } from "@/auth";
import { fail } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";
import { parseHandoverFields } from "@/lib/shift-handover";

// "Start Handover": the start time is when this is called.
export async function POST(request: Request) {
  const session = await auth();
  const operatorId = session?.user?.operatorId;
  if (!operatorId) return fail("Unauthorized", 401);

  const parsed = parseHandoverFields(await request.json().catch(() => null));
  if ("error" in parsed) return fail(parsed.error, 400);
  const { outgoingId, incomingId, area, machine } = parsed.data;

  const found = await prisma.operator.count({ where: { id: { in: [outgoingId, incomingId] } } });
  if (found !== new Set([outgoingId, incomingId]).size) return fail("Operator not found", 400);

  const handover = await prisma.shiftHandover.create({
    data: {
      area,
      machine,
      outgoingId,
      incomingId,
      createdById: operatorId,
      status: "On-Going",
      startTime: new Date(),
    },
  });
  return Response.json({ id: String(handover.id) }, { status: 201 });
}
