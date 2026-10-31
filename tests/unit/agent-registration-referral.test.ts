import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
import { newReferralToken, referralTokenHash, referralLifetimeSeconds } from "@/lib/agents/referral-registration";
import { POST } from "@/app/api/agents/referrals/route";
const previous = { ...process.env };
afterEach(() => { process.env = { ...previous }; vi.resetAllMocks(); });
const req = (origin = "https://example.test") => new Request("https://example.test/api/agents/referrals", { method: "POST", headers: { host: "example.test", origin } });
describe("registration referral safety", () => {
  it("requires an explicit enabled bounded link lifetime", () => {
    delete process.env.AGENT_REGISTRATION_REFERRALS_ENABLED; expect(referralLifetimeSeconds()).toBeNull();
    process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; delete process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS; expect(referralLifetimeSeconds()).toBeNull();
    process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600"; expect(referralLifetimeSeconds()).toBe(3600);
    process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "99999999"; expect(referralLifetimeSeconds()).toBeNull();
  });
  it("generates high entropy URL-safe tokens and stores only a hash", () => {
    const a = newReferralToken(); const b = newReferralToken(); expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b);
    expect(referralTokenHash(a)).toMatch(/^[a-f0-9]{64}$/); expect(referralTokenHash("bad")).toBeNull();
  });
  it("denies cross-origin, anonymous and disabled requests before database use", async () => {
    expect((await POST(req("https://evil.test"))).status).toBe(403);
    mocks.session.mockResolvedValueOnce(null).mockResolvedValue({ userId: "fixture" });
    expect((await POST(req())).status).toBe(401);
    delete process.env.AGENT_REGISTRATION_REFERRALS_ENABLED;
    expect((await POST(req())).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
