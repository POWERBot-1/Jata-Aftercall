/**
 * Prisma client singleton with offline fallback for E2B build verification.
 * In production (Vercel) `prisma generate` succeeds and the real client is used.
 * In offline E2B (binaries.prisma.sh blocked), we fall back to a no-op proxy
 * so that `next build` can complete. Dynamic routes handle DB errors gracefully
 * and are marked `force-dynamic` to avoid prerender-time DB access.
 */

import { allowStubPrismaClient } from "./prismaRuntime";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: any | undefined;
}

let prismaInstance: any;

function createFallbackPrisma(): any {
  // Minimal stub that satisfies the Prisma API used in the app but returns empty data.
  // All methods return sensible defaults so build and unit tests pass without a DB.
  const stub = {
    $queryRaw: async () => [{ "?column?": 1 }],
    $disconnect: async () => {},
    user: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available (fallback)"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    business: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    businessMember: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    service: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
    },
    offer: {
      findUnique: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      delete: async () => {},
    },
    analyticsEvent: {
      create: async () => ({ id: "mock" }),
      findMany: async () => [],
      groupBy: async () => [],
      count: async () => 0,
    },
    planConfig: {
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    subscription: {
      findUnique: async () => null,
      findMany: async () => [],
      findFirst: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    payment: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
      aggregate: async () => ({ _sum: { amount: 0 } }),
    },
    auditEvent: {
      create: async () => ({ id: "mock" }),
    },
    processedWebhook: {
      findUnique: async () => null,
      upsert: async () => ({ id: "mock" }),
      create: async () => ({ id: "mock" }),
    },
    pageTheme: {
      upsert: async () => ({ id: "mock" }),
      findMany: async () => [],
    },
    $transaction: async () => {
      throw new Error("DB not available (fallback)");
    },
  };
  return stub;
}

function createRealPrisma(): any {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    // eslint-disable-next-line
    const { PrismaClient } = require("@prisma/client");
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
    return client;
  } catch (e) {
    if (!allowStubPrismaClient(databaseUrl)) {
      console.error("[db] Prisma client unavailable while DATABASE_URL is configured. Refusing stub fallback.");
      throw e;
    }
    console.warn("PrismaClient not available (offline fallback active):", (e as Error).message);
    return createFallbackPrisma();
  }
}

if (globalThis.__prisma) {
  prismaInstance = globalThis.__prisma;
} else {
  prismaInstance = createRealPrisma();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = prismaInstance;
  }
}

export const prisma = prismaInstance;
export default prisma;
