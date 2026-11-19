import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

async function main() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) loadEnvFile(f);
  const p = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

  console.log("machine_events:", await p.machineEvent.count());
  console.log("oee_summaries :", await p.oeeSummary.count());
  console.log("alarms        :", await p.alarm.count());

  console.log("--- alarms (latest 10) ---");
  for (const x of await p.alarm.findMany({ orderBy: { raisedAt: "desc" }, take: 10 })) {
    console.log(` [${x.severity}] ${x.status.padEnd(12)} ${x.ruleKey.padEnd(22)} ${x.machine} :: ${x.title}`);
  }

  console.log("--- latest summaries ---");
  for (const x of await p.oeeSummary.findMany({ orderBy: { id: "desc" }, take: 3 })) {
    console.log(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  }

  console.log("--- latest events ---");
  for (const x of await p.machineEvent.findMany({ orderBy: { id: "desc" }, take: 3 })) {
    console.log(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  }

  await p.$disconnect();
}

main();
