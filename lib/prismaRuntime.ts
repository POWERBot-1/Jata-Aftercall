/**
 * Stub Prisma is only for preview/offline builds where DATABASE_URL is absent.
 * A configured DATABASE_URL must never silently fall back to the stub client.
 */
export function allowStubPrismaClient(databaseUrl: string | undefined | null): boolean {
  return databaseUrl == null || String(databaseUrl).trim() === "";
}
