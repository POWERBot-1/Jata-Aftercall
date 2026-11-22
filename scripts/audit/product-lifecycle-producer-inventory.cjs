#!/usr/bin/env node
"use strict";

// Read-only, syntax-aware inventory of references to the generic lifecycle enqueue adapter.
// This is a static source audit, not whole-program proof: reflection and computed module paths
// cannot be resolved reliably. Those patterns require manual review before worker activation.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

const ADAPTER = "lib/admin/product-lifecycle-execution-store.ts";
const TARGETS = new Set(["enqueueLifecycleTasks", "createLifecycleExecutionRun"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

function isTestPath(filePath) {
  return /(^|[/\\])(__tests__|tests?)([/\\]|$)/i.test(filePath) ||
    /(?:\.test|\.spec)\.[^.]+$/i.test(filePath);
}

function moduleSpecifierOf(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
    return node.arguments[0].text;
  }
  return null;
}

function scanSourceText(filePath, sourceText) {
  const kind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX :
    /\.[cm]?js$/.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
  const parseErrors = source.parseDiagnostics.map((d) => ({
    message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    offset: d.start ?? 0,
  }));
  const hits = [];
  const add = (node, target, evidence) => {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    hits.push({ file: filePath, line: pos.line + 1, target, evidence });
  };

  function visit(node) {
    if (ts.isIdentifier(node) && TARGETS.has(node.text)) {
      add(node, node.text, "identifier-reference");
    }
    const specifier = moduleSpecifierOf(node);
    if (specifier && /product-lifecycle-execution-store/.test(specifier)) {
      add(node, "execution-store-module", "static-module-specifier");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { hits, parseErrors };
}

function listTrackedSources() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter(Boolean).filter((file) => EXTENSIONS.has(path.extname(file).toLowerCase()));
}

function main() {
  const files = listTrackedSources();
  const parseErrors = [];
  const productionReferences = [];
  const testReferences = [];
  for (const file of files) {
    const result = scanSourceText(file, fs.readFileSync(file, "utf8"));
    for (const error of result.parseErrors) parseErrors.push({ file, ...error });
    if (file.replaceAll("\\", "/") === ADAPTER) continue; // adapter declarations are expected
    (isTestPath(file) ? testReferences : productionReferences).push(...result.hits);
  }

  const report = {
    audit: "product-lifecycle-producer-static-inventory",
    sourceFilesScanned: files.length,
    adapterDefinitionFile: ADAPTER,
    productionReferenceCount: productionReferences.length,
    testReferenceCount: testReferences.length,
    parseErrorCount: parseErrors.length,
    productionReferences,
    testReferences,
    parseErrors,
    limitations: [
      "Static syntax analysis does not resolve reflection, computed import paths, runtime-generated code, or arbitrary indirect calls.",
      "A clean result is not proof that no producer can exist through dynamic mechanisms; manual review remains required.",
      "Any production reference outside the adapter is a hard failure until classified and covered by an approved task contract."
    ]
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (parseErrors.length || productionReferences.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { scanSourceText, isTestPath };
