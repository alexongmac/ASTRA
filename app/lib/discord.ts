// Posts a newly raised alarm to Discord. Must never throw: a failed
// notification must not stop the alarm from being stored.
export async function notifyDiscord(alarm: {
  severity: string;
  machine: string;
  product: string | null;
  title: string;
  detail: string | null;
}) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const icon = alarm.severity === "CRITICAL" ? "🚨" : "⚠️";
  // Discord rejects messages over 2000 characters, which would drop the post.
  // 1000 leaves ample room for the title and machine lines.
  const MAX_DETAIL = 1000;
  const detail =
    alarm.detail && alarm.detail.length > MAX_DETAIL
      ? `${alarm.detail.slice(0, MAX_DETAIL)}…`
      : alarm.detail;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content:
          `${icon} **[${alarm.severity}] ${alarm.title}**\n` +
          `Machine: \`${alarm.machine}\`` +
          (alarm.product ? ` · Product: \`${alarm.product}\`` : "") +
          (detail ? `\n${detail}` : ""),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`Discord webhook returned ${res.status}`);
  } catch (err) {
    console.error("Discord webhook failed:", (err as Error).message);
  }
}
