import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/pos-erp-verify.yml", "utf8");

describe("POS/ERP disposable migration rehearsal", () => {
  it("uses client tools from the same PostgreSQL major as the service", () => {
    const serviceMajor = workflow.match(/image:\s*postgres:(\d+)/)?.[1];
    const clientMajor = workflow.match(/postgres:(\d+) bash scripts\/erp\/migration-verify\.sh all/)?.[1];
    expect(serviceMajor).toBeDefined();
    expect(clientMajor).toBe(serviceMajor);
    expect(workflow).toContain('-v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE:ro"');
  });
  it("preserves verifier exit, failure summaries, and the explicit pass gate", () => {
    expect(workflow).toContain("set -o pipefail");
    expect(workflow).toContain('tee ci-logs/migration-verify.log || status=$?');
    expect(workflow).toContain('[ "$status" -ne 0 ]');
    expect(workflow).toContain("grep -q '^FAIL'");
    expect(workflow).toContain("grep -q 'RESULT: PASS'");
  });
});
