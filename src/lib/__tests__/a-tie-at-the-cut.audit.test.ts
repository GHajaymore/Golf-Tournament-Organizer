import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TIE FOR THE LAST PLACE AT A STROKE CUT, ON REAL ROWS (2026-10-23).
 *
 * Two halves.
 *
 * THE COUNTBACK, WORKED FROM THE RULE. Committee Procedures 5A(6): the last 9
 * holes, then the last 6, the last 3 and the last hole — a nine-hole round
 * starts at the last 6 — on the basis the competition is decided by. Each
 * expectation below is worked in THIS file from the raw cards, by summing the
 * tail of each card, and for net by giving strokes on the holes whose stroke
 * index is within the player's handicap: a route the code does not take (it
 * sorts the board and asks `countbackCompare`). On gross and net, eighteen and
 * nine holes. The fixtures are built so the answer on the WRONG basis is the
 * other player, so a countback read on gross for a net round goes red.
 *
 * Where the R&A recommends, for a NET countback, deducting a half, a third, a
 * sixth and an eighteenth of the handicap rather than reading the strokes hole
 * by hole, the board reads them hole by hole. The net fixtures are built so the
 * two methods agree — this asserts the cut, not that choice, which is in
 * `docs/deferred-register.md`.
 *
 * THE PLAY-OFF, DONE AS THE SECRETARY WOULD: closing the round is refused with
 * the tie named, nobody in it is told they are out, the play-off is recorded,
 * and the round then closes and the cut gives round 2 cards to the leader and
 * the winner — nobody else.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setRoundClosed, settleCutTie, setStageCutTies } from "@/app/actions/tournament";
import { strokeCutOutcomeOf, strokeCutField } from "@/lib/services/stroke-cut";
import { loadEventState, standingRows, cutLineNote } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";

const prisma = new PrismaClient();
const TAG = "zz-cut-tie";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

let orgId = "";
let adminUser = "";

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  adminUser = (
    await prisma.user.create({ data: { email: `${TAG}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() }, select: { id: true } })
  ).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

interface Spec {
  label: string;
  holes: number[];
  handicap: number;
}

/** A two-round championship, round 2 cut to `count`, every round 1 card approved. */
async function championship(opts: {
  name: string;
  pars: number[];
  si: number[];
  basis: "gross" | "net";
  count: number;
  cutTies: string;
  players: Spec[];
}) {
  const event = await prisma.event.create({
    data: {
      name: `${TAG} ${opts.name}`,
      organizationId: orgId,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${opts.name}-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(opts.pars),
      customStrokeIndex: JSON.stringify(opts.si),
    },
    select: { id: true },
  });
  const base = {
    eventId: event.id,
    type: "Stroke Play Round",
    format: "Individual Stroke Play",
    holes: opts.pars.length,
    scoringBasis: opts.basis,
    // The full handicap, so a player's strokes are their handicap and nothing
    // in this file depends on an allowance's rounding.
    handicapAllowance: 100,
  };
  const r1 = (await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" }, select: { id: true } })).id;
  const r2 = (
    await prisma.stage.create({
      data: { ...base, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: opts.count, cutTies: opts.cutTies },
      select: { id: true },
    })
  ).id;
  const id: Record<string, string> = {};
  for (const [i, p] of opts.players.entries()) {
    const email = `${TAG}-${opts.name}-${p.label}@example.invalid`.toLowerCase();
    id[p.label] = (
      await prisma.player.create({
        data: { eventId: event.id, name: `${TAG} ${p.label}`, email, seed: i + 1, status: "confirmed", handicap: p.handicap },
        select: { id: true },
      })
    ).id;
    await prisma.scorecard.create({
      data: { eventId: event.id, stageId: r1, playerId: id[p.label], strokes: JSON.stringify(p.holes), status: "approved" },
    });
  }
  await prisma.account.create({ data: { eventId: event.id, name: `${TAG} Admin`, email: `${TAG}-admin@example.invalid`, role: "admin" } });
  return { eventId: event.id, r1, r2, id };
}

async function as(eventId: string) {
  jar.clear();
  await createSession(adminUser);
  await setActiveEvent(eventId);
}

/**
 * THE RULE, BY HAND: the last 9, 6, 3 and 1 holes (from 6 on a nine), per-hole
 * figures on the round's basis. Negative when `a` wins. 0 when nothing splits.
 */
function countbackByHand(a: number[], b: number[]): number {
  const steps = a.length >= 18 ? [9, 6, 3, 1] : [6, 3, 1];
  for (const n of steps) {
    let sa = 0;
    let sb = 0;
    for (let i = a.length - n; i < a.length; i += 1) {
      sa += a[i];
      sb += b[i];
    }
    if (sa !== sb) return sa - sb;
  }
  return 0;
}

/** Net per hole, by hand: a stroke on every hole whose index is within the handicap. */
const netByHand = (gross: number[], si: number[], strokes: number) =>
  gross.map((g, i) => g - (si[i] <= strokes ? 1 : 0) - (si[i] + si.length <= strokes ? 1 : 0));

const flat = (n: number, v = 4) => new Array(n).fill(v);
const SI18 = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const SI9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SI9_LATE = [9, 8, 7, 6, 5, 4, 3, 2, 1];

describe("a countback cut, worked from the rule", () => {
  /**
   * Each case: LEAD is clear; A and B are level on the round's basis for the
   * second of two places. The rule, worked here, says which goes through.
   */
  const cases = [
    {
      name: "gross-18",
      basis: "gross" as const,
      si: SI18,
      // Both 72. A: back nine 35 — but a 5 on the LAST hole, so a countback
      // that skipped the ladder and read the last hole alone would send B.
      // B: all fours, back nine 36. The last nine sends A through.
      players: [
        { label: "LEAD", handicap: 0, holes: [...flat(17), 3].map((v, i) => (i === 0 ? 3 : v)) },
        { label: "A", handicap: 0, holes: [5, ...flat(8), 4, 4, 4, 4, 4, 3, 3, 4, 5] },
        { label: "B", handicap: 0, holes: flat(18) },
        { label: "LAST", handicap: 0, holes: flat(18, 5) },
      ],
    },
    {
      name: "net-18",
      basis: "net" as const,
      si: SI18,
      /**
       * Net 72 each. A off 0: all fours, back nine 36. B off 9: 81 gross, the
       * back nine 37 with strokes on SI 2, 4, 6, 8 — net 33 hole by hole, and
       * 37 - 4.5 = 32.5 by the R&A's fractions, so both methods send B. On GROSS
       * the back nine is 36 against 37 and would send A: the basis decides it.
       */
      players: [
        { label: "LEAD", handicap: 0, holes: flat(18, 3) },
        { label: "A", handicap: 0, holes: flat(18) },
        { label: "B", handicap: 9, holes: [...flat(8, 5), 4, 5, ...flat(8)] },
        { label: "LAST", handicap: 0, holes: flat(18, 6) },
      ],
    },
    {
      name: "gross-9",
      basis: "gross" as const,
      si: SI9,
      // A nine: the ladder starts at the last 6. Both 36. A's last six 23
      // against B's 24 — with a 5 on the last hole, so the last hole alone
      // would send B.
      players: [
        { label: "LEAD", handicap: 0, holes: flat(9, 3) },
        { label: "A", handicap: 0, holes: [5, 4, 4, 4, 4, 4, 3, 3, 5] },
        { label: "B", handicap: 0, holes: flat(9) },
        { label: "LAST", handicap: 0, holes: flat(9, 6) },
      ],
    },
    {
      name: "net-9",
      basis: "net" as const,
      // The hardest holes are the LAST ones here, so B's strokes fall in the
      // last six and the net countback reads them.
      si: SI9_LATE,
      /**
       * A off 0 on fours, net 36. B's strokes are whatever the board gives an
       * index of 8 over nine holes (read below, not assumed — at least three);
       * B's card puts its extra strokes on holes 1–3 and its last six at 26,
       * ending with a 6: worse than A's 24 on gross, better on net once three
       * strokes land there, and worse on the last hole alone (net 5 against
       * 4). The precondition below makes the fixture prove the two are level.
       */
      players: [
        { label: "LEAD", handicap: 0, holes: flat(9, 3) },
        { label: "A", handicap: 0, holes: flat(9) },
        { label: "B", handicap: 8, holes: [] as number[] },
        { label: "LAST", handicap: 0, holes: flat(9, 7) },
      ],
    },
  ];

  for (const c of cases) {
    it(`${c.name}: the cut sends through whom the rule does`, async () => {
      const pars = flat(c.si.length);
      let players = c.players;
      if (c.name === "net-9") {
        // B's playing handicap first, from a throwaway card, so the fixture
        // can be built level on net rather than hoping it is.
        const probe = await championship({ name: `${c.name}-probe`, pars, si: c.si, basis: "net", count: 2, cutTies: "countback", players: [{ label: "B", handicap: 8, holes: flat(9, 5) }] });
        const s = (await loadEventState(probe.eventId))!.strokeStandings[0];
        const ph = s.gross - s.net;
        expect(ph, "a nine-hole handicap of a few strokes").toBeGreaterThanOrEqual(3);
        expect(ph, "no more strokes than the last six can hold").toBeLessThanOrEqual(6);
        // Net 36: gross 36 + ph, last six 26 ending in a 6, the rest on holes 1-3.
        const front = 36 + ph - 26;
        const first3 = [Math.ceil(front / 3), Math.ceil((front - Math.ceil(front / 3)) / 2)];
        first3.push(front - first3[0] - first3[1]);
        players = c.players.map((p) => (p.label === "B" ? { ...p, holes: [...first3, 4, 4, 4, 4, 4, 6] } : p));
      }
      const t = await championship({ name: c.name, pars, si: c.si, basis: c.basis, count: 2, cutTies: "countback", players });
      const state = (await loadEventState(t.eventId, t.r1))!;
      const row = (who: string) => state.strokeStandings.find((s) => s.player.id === t.id[who])!;
      // PRECONDITION: A and B really are level on the round's basis.
      expect(c.basis === "net" ? row("A").net : row("A").gross, `${c.name}: level`).toBe(c.basis === "net" ? row("B").net : row("B").gross);

      // The rule, by hand, on the basis — and on the other one, which must disagree.
      const holesOf = (who: string) => players.find((p) => p.label === who)!.holes;
      const strokesOf = (who: string) => row(who).gross - row(who).net;
      const onBasis = (who: string, basis: "gross" | "net") =>
        basis === "gross" ? holesOf(who) : netByHand(holesOf(who), c.si, strokesOf(who));
      const expected = countbackByHand(onBasis("A", c.basis), onBasis("B", c.basis)) < 0 ? "A" : "B";
      const other = countbackByHand(onBasis("A", c.basis === "net" ? "gross" : "net"), onBasis("B", c.basis === "net" ? "gross" : "net"));
      if (c.basis === "net") expect(other < 0 ? "A" : other > 0 ? "B" : "level", `${c.name}: gross would decide it differently`).not.toBe(expected);
      // And the ladder matters: the last hole alone would not give this answer.
      const last = (who: string) => onBasis(who, c.basis)[onBasis(who, c.basis).length - 1];
      expect(last("A") < last("B") ? "A" : last("A") > last("B") ? "B" : "level", `${c.name}: the last hole alone`).not.toBe(expected);

      const made = (await strokeCutOutcomeOf(t.eventId, t.r1))!;
      expect(made.outcome.undecided, `${c.name}: the countback separated them`).toEqual([]);
      expect([...made.outcome.through].sort()).toEqual([t.id.LEAD, t.id[expected]].sort());
    });
  }

  it("CONTROL: identical cards cannot be split, so the cut waits on a draw", async () => {
    const t = await championship({
      name: "identical",
      pars: flat(18),
      si: SI18,
      basis: "gross",
      count: 2,
      cutTies: "countback",
      players: [
        { label: "LEAD", handicap: 0, holes: flat(18, 3) },
        { label: "A", handicap: 0, holes: flat(18) },
        { label: "B", handicap: 0, holes: flat(18) },
      ],
    });
    const made = (await strokeCutOutcomeOf(t.eventId, t.r1))!;
    expect(made.outcome.undecided).toEqual([{ groupId: null, playerIds: expect.arrayContaining([t.id.A, t.id.B]), places: 1, by: "draw" }]);
  });
});

describe("a play-off for the last place, as the secretary settles it", () => {
  it("refuses the cut while it is owed, tells nobody they are out, then makes it", async () => {
    // Top 2: LEAD on 70; A, B and C on 72 for one place (different routes, so
    // the board's countback ranks them — a play-off is owed to all three).
    const t = await championship({
      name: "playoff",
      pars: flat(18),
      si: SI18,
      basis: "gross",
      count: 2,
      cutTies: "playoff",
      players: [
        { label: "LEAD", handicap: 0, holes: [3, 3, ...flat(16)] },
        { label: "A", handicap: 0, holes: [5, ...flat(16), 3] },
        { label: "B", handicap: 0, holes: flat(18) },
        { label: "C", handicap: 0, holes: [3, ...flat(16), 5] },
        { label: "D", handicap: 0, holes: flat(18, 5) },
      ],
    });
    await as(t.eventId);

    // 1. Closing round 1 is refused, at the press, with the tie named.
    const refused = await setRoundClosed(t.r1, true);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/A, .*B and .*C are level for the last place/);
    expect(refused.error).toMatch(/play-off/);
    expect((await prisma.stage.findUnique({ where: { id: t.r1 }, select: { closedAt: true } }))?.closedAt).toBeNull();
    expect(await strokeCutField(t.eventId, t.r2), "no cut made: round 2 is still everybody's").toBeNull();

    // 2. Nobody in the tie is told they are out — on the board, the export's
    //    status, the cut note players read, or their own Today.
    const state = (await loadEventState(t.eventId))!;
    const rows = standingRows(state);
    for (const who of ["A", "B", "C"]) {
      const r = rows.find((x) => x.id === t.id[who])!;
      expect(r.tiedAtCut, `${who} is marked as in the tie`).toBe(true);
      expect(r.advancing, `${who} is not provisionally picked`).toBe(false);
      expect(r.missedCut).toBe("");
    }
    expect(rows.find((x) => x.id === t.id.LEAD)!.advancing).toBe(true);
    expect(rows.find((x) => x.id === t.id.D)!.tiedAtCut, "control: D is simply behind").toBe(false);
    expect(cutLineNote(state)).toMatch(/nobody in the tie has missed the cut/);
    const me = await meFor(state, `${TAG}-playoff-b@example.invalid`);
    expect(me.round?.cutOut ?? "").toBe("");

    // 3. A wrong record is refused where it is pressed.
    const two = await settleCutTie(t.r1, [t.id.A, t.id.B, t.id.C], [t.id.A, t.id.B]);
    expect(two).toEqual({ ok: false, error: expect.stringMatching(/Pick the one player who went through/) });
    const stranger = await settleCutTie(t.r1, [t.id.A, t.id.B, t.id.C], [t.id.D]);
    expect(stranger.ok).toBe(false);
    const notTied = await settleCutTie(t.r1, [t.id.A, t.id.D], [t.id.A]);
    expect(notTied.ok).toBe(false);

    // 4. B won the play-off. The round closes and the cut is made.
    expect(await settleCutTie(t.r1, [t.id.C, t.id.A, t.id.B], [t.id.B])).toEqual({ ok: true });
    expect(await setRoundClosed(t.r1, true)).toEqual({ ok: true });
    const holders = (await prisma.scorecard.findMany({ where: { stageId: t.r2 }, select: { playerId: true } })).map((c) => c.playerId).sort();
    expect(holders).toEqual([t.id.LEAD, t.id.B].sort());
    const log = await prisma.auditLog.findFirst({ where: { eventId: t.eventId, action: "cut-applied" } });
    expect(log?.detail ?? "").toMatch(/B went through on the play-off for the last place/);
  });

  it("the organizer chooses the rule: 'ties' sends all three through without asking", async () => {
    const t = await championship({
      name: "ties",
      pars: flat(18),
      si: SI18,
      basis: "gross",
      count: 2,
      cutTies: "playoff",
      players: [
        { label: "LEAD", handicap: 0, holes: [3, 3, ...flat(16)] },
        { label: "A", handicap: 0, holes: [5, ...flat(16), 3] },
        { label: "B", handicap: 0, holes: flat(18) },
        { label: "C", handicap: 0, holes: [3, ...flat(16), 5] },
      ],
    });
    await as(t.eventId);
    // Part of the cut's published terms, so it locks with setup at launch.
    await expect(setStageCutTies(t.r2, "ties")).rejects.toThrow(/locked/);
    await prisma.event.update({ where: { id: t.eventId }, data: { configUnlocked: true } });
    await setStageCutTies(t.r2, "ties");
    expect((await prisma.stage.findUnique({ where: { id: t.r2 }, select: { cutTies: true } }))?.cutTies).toBe("ties");
    expect(await setRoundClosed(t.r1, true)).toEqual({ ok: true });
    expect(await prisma.scorecard.count({ where: { stageId: t.r2 } })).toBe(4);
  });
});
