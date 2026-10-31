import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Guard the independent full-chain baseline: later non-ERP migrations must survive rollback. */
describe("ERP migration verification baseline", () => {
  const script = readFileSync("scripts/erp/migration-verify.sh", "utf8");
  it("measures non-ERP tables from the complete migration chain in a disposable database", () => {
    const baseline = script.split("measure_base_tables() {")[1]?.split("\nbaseline_base_tables() {")[0];
    expect(baseline).toContain('CREATE DATABASE');
    expect(baseline).toContain('for dir in $(ls -1 "$MIGRATIONS_DIR"');
    expect(baseline).toContain('"$MIGRATIONS_DIR/$dir/migration.sql"');
    expect(baseline).not.toContain('[ "$dir" = "$ERP_MIGRATION" ] && break');
    expect(baseline).toContain("table_name not like 'Erp%'");
    expect(baseline).toContain("table_name not like 'Msg%'");
    expect(baseline).toContain('DROP DATABASE');
  });
  it("still checks non-ERP tables and existing POS data after rollback", () => {
    const rollback = script.split("rollback_and_recovery() {")[1];
    expect(rollback).toContain('$(base_table_count)');
    expect(rollback).toContain('baseline_base_tables');
    expect(rollback).toContain('POS rows survived the rollback');
    expect(rollback).toContain('ERP migrations re-applied after rollback');
  });
});
