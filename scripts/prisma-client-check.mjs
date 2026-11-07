#!/usr/bin/env node
// Read-only: whose schema does the shared generated Prisma client hold?
//
// Every worktree reaches the MAIN checkout's node_modules, so there is one generated client
// (node_modules/.prisma/client). Prisma copies the schema it generated from beside it. This compares
// that copy with this checkout's prisma/schema.prisma and with the main checkout's, and says which
// it matches. It writes nothing and never touches a database.
//
//   node scripts/prisma-client-check.mjs        exit 0 always; prints the verdict
//   node scripts/prisma-client-check.mjs --strict   exit 1 when the client does not match THIS checkout
//
// To repair a client that holds a branch's schema: from the MAIN checkout, `npx prisma generate`
// (the hook allows it there), then restart any dev server.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null);

function gitOut(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const top = gitOut(["rev-parse", "--show-toplevel"]) ?? process.cwd();
const common = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
const main = common ? path.dirname(common) : top;

const mine = read(path.join(top, "prisma", "schema.prisma"));
const theirs = read(path.join(main, "prisma", "schema.prisma"));
const client = read(path.join(top, "node_modules", ".prisma", "client", "schema.prisma"));

function says(label, schema) {
  if (client === null) return `${label}: the generated client has no schema copy (run \`npx prisma generate\` from the main checkout)`;
  return `${label}: ${client === schema ? "MATCHES" : "differs from"} the generated client`;
}

console.log(`this checkout: ${top}`);
console.log(`main checkout: ${main}`);
console.log(says("this schema", mine));
console.log(says("main schema", theirs));
const ok = client !== null && client === mine;
if (!ok && client !== null && client === theirs) {
  console.log("The shared client was made from main's schema, not this branch's: expect tsc to miss this branch's new columns. Say so in your report; do NOT generate from here.");
} else if (!ok && client !== null) {
  console.log("The shared client matches neither: another branch generated it. Regenerate from the main checkout.");
}
process.exit(process.argv.includes("--strict") && !ok ? 1 : 0);
