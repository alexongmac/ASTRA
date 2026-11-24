import { DEFAULT_AREAS } from "@/lib/operator-logs";
import { prisma } from "@/lib/prisma";

// Defaults plus every machine that has raised an alarm, so a new machine shows
// up in the Area list without a code change. Falls back to the defaults if the
// lookup fails.
export async function loadAreas(): Promise<string[]> {
  try {
    const rows = await prisma.alarm.findMany({ distinct: ["machine"], select: { machine: true } });
    return [...new Set([...DEFAULT_AREAS, ...rows.map((r) => r.machine)])].sort();
  } catch {
    return DEFAULT_AREAS;
  }
}
