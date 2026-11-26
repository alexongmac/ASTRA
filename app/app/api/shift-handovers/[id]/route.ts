import { fail, guardHandover } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";
import { parseHandoverFields, parseText, readChecklist } from "@/lib/shift-handover";

type Ctx = { params: Promise<{ id: string }> };

// Saves the editable content of a handover.
export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await guardHandover((await params).id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const body: unknown = await request.json().catch(() => null);
  const fields = parseHandoverFields(body);
  if ("error" in fields) return fail(fields.error, 400);

  const b = body as Record<string, unknown>;
  const summary = parseText(b.summary, "Summary");
  if ("error" in summary) return fail(summary.error, 400);
  const healthSafety = parseText(b.healthSafety, "Health and Safety");
  if ("error" in healthSafety) return fail(healthSafety.error, 400);

  const { outgoingId, incomingId } = fields.data;
  const found = await prisma.operator.count({ where: { id: { in: [outgoingId, incomingId] } } });
  if (found !== new Set([outgoingId, incomingId]).size) return fail("Operator not found", 400);

  const checklist = readChecklist(b.checklist);
  // Only the outgoing operator can confirm the record is true.
  if (!guard.role.isOutgoing) checklist.confirmed = readChecklist(guard.handover.checklist).confirmed;

  await prisma.shiftHandover.update({
    where: { id: guard.id },
    data: {
      ...fields.data,
      summary: summary.value,
      healthSafety: healthSafety.value,
      checklist,
    },
  });
  return Response.json({ status: "saved" });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await guardHandover((await params).id, { needEditable: true });
  if ("response" in guard) return guard.response;

  await prisma.shiftHandover.delete({ where: { id: guard.id } });
  return Response.json({ status: "deleted" });
}
