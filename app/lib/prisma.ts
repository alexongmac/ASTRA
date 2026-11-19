import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

// Proxied so the client is built on first query rather than at import time:
// the production build imports these modules without a database available.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = (globalForPrisma.prisma ??= createClient());
    return Reflect.get(client, property, receiver);
  },
});
