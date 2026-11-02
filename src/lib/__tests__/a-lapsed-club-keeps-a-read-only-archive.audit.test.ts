import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A LAPSED PAID CLUB KEEPS A READ-ONLY ARCHIVE FOR TWELVE MONTHS (Ajay,
 * 2026-10-21, decisions A4 and A8), against real rows, the real webhook write,
 * the real actions and the real sweeps.
 *
 * What it replaced: a 30-day hold, after which Par's terms reached tournaments
 * that were never Par's — the daily stamp dated a live league's fourteen days
 * from its first round, months before, and the next sweep deleted it. That is
 * the case this fixture is built around: a league begun weeks ago, still live,
 * with a card on it, and a completed medal beside it.
 *
 * Each claim has its partner:
 *   - refused, IN WORDS, through the real actions — and still viewable;
 *   - the Par stamp and the Par sweep leave the archive alone — and CONTROL: a
 *     Par tournament the club makes after the lapse is still swept by Par;
 *   - Par's one-at-a-time allowance is not eaten by the archive;
 *   - the notices go at 30 and 7 days, once each — and the delete waits for
 *     the twelve months, then takes the archive and nothing else;
 *   - resubscribing lifts it — and a late replay of the old cancellation does
 *     not put it back.
 *
 * Fixture rows carry the ZZ-AUDIT-ARCHIVE mark, invented names and
 * example.invalid addresses, and are deleted in a finally.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setEventStatus, saveScorecard, addPrize } from "@/app/actions/tournament";
import { applySubscriptionWrite } from "@/lib/services/billing";
import { subscriptionWrite } from "@/lib/domain/billing";
import { stampParClocks, sweepClosedPar } from "@/lib/services/par-sweep";
import { sweepArchives, archiveRefusalFor, type ArchiveNotice } from "@/lib/services/club-archive";
import { archiveEndsAt } from "@/lib/domain/club-archive";
import { clubDayInWords } from "@/lib/domain/club-clock";
import { refusalFor } from "@/lib/services/limits";
import { loadEventState } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ARCHIVE";
const email = (who: string) => `zz-audit-archive-${who}@example.invalid`;
const DAY = 24 * 3600 * 1000;
const NOW = new Date();
/** Stripe's end date for the cancelled plan: yesterday, to the second. */
const ENDED = new Date(Math.floor((NOW.getTime() - DAY) / 1000) * 1000);
const UNTIL = archiveEndsAt(ENDED);
const ZONE = "Europe/London";
const LOCALE = "en-GB";
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

interface Club {
  orgId: string;
  userId: string;
  league: string;
  medal: string;
  round: string;
  playerId: string;
}

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-audit-archive-" } } });
}

/** A club paying through Stripe, with a live league under way and a completed medal. */
async function payingClub(who: string): Promise<Club> {
  // A proved address: `createSession` makes no session for one nobody has proved (email verification).
  const user = await prisma.user.create({ data: { email: email(who), name: `Owner ${who}`, password: "x", emailVerifiedAt: new Date() } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} ${who}`,
      kind: "club",
      timeZone: ZONE,
      locale: LOCALE,
      subscription: {
        create: { plan: "club", status: "active", provider: "stripe", providerCustomerId: `cus_zz_${who}`, providerSubscriptionId: `sub_zz_${who}`, planTermsApply: true },
      },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  const base = { organizationId: org.id, dates: "Sundays", course: "Home", city: "", address: "", regDeadline: "", shape: "series" };
  const fortnightAgo = new Date(NOW.getTime() - 40 * DAY).toISOString().slice(0, 10);
  const league = await prisma.event.create({
    data: {
      ...base,
      name: `${TAG} ${who} league`,
      status: "live",
      shareToken: `${TAG}-${who}-league-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      createdAt: new Date(NOW.getTime() - 60 * DAY),
    },
  });
  const medal = await prisma.event.create({
    data: { ...base, name: `${TAG} ${who} medal`, status: "completed", completedAt: new Date(NOW.getTime() - 20 * DAY), shareToken: `${TAG}-${who}-medal-${process.pid}`, createdAt: new Date(NOW.getTime() - 50 * DAY) },
  });
  const round = await prisma.stage.create({
    data: { eventId: league.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", playedOn: fortnightAgo },
  });
  const player = await prisma.player.create({
    data: { eventId: league.id, name: `Wren ${who}`, email: email(`${who}-wren`), seed: 1, status: "confirmed" },
  });
  await prisma.scorecard.create({
    data: { eventId: league.id, stageId: round.id, playerId: player.id, strokes: JSON.stringify(PARS) },
  });
  await prisma.account.create({ data: { eventId: league.id, email: email(who), name: `Owner ${who}`, role: "admin" } });
  return { orgId: org.id, userId: user.id, league: league.id, medal: medal.id, round: round.id, playerId: player.id };
}

async function signInAs(club: Club) {
  jar.clear();
  await createSession(club.userId);
  await setActiveEvent(club.league);
}

/** What the webhook writes when Stripe says this club's subscription ended at ENDED. */
const cancelled = (club: Club, who: string) =>
  subscriptionWrite(
    { id: `sub_zz_${who}`, status: "canceled", customer: `cus_zz_${who}`, metadata: { organizationId: club.orgId, plan: "club" }, ended_at: ENDED.getTime() / 1000 },
    NOW,
  )!;

const exists = async (id: string) => (await prisma.event.count({ where: { id } })) === 1;
const card = async (club: Club) =>
  (await prisma.scorecard.findFirst({ where: { stageId: club.round, playerId: club.playerId }, select: { strokes: true } }))?.strokes;

let kept: Club;
let back: Club;

beforeAll(async () => {
  await scrub();
  kept = await payingClub("kept");
  back = await payingClub("back");
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a paid club that lapses", () => {
  it("is archived from Stripe's end date: every tournament it holds, finished or not", async () => {
    await applySubscriptionWrite(cancelled(kept, "kept"));
    const sub = await prisma.subscription.findUnique({ where: { organizationId: kept.orgId } });
    expect(sub).toMatchObject({ plan: "free", status: "canceled", planTermsApply: true });
    expect(sub?.lapsedAt?.getTime()).toBe(ENDED.getTime());
    for (const id of [kept.league, kept.medal]) {
      expect((await prisma.event.findUnique({ where: { id } }))?.archivedAt?.getTime(), "not stamped").toBe(ENDED.getTime());
    }
  });

  it("refuses an edit and a score through the real actions, in words, and changes nothing", async () => {
    await signInAs(kept);
    const lapsed = clubDayInWords(ZONE, LOCALE, ENDED);
    const until = clubDayInWords(ZONE, LOCALE, UNTIL);
    expect(until).toMatch(/\d{4}/);

    const done = await setEventStatus("completed", true);
    expect(done.ok).toBe(false);
    expect(done.error).toBe(
      `This club's subscription ended on ${lapsed}, so this tournament is paused where it stands. Its tournaments are kept read-only until ${until}, then deleted. Resubscribe in Club settings to carry on from where it stopped.`,
    );
    expect((await prisma.event.findUnique({ where: { id: kept.league } }))?.status, "the status moved").toBe("live");

    const before = await card(kept);
    await expect(saveScorecard(kept.round, kept.playerId, PARS.map((p) => p + 1))).rejects.toThrow(`kept read-only until ${until}`);
    expect(await card(kept), "a refused score changed the card").toBe(before);

    await expect(addPrize("Nearest the pin", 10)).rejects.toThrow("paused where it stands");
    expect(await prisma.prize.count({ where: { eventId: kept.league } })).toBe(0);

    // A player is told it is paused, and nothing about a plan they cannot buy.
    const toPlayer = await archiveRefusalFor(kept.league, "player");
    expect(toPlayer).toContain("paused");
    expect(toPlayer).not.toContain("Club settings");
  });

  it("stays viewable: the board reads the card, and the completed medal is there", async () => {
    const state = await loadEventState(kept.league);
    expect(state, "an archived tournament stopped loading").toBeTruthy();
    expect(await exists(kept.medal)).toBe(true);
    expect(await card(kept)).toBe(JSON.stringify(PARS));
  });

  it("is never stamped or swept by Par's terms — CONTROL: a Par tournament made after the lapse is", async () => {
    const parOne = await prisma.event.create({
      data: {
        organizationId: kept.orgId, name: `${TAG} kept par`, dates: "", course: "", city: "", address: "", regDeadline: "",
        status: "live", shape: "series", shareToken: `${TAG}-kept-par-${process.pid}`, closesAt: new Date(NOW.getTime() - DAY),
      },
    });
    await stampParClocks(new Date(NOW.getTime() + DAY));
    expect((await prisma.event.findUnique({ where: { id: kept.league } }))?.closesAt, "Par's 14 days stamped on the archive").toBeNull();

    // Even a clock somebody stamped by hand does not let Par's sweep take it.
    await prisma.event.update({ where: { id: kept.league }, data: { closesAt: new Date(NOW.getTime() - DAY) } });
    await sweepClosedPar(new Date(NOW.getTime() + 300 * DAY));
    expect(await exists(kept.league), "Par's sweep deleted the archived league").toBe(true);
    expect(await exists(kept.medal), "Par's sweep deleted the archived medal").toBe(true);
    expect(await exists(parOne.id), "CONTROL: Par's own tournament was not swept").toBe(false);
    await prisma.event.update({ where: { id: kept.league }, data: { closesAt: null } });
  });

  it("does not count the archive against Par's one tournament at a time", async () => {
    expect(await refusalFor(kept.orgId, "activeEvents"), "the archived league ate Par's allowance").toBeNull();
  });

  it("tells the owners at 30 and 7 days, once each, and deletes the archive — and only the archive — after twelve months", async () => {
    const sent: ArchiveNotice[] = [];
    const notify = async (n: ArchiveNotice) => void sent.push(n);
    const at = (ms: number) => new Date(UNTIL.getTime() + ms);
    const parAfter = await prisma.event.create({
      data: {
        organizationId: kept.orgId, name: `${TAG} kept par after`, dates: "", course: "", city: "", address: "", regDeadline: "",
        status: "live", shape: "series", shareToken: `${TAG}-kept-after-${process.pid}`,
      },
    });
    const ours = () => sent.filter((n) => n.organizationId === kept.orgId);

    await sweepArchives(at(-31 * DAY), notify);
    expect(ours()).toEqual([]);
    await sweepArchives(at(-30 * DAY), notify);
    expect(ours().map((n) => n.days)).toEqual([30]);
    expect(ours()[0]).toMatchObject({ to: [email("kept")], tournaments: 2, until: clubDayInWords(ZONE, LOCALE, UNTIL) });
    await sweepArchives(at(-20 * DAY), notify);
    expect(ours().map((n) => n.days), "the 30-day notice went twice").toEqual([30]);
    await sweepArchives(at(-7 * DAY), notify);
    expect(ours().map((n) => n.days)).toEqual([30, 7]);

    await sweepArchives(at(-1), notify);
    expect(await exists(kept.league), "deleted before the twelve months were up").toBe(true);
    expect(await exists(kept.medal)).toBe(true);

    await sweepArchives(at(0), notify);
    expect(await exists(kept.league), "kept past the twelve months").toBe(false);
    expect(await exists(kept.medal)).toBe(false);
    expect(await exists(parAfter.id), "the archive sweep took a Par tournament").toBe(true);
    expect(ours().map((n) => n.days), "a notice after the delete").toEqual([30, 7]);
    await prisma.event.delete({ where: { id: parAfter.id } });
  });
});

describe("a lapsed club that resubscribes", () => {
  it("has its archive lifted, and carries on exactly where it stopped", async () => {
    await applySubscriptionWrite(cancelled(back, "back"));
    expect(await archiveRefusalFor(back.league)).toBeTruthy();

    // A new checkout: a NEW subscription, paid.
    await applySubscriptionWrite(
      subscriptionWrite(
        { id: "sub_zz_back_again", status: "active", customer: "cus_zz_back", metadata: { organizationId: back.orgId, plan: "club" }, current_period_end: Math.floor(NOW.getTime() / 1000) + 30 * 86_400 },
        NOW,
      )!,
    );
    const sub = await prisma.subscription.findUnique({ where: { organizationId: back.orgId } });
    expect(sub).toMatchObject({ plan: "club", status: "active", lapsedAt: null });
    for (const id of [back.league, back.medal]) {
      expect((await prisma.event.findUnique({ where: { id } }))?.archivedAt, "still archived after resubscribing").toBeNull();
    }
    expect(await archiveRefusalFor(back.league)).toBeNull();

    await signInAs(back);
    await addPrize("Nearest the pin", 10);
    expect(await prisma.prize.count({ where: { eventId: back.league } }), "a resubscribed club still refused").toBe(1);
  });

  it("is not put back in the archive by Stripe replaying the old cancellation", async () => {
    await applySubscriptionWrite(cancelled(back, "back"));
    const sub = await prisma.subscription.findUnique({ where: { organizationId: back.orgId } });
    expect(sub).toMatchObject({ plan: "club", status: "active", lapsedAt: null, providerSubscriptionId: "sub_zz_back_again" });
    expect((await prisma.event.findUnique({ where: { id: back.league } }))?.archivedAt).toBeNull();
  });

  it("CONTROL: Stripe giving up (unpaid) on the live subscription does archive it", async () => {
    await applySubscriptionWrite(
      subscriptionWrite({ id: "sub_zz_back_again", status: "unpaid", customer: "cus_zz_back", metadata: { organizationId: back.orgId, plan: "club" } }, NOW)!,
    );
    const sub = await prisma.subscription.findUnique({ where: { organizationId: back.orgId } });
    expect(sub).toMatchObject({ plan: "free", status: "unpaid" });
    expect(sub?.lapsedAt?.getTime()).toBe(NOW.getTime());
    expect((await prisma.event.findUnique({ where: { id: back.league } }))?.archivedAt?.getTime()).toBe(NOW.getTime());
  });
});
