import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * FOUR FINISHED TOURNAMENTS WITH MONEY AND EXTRAS IN THEM, for the rich report
 * (2026-10-23). None of the club's test tournaments had a side game, a skins
 * pot, a shared cost or a contest, so the report's money part had nothing to
 * show; these do. Read by `e2e/report-rich.spec.ts` in a browser and by
 * `the-rich-report.audit.test.ts` against the database — and seeded once more,
 * under `zz-report`, and KEPT, for the owner to look at.
 *
 *   Society Stableford   ten players, net Stableford off 100%, one round: a net
 *                        skins pot, a twos pot, nearest the pin on the 3rd,
 *                        longest drive on the 9th, a prize; two pick-ups.
 *   Club Cup             Reds v Blues, two sessions of four singles, decided
 *                        5½–2½ with the cup needing 4½.
 *   Casual Saturday      Ann v Bob, a singles match: a Nassau, a gross skins
 *                        pot and a buggy both pay for.
 *   Spring Medal         ten players, a gross medal: Ann and Bob tie on 72 with
 *                        identical cards (the committee's play-off, recorded on
 *                        the honours board), Cat and Dan on 74 apart on the
 *                        back nine.
 *   Autumn Championship  two gross rounds: Cora leads after one, Ailsa wins
 *                        from 4th with a 67 — the ladder.
 *   Knockout Cup         a straight knockout of four: Dev beats Ailsa 2&1 and
 *                        Bram at the 19th — the champion's path.
 *   Spring Four-Ball     four gross pairs: the winning side's card, whose ball
 *                        counted on each hole.
 *   Thursday League      three Stableford weeks off scratch, uneven attendance:
 *                        the table with a dot a week.
 *
 * Every card is worked out below so the report can be checked by hand.
 * Invented names, `@example.invalid` addresses, every row under `mark`.
 */

export const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
export const SI = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 18, 4, 2, 10, 6, 16, 12, 14];
const PAR3 = PARS.flatMap((p, i) => (p === 3 ? [i + 1] : []));

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};
const dayOffset = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
/** Par everywhere, with some holes changed: `{ 3: 2 }` is a two on the 3rd. */
const card = (changes = {}) => Array.from({ length: 18 }, (_, i) => changes[i + 1] ?? PARS[i]);
/** Strokes received on a hole, for a playing handicap up to 18 (stroke index `si`). */
const shot = (h, si) => (si <= h ? 1 : 0);

export const NAMES = [
  "Ailsa Thorne",
  "Bram Kettle",
  "Cora Vale",
  "Dev Arden",
  "Edda Moss",
  "Finn Larch",
  "Gwen Pike",
  "Hal Rook",
  "Isla Fenn",
  "Jory Wren",
];

export async function teardownRich(mark) {
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: mark } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  } finally {
    await prisma.$disconnect();
  }
}

function eventData(mark, org, name, extra = {}) {
  return {
    organizationId: org.id,
    name: `${mark} ${name}`,
    status: "completed",
    completedAt: new Date(),
    shape: "single",
    format: "stroke",
    dates: "",
    course: `${mark} Larchfield Links`,
    city: "",
    address: "",
    regDeadline: "",
    leaderboardVisibility: "public",
    moneyMode: "split",
    customPars: JSON.stringify(PARS),
    customYards: JSON.stringify(PARS.map((p) => (p === 3 ? 165 : p === 4 ? 390 : 520))),
    customStrokeIndex: JSON.stringify(SI),
    shareToken: `${mark}-${randomBytes(6).toString("hex")}`,
    registrationToken: randomBytes(8).toString("hex"),
    ...extra,
  };
}

async function field(prisma, mark, eventId, prefix, handicaps, extra = () => ({})) {
  const players = [];
  for (const [i, h] of handicaps.entries()) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          name: NAMES[i],
          email: `${mark}-${prefix}-${i + 1}@example.invalid`,
          handicap: h,
          seed: i + 1,
          status: "confirmed",
          ...extra(i),
        },
      }),
    );
  }
  return players;
}

export async function seedRich(mark) {
  await teardownRich(mark);
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({
      data: { name: `${mark} Larchfield Golf Club`, kind: "club", moneyMode: "split" },
    });
    const organizer = await prisma.user.create({
      data: { email: `${mark}-organizer@example.invalid`, name: "Organizer Example", password: "x:unusable" },
    });
    const out = { organizerEmail: organizer.email, events: /** @type {Record<string, any>} */ ({}) };
    const staff = async (eventId) => {
      await prisma.account.create({ data: { eventId, name: organizer.name, email: organizer.email, role: "admin" } });
      return { session: sign(signedInNow(organizer.id)), event: sign(eventId) };
    };

    // ── A. The society Stableford ─────────────────────────────────────────
    {
      const handicaps = [4, 8, 10, 12, 14, 16, 18, 6, 9, 18];
      const event = await prisma.event.create({ data: eventData(mark, org, "Society Stableford") });
      const stage = await prisma.stage.create({
        data: {
          eventId: event.id,
          position: 0,
          description: "Round 1",
          type: "Stroke Play Round",
          format: "Stableford",
          holes: 18,
          scoringBasis: "net",
          handicapAllowance: 100,
          playedOn: dayOffset(-2),
          closedAt: new Date(),
        },
      });
      const players = await field(prisma, mark, event.id, "sf", handicaps);
      // Gross cards: par plus a stroke on the hardest holes each player gets a
      // shot on, which is net par there (2 points); a few birdies and twos.
      const changes = [
        { 3: 2, 5: 3, 11: 2 }, // Ailsa: twos on the 3rd and 11th, a birdie on the 5th
        { 4: 6, 13: 6, 7: 2 }, // Bram: a two on the 7th
        { 1: 5, 2: 5, 4: 6 },
        { 1: 5, 2: 5, 4: 6, 13: 6, 16: 2 }, // Dev: a two on the 16th
        { 1: 5, 2: 5, 4: 6, 13: 6, 6: 5, 12: 5 },
        { 1: 5, 2: 5, 4: 6, 13: 6, 6: 5, 12: 5, 15: 5, 8: 5 },
        { 1: 6, 2: 5, 4: 7, 13: 6, 6: 5, 12: 5, 15: 5, 8: 5, 10: 5, 14: 5 },
        { 1: 5, 4: 6 },
        { 1: 5, 2: 5, 4: 6, 13: 6, 9: 4 },
        // Jory picks up on the 4th and the 13th: net double bogey, par + 2 + his shot there.
        { 1: 5, 2: 5, 4: 5 + 2 + 1, 13: 5 + 2 + 1, 6: 5, 12: 5, 15: 5, 8: 5 },
      ];
      for (const [i, p] of players.entries()) {
        await prisma.scorecard.create({
          data: { eventId: event.id, stageId: stage.id, playerId: p.id, strokes: JSON.stringify(card(changes[i])), status: "approved" },
        });
      }
      const everyone = players.map((p) => p.id);
      const skins = await prisma.skinsPot.create({
        data: { eventId: event.id, stageId: stage.id, buyInCents: 500, net: true, scope: "full", groupKey: "" },
      });
      await prisma.skinsEntry.createMany({ data: everyone.map((playerId) => ({ potId: skins.id, playerId, confirmed: true })) });
      const twos = await prisma.sideGame.create({
        data: { eventId: event.id, stageId: stage.id, kind: "twos", buyInCents: 200, entryMode: "opt-in", groupKey: "" },
      });
      await prisma.sideGameEntry.createMany({ data: everyone.map((playerId) => ({ sideGameId: twos.id, playerId, confirmed: true })) });
      const ntp = await prisma.contest.create({
        data: { eventId: event.id, stageId: stage.id, kind: "closest-pin", name: "Nearest the pin", hole: 3, buyInCents: 100, entryMode: "opt-in" },
      });
      await prisma.contestEntry.createMany({
        data: everyone.map((playerId, i) => ({ contestId: ntp.id, playerId, confirmed: true, won: i === 3 })),
      });
      const ld = await prisma.contest.create({
        data: { eventId: event.id, stageId: stage.id, kind: "long-drive", name: "Longest drive", hole: 9, buyInCents: 100, entryMode: "opt-in" },
      });
      await prisma.contestEntry.createMany({
        data: everyone.map((playerId, i) => ({ contestId: ld.id, playerId, confirmed: true, won: i === 7 })),
      });
      out.events.stableford = {
        eventId: event.id,
        shareToken: event.shareToken,
        stageId: stage.id,
        players: players.map((p) => ({ id: p.id, name: p.name, email: p.email })),
        organizer: await staff(event.id),
        twos: { [NAMES[0]]: 2, [NAMES[1]]: 1, [NAMES[3]]: 1 },
        pickUps: { player: NAMES[9], holes: [4, 13] },
      };
    }

    // ── B. The team cup ───────────────────────────────────────────────────
    {
      const event = await prisma.event.create({
        data: eventData(mark, org, "Club Cup — Reds v Blues", { shape: "single", format: "match", cupPointsToWin: 4.5 }),
      });
      const reds = await prisma.group.create({ data: { eventId: event.id, name: "Reds", position: 0 } });
      const blues = await prisma.group.create({ data: { eventId: event.id, name: "Blues", position: 1 } });
      const players = await field(prisma, mark, event.id, "cup", [4, 8, 12, 16, 5, 9, 13, 17], (i) => ({ groupId: i < 4 ? reds.id : blues.id }));
      const [r1, r2, r3, r4, b1, b2, b3, b4] = players;
      /** A match card: `wins` holes to A, then halved, so A wins `up&left` — or B where negative. */
      const holes = (result) => {
        // "3&2" to A: A wins holes 1-3, then 13 halved; over at 16. "1 up": A wins the 18th.
        const m = /^(B)?(\d)&(\d)$/.exec(result);
        if (m) {
          const who = m[1] ? "B" : "A";
          const up = Number(m[2]);
          const left = Number(m[3]);
          const played = 18 - left;
          return Array.from({ length: played }, (_, i) => (i < up ? who : "H"));
        }
        if (result === "AS") return Array.from({ length: 18 }, () => "H");
        const who = result.startsWith("B") ? "B" : "A";
        return Array.from({ length: 18 }, (_, i) => (i === 17 ? who : "H"));
      };
      const sessions = [
        { description: "Saturday singles", matches: [[r1, b1, "3&2"], [r2, b2, "B2&1"], [r3, b3, "AS"], [r4, b4, "1up"]] },
        { description: "Sunday singles", matches: [[r1, b2, "4&3"], [r2, b1, "1up"], [r3, b4, "B3&2"], [r4, b3, "2&1"]] },
      ];
      for (const [position, s] of sessions.entries()) {
        const stage = await prisma.stage.create({
          data: {
            eventId: event.id,
            position,
            type: "Team Session",
            format: "Match Play",
            description: s.description,
            holes: 18,
            scoringBasis: "gross",
            lineupPublished: true,
            playedOn: dayOffset(-3 + position),
            closedAt: new Date(),
          },
        });
        for (const [round, [a, b, r]] of s.matches.entries()) {
          await prisma.match.create({
            data: { eventId: event.id, stageId: stage.id, groupId: reds.id, round, playerAId: a.id, playerBId: b.id, holes: JSON.stringify(holes(r)), scoreStatus: "confirmed" },
          });
        }
      }
      out.events.cup = { eventId: event.id, shareToken: event.shareToken, organizer: await staff(event.id), score: [5.5, 2.5] };
    }

    // ── C. The casual round ───────────────────────────────────────────────
    {
      const event = await prisma.event.create({
        data: eventData(mark, org, "Casual Saturday — Ailsa v Bram", { status: "live", completedAt: null, shape: "match", format: "match" }),
      });
      const stage = await prisma.stage.create({
        data: {
          eventId: event.id,
          position: 0,
          description: "Round 1",
          type: "Round Robin",
          format: "Match Play",
          holes: 18,
          scoringBasis: "gross",
          playedOn: dayOffset(-1),
        },
      });
      const group = await prisma.group.create({ data: { eventId: event.id, name: "The match", position: 0 } });
      const [a, b] = await field(prisma, mark, event.id, "cas", [6, 6], () => ({ groupId: group.id }));
      // Gross cards. Ailsa wins 1, 5, 11 and 16; Bram wins 8 and 14; the rest halved.
      // Front nine to Ailsa (2 up), back nine to Ailsa (1 up), the match Ailsa 3 up — 3&2? No: played out
      // to the 18th by the card; the match result reads off the holes.
      const ac = card({ 1: 3, 5: 3, 8: 5, 11: 2, 14: 5, 16: 2 });
      const bc = card({ 1: 4, 5: 4, 8: 4, 11: 3, 14: 4, 16: 3 });
      const res = ac.map((s, i) => (s < bc[i] ? "A" : s > bc[i] ? "B" : "H"));
      const match = await prisma.match.create({
        data: { eventId: event.id, stageId: stage.id, groupId: group.id, round: 0, playerAId: a.id, playerBId: b.id, holes: JSON.stringify(res), scoreStatus: "confirmed" },
      });
      await prisma.matchScorecard.create({ data: { eventId: event.id, matchId: match.id, slot: "A", strokes: JSON.stringify(ac) } });
      await prisma.matchScorecard.create({ data: { eventId: event.id, matchId: match.id, slot: "B", strokes: JSON.stringify(bc) } });
      const nassau = await prisma.sideGame.create({
        data: { eventId: event.id, stageId: stage.id, kind: "nassau", buyInCents: 500, entryMode: "everyone", groupKey: "" },
      });
      await prisma.sideGameEntry.createMany({ data: [a, b].map((p) => ({ sideGameId: nassau.id, playerId: p.id, confirmed: true })) });
      const skins = await prisma.skinsPot.create({
        data: { eventId: event.id, stageId: stage.id, buyInCents: 200, net: false, scope: "full", groupKey: "" },
      });
      await prisma.skinsEntry.createMany({ data: [a, b].map((p) => ({ potId: skins.id, playerId: p.id, confirmed: true })) });
      await prisma.expense.create({
        data: {
          eventId: event.id,
          description: "Buggy hire",
          amountCents: 4000,
          paidBy: a.id,
          category: "other",
          shares: { create: [a, b].map((p) => ({ playerId: p.id, weight: 1 })) },
        },
      });
      out.events.casual = { eventId: event.id, shareToken: event.shareToken, organizer: await staff(event.id), players: [a.name, b.name] };
    }

    // ── D. The medal with a countback and a play-off ──────────────────────
    {
      const event = await prisma.event.create({ data: eventData(mark, org, "Spring Medal") });
      const stage = await prisma.stage.create({
        data: {
          eventId: event.id,
          position: 0,
          description: "Round 1",
          type: "Stroke Play Round",
          format: "Stroke Play",
          holes: 18,
          scoringBasis: "gross",
          playedOn: dayOffset(-4),
          closedAt: new Date(),
        },
      });
      const players = await field(prisma, mark, event.id, "md", [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
      const cards = [
        card(), // Ailsa 72
        card(), // Bram 72 — identical: no countback can part them
        card({ 2: 5, 5: 5 }), // Cora 74, back nine 36
        card({ 10: 5, 12: 5 }), // Dev 74, back nine 38 — third on countback, back 9
        card({ 1: 5, 4: 6, 7: 4, 12: 5 }), // 76
        card({ 1: 5, 4: 6, 7: 4, 12: 5, 15: 5 }), // 77
        card({ 1: 5, 4: 6, 7: 4, 12: 5, 15: 5, 18: 6 }), // 78
        card({ 1: 5, 4: 6, 7: 4, 12: 5, 15: 5, 18: 6, 9: 6 }), // 79
        card({ 1: 6, 4: 6, 7: 4, 12: 5, 15: 5, 18: 6, 9: 6 }), // 80
        card({ 1: 6, 4: 7, 7: 4, 12: 5, 15: 5, 18: 6, 9: 6 }), // 81
      ];
      for (const [i, p] of players.entries()) {
        await prisma.scorecard.create({
          data: { eventId: event.id, stageId: stage.id, playerId: p.id, strokes: JSON.stringify(cards[i]), status: "approved" },
        });
      }
      await prisma.honoursEntry.create({
        data: {
          organizationId: org.id,
          eventId: event.id,
          eventName: event.name,
          year: new Date().getFullYear(),
          playerId: players[0].id,
          championName: players[0].name,
          note: "Won the play-off at the 2nd extra hole",
          confirmedBy: organizer.email,
        },
      });
      await prisma.prize.create({ data: { eventId: event.id, position: 1, category: "Best gross", amount: 25, winnerId: players[0].id } });
      out.events.medal = {
        eventId: event.id,
        shareToken: event.shareToken,
        organizer: await staff(event.id),
        players: players.map((p) => ({ id: p.id, name: p.name })),
      };
    }

    // ── E. Two rounds of medal: the ladder ────────────────────────────────
    {
      const event = await prisma.event.create({ data: eventData(mark, org, "Autumn Championship") });
      const stages = [];
      for (const i of [0, 1]) {
        stages.push(
          await prisma.stage.create({
            data: {
              eventId: event.id,
              position: i,
              description: `Round ${i + 1}`,
              type: "Stroke Play Round",
              format: "Stroke Play",
              holes: 18,
              scoringBasis: "gross",
              playedOn: dayOffset(-10 + i),
              closedAt: new Date(),
            },
          }),
        );
      }
      const players = await field(prisma, mark, event.id, "ch", [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
      // Round 1: Cora leads (70), Ailsa 4th (73). Round 2: Ailsa 67 and wins on 140.
      const r1 = [73, 72, 70, 71, 74, 75, 76, 77, 78, 79];
      // Totals: Ailsa 140, Dev 143, Bram 144, Cora 145 — nobody level, so the order is the figures'.
      const r2 = [67, 72, 75, 72, 73, 74, 75, 76, 77, 78];
      const cardOf = (total) => card(Object.fromEntries(Array.from({ length: Math.abs(total - 72) }, (_, k) => [k + 1, PARS[k] + Math.sign(total - 72)])));
      for (const [i, p] of players.entries()) {
        for (const [s, totals] of [r1, r2].entries()) {
          await prisma.scorecard.create({
            data: { eventId: event.id, stageId: stages[s].id, playerId: p.id, strokes: JSON.stringify(cardOf(totals[i])), status: "approved" },
          });
        }
      }
      out.events.championship = { eventId: event.id, shareToken: event.shareToken, organizer: await staff(event.id) };
    }

    // ── F. A straight knockout of four: the champion's path ───────────────
    {
      const event = await prisma.event.create({
        data: eventData(mark, org, "Knockout Cup", { shape: "knockout", format: "match", bracketMode: "single" }),
      });
      await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
      const players = await field(prisma, mark, event.id, "ko", [3, 6, 9, 12]);
      // 1 v 4: Dev (4) beats Ailsa 2&1; 2 v 3: Bram beats Cora 3&2; the final: Dev beats Bram at the 19th.
      await prisma.bracketWinner.create({ data: { eventId: event.id, key: "winners-0-0", winnerId: players[3].id, result: "2&1" } });
      await prisma.bracketWinner.create({ data: { eventId: event.id, key: "winners-0-1", winnerId: players[1].id, result: "3 and 2" } });
      await prisma.bracketWinner.create({ data: { eventId: event.id, key: "winners-1-0", winnerId: players[3].id, result: "19th" } });
      out.events.knockout = { eventId: event.id, shareToken: event.shareToken, organizer: await staff(event.id) };
    }

    // ── G. A net four-ball: the winning side's card ───────────────────────
    {
      const event = await prisma.event.create({ data: eventData(mark, org, "Spring Four-Ball") });
      const stage = await prisma.stage.create({
        data: {
          eventId: event.id,
          position: 0,
          description: "Round 1",
          type: "Stroke Play Round",
          format: "Four-Ball",
          holes: 18,
          scoringBasis: "gross",
          playedOn: dayOffset(-6),
          closedAt: new Date(),
        },
      });
      const players = await field(prisma, mark, event.id, "fb", [4, 6, 8, 10, 12, 14, 16, 18]);
      // Ailsa & Bram: Ailsa birdies the 3rd and 11th, Bram the 7th and 16th; better ball 68.
      const cards = [
        card({ 3: 2, 11: 2, 5: 5 }),
        card({ 7: 2, 16: 2, 1: 5 }),
        card({ 2: 3, 9: 6 }),
        card({ 9: 4, 4: 6 }),
        card({ 1: 5, 2: 5 }),
        card({ 5: 3 }),
        card({ 6: 5, 8: 5 }),
        card({ 6: 5, 13: 6 }),
      ];
      for (let t = 0; t < 4; t += 1) {
        const team = await prisma.team.create({ data: { eventId: event.id, stageId: stage.id, name: `Pair ${t + 1}`, seed: t + 1 } });
        for (const [pos, i] of [2 * t, 2 * t + 1].entries()) {
          await prisma.teamMember.create({ data: { teamId: team.id, playerId: players[i].id, position: pos } });
          await prisma.teamScorecard.create({
            data: { eventId: event.id, stageId: stage.id, teamId: team.id, playerId: players[i].id, strokes: JSON.stringify(cards[i]) },
          });
        }
      }
      out.events.fourball = { eventId: event.id, shareToken: event.shareToken, organizer: await staff(event.id) };
    }

    // ── H. A Stableford league of three weeks, uneven attendance ──────────
    {
      const event = await prisma.event.create({ data: eventData(mark, org, "Thursday League", { shape: "series" }) });
      const stages = [];
      for (const i of [0, 1, 2]) {
        stages.push(
          await prisma.stage.create({
            data: {
              eventId: event.id,
              position: i,
              description: `Round ${i + 1}`,
              type: "Stroke Play Round",
              format: "Stableford",
              holes: 18,
              scoringBasis: "net",
              handicapAllowance: 100,
              playedOn: dayOffset(-21 + 7 * i),
              closedAt: new Date(),
            },
          }),
        );
      }
      const players = await field(prisma, mark, event.id, "lg", [0, 0, 0, 0, 0, 0, 0, 0]);
      // Off scratch, so points are par 2 a hole: 36 for a level card, +1 a birdie.
      // Ailsa misses week 2 and scores best per hole; Bram plays all three.
      const weeks = [
        [{ 3: 2, 7: 2 }, null, { 3: 2, 11: 2 }],
        [{ 3: 2 }, { 7: 2 }, { 16: 2 }],
        [{}, { 3: 2 }, {}],
        [{ 1: 5 }, {}, {}],
        [{}, null, {}],
        [{ 1: 5 }, { 1: 5 }, null],
        [{}, {}, { 1: 5 }],
        [null, {}, {}],
      ];
      for (const [i, p] of players.entries()) {
        for (const [s, changes] of weeks[i].entries()) {
          if (!changes) continue;
          await prisma.scorecard.create({
            data: { eventId: event.id, stageId: stages[s].id, playerId: p.id, strokes: JSON.stringify(card(changes)), status: "approved" },
          });
        }
      }
      out.events.league = { eventId: event.id, shareToken: event.shareToken, organizer: await staff(event.id) };
    }

    // The club's next tournament, taking entries — "What's next".
    await prisma.event.create({
      data: eventData(mark, org, "Autumn Foursomes", {
        status: "registration",
        completedAt: null,
        registrationOpen: true,
        regDeadline: dayOffset(6),
        startOn: dayOffset(13),
        capacity: 32,
      }),
    });
    out.par3s = PAR3;
    return out;
  } finally {
    await prisma.$disconnect();
  }
}

// `node e2e/report-rich-fixture.mjs seed zz-report` seeds the owner's copy and prints the links.
if (process.argv[1] && process.argv[1].endsWith("report-rich-fixture.mjs")) {
  const [, , cmd, mark = "zz-report"] = process.argv;
  if (!/@localhost[:/]|@127\.0\.0\.1[:/]/.test(process.env.DATABASE_URL ?? "")) {
    console.error("Refusing: DATABASE_URL is not the local development database.");
    process.exit(1);
  }
  if (cmd === "seed") {
    const out = await seedRich(mark);
    for (const [k, e] of Object.entries(out.events)) console.log(`${k}: /live/${e.shareToken}/report`);
  } else if (cmd === "teardown") {
    await teardownRich(mark);
    console.log("removed");
  } else {
    console.log("usage: node e2e/report-rich-fixture.mjs seed|teardown [mark]");
  }
}
