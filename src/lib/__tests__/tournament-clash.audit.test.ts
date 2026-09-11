import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tournamentClashFor } from "@/lib/services/tournament-clash";
import { todayIso } from "@/lib/deadline";

/**
 * Setting up a quick round on the morning of the club medal.
 *
 * A casual round is private and temporary: its own field, its own pot, its own
 * card, deleted a day later. On a Sunday that is exactly right. On the morning
 * of a competition it produces two cards for one round of golf — the one the
 * club will score, and one that vanishes tomorrow taking the skins with it.
 *
 * So the setup screen names the round they are already in. The judgement in it
 * is entirely about WHEN to speak: a league runs for four months, and warning a
 * member of one every time they open this screen is how a warning stops being
 * read. Today, confirmed, and a real tournament.
 *
 * Real rows, because every one of those conditions is a different table and
 * the interesting cases are the ones that must stay QUIET.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLASH";
const EMAIL = `${TAG}.ann@example.invalid`.toLowerCase();

/**
 * `todayIso`, not `toISOString().slice(0, 10)`.
 *
 * A round is a calendar day and this app reads it LOCALLY — `todayIso` is
 * built out of `getFullYear/getMonth/getDate` for exactly that reason. The
 * first version of this file computed the fixture's date in UTC, which agrees
 * on a British afternoon and stops agreeing the moment the machine is west of
 * Greenwich and the clock is past eight in the evening: UTC has rolled over,
 * the app has not, and every "warns today" assertion fails against a round
 * dated tomorrow.
 *
 * It went red at 20:04 Eastern on 2026-09-10 having passed an hour earlier,
 * with no code change in between. One rule, one reader — the test asks the
 * same function the service asks.
 */
const TODAY = todayIso();
const TOMORROW = todayIso(new Date(Date.now() + 24 * 60 * 60 * 1000));

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** One tournament this person is entered in, with one round on a given day. */
async function tournament(
  label: string,
  over: {
    playedOn?: string;
    status?: string;
    shape?: string;
    playerStatus?: string;
    description?: string;
    teeSheetPublished?: boolean;
  } = {},
) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${label} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${label}`,
      status: over.status ?? "live",
      shape: over.shape ?? "single",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${label}-${process.pid}`,
    },
  });
  await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      description: over.description ?? "",
      type: "Stroke Play Round",
      format: "Individual Stroke Play",
      holes: 18,
      playedOn: over.playedOn ?? TODAY,
      teeSheetPublished: over.teeSheetPublished ?? false,
    },
  });
  await prisma.player.create({
    data: {
      eventId: event.id,
      name: `${TAG} ann`,
      email: EMAIL,
      seed: 1,
      status: over.playerStatus ?? "confirmed",
    },
  });
  return event;
}

beforeEach(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("somebody due to play a tournament round today", () => {
  it("is warned, and the round is named", async () => {
    const event = await tournament("medal", { description: "Club Medal" });
    const clash = await tournamentClashFor(EMAIL);
    expect(clash?.eventId).toBe(event.id);
    expect(clash?.eventName).toBe(`${TAG} medal`);
    // The organizer's own words win — "Club Medal" is more use than "Round 1".
    expect(clash?.roundLabel).toBe("Club Medal");
  });

  it("falls back to a round number when the organizer wrote no description", async () => {
    await tournament("open");
    expect((await tournamentClashFor(EMAIL))?.roundLabel).toBe("Round 1");
  });

  it("says whether the tee sheet is out, because that decides their group", async () => {
    await tournament("drawn", { teeSheetPublished: true });
    expect((await tournamentClashFor(EMAIL))?.teeSheetPublished).toBe(true);
  });

  it("notices the tournament is already running money", async () => {
    const event = await tournament("pots");
    const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: event.id } });
    await prisma.skinsPot.create({
      data: { eventId: event.id, stageId: stage.id, buyInCents: 500 },
    });
    expect((await tournamentClashFor(EMAIL))?.hasMoneyGame).toBe(true);
  });

  it("says so when it is not", async () => {
    // The control: without it the assertion above passes against a reader
    // that always says yes.
    await tournament("nopots");
    expect((await tournamentClashFor(EMAIL))?.hasMoneyGame).toBe(false);
  });
});

describe("when it stays quiet, which is most of the time", () => {
  it("says nothing about a round that is not today", async () => {
    /**
     * The judgement this whole reader turns on. A league runs for months, and
     * a member of one is not playing a tournament round on a Tuesday in June.
     * Warning them every visit is how a warning stops being read.
     */
    await tournament("nextweek", { playedOn: TOMORROW });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });

  it("says nothing about a round with no date at all", async () => {
    await tournament("undated", { playedOn: "" });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });

  it("says nothing about a tournament that has not been launched", async () => {
    await tournament("draft", { status: "draft" });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });

  it("says nothing about a tournament that is over", async () => {
    await tournament("done", { status: "completed" });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });

  it("says nothing to somebody on the waitlist", async () => {
    // They are not playing, and pointing them at a tee sheet they are not on
    // would be worse than silence.
    await tournament("waiting", { playerStatus: "waitlisted" });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });

  it("says nothing about another quick round", async () => {
    // One fourball is not a reason to warn somebody off another, and this is
    // also what stops it firing on the round they set up an hour ago.
    await tournament("fourball", { shape: "match" });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });

  it("says nothing to somebody who is in no tournament", async () => {
    await tournament("someone-elses");
    await prisma.player.deleteMany({ where: { email: EMAIL } });
    expect(await tournamentClashFor(EMAIL)).toBeNull();
  });
});

describe("somebody in more than one thing at once", () => {
  it("picks the tournament round rather than the quick round", async () => {
    // A casual round set up this morning and a medal this afternoon. The one
    // worth naming is the one with a committee behind it.
    await tournament("sunday-fourball", { shape: "match" });
    const medal = await tournament("saturday-medal");
    expect((await tournamentClashFor(EMAIL))?.eventId).toBe(medal.id);
  });

  it("picks the round that is today rather than the one next week", async () => {
    await tournament("later", { playedOn: TOMORROW });
    const now = await tournament("now");
    expect((await tournamentClashFor(EMAIL))?.eventId).toBe(now.id);
  });
});
