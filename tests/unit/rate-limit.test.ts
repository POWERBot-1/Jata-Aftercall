import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function request(forwarded?: string, realIp?: string) {
  const headers = new Headers();
  if (forwarded !== undefined) headers.set("x-forwarded-for", forwarded);
  if (realIp !== undefined) headers.set("x-real-ip", realIp);
  return new Request("https://jata.test/api/test", { headers });
}

describe("shared rate-limit client identity", () => {
  it("does not trust caller-supplied forwarding headers outside Vercel", async () => {
    vi.stubEnv("VERCEL", "0");
    const key = `rate-limit-untrusted-${randomUUID()}`;
    const first = rateLimit(request("198.51.100.10"), { key, max: 1, windowMs: 60_000 });
    const second = rateLimit(request("198.51.100.11", "203.0.113.50"), { key, max: 1, windowMs: 60_000 });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("uses a syntactically valid leftmost X-Forwarded-For address inside Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const key = `rate-limit-vercel-${randomUUID()}`;
    const first = rateLimit(request("198.51.100.10, 10.0.0.1"), { key, max: 1, windowMs: 60_000 });
    const otherAddress = rateLimit(request("198.51.100.11, 10.0.0.1"), { key, max: 1, windowMs: 60_000 });
    const repeatedAddress = rateLimit(request("198.51.100.10, 192.168.1.1"), { key, max: 1, windowMs: 60_000 });
    expect(first.allowed).toBe(true);
    expect(otherAddress.allowed).toBe(true);
    expect(repeatedAddress.allowed).toBe(false);
  });

  it("ignores X-Real-IP and groups invalid/missing forwarding identity into a fail-closed bucket", () => {
    vi.stubEnv("VERCEL", "1");
    const key = `rate-limit-invalid-${randomUUID()}`;
    const first = rateLimit(request("not-an-ip", "198.51.100.10"), { key, max: 1, windowMs: 60_000 });
    const second = rateLimit(request(undefined, "198.51.100.11"), { key, max: 1, windowMs: 60_000 });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("starts a new window after expiry", () => {
    vi.stubEnv("VERCEL", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T20:00:00.000Z"));
    const key = `rate-limit-expiry-${randomUUID()}`;
    expect(rateLimit(request("198.51.100.20"), { key, max: 1, windowMs: 1_000 }).allowed).toBe(true);
    expect(rateLimit(request("198.51.100.20"), { key, max: 1, windowMs: 1_000 }).allowed).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(rateLimit(request("198.51.100.20"), { key, max: 1, windowMs: 1_000 }).allowed).toBe(true);
  });
});
