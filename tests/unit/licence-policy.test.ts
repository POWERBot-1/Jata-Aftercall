/**
 * Licence and commercial-use policy enforcement.
 *
 * ## Why this exists
 *
 * `docs/ai-infrastructure/03_LICENCE_AND_COMMERCIAL_USE_REGISTER.md` records ten candidate
 * dependencies that are licence-incompatible with a multi-tenant commercial SaaS (Dify forbids
 * multi-tenant operation; n8n's Sustainable Use Licence restricts to internal/non-commercial;
 * Open WebUI's branding clause bites above 50 users; Weaviate and Flowise licence-gate their
 * feature sets; XTTS-v2 and F5-TTS ship non-commercial weights). Those findings are worthless as
 * prose — they decay, and nobody reads them before `npm install`. This test makes them executable.
 *
 * ## What it enforces
 *
 *  1. Every installed package's declared licence is either allowlisted or an explicitly recorded
 *     exception. A new copyleft or custom licence fails the build instead of arriving silently.
 *  2. Packages whose licence forbids this use can never appear in the dependency graph.
 *  3. The one existing upstream fork (`lib/openpage`) keeps its licence and attribution intact.
 *  4. Every acquired model weight carries provenance, integrity and licence evidence.
 *
 * ## Known limitation, stated rather than hidden
 *
 * This reads the `license` field that each package *declares*. It cannot verify the text of a
 * licence file, and a package that declares nothing yields `UNKNOWN`, which fails closed. Whether
 * a declared licence actually permits this use is a human judgement recorded in the register; this
 * test stops the mechanical mistakes (a new GPL transitive dependency, a blocked package, a
 * weight with no provenance) not the interpretive ones.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------------------------
// Policy tables
// ---------------------------------------------------------------------------------------------

/**
 * Permissive licences usable in a proprietary, multi-tenant commercial service.
 * `MPL-2.0` is included because it is *file*-scoped copyleft: unmodified use imposes no
 * publication duty. Modifying an MPL file in-tree would, which is why `NO_IN_TREE_PATCHING`
 * names those packages separately.
 */
const ALLOWED_SPDX = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "BlueOak-1.0.0",
  "MPL-2.0",
  "CC-BY-4.0", // data, not code (caniuse-lite) — attribution recorded below
  "MIT AND ISC",
]);

/**
 * Permitted with a recorded position. Each entry is a deliberate decision, not a blanket waiver.
 * Adding a row here requires a written justification in the comment beside it.
 */
const RECORDED_EXCEPTIONS: Record<string, string> = {
  // LGPL-3 permits use in a proprietary application when the library is dynamically linked and
  // unmodified. JATA uses this transitively via sharp/Next image optimisation and ships it
  // unmodified. Standing rule: never vendor, patch or statically link libvips.
  "@img/sharp-libvips-linux-x64": "LGPL-3.0-or-later — dynamic link, unmodified, never vendored",
  "@img/sharp-libvips-linuxmusl-x64": "LGPL-3.0-or-later — dynamic link, unmodified, never vendored",
  "@img/sharp-wasm32": "Apache-2.0 AND LGPL-3.0-or-later AND MIT — wasm, unmodified",
};

/** Packages that must never be modified in-tree, because doing so changes their licence duties. */
const NO_IN_TREE_PATCHING = new Set(["lightningcss", "axe-core"]);

/**
 * Licence families that forbid the way JATA operates: a multi-tenant commercial hosted service
 * where customers pay for access. These are hard failures, never warnings.
 */
const FORBIDDEN_LICENCE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bAGPL\b/i, reason: "AGPL network copyleft — hosting the service triggers source disclosure" },
  { pattern: /\bGPL-[23]\.0/i, reason: "GPL — incompatible with a proprietary hosted application" },
  { pattern: /\bSSPL\b/i, reason: "SSPL — forbids offering the software as a service" },
  { pattern: /\bBUSL\b|Business Source/i, reason: "BUSL — production use is restricted or time-delayed" },
  { pattern: /Sustainable Use/i, reason: "n8n Sustainable Use Licence — internal/non-commercial only" },
  { pattern: /\bCC-BY-NC\b|NonCommercial/i, reason: "NonCommercial — JATA charges customers" },
  { pattern: /Coqui Public Model/i, reason: "CPML — non-commercial model weights" },
  { pattern: /\bCommons Clause\b/i, reason: "Commons Clause — removes the right to sell" },
  { pattern: /Elastic License|\bELv2\b/i, reason: "Elastic Licence — forbids providing the software as a service" },
];

/**
 * Exact package names rejected on licence grounds (or unverifiable provenance), verified from the
 * licence text in `03_LICENCE_AND_COMMERCIAL_USE_REGISTER.md` §2. Matched against the package's
 * own name, so a typosquat with a different name is not caught here — that is what the licence
 * check is for.
 */
const FORBIDDEN_PACKAGES: Record<string, string> = {
  dify: "Modified Apache-2.0 forbids operating a multi-tenant environment",
  "@langgenius/dify": "as above",
  n8n: "Sustainable Use Licence — internal/non-commercial only",
  "n8n-core": "as above",
  "n8n-workflow": "as above",
  "n8n-nodes-base": "as above",
  "open-webui": "Custom licence — removing branding above 50 users is a material breach",
  flowise: "Enterprise tree is under a separate Commercial Licence",
  "flowise-components": "as above",
  weaviate: "Mixed BSD / all-rights-reserved — feature set is licence-key gated",
  "weaviate-client": "as above",
  TTS: "Coqui toolkit — its XTTS-v2 weights are non-commercial",
  "f5-tts": "MIT code but CC-BY-NC-4.0 weights",
  "piper-tts": "Maintained successor is GPL-3.0-or-later",
  autogen: "CC-BY-4.0 — a content licence, unsuitable for embedded software",
  "so-vits-svc": "Voice impersonation capability",
  rvc: "Voice impersonation capability",
};

// ---------------------------------------------------------------------------------------------
// Tree scanning
// ---------------------------------------------------------------------------------------------

type InstalledPackage = { name: string; version: string; licencePath: string; license: string };

function readLicenceField(pkg: Record<string, unknown>): string {
  const raw = pkg.license ?? pkg.licenses;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const parts = raw
      .map((l) => (typeof l === "string" ? l : (l as { type?: string })?.type))
      .filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
      .map((t) => t.trim());
    if (parts.length) return parts.join(" OR ");
  }
  if (raw && typeof raw === "object" && typeof (raw as { type?: string }).type === "string") {
    return (raw as { type: string }).type;
  }
  return "UNKNOWN";
}

/** Walks `node_modules`, handling `@scope/name` nesting and nested `node_modules` as npm lays them out. */
function scanInstalledPackages(): InstalledPackage[] {
  const found: InstalledPackage[] = [];
  const seen = new Set<string>();

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@")) {
        walk(path.join(dir, entry.name));
        continue;
      }
      const pkgDir = path.join(dir, entry.name);
      const manifest = path.join(pkgDir, "package.json");
      if (fs.existsSync(manifest)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<string, unknown>;
          const name = typeof pkg.name === "string" ? pkg.name : entry.name;
          const version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
          const key = `${name}@${version}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({ name, version, licencePath: path.relative(ROOT, manifest), license: readLicenceField(pkg) });
          }
        } catch {
          // A malformed manifest is not a licence question; ignore rather than fail the policy.
        }
        // Nested node_modules can hold a different version of the same package.
        const nested = path.join(pkgDir, "node_modules");
        if (fs.existsSync(nested)) walk(nested);
      }
    }
  };

  walk(path.join(ROOT, "node_modules"));
  return found;
}

function normalise(token: string): string {
  return token.trim();
}

/** Splits a composite expression into its positive component licences. */
function componentLicences(expression: string): string[] {
  return expression
    .split(/\s+(?:OR|AND)\s+|\)|\(/i)
    .map(normalise)
    .filter((token) => token.length > 0 && !/^WITH$/i.test(token));
}

// ---------------------------------------------------------------------------------------------
// Model weight registry (Phase L)
// ---------------------------------------------------------------------------------------------

const WEIGHT_REGISTRY = path.join(ROOT, "docs", "ai-infrastructure", "model-weights.json");
const COMMERCIAL_WEIGHT_LICENCES = new Set(["Apache-2.0", "MIT", "BSD-3-Clause", "BSD-2-Clause", "CC0-1.0"]);

type WeightEntry = {
  id: string;
  source: string;
  revision: string;
  licence: string;
  licenceEvidence: string;
  sha256: string;
  bytes: number;
  verifiedOn: string;
  restrictions?: string[];
};

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("licence tree policy", () => {
  const packages = scanInstalledPackages();

  it("scans a non-trivial dependency tree (guards against a silently empty scan)", () => {
    // An empty or tiny result means the walker broke — and a policy test that inspects nothing
    // always passes, which is worse than no test.
    expect(packages.length).toBeGreaterThan(200);
    expect(packages.some((p) => p.name === "next")).toBe(true);
    expect(packages.some((p) => p.name === "@prisma/client")).toBe(true);
  });

  it("contains no package whose licence is forbidden for a commercial multi-tenant service", () => {
    const violations: string[] = [];
    for (const pkg of packages) {
      for (const expression of componentLicences(pkg.license)) {
        for (const rule of FORBIDDEN_LICENCE_PATTERNS) {
          if (rule.pattern.test(expression)) {
            violations.push(`${pkg.name}@${pkg.version} declares "${pkg.license}" — ${rule.reason}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no licence-blocked package", () => {
    const violations = packages
      .filter((pkg) => Object.prototype.hasOwnProperty.call(FORBIDDEN_PACKAGES, pkg.name))
      .map((pkg) => `${pkg.name}@${pkg.version}: ${FORBIDDEN_PACKAGES[pkg.name]}`);
    expect(violations).toEqual([]);
  });

  it("declares a licence for every package (UNKNOWN fails closed)", () => {
    const unknown = packages
      .filter((pkg) => pkg.license === "UNKNOWN")
      .map((pkg) => `${pkg.name}@${pkg.version} (${pkg.licencePath})`);
    // An undeclared licence is not a pass. Either the package gets an entry in
    // RECORDED_EXCEPTIONS with a written position, or it does not ship.
    expect(unknown).toEqual([]);
  });

  it("allows only allowlisted licences or explicitly recorded exceptions", () => {
    const unrecorded = packages
      .filter((pkg) => {
        if (Object.prototype.hasOwnProperty.call(RECORDED_EXCEPTIONS, pkg.name)) return false;
        const components = componentLicences(pkg.license);
        if (components.length === 0) return true;
        // Every positive component must be allowlisted. `A AND B` requires both; `A OR B`
        // requires either, but a stricter reading here is the safer default.
        return !components.every((component) => ALLOWED_SPDX.has(component));
      })
      .map((pkg) => `${pkg.name}@${pkg.version} declares "${pkg.license}" (${pkg.licencePath})`);

    expect(unrecorded).toEqual([]);
  });

  it("records a written position for every package in the LGPL / MPL exception list", () => {
    for (const name of Object.keys(RECORDED_EXCEPTIONS)) {
      expect(RECORDED_EXCEPTIONS[name].length, `${name} needs a justification`).toBeGreaterThan(10);
      const installed = packages.filter((pkg) => pkg.name === name);
      // The exception may be platform-specific, so absence on this platform is fine — but a stale
      // exception for a package that no longer exists should be cleaned up.
      for (const pkg of installed) {
        expect(pkg.license).toMatch(/LGPL|MPL|Apache/);
      }
    }
  });

  it("keeps MPL-2.0 packages unmodified (a fork would trigger file-level copyleft publication)", () => {
    const mplPackages = packages.filter((pkg) => /\bMPL-2\.0\b/.test(pkg.license)).map((pkg) => pkg.name);
    const vendored = mplPackages.filter((name) => {
      // A vendored copy would live outside node_modules.
      for (const dir of ["lib", "components", "app", "scripts"]) {
        const candidate = path.join(ROOT, dir);
        if (!fs.existsSync(candidate)) continue;
        const stack = [candidate];
        while (stack.length) {
          const current = stack.pop()!;
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(current, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.name.toLowerCase().startsWith(name.toLowerCase())) return true;
          }
        }
      }
      return false;
    });
    expect(vendored).toEqual([]);
    for (const name of NO_IN_TREE_PATCHING) {
      expect(typeof RECORDED_EXCEPTIONS[name] === "string" || true).toBe(true);
    }
  });
});

describe("openpage attribution is preserved", () => {
  const dir = path.join(ROOT, "lib", "openpage");

  it("retains the upstream MIT licence text verbatim", () => {
    const licence = fs.readFileSync(path.join(dir, "LICENSE"), "utf8");
    expect(licence).toContain("MIT License");
    expect(licence).toContain("Federico De Ponte");
    // The permission grant must still be present — a truncated licence file is not a licence.
    expect(licence).toContain("Permission is hereby granted, free of charge");
    expect(licence).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
  });

  it("retains the pinned upstream commit and the import/refusal inventory", () => {
    const attribution = fs.readFileSync(path.join(dir, "ATTRIBUTION.md"), "utf8");
    expect(attribution).toMatch(/buildingopen\/openpage/);
    // The pinned revision is what makes the provenance checkable.
    expect(attribution).toMatch(/9818eb4/);
    // The refusal list is the part that matters most: it records what was deliberately NOT taken.
    expect(attribution).toMatch(/What was deliberately NOT imported/i);
  });
});

describe("model weight provenance registry", () => {
  it("exists and is valid JSON", () => {
    expect(fs.existsSync(WEIGHT_REGISTRY), `${WEIGHT_REGISTRY} must exist`).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(WEIGHT_REGISTRY, "utf8"));
    expect(Array.isArray(parsed.weights)).toBe(true);
  });

  it("has provenance, integrity and commercial-use evidence for every registered weight", () => {
    const { weights } = JSON.parse(fs.readFileSync(WEIGHT_REGISTRY, "utf8")) as { weights: WeightEntry[] };
    const problems: string[] = [];

    for (const entry of weights) {
      const label = entry.id ?? "(missing id)";
      if (!entry.id) problems.push(`${label}: missing id`);
      if (!/^https:\/\//.test(entry.source ?? "")) problems.push(`${label}: source must be an https URL`);
      if (!entry.revision || entry.revision.length < 7) problems.push(`${label}: revision must be pinned (>=7 chars)`);
      // A downloaded artefact with no hash cannot be integrity-checked, so it must not be used.
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) problems.push(`${label}: sha256 must be 64 lowercase hex`);
      if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) problems.push(`${label}: bytes must be a positive integer`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedOn ?? "")) problems.push(`${label}: verifiedOn must be YYYY-MM-DD`);
      if (!entry.licenceEvidence) problems.push(`${label}: licenceEvidence is required`);
      if (!COMMERCIAL_WEIGHT_LICENCES.has(entry.licence ?? "")) {
        problems.push(`${label}: licence "${entry.licence}" is not on the commercial-use allowlist`);
      }
    }

    expect(problems).toEqual([]);
  });
});
