import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE CLUBHOUSE SCREEN AND THE EVENT PAGE, EACH IN THE STATE IT IS USED IN
 * (2026-10-24) — read by `e2e/clubhouse-and-event-page.spec.ts`.
 *
 * One throwaway club holding five tournaments, every row under `mark`:
 *
 *   live      under way, a public board, a field of 30 with cards in — longer
 *             than a 1280x720 screen, so the clubhouse screen has pages — and
 *             a straightest drive on the 10th, won, with a sponsor
 *   entries   taking entries, a public board, nothing played — the event
 *             page before the day
 *   finished  completed, a public board, four cards — the event page after
 *   held      under way, the board for ORGANIZERS ONLY (results not released),
 *             cards in, players named "Hidden …"
 *   members   under way, the board for organizers and players, players named
 *             "Members …"
 *
 * The last two are the controls: neither the clubhouse screen nor the event
 * page may show anything of them. Invented names, `@example.invalid`
 * addresses; `teardownClubhouse` removes all of it.
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

/** Eighteen 4s with some holes changed. */
const card = (changes = {}) => JSON.stringify(Array.from({ length: 18 }, (_, i) => changes[i + 1] ?? 4));

export async function teardownClubhouse(mark) {
  const prisma = new PrismaClient();
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: mark } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedClubhouse(mark) {
  await teardownClubhouse(mark);
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({ data: { name: `${mark} Golf Club`, kind: "club" } });

    const tournament = async (key, data, players) => {
      const event = await prisma.event.create({
        data: {
          organizationId: org.id,
          name: `${mark} ${data.title}`,
          status: data.status,
          shape: "single",
          format: "stroke",
          dates: data.dates ?? "",
          course: `${mark} Heath`,
          city: "",
          address: "",
          regDeadline: data.regDeadline ?? "",
          registrationOpen: data.registrationOpen ?? false,
          capacity: data.capacity ?? 0,
          leaderboardVisibility: data.visibility,
          customPars: JSON.stringify(new Array(18).fill(4)),
          customYards: JSON.stringify(new Array(18).fill(380)),
          customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
          shareToken: `${mark}-${key}-${randomBytes(6).toString("hex")}`,
          registrationToken: randomBytes(8).toString("hex"),
        },
      });
      const stage = await prisma.stage.create({
        data: {
          eventId: event.id,
          position: 0,
          description: "Round 1",
          type: "Stroke Play Round",
          format: "Individual Stroke Play",
          holes: 18,
          scoringBasis: "gross",
          handicapAllowance: 100,
          playedOn: data.playedOn ?? dayOffset(0),
          ...(data.status === "completed" ? { closedAt: new Date() } : {}),
        },
      });
      const made = [];
      for (const [i, name] of players.entries()) {
        const p = await prisma.player.create({
          data: { eventId: event.id, name, email: `${mark}-${key}-${i}@example.invalid`, handicap: 0, seed: i + 1, status: "confirmed" },
        });
        made.push(p);
        if (data.cards) {
          // Spread the field: player i drops (i mod 7) shots over the back nine, so the board has an order.
          const changes = {};
          for (let h = 0; h < i % 7; h += 1) changes[18 - h] = 5;
          await prisma.scorecard.create({
            data: { eventId: event.id, stageId: stage.id, playerId: p.id, strokes: card(changes), status: "approved" },
          });
        }
      }
      return { event, stage, players: made };
    };

    const FIELD = Array.from({ length: 30 }, (_, i) => `Golfer ${String(i + 1).padStart(2, "0")} Example`);
    const live = await tournament("live", { title: "Autumn Medal", status: "live", visibility: "public", cards: true, dates: "" }, FIELD);
    const entries = await tournament(
      "entries",
      { title: "Winter Stableford", status: "registration", visibility: "public", registrationOpen: true, regDeadline: dayOffset(9), capacity: 40, playedOn: dayOffset(14) },
      ["Early Entrant Example"],
    );
    const finished = await tournament(
      "finished",
      { title: "Summer Cup", status: "completed", visibility: "public", cards: true, playedOn: dayOffset(-7) },
      ["Ann Example", "Bob Example", "Cat Example", "Dan Example"],
    );
    const held = await tournament("held", { title: "Blind Championship", status: "live", visibility: "staff", cards: true }, [
      "Hidden One Example",
      "Hidden Two Example",
      "Hidden Three Example",
    ]);
    const members = await tournament("members", { title: "Members Medal", status: "live", visibility: "participants", cards: true }, [
      "Members One Example",
      "Members Two Example",
    ]);

    // The straightest drive on the live tournament's 10th: won, and sponsored.
    const straightest = await prisma.contest.create({
      data: {
        eventId: live.event.id,
        stageId: live.stage.id,
        kind: "straightest-drive",
        name: "Straightest drive",
        hole: 10,
        buyInCents: 0,
        sponsorName: `${mark} Motors`,
        sponsorUrl: "https://zz-clubhouse.example/",
        entrants: { create: [{ playerId: live.players[4].id, won: true }, { playerId: live.players[5].id }] },
      },
    });
    // And one on the held board, which nothing public may show.
    await prisma.contest.create({
      data: {
        eventId: held.event.id,
        stageId: held.stage.id,
        kind: "closest-pin",
        name: "Closest to the pin",
        hole: 7,
        buyInCents: 0,
        sponsorName: `${mark} Hidden Sponsor`,
        entrants: { create: [{ playerId: held.players[0].id, won: true }] },
      },
    });

    // The organizer: admin of the live tournament, the one they open in the console.
    const organizer = await prisma.user.create({
      data: { email: `${mark}-organizer@example.invalid`, name: "Organizer Example", password: "x:unusable" },
    });
    for (const t of [live, entries, finished, held, members]) {
      await prisma.account.create({ data: { eventId: t.event.id, name: organizer.name, email: organizer.email, role: "admin" } });
    }

    const view = (t) => ({
      eventId: t.event.id,
      name: t.event.name,
      shareToken: t.event.shareToken,
      registrationToken: t.event.registrationToken,
      players: t.players.map((p) => p.name),
    });
    return {
      live: view(live),
      entries: view(entries),
      finished: view(finished),
      held: view(held),
      members: view(members),
      straightestWinner: live.players[4].name,
      straightestId: straightest.id,
      organizer: { session: sign(signedInNow(organizer.id)), event: sign(live.event.id) },
    };
  } finally {
    await prisma.$disconnect();
  }
}
