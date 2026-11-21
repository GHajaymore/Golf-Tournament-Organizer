import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { journey, ceilingBreaches } from "./journey";
import { GUEST_WORDS } from "../src/lib/domain/guest-entry";

/**
 * THE GUEST'S OWN PATH ON THE SIGN-UP LINK, PRESSED AS THE GUEST (J39/J40 PR 3B, test plan E6): the three rows of that plan
 * the first spec (`guest-enters-on-the-link.spec.ts`) does not walk.
 *
 *   1. THE BUDGET. A guest scans the poster's QR (the sign-up link), presses "Enter as a guest", types a name, presses
 *      "Ask to play", and is shown the waiting screen. Counted with the shared counter (`e2e/journey.ts`) as journey
 *      `guest-enters-by-poster` and held by its ceiling in `e2e/journey-budgets.ts`. The design says 4 presses and about 12
 *      characters "to the waiting screen" (scan, open, Enter as a guest, Ask to play): the counter does not count the phone's own
 *      scan and open (it records them as a note, as J6 records "opens the player link"), so what is held here is the two
 *      presses the app asks and the 10 characters of a name.
 *   2. REFUSALS SAID WHERE THE PRESS WAS. An empty name, then a handicap that is not a number: each sentence appears inside the
 *      guest form, IN THE VIEWPORT (`toBeInViewport`, which `toBeVisible` is not: a hidden-below-the-fold sentence passes that),
 *      the typed fields are kept, and no entry is made.
 *   3. A WEAK SIGNAL (C3.5). The first "Ask to play" reaches the server and its answer never reaches the phone. The phone says
 *      "Couldn't send. Try again." with a Try again button at least 48 px tall and everything typed kept; Try again shows the
 *      waiting screen with the guest's code, and the database holds ONE entry for that name, never two.
 *
 * Fixtures: club `zz-guest-entry-path`, invented names, no address typed anywhere, `dropClub` in a `finally`. The round is dated
 * 30 days ahead. Service workers are blocked in every context (a spec that stubs the network, WebKit). One context, one page
 * for each guest.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in GuestEntryForm.tsx and
 * GuestWaitingCard.tsx; CI runs it first.
 */

const ZONE = "UTC";
const MARK = "zz-guest-entry-path";
const TOKEN = "ZZGUESTENTRYPATHTOKEN24";
/** Ten characters: the guest's typing in the budgeted walk. */
const BUDGET_GUEST = "Elin Marsh";

async function newContext(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("a guest's own path on the sign-up link", () => {
  let club: Club;
  let eventId = "";
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Path Outing", {
      status: "draft",
      stages: [{ playedOn: dayIn(ZONE, new Date(Date.now() + 30 * 86_400_000)), scoringBasis: "net" }],
      players: 2,
      event: { registrationOpen: true, registrationToken: TOKEN, guestEntryOpen: true, capacity: 64 },
    });
    eventId = made.event.id;
  });
  test.afterEach(async () => {
    while (contexts.length) await contexts.pop()!.close().catch(() => {});
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  async function freshGuest(browser: Browser, baseURL: string, testInfo: TestInfo, who: string) {
    const context = await newContext(browser, baseURL, testInfo);
    contexts.push(context);
    const page = await context.newPage();
    watchPageErrors(page, errors, who);
    return page;
  }

  test("the budget: scan, Enter as a guest, a name, Ask to play, waiting: two presses and ten characters", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const page = await freshGuest(browser, baseURL!, testInfo, "budget guest");
    const walk = journey(page, "guest-enters-by-poster");
    walk.start();
    await page.goto(`/register/${TOKEN}`);
    walk.note("scans the poster's QR: the sign-up link");
    await walk.settle();
    const form = page.getByTestId("guest-entry");
    const name = form.getByLabel("Your name");
    await walk.press(page.getByRole("button", { name: /Enter as a guest/ }), "“Enter as a guest”");
    await expect(name, "the press opened the form (a press the spec repeats would be counted as the guest's)").toBeVisible({ timeout: 20_000 });
    await walk.type(name, BUDGET_GUEST, "Your name");
    await walk.press(form.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }), "“Ask to play”");
    await expect(page.getByTestId("guest-waiting")).toBeVisible({ timeout: 30_000 });
    walk.stop();
    walk.note("is shown the waiting screen");
    const f = await walk.report(testInfo);
    // CONTROL: the counter saw the walk: the link and the waiting screen at least, and an entry exists.
    expect(f.screens, "the counter saw no screens").toBeGreaterThanOrEqual(2);
    expect(await prisma.player.count({ where: { eventId, name: BUDGET_GUEST, status: "pending", standing: "guest" } }), "the walk made one waiting entry").toBe(1);
    const over = ceilingBreaches(f);
    expect(over, over.join("\n")).toEqual([]);
    expect(errors, "page errors while the guest walked the path").toEqual([]);
  });

  test("an empty name and a handicap that is not a number are each refused beside the press, in view, and make no entry", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const page = await freshGuest(browser, baseURL!, testInfo, "refused guest");
    await open(page, `/register/${TOKEN}`);
    const form = page.getByTestId("guest-entry");
    const name = form.getByLabel("Your name");
    // A press made before the page woke is not taken up; press until the form is drawn.
    await expect(async () => {
      await page.getByRole("button", { name: /Enter as a guest/ }).click({ timeout: 3_000 });
      await expect(name).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    const before = await prisma.player.count({ where: { eventId } });

    // 1. Nothing typed: the one sentence, in the viewport, inside the form.
    await form.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    const refusal = form.getByRole("alert").filter({ hasText: GUEST_WORDS.needName });
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal, "the refusal is said where the press was, on screen").toBeInViewport();
    await expect(name).toBeVisible();
    expect(await prisma.player.count({ where: { eventId } }), "an empty name made an entry").toBe(before);

    // 2. A name and a handicap that is no number: the other sentence, the typed fields kept.
    await name.fill("Rosalind Kerr");
    await form.getByLabel("Handicap, if you have one").fill("abc");
    await form.getByLabel("Who invited you?").fill("Corin");
    await form.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    const badFigure = form.getByRole("alert").filter({ hasText: GUEST_WORDS.badFigure });
    await expect(badFigure).toBeVisible({ timeout: 20_000 });
    await expect(badFigure, "the refusal is said where the press was, on screen").toBeInViewport();
    await expect(name).toHaveValue("Rosalind Kerr");
    await expect(form.getByLabel("Handicap, if you have one")).toHaveValue("abc");
    await expect(form.getByLabel("Who invited you?")).toHaveValue("Corin");
    expect(await prisma.player.count({ where: { eventId } }), "a handicap that is no number made an entry").toBe(before);

    // 3. Corrected, the same form goes through: the refusals did not spend the guest's way in.
    await form.getByLabel("Handicap, if you have one").fill("18.4");
    await form.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    await expect(page.getByTestId("guest-waiting")).toBeVisible({ timeout: 30_000 });
    expect(await prisma.player.count({ where: { eventId, name: "Rosalind Kerr", status: "pending" } }), "the corrected form made one entry").toBe(1);
    expect(errors, "page errors while the guest was refused").toEqual([]);
  });

  test("a send whose answer is lost: Try again keeps what was typed and makes ONE entry", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const page = await freshGuest(browser, baseURL!, testInfo, "weak-signal guest");
    await open(page, `/register/${TOKEN}`);
    const form = page.getByTestId("guest-entry");
    const name = form.getByLabel("Your name");
    await expect(async () => {
      await page.getByRole("button", { name: /Enter as a guest/ }).click({ timeout: 3_000 });
      await expect(name).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await name.fill("Inge Rowntree");
    await form.getByLabel("Handicap, if you have one").fill("21.6");
    await form.getByLabel("Who invited you?").fill("Corin");

    // The form is open (its device cookie is set); from here the FIRST post is "Ask to play". It reaches the server, which
    // makes the entry, and its answer never reaches the phone.
    let lost = 0;
    await page.route(
      (url) => url.pathname === `/register/${TOKEN}`,
      async (route) => {
        if (route.request().method() === "POST" && lost === 0) {
          lost += 1;
          await route.fetch();
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    await form.getByRole("button", { name: GUEST_WORDS.askToPlay, exact: true }).click();
    const said = form.getByRole("alert").filter({ hasText: GUEST_WORDS.noSend });
    await expect(said).toBeVisible({ timeout: 30_000 });
    await expect(said, "the sentence is on screen where the press was").toBeInViewport();
    expect(lost, "the first send was the one dropped").toBe(1);
    const retry = form.getByRole("button", { name: GUEST_WORDS.tryAgain });
    await expect(retry).toBeVisible();
    const box = await retry.boundingBox();
    expect(box?.height ?? 0, "Try again is at least 48 px tall").toBeGreaterThanOrEqual(48);
    await expect(name, "the name is kept").toHaveValue("Inge Rowntree");
    await expect(form.getByLabel("Handicap, if you have one")).toHaveValue("21.6");
    await expect(form.getByLabel("Who invited you?")).toHaveValue("Corin");
    // The server took the first send: the entry is there already, once.
    await expect.poll(async () => prisma.player.count({ where: { eventId, name: "Inge Rowntree" } }), { timeout: 20_000 }).toBe(1);

    // Try again: the same press, the same entry, and the guest's code.
    await retry.click();
    await expect(page.getByTestId("guest-waiting")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("guest-code"), "the retry gave the code the lost answer carried").toContainText(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
    expect(await prisma.player.count({ where: { eventId, name: "Inge Rowntree" } }), "Try again made a second entry").toBe(1);
    expect(await prisma.player.findFirstOrThrow({ where: { eventId, name: "Inge Rowntree" } }), "the one entry is the guest's own").toMatchObject({
      status: "pending",
      standing: "guest",
      email: "",
    });
    expect(errors, "page errors while the signal was weak").toEqual([]);
  });
});
