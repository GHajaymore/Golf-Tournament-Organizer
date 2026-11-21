import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { CODE_WORDS } from "../src/lib/domain/code-shape";
import { GUEST_WORDS } from "../src/lib/domain/guest-entry";

/**
 * A GUEST ENTERS THEMSELVES ON THE ONE SIGN-UP LINK (J39/J40 PR 3B; Ajay, 7 Nov: no email, no app, always approved).
 *
 * Pressed as the people who would. A GUEST at a club that has not ticked the box meets the member form and ONE line telling
 * them who to ask. The SECRETARY ticks "Let guests enter themselves" on Entries and opens the poster, which now carries the
 * 8-character code. The GUEST scans, presses "Enter as a guest", gives a name, a handicap and who invited them, and is shown
 * the waiting screen with its code. The SECRETARY sees them waiting, types the committee's figure ("Handicap for today") and
 * approves; the guest presses "Check now" and the waiting card turns into their Today. A second guest is declined and is
 * told the link no longer works. A third types the poster's code at /register and arrives at the same page. The secretary
 * presses New link (its confirm says the poster's code stops too) and the old code opens nothing. With entries closed, the
 * LINK names the event and says what to do next, a typed CODE says nothing but the one neutral sentence, and the secretary's
 * What's next reminds them on the morning that guests cannot enter.
 *
 * Actions pressed: setGuestEntry, showRegistrationCode, approveSignup (with the figure), removeSignup, rotatePublicToken
 * (as the secretary); startGuestEntry, registerAsGuest, guestEntryFor (as guests).
 *
 * Fixture facts are read from the fixture: the club, its event and token are the rows this spec makes (net round, so the
 * figure is asked), the code is read back from the database after the poster makes it. Service workers are blocked in
 * every context (a save spec, for WebKit). Memory: three browser contexts, one page each, about 400 MB at most.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in GuestEntryForm.tsx,
 * GuestEntryStaff.tsx, GuestWaitingCard.tsx, SignUpPoster.tsx and RegisterCodeBox.tsx; CI runs it first.
 */

const ZONE = "UTC";
const MARK = "zz-guest-enters";
const TOKEN = "ZZGUESTENTERSLINK24TOKN";
const ALERT = '[role="alert"]:not(#__next-route-announcer__)';

async function newContext(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** "ABCD-EFGH", as the poster prints it. */
const printed = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

test.describe("a guest enters themselves on the sign-up link", () => {
  let club: Club;
  let eventId = "";
  let eventName = "";

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", {
      status: "draft",
      stages: [{ playedOn: dayIn(ZONE, new Date(Date.now() + 30 * 86_400_000)), scoringBasis: "net" }],
      players: 2,
      event: { registrationOpen: true, registrationToken: TOKEN, guestEntryOpen: false, capacity: 64 },
    });
    eventId = made.event.id;
    eventName = made.event.name;
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("off, then on; asked, waiting, approved with a figure; declined; typed; new link; closed", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const errors: string[] = [];

    // 1. A guest at a club that has NOT switched guests on: the member form, and one line saying who to ask.
    const visitor = await newContext(browser, baseURL!, testInfo);
    const visitorPage = await visitor.newPage();
    watchPageErrors(visitorPage, errors, "visitor");
    await open(visitorPage, `/register/${TOKEN}`);
    await expect(visitorPage.getByTestId("not-a-member")).toContainText(/Ask the organi[sz]er: they can add you\./);
    await expect(visitorPage.getByRole("button", { name: /Enter as a guest/ }), "the guest button is drawn with the switch off").toHaveCount(0);
    await visitor.close();

    // 2. The SECRETARY ticks the box and opens the poster: it carries the code and the guests line.
    const desk = await newContext(browser, baseURL!, testInfo);
    await signIn(desk, baseURL!, club, eventId);
    const deskPage = await desk.newPage();
    watchPageErrors(deskPage, errors, "desk");
    await open(deskPage, `/registration?bust=${Date.now()}`);
    const tick = deskPage.getByRole("checkbox", { name: /Let guests enter themselves/ });
    await tick.scrollIntoViewIfNeeded();
    await tick.check();
    await expect(deskPage.getByTestId("guest-switch-hint")).toContainText("No email or phone is asked. You approve each one.");
    await expect.poll(async () => (await prisma.event.findUnique({ where: { id: eventId }, select: { guestEntryOpen: true } }))?.guestEntryOpen).toBe(true);
    await deskPage.getByRole("button", { name: "Show QR code" }).click();
    const poster = deskPage.locator("#signup-poster");
    await expect(poster.getByTestId("poster-code")).toBeVisible({ timeout: 20_000 });
    await expect(poster).toContainText(GUEST_WORDS.posterGuests);
    const code = (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationCode: true } })).registrationCode;
    expect(code).toHaveLength(8);
    await expect(poster.getByTestId("poster-code")).toContainText(printed(code));

    // 3. A GUEST scans: the guest button comes first; they ask to play; the waiting screen names the event and shows their code.
    const guest = await newContext(browser, baseURL!, testInfo);
    const guestPage = await guest.newPage();
    watchPageErrors(guestPage, errors, "guest");
    await open(guestPage, `/register/${TOKEN}`);
    const enter = guestPage.getByRole("button", { name: /Enter as a guest/ });
    await expect(enter).toBeVisible();
    await enter.click();
    await expect(guestPage.getByTestId("guest-entry").getByLabel("Your name")).toBeVisible();
    await expect(guestPage.getByRole("textbox", { name: /email/i }), "a guest is asked for an email").toHaveCount(0);
    await guestPage.getByTestId("guest-entry").getByLabel("Your name").fill("Robin Vale");
    await guestPage.getByTestId("guest-entry").getByLabel("Handicap, if you have one").fill("14.2");
    await guestPage.getByTestId("guest-entry").getByLabel("Who invited you?").fill("Corin");
    await guestPage.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    await expect(guestPage.getByTestId("guest-waiting")).toBeVisible({ timeout: 30_000 });
    await expect(guestPage.getByTestId("guest-waiting")).toContainText(eventName);
    await expect(guestPage.getByTestId("guest-waiting")).toContainText(GUEST_WORDS.waitingLead);
    await expect(guestPage.getByTestId("guest-waiting")).toContainText(GUEST_WORDS.atTheCourse);
    await expect(guestPage.getByTestId("last-checked")).toContainText("Last checked");
    await expect(guestPage.getByTestId("guest-code")).toContainText(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
    const robin = await prisma.player.findFirstOrThrow({ where: { eventId, name: "Robin Vale" } });
    expect(robin, "an entry made through the guest door").toMatchObject({ status: "pending", standing: "guest", email: "", phone: "", teeId: null, memberId: null });
    // The code is the guest's own and is never in the page's server render (C3.3): a reload drops the display, never the entry.
    const html = await (await guestPage.request.get("/me")).text();
    expect(html, "the waiting page carries a player link code").not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);

    // 4. The SECRETARY sees them waiting, with the committee's figure pre-filled, and approves.
    await open(deskPage, `/registration?bust=${Date.now()}`);
    const waiting = deskPage.getByTestId("guests-waiting");
    await expect(waiting).toContainText("Guests asking to play (1)");
    const row = waiting.getByTestId("guest-waiting-row").filter({ hasText: "Robin Vale" });
    await expect(row).toContainText("Invited by Corin");
    await expect(row.getByTestId("figure-hint")).toContainText("They gave 14.2.");
    const figure = row.getByLabel("Handicap for today");
    await expect(figure).toHaveValue("14.2");
    await figure.fill("");
    await expect(row.getByRole("button", { name: "Approve" }), "approval is open with no figure in a net event").toBeDisabled();
    await expect(row.getByTestId("figure-hint")).toBeVisible();
    await figure.fill("16");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(waiting.getByTestId("guest-approved")).toContainText("In the field · no tee time yet");
    await expect
      .poll(async () => (await prisma.player.findUniqueOrThrow({ where: { id: robin.id } })).status, { timeout: 20_000 })
      .toBe("confirmed");
    expect(await prisma.player.findUniqueOrThrow({ where: { id: robin.id } })).toMatchObject({ handicap: 16, handicapSource: "manual" });

    // 5. The guest presses Check now, and the waiting card becomes their Today, in place.
    await guestPage.getByRole("button", { name: GUEST_WORDS.checkNow }).click();
    await expect(guestPage.getByTestId("guest-waiting")).toHaveCount(0, { timeout: 40_000 });
    await guest.close();

    // 6. A second guest is declined, and is told so on their phone.
    const second = await newContext(browser, baseURL!, testInfo);
    const secondPage = await second.newPage();
    watchPageErrors(secondPage, errors, "second guest");
    await open(secondPage, `/register/${TOKEN}`);
    await secondPage.getByRole("button", { name: /Enter as a guest/ }).click();
    await secondPage.getByTestId("guest-entry").getByLabel("Your name").fill("Tamsin Holloway");
    await secondPage.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    await expect(secondPage.getByTestId("guest-waiting")).toBeVisible({ timeout: 30_000 });
    await open(deskPage, `/registration?bust=${Date.now()}`);
    const tamsin = deskPage.getByTestId("guests-waiting").getByTestId("guest-waiting-row").filter({ hasText: "Tamsin Holloway" });
    await expect(tamsin.getByTestId("figure-hint")).toContainText(GUEST_WORDS.noFigure);
    deskPage.once("dialog", (d) => void d.accept());
    await tamsin.getByRole("button", { name: "Decline" }).click();
    await expect.poll(async () => prisma.player.count({ where: { eventId, name: "Tamsin Holloway" } }), { timeout: 20_000 }).toBe(0);
    await secondPage.getByRole("button", { name: GUEST_WORDS.checkNow }).click();
    await expect(secondPage.getByText("This link no longer works.")).toBeVisible({ timeout: 40_000 });
    await second.close();

    // 7. A guest types the poster's code at /register and arrives at the same page; a wrong code is the one neutral sentence.
    const typist = await newContext(browser, baseURL!, testInfo);
    const typistPage = await typist.newPage();
    watchPageErrors(typistPage, errors, "typist");
    await open(typistPage, "/register");
    const box = typistPage.getByLabel("Code from the poster");
    await expect(box, "the code box is focused when the page opens").toBeFocused();
    await box.fill("ZZZZ-ZZZZ");
    await typistPage.getByRole("button", { name: "Open", exact: true }).click();
    await expect(typistPage.locator(ALERT).filter({ hasText: CODE_WORDS.opensNothing })).toBeVisible({ timeout: 20_000 });
    await box.fill(printed(code));
    await typistPage.getByRole("button", { name: "Open", exact: true }).click();
    await expect(typistPage).toHaveURL(new RegExp(`/register/${TOKEN}$`), { timeout: 30_000 });
    await expect(typistPage.getByRole("button", { name: /Enter as a guest/ })).toBeVisible();

    // 8. NEW LINK: its confirm says the poster's code stops too; afterwards the old code opens nothing and the link is new.
    await open(deskPage, `/registration?bust=${Date.now()}`);
    let confirmed = "";
    deskPage.once("dialog", (d) => {
      confirmed = d.message();
      void d.accept();
    });
    await deskPage.getByRole("button", { name: "New link" }).click();
    await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationToken: true } })).registrationToken, { timeout: 20_000 }).not.toBe(TOKEN);
    expect(confirmed).toContain(GUEST_WORDS.newLinkConfirm);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationToken: true, registrationCode: true } });
    expect(after.registrationCode).not.toBe(code);
    await open(typistPage, "/register");
    await typistPage.getByLabel("Code from the poster").fill(printed(code));
    await typistPage.getByRole("button", { name: "Open", exact: true }).click();
    await expect(typistPage.locator(ALERT).filter({ hasText: CODE_WORDS.opensNothing })).toBeVisible({ timeout: 20_000 });
    // The old link is today's neutral page, and names nobody.
    await open(typistPage, `/register/${TOKEN}`);
    await expect(typistPage.getByRole("heading", { name: "This registration link isn’t open" })).toBeVisible();
    await expect(typistPage.getByText(eventName)).toHaveCount(0);

    // 9. ENTRIES CLOSED by the organizer: the LINK names the event and says what to do; the typed CODE says only the neutral sentence.
    await prisma.event.update({ where: { id: eventId }, data: { registrationOverride: true } });
    await open(typistPage, `/register/${after.registrationToken}`);
    await expect(typistPage.getByTestId("entries-closed")).toContainText(`Entries for ${eventName} are closed.`);
    await expect(typistPage.getByTestId("entries-closed")).toContainText("they can add you");
    await expect(typistPage.getByRole("button", { name: /Enter as a guest/ })).toHaveCount(0);
    await open(typistPage, "/register");
    await typistPage.getByLabel("Code from the poster").fill(printed(after.registrationCode));
    await typistPage.getByRole("button", { name: "Open", exact: true }).click();
    await expect(typistPage.locator(ALERT).filter({ hasText: CODE_WORDS.opensNothing })).toBeVisible({ timeout: 20_000 });
    await expect(typistPage.getByText(eventName)).toHaveCount(0);
    await typist.close();

    // 10. THE MORNING: guests on, entries closed, and today is a day of play: What's next reminds the secretary.
    const today = dayIn(ZONE);
    await prisma.event.update({ where: { id: eventId }, data: { startOn: today, endOn: today } });
    await open(deskPage, "/dashboard");
    const next = deskPage.getByRole("region", { name: "What's next" });
    const reminder = next.locator('[data-job="guests-today"]').filter({ hasText: eventName });
    await expect(reminder).toContainText("Guests arriving today?");
    await reminder.getByRole("button", { name: /Reopen entries/ }).click();
    await expect(deskPage).toHaveURL(/\/registration/, { timeout: 30_000 });
    await desk.close();

    expect(errors, "page errors while walking the guest door").toEqual([]);
  });
});
