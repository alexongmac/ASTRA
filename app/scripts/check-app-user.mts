// Confirms the application's MySQL login can read and write rows but cannot
// change the schema or manage users. Safe to run: it only reads, and the two
// forbidden statements are expected to be refused. If either is NOT refused,
// the probe table or user it just created is removed again and the script fails.
// No statement touches a real table.
//
//   APP_DATABASE_URL  the astra_app login (mysql://astra_app:...@host:3306/astradb)
import { createConnection } from "mariadb";

async function expectDenied(
  conn: Awaited<ReturnType<typeof createConnection>>,
  label: string,
  sql: string,
  cleanup: string,
) {
  try {
    await conn.query(sql);
    // It worked, which it should not have: remove what it just created.
    await conn.query(cleanup).catch(() => undefined);
  } catch (error) {
    const code = (error as { errno?: number }).errno;
    // 1044/1142/1227: access denied to database, table or operation.
    if (code === 1044 || code === 1142 || code === 1227) {
      console.log(`ok   denied: ${label}`);
      return true;
    }
    throw error;
  }
  console.log(`FAIL allowed: ${label}`);
  return false;
}

async function main() {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is required");
  // Discrete options, not the URL: the driver echoes a URL (password included)
  // in its parse errors.
  const u = new URL(url);
  const conn = await createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    // MySQL 8's default login plugin needs this when the connection is not TLS
    // (here: a kubectl port-forward inside the cluster network).
    allowPublicKeyRetrieval: true,
  });
  let passed = true;
  try {
    const [who] = (await conn.query("SELECT CURRENT_USER() AS u, DATABASE() AS d")) as { u: string; d: string }[];
    console.log(`connected as ${who.u} to ${who.d}`);

    const [{ n }] = (await conn.query("SELECT COUNT(*) AS n FROM operators")) as { n: bigint }[];
    console.log(`ok   allowed: SELECT (operators has ${n} rows)`);

    const grants = (await conn.query("SHOW GRANTS")) as Record<string, string>[];
    for (const g of grants) console.log("grant:", Object.values(g)[0]);

    passed =
      (await expectDenied(conn, "CREATE TABLE", "CREATE TABLE __priv_probe (id INT)", "DROP TABLE __priv_probe")) &&
      passed;
    passed =
      (await expectDenied(
        conn,
        "CREATE USER",
        "CREATE USER 'priv_probe'@'%' IDENTIFIED BY 'x'",
        "DROP USER 'priv_probe'@'%'",
      )) && passed;
  } finally {
    await conn.end();
  }
  if (!passed) {
    console.error("The app login has more rights than intended.");
    process.exit(1);
  }
  console.log("PASS: row access only");
}

main().catch((error) => {
  console.error("check-app-user failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
