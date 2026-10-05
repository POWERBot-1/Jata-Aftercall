/**
 * The Prisma contract the POS code actually queries against (§80)
 *
 * Why this file exists: this repository is developed where `prisma generate` cannot run, so
 * `prisma` is effectively `any` and the in-memory double ignores relation filters. Both blind
 * spots hide the same mistake — asking Prisma for a relation a model does not have. That mistake
 * reached CI once already: `Payment` stores `planId` as a plain column with **no** relation to
 * `PlanConfig`, so `include: { plan: … }` and `where: { plan: { key: … } }` are
 * `PrismaClientValidationError`s against a real client while looking perfectly reasonable here.
 *
 * So the schema is parsed and every POS query is checked against it: a relation that does not
 * exist is a build failure, not a production incident.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// ── The schema, as Prisma sees it ─────────────────────────────────────────────

type ModelShape = { fields: Set<string>; relations: Set<string>; /** `@@unique([a, b])` inputs, named `a_b` by Prisma. */ compoundKeys: Set<string> };

export function parseSchema(): Map<string, ModelShape> {
  const source = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  const modelNames = new Set([...source.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]));
  const models = new Map<string, ModelShape>();

  for (const match of source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = new Set<string>();
    const relations = new Set<string>();
    const compoundKeys = new Set<string>();
    for (const rawLine of match[2].split("\n")) {
      const line = rawLine.split("//")[0].trim();
      if (!line) continue;
      if (line.startsWith("@@unique")) {
        // Prisma names the compound-unique input after the joined fields, so
        // `@@unique([productId, branchId])` admits `where: { productId_branchId: { … } }`.
        const list = line.match(/\(([^)]*)\)/);
        if (list) {
          // The field list is written as `[productId, branchId]` — drop the square brackets.
          const parts = list[1]
            .replace(/^\[/, "")
            .replace(/\]$/, "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
          if (parts.length > 1) compoundKeys.add(parts.join("_"));
        }
        continue;
      }
      if (line.startsWith("@@")) continue;
      const [name, type] = line.split(/\s+/);
      if (!name || !type) continue;
      fields.add(name);
      const bare = type.replace("?", "").replace("[]", "");
      if (modelNames.has(bare)) relations.add(name);
    }
    models.set(match[1], { fields, relations, compoundKeys });
  }
  return models;
}

export const MODELS = parseSchema();
export const modelFor = (clientProperty: string) => clientProperty.charAt(0).toUpperCase() + clientProperty.slice(1);

// ── A scanner that understands strings, so it does not count brackets in text ──

const OPENERS = new Map([["(", ")"], ["{", "}"], ["[", "]"]]);

/** The index of the bracket that closes the one at `openIndex`, or -1. Bracket-type aware: a
 * `(` argument list is full of `{}` object literals, and counting them as one depth would run
 * straight past the end of the call and silently scan nothing at all. */
export function matchingClose(source: string, openIndex: number): number {
  if (!OPENERS.has(source[openIndex])) return -1;
  const stack: string[] = [];
  let quote: string | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "/" && source[index + 1] === "/") { while (index < source.length && source[index] !== "\n") index += 1; continue; }
    const opens = OPENERS.get(char);
    if (opens) { stack.push(opens); continue; }
    if (char === ")" || char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

/** The keys written at the top level of an object literal, ignoring anything nested inside. */
export function firstLevelKeys(source: string, openBrace: number): string[] {
  const close = matchingClose(source, openBrace);
  if (close < 0) return [];
  const body = source.slice(openBrace + 1, close);
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (OPENERS.has(char)) { depth += 1; continue; }
    if (char === ")" || char === "}" || char === "]") { depth -= 1; continue; }
    if (depth === 0 && char === ":") {
      const before = body.slice(0, index);
      const match = before.match(/(?:^|[\s,{])([A-Za-z_]\w*)\s*$/);
      if (match) keys.push(match[1]);
    }
  }
  return keys;
}

// ── Every Prisma call the POS makes ───────────────────────────────────────────

/** Written as a literal, and deliberately tolerant of `prisma.posSale?.findUnique?.()` — the
 * optional-call style the POS uses so an offline fallback client cannot throw on a missing model.
 * Note the two shapes: `payment.findUnique(` and `payment?.findFirst?.(` — the second has a dot
 * between the `?` and the paren, and a pattern that forgets it silently scans nothing at all. */
const CALL = /(?:prisma|client|tx)\.([A-Za-z]\w*)\??\.(?:findFirstOrThrow|findUniqueOrThrow|findMany|findFirst|findUnique|createMany|create|updateMany|update|upsert|deleteMany|delete|count|aggregate|groupBy)(?:\?\.)?\(/g;
const LOGICAL_OPERATORS = new Set(["AND", "OR", "NOT"]);

type Violation = { file: string; model: string; kind: string; key: string; allowed: string[] };

export function sourceFiles(): string[] {
  const wanted: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) wanted.push(path);
    }
  };
  walk(join(ROOT, "lib/pos"));
  walk(join(ROOT, "app/api/pos"));
  // …and the payment wallet, which talks to the same client and the same schema: an `include` or a
  // `where` through a relation a payment model does not have must fail here, not in production
  // (§76, §80 of the payment specification).
  walk(join(ROOT, "lib/payments"));
  walk(join(ROOT, "app/api/payments"));
  walk(join(ROOT, "app/api/admin/payments"));
  walk(join(ROOT, "app/admin/payments"));
  walk(join(ROOT, "app/receipt"));
  wanted.push(join(ROOT, "app/api/paystack/verify/route.ts"));
  return wanted;
}

export function violationsIn(file: string): Violation[] {
  return violationsInSource(readFileSync(file, "utf8"), relative(ROOT, file));
}

export function violationsInSource(source: string, path: string): Violation[] {
  const found: Violation[] = [];

  for (const call of source.matchAll(CALL)) {
    const modelName = modelFor(call[1]);
    const model = MODELS.get(modelName);
    const openParen = source.indexOf("(", call.index! + call[0].length - 1);
    const closeParen = matchingClose(source, openParen);
    if (closeParen < 0) continue;
    const args = source.slice(openParen, closeParen + 1);

    if (!model) {
      found.push({ file: path, model: modelName, kind: "model", key: call[0], allowed: [...MODELS.keys()].slice(0, 6) });
      continue;
    }

    for (const clause of args.matchAll(/\b(include|where)\s*:\s*\{/g)) {
      const brace = args.indexOf("{", clause.index! + clause[0].length - 1);
      for (const key of firstLevelKeys(args, brace)) {
        if (LOGICAL_OPERATORS.has(key)) continue;
        // A where may name a field, a relation, or one of the model's compound-unique inputs.
        const allowed =
          clause[1] === "include" ? model.relations : new Set([...model.fields, ...model.relations, ...model.compoundKeys]);
        if (!allowed.has(key)) {
          found.push({
            file: path,
            model: modelName,
            kind: clause[1],
            key,
            allowed: clause[1] === "include" ? [...model.relations].sort() : [...model.relations].sort(),
          });
        }
      }
    }
  }
  return found;
}

describe("POS queries match the Prisma schema", () => {
  const files = sourceFiles();
  const violations = files.flatMap(violationsIn);

  it("reads the schema, including the relation that does not exist", () => {
    expect(MODELS.size).toBeGreaterThan(55);
    expect(MODELS.get("PosAuditEvent")).toBeDefined();
    // The exact trap this guard was written for: Payment has planId but no `plan` relation.
    expect(MODELS.get("Payment")?.fields.has("planId")).toBe(true);
    expect(MODELS.get("Payment")?.relations.has("plan")).toBe(false);
    expect(MODELS.get("Subscription")?.relations.has("plan")).toBe(true);
    // …and the JATA Payment Wallet relation the payment spec adds: a payment settles one sale,
    // and a sale can only ever be settled by one confirmed payment (§25, §33, §98).
    expect(MODELS.get("PosSale")?.relations).toEqual(new Set(["business", "items", "payments", "paymentTransactions"]));
  });

  it("scans the POS layer", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.endsWith("lib/pos/store.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("lib/pos/entitlement.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("app/api/paystack/verify/route.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("lib/payments/engine.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("app/api/payments/webhooks/mpesa/route.ts"))).toBe(true);
  });

  it("never includes or filters through a relation the model does not have", () => {
    expect(
      violations.map((issue) => `${issue.file}: ${issue.model}.${issue.kind} \`${issue.key}\` (relations: ${issue.allowed.join(", ") || "none"})`),
    ).toEqual([]);
  });

  it("keeps POS payment evidence on the plan id, not a relation filter", () => {
    const entitlement = readFileSync(join(ROOT, "lib/pos/entitlement.ts"), "utf8");
    expect(entitlement).toMatch(/where: \{ businessId, status: "PAID", planId \}/);
    expect(entitlement).not.toMatch(/plan: \{ key: POS_PLAN_KEY \}/);

    const verify = readFileSync(join(ROOT, "app/api/paystack/verify/route.ts"), "utf8");
    expect(verify).toMatch(/prisma\.payment\.findUnique\(\{ where: \{ reference \} \}\)/);
    expect(verify).not.toMatch(/include: \{ plan:/);
  });

  it("would catch the mistake it was written for, so it cannot pass vacuously", () => {
    const synthetic = [
      'import prisma from "@/lib/db";',
      'export const bad = () => prisma.payment.findUnique({ where: { reference: "x" }, include: { plan: { select: { key: true } } } });',
      'export const worse = () => prisma.payment.findFirst({ where: { businessId: "b", status: "PAID", plan: { key: "BUSINESS_POS" } } });',
      // The optional-call shape the POS uses everywhere; a scanner that misses `?.(` scans nothing.
      'export const optionalCall = () => prisma.posSubscription?.findUnique?.({ where: { businessId: "b" }, include: { plan: { select: { key: true } } } }) ?? null;',
      'export const fine = () => prisma.posSale.findFirst({ where: { businessId: "b" }, include: { items: true, payments: true } });',
      'export const alsoFine = () => prisma.posSale?.findFirst?.({ where: { businessId: "b" }, include: { items: true, payments: true } }) ?? null;',
      'export const nestedSelect = () => prisma.posInventoryMovement.findMany({ where: { businessId: "b" }, include: { product: { select: { id: true, name: true } } } });',
    ].join("\n");
    expect(violationsInSource(synthetic, "synthetic.ts").map((issue) => `${issue.model}.${issue.kind}:${issue.key}`)).toEqual([
      "Payment.include:plan",
      "Payment.where:plan",
      "PosSubscription.include:plan",
    ]);
  });

  it("queries only models the schema defines", () => {
    expect(violations.filter((issue) => issue.kind === "model")).toEqual([]);
    // Sanity: the guard really is seeing POS queries, not silently scanning nothing.
    const store = readFileSync(join(ROOT, "lib/pos/store.ts"), "utf8");
    expect(store).toMatch(/include: \{ items: true, payments: true \}/);
    expect(violationsIn(join(ROOT, "lib/pos/store.ts"))).toEqual([]);
  });
});
