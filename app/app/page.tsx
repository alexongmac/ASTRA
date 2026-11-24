import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AcknowledgeButton } from "./acknowledge-button";
import { AutoRefresh } from "./auto-refresh";
import { LocalTime } from "./local-time";

// Session + live alarm data are request-time reads, so this route blocks.
export const instant = false;

const SEVERITY_STYLES: Record<string, string> = {
  // The page has a dark background, so these are the lighter shades of each
  // hue - the 600-weight versions go muddy against dark slate.
  CRITICAL: "text-red-500",
  WARNING: "text-yellow-300",
  INFO: "text-green-400",
};

const STATUS_STYLES: Record<string, string> = {
  raised: "text-red-400",
  acknowledged: "text-amber-300",
  cleared: "text-slate-400",
};

// Renders in the viewer's own time zone; the server's zone is UTC.
const Time = ({ value }: { value: Date | null }) =>
  value ? <LocalTime iso={value.toISOString()} /> : null;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // The log-out form is a Server Action, whose id is generated per render.
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { tab } = await searchParams;
  const showHistory = tab === "history";

  const [active, history] = await Promise.all([
    prisma.alarm.findMany({
      where: { status: { in: ["raised", "acknowledged"] } },
      orderBy: { raisedAt: "desc" },
    }),
    showHistory
      ? prisma.alarm.findMany({
          orderBy: { raisedAt: "desc" },
          take: 100,
          include: { acknowledgedBy: true },
        })
      : Promise.resolve([]),
  ]);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="min-h-screen bg-slate-900 px-6 py-5">
      <AutoRefresh />
      <header className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-white">R2D2 · Operation Excellence</h1>
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span>Signed in as {session.user.name}</span>
          <form action={logout}>
            <button className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 hover:bg-slate-700">
              Log out
            </button>
          </form>
        </div>
      </header>

      <nav className="mt-5 flex gap-2">
        <Tab href="/" label={`Active alarms (${active.length})`} active={!showHistory} />
        <Tab href="/?tab=history" label="Alarm History" active={showHistory} />
      </nav>

      {showHistory ? (
        <section className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
          <p className="mb-3 text-xs text-slate-500">
            Acknowledged. Sending to the machine will retry automatically.
          </p>
          <table className="w-full text-left text-xs">
            <thead className="text-blue-400">
              <tr>
                <Th>Raised</Th>
                <Th>Machine</Th>
                <Th>Product</Th>
                <Th>Alarm</Th>
                <Th>Severity</Th>
                <Th>Status</Th>
                <Th>Acknowledged</Th>
                <Th>Cleared</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((alarm) => (
                <tr key={String(alarm.id)} className="border-t border-slate-700">
                  <Td><Time value={alarm.raisedAt} /></Td>
                  <Td>{alarm.machine}</Td>
                  <Td>{alarm.product ?? "—"}</Td>
                  <Td>{alarm.title}</Td>
                  <Td className={`font-semibold ${SEVERITY_STYLES[alarm.severity]}`}>{alarm.severity}</Td>
                  <Td className={STATUS_STYLES[alarm.status]}>{alarm.status}</Td>
                  <Td>
                    {alarm.acknowledgedAt ? (
                      <>
                        {alarm.acknowledgedBy?.displayName ?? "unknown"} · <Time value={alarm.acknowledgedAt} />
                      </>
                    ) : null}
                  </Td>
                  <Td><Time value={alarm.clearedAt} /></Td>
                </tr>
              ))}
              {history.length === 0 ? <EmptyRow colSpan={8} label="No alarms recorded yet." /> : null}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="text-blue-400">
              <tr>
                <Th>Severity</Th>
                <Th>Machine</Th>
                <Th>Product</Th>
                <Th>Alarm</Th>
                <Th>Raised</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {active.map((alarm) => (
                <tr key={String(alarm.id)} className="border-t border-slate-700">
                  <Td className={`font-semibold ${SEVERITY_STYLES[alarm.severity]}`}>{alarm.severity}</Td>
                  <Td>{alarm.machine}</Td>
                  <Td>{alarm.product ?? "—"}</Td>
                  <Td>
                    <div>{alarm.title}</div>
                    <div className="text-slate-500">{alarm.ruleKey}</div>
                  </Td>
                  <Td><Time value={alarm.raisedAt} /></Td>
                  <Td className={STATUS_STYLES[alarm.status]}>{alarm.status}</Td>
                  <Td>
                    {alarm.status === "raised" ? <AcknowledgeButton alarmId={String(alarm.id)} /> : null}
                  </Td>
                </tr>
              ))}
              {active.length === 0 ? <EmptyRow colSpan={7} label="No active alarms." /> : null}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded border px-3 py-1.5 text-xs ${
        active
          ? "border-slate-500 bg-slate-800 font-medium text-white"
          : "border-transparent text-slate-300 hover:bg-slate-800"
      }`}
    >
      {label}
    </Link>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="pb-2 pr-4 font-medium">{children}</th>;
}

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  // Only apply the default text colour when the caller has not passed one of
  // its own: two competing text-* utilities are resolved by stylesheet order,
  // not by the order they appear here, so the default can otherwise win.
  const colour = /(^|\s)text-/.test(className) ? "" : "text-slate-100";
  return <td className={`py-2 pr-4 align-top ${colour} ${className}`}>{children}</td>;
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-slate-500">
        {label}
      </td>
    </tr>
  );
}
