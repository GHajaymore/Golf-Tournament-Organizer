import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * CLOSING A ROUND WITH A CARD MISSING HAS TWO ANSWERS (R12), against real rows, as the redesigned Score entry gives them.
 *
 * "No card returned" is not a stored fact: it is what closing the round MEANS for a player with no card. "Withdrew" is the
 * withdrawal path that already exists (`removeSignup`, which once launched always keeps the player). So this asserts what the
 * two answers do to the board, worked from the Rules by hand and not from the code's route.
 *
 * THE FIXTURE (a two-round medal, par 4 on every hole, gross, so no figure is the interesting part):
 *
 *   zz-Ann  plays both rounds: 72 + 72 = 144      → a place
 *   zz-Bo   plays both rounds: 73 + 73 = 146      → a place, behind Ann
 *   zz-Cy   returns Round 1 only (72)             → NO CARD RETURNED for Round 2
 *   zz-Di   returns Round 1 only (72), then "Withdrew" → WD
 *
 * By the Rules (3.3b: a card must be returned; a stroke competition's score is the total of its rounds), nobody without a
 * completed Round 2 has a 36-hole total, so Cy holds no place and the board says why in the round's own name. A WITHDRAWN player
 * is listed WD over the figures returned, beneath the field, and holds no place either. The CONTROL is the same fixture with
 * Round 2 still OPEN: Cy is ranked then, because "over" is the committee closing a round and never the calendar.
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
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { loadEventState, resultsSheetRows } from "@/lib/services/tournament";
import { setRoundClosed, removeSignup } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NOCARD";
const HOLES = 18;
const PARS = Array.from({ length: HOLES }, () => 4);
const level = JSON.stringify(PARS);
/** One over on the first hole: 73, for the second player. */
const oneOver = JSON.stringify(PARS.map((p, i) => (i === 0 ? p + 1 : p)));

const ids = { event: "", rounds: [] as string[], ann: "", bo: "", cy: "", di: "", ed: "" };

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} medal`,
      organizationId: org.id,
      status: "live",
      shape: "series",
      format: "stroke",
      sideStyle: "individual",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: HOLES }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  ids.event = ev.id;
  for (let i = 0; i < 2; i += 1) {
    const s = await prisma.stage.create({
      data: { eventId: ev.id, position: i, description: `Round ${i + 1}`, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: HOLES },
      select: { id: true },
    });
    ids.rounds.push(s.id);
  }
  const person = async (name: string, seed: number) =>
    (
      await prisma.player.create({
        data: { eventId: ev.id, name: `${TAG} ${name}`, email: `${TAG.toLowerCase()}-${name.toLowerCase()}@example.invalid`, seed, status: "confirmed", handicap: 0 },
        select: { id: true },
      })
    ).id;
  ids.ann = await person("Ann", 1);
  ids.bo = await person("Bo", 2);
  ids.cy = await person("Cy", 3);
  ids.di = await person("Di", 4);
  // Ed never began: no card in either round.
  ids.ed = await person("Ed", 5);
  const card = (stageId: string, playerId: string, strokes: string) =>
    prisma.scorecard.create({ data: { eventId: ev.id, stageId, playerId, strokes, status: "approved" } });
  for (const r of ids.rounds) {
    await card(r, ids.ann, level);
    await card(r, ids.bo, oneOver);
  }
  // Cy and Di return Round 1 only.
  await card(ids.rounds[0], ids.cy, level);
  await card(ids.rounds[0], ids.di, level);

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.account.create({ data: { eventId: ev.id, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" } });
  await createSession(user.id);
  await setActiveEvent(ev.id);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

const board = async () => {
  const state = (await loadEventState(ids.event))!;
  return { state, rows: resultsSheetRows(state) };
};

describe("closing a round with a card missing", () => {
  it("CONTROL: with Round 2 still open, the player with no Round 2 card is ranked", async () => {
    const { state } = await board();
    const ranked = state.strokeStandings.filter((s) => s.ranked).map((s) => s.player.id);
    expect(ranked, "an open round already takes a place").toContain(ids.cy);
  });

  it("No card returned: closing the round leaves the player no place, in the round's own name, and the others keep theirs", async () => {
    const res = await setRoundClosed(ids.rounds[1], true);
    expect(res, "the close was refused or asked about a card").toEqual({ ok: true });

    const { state, rows } = await board();
    const ranked = state.strokeStandings.filter((s) => s.ranked).map((s) => s.player.id);
    // The Rules, by hand: Ann 144 first, Bo 146 second; Cy has no 36-hole total.
    expect(ranked).toEqual([ids.ann, ids.bo]);
    const cy = rows.find((r) => r.id === ids.cy)!;
    expect(cy.ranked).toBe(false);
    expect(cy.rank).toBe(0);
    expect(cy.missedRound, "the row does not say which round no card was returned for").toBe("Round 2");
    expect(cy.withdrew, "no card returned is not a withdrawal").toBeFalsy();
    // The two who played both rounds are untouched: a rule that unranked the field would pass the lines above alone.
    expect(rows.find((r) => r.id === ids.ann)!.rank).toBe(1);
    expect(rows.find((r) => r.id === ids.bo)!.rank).toBe(2);
  });

  it("Withdrew: the player is kept on the sheet as WD, beneath the field, with no place", async () => {
    const res = await removeSignup(ids.di);
    expect(res.ok, "the withdrawal was refused").toBe(true);
    const stored = await prisma.player.findUniqueOrThrow({ where: { id: ids.di }, select: { status: true } });
    // Kept, not deleted: a launched tournament never deletes a player who has a card in it.
    expect(stored.status).toBe("withdrawn");

    const { rows } = await board();
    const di = rows.find((r) => r.id === ids.di)!;
    expect(di, "a withdrawn player vanished from the sheet").toBeDefined();
    expect(di.withdrew).toBe(true);
    expect(di.ranked).toBe(false);
    expect(di.rank).toBe(0);
    // WD is listed beneath the ranked field.
    const order = rows.map((r) => r.id);
    expect(order.indexOf(di.id)).toBeGreaterThan(order.indexOf(ids.bo));
    // A player who never began is DNS, not WD: the office's two codes (Withdrew promises "DNS if they never began").
    expect((await removeSignup(ids.ed)).ok).toBe(true);
    const ed = (await board()).rows.find((r) => r.id === ids.ed);
    expect(ed, "a player who never began vanished from the results sheet").toBeDefined();
    expect(ed!.didNotStart).toBe(true);
    expect(ed!.withdrew).toBeFalsy();
    // And the other answer is not changed by it: Cy is still No card returned, still without a place.
    const cy = rows.find((r) => r.id === ids.cy)!;
    expect(cy.ranked).toBe(false);
    expect(cy.withdrew).toBeFalsy();
  });
});
