"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FIELD } from "./field-styles";
import { Section } from "./handover-section";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_COMMENT,
} from "@/lib/shift-handover";

export type AttachmentRow = { id: string; fileName: string; size: number; comment: string | null };

const formatSize = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export function HandoverAttachments({
  handoverId,
  files,
  editable,
}: {
  handoverId: string;
  files: AttachmentRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  const base = `/api/shift-handovers/${handoverId}/attachments`;

  const upload = (list: FileList | File[]) => {
    const chosen = Array.from(list);
    if (chosen.length === 0) return;
    setMessages([]);
    startTransition(async () => {
      const notes: string[] = [];
      const form = new FormData();
      for (const file of chosen) {
        // Quick checks so an obviously wrong file never leaves the browser; the
        // server repeats them.
        if (file.size > MAX_ATTACHMENT_BYTES) {
          notes.push(`${file.name}: larger than ${MAX_ATTACHMENT_BYTES / 1_000_000} MB`);
        } else {
          form.append("files", file);
        }
      }
      if (form.getAll("files").length > 0) {
        try {
          const response = await fetch(base, { method: "POST", body: form });
          const body = (await response.json().catch(() => ({}))) as {
            refused?: { name: string; reason: string }[];
            error?: string;
          };
          for (const r of body.refused ?? []) notes.push(`${r.name}: ${r.reason}`);
          if (body.error) notes.push(body.error);
          else if (!response.ok && !(body.refused ?? []).length) notes.push(`Upload failed (${response.status})`);
        } catch {
          notes.push("Network error - try again");
        }
      }
      setMessages(notes);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("Remove this attachment?")) return;
    startTransition(async () => {
      await fetch(`${base}/${id}`, { method: "DELETE" }).catch(() => null);
      router.refresh();
    });
  };

  const saveComment = (id: string, previous: string | null, next: string) => {
    if ((previous ?? "") === next.trim()) return;
    startTransition(async () => {
      await fetch(`${base}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: next }),
      }).catch(() => null);
      router.refresh();
    });
  };

  return (
    <Section title="Attachment(s) and comments">
      {files.length > 0 ? (
        <table className="mb-3 w-full text-left text-xs">
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-t border-slate-700">
                <td className="w-6 py-2 pr-2 align-middle">
                  {editable ? (
                    <button
                      onClick={() => remove(f.id)}
                      disabled={pending}
                      title="Remove"
                      aria-label={`Remove ${f.fileName}`}
                      className="text-slate-300 hover:text-red-400 disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  ) : null}
                </td>
                <td className="py-2 pr-4 align-middle">
                  <a
                    href={`${base}/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    {f.fileName}
                  </a>
                  <span className="ml-2 text-slate-500">{formatSize(f.size)}</span>
                </td>
                <td className="w-1/2 py-2 align-middle">
                  {editable ? (
                    <input
                      defaultValue={f.comment ?? ""}
                      maxLength={MAX_COMMENT}
                      placeholder="Comment"
                      onBlur={(e) => saveComment(f.id, f.comment, e.target.value)}
                      className={FIELD}
                    />
                  ) : (
                    <span className="text-slate-300">{f.comment ?? ""}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {editable ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            className={`flex items-center gap-2 rounded border border-dashed px-3 py-3 text-xs ${
              dragging ? "border-blue-400 bg-slate-700" : "border-slate-600"
            }`}
          >
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={pending || files.length >= MAX_ATTACHMENTS}
              title="Add files"
              aria-label="Add files"
              className="rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              +
            </button>
            <span className="flex-1 text-center text-slate-400">
              {pending ? "Uploading…" : "Drop files here"}
            </span>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={pending || files.length >= MAX_ATTACHMENTS}
              title="Browse"
              className="rounded border border-slate-600 px-3 py-0.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              …
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) upload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Images, PDF and Office documents, up to {MAX_ATTACHMENT_BYTES / 1_000_000} MB each.
          </p>
        </>
      ) : files.length === 0 ? (
        <p className="text-xs text-slate-500">No attachments.</p>
      ) : null}

      {messages.map((m) => (
        <p key={m} className="mt-1 text-xs text-red-500">{m}</p>
      ))}
    </Section>
  );
}
