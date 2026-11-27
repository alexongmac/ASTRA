// Creates (or resets) the application's two least-privilege MySQL accounts:
// astra_app and astra_app_clone, with identical rights.
//
// The password rotation (29-db-app-rotation.tf) alternates between them: each
// month it changes the password of the account that is NOT in use, logging in
// as that account itself, so it never needs the master login. Creating the two
// accounts and giving them their rights is the one step that does need the
// master login, so it happens here, run by a person.
//
// Run by scripts/create-db-app-user.sh, which supplies the master login and two
// freshly generated passwords through the environment. Safe to run again: it
// resets both passwords and re-applies exactly the same rights.
//
//   ADMIN_DATABASE_URL  master login, from the RDS-managed secret
//   APP_PASSWORD        password for astra_app
//   CLONE_PASSWORD      password for astra_app_clone
import { createConnection } from "mariadb";

const USERS = ["astra_app", "astra_app_clone"] as const;
// Connections from inside the VPC only (172.20.0.0/16). The pods reach RDS from
// there; nothing outside the VPC can use these logins even with the password.
// APP_HOST exists only so the script can be tested against a local database.
const HOST = process.env.APP_HOST ?? "172.20.%";
if (!/^[0-9A-Za-z.%_-]+$/.test(HOST)) throw new Error("APP_HOST contains unexpected characters");
const DATABASE = "astradb";

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const passwords: Record<(typeof USERS)[number], string | undefined> = {
    astra_app: process.env.APP_PASSWORD,
    astra_app_clone: process.env.CLONE_PASSWORD,
  };
  if (!adminUrl) throw new Error("ADMIN_DATABASE_URL is required");
  for (const user of USERS) {
    const password = passwords[user];
    if (!password || password.length < 24) throw new Error(`A password of at least 24 characters is required for ${user}`);
  }
  if (passwords.astra_app === passwords.astra_app_clone) throw new Error("The two passwords must differ");

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
    for (const user of USERS) {
      const password = passwords[user];
      await conn.query(`CREATE USER IF NOT EXISTS '${user}'@'${HOST}' IDENTIFIED BY ?`, [password]);
      // Also covers a re-run: the user exists, so reset its password.
      await conn.query(`ALTER USER '${user}'@'${HOST}' IDENTIFIED BY ?`, [password]);

      // Start from nothing so a re-run can never leave extra rights behind.
      await conn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${user}'@'${HOST}'`);
      // Rows only. No CREATE, ALTER, DROP, INDEX, REFERENCES or user management:
      // the running app never changes the schema (migrations run separately).
      await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DATABASE}\`.* TO '${user}'@'${HOST}'`);

      const grants = await conn.query(`SHOW GRANTS FOR '${user}'@'${HOST}'`);
      for (const row of grants as Record<string, string>[]) console.log(Object.values(row)[0]);
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  // Never print the connection URL or password.
  console.error("create-app-user failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
