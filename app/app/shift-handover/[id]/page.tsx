import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isEditable, readChecklist, roleOf, shiftWindow } from "@/lib/shift-handover";
import { Header } from "../../header";
import { HandoverAttachments } from "../../handover-attachments";
import { HandoverEditor } from "../../handover-editor";
import { HandoverLogs, type HandoverLogRow } from "../../handover-logs";
import { KeyValues } from "../../key-values";

export const instant = false;

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const session = await auth();
  const operatorId = session?.user?.operatorId;
  if (!session?.user || !operatorId) redirect("/login");

  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const handover = await prisma.shiftHandover.findUnique({
    where: { id: BigInt(id) },
    include: {
      logs: { include: { log: { include: { createdBy: true } } } },
      attachments: {
        // Never load the file bytes for a listing.
        select: { id: true, fileName: true, size: true, comment: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!handover) notFound();

  const role = roleOf(operatorId, handover);
  const editable = isEditable(handover.status) && role.canEdit;
  const window = shiftWindow(handover.startTime);

  // Any operator-log entry can be attached, from any time; the list shows the
  // newest first. The cap only keeps the page responsive.
  const linkedIds = handover.logs.map((l) => l.logId);
  const eligible = editable
    ? await prisma.operatorLog.findMany({
        where: { id: { notIn: linkedIds } },
        orderBy: { eventTime: "desc" },
        take: 500,
        include: { createdBy: true },
      })
    : [];

  const toRow = (l: (typeof eligible)[number]): HandoverLogRow => ({
    id: String(l.id),
    eventTime: l.eventTime.toISOString(),
    area: l.area,
    machine: l.machine,
    category: l.category,
    priority: l.priority,
    author: l.createdBy?.displayName ?? null,
    message: l.message,
    status: l.status,
  });
  const linked = handover.logs
    .map((l) => toRow(l.log))
    .sort((a, b) => b.eventTime.localeCompare(a.eventTime));

  const operators = await prisma.operator.findMany({
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });

  return (
    <main className="min-h-screen bg-slate-900 px-6 py-5">
      <Header userName={session.user.name} />
      <div className="mt-5 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-white">Shift Handover #{id}</h2>
        <Link href="/?tab=handover" className="text-xs text-blue-400 hover:underline">
          Back to list
        </Link>
      </div>
      {!editable && isEditable(handover.status) ? (
        <p className="mt-2 text-xs text-slate-400">
          You are not on this handover, so it is read-only for you.
        </p>
      ) : null}

      <HandoverEditor
        handover={{
          id,
          status: handover.status,
          startTime: handover.startTime.toISOString(),
          endTime: handover.endTime?.toISOString() ?? null,
          area: handover.area,
          machine: handover.machine ?? "",
          outgoingId: handover.outgoingId ? String(handover.outgoingId) : "",
          incomingId: handover.incomingId ? String(handover.incomingId) : "",
          summary: handover.summary ?? "",
          healthSafety: handover.healthSafety ?? "",
          checklist: readChecklist(handover.checklist),
          outgoingDecision: handover.outgoingDecision,
          incomingDecision: handover.incomingDecision,
        }}
        operators={operators.map((o) => ({ id: o.id, name: o.displayName }))}
        editable={editable}
        me={{ isOutgoing: role.isOutgoing, isIncoming: role.isIncoming }}
        attachments={
          <HandoverAttachments
            handoverId={id}
            files={handover.attachments.map((a) => ({
              id: String(a.id),
              fileName: a.fileName,
              size: a.size,
              comment: a.comment,
            }))}
            editable={editable}
          />
        }
        logs={
          <HandoverLogs
            handoverId={id}
            logs={linked}
            eligible={eligible.map(toRow)}
            editable={editable}
          />
        }
        keyValues={<KeyValues machine={handover.machine} from={window.from} to={window.to} />}
      />
    </main>
  );
}
