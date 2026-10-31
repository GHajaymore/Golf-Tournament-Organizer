import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { HoleResult } from "@/lib/domain/types";

/**
 * A TEAM CUP HAS ONE RESULT, AND EVERY READER OF "WHO WON" ASKS FOR IT.
 *
 * Seen on production, 2026-10-30, on a completed cup with every match
 * decided: /reports printed every player at P0 W0 ½0 L0 under "Final
 * standings", the honours board said "No ranked results yet", and the season
 * table read nothing from it. Each asked the ROUND-ROBIN standings — a cup's
 * matches sit on "Team Session" rounds, and the chain reads "Round Robin"
 * rounds only (`roundRobinStages`), so for a cup it is a table of zeroes.
 *
 * Built the way a club builds one — two teams, a lineup through
 * `addCupMatch`, announced with `publishCupLineup`, every match tapped in
 * through `saveMatchHoles`, the tournament completed with `setEventStatus` —
 * and then asked of the three readers: the report sheet's `cupResult`, the
 * final report, the honours candidate, and the season table. They must agree
 * on the winning TEAM and the score; and a halved cup crowns nobody.
 *
 *   npx vitest run --config vitest.audit.config.ts a-team-cup-has-one-result
 */

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addCupMatch, publishCupLineup } = await import("@/app/actions/cup");
const { saveMatchHoles, confirmMatches, setEventStatus } = await import("@/app/actions/tournament");
const { cupResult } = await import("@/lib/services/cup");
const { finalReport } = await import("@/lib/services/final-report");
const { championFor, championSuggestions } = await import("@/lib/services/honours");
const { seriesTable } = await import("@/lib/services/series");

const prisma = new PrismaClient();
const TAG = "zz-cup-result";
let orgId = "";

/** A match won 3&2 by `w`, or halved over eighteen — a card the tap screen sends. */
const card = (w: "A" | "B" | "H"): HoleResult[] =>
  w === "H"
    ? ["A", "B", ...Array<HoleResult>(16).fill("H")]
    : [...Array<HoleResult>(3).fill(w), ...Array<HoleResult>(13).fill("H"), null, null];

/**
 * A cup of ten singles, Oakmere v Elmbridge, played to the results given
 * (from Oakmere's side: "A" Oakmere won). Half the matches are STORED the other
 * way round — Elmbridge in the A columns — so the readers have to credit them
 * through the cup's own mapping, as `cupBoard` does.
 */
async function playCup(label: string, results: Array<"A" | "B" | "H">, holderTeam: "oak" | "elm" | null = null) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const series = await prisma.series.create({ data: { organizationId: orgId, name: `${TAG} season ${label}` } });
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      seriesId: series.id,
      name: `${TAG} ${label} cup`,
      status: "live",
      format: "match",
      dates: "2026",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `${TAG}-${stamp}`,
    },
  });
  const eventId = event.id;
  const oak = await prisma.group.create({ data: { eventId, name: `${TAG} Oakmere`, position: 0 } });
  const elm = await prisma.group.create({ data: { eventId, name: `${TAG} Elmbridge`, position: 1 } });
  if (holderTeam) {
    await prisma.event.update({ where: { id: eventId }, data: { cupHolderGroupId: holderTeam === "oak" ? oak.id : elm.id } });
  }
  const singles = await prisma.stage.create({
    data: { eventId, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles" },
  });
  let seed = 0;
  const mk = async (team: string, i: number, groupId: string) => {
    const name = `${TAG} ${team}${i}`;
    const email = `${TAG}-${team}${i}-${stamp}@example.invalid`;
    const member = await prisma.member.create({ data: { organizationId: orgId, name, email } });
    return (
      await prisma.player.create({
        data: { eventId, name, email, handicap: 10, seed: ++seed, status: "confirmed", groupId, memberId: member.id },
      })
    ).id;
  };
  const o: string[] = [];
  const e: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    o.push(await mk("Oak", i + 1, oak.id));
    e.push(await mk("Elm", i + 1, elm.id));
  }
  session = { eventId, email: `${TAG}-sec@example.invalid`, name: `${TAG} secretary`, role: "admin", viewRole: "admin", userId: "", accountId: "" };
  for (let i = 0; i < results.length; i += 1) {
    expect(await addCupMatch(singles.id, [o[i]], [e[i]])).toEqual({ ok: true });
  }
  expect(await publishCupLineup(singles.id)).toEqual({ ok: true });

  const matches = await prisma.match.findMany({ where: { stageId: singles.id }, orderBy: { round: "asc" } });
  expect(matches).toHaveLength(results.length);
  for (const [i, m] of matches.entries()) {
    const w = results[o.indexOf(m.playerAId) >= 0 ? o.indexOf(m.playerAId) : e.indexOf(m.playerAId)];
    // Oakmere stored in A unless this one is turned round below.
    let stored: "A" | "B" | "H" = w;
    if (i % 2 === 1) {
      // Turn the stored sides round: Elmbridge's player into the A column.
      await prisma.match.update({ where: { id: m.id }, data: { playerAId: m.playerBId, playerBId: m.playerAId } });
      stored = w === "A" ? "B" : w === "B" ? "A" : "H";
    }
    await saveMatchHoles(m.id, card(stored));
  }
  // The committee signs the results off, as Score entry asks before finishing.
  expect(await confirmMatches(matches.map((m) => m.id)), "signing the results off").toMatchObject({ ok: true, confirmed: results.length });
  expect(await setEventStatus("completed"), "completing the cup").toEqual({ ok: true });
  return { eventId, seriesId: series.id, oak: oak.id, elm: elm.id };
}

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (
    await prisma.organization.create({
      data: { name: `${TAG} club`, kind: "club", subscription: { create: { plan: "club", planTermsApply: true } } },
    })
  ).id;
});
afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  } finally {
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.$disconnect();
  }
});

describe("a cup won 6½–3½", () => {
  // Counted by hand: six to Oakmere, three to Elmbridge, one halved.
  const results: Array<"A" | "B" | "H"> = ["A", "B", "A", "H", "A", "A", "B", "A", "B", "A"];
  let f: Awaited<ReturnType<typeof playCup>>;
  beforeAll(async () => {
    f = await playCup("won", results);
  }, 120_000);

  it("the report sheet's result names Oakmere and the score", async () => {
    const r = await cupResult(f.eventId);
    expect(r).not.toBeNull();
    expect(r!.outcome).toBe("won");
    expect(r!.teams.map((t) => t.points)).toEqual([6.5, 3.5]);
    expect(r!.scoreLine).toBe(`${TAG} Oakmere 6½–3½`);
  });

  it("the final report says the same score", async () => {
    const rep = await finalReport(f.eventId);
    expect(rep!.score).toEqual([6.5, 3.5]);
    expect(rep!.verdict).toEqual({ kind: "won", by: "A" });
  });

  it("the honours board offers the TEAM with its score, not 'no ranked results'", async () => {
    const pending = (await championSuggestions(orgId)).find((p) => p.eventId === f.eventId);
    expect(pending?.suggestion).toMatchObject({
      ok: true,
      playerId: f.oak,
      name: `${TAG} Oakmere`,
      team: { score: `${TAG} Oakmere 6½–3½` },
    });
    // The confirm path recomputes it the same way.
    expect((await championFor(orgId, f.eventId))!.suggestion).toEqual(pending!.suggestion);
  });

  it("the season places Oakmere's ten level first and Elmbridge's ten below them", async () => {
    const t = await seriesTable(f.seriesId);
    expect(t!.allowed).toBe(true);
    const top = t!.standings[0].total;
    const winners = t!.standings.filter((s) => s.name.startsWith(`${TAG} Oak`));
    const losers = t!.standings.filter((s) => s.name.startsWith(`${TAG} Elm`));
    expect(winners).toHaveLength(10);
    expect(losers).toHaveLength(10);
    expect(new Set(winners.map((s) => s.total))).toEqual(new Set([top]));
    expect(Math.max(...losers.map((s) => s.total))).toBeLessThan(top);
    // Places, not only points: ten share first, so the next place is eleventh.
    expect(new Set(winners.map((s) => s.finishes.join()))).toEqual(new Set(["1"]));
    expect(new Set(losers.map((s) => s.finishes.join()))).toEqual(new Set(["11"]));
    expect(t!.unplaced).toBe(0);
  });
});

describe("a halved cup", () => {
  // Four each and two halved: 5–5. Elmbridge hold the cup.
  const results: Array<"A" | "B" | "H"> = ["A", "B", "H", "B", "A", "A", "B", "H", "B", "A"];
  let f: Awaited<ReturnType<typeof playCup>>;
  beforeAll(async () => {
    f = await playCup("halved", results, "elm");
  }, 120_000);

  it("says it was halved, and names no champion", async () => {
    const r = await cupResult(f.eventId);
    expect(r!.outcome).toBe("halved");
    expect(r!.champion).toBeNull();
    expect(r!.scoreLine).toBe("Halved 5–5");
  });

  it("the honours board refuses it, holders or not", async () => {
    const pending = (await championSuggestions(orgId)).find((p) => p.eventId === f.eventId);
    expect(pending?.suggestion).toMatchObject({ ok: false, reason: "cup-halved" });
  });

  it("the season places all twenty level", async () => {
    const t = await seriesTable(f.seriesId);
    expect(t!.standings).toHaveLength(20);
    expect(new Set(t!.standings.map((s) => s.total)).size).toBe(1);
  });
});
