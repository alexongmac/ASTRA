import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "../../header";
import { StartHandoverForm } from "../../start-handover-form";

export const instant = false;

export default async function NewHandoverPage() {
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/login");

  const operators = await prisma.operator.findMany({
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });

  return (
    <main className="min-h-screen bg-slate-900 px-6 py-5">
      <Header userName={session.user.name} />
      <h2 className="mt-5 text-sm font-semibold text-white">New Shift Handover</h2>
      <StartHandoverForm operators={operators.map((o) => ({ id: o.id, name: o.displayName }))} />
    </main>
  );
}
