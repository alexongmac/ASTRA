"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD } from "./field-styles";
import { Section } from "./handover-section";
import { LocalTime } from "./local-time";
import type { OperatorOption } from "./start-handover-form";
import { DEFAULT_AREAS, LOG_MACHINES } from "@/lib/operator-logs";
import {
  CHECKLIST_ITEMS,
  HANDOVER_STATUS_STYLES,
  MAX_TEXT,
  type Checklist,
} from "@/lib/shift-handover";

export type HandoverView = {
  id: string;
  status: string;
  startTime: string; // ISO
  endTime: string | null;
  area: string;
  machine: string;
  outgoingId: string;
  incomingId: string;
  summary: string;
  healthSafety: string;
  checklist: Checklist;
  outgoingDecision: string | null;
  incomingDecision: string | null;
};

type Props = {
  handover: HandoverView;
  operators: OperatorOption[];
  /** Status allows changes and the signed-in operator may make them. */
  editable: boolean;
  me: { isOutgoing: boolean; isIncoming: boolean };
  // Server-rendered sections, placed in the page's order.
  attachments: React.ReactNode;
  logs: React.ReactNode;
  keyValues: React.ReactNode;
};

const decisionText = (d: string | null) =>
  d === "approved" ? "Approved" : d === "rejected" ? "Rejected" : "Pending";
const decisionTone = (d: string | null) =>
  d === "approved" ? "text-green-400" : d === "rejected" ? "text-red-500" : "text-slate-400";

export function HandoverEditor({ handover: h, operators, editable, me, attachments, logs, keyValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [outgoingId, setOutgoingId] = useState(h.outgoingId);
  const [incomingId, setIncomingId] = useState(h.incomingId);
  const [area, setArea] = useState(h.area);
  const [machine, setMachine] = useState(h.machine);
  const [summary, setSummary] = useState(h.summary);
  const [healthSafety, setHealthSafety] = useState(h.healthSafety);
  const [checklist, setChecklist] = useState<Checklist>(h.checklist);

  const base = `/api/shift-handovers/${h.id}`;

  const post = async (path: string, init: RequestInit) => {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return response.ok ? null : (body.error ?? `Failed (${response.status})`);
    } catch {
      return "Network error - try again";
    }
  };

  const save = async () =>
    post("", {
      method: "PATCH",
      body: JSON.stringify({ outgoingId, incomingId, area, machine, summary, healthSafety, checklist }),
    });

  const run = (work: () => Promise<string | null>, success: string) => {
    setMessage(null);
    startTransition(async () => {
      const error = await work();
      setMessage(error ? { text: error, ok: false } : { text: success, ok: true });
      if (!error) router.refresh();
    });
  };

  const onSave = () => run(save, "Saved.");
  const onSubmit = () =>
    run(async () => (await save()) ?? (await post("/transition", { method: "POST", body: JSON.stringify({ action: "submit" }) })), "Submitted for approval.");
  const decide = (action: "approve" | "reject") =>
    run(() => post("/transition", { method: "POST", body: JSON.stringify({ action }) }), action === "approve" ? "Approved." : "Rejected.");

  const setAnswer = (key: string, option: string) =>
    setChecklist((c) => {
      const next = { ...c };
      if (next[key] === option) delete next[key];
      else next[key] = option;
      return next;
    });

  const waiting = h.status === "Open for Approval";
  const canSubmit = editable && me.isOutgoing;
  const canDecideOut = waiting && me.isOutgoing && h.outgoingDecision === null;
  const canDecideIn = waiting && me.isIncoming && h.incomingDecision === null;

  const name = (id: string) => operators.find((o) => String(o.id) === id)?.name ?? "the operator";

  return (
    <>
      <Section title="Operators">
        <div className="grid gap-4 text-xs text-blue-400 md:grid-cols-4">
          <label className="flex flex-col gap-1">
            Outgoing Operator
            <select disabled={!editable} value={outgoingId} onChange={(e) => setOutgoingId(e.target.value)} className={FIELD}>
              <option value="">Not Assigned</option>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Incoming Operator
            <select disabled={!editable} value={incomingId} onChange={(e) => setIncomingId(e.target.value)} className={FIELD}>
              <option value="">Not Assigned</option>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Area
            <select disabled={!editable} value={area} onChange={(e) => setArea(e.target.value)} className={FIELD}>
              {(DEFAULT_AREAS as readonly string[]).includes(area) ? null : <option>{area}</option>}
              {DEFAULT_AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Machine
            <select disabled={!editable} value={machine} onChange={(e) => setMachine(e.target.value)} className={FIELD}>
              <option value="">-</option>
              {LOG_MACHINES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
        </div>
        {editable ? (
          <p className="mt-2 text-xs text-slate-500">
            Changes to the operators, area and machine are kept when you press Save. The machine decides the Key Values shown.
          </p>
        ) : null}
      </Section>

      <Section title="Shift Information">
        <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-xs text-slate-100 md:grid-cols-[4rem_1fr_4rem_1fr_4rem_1fr]">
          <dt className="text-blue-400">Start</dt>
          <dd><LocalTime iso={h.startTime} /></dd>
          <dt className="text-blue-400">End</dt>
          <dd>{h.endTime ? <LocalTime iso={h.endTime} /> : "—"}</dd>
          <dt className="text-blue-400">Status</dt>
          <dd className={`font-semibold ${HANDOVER_STATUS_STYLES[h.status] ?? "text-slate-100"}`}>{h.status}</dd>
        </dl>
        <label className="mt-3 flex flex-col gap-1 text-xs text-blue-400">
          Summary
          <textarea
            disabled={!editable}
            value={summary}
            maxLength={MAX_TEXT}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            className={FIELD}
          />
        </label>
      </Section>

      {attachments}

      <Section title="Health and Safety">
        <textarea
          aria-label="Health and Safety"
          disabled={!editable}
          value={healthSafety}
          maxLength={MAX_TEXT}
          onChange={(e) => setHealthSafety(e.target.value)}
          rows={4}
          className={FIELD}
        />
      </Section>

      {logs}
      {keyValues}

      <Section title="Checklist">
        <label className="flex items-center justify-between gap-4 border-b border-slate-700 pb-2 text-xs text-slate-100">
          <span>Outgoing Operator: I confirm this document represents a true record of the shift</span>
          <input
            type="checkbox"
            disabled={!editable || !me.isOutgoing}
            checked={checklist.confirmed === true}
            onChange={(e) => setChecklist((c) => ({ ...c, confirmed: e.target.checked }))}
            title={me.isOutgoing ? undefined : `Only ${name(outgoingId)} (outgoing) can confirm`}
            className="h-4 w-4 accent-blue-600"
          />
        </label>
        {CHECKLIST_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-4 border-b border-slate-700 py-2 text-xs text-slate-100">
            <span>{item.label}</span>
            <span className="flex gap-1">
              {item.options.map((option) => {
                const selected = checklist[item.key] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={!editable}
                    aria-pressed={selected}
                    onClick={() => setAnswer(item.key, option)}
                    className={`min-w-12 rounded border px-3 py-1 ${
                      selected
                        ? "border-slate-400 bg-slate-600 font-semibold text-white"
                        : "border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-700"
                    } disabled:cursor-default disabled:hover:bg-inherit`}
                  >
                    {option}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </Section>

      <Section title="Approvals">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-xs text-slate-100">
          <div className="flex items-center gap-2">
            <button onClick={onSave} disabled={pending || !editable} className={BTN_SECONDARY}>Save</button>
            <button
              onClick={onSubmit}
              disabled={pending || !canSubmit}
              title={canSubmit ? undefined : `Only ${name(outgoingId)} (outgoing) can submit, while the handover is editable`}
              className={BTN_PRIMARY}
            >
              Submit
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span>Outgoing Supervisor</span>
            <button onClick={() => decide("approve")} disabled={pending || !canDecideOut} className={BTN_PRIMARY}>Approve</button>
            <button onClick={() => decide("reject")} disabled={pending || !canDecideOut} className={BTN_SECONDARY}>Reject</button>
            <span className={decisionTone(h.outgoingDecision)}>{decisionText(h.outgoingDecision)}</span>
          </div>

          <div className="flex items-center gap-2">
            <span>Incoming Supervisor</span>
            <button onClick={() => decide("approve")} disabled={pending || !canDecideIn} className={BTN_PRIMARY}>Approve</button>
            <button onClick={() => decide("reject")} disabled={pending || !canDecideIn} className={BTN_SECONDARY}>Reject</button>
            <span className={decisionTone(h.incomingDecision)}>{decisionText(h.incomingDecision)}</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs">
          <Link href="/?tab=handover" className={BTN_SECONDARY}>Exit</Link>
          {message ? <span className={message.ok ? "text-green-400" : "text-red-500"}>{message.text}</span> : null}
        </div>
        {h.status === "Rejected" ? (
          <p className="mt-2 text-xs text-slate-400">
            This handover was rejected. The operators can edit it and the outgoing operator can submit it again.
          </p>
        ) : null}
      </Section>
    </>
  );
}
