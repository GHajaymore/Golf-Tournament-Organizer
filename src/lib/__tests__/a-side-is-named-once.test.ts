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
 * The shape banned, not one spelling of it: any `team.findMany`, `findUnique`
 * or `findFirst` that looks a team up BY ID and selects (or includes) its own
 * name, in any order of fields. Reading every team of an event, or a team's
 * members' names, is a different question and is left.
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

  /** The text between the brace that opens at `open` and its match. */
  const block = (s: string, open: number): string => {
    let depth = 0;
    for (let i = open; i < s.length; i += 1) {
      if (s[i] === "{") depth += 1;
      else if (s[i] === "}" && --depth === 0) return s.slice(open + 1, i);
    }
    return s.slice(open + 1);
  };
  /** The same text with every nested `{ ... }` taken out, leaving only the top-level fields. */
  const topLevel = (b: string): string => {
    let depth = 0;
    let out = "";
    for (const ch of b) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (depth === 0) out += ch;
    }
    return out;
  };
  const keyed = (call: string, key: "where" | "select" | "include"): string | null => {
    const m = new RegExp(`\\b${key}:\\s*\\{`).exec(call);
    return m ? block(call, m.index + m[0].length - 1) : null;
  };

  const copies = (src: string) => {
    const found: number[] = [];
    const call = /\bteam\.find(?:Many|Unique|First)(?:OrThrow)?\(\s*\{/g;
    for (let m = call.exec(src); m; m = call.exec(src)) {
      const body = block(src, m.index + m[0].length - 1);
      const where = keyed(body, "where");
      const shown = keyed(body, "select") ?? keyed(body, "include");
      const byId = where !== null && /\bid\s*:\s*(?!true\b)/.test(where);
      const named = shown !== null && /\bname\s*:\s*true\b/.test(topLevel(shown));
      if (byId && named) found.push(m.index);
    }
    return found;
  };

  it("CONTROL: the sweep sees the copy it replaced, however it is spelled, and not a different question", () => {
    const old = "await prisma.team.findMany({ where: { id: { in: [a, b] }, eventId }, select: { id: true, name: true } })";
    expect(copies(old)).toHaveLength(1);
    // reordered, with other fields
    expect(copies("prisma.team.findMany({ where: { id: { in: ids }, eventId }, select: { name: true, seed: true, id: true } })")).toHaveLength(1);
    expect(copies("prisma.team.findMany({ select: { name: true }, where: { eventId, id: { in: ids } } })")).toHaveLength(1);
    // another finder
    expect(copies("prisma.team.findUnique({ where: { id: teamId }, select: { name: true } })")).toHaveLength(1);
    expect(copies("tx.team.findFirst({ where: { id: teamId, eventId }, select: { id: true, name: true } })")).toHaveLength(1);
    // not by id: every team of an event
    expect(copies("prisma.team.findMany({ where: { eventId }, select: { id: true, name: true } })")).toHaveLength(0);
    // no name
    expect(copies("prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true } })")).toHaveLength(0);
    // cup.ts reads members' names for a cup's cards: a different question.
    expect(
      copies("prisma.team.findMany({ where: { id: { in: ids }, eventId }, select: { id: true, members: { select: { player: { select: { name: true } } } } } })"),
    ).toHaveLength(0);
  });

  it("is looked up in services/side-names.ts and nowhere else", () => {
    const where = sources("src")
      .filter((f) => copies(readSource(f)).length > 0)
      .map((f) => f.replace(/\\/g, "/"));
    // The one listed exemption: removing a league pair (actions/league.ts) needs the
    // pair to BE one of this league's (`clubGroupId` set) as well as its name; it names
    // no side of a match.
    expect(where).toEqual(["src/app/actions/league.ts", "src/lib/services/side-names.ts"]);
  });

  it("is asked by all five readers that name a team match's sides", () => {
    for (const file of [
      ["src", "lib", "services", "match-card.ts"],
      ["src", "lib", "services", "casual-round.ts"],
      ["src", "lib", "services", "tournament-result.ts"],
      ["src", "app", "(player)", "me", "match", "page.tsx"],
      ["src", "app", "play", "page.tsx"],
    ]) {
      expect(readSource(...file), file.join("/")).toContain("sideNamesOf(");
    }
  });
});
