import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { byAddress } from "@/lib/domain/my-entry";
import { readSource } from "./source";

/**
 * A PLAYER IS FOUND BY ADDRESS ONE WAY: `...byAddress(email)` in the query.
 *
 * Until 2026-10-14, 27 player queries in 23 files wrote `email: { equals: …,
 * mode: "insensitive" }` out for themselves — "my" entries on the dashboard,
 * score entry, the player layout, prizes, availability, a group's game, the
 * skins pot, contests, side games, the cup, whose match a person may score,
 * messaging, entering and withdrawing, attendance, the club calendar and event
 * list, the clash warning; and the double-entry checks — and most had no
 * refusal for an empty address, which matches every entry made without one.
 * `byAddress` matches nobody for an empty address, so a query built with it
 * cannot hand one person everybody's.
 *
 * The database half is in `an-empty-address-is-nobody.audit.test.ts`.
 */
describe("the one rule", () => {
  it("is a case-blind match on the address, trimmed", () => {
    expect(byAddress(" Sam@Example.Invalid ")).toEqual({ email: { equals: "Sam@Example.Invalid", mode: "insensitive" } });
  });

  it("is a condition no row meets for an empty address", () => {
    for (const nobody of ["", "   ", null, undefined]) {
      expect(byAddress(nobody), String(nobody)).toEqual({ id: { in: [] } });
    }
  });
});

describe("no player query writes its own", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const files = sources("src");

  /** Each player query's own argument, from its opening bracket to the one that closes it. */
  function playerQueries(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/\b(prisma|tx)\.player\.(findFirst|findMany|findUnique|count|groupBy|updateMany|deleteMany)\(/g)) {
      let depth = 0;
      const from = (m.index ?? 0) + m[0].length - 1;
      for (let i = from; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")" && --depth === 0) {
          out.push(text.slice(from, i + 1));
          break;
        }
      }
    }
    return out;
  }
  const byOwnAddress = (text: string) => playerQueries(text).some((q) => /\bemail:\s*\{\s*equals/.test(q));

  it("CONTROL: the sweep reads the app, recognises the queries it replaced, and reads one query at a time", () => {
    expect(files.length).toBeGreaterThan(400);
    for (const old of [
      'const r = await prisma.player.findMany({\n    where: { eventId: session.eventId, email: { equals: session.email, mode: "insensitive" }, status: "confirmed" },\n    select: { id: true },\n  });',
      'const me = await prisma.player.findFirst({\n    where: {\n      eventId,\n      email: { equals: (session.email ?? "").trim(), mode: "insensitive" },\n      status: "confirmed",\n    },\n  });',
      'await prisma.player.count({ where: { eventId, email: { equals: cleanEmail, mode: "insensitive" }, status: { not: "withdrawn" } } });',
    ]) {
      expect(byOwnAddress(old), old).toBe(true);
    }
    // Two queries side by side are two: an address in the second is not read into the first.
    const pair = 'await prisma.player.groupBy({ by: ["eventId"], where: { status: "confirmed" } });\nawait prisma.account.findFirst({ where: { email: { equals: e, mode: "insensitive" } } });';
    expect(playerQueries(pair)).toHaveLength(1);
    expect(byOwnAddress(pair)).toBe(false);
    expect(byOwnAddress('prisma.player.findMany({ where: { eventId, ...byAddress(session.email), status: "confirmed" } })')).toBe(false);
  });

  it("every player query by address is built with byAddress", () => {
    const strays = files.filter((f) => !f.endsWith("domain/my-entry.ts") && byOwnAddress(readSource(f)));
    expect(strays, "find a player by email with ...byAddress(email)").toEqual([]);
  });
});
