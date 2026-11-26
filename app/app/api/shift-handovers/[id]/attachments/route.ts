import { fail, guardHandover } from "@/lib/handover-api";
import { prisma } from "@/lib/prisma";
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  attachmentExtension,
} from "@/lib/shift-handover";

type Ctx = { params: Promise<{ id: string }> };

// Accepts one or more files (form field "files"). Each is checked on its own;
// the response lists what was stored and what was refused, and why.
export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardHandover((await params).id, { needEditable: true });
  if ("response" in guard) return guard.response;

  const form = await request.formData().catch(() => null);
  if (!form) return fail("Invalid upload", 400);
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail("No file received", 400);

  let existing = await prisma.shiftHandoverAttachment.count({ where: { handoverId: guard.id } });
  const added: string[] = [];
  const refused: { name: string; reason: string }[] = [];

  for (const file of files) {
    const ext = attachmentExtension(file.name);
    const type = ATTACHMENT_TYPES[ext];
    if (!type) {
      refused.push({ name: file.name, reason: "File type not allowed" });
    } else if (file.size === 0) {
      refused.push({ name: file.name, reason: "File is empty" });
    } else if (file.size > MAX_ATTACHMENT_BYTES) {
      refused.push({ name: file.name, reason: `Larger than ${MAX_ATTACHMENT_BYTES / 1_000_000} MB` });
    } else if (existing >= MAX_ATTACHMENTS) {
      refused.push({ name: file.name, reason: `No more than ${MAX_ATTACHMENTS} files per handover` });
    } else {
      await prisma.shiftHandoverAttachment.create({
        data: {
          handoverId: guard.id,
          fileName: file.name.slice(0, 255),
          mimeType: type.mime,
          size: file.size,
          data: new Uint8Array(await file.arrayBuffer()),
        },
      });
      existing += 1;
      added.push(file.name);
    }
  }

  return Response.json({ added, refused }, { status: added.length > 0 ? 201 : 400 });
}
