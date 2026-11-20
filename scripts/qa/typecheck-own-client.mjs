#!/usr/bin/env node
// TYPE-CHECK A CHECKOUT AGAINST ITS OWN DATABASE SCHEMA, without touching the shared Prisma client.
//
// Every worktree reaches the MAIN checkout's node_modules (.claude/settings.json), so there is ONE generated
// Prisma client, generated from main's schema. A branch or train that adds a column could therefore not be
// type-checked anywhere but CI: `tsc` here failed on the new column ("does not exist on type PlayerPass"),
// and `prisma generate` here is refused by the guard because it would replace the client under every other
// worktree. Engineers reported "client stale"; the PM's train-tip check skipped tsc (17 Nov, train D: #1158's
// slipPrintedAt). This is the fix for that, not a skip:
//
//   1. If this checkout's schema matches the shared client's, plain `tsc --noEmit`.
//   2. Otherwise generate THIS schema's client into a private folder (.qa/tmp/own-client, gitignored) with a
//      custom `output`, point `@prisma/client` at it through a private tsconfig that extends the real one, and
//      run tsc with that. The shared client's schema copy is hashed before and after: if it changed, this
//      fails loudly (the guard's guarantee, kept).
//
//   node scripts/qa/typecheck-own-client.mjs
//     exit 0 = types pass; 1 or 2 = tsc's own exit (type errors); 3 = setup failure (generate failed, schema
//     not understood); 4 = the SHARED client changed (regenerate it from the main checkout).
//
// Read-only for everything outside .qa/tmp/own-client. Never touches a database.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseSchema } from "../prisma-client-check.mjs";

/**
 * The schema with the client generator's output moved to `outputDir` (forward slashes; Prisma reads them on
 * Windows too). Throws when there is not exactly one `generator client` block, or it already names an output:
 * a schema this script does not understand is a setup failure, never a guess.
 */
export function withPrivateOutput(schema, outputDir) {
  const blocks = [...schema.matchAll(/generator\s+client\s*\{[^}]*\}/g)];
  if (blocks.length !== 1) throw new Error(`expected one "generator client" block, found ${blocks.length}`);
  const block = blocks[0][0];
  if (/\boutput\s*=/.test(block)) throw new Error('the "generator client" block already names an output');
  const out = outputDir.split(path.sep).join("/");
  return schema.replace(block, block.replace(/\}$/, `  output = "${out}"\n}`));
}

/** A tsconfig that is the real one, with `@prisma/client` resolved to the private client. */
export function privateTsconfig(rootTsconfig, root, clientDir) {
  const real = JSON.parse(readFileSync(rootTsconfig, "utf8"));
  const slash = (p) => p.split(path.sep).join("/");
  /** @type {Record<string, string[]>} */
  const paths = {};
  for (const [k, v] of Object.entries(real.compilerOptions?.paths ?? {})) paths[k] = /** @type {string[]} */ (v).map((p) => slash(path.resolve(root, p)));
  paths["@prisma/client"] = [slash(clientDir)];
  return {
    extends: slash(rootTsconfig),
    compilerOptions: { paths },
    include: (real.include ?? []).map((p) => slash(path.resolve(root, p))),
    exclude: (real.exclude ?? []).map((p) => slash(path.resolve(root, p))),
  };
}

/** Exit codes that are not tsc's (tsc uses 1 and 2 for type errors). */
export const EXIT_SETUP = 3;
export const EXIT_SHARED_CHANGED = 4;

const sha = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "absent");
/** The files whose change would mean the SHARED client was touched: its schema copy, its types, and the package that points at it. */
export const SHARED_CLIENT_FILES = [
  ["node_modules", ".prisma", "client", "schema.prisma"],
  ["node_modules", ".prisma", "client", "index.d.ts"],
  ["node_modules", "@prisma", "client", "package.json"],
];
const fingerprint = (root) => SHARED_CLIENT_FILES.map((parts) => sha(path.join(root, ...parts))).join(" ");
// The tools' own JavaScript entry points, run with this Node: no shell, so a path with spaces stays one argument
// (the .cmd launchers need a shell on Windows, and the shell split "Golf Tournament App" into three).
const TOOL = { prisma: ["prisma", "build", "index.js"], tsc: ["typescript", "bin", "tsc"] };
const tool = (root, name) => [path.join(root, "node_modules", ...TOOL[name])];

function main() {
  const root = process.cwd();
  const schemaFile = path.join(root, "prisma", "schema.prisma");
  const sharedCopy = path.join(root, "node_modules", ".prisma", "client", "schema.prisma");
  // PRISMA_GENERATE_SKIP_AUTOINSTALL: Prisma may otherwise `npm add` @prisma/client into the SHARED node_modules.
  const run = (name, args) =>
    spawnSync(process.execPath, [...tool(root, name), ...args], { cwd: root, stdio: "inherit", env: { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: "1" } });

  const mine = normaliseSchema(readFileSync(schemaFile, "utf8").replace(/\r\n/g, "\n"));
  const shared = existsSync(sharedCopy) ? normaliseSchema(readFileSync(sharedCopy, "utf8").replace(/\r\n/g, "\n")) : null;
  if (shared === mine) {
    console.log("typecheck-own-client: this schema matches the shared client; plain tsc");
    process.exit(run("tsc", ["--noEmit"]).status ?? EXIT_SETUP);
  }

  const work = path.join(root, ".qa", "tmp", "own-client");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const clientDir = path.join(work, "client");
  const before = fingerprint(root);
  let status = EXIT_SETUP;
  try {
    writeFileSync(path.join(work, "schema.prisma"), withPrivateOutput(readFileSync(schemaFile, "utf8"), clientDir));
    console.log("typecheck-own-client: this schema differs from the shared client; generating its own into .qa/tmp/own-client");
    const gen = run("prisma", ["generate", "--schema", path.join(work, "schema.prisma")]);
    if (gen.status !== 0) {
      console.error("typecheck-own-client: prisma generate failed (setup failure, not a type error)");
    } else if (fingerprint(root) !== before) {
      status = EXIT_SHARED_CHANGED;
      console.error("typecheck-own-client: the SHARED client changed while generating — stop; regenerate it from the main checkout");
    } else {
      const tsconfig = path.join(work, "tsconfig.json");
      writeFileSync(tsconfig, JSON.stringify(privateTsconfig(path.join(root, "tsconfig.json"), root, clientDir), null, 2));
      status = run("tsc", ["--noEmit", "-p", tsconfig]).status ?? EXIT_SETUP;
    }
  } catch (e) {
    console.error(`typecheck-own-client: setup failure: ${e instanceof Error ? e.message : String(e)}`);
    status = EXIT_SETUP;
  } finally {
    if (fingerprint(root) !== before) {
      console.error("typecheck-own-client: the SHARED client CHANGED — regenerate it from the main checkout");
      status = EXIT_SHARED_CHANGED;
    }
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
