import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

async function main() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) loadEnvFile(f);
  const p = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

  const [events, summaries, open] = await Promise.all([
    p.machineEvent.count(),
    p.oeeSummary.count(),
    p.alarm.findMany({
      where: { status: { in: ["raised", "acknowledged"] } },
      orderBy: { raisedAt: "desc" },
    }),
  ]);

  const parts = open.map((a) => `${a.ruleKey}/${a.severity}/${a.status}`).join(",");
  console.log(`events=${events} summaries=${summaries} open=${open.length}${parts ? ` [${parts}]` : ""}`);

  await p.$disconnect();
}

main();
