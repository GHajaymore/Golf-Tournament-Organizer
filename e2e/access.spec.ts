import { test, expect, closeAll } from "./coverage";
import { overflowing } from "./overflow";
import { openSettingsTab } from "./settings-tabs";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signInWith, sessionOf } from "./rounds-fixture";
import { openStaffAndAccess, openAccessSection } from "./console/clubSettings";
import { consoleUrl } from "../src/lib/console-url";

/**
 * THE ACCESS SCREEN, WITH SOMEBODY WAITING ON IT.
 *
 * `layout.spec` walks `/organization` at every viewport and asserts nothing
 * sticks out. That sweep is only ever as good as what the fixture puts on the
 * screen, and the request-to-join panel is the newest thing there: a person's
 * name, their address, their note, a role picker and two buttons, on one row.
 *
 * So the fixture seeds a pending request, and this spec is the half the sweep
 * cannot do — proving the panel is actually rendered. Without it the width
 * assertions would pass on an empty screen for ever, which is the failure
 * `e2e/fixture.mjs` already records about a 404 satisfying the public-board
 * spec.
 *
 * READ-ONLY. It never approves or declines: this fixture is shared by three
 * viewport projects running in parallel, and a spec that answered the request
 * would delete the thing the other two came to measure.
 */

test.use({ storageState: ".e2e/organizer.json" });

test("a request to join is on the access screen, and fits", async ({ page }) => {
  await page.goto("/organization");
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "/organization redirected away — not signed in?").toBe("/organization");
  await expect(page.locator("#__next_error__")).toHaveCount(0);
  // The requests are on the Staff & access tab, which says how many wait before it is opened.
  await expect(page.getByRole("tab", { name: /^Staff & access \(\d+ waiting\)/ }), "the tab does not say anybody is waiting").toBeVisible();
  await openSettingsTab(page, "Staff & access");

  // THE PANEL IS THERE. Everything below measures it; this is what stops the
  // measurements being taken of nothing.
  const panel = page.locator(".card", { hasText: "Asked to join" }).first();
  await expect(panel).toBeVisible();

  // The three things the club needs in order to answer: who, how to recognise
  // them, and what they said. The name carries an accent, a curly apostrophe
  // and a hyphen, so this is an encoding check as much as a layout one.
  await expect(panel).toContainText("Síobhán O’Donnell-Fitzgerald");
  await expect(panel).toContainText("@example.invalid");
  await expect(panel).toContainText("Thursday night draw");

  // And the answer, with Admin first — the default the screen grants, because
  // whoever asks is the league's other organizer rather than a spectator.
  await expect(panel.getByRole("button", { name: /Add them/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Decline/ })).toBeVisible();
  const role = panel.getByRole("combobox").first();
  await expect(role).toHaveValue("admin");

  /**
   * Nothing sticks out — at whichever width this project runs. The panel's row
   * is a name, an address, a select and two buttons, which is the shape that
   * overflowed a 320px phone the last time a control grew (#429).
   */
  const width = page.viewportSize()?.width ?? 0;
  const offenders = await overflowing(page);
  expect(
    offenders,
    `/organization: ${offenders.length} element(s) past the right edge — ${JSON.stringify(offenders.slice(0, 3))}`,
  ).toEqual([]);
  const box = await panel.boundingBox();
  expect(box, "the panel has no box at all").not.toBeNull();
  expect(
    Math.round((box?.x ?? 0) + (box?.width ?? 0)),
    `the panel itself runs past a ${width}px screen`,
  ).toBeLessThanOrEqual(width + 1);
});

/**
 * CLUB SETTINGS' STAFF & ACCESS, WITH ITS "ON THIS EVENT" SECTION (R7, behind the redesign switch).
 *
 * The rule the screen is held to: an event Admin who is NOT club staff still manages that event's helpers, and
 * the rest of Club settings stays on the CLUB role. So this walks, in a club of its own that has an owner:
 *
 *   the event Admin adds a helper on "On this event"  → kept after a reload; the helper signs in and Registration opens
 *   the same Admin looks at "Club staff"              → read-only, said in words beside the greyed button
 *   the helper (an assistant)                         → is not let into Club settings, and is told why where they land
 *
 * Every person is invented, on `@example.invalid`, in a club the spec makes and drops whole.
 */
test.describe("@redesign", () => {
  test.use({ storageState: undefined });

  test("an event Admin who is not club staff adds a helper on 'On this event', and the club's own staff stay read-only", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const mark = `zz-r7access-${testInfo.project.name}`;
    const club = await makeClub(mark);
    const device = testInfo.project.use;
    const helperEmail = `${mark}-helper@example.invalid`;
    const helperName = "Robin Helper";
    const admin = await browser.newContext({ ...device, baseURL, storageState: undefined });
    const helper = await browser.newContext({ ...device, baseURL, storageState: undefined });
    try {
      const { event } = await makeEvent(club, "Spring Medal", { stages: [{}] });
      // The set-up: somebody who runs THIS tournament and holds no seat at the club.
      const adminUser = await prisma.user.create({
        data: { email: `${mark}-admin@example.invalid`, name: "Quinn Eventadmin", password: "x:unusable", emailVerifiedAt: new Date() },
      });
      await prisma.account.create({ data: { eventId: event.id, email: adminUser.email, name: adminUser.name, role: "admin" } });
      expect(await prisma.organizationMember.count({ where: { userId: adminUser.id } }), "CONTROL: the event Admin is on the club's staff").toBe(0);
      const helperUser = await prisma.user.create({ data: { email: helperEmail, name: helperName, password: "x:unusable", emailVerifiedAt: new Date() } });
      await signInWith(admin, baseURL!, sessionOf(adminUser.id), event.id);
      await signInWith(helper, baseURL!, sessionOf(helperUser.id), event.id);

      const desk = await admin.newPage();
      const theirs = await helper.newPage();
      watchPageErrors(desk, errors, "event admin");
      watchPageErrors(theirs, errors, "helper");
      const registration = async () => {
        await theirs.goto(`/registration?bust=${Date.now()}`);
        await theirs.waitForLoadState("networkidle").catch(() => {});
        return new URL(theirs.url()).pathname;
      };
      expect(await registration(), "CONTROL: somebody with no access was let into the console").not.toBe("/registration");

      // ── adds the helper where the event's helpers now are ─────────────────
      await openStaffAndAccess(desk);
      let events = await openAccessSection(desk, "event");
      const add = events.locator(".card", { has: desk.locator(".card-title", { hasText: "Add account" }) }).last();
      await add.getByLabel("Name").fill(helperName);
      await add.getByLabel("Email").fill(helperEmail);
      await add.locator("label.seg-opt", { hasText: /^\s*Assistant\s*$/ }).click();
      await add.getByRole("button", { name: "Add account" }).click();
      await expect
        .poll(async () => (await prisma.account.findFirst({ where: { eventId: event.id, email: helperEmail } }))?.role, { timeout: 20_000, message: "the helper was not added" })
        .toBe("assistant");

      // The kept value, on a fresh load of the same screen.
      await expect(events.locator("tr", { hasText: helperEmail }), "the helper is not listed before the reload").toBeVisible();
      await desk.reload();
      await desk.waitForLoadState("networkidle").catch(() => {});
      await openStaffAndAccess(desk);
      events = await openAccessSection(desk, "event");
      await expect(events.locator("tr", { hasText: helperEmail }), "the helper is not listed after a reload").toBeVisible();
      expect(await registration(), "an assistant just added cannot open the console").toBe("/registration");

      // ── the club's own staff are read-only to somebody who is not on them ──
      const clubStaff = await openAccessSection(desk, "club");
      await expect(clubStaff.getByText("Only a Commissioner or Admin can manage staff."), "the read-only reason is not said beside the button").toBeVisible();
      await expect(clubStaff.getByRole("button", { name: "Add staff" }), "an event Admin can press Add staff").toBeDisabled();

      // ── the helper is not let into Club settings, and is told where they land ─
      await theirs.goto(consoleUrl("/organization#access", "build"));
      await theirs.waitForLoadState("networkidle").catch(() => {});
      expect(new URL(theirs.url()).pathname, "an assistant opened Club settings").toBe("/dashboard");
      await expect(theirs.getByRole("status").filter({ hasText: /can.t open for you/ }).first(), "the refusal is not said in words").toBeVisible();

      expect(errors, "a screen threw").toEqual([]);
    } finally {
      await closeAll(admin, helper);
      await dropClub(mark);
    }
  });
});
