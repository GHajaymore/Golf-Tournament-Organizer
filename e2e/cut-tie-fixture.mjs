import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A 36-HOLE MEDAL WITH EVERY ROUND 1 CARD APPROVED AND A TIE ON THE CUT LINE.
 *
 * For `a-tie-at-the-cut.spec.ts`. Cut to the top 2, gross:
 *
 *     Morven Aird        70   clear
 *     Tamsin Bell        72   ┐ identical cards — no countback splits them
 *     Struan Cowie       72   ┘
 *     Elspeth Drummond   72   the same total, a worse last nine (37)
 *     Iona Fyfe          73
 *     Fergus Ewart       90
 *
 * So "ties go through" sends four, a play-off is owed to the three on 72, and a
 * countback leaves Tamsin and Struan to a draw. Its own throwaway club and its
 * own mark — NOT the shared fixture's, so another session's run tearing that
 * down cannot take this with it. Invented names, `.invalid` addresses.
 */
const TAG = "zz-cut-tie-e2e";
export const TIE_ORG = `${TAG} club`;
export const TIE_EVENT = `${TAG} Autumn Medal`;
const ORGANIZER = `${TAG}-sec@example.invalid`;
const PLAYER = `${TAG}-tamsin@example.invalid`;

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/** Everything a run left. Safe to call when none of it exists. */
export async function teardownCutTie(prisma = new PrismaClient()) {
  try {
    await prisma.event.deleteMany({ where: { name: TIE_EVENT } });
    const orgs = await prisma.organization.findMany({ where: { name: TIE_ORG }, select: { id: true } });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: [ORGANIZER, PLAYER] } } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Who holds a Round 2 card, by name — the next round's field. */
export async function roundTwoField(eventId) {
  const prisma = new PrismaClient();
  try {
    const r2 = await prisma.stage.findFirst({ where: { eventId, position: 1 }, select: { id: true } });
    const cards = await prisma.scorecard.findMany({ where: { stageId: r2.id }, select: { playerId: true } });
    const players = await prisma.player.findMany({ where: { id: { in: cards.map((c) => c.playerId) } }, select: { name: true } });
    return players.map((p) => p.name).sort();
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedCutTie() {
  await teardownCutTie();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: TIE_ORG, kind: "club" } });
    const sec = await prisma.user.create({ data: { email: ORGANIZER, name: "Rhona Secretary", password: "x:unusable" } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: sec.id, role: "owner" } });
    const pars = new Array(18).fill(4);
    const event = await prisma.event.create({
      data: {
        name: TIE_EVENT,
        organizationId: org.id,
        status: "live",
        // Unlocked, so the secretary can choose how the tie is settled — it is
        // part of the cut's terms and locks with setup.
        configUnlocked: true,
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-tok`,
        customPars: JSON.stringify(pars),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    await prisma.account.create({ data: { eventId: event.id, name: "Rhona Secretary", email: ORGANIZER, role: "admin" } });
    const base = { eventId: event.id, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" };
    const r1 = await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" } });
    const r2 = await prisma.stage.create({
      data: { ...base, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 2 },
    });
    const four = new Array(18).fill(4);
    const field = [
      ["Morven Aird", [3, 3, ...four.slice(2)]],
      ["Tamsin Bell", four, PLAYER],
      ["Struan Cowie", four],
      ["Elspeth Drummond", [3, ...four.slice(1, 17), 5]],
      ["Iona Fyfe", [5, ...four.slice(1)]],
      ["Fergus Ewart", new Array(18).fill(5)],
    ];
    for (const [i, [name, strokes, email]] of field.entries()) {
      const p = await prisma.player.create({
        data: { eventId: event.id, name, email: email ?? `${TAG}-p${i + 1}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 0 },
      });
      await prisma.scorecard.create({ data: { eventId: event.id, stageId: r1.id, playerId: p.id, strokes: JSON.stringify(strokes), status: "approved" } });
    }
    const me = await prisma.user.create({ data: { email: PLAYER, name: "Tamsin Bell", password: "x:unusable" } });
    await prisma.account.create({ data: { eventId: event.id, name: "Tamsin Bell", email: PLAYER, role: "player" } });
    return {
      eventId: event.id,
      roundTwo: r2.id,
      organizer: sign(signedInNow(sec.id)),
      player: sign(signedInNow(me.id)),
    };
  } finally {
    await prisma.$disconnect();
  }
}
