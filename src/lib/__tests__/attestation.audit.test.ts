import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The club's attestation rule, through the real action against real rows.
 *
 * The unit tests beside this prove `attestMatch` decides correctly. They would
 * pass just as well if `confirmMatch` never called it — which is exactly the
 * state the codebase was in: `domain/attest.ts` was complete, tested, and
 * imported by nothing, while the action confirmed on the first signature
 * whichever rule the club had chosen.
 *
 * So this drives the ACTION. A four-ball, because that is the only shape where
 * the three rules differ: an individual match has one player a side, so
 * "everyone in the match" and "one playing partner" both come to a single
 * signature and a fixture built on singles cannot tell them apart.
 *
 * It also exercises `matchSidesOf` resolving TEAM ids to players — the path a
 * comment in `confirmMatch` records as having been broken before, where reading
 * only the player columns made peer confirmation impossible for every
 * four-ball.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ATTEST";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null =
  null;

// Only the console's session is replaced: a round code signs its own cookie
// with the module's real `sign`.
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getSession: async () => session,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/** One phone's cookie jar, so a round-code session round-trips for real. */
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

const { confirmMatch } = await import("@/app/actions/tournament");
const { claimPlayerSlot, savePlayMatchResult } = await import("@/app/actions/play");
const { attestMatch } = await import("@/lib/services/attestation");
const { clearRateLimit } = await import("@/lib/rate-limit");
const { generateAccessCode } = await import("@/lib/codes");
const CODE = generateAccessCode();

let eventId = "";
let matchId = "";
const player: Record<string, string> = {};

/** Sign in as one of the four players. */
function signIn(who: string) {
  session = { eventId, email: at(who), name: who, role: "player", viewRole: "player" };
}

/** Put the match back to "Ann entered it, nobody has signed". */
async function resetMatch(attestBy: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { scoreEntryBy: "players", scoreApproval: "players", attestBy },
  });
  await prisma.match.update({
    where: { id: matchId },
    data: {
      scoreStatus: "pending",
      attestedBy: "[]",
      enteredById: player.ann,
      enteredBy: "ann",
      confirmedById: null,
      confirmedBy: "",
    },
  });
}

const statusOf = async () =>
  (await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).scoreStatus;

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${TAG} Society` } });
  const event = await prisma.event.create({
    data: {
      name: `${TAG} Four-ball`,
      organizationId: org.id,
      dates: "2026-09-06",
      course: `${TAG} Links`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG.toLowerCase()}-${Date.now()}`,
      // Settings are columns on Event, not a JSON blob.
      scoreApproval: "players",
      attestBy: "all",
    },
  });
  eventId = event.id;

  // A round code, for the phoned-in result below.
  const stage = await prisma.stage.create({
    data: { eventId, format: "Four-ball", type: "Single Match Stage", holes: 18, position: 0, accessCode: CODE },
  });
  const group = await prisma.group.create({
    data: { eventId, name: "Flight A", position: 0 },
  });

  let seed = 0;
  // Eve is in the group and NOT in this match: the group's scorer.
  for (const who of ["ann", "bob", "cat", "dan", "eve"]) {
    const p = await prisma.player.create({
      data: { eventId, name: who, email: at(who), seed: (seed += 1), status: "confirmed" },
    });
    player[who] = p.id;
  }

  const teamA = await prisma.team.create({ data: { eventId, stageId: stage.id, name: `${TAG} A` } });
  const teamB = await prisma.team.create({ data: { eventId, stageId: stage.id, name: `${TAG} B` } });
  await prisma.teamMember.createMany({
    data: [
      { teamId: teamA.id, playerId: player.ann },
      { teamId: teamA.id, playerId: player.bob },
      { teamId: teamB.id, playerId: player.cat },
      { teamId: teamB.id, playerId: player.dan },
    ],
  });

  const match = await prisma.match.create({
    data: {
      eventId,
      stageId: stage.id,
      groupId: group.id,
      round: 1,
      playerAId: "",
      playerBId: "",
      teamAId: teamA.id,
      teamBId: teamB.id,
      holes: JSON.stringify(new Array(18).fill("A")),
      scoreStatus: "pending",
    },
  });
  matchId = match.id;
});

afterAll(async () => {
  try {
    await clearRateLimit("round-code", CODE);
    /**
     * BY THE MARK, not by walking from the event.
     *
     * This read the event to find its organization and deleted the org only
     * `if (ev)` — so any run where the event was already gone left the
     * organization behind for good. One was found orphaned in the development
     * database on 2026-09-08, empty and indistinguishable at a glance from a
     * real club.
     *
     * The mark is on both rows precisely so neither needs the other to be
     * findable, which is how every other audit file here tears down.
     */
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("confirmMatch applies the club's attestation rule", () => {
  beforeEach(() => {
    session = null;
  });

  it("under 'all', one signature leaves the result pending", async () => {
    /**
     * THE DEFECT. This confirmed on Bob's tap, and the club had chosen the
     * option described as "worth it when the result will be argued about".
     */
    await resetMatch("all");
    signIn("bob");
    const res = await confirmMatch(matchId);

    /**
     * A SUCCESS that is not a confirmation, which is the case the screen got
     * wrong. `ok` is true — the signature was accepted and stored — while the
     * status stays pending. Both halves are asserted because the entry screen
     * paints the row from `status` and would otherwise call this confirmed.
     */
    expect(res.ok).toBe(true);
    expect(res.ok && res.status).toBe("pending");
    expect(res.ok && res.outstanding, "two others still to sign").toBe(2);
    // The screen paints the row from `status`, so this pair is the guard on the
    // lie: an action that reported "confirmed" here would put a confirmed row
    // on screen over a pending one in the database.
    expect(await statusOf(), "one of three signatures is not everyone").toBe("pending");
    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(JSON.parse(row.attestedBy)).toEqual([player.bob]);
    // And nobody is named as having confirmed a result that is not confirmed.
    expect(row.confirmedBy).toBe("");
  });

  it("under 'all', it confirms once everyone else has signed", async () => {
    // The control. Without it the case above passes against a round that can
    // never be confirmed at all, which is the same silence permanently.
    await resetMatch("all");
    for (const who of ["bob", "cat", "dan"]) {
      signIn(who);
      await confirmMatch(matchId);
    }

    expect(await statusOf()).toBe("confirmed");
    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(new Set(JSON.parse(row.attestedBy))).toEqual(
      new Set([player.bob, player.cat, player.dan]),
    );
    expect(row.confirmedBy).toBe("dan");
  });

  it("under 'marker', the same single signature confirms it", async () => {
    /**
     * The cell that proves the SETTING is what changed the behaviour, not the
     * fixture. Identical match, identical signature, different rule.
     */
    await resetMatch("marker");
    signIn("bob");
    await confirmMatch(matchId);
    expect(await statusOf()).toBe("confirmed");
  });

  it("refuses the player who entered the score", async () => {
    // Ann entered it. The old check only asked whether she played in the
    // match, which she did, so she could sign her own result off.
    await resetMatch("marker");
    signIn("ann");
    const res = await confirmMatch(matchId);
    // Returned, not thrown: the entry screen renders this wording, and a throw
    // reaches it as an unhandled server-action failure with nothing to show.
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/somebody else/i);
    expect(await statusOf()).toBe("pending");
  });

  it("under 'opponent', a partner is refused and an opponent confirms", async () => {
    await resetMatch("opponent");
    signIn("bob"); // Ann's partner — same side as the author
    const partner = await confirmMatch(matchId);
    expect(partner.ok).toBe(false);
    expect(!partner.ok && partner.error).toMatch(/other side/i);
    expect(await statusOf()).toBe("pending");

    signIn("cat"); // the other side
    await confirmMatch(matchId);
    expect(await statusOf()).toBe("confirmed");
  });

  it("still lets an organizer approve outright, whatever the rule", async () => {
    // Staff approval is the committee, not attestation. It has always been
    // allowed to stand alone and must remain so — otherwise a club with a
    // player who has gone home can never close a round.
    await resetMatch("all");
    session = {
      eventId,
      email: at("organizer"),
      name: "Organizer",
      role: "admin",
      viewRole: "admin",
    };
    await confirmMatch(matchId);
    expect(await statusOf()).toBe("confirmed");
  });
});

/**
 * THE TWO DEFECTS THE END-OF-ROUND CHECK STANDS ON (2026-11-04, sprint 2 part B).
 *
 * The check is "the other side confirms", and both of these broke it before a
 * single new line was written:
 *
 *   1. A result PHONED IN from a round code ("3&2") stored no author and kept
 *      the signatures of the result it replaced. `savePlayMatchHoles` set both;
 *      `savePlayMatchResult`, beside it, set neither — so whoever phoned it in
 *      could confirm it, and a confirmation of an old scoreline survived a new one.
 *   2. A scorer keeping a group's card for a match they are NOT playing in is
 *      on neither side, and `attestMatch` took the author as the card's owner —
 *      so it read the match as having "nobody else in it to confirm".
 */
describe("a phoned-in result has an author, and supersedes old signatures", () => {
  beforeAll(async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: { status: "live", playerAccess: "code", scoreEntryBy: "players", scoreApproval: "players", attestBy: "marker" },
    });
  });

  it("records who phoned it in, and clears the signatures of the result it replaced", async () => {
    await resetMatch("marker");
    // Cat had signed the OLD scoreline.
    await prisma.match.update({ where: { id: matchId }, data: { attestedBy: JSON.stringify([player.cat]), enteredById: "", enteredBy: "" } });
    jar.clear();
    expect((await claimPlayerSlot(CODE, player.ann)).ok).toBe(true);
    const res = await savePlayMatchResult(matchId, "A", "2&1");
    expect(res.ok, res.error).toBe(true);
    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(row.enteredById, "a phoned-in result has no author").toBe(player.ann);
    expect(row.enteredBy).toBe("ann");
    expect(JSON.parse(row.attestedBy), "a signature of the old scoreline survived the new one").toEqual([]);
  });

  it("and so its author cannot confirm it — somebody else in the match must", async () => {
    signIn("ann");
    const own = await confirmMatch(matchId);
    expect(own.ok).toBe(false);
    expect(!own.ok && own.error).toMatch(/somebody else/i);
    signIn("cat");
    expect((await confirmMatch(matchId)).ok).toBe(true);
    expect(await statusOf()).toBe("confirmed");
  });
});

describe("a scorer keeping a match they are not playing in", () => {
  /** Eve kept the card: she is in the group, not in the match. */
  async function enteredByEve(attestBy: string) {
    await resetMatch(attestBy);
    await prisma.match.update({ where: { id: matchId }, data: { enteredById: player.eve, enteredBy: "eve" } });
  }

  it("under 'opponent', either side may confirm — nobody in the match wrote it down", async () => {
    await enteredByEve("opponent");
    signIn("cat");
    const res = await confirmMatch(matchId);
    expect(res.ok, !res.ok ? res.error : "").toBe(true);
    expect(await statusOf()).toBe("confirmed");

    await enteredByEve("opponent");
    signIn("bob");
    expect((await confirmMatch(matchId)).ok).toBe(true);
    expect(await statusOf()).toBe("confirmed");
  });

  it("under 'all', everyone in the match signs — and the scorer is not one of them", async () => {
    await enteredByEve("all");
    for (const who of ["ann", "bob", "cat"]) {
      signIn(who);
      expect((await confirmMatch(matchId)).ok).toBe(true);
    }
    expect(await statusOf(), "three of four is not everyone").toBe("pending");
    signIn("dan");
    await confirmMatch(matchId);
    expect(await statusOf()).toBe("confirmed");
  });

  it("the requirement is the match's sides, with the scorer as the author (pure)", () => {
    const sides = { id: matchId, sideA: [player.ann, player.bob], sideB: [player.cat, player.dan] };
    const out = attestMatch(sides, { enteredById: player.eve, attestedBy: "[]" }, player.cat, "opponent", "confirm");
    expect(out.ok && out.status).toBe("confirmed");
    const eve = attestMatch(sides, { enteredById: player.eve, attestedBy: "[]" }, player.eve, "opponent", "confirm");
    expect(eve.ok).toBe(false);
  });
});

describe("where the committee approves, the check records agreement and approves nothing", () => {
  it("attestMatch in 'record' mode leaves the result pending, and says the sides agree", () => {
    const sides = { id: matchId, sideA: [player.ann, player.bob], sideB: [player.cat, player.dan] };
    const out = attestMatch(sides, { enteredById: player.ann, attestedBy: "[]" }, player.cat, "opponent", "record");
    expect(out.ok).toBe(true);
    expect(out.ok && out.status, "a player's signature approved a result the committee approves").toBe("pending");
    expect(out.ok && out.agreed).toBe(true);
    expect(out.ok && out.attestedBy).toEqual([player.cat]);
  });
});
