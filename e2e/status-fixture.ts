import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Browser, BrowserContext, TestInfo } from "@playwright/test";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { isHeadToHead } from "../src/lib/stage-types";

/**
 * A THROWAWAY CLUB AND ONE TOURNAMENT FOR THE STATE MACHINE'S FAMILY SPECS
 * (`status-*.spec.ts`, proposal 5c; PR 3 onward).
 *
 * Marked `zz-status-<family>-<size>`, invented names, `@example.invalid`, one
 * club per screen size so the three viewports never share a row, deleted in
 * `done()` — call it in a `finally`. The organizer signs in with
 * `signedInNow(user.id)` and a proved address, as CLAUDE.md requires of a
 * fixture that signs itself in. The club answers money ("none") unless told
 * otherwise, so the money step is not what a spec is watching.
 */
export const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const PARS = new Array(18).fill(4);
const NAMES = ["Wren Halloway", "Ostin Pell", "Marla Quince", "Teo Varga", "Ines Corvo", "Bram Ellery", "Suki Thorne", "Ode Marchetti"];

/** A day `days` from now, as the app stores a day. */
export function dayFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export interface StatusFixture {
  ctx: BrowserContext;
  /** The fixture's mark, `zz-status-<family>-<size>`: a row a spec adds through the app is named and addressed with it. */
  mark: string;
  eventId: string;
  orgId: string;
  stageIds: string[];
  playerIds: string[];
  status: () => Promise<string>;
  done: () => Promise<void>;
}

export async function statusFixture(
  browser: Browser,
  baseURL: string | undefined,
  testInfo: TestInfo,
  opts: {
    family: string;
    /** The event row's own fields: dates, attendance, league points… */
    event?: Record<string, unknown>;
    /** Each round, in order. */
    rounds: Array<{ type: string; format: string; scoringBasis?: string; playedOn?: string }>;
    players?: number;
  },
): Promise<StatusFixture> {
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const mark = `zz-status-${opts.family}-${size}`;
  const email = `${mark}@example.invalid`;
  await prisma.user.deleteMany({ where: { email } });
  await prisma.organization.deleteMany({ where: { name: `${mark} club` } });
  const user = await prisma.user.create({ data: { email, name: "Zz Status Organizer", password: "x:unusable", emailVerifiedAt: new Date() } });
  const org = await prisma.organization.create({
    data: {
      name: `${mark} club`, kind: "club", timeZone: "America/New_York", locale: "en-US", moneyMode: "none",
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${mark} event`, dates: "", course: "Home", city: "", address: "", regDeadline: "",
      status: "draft", shareToken: `${mark}-${Date.now()}`, configUnlocked: true,
      customPars: JSON.stringify(PARS), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      /**
       * THE OVERALL RESULT, AS THE APP SETS IT FROM THE ROUNDS. The column defaults to "match",
       * and the app never leaves a medal on it: a template derives it from its rounds and the
       * first stroke round added sets "stroke" (`tournament.ts`, the same `isHeadToHead` rule).
       * Rows written past those doors kept the default, so a "Saturday medal" read
       * "Overall result: Match play" on Tournament details — a state the app cannot reach.
       */
      format: opts.rounds.some((r) => isHeadToHead(r.type)) ? "match" : "stroke",
      ...opts.event,
    },
  });
  const stageIds: string[] = [];
  for (const [i, r] of opts.rounds.entries()) {
    const s = await prisma.stage.create({
      data: { eventId: event.id, position: i, type: r.type, format: r.format, holes: 18, scoringBasis: r.scoringBasis ?? "gross", playedOn: r.playedOn ?? "" },
    });
    stageIds.push(s.id);
  }
  /**
   * A NET ROUND HAS RATED TEES (J27). Net scores need a Slope and Course Rating to make a Course
   * Handicap; without them Tournament details carries an open to-do ("Add tees…") and the setup
   * count is one short. These specs watch the panels agree on the dates, flights and play, not on
   * the tees (`net-without-tees-says-so.spec.ts` holds that), so a net round gets one rated tee.
   */
  if (opts.rounds.some((r) => (r.scoringBasis ?? "gross") !== "gross")) {
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${mark} Home`,
        pars: JSON.stringify(PARS),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        yards: JSON.stringify(new Array(18).fill(400)),
      },
    });
    await prisma.tee.create({ data: { courseId: course.id, name: "Blue", gender: "any", courseRating: 71.5, slopeRating: 125, par: 72 } });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });
    await prisma.stage.updateMany({ where: { eventId: event.id }, data: { courseId: course.id } });
  }
  const playerIds: string[] = [];
  for (let i = 0; i < (opts.players ?? 6); i += 1) {
    const p = await prisma.player.create({
      data: { eventId: event.id, name: NAMES[i % NAMES.length], email: `${mark}-${i}@example.invalid`, handicap: 10 + i, seed: i + 1, status: "confirmed" },
    });
    playerIds.push(p.id);
  }
  await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Status Organizer", role: "admin" } });
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  await ctx.addCookies([
    { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
    { name: "ng_active_event", value: sign(event.id), url: baseURL! },
  ]);
  return {
    ctx,
    mark,
    eventId: event.id,
    orgId: org.id,
    stageIds,
    playerIds,
    status: async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status,
    done: async () => {
      await ctx.close().catch(() => {});
      await prisma.organization.deleteMany({ where: { id: org.id } });
      await prisma.event.deleteMany({ where: { id: event.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

/**
 * Every player's card for one round, in and approved — a round played, nothing waiting on sign-off.
 * Given `playerIds`, only theirs: ONE card is "the round's first card", the moment the rounds rule
 * shuts a round's format, holes, venue and tees (state machine PR 7b) with the rest of the field
 * still out — the stage between "launched" and "round closed" these walks used to step over.
 */
export async function cardsIn(f: StatusFixture, stageId: string, playerIds: readonly string[] = f.playerIds): Promise<void> {
  for (const playerId of playerIds) {
    await prisma.scorecard.create({
      data: {
        eventId: f.eventId, stageId, playerId, strokes: JSON.stringify(new Array(18).fill(4)),
        status: "approved", certifiedBy: "zz", certifiedAt: new Date(), approvedBy: "zz", approvedAt: new Date(),
      },
    });
  }
}
