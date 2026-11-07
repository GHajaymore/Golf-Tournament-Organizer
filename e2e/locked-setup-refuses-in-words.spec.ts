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
 *   Rounds & formats     Delete Round 2                  → rounds
 *
 * Each is refused under the press in the scope's words — "Locked because the
 * tournament is live. Make a committee correction to delete a round." — nothing
 * is written, the screen is still there, and it redraws with the banner naming
 * the scope and offering Make a committee correction.
 *
 * THEN THE CORRECTION ITSELF (TD Q2): pressed on Rounds & formats' banner, it
 * asks why, opens the rounds, the banner says who opened it and why, the record
 * holds the line, the same control now works, and Done closes it. The dashboard
 * offers the same button and never "Unlock configuration".
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

  // The fixture's facts, read from the fixture: the live medal, with flights and two rounds.
  const ev = club.events.find((e) => e.slug === "medal")!;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  expect(event.status, "the seeded medal is not launched").toBe("live");
  expect(event.configUnlocked, "the seeded medal's setup is unlocked the old way").toBe(false);
  expect(event.correctionScope, "the seeded medal already has a correction open").toBeNull();
  const stages = await prisma.stage.findMany({ where: { eventId: ev.id }, orderBy: { position: "asc" } });
  expect(stages.length, "the seeded medal has fewer than two rounds").toBeGreaterThanOrEqual(2);
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

    const round2 = stages[1];
    const deleteRound = async (p: Page) => {
      const card = p.locator("main .card", { has: p.locator("button", { hasText: /Round 2/ }) }).first();
      if (!(await card.getByRole("button", { name: /^Delete Round 2/ }).isVisible().catch(() => false))) await card.locator("button", { hasText: /Round 2/ }).first().click();
      await card.getByRole("button", { name: /^Delete Round 2/ }).click();
    };
    await pressedAfterTheLock({
      label: "Rounds & formats · Delete Round 2",
      path: "/stages",
      scope: "rounds",
      heading: /^Rounds & formats$/,
      said: LIVE("delete a round"),
      stored: () => prisma.stage.count({ where: { id: round2.id } }),
      press: deleteRound,
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
    // The same control now works — on an empty round, deleting is one press.
    const before = await prisma.stage.count({ where: { id: round2.id } });
    expect(before).toBe(1);
    await deleteRound(page);
    await expect.poll(() => prisma.stage.count({ where: { id: round2.id } }), { message: "the correction did not open the rounds" }).toBe(0);
    // Done closes it, on the record.
    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).correctionScope, { message: "Done did not close the correction" }).toBeNull();
    await expect(page.getByRole("region", { name: "Locked" }), "the rounds did not lock again after Done").toContainText("Locked because the tournament is live.", { timeout: 20_000 });
    expect(await prisma.auditLog.count({ where: { eventId: ev.id, action: "committee-correction" } })).toBe(2);

    // The dashboard: the correction, never the retired button.
    await open("/dashboard");
    await expect(page.getByRole("button", { name: "Make a committee correction" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Unlock configuration|Unlock setup/ })).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await closed();
    await prisma.auditLog.deleteMany({ where: { eventId: ev.id, action: "committee-correction" } });
  }
});
