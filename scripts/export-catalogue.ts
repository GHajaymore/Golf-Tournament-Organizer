/**
 * Export the development course catalogue's clean OpenGolfAPI cards to a JSON file the owner can
 * upload on /owner ("Course catalogue"), so production is filled WITHOUT anybody holding its
 * database credentials (Ajay, J29).
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env npx tsx scripts/export-catalogue.ts [outDirOrFile]
 *
 * READS the LOCAL development database only: it refuses any PRISMA_DATABASE_URL or DATABASE_URL whose host is not
 * localhost / 127.0.0.1 / ::1. WRITES one file, always OUTSIDE the repository (it refuses a path
 * inside it); the default is a catalogue-exports folder beside the main checkout. Nothing is committed.
 *
 * WHAT GOES IN: rows with a usable card (`cardProblem` empty, and a card the app's own checker
 * passes). WHAT NEVER DOES: a `gca:` row. GolfCourseAPI's terms forbid compiling its dataset, so
 * those ids are refused here and again by the load. Open data only (OpenGolfAPI, ODbL, credit required).
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { CATALOGUE_FORMAT, CATALOGUE_VERSION, isGcaId, judgeRow } from "../src/lib/domain/catalogue-load";

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** A `catalogue-exports` folder beside the MAIN checkout (a worktree's own root is inside it). */
function defaultDir(): string {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], process.cwd());
  const root = common ? dirname(common) : resolve(process.cwd());
  return resolve(root, "..", "catalogue-exports");
}

/** Every URL Prisma could read (the datasource url is PRISMA_DATABASE_URL, the direct one DATABASE_URL) must be this machine. */
function localOnly(urls: Array<[string, string | undefined]>): string {
  const set = urls.filter(([, u]) => u);
  if (!set.some(([n]) => n === "PRISMA_DATABASE_URL")) {
    throw new Error("PRISMA_DATABASE_URL is not set (point DOTENV_CONFIG_PATH at the main checkout's .env).");
  }
  for (const [name, url] of set) {
    let host = "";
    try {
      host = new URL(url as string).hostname.replace(/^\[|\]$/g, "");
    } catch {
      throw new Error(`${name} is not a URL; refusing.`);
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error(`Refusing: ${name} points at "${host}", not this machine. This exports from the local development database only.`);
    }
  }
  return process.env.PRISMA_DATABASE_URL as string;
}

/** Refuse a file that would land inside ANY git work tree (this worktree, the main checkout, or another). */
function outsideTheRepo(file: string): void {
  let dir = dirname(file);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  if (git(["rev-parse", "--is-inside-work-tree"], dir) === "true") {
    throw new Error(`Refusing to write inside a git repository (${file}). Give a path outside it.`);
  }
}

async function main() {
  const url = localOnly([
    ["PRISMA_DATABASE_URL", process.env.PRISMA_DATABASE_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
  ]);
  const arg = process.argv[2] ?? defaultDir();
  const file = /\.json$/i.test(arg) ? resolve(arg) : join(resolve(arg), `catalogue-${new Date().toISOString().slice(0, 10)}.json`);
  outsideTheRepo(file);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.courseCatalog.findMany({
      where: { cardProblem: "", NOT: { pars: "" } },
      orderBy: { id: "asc" },
    });
    const courses = [];
    let gca = 0;
    let refused = 0;
    for (const r of rows) {
      if (isGcaId(r.id)) {
        gca++;
        continue;
      }
      const { fetchedAt: _f, updatedAt: _u, ...fields } = r;
      const v = judgeRow(fields);
      if (!v.ok) {
        refused++;
        continue;
      }
      courses.push(v.row);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ format: CATALOGUE_FORMAT, version: CATALOGUE_VERSION, count: courses.length, exportedFrom: "development", courses }),
      "utf8",
    );
    console.log(`Wrote ${courses.length} courses to ${file} (${statSync(file).size} bytes).`);
    console.log(`Left out: ${gca} GolfCourseAPI rows (never exported), ${refused} rows the card checker refuses.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
