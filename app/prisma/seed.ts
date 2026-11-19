import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}

async function main() {
  const username = process.env.SEED_OPERATOR_USERNAME;
  const password = process.env.SEED_OPERATOR_PASSWORD;
  const displayName = process.env.SEED_OPERATOR_NAME ?? username;
  const url = process.env.DATABASE_URL;

  if (!username || !password) {
    throw new Error("SEED_OPERATOR_USERNAME and SEED_OPERATOR_PASSWORD are required");
  }
  if (!url) throw new Error("DATABASE_URL is required");

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await prisma.operator.upsert({
      where: { username },
      update: { passwordHash, displayName: displayName! },
      create: { username, passwordHash, displayName: displayName! },
    });
    console.log(`Seeded operator "${username}"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
