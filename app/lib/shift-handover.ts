import { LOG_MACHINES } from "@/lib/operator-logs";

export const SHIFT_HOURS = 8;

// Handover lifecycle. Editable statuses allow the content to change; a
// rejected handover goes back to its authors to fix and resubmit.
export const HANDOVER_STATUSES = ["On-Going", "Open for Approval", "Completed", "Rejected"] as const;
export const EDITABLE_STATUSES: readonly string[] = ["On-Going", "Rejected"];
export const isEditable = (status: string) => EDITABLE_STATUSES.includes(status);

export const HANDOVER_STATUS_STYLES: Record<string, string> = {
  "On-Going": "text-amber-300",
  "Open for Approval": "text-sky-400",
  Completed: "text-green-400",
  Rejected: "text-red-500",
};

// The shift being handed over: the SHIFT_HOURS before the handover started.
// Used for the Key Values graph. Attaching operator logs is not limited by it.
export function shiftWindow(start: Date) {
  return { from: new Date(start.getTime() - SHIFT_HOURS * 3_600_000), to: start };
}

export const MAX_TEXT = 10_000;
export const MAX_COMMENT = 500;

// Attachments live in the database. The mariadb driver's default packet limit
// is 4 MB, so a file must stay safely under that.
export const MAX_ATTACHMENT_BYTES = 4_000_000;
export const MAX_ATTACHMENTS = 20;

// Allowed extensions and the content type we serve them with. The type is
// decided here from the extension, never taken from the upload.
export const ATTACHMENT_TYPES: Record<string, { mime: string; inline: boolean }> = {
  png: { mime: "image/png", inline: true },
  jpg: { mime: "image/jpeg", inline: true },
  jpeg: { mime: "image/jpeg", inline: true },
  gif: { mime: "image/gif", inline: true },
  webp: { mime: "image/webp", inline: true },
  pdf: { mime: "application/pdf", inline: true },
  txt: { mime: "text/plain; charset=utf-8", inline: false },
  csv: { mime: "text/csv; charset=utf-8", inline: false },
  doc: { mime: "application/msword", inline: false },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  xls: { mime: "application/vnd.ms-excel", inline: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  ppt: { mime: "application/vnd.ms-powerpoint", inline: false },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false },
};

export const attachmentExtension = (fileName: string) =>
  fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";

export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).map((e) => `.${e}`).join(",");

export type ChecklistItem = { key: string; label: string; options: readonly string[] };

export const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { key: "hse", label: "Discussed HSE Issues", options: ["Yes", "No"] },
  { key: "production", label: "Discussed Production Issues", options: ["Yes", "No", "N/A"] },
  { key: "training", label: "Discussed Training Issues", options: ["Yes", "No", "N/A"] },
  { key: "workOrders", label: "Discussed Work Orders", options: ["Yes", "No"] },
  { key: "bypasses", label: "Discussed Bypasses/LOTO", options: ["Yes", "No"] },
];

export type Checklist = { confirmed: boolean } & Record<string, string | boolean>;

export function readChecklist(value: unknown): Checklist {
  const out: Checklist = { confirmed: false };
  if (typeof value !== "object" || value === null) return out;
  const v = value as Record<string, unknown>;
  out.confirmed = v.confirmed === true;
  for (const item of CHECKLIST_ITEMS) {
    const answer = v[item.key];
    if (typeof answer === "string" && item.options.includes(answer)) out[item.key] = answer;
  }
  return out;
}

export type HandoverFields = {
  outgoingId: number;
  incomingId: number;
  area: string;
  machine: string | null;
};

export function parseOperatorId(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

// Validates the fields chosen when a handover starts (and can change later).
export function parseHandoverFields(body: unknown): { data: HandoverFields } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Invalid request" };
  const b = body as Record<string, unknown>;

  const outgoingId = parseOperatorId(b.outgoingId);
  if (outgoingId === null) return { error: "Select the outgoing operator" };
  const incomingId = parseOperatorId(b.incomingId);
  if (incomingId === null) return { error: "Select the incoming operator" };

  const area = typeof b.area === "string" ? b.area.trim() : "";
  if (!area || area.length > 64) return { error: "Area is required" };

  const machine = b.machine === "" || b.machine == null ? null : String(b.machine);
  if (machine !== null && !(LOG_MACHINES as readonly string[]).includes(machine)) {
    return { error: "Machine is invalid" };
  }

  return { data: { outgoingId, incomingId, area, machine } };
}

export function parseText(value: unknown, label: string): { value: string | null } | { error: string } {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${label} is invalid` };
  if (value.length > MAX_TEXT) return { error: `${label} must be ${MAX_TEXT} characters or fewer` };
  return { value };
}

// Who a signed-in operator is on a given handover.
export function roleOf(
  operatorId: number,
  h: { outgoingId: number | null; incomingId: number | null; createdById: number | null },
) {
  const isOutgoing = h.outgoingId === operatorId;
  const isIncoming = h.incomingId === operatorId;
  return { isOutgoing, isIncoming, canEdit: isOutgoing || isIncoming || h.createdById === operatorId };
}
