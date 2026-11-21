import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, dayIn, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { GUEST_WORDS } from "../src/lib/domain/guest-entry";

/**
 * THE SECRETARY APPROVES AND DECLINES A GUEST WHO ENTERED THEMSELVES (J39/J40 PR 3B, test plan E8): the rows the first
 * spec (`guest-enters-on-the-link.spec.ts`) does not press.
 *
 * Three people, pressed as they would: a GUEST asks to play on the sign-up link (their own phone, a fresh browser, no email);
 * the SECRETARY reads the waiting row at the desk and presses.
 *
 *   1. A NAME CLASH. A guest types the name of somebody already in the field (in lower case: the check is not about
 *      capitals). The row says "Same name as ‹name›, already in the field." and the two buttons are NOT the plain pair:
 *      "Approve: a different person" and "Decline: already entered". Approving makes a second entry beside the first and
 *      leaves the first untouched (a wrong press here merges two people or loses one). A second guest with a clashing name
 *      is declined through "Decline: already entered": the confirm names them, the entry goes, the member in the field stays.
 *   2. THE EVENT'S APPROVAL MODE IS `auto` (the design's A5: a guest entry is never confirmed without a staff press, even
 *      then). The guest is still waiting after the whole field has room and after they press Check now; the database says so.
 *   3. A GROSS-ONLY EVENT. Every round is gross, so the committee's figure is not asked: no "Handicap for today" box, the
 *      row says why, Approve is open, and approving with no figure stores none (never a "0", never a made-up scratch).
 *
 * Fixtures: club `zz-guest-entry-approval`, invented names, no address typed anywhere, `dropClub` in a `finally`. Rounds are
 * dated 30 days ahead. Service workers are blocked in every context (WebKit). The golf is not arithmetic here; the figure the
 * committee types (12) is read back as the stored figure, which is the Rules' "the committee gives the handicap".
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in GuestEntryForm.tsx and
 * GuestEntryStaff.tsx; CI runs it first.
 */

const ZONE = "UTC";
const MARK = "zz-guest-entry-approval";
const TOKEN_NET = "ZZGUESTENTRYAPPROVALTKN";
const TOKEN_GROSS = "ZZGUESTENTRYGROSSTOKEN2";

async function newContext(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("the secretary approves and declines guests who entered themselves", () => {
  let club: Club;
  let netEventId = "";
  let grossEventId = "";
  let netPlayers: { id: string; name: string }[] = [];
  const open_: BrowserContext[] = [];
  const errors: string[] = [];

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const playedOn = dayIn(ZONE, new Date(Date.now() + 30 * 86_400_000));
    // Net event: the committee's figure is asked. APPROVAL MODE `auto`, said out loud: it is the mode the design names.
    const net = await makeEvent(club, "Net Outing", {
      status: "draft",
      stages: [{ playedOn, scoringBasis: "net" }],
      players: 5,
      event: { registrationOpen: true, registrationToken: TOKEN_NET, registrationApproval: "auto", guestEntryOpen: true, capacity: 64 },
    });
    netEventId = net.event.id;
    netPlayers = net.players.map((p) => ({ id: p.id, name: p.name }));
    // Gross-only event: every round is gross, so no figure is asked.
    const gross = await makeEvent(club, "Gross Outing", {
      status: "draft",
      stages: [{ playedOn, scoringBasis: "gross" }],
      players: 2,
      event: { registrationOpen: true, registrationToken: TOKEN_GROSS, registrationApproval: "approve", guestEntryOpen: true, capacity: 64 },
    });
    grossEventId = gross.event.id;
  });
  test.afterEach(async () => {
    while (open_.length) await open_.pop()!.close().catch(() => {});
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  /** A guest on their own phone: scans the link, presses Enter as a guest, types, presses Ask to play, is shown the waiting screen. */
  async function guestAsks(browser: Browser, baseURL: string, testInfo: TestInfo, token: string, who: { name: string; figure?: string; by?: string }) {
    const context = await newContext(browser, baseURL, testInfo);
    open_.push(context);
    const page = await context.newPage();
    watchPageErrors(page, errors, `guest ${who.name}`);
    await open(page, `/register/${token}`);
    const form = page.getByTestId("guest-entry");
    const name = form.getByLabel("Your name");
    // A press made before the page woke is not taken up; press until the form is drawn.
    await expect(async () => {
      await page.getByRole("button", { name: /Enter as a guest/ }).click({ timeout: 3_000 });
      await expect(name).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await name.fill(who.name);
    if (who.figure) await form.getByLabel("Handicap, if you have one").fill(who.figure);
    if (who.by) await form.getByLabel("Who invited you?").fill(who.by);
    await form.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    await expect(page.getByTestId("guest-waiting")).toBeVisible({ timeout: 30_000 });
    return { context, page };
  }

  async function secretaryAt(browser: Browser, baseURL: string, testInfo: TestInfo, eventId: string) {
    const desk = await newContext(browser, baseURL, testInfo);
    open_.push(desk);
    await signIn(desk, baseURL, club, eventId);
    const page = await desk.newPage();
    watchPageErrors(page, errors, "desk");
    await open(page, `/registration?bust=${Date.now()}`);
    return page;
  }

  test("a guest with the name of somebody in the field: approve as a different person, and decline as already entered; in auto mode they wait", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const sameAsApproved = netPlayers[3]; // "Bea Lindqvist"
    const sameAsDeclined = netPlayers[4]; // "Oswin Pargeter"
    expect(sameAsApproved.name, "the fixture's fourth name").toBe(NAMES[3]);
    expect(sameAsDeclined.name, "the fixture's fifth name").toBe(NAMES[4]);
    const originalBefore = await prisma.player.findUniqueOrThrow({ where: { id: sameAsApproved.id } });
    const declinedOriginalBefore = await prisma.player.findUniqueOrThrow({ where: { id: sameAsDeclined.id } });

    // 1. Two guests ask. The first types the member's name in lower case, the second in full.
    const lower = NAMES[3].toLowerCase();
    const guestA = await guestAsks(browser, baseURL!, testInfo, TOKEN_NET, { name: lower, figure: "11", by: "Corin" });
    const guestB = await guestAsks(browser, baseURL!, testInfo, TOKEN_NET, { name: sameAsDeclined.name, by: "Corin" });

    // 2. AUTO MODE: the event has room and approves its own members, and the guest still waits (design A5).
    const event = await prisma.event.findUniqueOrThrow({ where: { id: netEventId }, select: { registrationApproval: true } });
    expect(event.registrationApproval, "the fixture is in auto mode").toBe("auto");
    const askedA = await prisma.player.findFirstOrThrow({ where: { eventId: netEventId, name: lower } });
    expect(askedA, "a guest entry in an auto-mode event").toMatchObject({ status: "pending", standing: "guest" });
    await guestA.page.getByRole("button", { name: GUEST_WORDS.checkNow }).click();
    await guestA.page.waitForLoadState("networkidle").catch(() => {});
    await expect(guestA.page.getByTestId("guest-waiting"), "still waiting after Check now in auto mode").toBeVisible();
    expect((await prisma.player.findUniqueOrThrow({ where: { id: askedA.id } })).status, "auto mode confirmed a guest").toBe("pending");

    // 3. THE SECRETARY reads the rows. Each says whom it clashes with, and the buttons are the clash pair, not the plain pair.
    const desk = await secretaryAt(browser, baseURL!, testInfo, netEventId);
    const waiting = desk.getByTestId("guests-waiting");
    await expect(waiting).toContainText("Guests asking to play (2)");
    const rowA = waiting.getByTestId("guest-waiting-row").filter({ hasText: lower });
    await expect(rowA.getByTestId("same-name")).toContainText(GUEST_WORDS.sameName(NAMES[3]));
    await expect(rowA.getByRole("button"), "the clash row has exactly the two clash buttons").toHaveCount(2);
    await expect(rowA.getByRole("button", { name: /Approve: a different person/ })).toBeVisible();
    await expect(rowA.getByRole("button", { name: /Decline: already entered/ })).toBeVisible();
    const rowB = waiting.getByTestId("guest-waiting-row").filter({ hasText: sameAsDeclined.name });
    await expect(rowB.getByTestId("same-name")).toContainText(GUEST_WORDS.sameName(sameAsDeclined.name));
    await expect(rowB.getByRole("button", { name: /Decline: already entered/ })).toBeVisible();

    // 4. APPROVE: A DIFFERENT PERSON. The committee gives 12; a second entry stands beside the first, which is untouched.
    const figure = rowA.getByLabel("Handicap for today");
    await expect(figure).toHaveValue("11");
    await figure.fill("12");
    await rowA.getByRole("button", { name: /Approve: a different person/ }).click();
    await expect
      .poll(async () => (await prisma.player.findUniqueOrThrow({ where: { id: askedA.id } })).status, { timeout: 20_000 })
      .toBe("confirmed");
    const now = await prisma.player.findMany({ where: { eventId: netEventId, name: { equals: NAMES[3], mode: "insensitive" } } });
    expect(now, "two people of that name in the field").toHaveLength(2);
    const approved = await prisma.player.findUniqueOrThrow({ where: { id: askedA.id } });
    expect(approved, "the guest, as a guest, with the committee's figure").toMatchObject({ status: "confirmed", standing: "guest", handicap: 12, handicapSource: "manual" });
    expect(approved.memberId, "the guest got a roster row of their own").not.toBeNull();
    expect(approved.memberId, "and not the member's").not.toBe(originalBefore.memberId);
    const originalAfter = await prisma.player.findUniqueOrThrow({ where: { id: sameAsApproved.id } });
    expect(originalAfter, "the member already in the field is untouched").toMatchObject({
      name: originalBefore.name,
      email: originalBefore.email,
      status: "confirmed",
      handicap: originalBefore.handicap,
      handicapSource: originalBefore.handicapSource,
      memberId: originalBefore.memberId,
      standing: originalBefore.standing,
    });
    // The guest presses Check now and the waiting card turns into their Today.
    await guestA.page.getByRole("button", { name: GUEST_WORDS.checkNow }).click();
    await expect(guestA.page.getByTestId("guest-waiting")).toHaveCount(0, { timeout: 40_000 });

    // 5. DECLINE: ALREADY ENTERED. One confirm names them; the entry goes; the member in the field stays.
    await open(desk, `/registration?bust=${Date.now()}`);
    const rowB2 = desk.getByTestId("guests-waiting").getByTestId("guest-waiting-row").filter({ hasText: sameAsDeclined.name });
    let confirmed = "";
    desk.once("dialog", (d) => {
      confirmed = d.message();
      void d.accept();
    });
    await rowB2.getByRole("button", { name: /Decline: already entered/ }).click();
    await expect
      .poll(async () => prisma.player.count({ where: { eventId: netEventId, name: sameAsDeclined.name, status: "pending" } }), { timeout: 20_000 })
      .toBe(0);
    expect(confirmed, "the confirm names the person").toBe(GUEST_WORDS.declineConfirm(sameAsDeclined.name));
    expect(await prisma.player.count({ where: { eventId: netEventId, name: sameAsDeclined.name } }), "only the member is left under that name").toBe(1);
    expect(await prisma.player.findUniqueOrThrow({ where: { id: sameAsDeclined.id } }), "the member already in the field is untouched").toMatchObject({
      status: "confirmed",
      email: declinedOriginalBefore.email,
      handicap: declinedOriginalBefore.handicap,
    });
    // The declined guest is told, on their own phone.
    await guestB.page.getByRole("button", { name: GUEST_WORDS.checkNow }).click();
    await expect(guestB.page.getByText("This link no longer works.")).toBeVisible({ timeout: 40_000 });

    expect(errors, "page errors while walking the clash").toEqual([]);
  });

  test("a gross-only event asks no figure: Approve is open, and approving stores none", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const guest = await guestAsks(browser, baseURL!, testInfo, TOKEN_GROSS, { name: "Joss Penhale", by: "Corin" });
    const asked = await prisma.player.findFirstOrThrow({ where: { eventId: grossEventId, name: "Joss Penhale" } });
    expect(asked, "a guest entry with no figure given").toMatchObject({ status: "pending", standing: "guest", handicapSource: "none" });

    const desk = await secretaryAt(browser, baseURL!, testInfo, grossEventId);
    const row = desk.getByTestId("guests-waiting").getByTestId("guest-waiting-row").filter({ hasText: "Joss Penhale" });
    await expect(row.getByTestId("figure-hint")).toContainText(GUEST_WORDS.grossOnly);
    await expect(row.getByLabel("Handicap for today"), "a gross-only event draws a figure box").toHaveCount(0);
    const approve = row.getByRole("button", { name: /Approve/ });
    await expect(approve, "Approve is open with no figure when every round is gross").toBeEnabled();
    await approve.click();
    await expect
      .poll(async () => (await prisma.player.findUniqueOrThrow({ where: { id: asked.id } })).status, { timeout: 20_000 })
      .toBe("confirmed");
    // No figure was asked, so none is stored: never a 0 passed off as a handicap.
    const stored = await prisma.player.findUniqueOrThrow({ where: { id: asked.id } });
    expect(stored, "approved as a guest, with no handicap").toMatchObject({ standing: "guest", handicapSource: "none" });
    expect(stored.memberId, "the guest got a roster row of their own").not.toBeNull();
    // The guest presses Check now and the waiting card turns into their Today.
    await guest.page.getByRole("button", { name: GUEST_WORDS.checkNow }).click();
    await expect(guest.page.getByTestId("guest-waiting")).toHaveCount(0, { timeout: 40_000 });

    expect(errors, "page errors while approving in a gross-only event").toEqual([]);
  });
});
