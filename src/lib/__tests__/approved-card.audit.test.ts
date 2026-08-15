import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * An accepted result stays accepted until someone entitled to undo it does.
 *
 * S2, S3 and S4 of the 2026-08-12 audit, and they are one bug wearing three
 * coats: an action that writes a card without ever asking what state the card
 * was already in. `certifyScorecard` and `reopenMatch` ask. `saveScorecard`,
 * `disputeScorecard` and `clearMatch` did not, so the player whose result it
 * is could rewrite an approved 82, take an accepted card back out of the
 * results, or erase a match their opponent had signed — each one leaving a row
 * that still named the committee, and none of them leaving a trace.
 *
 * Every check here is driven through the real server action against real rows,
 * because that is exactly what the screens do not do: the entry screen locks an
 * approved card, and a `"use server"` export is an HTTP endpoint that will be
 * called with whatever the caller likes.
 *
 * Excluded from the default run — needs a live DATABASE_URL and writes rows,
 * all of which are deleted in afterAll.
 *   npx vitest run --config vitest.audit.config.ts
 */

/** One browser's cookie jar, so a console session round-trips for real. */
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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  saveScorecard,
  disputeScorecard,
  certifyScorecard,
  reopenScorecard,
  clearMatch,
  reopenMatch,
} from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-APPROVED-CARD";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

/** The card the committee accepted, and the one the player would rather have. */
const APPROVED_82 = new Array(18).fill(null).map((_, i) => (i < 10 ? 5 : 4));
const IMPROVED_76 = new Array(18).fill(null).map((_, i) => (i < 4 ? 5 : 4));
const COMMITTEE = at("committee");
const EMPTY_HOLES = JSON.stringify(new Array(18).fill(null));
const PLAYED_HOLES = JSON.stringify([...new Array(16).fill("A"), null, null]);

let eventId = "";
let stageId = "";
let cardStageId = "";
let matchId = "";
let playerAId = "";
let playerBId = "";
const userIds: Record<string, string> = {};

/** Sign in as one of the fixture accounts, in this event. */
async function signIn(who: "player" | "loser" | "assistant" | "organizer") {
  jar.clear();
  await createSession(userIds[who]);
  // createSession clears the active-event cookie, so this comes second.
  await setActiveEvent(eventId);
}

async function storedCard() {
  const c = await prisma.scorecard.findFirstOrThrow({ where: { stageId: cardStageId, playerId: playerAId } });
  return { strokes: c.strokes, status: c.status, approvedBy: c.approvedBy, certifiedBy: c.certifiedBy };
}

async function storedMatch() {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  return { holes: m.holes, scoreStatus: m.scoreStatus, confirmedById: m.confirmedById };
}

/** Put the card back to the state each block assumes, so ordering can't matter. */
function resetCard(over: Record<string, unknown> = {}) {
  return prisma.scorecard.updateMany({
    where: { stageId: cardStageId, playerId: playerAId },
    data: {
      strokes: JSON.stringify(APPROVED_82),
      status: "approved",
      approvedBy: COMMITTEE,
      certifiedBy: "",
      ...over,
    },
  });
}

const setScoreApproval = (value: "staff" | "players") =>
  prisma.event.update({ where: { id: eventId }, data: { scoreApproval: value } });

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} club championship`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      // A self-scoring event: the configuration these holes are reachable in,
      // and a perfectly ordinary one — it is how a club runs a medal where
      // players post their own cards.
      scoreEntryBy: "players",
      scoreApproval: "staff",
      playerAccess: "email",
    },
  });
  eventId = event.id;

  const [matchStage, strokeStage, group] = await Promise.all([
    prisma.stage.create({ data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 } }),
    prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } }),
    prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0 } }),
  ]);
  stageId = matchStage.id;
  cardStageId = strokeStage.id;

  const [a, b] = await Promise.all([
    prisma.player.create({
      data: { eventId, name: `${TAG} Ainsley`, email: at("player"), seed: 1, status: "confirmed" },
    }),
    prisma.player.create({
      data: { eventId, name: `${TAG} Brody`, email: at("loser"), seed: 2, status: "confirmed" },
    }),
  ]);
  playerAId = a.id;
  playerBId = b.id;

  // The people. A session belongs to a User; what they may do in this event
  // comes from the Account row, which is the grant the actions read.
  for (const who of ["player", "loser", "assistant", "organizer"]) {
    const user = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
    userIds[who] = user.id;
  }
  await prisma.account.createMany({
    data: [
      { eventId, email: at("player"), name: "Ainsley", role: "player" },
      { eventId, email: at("loser"), name: "Brody", role: "player" },
      { eventId, email: at("assistant"), name: "Assistant", role: "assistant" },
      { eventId, email: at("organizer"), name: "Organizer", role: "admin" },
    ],
  });

  await prisma.scorecard.create({
    data: {
      eventId,
      stageId: cardStageId,
      playerId: playerAId,
      strokes: JSON.stringify(APPROVED_82),
      // Already a result: certified by the marker, accepted by the committee.
      status: "approved",
      certifiedBy: at("loser"),
      certifiedAt: new Date(),
      approvedBy: COMMITTEE,
      approvedAt: new Date(),
    },
  });

  const match = await prisma.match.create({
    data: {
      eventId,
      stageId,
      groupId: group.id,
      round: 1,
      playerAId: a.id,
      playerBId: b.id,
      // A finished match, signed off by the player who lost it.
      holes: PLAYED_HOLES,
      scoreStatus: "confirmed",
      scoredAt: new Date(),
      confirmedById: userIds.loser ?? "",
      confirmedBy: "Brody",
    },
  });
  matchId = match.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("S2 — an approved scorecard is the committee's", () => {
  it("refuses the player who posted it, and says what would have to happen first", async () => {
    // The whole attack: a player in a self-scoring event replacing an approved
    // 82 with a 76 under a row that still reads approvedBy: committee.
    await resetCard();
    await signIn("player");
    await expect(saveScorecard(cardStageId, playerAId, IMPROVED_76)).rejects.toThrow(/approved/i);

    const card = await storedCard();
    expect(JSON.parse(card.strokes)).toEqual(APPROVED_82);
    expect(card.status).toBe("approved");
    expect(card.approvedBy, "the approval must not be quietly detached").toBe(COMMITTEE);
  });

  it("refuses staff too — the guard is on the card, not on the role", async () => {
    // assertOwnCard returns immediately for staff, so an assistant could do
    // this for anybody in the field. Whose card it is was never the question.
    await signIn("assistant");
    await expect(saveScorecard(cardStageId, playerAId, IMPROVED_76)).rejects.toThrow(/approved/i);
    expect(JSON.parse((await storedCard()).strokes)).toEqual(APPROVED_82);
  });

  it("still refuses a card the player is entitled to enter and did not sign", async () => {
    // Not a permissions failure dressed up: the same session writes the same
    // round freely the moment the approval is lifted, in the next test.
    await signIn("player");
    await expect(certifyScorecard(cardStageId, playerAId)).rejects.toThrow(/approved/i);
  });

  it("takes the correction once an organizer reopens the card", async () => {
    // The documented route, and the reason refusing above is a redirection
    // rather than a wall: an organizer reopens, the player re-enters, the
    // committee accepts again. reopenScorecard keeps approvedBy on purpose —
    // who signed the previous version off has to survive the card changing.
    await signIn("organizer");
    expect(await reopenScorecard(cardStageId, playerAId)).toEqual({ ok: true });

    await signIn("player");
    await saveScorecard(cardStageId, playerAId, IMPROVED_76);
    const card = await storedCard();
    expect(JSON.parse(card.strokes)).toEqual(IMPROVED_76);
    expect(card.status).toBe("entered");
    expect(card.approvedBy).toBe(COMMITTEE);
  });

  it("retracts a certification when the strokes underneath it change", async () => {
    // The half-step version of the same bug. A marker certifies an 82; the
    // player then edits the card and certifiedBy still vouches for numbers
    // nobody read back. Match play has always reset confirmation on any edit.
    await resetCard({ status: "certified", certifiedBy: at("loser"), approvedBy: "" });
    await signIn("player");
    await saveScorecard(cardStageId, playerAId, IMPROVED_76);

    const card = await storedCard();
    expect(card.status).toBe("entered");
    expect(card.certifiedBy).toBe("");
  });

  it("does NOT let an edit clear a dispute", async () => {
    // Deliberately unlike the certification above. Disputed means someone says
    // this card is wrong; if editing cleared that, the one person most
    // motivated to remove the flag could remove it by retyping a score.
    await resetCard({ status: "disputed", approvedBy: "" });
    await signIn("player");
    await saveScorecard(cardStageId, playerAId, IMPROVED_76);
    expect((await storedCard()).status).toBe("disputed");
  });
});

describe("S3 — disputing is not a back door to un-approving", () => {
  it("refuses to flip an approved card, whoever asks", async () => {
    await resetCard();

    for (const who of ["player", "assistant"] as const) {
      await signIn(who);
      await expect(disputeScorecard(cardStageId, playerAId), who).rejects.toThrow(/approved/i);
      const card = await storedCard();
      expect(card.status, who).toBe("approved");
      expect(card.approvedBy, who).toBe(COMMITTEE);
    }
  });

  it("still lets a returned card be flagged, and records who did it", async () => {
    // The action has to keep working — raising a problem with a card that has
    // not been accepted yet is the reason it exists. What was missing is the
    // row saying it happened: stroke play is the format where one person
    // enters three other people's rounds, and it logged nothing at all.
    await resetCard({ status: "certified", approvedBy: "" });
    await prisma.auditLog.deleteMany({ where: { eventId } });

    await signIn("player");
    expect(await disputeScorecard(cardStageId, playerAId)).toEqual({ ok: true });
    expect((await storedCard()).status).toBe("disputed");

    const rows = await prisma.auditLog.findMany({ where: { eventId, action: "card.dispute" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("Ainsley");
    expect(rows[0].detail, "the row has to name the card, having no matchId").toContain(playerAId);
  });

  it("writes one row per dispute, not one per click", async () => {
    // Re-disputing an already disputed card changes nothing, and an audit
    // trail padded with repeats is one nobody reads.
    await signIn("player");
    expect(await disputeScorecard(cardStageId, playerAId)).toEqual({ ok: true });
    expect(await prisma.auditLog.count({ where: { eventId, action: "card.dispute" } })).toBe(1);
  });
});

describe("S4 — a confirmed match cannot be erased by the player who lost it", () => {
  it("refuses, and leaves the result and the sign-off exactly as they were", async () => {
    await setScoreApproval("staff");
    await signIn("loser");

    const res = await clearMatch(matchId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reopen/i);
    expect(await storedMatch()).toEqual({
      holes: PLAYED_HOLES,
      scoreStatus: "confirmed",
      confirmedById: userIds.loser,
    });
  });

  it("refuses an organizer too, so clearing cannot outrun reopening", async () => {
    // clearMatch does strictly more than reopenMatch — which is admin-only AND
    // logged — so leaving it open to staff would make the audited action the
    // slower way to do the same thing.
    await signIn("organizer");
    expect((await clearMatch(matchId)).ok).toBe(false);
    expect((await storedMatch()).scoreStatus).toBe("confirmed");
  });

  it("records nothing for a clear it refused", async () => {
    // An audit line for an erasure that never happened would send a committee
    // after a player who did nothing.
    expect(await prisma.auditLog.count({ where: { matchId, action: "match.clear" } })).toBe(0);
  });

  it("refuses an AUTO-confirmed match, whose stored status still reads pending", async () => {
    // The combination the column check would have missed. Under player
    // approval a result locks itself after 24 hours; scoreStatus is still
    // "pending" in the row, and reading the row rather than the effective
    // status would have left the whole auto-confirmed class wide open.
    await setScoreApproval("players");
    await prisma.match.update({
      where: { id: matchId },
      data: {
        scoreStatus: "pending",
        confirmedById: null,
        confirmedBy: "",
        scoredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    await signIn("loser");
    const res = await clearMatch(matchId);
    expect(res.ok).toBe(false);
    expect(JSON.parse((await storedMatch()).holes)).toEqual(JSON.parse(PLAYED_HOLES));
  });

  it("clears a result nobody has signed off, and says who cleared it", async () => {
    // The action's real job. A scorer who entered the wrong match's card fixes
    // it here, and erasing a card is not a smaller act than entering one.
    await prisma.match.update({
      where: { id: matchId },
      data: { scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "" },
    });
    await signIn("loser");

    expect(await clearMatch(matchId)).toEqual({ ok: true });
    const m = await storedMatch();
    expect(m.holes).toBe(EMPTY_HOLES);
    expect(m.scoreStatus).toBe("pending");

    const rows = await prisma.auditLog.findMany({ where: { matchId, action: "match.clear" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("Brody");
  });

  it("lets an organizer reopen a confirmed match and then clear it", async () => {
    // Both halves of the rule in one pass: the confirmation has to be lifted
    // first, by someone entitled to lift it — and lifting it is logged.
    await prisma.match.update({
      where: { id: matchId },
      data: {
        holes: PLAYED_HOLES,
        scoreStatus: "confirmed",
        scoredAt: new Date(),
        confirmedById: userIds.loser,
        confirmedBy: "Brody",
      },
    });

    await signIn("organizer");
    await reopenMatch(matchId);
    expect(await clearMatch(matchId)).toEqual({ ok: true });

    const m = await storedMatch();
    expect(m.holes).toBe(EMPTY_HOLES);
    expect(m.confirmedById).toBeNull();
    expect(await prisma.auditLog.count({ where: { matchId, action: "reopen" } })).toBe(1);
  });

  it("keeps a nine-hole match nine holes long when it clears it", async () => {
    // Field sizes and card lengths start at the smallest thing the app can
    // represent: clearing must not silently promote a nine-hole match to
    // eighteen empty holes, which is the shape every "is this round finished"
    // check reads.
    const nine = await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId: (await prisma.group.findFirstOrThrow({ where: { eventId } })).id,
        round: 2,
        playerAId,
        playerBId,
        holes: JSON.stringify(new Array(9).fill("A")),
        scoreStatus: "pending",
      },
    });

    await signIn("organizer");
    expect(await clearMatch(nine.id)).toEqual({ ok: true });
    const stored = await prisma.match.findUniqueOrThrow({ where: { id: nine.id } });
    expect(JSON.parse(stored.holes)).toHaveLength(9);
  });
});
