// Creates (or resets) the application's least-privilege MySQL user.
//
// Run by scripts/create-db-app-user.sh, which supplies the master login and a
// freshly generated password through the environment. Safe to run again: it
// resets the password and re-applies exactly the same grants.
//
//   ADMIN_DATABASE_URL  master login, from the RDS-managed secret
//   APP_PASSWORD        password to give the new user
import { createConnection } from "mariadb";

const USER = "astra_app";
// Connections from inside the VPC only (172.20.0.0/16). The pods reach RDS from
// there; nothing outside the VPC can use this login even with the password.
// APP_HOST exists only so the script can be tested against a local database.
const HOST = process.env.APP_HOST ?? "172.20.%";
if (!/^[0-9A-Za-z.%_-]+$/.test(HOST)) throw new Error("APP_HOST contains unexpected characters");
const DATABASE = "astradb";

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const password = process.env.APP_PASSWORD;
  if (!adminUrl || !password) throw new Error("ADMIN_DATABASE_URL and APP_PASSWORD are required");
  if (password.length < 24) throw new Error("APP_PASSWORD is too short");

  // Discrete options, not the URL: the driver echoes a URL (password included)
  // in its parse errors, and this login is the master password.
  const u = new URL(adminUrl);
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
  try {
    await conn.query(`CREATE USER IF NOT EXISTS '${USER}'@'${HOST}' IDENTIFIED BY ?`, [password]);
    // Also covers a re-run: the user exists, so reset its password.
    await conn.query(`ALTER USER '${USER}'@'${HOST}' IDENTIFIED BY ?`, [password]);

    // Start from nothing so a re-run can never leave extra rights behind.
    await conn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${USER}'@'${HOST}'`);
    // Rows only. No CREATE, ALTER, DROP, INDEX, REFERENCES or user management:
    // the running app never changes the schema (migrations run separately).
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DATABASE}\`.* TO '${USER}'@'${HOST}'`);

    const grants = await conn.query(`SHOW GRANTS FOR '${USER}'@'${HOST}'`);
    for (const row of grants as Record<string, string>[]) console.log(Object.values(row)[0]);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  // Never print the connection URL or password.
  console.error("create-app-user failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
