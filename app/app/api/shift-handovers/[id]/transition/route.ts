import { fail, guardHandover } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";
import { readChecklist } from "@/lib/shift-handover";

type Ctx = { params: Promise<{ id: string }> };

// submit  : outgoing operator sends the handover for approval
// approve / reject : the outgoing and incoming operators each decide once
export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardHandover((await params).id, { needEditable: false });
  if ("response" in guard) return guard.response;
  const { id, handover, role } = guard;

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;

  if (action === "submit") {
    if (handover.status !== "On-Going" && handover.status !== "Rejected") {
      return fail(`A handover that is ${handover.status} cannot be submitted`, 409);
    }
    if (!role.isOutgoing) return fail("Only the outgoing operator can submit", 403);
    if (!readChecklist(handover.checklist).confirmed) {
      return fail("Confirm that the document is a true record of the shift first", 400);
    }
    await prisma.shiftHandover.update({
      where: { id },
      data: { status: "Open for Approval", outgoingDecision: null, incomingDecision: null },
    });
    return Response.json({ status: "Open for Approval" });
  }

  if (action === "approve" || action === "reject") {
    if (handover.status !== "Open for Approval") {
      return fail("This handover is not waiting for approval", 409);
    }
    if (!role.isOutgoing && !role.isIncoming) {
      return fail("Only the outgoing or incoming operator can decide", 403);
    }
    const decision = action === "approve" ? "approved" : "rejected";

    // Each person decides once for the role(s) they hold on this handover.
    const outgoingDecision =
      role.isOutgoing && handover.outgoingDecision === null ? decision : handover.outgoingDecision;
    const incomingDecision =
      role.isIncoming && handover.incomingDecision === null ? decision : handover.incomingDecision;
    if (
      outgoingDecision === handover.outgoingDecision &&
      incomingDecision === handover.incomingDecision
    ) {
      return fail("You have already decided on this handover", 409);
    }

    let status = "Open for Approval";
    let endTime: Date | null = null;
    if (outgoingDecision === "rejected" || incomingDecision === "rejected") {
      status = "Rejected";
    } else if (outgoingDecision === "approved" && incomingDecision === "approved") {
      status = "Completed";
      endTime = new Date();
    }

    // Only apply if the handover is still waiting, so two people deciding at
    // the same moment cannot overwrite each other's outcome.
    const { count } = await prisma.shiftHandover.updateMany({
      where: { id, status: "Open for Approval", updatedAt: handover.updatedAt },
      data: { status, endTime, outgoingDecision, incomingDecision },
    });
    if (count === 0) return fail("The handover changed; reload and try again", 409);
    return Response.json({ status });
  }

  return fail("Unknown action", 400);
}
