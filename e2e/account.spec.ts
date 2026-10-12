import { createHmac } from "node:crypto";
import { test, expect, type Browser, type TestInfo } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * YOUR ACCOUNT, IN A BROWSER: the two things on it that end something.
 *
 * Both were built on 2026-10-11 and both were covered that day by tests that
 * call the server directly. Neither had ever been PRESSED. A server test can
 * say the rule is right; it cannot say that the button on the screen reaches
 * the rule, that the person lands somewhere sensible afterwards, or that the
 * other device — the whole point of one of them — is really shut out.
 *
 *   SIGN OUT EVERYWHERE   is for the phone you are not holding. So this has
 *                         two devices, presses the button on one, and asks the
 *                         OTHER whether it is still signed in.
 *   LEAVE THIS CLUB       is the other half of "a club adds people by email,
 *                         with no invitation to accept". A member leaves, and
 *                         what the screen promised is checked: off the club's
 *                         list, and still in the tournament they entered.
 *
 * Each has the control that keeps it from passing by having broken something:
 * a fresh sign-in works after signing out everywhere, and the club's only
 * Commissioner is told why they cannot leave rather than handed a button.
 *
 * One project. These are rules about sessions and lists, not about widths;
 * `layout.spec` measures this screen at every width.
 */

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
/** The user a session cookie was signed for: `<id>~<when>.<signature>`. */
const userOf = (session: string) => session.split("~")[0];

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  await teardown();
});

/** A device of its own, signed in with the cookie given. */
async function device(browser: Browser, testInfo: TestInfo, baseURL: string, session: string, eventId?: string) {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  const cookies = [{ name: "ng_session", value: session, url: baseURL }];
  if (eventId) cookies.push({ name: "ng_active_event", value: sign(eventId), url: baseURL });
  await context.addCookies(cookies);
  return context;
}

const bust = (path: string) => `${path}?bust=${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test("signing out everywhere ends the sign-in on the device she is not holding", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one project: a rule about sessions, not about widths");
  test.setTimeout(120_000);
  const errors: string[] = [];
  const member = userOf(club.player.session);

  // Two sign-ins of one person, made a minute apart, as two devices are.
  const phone = await device(browser, testInfo, baseURL!, sign(signedInNow(member, Date.now() - 60_000)), club.landing.id);
  const clubhouse = await device(browser, testInfo, baseURL!, sign(signedInNow(member, Date.now() - 5_000)), club.landing.id);
  try {
    const onPhone = await phone.newPage();
    const onClubhouse = await clubhouse.newPage();
    watchPageErrors(onPhone, errors, "phone");
    watchPageErrors(onClubhouse, errors, "clubhouse");

    // CONTROL: both are signed in to begin with, or everything below would pass on two strangers.
    for (const page of [onPhone, onClubhouse]) {
      await page.goto(bust("/account"));
      await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
      await expect(page.getByText(club.player.email).first()).toBeVisible();
    }
    await onClubhouse.goto(bust("/me"));
    expect(new URL(onClubhouse.url()).pathname, "the clubhouse computer could not open the player app to begin with").toBe("/me");

    // On the phone in her hand:
    await onPhone.getByRole("button", { name: "Sign out everywhere" }).click();
    await onPhone.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });

    // The device she is NOT holding. Its cookie is untouched; the server no longer honours it.
    for (const path of ["/account", "/me", "/me/card", "/dashboard"]) {
      await onClubhouse.goto(bust(path));
      await onClubhouse.waitForLoadState("networkidle").catch(() => {});
      const landed = new URL(onClubhouse.url()).pathname;
      expect(landed, `the clubhouse computer is still signed in at ${path}`).not.toBe(path);
      await expect(onClubhouse.getByRole("heading", { level: 1, name: "Your account" })).toHaveCount(0);
    }
    expect((await clubhouse.cookies()).some((c) => c.name === "ng_session"), "the test cleared the cookie itself: nothing was refused").toBe(true);

    // And the phone she pressed it on.
    await onPhone.goto(bust("/account"));
    expect(new URL(onPhone.url()).pathname, "the phone is still signed in").not.toBe("/account");
  } finally {
    await phone.close();
    await clubhouse.close();
  }

  // CONTROL: her account is not broken — "you can sign straight back in". A sign-in made after is
  // honoured. (Over a second later: a sign-in is stamped to the second, the cut-off to the millisecond.)
  await new Promise((r) => setTimeout(r, 1_600));
  const again = await device(browser, testInfo, baseURL!, sign(signedInNow(member)), club.landing.id);
  try {
    const page = await again.newPage();
    watchPageErrors(page, errors, "signed in again");
    await page.goto(bust("/account"));
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
  } finally {
    await again.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});

test("a member leaves a club that added them, and keeps the tournament they entered", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one project: a rule about a list, not about widths");
  test.setTimeout(120_000);
  const errors: string[] = [];
  // A sign-in of her own, made now: the test above ended every earlier one.
  await new Promise((r) => setTimeout(r, 1_600));
  const hers = await device(browser, testInfo, baseURL!, sign(signedInNow(userOf(club.player.session))), club.landing.id);
  const secretary = await device(browser, testInfo, baseURL!, club.organizer.session, club.landing.id);
  try {
    const page = await hers.newPage();
    watchPageErrors(page, errors, "member");
    await page.goto(bust("/account"));
    const clubs = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your clubs" }) });
    // Named with the role she actually has. She is a Member: the screen does not tell her she runs anything.
    await expect(clubs.getByText(club.org.name)).toBeVisible();
    await expect(clubs.getByText("Member", { exact: false })).toBeVisible();
    await expect(clubs.getByText(/help run|staff/i)).toHaveCount(0);

    // CONTROL: the club's only Commissioner is told why, and is offered no button that would refuse.
    const hisPage = await secretary.newPage();
    watchPageErrors(hisPage, errors, "secretary");
    await hisPage.goto(bust("/account"));
    await expect(hisPage.getByText("You are its only Commissioner, so you can’t leave it.")).toBeVisible();
    await expect(hisPage.getByRole("button", { name: "Leave this club" })).toHaveCount(0);
    // What the club's own list of people says about her BEFORE: a Member of the club.
    const herRow = hisPage.locator("tr").filter({ hasText: club.player.email });
    await hisPage.goto(bust("/organization"));
    await hisPage.waitForLoadState("networkidle").catch(() => {});
    // Twice: on the club's own list of its people, and in the table of who can open what.
    await expect(herRow).toHaveCount(2);
    await expect(herRow.last().locator("td").nth(1)).toHaveText("Member");

    // Two presses: the first asks.
    await clubs.getByRole("button", { name: "Leave this club" }).click();
    await expect(page.getByRole("heading", { name: "Your clubs" }), "one press was enough to leave").toBeVisible();
    await page.getByRole("button", { name: `Leave ${club.org.name}` }).click();
    await expect(page.getByRole("heading", { name: "Your clubs" })).toHaveCount(0, { timeout: 20_000 });
    await page.goto(bust("/account"));
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your clubs" }), "she is back on the list after a reload").toHaveCount(0);

    // "Tournaments you entered and your results stay as they are": the medal she is in still opens as hers.
    await page.goto(bust("/me"));
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(page.url()).pathname, "leaving the club took her out of a tournament she had entered").toBe("/me");
    await expect(page.getByText(/You aren.t entered|not in this tournament/i)).toHaveCount(0);

    // And the club's list AFTER: she is still a person it can see — she is in its tournaments — with
    // no club role. Not gone from the page: an entry is not a membership, and the screen says so.
    await hisPage.goto(bust("/organization"));
    await hisPage.waitForLoadState("networkidle").catch(() => {});
    await expect(hisPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(herRow, "she is still on the club's own list of its people").toHaveCount(1);
    await expect(herRow.locator("td").nth(1), "the club still has her down as a Member").toHaveText("—");
  } finally {
    await hers.close();
    await secretary.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
