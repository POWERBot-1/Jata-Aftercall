import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error("redirect"), { path }); } }));
import LoginPage from "@/app/login/page";

describe("login redirect allowlist", () => {
  it("allows the agent status destination for an existing session", async () => {
    mocks.session.mockResolvedValue({ userId: "account-a" });
    await expect(LoginPage({ searchParams: Promise.resolve({ next: "agents" }) })).rejects.toMatchObject({ path: "/agents/dashboard" });
  });
  it.each(["https://evil.test", "//evil.test", "/agents/dashboard", ["agents", "https://evil.test"]])("rejects untrusted next value %j", async (next) => {
    mocks.session.mockResolvedValue({ userId: "account-a" });
    await expect(LoginPage({ searchParams: Promise.resolve({ next }) })).rejects.toMatchObject({ path: "/dashboard" });
  });
});
