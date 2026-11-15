import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";

/**
 * THE OLD MESSAGING FIELD NAMES ARE GONE FROM EVERY READER, TYPED OR NOT
 * (J39/J40 PR 2; design §2.1 and risk 1).
 *
 * The who-key renamed four Prisma fields ONLY (`@map`, no SQL): `authorEmail`
 * → `authorKey`, `createdByEmail` → `createdByKey`, and `email` → `whoKey` on
 * `ThreadParticipant` and `ThreadRead`. The compiler lists every typed reader.
 * It cannot see a `.mjs` or `.js` file: `scripts/seed-club.mjs` wrote all
 * three through the client, and after the rename it would have failed at
 * RUNTIME — the e2e seed, `smoke:all` and the demo data, all at once.
 *
 * So this sweeps every `.ts`, `.tsx`, `.mjs` and `.js` outside
 * `prisma/migrations` for the Prisma spelling. Raw SQL naming the COLUMN
 * (`"authorEmail"`, in double quotes) is fine: the database column keeps its
 * name, which is the whole point of `@map`.
 */

const ROOTS = ["src", "scripts", "e2e", "prisma"];
const SKIP = new Set(["node_modules", "migrations", ".next", ".next-ci", ".next-e2e"]);
const SELF = "src/lib/__tests__/old-messaging-field-names-are-gone.test.ts";

function files(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}

/** Every place `src` spells an old field the Prisma way. */
export function oldFieldNames(src: string): string[] {
  const code = stripComments(src).replace(/\r\n/g, "\n");
  const found: string[] = [];
  // The renamed fields, but not the column in double quotes (raw SQL).
  for (const m of code.matchAll(/(?<!["\w])(authorEmail|createdByEmail|threadId_email)(?!["\w])/g)) found.push(m[1]);
  // `email` inside a ThreadParticipant or ThreadRead call: `prisma.threadParticipant.createMany({ data: [{ threadId, email }] })`.
  for (const m of code.matchAll(/\b(threadParticipant|threadRead)\s*\.\s*\w+\s*\(/g)) {
    const from = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = from;
    for (; i < code.length && depth > 0; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") depth -= 1;
    }
    if (/(?<![\w."])email(?![\w"])\s*[:,}]/.test(code.slice(from, i))) found.push(`${m[1]} { email }`);
  }
  return found;
}

describe("the old messaging field names are gone", () => {
  it("no source outside prisma/migrations names them the Prisma way", () => {
    const hits = ROOTS.flatMap((r) => files(r))
      .filter((f) => f !== SELF)
      .flatMap((f) => oldFieldNames(readFileSync(f, "utf8")).map((h) => `${f}: ${h}`));
    expect(hits, "renamed in schema.prisma (authorKey, createdByKey, whoKey): an untyped reader fails at runtime").toEqual([]);
  });

  it("CONTROL: the seed's old lines are seen", () => {
    const seed = `await prisma.thread.create({ data: { createdByEmail: organizer.email } });
await prisma.threadParticipant.createMany({ data: [{ threadId: clubThread.id, email: organizer.email }] });
await prisma.message.create({ data: { threadId: t.id, authorEmail: organizer.email } });
await prisma.threadRead.upsert({ where: { threadId_email: { threadId, email } } });`;
    expect(oldFieldNames(seed)).toEqual(["createdByEmail", "authorEmail", "threadId_email", "threadParticipant { email }", "threadRead { email }"]);
  });

  it("NEGATIVE CONTROL: raw SQL naming the unchanged column, and the new spellings, are not", () => {
    expect(oldFieldNames(`await prisma.$queryRaw\`SELECT "authorEmail" FROM "Message"\`;`)).toEqual([]);
    expect(oldFieldNames(`await prisma.threadParticipant.createMany({ data: [{ threadId: t.id, whoKey: organizer.email }] });`)).toEqual([]);
    expect(oldFieldNames(`await prisma.message.create({ data: { authorKey: ctx.whoKey } });`)).toEqual([]);
  });
});
