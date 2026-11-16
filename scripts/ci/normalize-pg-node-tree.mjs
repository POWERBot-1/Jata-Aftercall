#!/usr/bin/env node
/**
 * Canonicalize PostgreSQL pg_node_tree output for CHECK-constraint comparison.
 * PostgreSQL dump/restore can re-parenthesize associative AND/OR expressions.
 * This parser flattens only nested BoolExpr nodes with the same operator and
 * sorts their operands; it preserves AND/OR boundaries and all other node data.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if ("{}()[]".includes(source[i])) { tokens.push(source[i++]); continue; }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      const begin = i++;
      while (i < source.length) {
        if (quote === '"' && source[i] === "\\") { i += 2; continue; }
        if (quote === "'" && source[i] === "'" && source[i + 1] === "'") { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      if (source[i - 1] !== quote) throw new Error("unterminated quoted PostgreSQL node value");
      tokens.push(source.slice(begin, i));
      continue;
    }
    const begin = i;
    while (i < source.length && !/\s/.test(source[i]) && !"{}()[]".includes(source[i])) i++;
    tokens.push(source.slice(begin, i));
  }
  if (!tokens.length) throw new Error("empty PostgreSQL node tree");
  return tokens;
}

function parseTree(source) {
  const tokens = tokenize(source);
  let index = 0;
  const take = () => {
    if (index >= tokens.length) throw new Error("unexpected end of PostgreSQL node tree");
    return tokens[index++];
  };
  const peek = () => tokens[index];
  const value = () => {
    const token = take();
    if (token === "{") {
      const type = take();
      const fields = {};
      const positional = [];
      while (peek() !== "}") {
        if (peek() === undefined) throw new Error("unterminated PostgreSQL node");
        // PostgreSQL pg_node_tree includes positional payloads for some node
        // fields (notably Const :constvalue <length> [ <bytes...> ]). Preserve
        // these in order instead of misreading the following '[' as a field.
        if (!peek().startsWith(":")) {
          positional.push(value());
          continue;
        }
        const field = take();
        fields[field.slice(1)] = value();
      }
      take();
      return { kind: "node", type, fields, positional };
    }
    if (token === "(" || token === "[") {
      const close = token === "(" ? ")" : "]";
      const items = [];
      while (peek() !== close) {
        if (peek() === undefined) throw new Error("unterminated PostgreSQL node list");
        items.push(value());
      }
      take();
      return { kind: "list", delimiter: token, items };
    }
    return { kind: "scalar", value: token };
  };
  const parsed = value();
  if (index !== tokens.length) throw new Error("trailing PostgreSQL node tree tokens");
  return parsed;
}

function stable(node) {
  if (node.kind === "scalar") return node;
  if (node.kind === "list") return { ...node, items: node.items.map(stable) };
  const fields = Object.fromEntries(Object.entries(node.fields).sort(([a],[b]) => a.localeCompare(b)).map(([key,val]) => [key, stable(val)]));
  if (node.type === "BOOLEXPR" && fields.boolop?.kind === "scalar" && fields.args?.kind === "list") {
    const operator = fields.boolop.value;
    const flattened = [];
    const visit = (child) => {
      if (child.kind === "node" && child.type === "BOOLEXPR" && child.fields.boolop?.kind === "scalar" && child.fields.boolop.value === operator && child.fields.args?.kind === "list") {
        child.fields.args.items.forEach(visit);
      } else flattened.push(child);
    };
    fields.args.items.forEach(visit);
    flattened.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    fields.args = { ...fields.args, items: flattened };
  }
  return { kind: "node", type: node.type, fields, positional: (node.positional ?? []).map(stable) };
}

export function canonicalizePgNodeTree(source) {
  return JSON.stringify(stable(parseTree(source)));
}

export function canonicalizeCheckRows(source) {
  return source.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.lastIndexOf("|");
    if (separator < 0) throw new Error("CHECK signature row has no node-tree delimiter");
    return line.slice(0, separator + 1) + canonicalizePgNodeTree(line.slice(separator + 1));
  }).join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = readFileSync(process.argv[2], "utf8");
    process.stdout.write(canonicalizeCheckRows(input));
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : "invalid PostgreSQL node tree"}`);
    process.exitCode = 1;
  }
}
