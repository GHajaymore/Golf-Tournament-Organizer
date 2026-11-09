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
// correct `prisma generate` on main. normaliseSchema drops `//`, `///` and `/* */` comments (outside
// string literals), collapses runs of whitespace outside strings to one space, and drops blank lines. Two schemas
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

// Normalises a schema for comparison. Strings ("...", with \ escapes) are copied verbatim, so
// `@default("a // b")` keeps its `//` and its spacing. Outside a string, `//` and `///` comments run to
// the end of the line, and `/* */` and `/** */` comments are removed (their line breaks are kept, so
// line structure survives). Runs of whitespace outside strings become one space; blank lines go.
export function normaliseSchema(text) {
  const src = text.replace(/\r\n/g, "\n");
  const out = [];
  let line = "";
  let pending = false; // whitespace or a comment seen since the last token
  let inString = false;
  const flush = () => {
    if (line !== "") out.push(line);
    line = "";
    pending = false;
  };
  const put = (c) => {
    if (pending && line !== "") line += " ";
    pending = false;
    line += c;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\n") {
      flush();
      inString = false;
      continue;
    }
    if (inString) {
      line += c;
      if (c === "\\" && i + 1 < src.length && src[i + 1] !== "\n") line += src[++i];
      else if (c === '"') inString = false;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i + 1 < src.length && src[i + 1] !== "\n") i++;
      pending = true;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") flush();
        i++;
      }
      i++;
      pending = true;
      continue;
    }
    if (/\s/.test(c)) {
      pending = true;
      continue;
    }
    put(c);
    if (c === '"') inString = true;
  }
  flush();
  return blockAttributesLast(out).join("\n");
}

// Prisma prints every field of a model/enum/view/type before its `@@` block attributes, whatever
// order the schema wrote them in. Within each such block, keep the field lines in their order and
// move the `@@` lines after them (stable). A block is its header line through its closing `}`.
function blockAttributesLast(lines) {
  const out = [];
  let fields = null;
  let attrs = null;
  for (const line of lines) {
    if (fields === null) {
      if (/^(model|enum|view|type)\b/.test(line)) {
        fields = [];
        attrs = [];
      }
      out.push(line);
      continue;
    }
    if (line === "}") {
      out.push(...fields, ...attrs, line);
      fields = null;
      attrs = null;
    } else if (line.startsWith("@@")) {
      attrs.push(line);
    } else {
      fields.push(line);
    }
  }
  if (fields !== null) out.push(...fields, ...attrs); // a block never closed: keep its lines
  return out;
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
