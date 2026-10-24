import { test, expect, type Locator } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";
import { verifyByCode } from "./verify-by-code";

/**
 * TIME TO A FIRST EVENT, MEASURED (the panel's item 4, approved by Ajay,
 * 2026-10-24: "Time to a first event is MEASURED and held under 10 minutes").
 *
 * THE MEASURE: from a new club secretary's first arrival at the front door to a
 * tournament whose entry link WORKS — opened by somebody else, signed out, it
 * shows the entry form with the tournament's name on it. Everything between is
 * walked as the secretary walks it, through the screens and nothing else:
 *
 *   sign up as a golf club → the emailed code → add the first member (a club
 *   draws its fields from its members, and is asked for them before its first
 *   tournament) → name the club and the first tournament, "a single round" →
 *   Entries → publish the sign-up link → the link, opened by a member
 *
 * AT THE PANEL'S PACE, not the machine's: before every press the secretary takes
 * `READ_MS` to read the screen and find the next control, and types at
 * `TYPE_MS` a character (about 60 words a minute) — a person at a desk, not a
 * script. The wall clock is asserted under ten minutes, and the screens seen,
 * the presses made and the characters typed are printed with it, so a change
 * that adds a screen or a press shows up in the figures before it shows up in
 * the time.
 *
 * Its own fixture: `zz-sechome-first-…` addresses, invented names, and the club
 * the sign-up makes — found again through the person's membership AND through
 * any tournament that address organizes (CLAUDE.md, "a run killed inside an
 * organizer-from-nothing spec poisons the next one"), deleted in a `finally`.
 * It never touches the shared fixture.
 *
 * WHAT IT CANNOT SEE: a secretary who reads slower than this, or stops to set
 * up a course card, a logo or a members list of 120 first — the measure is the
 * shortest honest path, and `READ_MS` is the panel's figure for one person
 * reading one screen, not a promise about everybody.
 */

const LIMIT_MS = 10 * 60_000;
/** Reading a screen and finding the next control, per press. */
const READ_MS = 3_000;
/** A character typed, at about 60 words a minute. */
const TYPE_MS = 200;

const prisma = new PrismaClient();
const stem = (project: string) => `zz-sechome-first-${project}`;

async function teardown(mark: string) {
  const email = `${mark}@example.invalid`;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const owned = user ? await prisma.organizationMember.findMany({ where: { userId: user.id }, select: { organizationId: true } }) : [];
  // And the club a killed run left with nobody in it: found through a tournament this address organizes.
  const reached = await prisma.event.findMany({ where: { accounts: { some: { email } } }, select: { organizationId: true } });
  for (const organizationId of new Set([...owned, ...reached].map((o) => o.organizationId))) {
    const others = await prisma.organizationMember.count({ where: { organizationId, ...(user ? { userId: { not: user.id } } : {}) } });
    if (others > 0) throw new Error(`refusing: organization ${organizationId} has other members`);
    await prisma.event.deleteMany({ where: { organizationId } });
    const courses = await prisma.course.findMany({ where: { organizationId }, select: { id: true } });
    await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
    await prisma.course.deleteMany({ where: { organizationId } });
    await prisma.member.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
}

test.afterAll(async () => {
  await prisma.$disconnect();
});
// A press that cannot land fails in seconds and says where, rather than waiting out the whole clock.
test.use({ actionTimeout: 20_000, navigationTimeout: 60_000 });

test("a new club secretary has a tournament with a working entry link in under ten minutes", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(LIMIT_MS + 120_000);
  const mark = stem(testInfo.project.name);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await teardown(mark);

  // The figures, counted as the secretary goes.
  let presses = 0;
  let typed = 0;
  const screens: string[] = [];
  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return;
    const path = new URL(f.url()).pathname;
    if (screens[screens.length - 1] !== path) screens.push(path);
  });
  const press = async (l: Locator) => {
    await page.waitForTimeout(READ_MS);
    await l.scrollIntoViewIfNeeded();
    await l.click();
    presses += 1;
  };
  const type = async (l: Locator, text: string) => {
    await l.click();
    await l.pressSequentially(text, { delay: TYPE_MS });
    typed += text.length;
  };
  const visible = (l: Locator) => l.locator("visible=true").first();

  const club = `${mark} Golf Club`;
  const tournament = `${mark} Opening Medal`;
  const email = `${mark}@example.invalid`;
  let link = "";
  let elapsed = 0;
  const visitor = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    const started = Date.now();

    await test.step("signs up, as a golf club", async () => {
      await page.goto("/");
      await landingSettled(page);
      await press(page.getByRole("tab", { name: "Sign up", exact: true }));
      await type(visible(page.getByPlaceholder("Full name")), "Rowan Fairlie");
      await type(visible(page.getByPlaceholder("you@email.com")), email);
      // A test value for this app only, generated here — see CLAUDE.md on fixtures.
      await type(visible(page.getByPlaceholder("Choose a password")), "Seventh-Tee-Box-Moss-41");
      await press(visible(page.getByText("A golf club or course")));
      await press(visible(page.getByRole("button", { name: "Create account" })));
      await verifyByCode(page, email);
      presses += 1; // "Confirm email", pressed inside the helper
      typed += 6;
      await page.waitForURL(/\/choose/, { timeout: 60_000 });
    });

    await test.step("adds the club's first member", async () => {
      // The club is asked for its members before its first tournament, and says so.
      await page.waitForLoadState("networkidle").catch(() => {});
      await press(visible(page.getByRole("link", { name: /Add your members/ })));
      await page.waitForURL(/\/roster/, { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      const add = page.getByRole("button", { name: "Add member" }).first();
      await press(add);
      await type(page.getByLabel("Name", { exact: true }), "Isla Penhallow");
      await type(page.getByLabel(/^Email/).first(), `${mark}-member@example.invalid`);
      await type(page.getByLabel("Handicap index"), "14.2");
      await press(page.getByRole("button", { name: "Add member" }).last());
      await expect(page.locator("main")).toContainText("Isla Penhallow", { timeout: 20_000 });
    });

    await test.step("names the club and its first tournament", async () => {
      await press(visible(page.getByRole("link", { name: /Create your first tournament/ })));
      await page.waitForURL(/\/choose/, { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await type(page.getByLabel("Tournament name"), tournament);
      await press(page.getByRole("button", { name: /^A single round/ }));
      // A club is named once, here, on the way to its first tournament.
      await type(page.getByLabel(/Who.s running this\?/), club);
      await press(page.getByRole("radiogroup", { name: "What kind of outfit runs it" }).getByText(/club/i).first());
      await press(page.getByRole("button", { name: "Create tournament" }));
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    });

    await test.step("publishes the sign-up link", async () => {
      await page.waitForLoadState("networkidle").catch(() => {});
      await press(visible(page.locator("main").getByRole("link", { name: "Entries", exact: true })));
      await page.waitForURL(/\/registration/, { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await press(page.getByRole("button", { name: /Let players sign themselves up/ }));
      await press(page.getByRole("button", { name: "Publish the link" }));
      await expect(page.getByRole("button", { name: "Take the link down" })).toBeVisible({ timeout: 20_000 });
      link = await page.locator("input").evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.includes("/register/")) ?? "");
      expect(link, "no sign-up link is shown").toMatch(/\/register\//);
    });

    await test.step("the link works: a member opens it and is shown the entry form", async () => {
      const member = await visitor.newPage();
      watchPageErrors(member, errors, "member");
      await member.goto(new URL(link).pathname);
      await expect(member.locator("body")).toContainText(tournament);
      await expect(member.getByRole("button", { name: "Register" })).toBeVisible();
      elapsed = Date.now() - started;

      // Beyond the clock: it takes an entry, too.
      await member.getByLabel("Your name").fill("Corin Ashdown-Vale");
      await member.getByLabel("Email").fill(`${mark}-entrant@example.invalid`);
      await member.getByLabel("Handicap index").fill("18.4");
      const mobile = member.getByLabel(/^Mobile/);
      if (await mobile.count()) await mobile.fill("5550142");
      await member.getByRole("button", { name: "Register" }).click();
      await expect(member.getByRole("heading", { name: "You're in!" })).toBeVisible({ timeout: 20_000 });
    });

    const figures = `${Math.round(elapsed / 1000)}s at the panel's pace · ${new Set(screens).size} screens (${screens.join(" → ")}) · ${presses} presses · ${typed} characters typed`;
    console.log(`[time-to-first-event] ${testInfo.project.name}: ${figures}`);
    testInfo.annotations.push({ type: "time to first event", description: figures });
    expect(elapsed, `time to a first event with a working entry link: ${figures}`).toBeLessThan(LIMIT_MS);
    // CONTROL: the clock measured the walk, not nothing — the pace alone is a minute and more.
    expect(elapsed, "the clock stopped before the walk was done").toBeGreaterThan(presses * READ_MS);
  } finally {
    await visitor.close();
    await teardown(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
