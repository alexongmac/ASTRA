// Local-only helper: sends an all-up event so the state-based alarms auto-clear.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const { processMessage } = await import("../lib/ingest.js");

await processMessage({
  v: 1,
  ts: new Date().toISOString(),
  run_id: 1794896145985,
  machine: "r2d4",
  event: "run_resume",
  detail: null,
  state: { gear: "up", conveyor: "up", output: "up" },
  oee: 0.81,
});

console.log("fed recovery event");
process.exit(0);
