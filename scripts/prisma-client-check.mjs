#!/usr/bin/env node
// Read-only: whose schema does the shared generated Prisma client hold?
//
// Every worktree reaches the MAIN checkout's node_modules, so there is one generated client
// (node_modules/.prisma/client). Prisma copies the schema it generated from beside it. This compares
// that copy with this checkout's prisma/schema.prisma and with the main checkout's, and says which
// it matches. It writes nothing and never touches a database.
//
// The comparison is of a NORMALISED form of each schema, not the bytes. Prisma 6 writes a TIDIED copy
// beside the client: comments are removed and column alignment is changed (about 80 lines shorter,
// the same models and fields). A byte comparison therefore reported "matches neither" right after a
// correct `prisma generate` on main. normaliseSchema drops comment lines and trailing `//` comments,
// collapses runs of whitespace outside string literals to one space, and drops blank lines. Two schemas
// that differ only in comments or alignment match; one extra field or model does not.
//
//   node scripts/prisma-client-check.mjs        exit 0 always; prints the verdict
//   node scripts/prisma-client-check.mjs --strict   exit 1 when the client does not match THIS checkout
//
// To repair a client that holds a branch's schema: from the MAIN checkout, `npx prisma generate`
// (the hook allows it there), then restart any dev server.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null);

// One line, normalised. Strings ("...", with \ escapes) are copied verbatim, so `@default("a // b")`
// keeps its `//` and its spacing. Outside a string, `//` starts a comment that runs to the end of the
// line, and runs of whitespace become one space.
function normaliseLine(line) {
  let out = "";
  let inString = false;
  let pendingSpace = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < line.length) out += line[++i];
      else if (c === '"') inString = false;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    if (/\s/.test(c)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out !== "") out += " ";
    pendingSpace = false;
    out += c;
    if (c === '"') inString = true;
  }
  return out;
}

export function normaliseSchema(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(normaliseLine)
    .filter((line) => line !== "")
    .join("\n");
}

function gitOut(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function main() {
  const top = gitOut(["rev-parse", "--show-toplevel"]) ?? process.cwd();
  const common = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const mainDir = common ? path.dirname(common) : top;

  const raw = (file) => read(file);
  const mineRaw = raw(path.join(top, "prisma", "schema.prisma"));
  const theirsRaw = raw(path.join(mainDir, "prisma", "schema.prisma"));
  const clientRaw = raw(path.join(top, "node_modules", ".prisma", "client", "schema.prisma"));

  const norm = (s) => (s === null ? null : normaliseSchema(s));
  const mine = norm(mineRaw);
  const theirs = norm(theirsRaw);
  const client = norm(clientRaw);

  function says(label, schema) {
    if (client === null) return `${label}: the generated client has no schema copy (run \`npx prisma generate\` from the main checkout)`;
    return `${label}: ${client === schema ? "MATCHES" : "differs from"} the generated client`;
  }

  console.log(`this checkout: ${top}`);
  console.log(`main checkout: ${mainDir}`);
  console.log(says("this schema", mine));
  console.log(says("main schema", theirs));
  const ok = client !== null && client === mine;
  if (!ok && client !== null && client === theirs) {
    console.log("The shared client was made from main's schema, not this branch's: expect tsc to miss this branch's new columns. Say so in your report; do NOT generate from here.");
  } else if (!ok && client !== null) {
    console.log("The shared client matches neither: another branch generated it. Regenerate from the main checkout.");
  }
  process.exit(process.argv.includes("--strict") && !ok ? 1 : 0);
}

// Run only when executed directly, so the tests can import normaliseSchema without the check running.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
