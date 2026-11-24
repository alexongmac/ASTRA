import { auth } from "@/auth";
import { parseLogInput } from "@/lib/operator-logs";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.operatorId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseLogInput(await request.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const log = await prisma.operatorLog.create({
    data: { ...parsed.data, createdById: session.user.operatorId },
  });
  return Response.json({ id: String(log.id) }, { status: 201 });
}
