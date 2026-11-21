import { describe, expect, it } from "vitest";
import { canonicalizePgNodeTree } from "../../scripts/ci/normalize-pg-node-tree.mjs";

describe("PostgreSQL CHECK node-tree canonicalization", () => {
  it("flattens associative nested AND nodes", () => {
    const nested = "{BOOLEXPR :boolop and :args ({OPEXPR :opno 1} {BOOLEXPR :boolop and :args ({OPEXPR :opno 2} {OPEXPR :opno 3}) :location -1}) :location -1}";
    const flat = "{BOOLEXPR :boolop and :args ({OPEXPR :opno 1} {OPEXPR :opno 2} {OPEXPR :opno 3}) :location -1}";
    expect(canonicalizePgNodeTree(nested)).toBe(canonicalizePgNodeTree(flat));
  });
  it("flattens associative OR nodes but does not conflate AND and OR", () => {
    const nested = "{BOOLEXPR :boolop or :args ({OPEXPR :opno 1} {BOOLEXPR :boolop or :args ({OPEXPR :opno 2} {OPEXPR :opno 3})})}";
    const flat = "{BOOLEXPR :boolop or :args ({OPEXPR :opno 1} {OPEXPR :opno 2} {OPEXPR :opno 3})}";
    const and = "{BOOLEXPR :boolop and :args ({OPEXPR :opno 1} {OPEXPR :opno 2} {OPEXPR :opno 3})}";
    expect(canonicalizePgNodeTree(nested)).toBe(canonicalizePgNodeTree(flat));
    expect(canonicalizePgNodeTree(nested)).not.toBe(canonicalizePgNodeTree(and));
  });
  it("preserves nested opposite operators and non-boolean node structure", () => {
    const a = "{BOOLEXPR :boolop and :args ({OPEXPR :opno 1} {BOOLEXPR :boolop or :args ({OPEXPR :opno 2} {OPEXPR :opno 3})})}";
    const b = "{BOOLEXPR :boolop and :args ({OPEXPR :opno 1} {OPEXPR :opno 2} {OPEXPR :opno 3})}";
    expect(canonicalizePgNodeTree(a)).not.toBe(canonicalizePgNodeTree(b));
  });
});
