// Posts an alarm event to Discord: a newly raised alarm, or (cleared: true) one
// that has just cleared. Must never throw: a failed notification must not stop
// the alarm from being stored or cleared.
export async function notifyDiscord(alarm: {
  severity: string;
  machine: string;
  product: string | null;
  title: string;
  detail: string | null;
  cleared?: boolean;
  // Only used for cleared messages, to say how long the alarm was open.
  raisedAt?: Date;
}) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const icon = alarm.cleared ? "✅" : alarm.severity === "CRITICAL" ? "🚨" : "⚠️";
  const label = alarm.cleared ? "CLEARED" : alarm.severity;
  // Discord rejects messages over 2000 characters, which would drop the post.
  // 1000 leaves ample room for the title and machine lines.
  const MAX_DETAIL = 1000;
  const detail =
    alarm.detail && alarm.detail.length > MAX_DETAIL
      ? `${alarm.detail.slice(0, MAX_DETAIL)}…`
      : alarm.detail;
  const openFor =
    alarm.cleared && alarm.raisedAt
      ? `\nWas open for ${formatDuration(Date.now() - alarm.raisedAt.getTime())}`
      : "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content:
          `${icon} **[${label}] ${alarm.title}**\n` +
          `Machine: \`${alarm.machine}\`` +
          (alarm.product ? ` · Product: \`${alarm.product}\`` : "") +
          (detail ? `\n${detail}` : "") +
          openFor,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`Discord webhook returned ${res.status}`);
  } catch (err) {
    console.error("Discord webhook failed:", (err as Error).message);
  }
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
