import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A MATCH'S HOLE-BY-HOLE RESULT IS A CARD OF THE MATCH'S LENGTH, OR IT IS REFUSED.
 *
 * `saveMatchHoles` is a server action — a public endpoint, called with whatever
 * the caller likes — and until 2026-10-14 it stored the list it was handed as
 * it came, and judged it complete with `resolveMatch(list).complete`. Measured
 * on that day, by calling it as a player in the match:
 *
 *     []           "complete": nothing left to play. Past the club's rule that
 *                  a player returns the whole round, stamped as scored, and into
 *                  the organizer's queue as a finished result to sign off.
 *     ["A"]        a match of ONE hole, won 1 up, on an eighteen-hole round.
 *     ["X", ...]   stored as given.
 *
 * The screens always send a full card, which is why nothing saw it; the
 * round-code screen's own path (`actions/play.ts`) cleaned its list all along.
 * Now this one does too (`cleanHoleResults`, sized to the round), and a result
 * is "complete" only by `matchIsOver`.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MATCHLENGTH";

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { saveMatchHoles } = await import("@/app/actions/tournament");

const ids = { event: "", match: "", a: "", b: "" };
const A_EMAIL = `${TAG}-a@example.invalid`.toLowerCase();

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const asPlayer = () => {
  session = { eventId: ids.event, email: A_EMAIL, viewRole: "player", name: `${TAG} Ainsley`, role: "player", userId: "", accountId: "" };
};
const asStaff = () => {
  session = { eventId: ids.event, email: `${TAG}-sec@example.invalid`, viewRole: "admin", name: `${TAG} secretary`, role: "admin", userId: "", accountId: "" };
};
const stored = async () => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match } });
  return { holes: JSON.parse(m.holes) as unknown[], scoredAt: m.scoredAt };
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
      // Players enter their own results, and return the WHOLE round: no half cards.
      scoreEntryBy: "players",
      scoreEntryWindow: "after",
    },
  });
  ids.event = event.id;
  const group = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} flight`, position: 0 } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18 },
  });
  for (const [k, who, email] of [["a", "Ainsley", A_EMAIL], ["b", "Brody", `${TAG}-b@example.invalid`]] as const) {
    ids[k] = (
      await prisma.player.create({
        data: { eventId: event.id, groupId: group.id, name: `${TAG} ${who}`, email, status: "confirmed", seed: 1, handicap: 0 },
      })
    ).id;
  }
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: stage.id, groupId: group.id, round: 1, playerAId: ids.a, playerBId: ids.b, holes: JSON.stringify(new Array(18).fill(null)) },
    })
  ).id;
}, 120_000);

beforeEach(async () => {
  await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(new Array(18).fill(null)), scoredAt: null, scoreStatus: "pending" } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a player sending a match's result", () => {
  it("CONTROL: a whole round is taken, and stamped as scored", async () => {
    asPlayer();
    await saveMatchHoles(ids.match, [...new Array(10).fill("A"), ...new Array(8).fill("H")]);
    const s = await stored();
    expect(s.holes).toHaveLength(18);
    expect(s.scoredAt).not.toBeNull();
  });

  it("an empty list is not a finished match: refused under the club's whole-round rule", async () => {
    asPlayer();
    await expect(saveMatchHoles(ids.match, [])).rejects.toThrow(/Enter the full round/);
    const s = await stored();
    expect(s.scoredAt).toBeNull();
    expect(s.holes).toEqual(new Array(18).fill(null));
  });

  it("one hole is not an eighteen-hole match won 1 up", async () => {
    asPlayer();
    await expect(saveMatchHoles(ids.match, ["A"])).rejects.toThrow(/Enter the full round/);
    expect((await stored()).scoredAt).toBeNull();
  });

  it("a hole that is not A, B or halved is refused, not stored", async () => {
    asPlayer();
    const sent = ["X", ...new Array(17).fill("H")] as unknown as ("A" | "B" | "H" | null)[];
    await expect(saveMatchHoles(ids.match, sent)).rejects.toThrow();
    expect((await stored()).holes).toEqual(new Array(18).fill(null));
  });

  it("a list longer than the round is cut to the round", async () => {
    asPlayer();
    await saveMatchHoles(ids.match, [...new Array(10).fill("A"), ...new Array(8).fill("H"), "B", "B"]);
    expect((await stored()).holes).toHaveLength(18);
  });
});

describe("a file of hole-by-hole results", () => {
  it("an empty row is a card of blanks, not a scored match; a full one is scored", async () => {
    asStaff();
    const { importScores } = await import("@/app/actions/tournament");
    const stageId = (await prisma.match.findUniqueOrThrow({ where: { id: ids.match } })).stageId;
    await importScores(stageId, "hole-results", [{ aId: ids.a, bId: ids.b, holes: [] }]);
    let s = await stored();
    expect(s.holes).toEqual(new Array(18).fill(null));
    expect(s.scoredAt).toBeNull();
    await importScores(stageId, "hole-results", [{ aId: ids.a, bId: ids.b, holes: [...new Array(10).fill("A"), ...new Array(8).fill("H")] }]);
    s = await stored();
    expect(s.scoredAt, "CONTROL: a finished match from a file is scored").not.toBeNull();
  });
});

describe("staff entering a part-played match", () => {
  it("an empty list is stored as a card of blanks, not as a scored match", async () => {
    asStaff();
    await saveMatchHoles(ids.match, []);
    const s = await stored();
    expect(s.holes).toEqual(new Array(18).fill(null));
    expect(s.scoredAt, "nothing has been played, so nothing has been scored").toBeNull();
  });
});
