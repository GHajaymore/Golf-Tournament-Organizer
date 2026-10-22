import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A FINISHED TWO-ROUND MEDAL WITH MONEY IN IT, for the final report
 * (2026-10-21) — read by `e2e/final-report.spec.ts` in a browser and by
 * `final-report-reads-the-readers.audit.test.ts` against the database.
 *
 * Everything the report can say is here, and each part is small enough to
 * work out by hand:
 *
 *   course   par 4 at every hole (72), stroke index 1..18
 *   Round 1  Ann 70 (birdies on 1 and 2)   Bob 72   Cat 73 (bogey 18)   Dan 74 (bogeys 17, 18)
 *   Round 2  Ann 75 (bogeys 1, 2, 3)   Bob 69 (eagle on 5, birdie on 6)   Cat 71 (birdie 1)   Dan 72
 *   totals   Bob 141, Cat 144, Ann 145, Dan 146 — gross, so no handicap is in it
 *
 * So the lead changes hands (Ann after one round, Bob at the end), the board's
 * order is not the alphabet, and there is an eagle to put at the top of the
 * highlights. The money: a $5 gross skins pot on round 1 (Ann takes holes 1
 * and 2, everything else is shared), a $2 birdie pot on round 2, a $1 closest
 * to the pin Ann won, a $50 prize for the winner, and a $40 course fee Bob
 * paid for all four. And a second tournament at the club taking entries, and
 * a pinned notice, for "Coming up".
 *
 * Invented names, `@example.invalid` addresses, every row under `mark`; the
 * teardown takes all of it.
 */

const dayOffset = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/** Eighteen 4s with some holes changed: `{ 1: 3 }` is a birdie on the 1st. */
const card = (changes = {}) => JSON.stringify(Array.from({ length: 18 }, (_, i) => changes[i + 1] ?? 4));

export const REPORT_PLAYERS = ["Ann", "Bob", "Cat", "Dan"];

export async function teardownReport(mark) {
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: mark } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedReport(mark) {
  await teardownReport(mark);
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: `${mark} Golf Club`, kind: "club", moneyMode: "split" } });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${mark} Two-Day Medal`,
        status: "completed",
        shape: "single",
        format: "stroke",
        dates: "",
        course: `${mark} Heath`,
        city: "",
        address: "",
        regDeadline: "",
        leaderboardVisibility: "public",
        moneyMode: "split",
        customPars: JSON.stringify(new Array(18).fill(4)),
        customYards: JSON.stringify(new Array(18).fill(380)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        shareToken: `${mark}-${randomBytes(6).toString("hex")}`,
        registrationToken: randomBytes(8).toString("hex"),
      },
    });

    const stages = [];
    for (const [i, offset] of [-9, -8].entries()) {
      stages.push(
        await prisma.stage.create({
          data: {
            eventId: event.id,
            position: i,
            description: `Round ${i + 1}`,
            type: "Stroke Play Round",
            format: "Individual Stroke Play",
            holes: 18,
            scoringBasis: "gross",
            handicapAllowance: 100,
            playedOn: dayOffset(offset),
            closedAt: new Date(),
          },
        }),
      );
    }

    const players = {};
    for (const [i, name] of REPORT_PLAYERS.entries()) {
      players[name] = await prisma.player.create({
        data: {
          eventId: event.id,
          name: `${name} Example`,
          email: `${mark}-${name.toLowerCase()}@example.invalid`,
          handicap: 0,
          seed: i + 1,
          status: "confirmed",
        },
      });
    }
    const cards = [
      [0, "Ann", card({ 1: 3, 2: 3 })],
      [0, "Bob", card()],
      [0, "Cat", card({ 18: 5 })],
      [0, "Dan", card({ 17: 5, 18: 5 })],
      [1, "Ann", card({ 1: 5, 2: 5, 3: 5 })],
      [1, "Bob", card({ 5: 2, 6: 3 })],
      [1, "Cat", card({ 1: 3 })],
      [1, "Dan", card()],
    ];
    for (const [s, name, strokes] of cards) {
      await prisma.scorecard.create({
        data: { eventId: event.id, stageId: stages[s].id, playerId: players[name].id, strokes, status: "approved" },
      });
    }

    const everyone = REPORT_PLAYERS.map((n) => players[n].id);
    const pot = await prisma.skinsPot.create({
      data: { eventId: event.id, stageId: stages[0].id, buyInCents: 500, net: false, scope: "full", groupKey: "" },
    });
    await prisma.skinsEntry.createMany({ data: everyone.map((playerId) => ({ potId: pot.id, playerId, confirmed: true })) });

    const birdies = await prisma.sideGame.create({
      data: { eventId: event.id, stageId: stages[1].id, kind: "birdies", buyInCents: 200, entryMode: "opt-in", groupKey: "" },
    });
    await prisma.sideGameEntry.createMany({
      data: everyone.map((playerId) => ({ sideGameId: birdies.id, playerId, confirmed: true })),
    });

    const ctp = await prisma.contest.create({
      data: { eventId: event.id, stageId: stages[0].id, kind: "closest-pin", name: "Closest to the pin", hole: 3, buyInCents: 100, entryMode: "opt-in" },
    });
    await prisma.contestEntry.createMany({
      data: everyone.map((playerId) => ({ contestId: ctp.id, playerId, confirmed: true, won: playerId === players.Ann.id })),
    });

    await prisma.prize.create({
      data: { eventId: event.id, position: 1, category: "Winner", amount: 50, winnerId: players.Bob.id },
    });
    await prisma.expense.create({
      data: {
        eventId: event.id,
        description: "Course fee",
        amountCents: 4000,
        paidBy: players.Bob.id,
        category: "green-fee",
        shares: { create: everyone.map((playerId) => ({ playerId, weight: 1 })) },
      },
    });
    await prisma.announcement.create({
      data: { eventId: event.id, title: "Prize giving in the clubhouse", body: "Seven o'clock, after the second round.", pinned: true },
    });

    // The club's next tournament, taking entries — "Coming up".
    const next = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${mark} Autumn Foursomes`,
        status: "registration",
        registrationOpen: true,
        shape: "single",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: dayOffset(5),
        startOn: dayOffset(12),
        capacity: 32,
        shareToken: `${mark}-${randomBytes(6).toString("hex")}`,
        registrationToken: randomBytes(8).toString("hex"),
      },
    });

    // The organizer, and a sign-in for one of the field (Cat).
    const organizer = await prisma.user.create({
      data: { email: `${mark}-organizer@example.invalid`, name: "Organizer Example", password: "x:unusable" },
    });
    await prisma.account.create({ data: { eventId: event.id, name: organizer.name, email: organizer.email, role: "admin" } });
    const cat = await prisma.user.create({
      data: { email: players.Cat.email, name: players.Cat.name, password: "x:unusable" },
    });
    await prisma.account.create({ data: { eventId: event.id, name: cat.name, email: cat.email, role: "player" } });

    return {
      eventId: event.id,
      nextEventId: next.id,
      shareToken: event.shareToken,
      stageIds: stages.map((s) => s.id),
      players: Object.fromEntries(Object.entries(players).map(([k, p]) => [k, { id: p.id, name: p.name, email: p.email }])),
      organizerEmail: organizer.email,
      organizer: { session: sign(signedInNow(organizer.id)), event: sign(event.id) },
      cat: { session: sign(signedInNow(cat.id)), event: sign(event.id) },
    };
  } finally {
    await prisma.$disconnect();
  }
}
