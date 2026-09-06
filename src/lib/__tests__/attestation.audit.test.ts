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

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { confirmMatch } = await import("@/app/actions/tournament");

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

  const stage = await prisma.stage.create({
    data: { eventId, format: "Four-ball", type: "Single Match Stage", holes: 18, position: 0 },
  });
  const group = await prisma.group.create({
    data: { eventId, name: "Flight A", position: 0 },
  });

  let seed = 0;
  for (const who of ["ann", "bob", "cat", "dan"]) {
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
    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    if (ev) await prisma.organization.deleteMany({ where: { id: ev.organizationId } });
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
