import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { DEFAULT_AREAS } from "@/lib/operator-logs";
import { isLocked } from "@/lib/operator-logs";
import { prisma } from "@/lib/prisma";
import { Header } from "../../../header";
import { LogForm } from "../../../log-form";

export const instant = false;

export default async function EditLogPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const log = await prisma.operatorLog.findUnique({ where: { id: BigInt(id) } });
  if (!log) notFound();
  // Closed and Cancelled entries are final; send direct visits back to the list.
  if (isLocked(log.status)) redirect("/?tab=logs");

  return (
    <main className="min-h-screen bg-slate-900 px-6 py-5">
      <Header userName={session.user.name} />
      <h2 className="mt-5 text-sm font-semibold text-white">Edit Entry</h2>
      <LogForm
        logId={id}
        areas={[...DEFAULT_AREAS]}
        initial={{
          eventTime: log.eventTime.toISOString(),
          area: log.area,
          machine: log.machine ?? "",
          category: log.category,
          priority: log.priority ?? "",
          status: log.status,
          message: log.message,
        }}
      />
    </main>
  );
}
