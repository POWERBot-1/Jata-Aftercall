/**
 * Check that the generated Prisma client, the schema and the calling code agree.
 *
 * This exists because the ERP layer is large and mostly written against model names rather than
 * generated types in a few dynamic paths. A typo such as `prisma.erpInvoicee` is not a type error
 * when the client is not generated (the offline build stubs Prisma), so it survives `tsc`, the
 * build and every mocked unit test, and only explodes in production against a real database.
 *
 * Checks:
 *   1. the generated client contains exactly the models declared in prisma/schema.prisma
 *      (run `prisma generate` first; CI does),
 *   2. every `prisma.<model>.<method>` reference in app code resolves to a real model,
 *   3. every model referenced by app code has an entry in the offline fallback in lib/db.ts,
 *      so a build without a generated client degrades to empty reads instead of a TypeError.
 *
 * Usage: npx tsx scripts/erp/check-models.ts
 */
import fs from "node:fs";
import path from "node:path";

import { Prisma } from "@prisma/client";

const ROOT = path.resolve(__dirname, "../..");
const SCHEMA_PATH = path.join(ROOT, "prisma/schema.prisma");
const DB_PATH = path.join(ROOT, "lib/db.ts");
const SCAN_DIRS = ["lib", "app", "components", "actions.ts"];
const PRISMA_METHOD_CALL = /\bprisma\.([a-zA-Z][A-Za-z0-9]*)\.([a-zA-Z][A-Za-z0-9]*)/g;
const CLIENT_INTERNALS = new Set(["$transaction", "$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe", "$connect", "$disconnect", "$extends"]);

function walk(target: string): string[] {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return /\.(ts|tsx)$/.test(full) ? [full] : [];
  return fs.readdirSync(full).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    return walk(path.join(target, entry));
  });
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

const schemaSource = fs.readFileSync(SCHEMA_PATH, "utf8");
const schemaModels = [...schemaSource.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
const clientModels: string[] = ((Prisma as unknown as { dmmf: { datamodel: { models: { name: string }[] } } }).dmmf?.datamodel?.models ?? []).map((model) => model.name);

const problems: string[] = [];

if (clientModels.length === 0) {
  problems.push("the generated client exposes no models — run `npx prisma generate` before this check");
} else {
  const missingFromClient = schemaModels.filter((name) => !clientModels.includes(name));
  const missingFromSchema = clientModels.filter((name) => !schemaModels.includes(name));
  if (missingFromClient.length) problems.push(`models in schema.prisma but not in the generated client: ${missingFromClient.join(", ")}`);
  if (missingFromSchema.length) problems.push(`models in the generated client but not in schema.prisma: ${missingFromSchema.join(", ")}`);
}

const clientByLowerName = new Map(clientModels.map((name) => [lowerFirst(name), name]));
const dbSource = fs.readFileSync(DB_PATH, "utf8");
const referenced = new Map<string, { model: string; calls: number; files: Set<string> }>();

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const source = fs.readFileSync(file, "utf8");
    if (file.endsWith("lib/db.ts")) continue;
    for (const match of source.matchAll(PRISMA_METHOD_CALL)) {
      const [, modelKey, method] = match;
      if (CLIENT_INTERNALS.has(`$${modelKey}`) || modelKey.startsWith("$")) continue;
      const entry = referenced.get(modelKey) ?? { model: clientByLowerName.get(modelKey) ?? "", calls: 0, files: new Set<string>() };
      entry.calls += 1;
      entry.files.add(path.relative(ROOT, file));
      referenced.set(modelKey, entry);
      if (!entry.model && clientModels.length > 0) {
        problems.push(`${path.relative(ROOT, file)} calls prisma.${modelKey}.${method} but no Prisma model "${modelKey}" exists`);
      }
    }
  }
}

for (const [modelKey, entry] of referenced) {
  if (!entry.model) continue;
  const stubPattern = new RegExp(`^\\s*${modelKey}:\\s`, "m");
  if (!stubPattern.test(dbSource)) {
    problems.push(`lib/db.ts has no offline fallback entry for prisma.${modelKey} (used ${entry.calls}x in ${[...entry.files].join(", ")})`);
  }
}

const erpModels = clientModels.filter((name) => name.startsWith("Erp") || name.startsWith("Msg"));
console.log(`schema models: ${schemaModels.length}`);
console.log(`generated client models: ${clientModels.length}`);
console.log(`ERP / messaging models: ${erpModels.length}`);
console.log(`models referenced by app code: ${referenced.size}`);

if (problems.length) {
  console.error("\nModel consistency check FAILED:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\nModel consistency check PASSED");
