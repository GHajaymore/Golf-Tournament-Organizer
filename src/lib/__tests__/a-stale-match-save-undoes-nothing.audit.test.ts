import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { HoleResult } from "@/lib/domain";

/**
 * A SAVE BASED ON AN OLDER CARD DOES NOT UNDO A NEWER ONE (2026-11-09).
 *
 * Round G571-4, `match-kept-by.spec.ts` on WebKit as an iPhone 13: Score entry
 * saved hole 1 of the taps match, the page was reloaded, the committee's
 * corrected 5&4 was on the screen and "Confirm result" was pressed — and then
 * the hole-1 save was posted AGAIN, byte for byte, under the reloaded page's
 * address. `saveMatchHoles` wrote whatever it was sent and set "pending", so
 * the sign-off and the correction were both undone, and the screen had already
 * said the match was signed off.
 *
 * The console now names every card each save may have STARTED FROM (the last
 * one acknowledged, those sent since with no answer, the card before the tap),
 * and the stroke card's conflict rule decides (`overwritesUnseenFromAll`).
 * Asserted here against real rows, as the committee and the screen would act:
 *
 *   - the replayed save is refused in words, and the confirmed 5&4 stands;
 *   - taps from one screen, each started from the last, all land;
 *   - on patchy signal — a save that never arrived, or one that landed with
 *     its reply lost — the scorer taps on and every hole lands;
 *   - the starting cards are validated where they arrive;
 *   - a save that says what is already stored changes nothing (and so does not
 *     put a signed-off match back to pending);
 *   - CONTROL: a save with no starting card is the old unconditional write.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-stale-match-save-undoes-nothing.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-stale-match-save";

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { saveMatchHoles, confirmMatches } = await import("@/app/actions/tournament");

const ids = { event: "", match: "" };
/** Read from the round the fixture made, never assumed. */
let roundHoles = 0;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const asOrganizer = () => {
  session = { eventId: ids.event, email: `${TAG}-sec@example.invalid`, viewRole: "admin", name: `${TAG} secretary`, role: "admin", userId: "", accountId: "" };
};

const blank = (): HoleResult[] => new Array<HoleResult>(roundHoles).fill(null);
/** `blank()` with the first holes set, in order. */
const card = (...first: HoleResult[]): HoleResult[] => first.concat(blank()).slice(0, roundHoles);

const stored = async () => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match } });
  return { holes: JSON.parse(m.holes) as HoleResult[], status: m.scoreStatus };
};

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} matchplay`,
      status: "live",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  ids.event = event.id;
  const group = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} flight`, position: 0 } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 9 },
  });
  roundHoles = stage.holes;
  const [a, b] = await Promise.all(
    ["Ailsa", "Bram"].map((who, i) =>
      prisma.player.create({
        data: { eventId: event.id, groupId: group.id, name: `${TAG} ${who}`, email: `${TAG}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
      }),
    ),
  );
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: stage.id, groupId: group.id, round: 1, playerAId: a.id, playerBId: b.id, holes: JSON.stringify(new Array(roundHoles).fill(null)) },
    })
  ).id;
}, 120_000);

beforeEach(async () => {
  await prisma.match.update({
    where: { id: ids.match },
    data: { holes: JSON.stringify(new Array(roundHoles).fill(null)), scoredAt: null, scoreStatus: "pending", confirmedById: null, confirmedBy: "" },
  });
  asOrganizer();
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a hole saved on Score entry, sent again after the committee signed off", () => {
  it("is refused in words, and the confirmed 5&4 stands", async () => {
    // The previous page: the organizer taps hole 1 to the A side.
    const first = await saveMatchHoles(ids.match, card("A"), [blank()]);
    expect(first, "CONTROL: the tap itself is taken").toEqual({ ok: true });
    // The committee's correction, written as the spec writes it, and signed off on the reloaded page.
    const fiveAndFour = card("A", "A", "A", "A", "A");
    await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(fiveAndFour), scoreStatus: "pending", scoredAt: new Date() } });
    expect((await confirmMatches([ids.match])).confirmed).toBe(1);
    expect((await stored()).status, "CONTROL: the result was signed off").toBe("confirmed");

    // The same save again, byte for byte.
    const replay = await saveMatchHoles(ids.match, card("A"), [blank()]);
    expect(replay).toEqual({ ok: false, error: expect.stringMatching(/changed elsewhere — reload/) });
    const after = await stored();
    expect(after.holes, "the correction was overwritten").toEqual(fiveAndFour);
    expect(after.status, "the sign-off was undone").toBe("confirmed");
  });

  it("a screen that loaded before somebody else's change is refused, not written over it", async () => {
    // Somebody else gives hole 1 to the B side; this screen still shows blanks.
    await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(card("B")) } });
    expect(await saveMatchHoles(ids.match, card("A"), [blank()])).toMatchObject({ ok: false });
    expect((await stored()).holes).toEqual(card("B"));
  });
});

describe("one screen's own taps", () => {
  it("all land, each started from the card the last one sent", async () => {
    const taps: HoleResult[] = ["A", "B", "H", "A", "A", "H", "B", "A", "A"].slice(0, roundHoles) as HoleResult[];
    let onScreen = blank();
    for (let i = 0; i < taps.length; i += 1) {
      const next = [...onScreen];
      next[i] = taps[i];
      expect(await saveMatchHoles(ids.match, next, [onScreen]), `tap on hole ${i + 1}`).toEqual({ ok: true });
      onScreen = next;
    }
    expect((await stored()).holes).toEqual(taps);
  });

  it("a tap taken back (the same hole pressed twice) lands too", async () => {
    expect(await saveMatchHoles(ids.match, card("A"), [blank()])).toEqual({ ok: true });
    expect(await saveMatchHoles(ids.match, blank(), [card("A")])).toEqual({ ok: true });
    expect((await stored()).holes).toEqual(blank());
  });

  it("a save that says what is already stored changes nothing — a signed-off match stays signed off", async () => {
    const won = card("A", "A", "A", "A", "A");
    expect(await saveMatchHoles(ids.match, won, [blank()])).toEqual({ ok: true });
    expect((await confirmMatches([ids.match])).confirmed).toBe(1);
    // The same card sent twice (a retry that had already landed).
    expect(await saveMatchHoles(ids.match, won, [blank()])).toEqual({ ok: true });
    const after = await stored();
    expect(after.holes).toEqual(won);
    expect(after.status).toBe("confirmed");
  });
});

/**
 * Score entry's own bookkeeping, as `ScoreEntryClient` keeps it per match: the
 * card the server last acknowledged (seeded from the card the page was served),
 * the cards sent since whose outcome is unknown, and the card on screen. Each
 * tap sends the list [acknowledged, ...unknown, card before the tap].
 *
 *   "ok"             the save lands and its reply comes back
 *   "never-reached"  no signal: the server never sees it, the screen sees a failure
 *   "reply-lost"     the save lands, its reply does not: the screen sees a failure
 */
function scorer(served: HoleResult[]) {
  let acked = served;
  let unknown: HoleResult[][] = [];
  let onScreen = served;
  const startingCards = (before: HoleResult[]) => {
    const seen = new Set<string>();
    return [acked, ...unknown, before].filter((c) => !seen.has(JSON.stringify(c)) && seen.add(JSON.stringify(c)));
  };
  return {
    get list() {
      return startingCards(onScreen);
    },
    async tap(hole: number, who: HoleResult, signal: "ok" | "never-reached" | "reply-lost" = "ok") {
      const next = [...onScreen];
      next[hole] = who;
      const from = startingCards(onScreen);
      onScreen = next;
      if (signal === "never-reached") {
        unknown.push(next);
        return null;
      }
      const res = await saveMatchHoles(ids.match, next, from);
      if (signal === "reply-lost") unknown.push(next);
      else if (res.ok) {
        acked = next;
        unknown = [];
      }
      return res;
    },
  };
}

describe("patchy signal on the course: a scorer taps on after a failed save", () => {
  it("a save that never reached the server, then a tap: both holes land", async () => {
    const s = scorer(blank());
    await s.tap(0, "A", "never-reached");
    expect((await stored()).holes, "CONTROL: the first save was not stored").toEqual(blank());
    expect(await s.tap(1, "A"), "the next tap was refused as changed elsewhere").toEqual({ ok: true });
    expect((await stored()).holes).toEqual(card("A", "A"));
  });

  it("a save that landed with its reply lost, then one with no signal, then a tap: all three holes land", async () => {
    const s = scorer(blank());
    await s.tap(0, "A", "reply-lost");
    expect((await stored()).holes, "CONTROL: the first save was stored").toEqual(card("A"));
    await s.tap(1, "B", "never-reached");
    expect(await s.tap(2, "H"), "the next tap was refused as changed elsewhere").toEqual({ ok: true });
    expect((await stored()).holes).toEqual(card("A", "B", "H"));
  });

  it("G571-4 with the whole list: the old page's next save is still refused, and the confirmed 5&4 stands", async () => {
    const old = scorer(blank());
    await old.tap(0, "A", "reply-lost");
    const fiveAndFour = card("A", "A", "A", "A", "A");
    await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(fiveAndFour), scoreStatus: "pending", scoredAt: new Date() } });
    expect((await confirmMatches([ids.match])).confirmed).toBe(1);
    // Every card the old page could name is from before the committee's correction.
    expect(old.list).toEqual([blank(), card("A")]);
    expect(await old.tap(1, "B")).toEqual({ ok: false, error: expect.stringMatching(/changed elsewhere/) });
    const after = await stored();
    expect(after.holes).toEqual(fiveAndFour);
    expect(after.status).toBe("confirmed");
  });
});

describe("the starting cards are validated where they arrive", () => {
  it("a bare card, an empty list, a list past the cap or a list with a bad card is refused, and nothing is written", async () => {
    const bad: unknown[] = [
      blank(),
      [],
      Array.from({ length: 21 }, () => blank()),
      [blank(), ["X", ...blank().slice(1)]],
    ];
    for (const startedFrom of bad) {
      const res = await saveMatchHoles(ids.match, card("A"), startedFrom as HoleResult[][]);
      expect(res, JSON.stringify(startedFrom).slice(0, 60)).toMatchObject({ ok: false });
    }
    expect((await stored()).holes).toEqual(blank());
    expect(await saveMatchHoles(ids.match, card("A"), Array.from({ length: 20 }, () => blank())), "CONTROL: twenty is allowed").toEqual({ ok: true });
  });
});

describe("CONTROL: a save that names no starting card", () => {
  it("is the old unconditional write (the player's own match keeper, a page loaded before this shipped)", async () => {
    await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(card("B")) } });
    expect(await saveMatchHoles(ids.match, card("A"))).toEqual({ ok: true });
    expect((await stored()).holes).toEqual(card("A"));
  });
});
