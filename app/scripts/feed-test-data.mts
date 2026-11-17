// Local-only helper: pushes sample MQTT payloads through the ingest path so the
// dashboard has alarms to show without a live IoT feed.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const { processMessage } = await import("../lib/ingest.js");

const base = { v: 1, run_id: 1794896145985, machine: "r2d4" };

await processMessage({
  ...base,
  ts: new Date().toISOString(),
  event: "gear_stop",
  detail: null,
  state: { gear: "down", conveyor: "down", output: "down" },
  oee: 0.42,
});

await processMessage({
  ...base,
  ts: new Date().toISOString(),
  product: "567",
  availability: 93.1,
  performance: 92.9,
  quality: 78.6,
  oee: 61.2,
  total: 934,
  good: 734,
  defect: 200,
  elapsed_s: 7564,
  downtime_s: 68,
  setup_s: 133,
  runtime_s: 7363,
  planned_time_min: 480,
  ideal_cycle_s: 7,
});

console.log("fed 2 messages");
process.exit(0);
