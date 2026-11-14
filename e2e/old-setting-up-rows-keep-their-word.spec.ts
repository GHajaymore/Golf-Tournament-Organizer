import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, sessionOf, addDays, dayIn, centre } from "./rounds-fixture";
import { expectScopeLock, LOCKED_LIVE } from "./expect-tournament-locks";

/**
 * OLD SETTING-UP ROWS KEEP THEIR WORD, AS A MEMBER AND THE SECRETARY MEET THEM (state machine
 * PR 8, J14; the QA Director's test plan for it, S5, S6, S7 and S10).
 *
 * Migration A045 moved every tournament stored in the old ladder's `registration` or `ready` to
 * `draft` and kept the old word in `legacyStatus`. The rows here are made AS A045 LEAVES THEM:
 * `draft` with the word kept, beside a plain `draft` with none.
 *
 *   S5  a member opens their club's list   → the moved row is there (it was open to members
 *                                             before A045); the plain draft, with no sign-up
 *                                             link, is not — as before
 *   S6  both shut to players (`accessGated`) → the member is let into the moved one and meets
 *                                             "… hasn't opened yet" on the plain one; a visitor
 *                                             who is not signed in reaches neither, as before
 *   S7  the secretary launches a former     → "Setting up" and nothing locked before; refused in
 *       `ready` row                            words while nobody is entered; launched by the same
 *                                             press once they are: live, "Live", rounds locked
 *   S10 copy last event, from the moved row → the copy is `draft` with NO old word and no link,
 *                                             and so is not on the member's list
 *
 * Its own club per screen size (`zz-oldword-…`, invented names, `@example.invalid`), dropped in a
 * `finally`; it never touches the shared fixture. Dates are the club's own days ahead.
 *
 * WHAT IT CANNOT SEE: the migration itself, run on a table holding the old words, a stray word and a
 * name clash (`a-legacy-row-keeps-its-word.audit.test.ts`); a name held in play by a moved row (S9,
 * `one-setting-up-step.audit.test.ts`); the public sign-up link on a moved row (S11, unchanged code).
 */

const WALKED = ["desktop", "phone"];
const ZONE = "Europe/London";

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** The cards on a member's list of what their club is running, by name. */
const onList = (page: Page, name: string) => page.locator("article", { hasText: name });

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 20_000 });

test("a row A045 moved keeps what members saw, launches like any other, and is never copied with its old word", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  const mark = `zz-oldword-${testInfo.project.name}`;
  const club = await makeClub(mark, { timeZone: ZONE });
  const today = dayIn(ZONE);
  const day = addDays(today, 10);
  // Service workers blocked: a cached shell would answer for the server this spec is asking.
  const contextFor = () => browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
  const memberCtx = await contextFor();
  const secretaryCtx = await contextFor();
  const visitorCtx = await contextFor();
  try {
    // ── the club's rows, as A045 leaves them ────────────────────────────────
    const dated = { startOn: day, dates: "In ten days" };
    const moved = await makeEvent(club, "Spring Foursomes", {
      status: "draft",
      stages: [{ playedOn: day }],
      players: 2,
      event: { ...dated, legacyStatus: "registration", registrationOpen: false, accessGated: true },
    });
    const plain = await makeEvent(club, "Autumn Greensomes", {
      status: "draft",
      stages: [{ playedOn: day }],
      players: 2,
      event: { ...dated, registrationOpen: false, accessGated: true },
    });
    const wasReady = await makeEvent(club, "Captain's Medal", {
      status: "draft",
      stages: [{ playedOn: day }],
      players: 0,
      event: { ...dated, legacyStatus: "ready" },
    });
    // Read back, never assumed: the three rows are what this walk is about.
    const rows = await prisma.event.findMany({
      where: { id: { in: [moved.event.id, plain.event.id, wasReady.event.id] } },
      select: { id: true, status: true, legacyStatus: true, registrationOpen: true, accessGated: true },
    });
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row(moved.event.id)).toMatchObject({ status: "draft", legacyStatus: "registration", registrationOpen: false, accessGated: true });
    expect(row(plain.event.id)).toMatchObject({ status: "draft", legacyStatus: "", registrationOpen: false, accessGated: true });
    expect(row(wasReady.event.id)).toMatchObject({ status: "draft", legacyStatus: "ready" });

    // A member of the club: belonging is what puts its tournaments on their list.
    const member = await prisma.user.create({ data: { email: `${mark}-member@example.invalid`, name: "Briony Halsall", password: "x:unusable" } });
    await prisma.organizationMember.create({ data: { organizationId: club.orgId, userId: member.id, role: "member" } });
    const memberSession = sessionOf(member.id);

    const m = await memberCtx.newPage();
    watchPageErrors(m, errors, "member");

    await test.step("S5: the moved row is on the member's list; the plain draft is not", async () => {
      await signInWith(memberCtx, baseURL!, memberSession, moved.event.id);
      await open(m, "/me/events");
      await expect(onList(m, moved.event.name).first(), "a row A045 moved dropped off the member's list").toBeVisible({ timeout: 30_000 });
      await expect(onList(m, plain.event.name), "a draft with no sign-up link and no old word is on the member's list").toHaveCount(0);
      // The former `ready` row was open to members too.
      await expect(onList(m, wasReady.event.name).first(), "a former ready row dropped off the member's list").toBeVisible();
    });

    await test.step("S6: shut to players, the moved row still lets the member in; the plain draft does not", async () => {
      await signInWith(memberCtx, baseURL!, memberSession, moved.event.id);
      await open(m, "/me");
      await expect(m.locator("main h1").first(), "the player app did not draw").toBeVisible({ timeout: 30_000 });
      await expect(m.getByRole("heading", { name: /hasn.t opened yet/ }), "a row A045 moved is shut to a member it was open to").toHaveCount(0);

      // CONTROL: the plain draft, shut the same way, is shut.
      await signInWith(memberCtx, baseURL!, memberSession, plain.event.id);
      await open(m, "/me");
      await expect(m.getByRole("heading", { name: `${plain.event.name} hasn’t opened yet` }), "a plain draft shut to players let the member in").toBeVisible({ timeout: 30_000 });

      // A visitor who is not signed in reaches neither, as before.
      const v = await visitorCtx.newPage();
      watchPageErrors(v, errors, "visitor");
      await open(v, "/me");
      await expect(v.locator("body")).not.toContainText(moved.event.name);
      await expect(v.locator("body")).not.toContainText(plain.event.name);
    });

    const s = await secretaryCtx.newPage();
    watchPageErrors(s, errors, "secretary");
    const bar = s.locator(".event-context-bar .tag").first();
    const statusOf = async (id: string) => (await prisma.event.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

    await test.step("S7: a former ready row is setting up, refused in words while empty, and launches like any other", async () => {
      await signIn(secretaryCtx, baseURL!, club, wasReady.event.id);
      // Nothing is locked while it is setting up.
      await expectScopeLock(s, "/stages", null);
      await open(s, "/dashboard");
      await expect(bar, "a former ready row does not read as setting up").toHaveText("Setting up", { timeout: 30_000 });
      const status = s.locator(".card").filter({ has: s.locator(".card-kicker", { hasText: "Tournament status" }) });
      const launch = status.getByRole("button", { name: "Launch tournament" });
      await expect(launch, "a former ready row offers no Launch: it reads as launched").toBeVisible();
      // Nobody entered: refused in place, in words, and nothing changes.
      await expect(launch).toHaveAttribute("aria-disabled", "true");
      const reason = s.locator(`#${await launch.getAttribute("aria-describedby")}`);
      await expect(reason).toContainText("Nobody is entered yet, so there is nobody to launch it for. Add players on Entries, then launch.");
      expect(await statusOf(wasReady.event.id), "a refused launch changed the tournament").toBe("draft");

      // Entered: the same button launches it.
      for (const [i, name] of ["Ottilie Breck", "Caspian Rowe"].entries()) {
        await prisma.player.create({ data: { eventId: wasReady.event.id, name, email: `${mark}-ready-${i}@example.invalid`, handicap: 12, seed: i + 1, status: "confirmed" } });
      }
      await open(s, "/dashboard");
      await expect(launch).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
      await centre(launch);
      await launch.click();
      const dialog = s.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByRole("button", { name: "Launch tournament" }).click();
      await expect.poll(() => statusOf(wasReady.event.id), { timeout: 20_000, message: "the press did not launch the former ready row" }).toBe("live");

      await open(s, "/dashboard");
      await expect(bar, "a launched former ready row does not read as live").toHaveText("Live", { timeout: 30_000 });
      await expect(status.getByRole("button", { name: "Launch tournament" }), "Launch is still offered on a live tournament").toHaveCount(0);
      await expectScopeLock(s, "/stages", { scope: "Rounds", because: LOCKED_LIVE, wayOut: "correction" });
    });

    await test.step("S10: a copy of the moved row starts with no old word, so members do not see it", async () => {
      await signIn(secretaryCtx, baseURL!, club, moved.event.id);
      await open(s, "/dashboard");
      const card = s.getByRole("region", { name: "Copy last event" });
      await expect(card, "the secretary is offered no copy").toBeVisible({ timeout: 30_000 });
      await card.getByLabel("Copy from").selectOption({ label: moved.event.name });
      const copyName = `${mark} Midsummer Texas Scramble`;
      await card.getByLabel("Name of the copy").fill(copyName);
      await card.getByLabel("First day").fill(addDays(today, 30));
      const create = card.getByRole("button", { name: "Create the copy" });
      await centre(create);
      await create.click();
      await expect(s.getByText(copyName).first(), "the secretary was not taken into the copy").toBeVisible({ timeout: 30_000 });
      await expect(card.getByRole("alert"), "the copy was refused").toHaveCount(0);

      const copy = await prisma.event.findFirstOrThrow({
        where: { organizationId: club.orgId, name: copyName },
        select: { status: true, legacyStatus: true, registrationOpen: true, registrationToken: true },
      });
      expect(copy, "the copy carried the source's old word, or its sign-up link").toEqual({ status: "draft", legacyStatus: "", registrationOpen: false, registrationToken: "" });

      // As the member: the copy is not on the list; the moved row it was copied from still is (the control).
      await signInWith(memberCtx, baseURL!, memberSession, moved.event.id);
      await open(m, "/me/events");
      await expect(onList(m, moved.event.name).first()).toBeVisible({ timeout: 30_000 });
      await expect(onList(m, copyName), "a copy with no sign-up link is on the member's list: it carried the old word").toHaveCount(0);
    });

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([memberCtx, secretaryCtx, visitorCtx].map((c) => c.close().catch(() => {})));
    await dropClub(mark);
  }
});
