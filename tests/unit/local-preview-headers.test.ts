/** Local Arena framing is explicit development-only opt-in; production headers cannot be weakened by its flag. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

async function config(env: Record<string, string>) {
  const context = vm.createContext({ process: { env }, module: { exports: {} } });
  vm.runInContext(readFileSync(new URL("../../next.config.js", import.meta.url), "utf8"), context);
  const cfg = context.module.exports as { headers(): Promise<any[]>; allowedDevOrigins?: string[] };
  return { headers: JSON.parse(JSON.stringify(await cfg.headers())), origins: cfg.allowedDevOrigins };
}

describe("preview framing boundary", () => {
  it.each([{}, { NODE_ENV: "production" }, { NODE_ENV: "production", ARENA_LIVE_PREVIEW: "1" }, { NODE_ENV: "development" }])("retains DENY globally and SAMEORIGIN/self only for public business pages: %j", async (env) => {
    const { headers, origins } = await config(env);
    expect(headers[0].headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(headers[1].headers).toContainEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" });
    expect(headers[1].headers).toContainEqual({ key: "Content-Security-Policy", value: "frame-ancestors 'self'" });
    expect(origins).toBeUndefined();
  });
  it("only an explicit local development flag permits Arena framing and preview HMR hosts", async () => {
    const { headers, origins } = await config({ NODE_ENV: "development", ARENA_LIVE_PREVIEW: "1" });
    expect(headers[0].headers.some((header: any) => header.key === "X-Frame-Options")).toBe(false);
    expect(headers[0].headers).toContainEqual({ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://arena.ai https://*.arena.ai" });
    expect(headers[0].headers).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
    expect(Array.from(origins || [])).toEqual(["*.e2b.app"]);
    // Owner previews retain their stricter same-origin exception even in local QA.
    expect(headers[1].headers).toContainEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" });
  });
});
