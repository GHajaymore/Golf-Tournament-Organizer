import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A SIDE IS NAMED ONCE: `sideNamesOf` (services/side-names.ts).
 *
 * A team match leaves its player columns empty, so its sides are named by the
 * team's own name. Five readers wrote that query out for themselves (the match
 * card, the casual summary, the day's result line, `/me/match`, `/play`), and
 * the result line did not know to: it said "Side A beat Side B". They ask
 * `sideNamesOf` now; a sixth copy is refused here.
 *
 * The shape banned: a `team.findMany` that looks teams up BY ID and selects
 * their name. (Reading every team of an event, or a team's members, is a
 * different question and is left.)
 */
describe("a side's name", () => {
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

  /** Every `team.findMany(` whose next 260 characters look a team up by id and select its name. */
  const copies = (src: string) => {
    const found: number[] = [];
    for (let at = src.indexOf("team.findMany("); at !== -1; at = src.indexOf("team.findMany(", at + 1)) {
      const call = src.slice(at, at + 260);
      if (/id:\s*\{\s*in:/.test(call) && /select:\s*\{\s*id:\s*true,\s*name:\s*true\s*\}/.test(call)) found.push(at);
    }
    return found;
  };

  it("CONTROL: the sweep sees the copy it replaced, and not a different question", () => {
    const old = "await prisma.team.findMany({ where: { id: { in: [a, b] }, eventId }, select: { id: true, name: true } })";
    expect(copies(old)).toHaveLength(1);
    expect(copies("await prisma.team.findMany({ where: { eventId }, select: { id: true, name: true } })")).toHaveLength(0);
    expect(copies("await prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true } })")).toHaveLength(0);
    // cup.ts reads members' names for a cup's cards: a different question.
    expect(copies("prisma.team.findMany({ where: { id: { in: ids }, eventId }, select: { id: true, members: { select: { name: true } } } })")).toHaveLength(0);
  });

  it("is looked up in services/side-names.ts and nowhere else", () => {
    const where = sources("src")
      .filter((f) => copies(readSource(f)).length > 0)
      .map((f) => f.replace(/\\/g, "/"));
    expect(where).toEqual(["src/lib/services/side-names.ts"]);
  });

  it("is asked by the three readers that name a team match's sides", () => {
    for (const file of ["match-card.ts", "casual-round.ts", "tournament-result.ts"]) {
      expect(readSource("src", "lib", "services", file), file).toContain("sideNamesOf(");
    }
  });
});
