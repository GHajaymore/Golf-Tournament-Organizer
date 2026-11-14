import { test, expect, type Locator, type Page, type TestInfo } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";
import { verifyByCode } from "./verify-by-code";
import { journey, projectTag, ceilingBreaches, READ_MS, type Journey } from "./journey";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, sessionOf, addDays, dayIn } from "./rounds-fixture";
import { expectLaunched } from "./end-early";
import { clubToday } from "../src/lib/domain/club-clock";

/**
 * THE SECRETARY'S JOURNEYS, MEASURED (the panel's item 4, approved by Ajay, 2026-10-24: "Time to a
 * first event is MEASURED and held under 10 minutes"; work plan row 0b, 14 Nov: the journeys get
 * ceilings that fail CI).
 *
 *   J1  secretary-first-event     the front door to a tournament whose entry link WORKS — opened by
 *                                 somebody else, signed out, it shows the entry form with the
 *                                 tournament's name: sign up as a golf club → the emailed code → add
 *                                 the first member (a club is asked for its members before its first
 *                                 tournament) → name the club and the first tournament, "a single
 *                                 round" → Entries → publish the sign-up link → the link, opened
 *   J2  secretary-playable-event  a first event somebody can PLAY: J1's sign-up, then the date and the
 *                                 course from the catalogue, the round, eight members by a file, the
 *                                 launch, the tee sheet drawn and published — until a member, signed
 *                                 in on another phone, sees their tee time on Today. The ten-minute
 *                                 promise is held here.
 *   J3  secretary-copy-last-event a returning secretary: last summer's medal copied from the home with
 *                                 a new first day → Entries → the new link, opened signed out
 *
 * Walked as the secretary walks them, through the screens and nothing else, and counted by
 * `e2e/journey.ts` (screens, visits, returns, presses, boxes, characters, seconds) AT THE PANEL'S PACE:
 * before every press the secretary takes `READ_MS` to read the screen, and types at `TYPE_MS` a
 * character — a person at a desk, not a script. Each prints one `JOURNEY {…}` line and its step list,
 * and asserts its ceiling in `journey-budgets.ts` (the ratchet).
 *
 * The characters typed are the same in every project: each mark carries `projectTag`, five characters
 * whatever the project is called, so the count is the secretary's typing and not the fixture's name.
 *
 * Their own fixtures: `zz-sechome-…` addresses, invented names, and the clubs the sign-ups make — found
 * again through the person's membership AND through any tournament that address organizes (CLAUDE.md,
 * "a run killed inside an organizer-from-nothing spec poisons the next one"), deleted in a `finally`.
 * They never touch the shared fixture. Memory: at most two browser contexts at once, one page each.
 *
 * WHAT THEY CANNOT SEE: a secretary who reads slower than this, or stops to set up a logo or a members
 * list of 120 first — the measure is the shortest honest path, and `READ_MS` is the panel's figure for
 * one person reading one screen, not a promise about everybody.
 *
 * J2 AND J3 WERE NOT RUN ON THE DESKTOP WHERE THEY WERE WRITTEN (no browsers there): written against
 * the markup the organizer specs already press (organizer-medal, organizer-teesheet,
 * import-marks-member-or-guest, secretary-copy-last-event) and the console's sidebar; CI runs them.
 */

const LIMIT_MS = 10 * 60_000;

const visible = (l: Locator) => l.locator("visible=true").first();

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

/** The figures printed, and the ceiling held (the ratchet). */
async function reportAndHold(walk: Journey, testInfo: TestInfo) {
  const f = await walk.report(testInfo);
  const over = ceilingBreaches(f);
  expect(over, over.join("\n")).toEqual([]);
  return f;
}

/** Signs up at the front door as a golf club, with the emailed code typed back. Ends on /choose. */
async function signUpAsClub(walk: Journey, page: Page, email: string) {
  await page.goto("/");
  await landingSettled(page);
  walk.note("opens the front door");
  await walk.press(page.getByRole("tab", { name: "Sign up", exact: true }), "the “Sign up” tab");
  await walk.type(visible(page.getByPlaceholder("Full name")), "Rowan Fairlie", "Full name");
  await walk.type(visible(page.locator("#login-email")), email, "Email");
  // A test value for this app only, generated here — see CLAUDE.md on fixtures.
  await walk.type(visible(page.getByPlaceholder("Choose a password")), "Seventh-Tee-Box-Moss-41", "Choose a password");
  await walk.press(visible(page.getByText("A golf club or course")), "“A golf club or course”");
  await walk.press(visible(page.getByRole("button", { name: "Create account" })), "“Create account”");
  // The helper types the code and presses Confirm THROUGH the walk, so it counts what the step takes.
  await verifyByCode(page, email, walk);
  await page.waitForURL(/\/choose/, { timeout: 60_000 });
}

/** The club is asked for its members before its first tournament, and says so: one member, by the form. */
async function addFirstMember(walk: Journey, page: Page, mark: string) {
  await walk.settle();
  await walk.press(visible(page.getByRole("link", { name: /Add your members/ })), "“Add your members”");
  await page.waitForURL(/\/roster/, { timeout: 30_000 });
  await walk.settle();
  await walk.press(page.getByRole("button", { name: "Add member" }).first(), "“Add member”");
  await walk.type(page.getByLabel("Name", { exact: true }), "Isla Penhallow", "Name");
  await walk.type(page.getByLabel(/^Email/).first(), `${mark}-member@example.invalid`, "Email");
  await walk.type(page.getByLabel("Handicap index"), "14.2", "Handicap index");
  await walk.press(page.getByRole("button", { name: "Add member" }).last(), "“Add member”, to save the member");
  await expect(page.locator("main")).toContainText("Isla Penhallow", { timeout: 20_000 });
}

/**
 * Names the club and its first tournament, "a single round". The club's kind is pressed only when the
 * screen has not already chosen it: the person said "A golf club or course" at sign-up, and a choice the
 * screen made is not a press the person made (Fable's fault 3, 14 Nov).
 */
async function createFirstTournament(walk: Journey, page: Page, names: { tournament: string; club: string }) {
  await walk.press(visible(page.getByRole("link", { name: /Create your first tournament/ })), "“Create your first tournament”");
  await page.waitForURL(/\/choose/, { timeout: 30_000 });
  await walk.settle();
  await walk.type(page.getByLabel("Tournament name"), names.tournament, "Tournament name");
  await walk.press(page.getByRole("button", { name: /^A single round/ }), "“A single round”");
  // A club is named once, here, on the way to its first tournament.
  await walk.type(page.getByLabel(/Who.s running this\?/), names.club, "“Who's running this?”");
  const kind = page.getByRole("radiogroup", { name: "What kind of outfit runs it" }).locator("label.seg-opt").filter({ hasText: /club/i }).first();
  await expect(kind).toBeVisible();
  if (await kind.locator("input").isChecked()) {
    walk.note("“club” is already chosen for what kind of outfit runs it (from the sign-up): not pressed");
  } else {
    await walk.press(kind, "“club”, for what kind of outfit runs it");
    await expect(kind.locator("input")).toBeChecked();
  }
  await walk.press(page.getByRole("button", { name: "Create tournament" }), "“Create tournament”");
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}

/** A console screen, opened from the sidebar as a secretary at a desk opens it. */
async function fromTheSidebar(walk: Journey, page: Page, href: string) {
  await walk.settle();
  const link = visible(page.locator(`.app-sidebar a[href="${href}"]`));
  const words = (await link.innerText()).replace(/\s+/g, " ").trim();
  await walk.press(link, `“${words}” in the sidebar`);
  await page.waitForURL((u) => u.pathname === href, { timeout: 30_000 });
  await walk.settle();
}

/** Entries → Open entries, and the sign-up link read off the screen. */
async function publishTheLink(walk: Journey, page: Page): Promise<string> {
  await walk.settle();
  await walk.press(visible(page.locator("main").getByRole("link", { name: "Entries", exact: true })), "“Entries”");
  await page.waitForURL(/\/registration/, { timeout: 30_000 });
  await walk.settle();
  await walk.press(page.getByRole("button", { name: /^Open entries/ }), "“Open entries”");
  await expect(page.getByRole("button", { name: "Close entries" })).toBeVisible({ timeout: 20_000 });
  // The link panel opens itself a moment after the button turns; read it once it is drawn.
  const readLink = () => page.locator("input").evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.includes("/register/")) ?? "");
  await expect.poll(readLink, { timeout: 20_000, message: "no sign-up link is shown" }).toMatch(/\/register\//);
  const link = await readLink();
  walk.note("reads the sign-up link off the screen, to send it to the members");
  return link;
}

test("J1: a new club secretary has a tournament with a working entry link", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(LIMIT_MS + 120_000);
  const mark = `zz-sechome-first-${projectTag(testInfo.project.name)}`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await teardown(mark);

  // The figures, counted as the secretary goes (e2e/journey.ts), with the step list beside them.
  const walk = journey(page, "secretary-first-event");
  const tournament = `${mark} Opening Medal`;
  const email = `${mark}@example.invalid`;
  let link = "";
  let elapsed = 0;
  const visitor = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    walk.start();
    await test.step("signs up, as a golf club", () => signUpAsClub(walk, page, email));
    await test.step("adds the club's first member", () => addFirstMember(walk, page, mark));
    await test.step("names the club and its first tournament", () => createFirstTournament(walk, page, { tournament, club: `${mark} Golf Club` }));
    await test.step("publishes the sign-up link", async () => {
      link = await publishTheLink(walk, page);
    });

    await test.step("the link works: a member opens it and is shown the entry form", async () => {
      const member = await visitor.newPage();
      watchPageErrors(member, errors, "member");
      await member.goto(new URL(link).pathname);
      await expect(member.locator("body")).toContainText(tournament);
      await expect(member.getByRole("button", { name: "Register" })).toBeVisible();
      elapsed = walk.stop();
      walk.note("the link, opened by a member on another phone, shows the entry form with the tournament's name");

      // Beyond the clock: it takes an entry, too.
      await member.getByLabel("Your name").fill("Corin Ashdown-Vale");
      await member.getByLabel("Email").fill(`${mark}-entrant@example.invalid`);
      await member.getByLabel("Handicap index").fill("18.4");
      const mobile = member.getByLabel(/^Mobile/);
      if (await mobile.count()) await mobile.fill("5550142");
      await member.getByRole("button", { name: "Register" }).click();
      // Proved first (2026-11-13), as the entrant would: the emailed code, typed back.
      await verifyByCode(member, `${mark}-entrant@example.invalid`);
      await expect(member.getByRole("heading", { name: "You're in!" })).toBeVisible({ timeout: 20_000 });
    });

    // One machine-readable line — JOURNEY {"name":"secretary-first-event",…} — the step list, and the ceiling.
    const f = await reportAndHold(walk, testInfo);
    const figures = `${f.seconds}s at the panel's pace · ${f.screens} screens over ${f.visits} visits (${f.route.join(" → ")}) · ${f.presses} presses · ${f.boxes} boxes · ${f.chars} characters typed`;
    console.log(`[time-to-first-event] ${testInfo.project.name}: ${figures}`);
    testInfo.annotations.push({ type: "time to first event", description: figures });
    // CONTROL: the clock measured the walk, not nothing — the pace alone is a minute and more.
    expect(elapsed, "the clock stopped before the walk was done").toBeGreaterThan(f.presses * READ_MS);
  } finally {
    await visitor.close();
    await teardown(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/** Eight members, as a club secretary keeps them: a file, chosen once. Invented names. */
const EIGHT = [
  ["Ottilie Brack", "11.4"],
  ["Fenwick Marlow", "6.8"],
  ["Saoirse Dunmore", "19.2"],
  ["Caspian Holt", "3.1"],
  ["Wren Achterberg", "24.6"],
  ["Idris Pennock", "15.0"],
  ["Maren Solvay", "9.7"],
  ["Thaddeus Quill", "27.3"],
] as const;

test("J2: a new club secretary has a first event somebody can PLAY, in under ten minutes", async ({ page, browser, baseURL }, testInfo) => {
  // Set up at a desk: walked at laptop size, from the console's sidebar.
  test.skip(testInfo.project.name !== "desktop", "a first event is set up at a desk: walked at laptop size");
  test.setTimeout(LIMIT_MS + 300_000);
  const mark = `zz-sechome-real-${projectTag(testInfo.project.name)}`;
  const catalogueId = `${mark}-catalogue`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await teardown(mark);
  await prisma.courseCatalog.deleteMany({ where: { id: catalogueId } });
  // The club's course is in the catalogue, found by typing, with a complete card and one tee.
  const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
  const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 505];
  await prisma.courseCatalog.create({
    data: {
      id: catalogueId,
      name: `${mark} Larchmere Links`,
      city: "Quillhaven",
      state: "OH",
      country: "US",
      par: PARS.reduce((a, b) => a + b, 0),
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(YARDS),
      strokeIndex: JSON.stringify([7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14]),
      tees: JSON.stringify([{ name: "White", gender: "any", courseRating: 72, slopeRating: 113, par: 72, yards: YARDS.reduce((a, b) => a + b, 0) }]),
    },
  });
  const csv = [
    "name,email,handicap,handicap id,member or guest",
    ...EIGHT.map(([name, index], i) => `${name},${mark}-m${i}@example.invalid,${index},,`),
  ].join("\n");

  const walk = journey(page, "secretary-playable-event");
  const email = `${mark}@example.invalid`;
  // Two days ahead at the club, as the tee-sheet spec plays it (the club's zone in a walk abroad).
  const day = addDays(dayIn(process.env.E2E_TZ ?? ""), 2);
  let elapsed = 0;
  const memberCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined, serviceWorkers: "block" });
  try {
    walk.start();
    await test.step("signs up, as a golf club", () => signUpAsClub(walk, page, email));
    await test.step("adds the club's first member", () => addFirstMember(walk, page, mark));
    await test.step("names the club and its first tournament", () => createFirstTournament(walk, page, { tournament: `${mark} Opening Medal`, club: `${mark} Golf Club` }));

    await test.step("the day and the course", async () => {
      await fromTheSidebar(walk, page, "/event");
      await walk.pick(page.getByLabel("Tournament dates, first day"), (l) => l.fill(day), "the first day");
      await walk.pick(page.getByLabel("Tournament dates, last day"), (l) => l.fill(day), "the last day");
      const course = page.getByRole("combobox", { name: "Golf course" });
      await walk.type(course, "Larchmere", "Golf course");
      // The catalogue's row, which carries the town — not the "use what you typed" row beside it.
      const option = page.locator('#course-picker-list [role="option"]', { hasText: "Quillhaven" }).first();
      await expect(option, "the course search found nothing").toBeVisible({ timeout: 20_000 });
      await walk.press(option, "the course in the catalogue");
      await walk.press(page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }), "“Save event”");
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
    });

    await test.step("the round: stroke play, on net", async () => {
      await fromTheSidebar(walk, page, "/stages");
      if (await page.getByRole("button", { name: /^Round 1 · / }).count()) {
        walk.note("Round 1 is already there");
      } else {
        await walk.press(page.getByRole("button", { name: /^Stroke play round/ }), "“Stroke play round”");
        const format = page.getByLabel("Format for every round added");
        if ((await format.inputValue()) !== "Stroke Play") {
          await walk.choose(format, "Stroke Play", "the round's format");
        }
        await walk.press(page.getByRole("button", { name: /^Add stroke play round/ }), "“Add stroke play round”");
        await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });
      }
      // A new round starts on net — a club medal is played off handicap. Pressed only if it has not.
      const net = page.locator("label.seg-opt", { hasText: /^\s*Net\s*$/ }).first();
      if (!(await net.locator("input").isChecked())) await walk.press(net, "“Net”");
    });

    await test.step("the field: eight members, from a file", async () => {
      await fromTheSidebar(walk, page, "/registration");
      await expect(page.getByRole("button", { name: "Download template" })).toBeVisible({ timeout: 20_000 });
      await walk.pick(
        page.locator('input[type="file"][accept*="csv"]'),
        (l) => l.setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") }),
        "a file of eight members (CSV)",
      );
      const preview = page.getByTestId("csv-preview");
      await expect(preview.getByText("Check the list")).toBeVisible({ timeout: 20_000 });
      await walk.press(preview.getByRole("button", { name: "Import 8 players" }), "“Import 8 players”");
      await expect(page.getByText(/Imported 8/)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("launch", async () => {
      await fromTheSidebar(walk, page, "/dashboard");
      await walk.press(page.getByRole("button", { name: "Launch tournament" }).first(), "“Launch tournament”");
      await walk.press(page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }), "“Launch tournament”, in the dialog");
      await expectLaunched(page);
    });

    await test.step("the tee sheet, drawn and published", async () => {
      await fromTheSidebar(walk, page, "/foursomes");
      await expect(page.getByRole("heading", { level: 1, name: "Tee sheet" })).toBeVisible();
      const publish = page.getByRole("button", { name: /Save & publish/ });
      await expect(publish, "no draw on the tee sheet to publish").toBeEnabled({ timeout: 20_000 });
      await walk.press(publish, "“Save & publish”");
      await walk.press(page.getByRole("button", { name: "Publish the tee sheet" }).first(), "“Publish the tee sheet”");
      await expect(page.getByText(/Published to players/).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step("a member, on their own phone, sees their tee time on Today", async () => {
      const secretary = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
      const org = await prisma.organizationMember.findFirstOrThrow({ where: { userId: secretary.id }, select: { organizationId: true } });
      const event = await prisma.event.findFirstOrThrow({ where: { organizationId: org.organizationId }, select: { id: true } });
      const [name] = EIGHT[3];
      const entry = await prisma.player.findFirstOrThrow({ where: { eventId: event.id, name }, select: { email: true } });
      // The import gave the entry its tournament account already (Account is unique on event and address):
      // the member only needs a sign-in of their own.
      const user = await prisma.user.upsert({ where: { email: entry.email }, create: { email: entry.email, name, password: "x:unusable" }, update: {} });
      if (!(await prisma.account.findFirst({ where: { eventId: event.id, email: entry.email }, select: { id: true } }))) {
        await prisma.account.create({ data: { eventId: event.id, name, email: entry.email, role: "player" } });
      }
      await signInWith(memberCtx, baseURL!, sessionOf(user.id), event.id);
      const member = await memberCtx.newPage();
      watchPageErrors(member, errors, "member");
      await member.goto(`/me?bust=${Date.now()}`);
      await expect(member.locator("main"), "the member is not given a tee time").toContainText(/Group \d+ · \d/, { timeout: 30_000 });
      elapsed = walk.stop();
      walk.note("a member, signed in on another phone, sees their group and tee time on Today");
    });

    const f = await reportAndHold(walk, testInfo);
    // The promise: a first event somebody can play, at the panel's pace, in under ten minutes.
    expect(elapsed, `a playable first event took ${f.seconds}s at the panel's pace`).toBeLessThan(LIMIT_MS);
    expect(elapsed, "the clock stopped before the walk was done").toBeGreaterThan(f.presses * READ_MS);
  } finally {
    await memberCtx.close();
    await teardown(mark);
    await prisma.courseCatalog.deleteMany({ where: { id: catalogueId } });
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("J3: a returning secretary copies last event to a working entry link", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!["desktop", "phone"].includes(testInfo.project.name), "walked at laptop and phone size, as the copy spec is");
  test.setTimeout(240_000);
  const ZONE = "Europe/London";
  const mark = `zz-sechome-copyj-${projectTag(testInfo.project.name)}`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const club = await makeClub(mark, { timeZone: ZONE });
  const visitor = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    // Last summer's medal, completed: the one tournament there is to copy.
    const medal = await makeEvent(club, "Summer Medal", {
      status: "completed",
      stages: [{ format: "Stroke Play", holes: 18, scoringBasis: "net", playedOn: "2026-06-13" }],
      players: 2,
      event: { startOn: "2026-06-13", endOn: "2026-06-13", dates: "13 Jun 2026" },
    });
    await signIn(context, baseURL!, club, medal.event.id);
    // Five days ahead at the club: the day the copy is played.
    const day = addDays(clubToday(ZONE), 5);

    const walk = journey(page, "secretary-copy-last-event");
    walk.start();
    await page.goto("/dashboard");
    await walk.settle();
    walk.note("opens the console's home, signed in");
    const card = page.getByRole("region", { name: "Copy last event" });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await walk.pick(card.getByLabel("First day"), (l) => l.fill(day), "the copy's first day");
    await walk.press(card.getByRole("button", { name: "Create the copy" }), "“Create the copy”");
    await expect
      .poll(() => prisma.event.count({ where: { organizationId: club.orgId, status: "draft" } }), { timeout: 30_000, message: "the copy was not made" })
      .toBe(1);
    const copy = await prisma.event.findFirstOrThrow({ where: { organizationId: club.orgId, status: "draft" }, select: { id: true, name: true } });
    await walk.settle();
    const link = await publishTheLink(walk, page);
    const token = new URL(link).pathname.split("/").pop();
    expect((await prisma.event.findUniqueOrThrow({ where: { id: copy.id } })).registrationToken, "the link is not the copy's").toBe(token);

    const v = await visitor.newPage();
    watchPageErrors(v, errors, "member");
    await v.goto(new URL(link).pathname);
    await expect(v.locator("body")).toContainText(copy.name);
    await expect(v.getByRole("button", { name: "Register" })).toBeVisible();
    walk.stop();
    walk.note("the copy's link, opened by a member on another phone, shows the entry form");

    const f = await reportAndHold(walk, testInfo);
    expect(f.presses, "the counter missed the copy").toBeGreaterThanOrEqual(2);
  } finally {
    await visitor.close();
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
