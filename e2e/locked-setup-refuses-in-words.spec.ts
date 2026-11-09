import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";
import { makeCommitteeCorrection, CORRECTION_REASON } from "./committee-correction";

/**
 * EVERY LOCKED CONTROL IS REFUSED IN WORDS, NOT AN ERROR PAGE (state machine PR 5b; J10).
 *
 * PR 5a did Teams & pairs. The 28 sites in `actions/tournament.ts` still refused
 * a locked tournament by THROWING (`assertUnlocked`), and a throw inside a
 * transition replaced the screen with "This screen didn't load". A screen drawn
 * BEFORE the lock (the Organizer launched in another tab) still offers every
 * control. They now ask their scope's lock and RETURN the reason and way out,
 * and the screen catches up (`useAction`).
 *
 * So one control per changed screen is pressed here, by the club's organizer, on
 * a screen drawn while the scope was open (a committee correction on it) and
 * locked again since (the correction ended):
 *
 *   Tournament details   Save                            → details
 *   Entries              Save entry terms                → the field
 *   Flights              Rename <the first flight> (Enter) → flights
 *   Rounds & formats     Round 1 · Cut the field for Round 2 → rounds
 *
 * (Round 2 is this spec's own: the seeded medal is one round, so an empty one is
 * added to this file's copy of the club before the walk. Deleting it was the
 * press until J12 PR 7b opened deleting an undrawn round (and, 8 Nov, its holes) after launch.)
 *
 * Each is refused under the press in the scope's words — "Locked because the
 * tournament is live. Make a committee correction to change the cut." — nothing
 * is written, the screen is still there, and it redraws with the banner naming
 * the scope and offering Make a committee correction.
 *
 * THEN THE CORRECTION ITSELF (TD Q2): pressed on Rounds & formats' banner, it
 * asks why, opens the rounds, the banner says who opened it and why, the record
 * holds the line, the same control now works, and Done closes it. The dashboard
 * offers the same button and never "Unlock configuration".
 *
 * LAST, THE OLD UNLOCK'S ONE CONTROL: a tournament left unlocked as a whole from
 * before PR 5b (`configUnlocked`) says so on the dashboard and offers only Lock
 * setup again (`setConfigUnlocked(false)`), which locks it, on the record, and
 * brings the correction back. No screen turns the old unlock ON any more.
 *
 * WHAT IT CANNOT PRESS, and where each is proved instead: the other 24 sites
 * (Clear scores among them), the assistant's "Ask the Organizer" words, a lapsed
 * correction and the audit lines for Launch, Complete and Reopen —
 * `a-locked-scope-is-refused-in-words.audit.test.ts`, against real rows.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const WALKED = ["desktop"];

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (!WALKED.includes(testInfo.project.name)) return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (WALKED.includes(testInfo.project.name)) await teardown();
  await prisma.$disconnect();
});

test("each locked control, pressed on a screen drawn before the lock, is refused in words; a committee correction opens one scope and Done closes it", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "one size: the refusal is the server's answer, the same at every width");
  test.setTimeout(360_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");

  // The fixture's facts, read from the fixture: the live medal, with flights and its rounds.
  const ev = club.events.find((e) => e.slug === "medal")!;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  expect(event.status, "the seeded medal is not launched").toBe("live");
  expect(event.configUnlocked, "the seeded medal's setup is unlocked the old way").toBe(false);
  expect(event.correctionScope, "the seeded medal already has a correction open").toBeNull();
  const seeded = await prisma.stage.findMany({ where: { eventId: ev.id }, orderBy: { position: "asc" } });
  expect(seeded.length, "the seeded medal has no round").toBeGreaterThanOrEqual(1);
  expect(seeded.some((s) => s.cutEnabled), "a cut would change the rounds' numbers this spec reads").toBe(false);
  /**
   * THE ROUND THIS SPEC DELETES IS ITS OWN. The seeded medal is ONE round, with cards on it
   * (`scripts/seed-club.mjs`), and every other spec reads it as one. So an empty round is added
   * after the last, copied from it, to the copy of the club this file seeded in `beforeAll` and
   * tears down in `afterAll` (one worker: no other spec is reading it meanwhile) — it is what is
   * refused while locked and deleted through the correction.
   */
  const last = seeded[seeded.length - 1];
  const added = await prisma.stage.create({
    data: {
      eventId: ev.id,
      position: last.position + 1,
      description: `Round ${seeded.length + 1}`,
      type: last.type,
      format: last.format,
      holes: last.holes,
      nine: last.nine,
      courseId: last.courseId,
      teeId: last.teeId,
      scoringBasis: last.scoringBasis,
    },
  });
  const addedLabel = `Round ${seeded.length + 1}`;
  // The first flight, labelled as the board labels it (`flightLabel`: a one- or two-character name reads "Flight X", a longer one as itself).
  const flight = await prisma.group.findFirstOrThrow({ where: { eventId: ev.id, isCarrier: false }, orderBy: { position: "asc" } });
  const flightName = flight.name.trim();
  const flightLabel = /^[A-Za-z0-9]{1,2}$/.test(flightName) ? `Flight ${flightName}` : flightName;

  /** The correction opened and closed by the database, so each screen is drawn open and then locked "in another tab". */
  const opened = (scope: string) =>
    prisma.event.update({
      where: { id: ev.id },
      data: { correctionScope: scope, correctionReason: "zz-sm5b drawn open", correctionBy: "Zz Organizer", correctionUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });
  const closed = () =>
    prisma.event.update({ where: { id: ev.id }, data: { correctionScope: null, correctionReason: null, correctionBy: null, correctionUntil: null } });

  try {
    await context.addCookies([
      { name: "ng_session", value: club.organizer.session, url: baseURL! },
      { name: "ng_active_event", value: sign(ev.id), url: baseURL! },
    ]);
    const open = async (path: string) => {
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
    };
    const LIVE = (what: string) => `Locked because the tournament is live. Make a committee correction to ${what}.`;

    /**
     * Draw the screen with the scope open, lock it "in another tab", press, and read the answer:
     * said and in view, nothing written, the screen still there, and caught up with the banner.
     */
    const pressedAfterTheLock = async (
      step: { label: string; path: string; scope: string; heading: RegExp; said: string; stored: () => Promise<unknown>; press: (page: Page) => Promise<void> },
    ) => {
      await opened(step.scope);
      await open(step.path);
      await expect(page.getByRole("region", { name: "Locked" }), `${step.label}: the screen was drawn locked`).toHaveCount(0);
      const before = await step.stored();
      await closed();
      await step.press(page);
      const said = page.getByText(step.said).first();
      await expect(said, `${step.label}: the refusal was not said`).toBeVisible({ timeout: 20_000 });
      await expect(said, `${step.label}: the refusal is not in view`).toBeInViewport();
      await expect(page.getByRole("heading", { level: 1, name: step.heading }), `${step.label}: the screen was replaced by an error page`).toBeVisible();
      const banner = page.getByRole("region", { name: "Locked" });
      await expect(banner, `${step.label}: the screen did not catch up with the lock`).toContainText("Locked because the tournament is live.", { timeout: 20_000 });
      await expect(banner.getByRole("button", { name: "Make a committee correction" }), `${step.label}: the Organizer has no way out on the banner`).toBeVisible();
      expect(await step.stored(), `${step.label}: written while locked`).toEqual(before);
    };

    await pressedAfterTheLock({
      label: "Tournament details · Save",
      path: "/event",
      scope: "details",
      heading: /^Tournament details$/,
      said: LIVE("change the tournament’s details"),
      stored: async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).name,
      press: async (p) => {
        await p.getByLabel(/^Tournament name/).first().fill(`${event.name} zz`);
        await p.getByRole("button", { name: /^Save/ }).first().click();
      },
    });

    await pressedAfterTheLock({
      label: "Entries · Save entry terms",
      path: "/registration",
      scope: "field",
      heading: /^Entries$/,
      said: LIVE("change the entry terms"),
      stored: async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).capacity,
      press: async (p) => {
        await p.getByLabel("Places in the field (players)").fill("77");
        await p.getByRole("button", { name: "Save entry terms" }).click();
      },
    });

    await pressedAfterTheLock({
      label: `Flights · Rename ${flightLabel}`,
      path: "/grouping",
      scope: "flights",
      heading: /^Flights$/,
      said: LIVE("rename a flight"),
      stored: async () => (await prisma.group.findUniqueOrThrow({ where: { id: flight.id } })).name,
      press: async (p) => {
        await p.getByRole("button", { name: `Rename ${flightLabel}` }).click();
        const box = p.getByRole("textbox", { name: `Rename ${flightLabel}` });
        await box.fill("Handicap");
        await box.press("Enter");
      },
    });

    /**
     * THE ROUNDS' PRESS IS THE CUT. Deleting an empty round was this press until J12 PR 7b, which
     * judges a delete — and since 8 Nov a round's holes — by what it would invalidate (an undrawn round
     * goes on one press, launched or not: `round-changes-after-scores.spec.ts`). So the press here is
     * one the launch lock still holds: "Cut the field for <the added round>", on the card of the
     * seeded round before it (the stroke cut is drawn there, on the round it is made out of).
     */
    const round2 = added;
    const lastLabel = `Round ${seeded.length}`;
    const cutOn = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: round2.id } })).cutEnabled;
    const cutTheField = async (p: Page) => {
      const card = p.locator("main .card", { has: p.locator("button", { hasText: lastLabel }) }).first();
      const box = card.getByRole("checkbox", { name: `Cut the field for ${addedLabel}` });
      if (!(await box.isVisible().catch(() => false))) await card.locator("button", { hasText: lastLabel }).first().click();
      await box.click();
    };
    expect(added.cutEnabled, "the added round already has a cut").toBe(false);
    await pressedAfterTheLock({
      label: `Rounds & formats · ${lastLabel} · Cut the field for ${addedLabel}`,
      path: "/stages",
      scope: "rounds",
      heading: /^Rounds & formats$/,
      said: LIVE("change the cut"),
      stored: cutOn,
      press: cutTheField,
    });

    // ── THE COMMITTEE CORRECTION, pressed on Rounds & formats' banner (TD Q2) ──
    await open("/stages");
    const banner = page.getByRole("region", { name: "Locked" });
    await expect(banner).toContainText("Rounds");
    await makeCommitteeCorrection(page);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(row.correctionScope, "the correction opened the wrong scope").toBe("rounds");
    expect(row.correctionReason).toBe(CORRECTION_REASON);
    expect(row.correctionUntil!.getTime(), "the correction has no end").toBeGreaterThan(Date.now());
    await expect(page.getByText(/Open for a correction by .*: ‘zz spec: correcting a setup mistake’/), "the banner does not say who opened it and why").toBeVisible({ timeout: 20_000 });
    expect(
      (await prisma.auditLog.findMany({ where: { eventId: ev.id, action: "committee-correction" } })).map((l) => l.detail),
      "the record has no line for the correction",
    ).toEqual([expect.stringContaining(`opened rounds for a correction: ${CORRECTION_REASON}`)]);
    // The same control now works — the cut into the added round is set on one press.
    expect(await cutOn()).toBe(false);
    await cutTheField(page);
    await expect.poll(cutOn, { message: "the correction did not open the rounds" }).toBe(true);
    // Done closes it, on the record.
    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).correctionScope, { message: "Done did not close the correction" }).toBeNull();
    await expect(page.getByRole("region", { name: "Locked" }), "the rounds did not lock again after Done").toContainText("Locked because the tournament is live.", { timeout: 20_000 });
    expect(await prisma.auditLog.count({ where: { eventId: ev.id, action: "committee-correction" } })).toBe(2);

    // The dashboard: the correction, never the retired button.
    await open("/dashboard");
    await expect(page.getByRole("button", { name: "Make a committee correction" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Unlock configuration|Unlock setup/ })).toHaveCount(0);

    // ── A TOURNAMENT THE OLD WHOLE-SETUP UNLOCK STILL HOLDS OPEN (from before PR 5b) ──
    // No screen turns `configUnlocked` ON any more; the one control left for it is the
    // dashboard's Lock setup again (`setConfigUnlocked(false)`), pressed here by the Organizer.
    await prisma.event.update({ where: { id: ev.id }, data: { configUnlocked: true } });
    await open("/dashboard");
    await expect(page.getByText("Setup was unlocked as a whole, the old way, and stays open until it is locked again.")).toBeVisible({ timeout: 20_000 });
    const lockAgain = page.getByRole("button", { name: "Lock setup again" });
    await lockAgain.click();
    await expect
      .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).configUnlocked, { message: "Lock setup again stored nothing" })
      .toBe(false);
    await expect(lockAgain, "Lock setup again is still offered once locked").toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText("Setup was unlocked as a whole, the old way"), "the old unlock is still said once locked").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make a committee correction" }), "the correction is not offered once the old unlock is closed").toBeVisible();
    expect(
      await prisma.auditLog.count({ where: { eventId: ev.id, action: "committee-correction", detail: { contains: "Locked setup again" } } }),
      "the record has no line for locking the old unlock",
    ).toBe(1);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await prisma.event.update({ where: { id: ev.id }, data: { configUnlocked: false } });
    await closed();
    await prisma.auditLog.deleteMany({ where: { eventId: ev.id, action: "committee-correction" } });
  }
});
