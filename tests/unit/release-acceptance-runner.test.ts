import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const runner = resolve("scripts/verification/release-acceptance.mjs");

describe("fail-closed release acceptance runner", () => {
  it("does not let successful stubbed offline commands pass unverified gates or expose secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "jata-acceptance-"));
    try {
      const bin = join(root, "bin"); mkdirSync(bin);
      writeFileSync(join(bin, "npm"), '#!/bin/sh\nif [ -n "$DATABASE_URL" ] || [ -n "$PASSWORD_RESET_SMTP_URL" ] || [ -n "$R2_SECRET_ACCESS_KEY" ]; then exit 99; fi\necho "1 skipped"\nexit 0\n', { mode: 0o755 });
      const result = spawnSync(process.execPath, [runner], { cwd: root, encoding: "utf8", env: { PATH: bin, HOME: root, DATABASE_URL: "sensitive", PASSWORD_RESET_SMTP_URL: "sensitive", R2_SECRET_ACCESS_KEY: "sensitive" } });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("sensitive");
      const report = JSON.parse(result.stdout);
      expect(report.release).toBe("BLOCKED");
      expect(report.results.find((r: any) => r.criterion === "Financial reconciliation").status).toBe("INCOMPLETE");
      expect(report.results.find((r: any) => r.criterion === "Unit, integration and security regression")).toMatchObject({ status: "PASS — LIMITED", exitCode: 0 });
      expect(report.results.find((r: any) => r.criterion === "Unit, integration and security regression").evidence).toContain("skipped");
      expect(report.results.find((r: any) => r.criterion === "PostgreSQL integration").status).toBe("NOT TESTED");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("refuses a checkout with dotenv files before launching any commands", () => {
    const root = mkdtempSync(join(tmpdir(), "jata-acceptance-env-"));
    try {
      writeFileSync(join(root, ".env.local"), "do-not-read");
      const result = spawnSync(process.execPath, [runner], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("BLOCKED");
      expect(result.stdout).not.toContain("do-not-read");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
