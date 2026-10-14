import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { MARK } from "./fixture.mjs";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A 36-HOLE MEDAL WITH ROUND 1 IN PLAY AND A CUT TO COME.
 *
 * `the-cut-a-round-is-played-for.spec.ts` reads the rules sheet in the one
 * state where it used to be wrong: the field out on round 1, and round 2 cut to
 * the top 8 and ties. Neither the seeded club (its championship is finished)
 * nor the shared fixture holds that state, so this makes its own throwaway
 * club: an organizer, twelve invented players, round 1 cards half in.
 *
 * Kept OUT of `seed()`, so no other spec sees a second tournament.
 */
export const CUT_ORG = `${MARK}-cut-ahead`;
export const CUT_EVENT = `${MARK}-cut-ahead Autumn Scratch Medal`;
const ORGANIZER = `${MARK}-cut-ahead-sec@example.invalid`;
const PLAYER = `${MARK}-cut-ahead-p1@example.invalid`;

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/** Everything a run left. Safe to call when none of it exists. */
export async function teardownCutAhead(prisma = new PrismaClient()) {
  try {
    await prisma.event.deleteMany({ where: { name: CUT_EVENT } });
    const orgs = await prisma.organization.findMany({ where: { name: CUT_ORG }, select: { id: true } });
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

/** Seed from clean; return a signed session cookie for the organizer and for one player. */
export async function seedCutAhead() {
  await teardownCutAhead();
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: CUT_ORG, kind: "club" } });
    const sec = await prisma.user.create({ data: { email: ORGANIZER, name: "Rowan Secretary", password: "x:unusable" } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: sec.id, role: "owner" } });
    const pars = new Array(18).fill(4);
    const event = await prisma.event.create({
      data: {
        name: CUT_EVENT,
        organizationId: org.id,
        status: "live",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${MARK}-cut-ahead-tok`,
        customPars: JSON.stringify(pars),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    await prisma.account.create({ data: { eventId: event.id, name: "Rowan Secretary", email: ORGANIZER, role: "admin" } });
    const base = { eventId: event.id, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" };
    const r1 = await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" } });
    await prisma.stage.create({
      data: { ...base, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 8 },
    });
    // Twelve invented players; the first is the one we sign in as. Half the
    // field has a card in: the round is being played.
    const names = ["Ailsa Brodie", "Calum Dunn", "Effie Grant", "Hamish Innes", "Isla Keir", "Jock Lennox", "Kirsty Moir", "Lachlan Nairn", "Morag Orr", "Niall Pryde", "Oona Quarrie", "Ruaridh Shaw"];
    for (const [i, name] of names.entries()) {
      const email = i === 0 ? PLAYER : `${MARK}-cut-ahead-p${i + 1}@example.invalid`;
      const p = await prisma.player.create({ data: { eventId: event.id, name, email, seed: i + 1, status: "confirmed", handicap: 8 } });
      if (i % 2 === 0) {
        await prisma.scorecard.create({ data: { eventId: event.id, stageId: r1.id, playerId: p.id, strokes: JSON.stringify(pars.map((v, h) => (h < 9 ? v + (i % 3 === 0 ? 1 : 0) : null))) } });
      }
    }
    const me = await prisma.user.create({ data: { email: PLAYER, name: "Ailsa Brodie", password: "x:unusable" } });
    await prisma.account.create({ data: { eventId: event.id, name: "Ailsa Brodie", email: PLAYER, role: "player" } });
    return { organizer: sign(signedInNow(sec.id)), player: sign(signedInNow(me.id)) };
  } finally {
    await prisma.$disconnect();
  }
}
