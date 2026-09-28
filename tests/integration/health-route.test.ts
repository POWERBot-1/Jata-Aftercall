import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { $queryRaw: mocks.queryRaw } }));

import { GET } from "@/app/health/route";

const originalDatabaseUrl = process.env.DATABASE_URL;
const CONFIGURED_URL = "postgresql://user:password@db.internal:5432/jata?schema=public";

async function callHealth() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("GET /health database status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("never claims db:up when DATABASE_URL is unset, even if the offline stub resolves", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const { body } = await callHealth();
    expect(body).toMatchObject({ status: "degraded", db: "unconfigured" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("treats a blank DATABASE_URL as unconfigured", async () => {
    process.env.DATABASE_URL = "   ";
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const { body } = await callHealth();
    expect(body).toMatchObject({ status: "degraded", db: "unconfigured" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("reports db:up when a configured database answers", async () => {
    process.env.DATABASE_URL = CONFIGURED_URL;
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", db: "up", version: "1.0.0" });
  });

  it("reports db:down when a configured database is unreachable", async () => {
    process.env.DATABASE_URL = CONFIGURED_URL;
    mocks.queryRaw.mockRejectedValue(new Error("Can't reach database server"));
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "degraded", db: "down", version: "1.0.0" });
  });

  it("never echoes the configured connection string in the response", async () => {
    process.env.DATABASE_URL = CONFIGURED_URL;
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const { body } = await callHealth();
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });
});
