import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

async function main() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) loadEnvFile(f);
  const p = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

  for (const a of await p.alarm.findMany({ orderBy: { id: "asc" } })) {
    console.log(
      `id=${a.id} ${a.severity.padEnd(8)} ${a.status.padEnd(12)} ${a.ruleKey.padEnd(22)} ` +
        `raised=${a.raisedAt.toISOString()} ack=${a.acknowledgedAt?.toISOString() ?? "-"} cleared=${a.clearedAt?.toISOString() ?? "-"}`,
    );
  }

  await p.$disconnect();
}

main();
