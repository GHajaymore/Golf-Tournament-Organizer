/**
 * Export the development course catalogue's clean OpenGolfAPI cards to a JSON file the owner can
 * upload on /owner ("Course catalogue"), so production is filled WITHOUT anybody holding its
 * database credentials (Ajay, J29).
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env npx tsx scripts/export-catalogue.ts [outDirOrFile]
 *
 * READS the LOCAL development database only: it refuses any DATABASE_URL whose host is not
 * localhost / 127.0.0.1 / ::1. WRITES one file, always OUTSIDE the repository (it refuses a path
 * inside it); the default is the catalogue-exports folder beside the app. Nothing is committed.
 *
 * WHAT GOES IN: rows with a usable card (`cardProblem` empty, and a card the app's own checker
 * passes). WHAT NEVER DOES: a `gca:` row. GolfCourseAPI's terms forbid compiling its dataset, so
 * those ids are refused here and again by the load. Open data only (OpenGolfAPI, ODbL, credit required).
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { PrismaClient } from "@prisma/client";
import { CATALOGUE_FORMAT, CATALOGUE_VERSION, isGcaId, judgeRow } from "../src/lib/domain/catalogue-load";

const DEFAULT_DIR = "C:/Users/morea/Documents/Apps/Golf Tournament App/catalogue-exports";

function localOnly(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set (point DOTENV_CONFIG_PATH at the main checkout's .env).");
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw new Error("DATABASE_URL is not a URL; refusing.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing: DATABASE_URL points at "${host}", not this machine. This exports from the local development database only.`);
  }
}

function outsideTheRepo(path: string): void {
  const rel = relative(resolve(process.cwd()), path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(`Refusing to write inside the repository (${path}). Give a path outside it.`);
  }
}

async function main() {
  localOnly(process.env.DATABASE_URL);
  const arg = process.argv[2] ?? DEFAULT_DIR;
  const file = /\.json$/i.test(arg) ? resolve(arg) : join(resolve(arg), `catalogue-${new Date().toISOString().slice(0, 10)}.json`);
  outsideTheRepo(file);

  const prisma = new PrismaClient();
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
