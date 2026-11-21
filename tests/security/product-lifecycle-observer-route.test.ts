import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/admin/product-expiry-grace-observation-store", () => ({ loadProductExpiryGraceObservation: m.load }));
import { GET } from "@/app/api/cron/product-lifecycle-observer/route";

const original = { ...process.env };
const secret = "synthetic-lifecycle-observer-secret-0123456789";
const request = (auth = `Bearer ${secret}`, query = "") =>
  new Request(`https://internal.test/api/cron/product-lifecycle-observer${query}`, { headers: { authorization: auth } });

describe("disabled-by-default product lifecycle observer endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRODUCT_LIFECYCLE_OBSERVER_ENABLED = "true";
    process.env.PRODUCT_LIFECYCLE_OBSERVER_SECRET = secret;
    m.load.mockResolvedValue({
      observedAt: "2026-11-22T12:00:00.000Z", total: 1,
      counts: { CURRENT: 1, GRACE: 0, EXPIRED: 0, GRACE_POLICY_UNKNOWN: 0, INVALID_GRACE_WINDOW: 0, INACTIVE: 0, NO_EXPIRY: 0 },
      complete: true, pageSizePerProductTable: 50, nextCursors: {},
    });
  });
  afterEach(() => { process.env = { ...original }; });

  it("fails closed when disabled or secret is weak", async () => {
    delete process.env.PRODUCT_LIFECYCLE_OBSERVER_ENABLED;
    expect((await GET(request())).status).toBe(503);
    process.env.PRODUCT_LIFECYCLE_OBSERVER_ENABLED = "true";
    process.env.PRODUCT_LIFECYCLE_OBSERVER_SECRET = "short";
    expect((await GET(request())).status).toBe(503);
    expect(m.load).not.toHaveBeenCalled();
  });

  it("rejects incorrect authorization before reading data", async () => {
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(m.load).not.toHaveBeenCalled();
  });

  it("validates bounded page sizes and cursor payloads", async () => {
    expect((await GET(request(undefined, "?limit=101"))).status).toBe(400);
    expect((await GET(request(undefined, "?limit=0"))).status).toBe(400);
    expect((await GET(request(undefined, "?cursor=not-base64-json"))).status).toBe(400);
    expect(m.load).not.toHaveBeenCalled();
  });

  it("returns aggregate read-only evidence and disables caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.execution).toBe("READ_ONLY_OBSERVATION");
    expect(body.accessChanges).toBe("NONE");
    expect(body.total).toBe(1);
    expect(body.nextCursor).toBeNull();
    expect(body).not.toHaveProperty("observations");
    expect(m.load).toHaveBeenCalledWith({ limit: 50, cursors: {} });
  });

  it("passes bounded cursors for resumable pages", async () => {
    const cursor = Buffer.from(JSON.stringify({ pos: "pos_100" })).toString("base64url");
    m.load.mockResolvedValueOnce({
      observedAt: "2026-11-22T12:00:00.000Z", total: 0,
      counts: { CURRENT: 0, GRACE: 0, EXPIRED: 0, GRACE_POLICY_UNKNOWN: 0, INVALID_GRACE_WINDOW: 0, INACTIVE: 0, NO_EXPIRY: 0 },
      complete: false, pageSizePerProductTable: 25, nextCursors: { pos: "pos_200" },
    });
    const response = await GET(request(undefined, `?limit=25&cursor=${cursor}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.complete).toBe(false);
    expect(Buffer.from(body.nextCursor, "base64url").toString("utf8")).toBe(JSON.stringify({ pos: "pos_200" }));
    expect(m.load).toHaveBeenCalledWith({ limit: 25, cursors: { pos: "pos_100" } });
  });

  it("does not expose internal errors", async () => {
    m.load.mockRejectedValueOnce(new Error("private database detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});
