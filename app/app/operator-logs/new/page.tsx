import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { loadAreas } from "@/lib/areas";
import { Header } from "../../header";
import { LogForm } from "../../log-form";

export const instant = false;

export default async function NewLogPage() {
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="min-h-screen bg-slate-900 px-6 py-5">
      <Header userName={session.user.name} />
      <h2 className="mt-5 text-sm font-semibold text-white">New Entry</h2>
      <LogForm areas={await loadAreas()} />
    </main>
  );
}
