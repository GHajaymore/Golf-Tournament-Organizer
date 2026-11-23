import { test, expect } from "./coverage";
import { join } from "node:path";
import { prisma, makeClub, dropClub, makeEvent, signIn } from "./rounds-fixture";
import { EventScreen } from "./console/event";

/**
 * EVENT SETUP, SAID SHORT — step B of the organizer cleanup (Ajay, 2026-10-05).
 *
 * The shared fixture's tournament is launched and has four rounds, which is
 * the screen an organizer comes back to mid-season: setup finished, a setting
 * to check or change.
 */
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

test("a launched tournament's setup reads short, and every explanation is one tap away", async ({ page }) => {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  const main = page.locator("main");

  // The checklist is one line once launched, its rows a tap away.
  const checklist = main.getByText(/^Setup checklist · \d+ of \d+ done$/);
  await expect(checklist).toBeVisible();
  await checklist.click();
  await expect(main.getByText("Tournament details", { exact: true }).first()).toBeVisible();

  // An option is its name; its explanation opens from its own ⓘ — and lands
  // inside the screen, on a phone as on a desktop.
  await expect(main.getByText(/A blind event/)).toHaveCount(0);
  const info = main.getByRole("button", { name: "More about Organizers only" });
  await info.scrollIntoViewIfNeeded();
  // EVERY FRAME from the tap, not one read after it is visible: a single read
  // passed or failed by when it landed (CI saw 324 against 321 twice). Each
  // frame must sit where the rule puts it — centred under its icon, slid just
  // inside an 8px margin when that would run off — so a first frame drawn
  // unplaced fails, and so does a panel that comes to rest overshot.
  const frames = await info.evaluate(async (btn: HTMLElement) => {
    btn.click();
    const out: { left: number; right: number; expected: number }[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = btn.parentElement?.querySelector<HTMLElement>(".field-info-panel");
      if (!p) continue;
      const r = p.getBoundingClientRect();
      const a = btn.parentElement!.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const centred = a.left + a.width / 2 - r.width / 2;
      out.push({ left: r.left, right: r.right, expected: Math.max(8, Math.min(centred, vw - 8 - r.width)) });
    }
    return out;
  });
  const panel = main.getByRole("note").filter({ hasText: /A blind event/ });
  await expect(panel).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(frames.length, "the explanation never opened").toBeGreaterThan(0);
  for (const f of frames) {
    expect(f.left, "the explanation starts off the left edge").toBeGreaterThanOrEqual(0);
    expect(f.right, "the explanation runs off the right edge").toBeLessThanOrEqual(width + 1);
    expect(Math.abs(f.left - f.expected), `the explanation sits at ${f.left}, not ${f.expected}`).toBeLessThanOrEqual(1);
  }

  // Four rounds: there is a next week, so weekly sign-up is still asked.
  await expect(main.getByText("Weekly sign-up", { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// R3: Event as what, when and where, with ONE Save. Deleted at R17 with the old screen.
test.describe("@redesign", () => {
  // Its own club: the shared fixture is the launched tournament everybody else reads, and this one is renamed.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ timeout: 150_000 });

  test("the name and the last day are kept by ONE Save, and the dates still save after launch", async ({ page, context, baseURL }, testInfo) => {
    const mark = `zz-evt-one-save-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
    const club = await makeClub(mark);
    try {
      const { event } = await makeEvent(club, "Spring Medal", {
        stages: [{ playedOn: "2099-06-12" }],
        event: { startOn: "2099-06-12", endOn: "2099-06-12", dates: "Jun 12, 2099" },
      });
      await signIn(context, baseURL!, club, event.id);
      const screen = new EventScreen(page);
      await screen.open();
      // CONTROL: nothing changed, so there is nothing to save.
      await expect(screen.save()).toBeDisabled();

      // PRESSED as the secretary would: rename it and move the last day, then ONE press keeps both.
      await screen.nameInput().fill(`${mark} Renamed Medal`);
      await screen.lastDay().fill("2099-06-14");
      await expect(screen.save()).toBeEnabled();
      await screen.saveAndWait();

      // Seen on a fresh load, not on the page that was typed into.
      await page.reload();
      await page.locator("[data-event-screen]").waitFor({ state: "visible" });
      await expect(screen.nameInput()).toHaveValue(`${mark} Renamed Medal`);
      await expect(screen.lastDay()).toHaveValue("2099-06-14");
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).endOn).toBe("2099-06-14");

      // A refusal is said beside the button, and the typed name is kept for the next try.
      await screen.nameInput().fill("   ");
      await screen.save().click();
      await expect(screen.refusal(/Name the tournament before saving/)).toBeVisible();

      // LAUNCHED: the details read as text under one banner, and the same ONE Save keeps the dates alone.
      await prisma.event.update({ where: { id: event.id }, data: { status: "live", launchedAt: new Date() } });
      await screen.open();
      await expect(screen.lockedOnce()).toHaveAttribute("data-locked-once", "locked");
      await expect(screen.nameInput(), "a locked event still offers the name box").toHaveCount(0);
      await expect(screen.section("what")).toContainText(`${mark} Renamed Medal`);
      await screen.lastDay().fill("2099-06-16");
      await screen.saveAndWait();
      await page.reload();
      await page.locator("[data-event-screen]").waitFor({ state: "visible" });
      await expect(screen.lastDay()).toHaveValue("2099-06-16");
      const kept = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(kept.endOn).toBe("2099-06-16");
      expect(kept.name, "the dates' save wrote the details too").toBe(`${mark} Renamed Medal`);
    } finally {
      await dropClub(mark).catch(() => {});
    }
  });

  test("a league is played on more than one course: the second is ticked and kept as a venue", async ({ page, context, baseURL }, testInfo) => {
    const mark = `zz-evt-two-courses-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
    const club = await makeClub(mark);
    try {
      const card = { pars: JSON.stringify(new Array(18).fill(4)), strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)), yards: JSON.stringify(new Array(18).fill(380)) };
      const first = await prisma.course.create({ data: { organizationId: club.orgId, name: `${mark} Hollins Moss`, ...card } });
      const second = await prisma.course.create({ data: { organizationId: club.orgId, name: `${mark} Green Crest`, ...card } });
      const { event } = await makeEvent(club, "Summer League", {
        stages: [{ playedOn: "2099-06-12" }],
        event: { playKind: "league", startOn: "2099-06-12", endOn: "2099-06-12", dates: "Jun 12, 2099", courseId: first.id, course: first.name },
      });
      await prisma.eventCourse.create({ data: { eventId: event.id, courseId: first.id } });
      await signIn(context, baseURL!, club, event.id);
      const screen = new EventScreen(page);
      await screen.open();

      // OFFERED to a league, as to any kind: choose "More than one course" and tick the second.
      const where = screen.section("where");
      await where.locator("label.seg-opt", { hasText: "More than one course" }).click();
      await expect(where.getByLabel("More than one course")).toBeChecked();
      const venues = where.locator("[data-event-venues]");
      await venues.getByLabel(`${second.name}`).check();
      await expect(venues.getByRole("status")).toContainText("Saved: 2 courses");

      // Seen on a fresh load: both are ticked, and each is an EventCourse row.
      await page.reload();
      await page.locator("[data-event-screen]").waitFor({ state: "visible" });
      await expect(screen.section("where").getByLabel("More than one course")).toBeChecked();
      await expect(screen.section("where").locator("[data-event-venues]").getByLabel(second.name)).toBeChecked();
      expect(await prisma.eventCourse.count({ where: { eventId: event.id } })).toBe(2);

      // And "the players arrange their own" is under More, which a phone folds: open it first.
      const more = await screen.openMore();
      await more.getByLabel(/No fixed course/).check();
      await screen.saveAndWait();
      await page.reload();
      await page.locator("[data-event-screen]").waitFor({ state: "visible" });
      await expect(screen.section("where")).toContainText("The players arrange their own course");
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).courseMode).toBe("open");
    } finally {
      await dropClub(mark).catch(() => {});
    }
  });
});
