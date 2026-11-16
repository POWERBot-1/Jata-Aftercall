#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = process.argv[2];
const normalizedTarget = target?.replaceAll("\\", "/");
if (!normalizedTarget || !(normalizedTarget === "baseline/prisma/seed.ts" || normalizedTarget.endsWith("/baseline/prisma/seed.ts"))) {
  throw new Error("BLOCKED: expected the disposable baseline/prisma/seed.ts target");
}
const absolute = path.resolve(target);
let source = readFileSync(absolute, "utf8");

const adminStart = source.indexOf("  // Demo admin user");
const demoStart = source.indexOf("  // Demo customer user", adminStart);
if (adminStart < 0 || demoStart < 0) throw new Error("BLOCKED: historical seed credential block did not match expected source");
source = source.slice(0, adminStart) + source.slice(demoStart);

const oldPassword = '  const demoHash = await bcrypt.hash("Demo1234!", 10);';
const safePassword = [
  "  const demoPassword = process.env.DEMO_FIXTURE_PASSWORD;",
  '  if (!demoPassword || demoPassword.length < 32) throw new Error("Historical fixture seed requires an ephemeral 32+ character password.");',
  "  const demoHash = await bcrypt.hash(demoPassword, 10);",
].join("\n");
if (!source.includes(oldPassword)) throw new Error("BLOCKED: expected historical demo password literal not found");
source = source.replace(oldPassword, safePassword);

const paymentStart = source.indexOf("      // Seed a PAID payment for demo");
const nextService = source.indexOf("\n    }\n\n    for (const [idx, s]", paymentStart);
if (paymentStart < 0 || nextService < 0) throw new Error("BLOCKED: expected synthetic demo payment block not found");
const paymentClose = source.lastIndexOf("      });", nextService);
if (paymentClose < paymentStart) throw new Error("BLOCKED: could not delimit synthetic payment seed block");
source = source.slice(0, paymentStart) + source.slice(paymentClose + "      });\n".length);

const demoPaymentMarker = "paystackId: " + String.fromCharCode(96) + "demo-";
if (/Admin123!|Demo1234!/.test(source) || source.includes(demoPaymentMarker)) {
  throw new Error("FAIL: a hardcoded credential or synthetic paid-payment marker remains in the historical seed");
}
writeFileSync(absolute, source, "utf8");
console.log("PASS: historical seed uses only the ephemeral fixture password; admin credential and synthetic PAID payment seed removed");
