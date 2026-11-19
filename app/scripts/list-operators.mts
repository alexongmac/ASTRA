import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

async function main() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) loadEnvFile(f);
  const p = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

  const operators = await p.operator.findMany({
    orderBy: { id: "asc" },
    include: { _count: { select: { acknowledgedAlarms: true } } },
  });

  for (const o of operators) {
    console.log(
      `id=${o.id} username=${o.username} name="${o.displayName}" ` +
        `acknowledged_alarms=${o._count.acknowledgedAlarms} created=${o.createdAt.toISOString()}`,
    );
  }
  if (operators.length === 0) console.log("(no operators)");

  await p.$disconnect();
}

main();
