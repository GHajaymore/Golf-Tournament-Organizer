import { test, expect, type Locator, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { openSettingsTab } from "./settings-tabs";

/**
 * A BUTTON THAT ASKS AN OUTSIDE SERVICE SAYS, IN WORDS, WHEN THE SERVICE IS NOT THERE.
 *
 * The test server has no payment account that can charge, no model key and no course
 * directory it can trust (`playwright.config.ts`: a Stripe key that charges nothing,
 * `ANTHROPIC_API_KEY` empty). So every press below goes to the server, through the screen
 * the person would press it on, and comes back with the refusal a person is meant to read.
 * That is what is held here: the press happens, and the words land beside it.
 *
 *   Club settings > Plan        a code nobody issued, then a plan button  → "That isn't a discount code we know" at the code box (startCheckout)
 *   Club settings > Plan        a club that pays, Manage billing          → "no billing account for this club yet" (openBillingPortal)
 *   Messages > Announcements    Write a draft                             → "Drafting isn't switched on" (draftMessage)
 *   Leaderboard > Commentary    AjAi draft                                → nothing is posted (suggestCommentary)
 *   Rounds & formats            Work out the rounds                       → "isn't switched on" (suggestSetup)
 *   Score entry                 Read from a photo (one player)            → "not switched on. Enter the scores by hand" (readScorecardPhoto)
 *   Score entry                 Read the whole card (a group)             → the same words (readGroupCardPhoto)
 *   Event > Courses             Paste a card > Photograph the card        → "not switched on. Type the card in below" (readCourseCardPhoto)
 *   Event > Courses             Check source on a directory course        → "The course directory didn't answer" (checkCourseAgainstSource)
 *
 * THE PLAN GATE IS OPENED, NOT SKIPPED. Drafting and card reading are off on every plan, so the
 * buttons are greyed or hidden for a club with no exception, and a spec could never press them.
 * The club here has a per-club exception (`Subscription.featureOverrides`, the owner's own
 * lever) for both, so the person sees the real buttons; the server then answers for the missing
 * key. A club WITHOUT the exception is held by `locked-sides-refuse-in-words` and the plan tests.
 *
 * WHAT IT CANNOT SEE, and why nothing here claims it: a draft, a proposal or a card actually
 * read — they need the model's answer, and `applySetupProposal` is only reachable from a
 * proposal; `applySourceCard` only from a difference the live directory reports. Neither has a
 * test seam, so neither is pressed (`docs/testing.md`, "Reach"). Stripe's own page is never opened.
 *
 * One club per size, marked zz-, removed in a finally. Walked at laptop and phone size.
 */

const WALKED = ["desktop", "phone"];
/** A 1x1 PNG: a real image the page can decode and shrink, so the press reaches the server. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 20_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

const markFor = (what: string, project: string) => `zz-svc-${what}-${project}`;

/** Press a control and wait for the server action it sends to come back: the refusal is read after the answer, not before. */
async function pressAndWait(page: Page, press: () => Promise<void>) {
  const answered = page.waitForResponse((r) => r.request().method() === "POST" && "next-action" in r.request().headers(), { timeout: 60_000 });
  await press();
  await answered;
}

test("the plan panel: a refused code stops a plan button, and Manage billing says there is no billing account", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "commissioner");
  const mark = markFor("plan", testInfo.project.name);
  const club = await makeClub(mark, { plan: "free", planTermsApply: true });
  try {
    await context.addCookies([{ name: "ng_session", value: club.session, url: baseURL! }]);
    const open = async () => {
      await page.goto(`/organization?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await openSettingsTab(page, "Plan");
    };

    await test.step("a code nobody issued, then a plan button: refused at the code box, and the page stays where it was", async () => {
      await open();
      const box = page.getByLabel(/^Discount code/);
      await expect(box, "the plan panel draws no discount box for the Commissioner").toBeVisible({ timeout: 20_000 });
      await box.fill("ZZNOSUCHCODE");
      const buy = page.getByRole("button", { name: /\/(yr|mo)$/ }).first();
      await centre(buy);
      await pressAndWait(page, () => buy.click());
      const note = page.locator("#plan-discount-note");
      await expect(note, "the refused code is not said at the code box").toHaveText(/That isn.t a discount code we know/, { timeout: 20_000 });
      await expect(note, "the refusal is not where the press was").toBeInViewport();
      expect(new URL(page.url()).pathname, "a refused code still sent the person to a payment page").toBe("/organization");
    });

    await test.step("a club that already pays presses Manage billing: told there is no billing account yet, nothing opened", async () => {
      // A subscription Stripe has not told us a customer for: the shape a half-finished checkout leaves.
      await prisma.subscription.update({ where: { organizationId: club.orgId }, data: { providerSubscriptionId: `zz-sub-${mark}`, status: "active", providerCustomerId: null } });
      await open();
      const manage = page.getByRole("button", { name: "Manage billing" });
      await expect(manage, "a club with a subscription is not offered Manage billing").toBeVisible({ timeout: 20_000 });
      await centre(manage);
      await pressAndWait(page, () => manage.click());
      await expect(page.getByText("There's no billing account for this club yet."), "Manage billing did not say why it opened nothing").toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname, "Manage billing left the page with nowhere to go").toBe("/organization");
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/** The club that has the two metered features by exception: the buttons are real, the server has no key. */
async function clubWithServices(mark: string): Promise<Club> {
  const club = await makeClub(mark, { plan: "free", planTermsApply: true });
  await prisma.subscription.update({ where: { organizationId: club.orgId }, data: { featureOverrides: JSON.stringify({ aiAssist: true, cardScan: true }) } });
  return club;
}

test("the AI helpers, pressed by an organizer whose club has them: each says in words that it is not switched on", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("ai", testInfo.project.name);
  const club = await clubWithServices(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Spring Medal", { status: "live", stages: [{}], players: 2 });
    // A published-looking draw of the two, so the entry screen can offer the whole card as one group.
    await prisma.stage.update({
      where: { id: stages[0].id },
      data: { teeSheet: JSON.stringify({ savedAt: "", startType: "tee", groups: [{ name: "Group 1", startHole: 1, time: "09:00", playerIds: players.map((p) => p.id) }] }) },
    });
    await signIn(context, baseURL!, club, event.id);
    const open = async (path: string) => {
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.locator("main h1").first()).toBeVisible();
    };
    /** The red line a panel draws for a refusal, found by what it says and never by the page's alerts. */
    const said = (scope: Page | Locator, words: RegExp) => scope.locator(".form-error").filter({ hasText: words }).first();

    await test.step("Announcements, Write a draft: 'Drafting isn't switched on', beside the button", async () => {
      await open("/announcements");
      const kind = page.getByLabel("What would you like drafted?");
      await expect(kind, "the club has the exception and the draft panel is still locked").toBeVisible();
      // A reminder needs only a round, so the answer is the service's and not 'no results yet'.
      await kind.selectOption({ label: "Reminder about the next round" });
      const write = page.getByRole("button", { name: "Write a draft" });
      await centre(write);
      await pressAndWait(page, () => write.click());
      const line = said(page, /Drafting isn.t switched on/);
      await expect(line, "Write a draft did not say it is not switched on").toBeVisible({ timeout: 20_000 });
      await expect(line, "the refusal is not where the press was").toBeInViewport();
      expect(await prisma.announcement.count({ where: { eventId: event.id } }), "a refused draft posted something").toBe(0);
    });

    await test.step("Leaderboard commentary, AjAi draft: pressed, and nothing is posted for the field to read", async () => {
      await open("/leaderboard");
      const draft = page.getByRole("button", { name: /AjAi draft/ });
      await expect(draft, "the club has the exception and the AjAi draft button is still greyed").toBeEnabled({ timeout: 20_000 });
      await centre(draft);
      await pressAndWait(page, () => draft.click());
      await expect(draft, "the AjAi draft button never came back").toHaveText(/AjAi draft/, { timeout: 20_000 });
      // A draft is a line in a box for the organizer to read; only Post puts it in front of the field.
      expect(await prisma.commentary.count({ where: { eventId: event.id } }), "pressing AjAi draft posted a line").toBe(0);
    });

    await test.step("Score entry, one player's card, Read from a photo: told to enter the scores by hand", async () => {
      await open("/entry");
      const read = page.getByRole("button", { name: "Read from a photo" });
      await expect(read, "score entry offers no way to read a card from a photo").toBeVisible({ timeout: 20_000 });
      await centre(read);
      await pressAndWait(page, () => read.locator("xpath=ancestor::div[1]").locator('input[type="file"]').setInputFiles({ name: "card.png", mimeType: "image/png", buffer: PNG }));
      const line = said(page, /not switched on\. Enter the scores by hand/);
      await expect(line, "reading one player's card did not say it is not switched on").toBeVisible({ timeout: 30_000 });
      await expect(line, "the refusal is not where the press was").toBeInViewport();
    });

    await test.step("Score entry, the group's card, Read the whole card: the same words", async () => {
      await page.getByRole("button", { name: "Hole by hole" }).click();
      await page.getByLabel("Scoring").selectOption({ index: 1 });
      const read = page.getByRole("button", { name: "Read the whole card" });
      await expect(read, "choosing the group did not offer the whole card").toBeVisible();
      await centre(read);
      await pressAndWait(page, () => read.locator("xpath=ancestor::div[1]").locator('input[type="file"]').setInputFiles({ name: "card.png", mimeType: "image/png", buffer: PNG }));
      await expect(said(page, /not switched on\. Enter the scores by hand/), "reading the group's card did not say it is not switched on").toBeVisible({ timeout: 30_000 });
      expect(await prisma.scorecard.count({ where: { eventId: event.id } }), "a refused photo filled in a card").toBe(0);
    });

    await test.step("Courses, Paste a card, Photograph the card: told to type the card in below", async () => {
      await open("/event");
      await page.getByRole("button", { name: "Paste a card" }).click();
      const card = page.locator(".card", { has: page.getByText("Paste a course card", { exact: true }) }).last();
      const photograph = card.getByRole("button", { name: "Photograph the card" });
      await expect(photograph, "the paste-a-card form offers no photograph").toBeEnabled();
      await centre(photograph);
      await pressAndWait(page, () => card.locator('input[type="file"]').setInputFiles({ name: "card.png", mimeType: "image/png", buffer: PNG }));
      await expect(said(card, /not switched on\. Type the card in below/), "photographing a course card did not say it is not switched on").toBeVisible({ timeout: 30_000 });
    });

    // A tournament still being set up: once it is live its rounds are locked and the panel is not drawn.
    const setup = await makeEvent(club, "Setup Medal", { status: "registration", stages: [{}], players: 2 });
    await test.step("Rounds & formats, Work out the rounds: not switched on, and no round is added", async () => {
      await signIn(context, baseURL!, club, setup.event.id);
      await open("/stages");
      const describe = page.getByPlaceholder(/Two-round member-guest/);
      await expect(describe, "the club has the exception and Rounds & formats offers no way to describe the tournament").toBeVisible({ timeout: 20_000 });
      await describe.fill("A two-round member-guest, 24 pairs, four-ball off 90 percent");
      const work = page.getByRole("button", { name: "Work out the rounds" });
      await centre(work);
      await pressAndWait(page, () => work.click());
      await expect(said(page, /isn.t switched on/), "Work out the rounds did not say it is not switched on").toBeVisible({ timeout: 20_000 });
      expect(await prisma.stage.count({ where: { eventId: setup.event.id } }), "a refused description added a round").toBe(1);
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Check source on a course taken from the directory: told the directory did not answer, the card untouched", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("source", testInfo.project.name);
  const club = await makeClub(mark, { plan: "free", planTermsApply: true });
  try {
    const pars = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
    const course = await prisma.course.create({
      data: {
        organizationId: club.orgId,
        name: `${mark} Directory Heath`,
        city: "Invented Bay",
        pars: JSON.stringify(pars),
        yards: JSON.stringify(pars.map((p) => p * 95)),
        strokeIndex: JSON.stringify([7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14]),
        source: "directory",
        // An id the directory has never held: whether the directory is down or says "no such course", the answer is the same.
        sourceUrl: `https://api.opengolfapi.org/api/v1/courses/${encodeURIComponent(`zz-no-such-${mark}`)}`,
      },
    });
    const { event } = await makeEvent(club, "Spring Medal", { stages: [{}] });
    await signIn(context, baseURL!, club, event.id);
    await page.goto(`/event?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const check = page.getByRole("button", { name: "Check source" });
    await expect(check, "a course taken from the directory is not offered Check source").toBeVisible({ timeout: 20_000 });
    await centre(check);
    await pressAndWait(page, () => check.click());
    await expect(page.getByText("The course directory didn't answer. Try again in a moment."), "Check source did not say the directory did not answer").toBeVisible({ timeout: 45_000 });
    const after = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(after.pars, "checking a course against its source changed its card").toBe(course.pars);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
