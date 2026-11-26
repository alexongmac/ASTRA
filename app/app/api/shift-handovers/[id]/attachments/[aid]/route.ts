import { auth } from "@/auth";
import { fail, guardHandover, parseBigId } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";
import { ATTACHMENT_TYPES, MAX_COMMENT, attachmentExtension } from "@/lib/shift-handover";

type Ctx = { params: Promise<{ id: string; aid: string }> };

// Download. Any signed-in operator can view a handover's files.
export async function GET(_request: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.operatorId) return fail("Unauthorized", 401);

  const { id, aid } = await params;
  const handoverId = parseBigId(id);
  const attachmentId = parseBigId(aid);
  if (handoverId === null || attachmentId === null) return fail("Not found", 404);

  const file = await prisma.shiftHandoverAttachment.findFirst({
    where: { id: attachmentId, handoverId },
  });
  if (!file) return fail("Not found", 404);

  const type = ATTACHMENT_TYPES[attachmentExtension(file.fileName)];
  const disposition = type?.inline ? "inline" : "attachment";
  // RFC 5987 encoding keeps odd file names from breaking the header.
  const name = encodeURIComponent(file.fileName);

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": type?.mime ?? "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${name}`,
      // Uploaded files are untrusted: never let the browser guess a type or run
      // anything from them.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
    },
  });
}

// Edits the comment shown next to a file.
export async function PATCH(request: Request, { params }: Ctx) {
  const { id, aid } = await params;
  const guard = await guardHandover(id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const attachmentId = parseBigId(aid);
  if (attachmentId === null) return fail("Not found", 404);

  const body = (await request.json().catch(() => null)) as { comment?: unknown } | null;
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (comment.length > MAX_COMMENT) return fail(`Comment must be ${MAX_COMMENT} characters or fewer`, 400);

  const { count } = await prisma.shiftHandoverAttachment.updateMany({
    where: { id: attachmentId, handoverId: guard.id },
    data: { comment: comment || null },
  });
  if (count === 0) return fail("Not found", 404);
  return Response.json({ status: "saved" });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, aid } = await params;
  const guard = await guardHandover(id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const attachmentId = parseBigId(aid);
  if (attachmentId === null) return fail("Not found", 404);

  await prisma.shiftHandoverAttachment.deleteMany({ where: { id: attachmentId, handoverId: guard.id } });
  return Response.json({ status: "removed" });
}
