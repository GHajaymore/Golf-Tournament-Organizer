/**
 * RESTORE A PRODUCTION BACKUP (B21). The runbook is docs/operations/backups.md.
 *
 * THE DRILL — restore into a throwaway database on THIS machine, check it, drop it:
 *
 *   npx tsx scripts/backup-restore.ts --verify <file.thqbak> --key <private.pem>
 *
 *   --key -          reads the private key from standard input instead of a file
 *                    (paste it, then Ctrl+Z Enter on Windows / Ctrl+D elsewhere)
 *   --server <url>   the local Postgres to make the throwaway on; by default
 *                    RESTORE_SERVER_URL, else the server in .env's DATABASE_URL.
 *                    Only localhost is accepted. The throwaway is named
 *                    tourneyhq_restore_drill_<time>; nothing else is touched.
 *
 * A REAL RESTORE — into a database somebody made empty for it (an incident only):
 *
 *   npx tsx scripts/backup-restore.ts --into <empty-database-url> <file.thqbak> --key <private.pem>
 *
 *   The target must have NO tables, or nothing happens: that is what makes it
 *   impossible to restore over production or any database in use. Pass the URL
 *   in an environment variable you name (e.g. --into "$RESTORE_INTO"), never
 *   one called DATABASE_URL, and never write it into a file in this folder.
 *
 * WHAT IT PRINTS: table names, row counts, match or MISMATCH, and the time
 * taken. Never a row. The plaintext is never written to disk: the file is
 * opened, unzipped and loaded as it streams.
 *
 * Run it from a checkout of the commit the backup names (its manifest's
 * `commit`): the restore refuses a backup whose migrations differ from the
 * checkout's, and says which commit to check out.
 */
import "dotenv/config";
import { closeSync, createReadStream, openSync, readFileSync, readSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { readPrivateKey, keyIdOf, sealedKeyId } from "../src/lib/backup/sealed";
import { databaseUrlNamed, isLocalHost, restoreInto, type RestoreResult } from "../src/lib/backup/restore";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function usage(message: string): never {
  console.error(`${message}\n\nUsage:\n  npx tsx scripts/backup-restore.ts --verify <file.thqbak> --key <private.pem | ->\n  npx tsx scripts/backup-restore.ts --into <empty-database-url> <file.thqbak> --key <private.pem | ->`);
  process.exit(2);
}

async function readKeyText(where: string): Promise<string> {
  if (where !== "-") return readFileSync(where, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function printResult(r: RestoreResult): boolean {
  const width = Math.max(...r.checks.map((c) => c.name.length), 5);
  console.log(`\n${"table".padEnd(width)}  ${"backup".padStart(9)}  ${"restored".padStart(9)}  check`);
  for (const c of r.checks) {
    console.log(`${c.name.padEnd(width)}  ${String(c.expected).padStart(9)}  ${String(c.found).padStart(9)}  ${c.match ? "match" : "MISMATCH"}`);
  }
  const bad = r.checks.filter((c) => !c.match).length;
  const rows = r.checks.reduce((n, c) => n + c.found, 0);
  console.log(`\n${r.checks.length} tables, ${rows} rows, ${bad ? `${bad} MISMATCH` : "every table matches (rows and SHA-256)"}`);
  console.log(`backup taken ${r.manifest.startedAt} at commit ${r.manifest.commit || "(not recorded)"}, migration ${r.manifest.migrationHead}`);
  console.log(`restored and checked in ${r.seconds} s`);
  return bad === 0;
}

async function main() {
  const verifyFile = arg("--verify");
  const into = arg("--into");
  const keyWhere = arg("--key");
  if (!keyWhere) usage("--key is required.");
  if (!!verifyFile === !!into) usage("Give exactly one of --verify <file> or --into <url> <file>.");
  const file = verifyFile ?? process.argv[process.argv.indexOf("--into") + 2];
  if (!file || file.startsWith("--")) usage("Which .thqbak file?");

  const key = readPrivateKey(await readKeyText(keyWhere));
  const fd = openSync(file, "r");
  const head = Buffer.alloc(64 * 1024);
  const got = readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  const sealedTo = sealedKeyId(head.subarray(0, got));
  if (sealedTo && sealedTo !== keyIdOf(key)) {
    console.error(`This backup was sealed to key ${sealedTo}; the key given is ${keyIdOf(key)}. Nothing was done.`);
    process.exit(1);
  }

  if (into) {
    const result = await restoreInto(into, createReadStream(file), key);
    process.exit(printResult(result) ? 0 : 1);
  }

  const serverFrom = arg("--server") ?? process.env.RESTORE_SERVER_URL ?? process.env.DATABASE_URL;
  if (!serverFrom) usage("No local Postgres: pass --server <url> or set RESTORE_SERVER_URL.");
  if (!isLocalHost(serverFrom)) usage("The drill runs only on a Postgres on this machine (localhost). Nothing was done.");
  const name = `tourneyhq_restore_drill_${Date.now()}`;
  const admin = new PrismaClient({ datasourceUrl: databaseUrlNamed(serverFrom, "postgres"), log: ["error"] });
  let ok = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    console.log(`throwaway database ${name} made; restoring…`);
    const result = await restoreInto(databaseUrlNamed(serverFrom, name), createReadStream(file), key);
    ok = printResult(result);
  } finally {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {
      console.error(`Could not drop ${name}: drop it by hand.`);
    });
    console.log(`throwaway database ${name} dropped`);
    await admin.$disconnect();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  // The refusals say what was wrong in words; nothing in them is a row or a key.
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "The restore failed.");
  process.exit(1);
});
