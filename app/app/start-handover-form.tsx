"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useState, useTransition } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD } from "./field-styles";
import { DEFAULT_AREAS, LOG_MACHINES } from "@/lib/operator-logs";

export type OperatorOption = { id: number; name: string };

// First step of a handover: pick who is handing over to whom, then start it.
// The start time is recorded when "Start Handover" is pressed.
export function StartHandoverForm({ operators }: { operators: OperatorOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const [area, setArea] = useState("");
  const [machine, setMachine] = useState("");

  // Cache Components keeps a navigated-away page mounted but hidden; start from
  // a blank form each time it is shown again.
  useLayoutEffect(() => {
    return () => {
      setOutgoing("");
      setIncoming("");
      setArea("");
      setMachine("");
      setError(null);
    };
  }, []);

  const start = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/shift-handovers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outgoingId: outgoing, incomingId: incoming, area, machine }),
        });
      } catch {
        setError("Network error - try again");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !body.id) {
        setError(body.error ?? `Failed (${response.status})`);
        return;
      }
      router.push(`/shift-handover/${body.id}`);
    });
  };

  return (
    <form onSubmit={start} className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
      <div className="grid gap-4 text-xs text-blue-400 md:grid-cols-4">
        <label className="flex flex-col gap-1">
          Outgoing Operator
          <select required value={outgoing} onChange={(e) => setOutgoing(e.target.value)} className={FIELD}>
            <option value="">Not Assigned</option>
            {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Incoming Operator
          <select required value={incoming} onChange={(e) => setIncoming(e.target.value)} className={FIELD}>
            <option value="">Not Assigned</option>
            {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Area
          <select required value={area} onChange={(e) => setArea(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {DEFAULT_AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Machine
          <select value={machine} onChange={(e) => setMachine(e.target.value)} className={FIELD}>
            <option value="">-</option>
            {LOG_MACHINES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <p className="mt-4 text-xs text-slate-300">
        Status: <span className="font-semibold text-amber-300">On-Going</span>
        <span className="ml-3 text-slate-500">The start time is recorded when you press Start Handover.</span>
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={pending} className={BTN_PRIMARY}>
          {pending ? "Starting…" : "Start Handover"}
        </button>
        <Link href="/?tab=handover" className={BTN_SECONDARY}>Exit</Link>
        {error ? <span className="text-xs text-red-500">{error}</span> : null}
      </div>
    </form>
  );
}
