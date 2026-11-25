import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AcknowledgeButton } from "./acknowledge-button";
import { AutoRefresh } from "./auto-refresh";
import { DeleteLogButton } from "./delete-log-button";
import { Header } from "./header";
import { MessageCell } from "./message-cell";
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

// Operator log colours. Full class names (not built strings) so Tailwind sees them.
const LOG_PRIORITY_STYLES: Record<string, string> = {
  High: "text-red-500",
  Medium: "text-orange-400",
  Low: "text-green-400",
};

const LOG_STATUS_STYLES: Record<string, string> = {
  Open: "text-amber-300",
  Closed: "text-green-400",
  "On-Hold": "text-sky-400",
  Cancelled: "text-slate-400",
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
  const showLogs = tab === "logs";

  const [active, history, logs] = await Promise.all([
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
    showLogs
      ? prisma.operatorLog.findMany({
          orderBy: { eventTime: "desc" },
          take: 200,
          include: { createdBy: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main className="min-h-screen bg-slate-900 px-6 py-5">
      <AutoRefresh />
      <Header userName={session.user.name} />

      <nav className="mt-5 flex gap-2">
        <Tab href="/" label={`Active alarms (${active.length})`} active={!showHistory && !showLogs} />
        <Tab href="/?tab=history" label="Alarm History" active={showHistory} />
        <Tab href="/?tab=logs" label="Operator logs" active={showLogs} />
      </nav>

      {showLogs ? (
        <section className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
          <div className="mb-3">
            <Link
              href="/operator-logs/new"
              className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <span aria-hidden="true">+</span> New Entry
            </Link>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="text-blue-400">
              <tr>
                <Th />
                <Th className="whitespace-nowrap">Event Time</Th>
                <Th className="whitespace-nowrap">Area</Th>
                <Th className="whitespace-nowrap">Machine</Th>
                <Th className="whitespace-nowrap">Category</Th>
                <Th className="whitespace-nowrap">Priority</Th>
                <Th className="whitespace-nowrap">Author</Th>
                <Th className="w-full">Message</Th>
                <Th className="w-[100px] min-w-[100px]">Status</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={String(log.id)} className="border-t border-slate-700">
                  <Td>
                    {log.status === "Closed" ? (
                      // Closed entries are final: both actions are switched off.
                      <div
                        className="flex items-center gap-2 text-slate-600"
                        title="Closed entries cannot be edited or deleted"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                        </svg>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <DeleteLogButton logId={String(log.id)} />
                        <Link
                          href={`/operator-logs/${log.id}/edit`}
                          title="Edit"
                          aria-label="Edit log entry"
                          className="text-slate-300 hover:text-amber-300"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </Link>
                      </div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap"><Time value={log.eventTime} /></Td>
                  <Td className="whitespace-nowrap">{log.area}</Td>
                  <Td className="whitespace-nowrap">{log.machine ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{log.category}</Td>
                  <Td className={`whitespace-nowrap font-semibold ${LOG_PRIORITY_STYLES[log.priority ?? ""] ?? "text-slate-100"}`}>{log.priority ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{log.createdBy?.displayName ?? "—"}</Td>
                  <Td className="w-full max-w-0">
                    <MessageCell
                      log={{
                        eventTime: log.eventTime.toISOString(),
                        area: log.area,
                        machine: log.machine,
                        category: log.category,
                        priority: log.priority,
                        status: log.status,
                        author: log.createdBy?.displayName ?? null,
                        message: log.message,
                      }}
                    />
                  </Td>
                  <Td className={`w-[100px] min-w-[100px] ${LOG_STATUS_STYLES[log.status] ?? "text-slate-400"}`}>{log.status}</Td>
                </tr>
              ))}
              {logs.length === 0 ? <EmptyRow colSpan={9} label="No log entries yet." /> : null}
            </tbody>
          </table>
        </section>
      ) : showHistory ? (
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

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`pb-2 pr-4 font-medium ${className}`}>{children}</th>;
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
