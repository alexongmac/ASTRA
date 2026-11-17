import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { defineConfig, env } from "@prisma/config";

// Prisma 7 no longer reads .env itself; the CLI needs these in the process env.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
