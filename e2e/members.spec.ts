import { createHmac } from "node:crypto";
import { test, expect, closeAll, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession } from "./rounds-fixture";
import { consoleUrl } from "../src/lib/console-url";
import { openMembers, openHistory } from "./console/members";

/**
 * THE CLUB'S MEMBERS LIST, KEPT BY HAND AND FROM A SPREADSHEET.
 *
 * The first full round with its reach printed (2026-10-13) said `roster.ts — 2
 * of 11 reached`: the every-screen walk OPENS Members on every tournament and
 * the control crawl ticks its boxes, and nothing had ever added a member,
 * corrected one, imported a file or put a member into a field from here.
 *
 * This is the secretary doing each of those the way a secretary does:
 *
 *   add        one member, by the form — and the two refusals that are said in
 *              words (no name; an address somebody else has)
 *   correct    the handicap and the phone, kept after a reload
 *   retire     set inactive (gone from the list, kept in the record), found
 *              again under "Show inactive", brought back
 *   import     a spreadsheet: two new members, one already here whose handicap
 *              it corrects, one row that cannot be read, and a column the app
 *              does not know — each counted, and the PLUS handicap keeps its
 *              sign (read as 2.4 it gives strokes to the best player in the
 *              club)
 *   enter      two of them put into the tournament from this screen, and the
 *              list then says they are in it and may no longer be removed
 *   remove     the one who never played, who may be
 *
 * Every person is invented, with a stamp of this run in the name and an
 * `@example.invalid` address, in the seeded club — which the spec's own
 * teardown removes whole.
 *
 * One project: the list is a table at desktop width, and `layout.spec` is what
 * measures it on a phone.
 */

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const STAMP = Date.now().toString(36).slice(-5);
const who = (first: string) => `${first} Quillfeather ${STAMP}`;
const mail = (tag: string) => `zz-members-${STAMP}-${tag}@example.invalid`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  await teardown();
});

async function open(page: Page) {
  await page.goto(`/roster?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
}
const row = (page: Page, name: string) => page.locator("tbody tr").filter({ hasText: name });

test("the secretary adds, corrects, retires, imports and enters members from the Members screen", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project: the list is a table at desktop width");
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  // A tournament still taking entries: a launched one locks its field, and the screen says so.
  const open1 = club.events.find((e) => e.slug === "captains");
  // Setting up: stored `draft` since A045 (state machine PR 8) moved the old "taking entries" word off every row.
  expect(open1?.status, "the seeded club has no tournament taking entries").toBe("draft");
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(open1!.id), url: baseURL! },
  ]);

  const ada = who("Ada");

  await test.step("add one by the form; a missing name and a taken address are refused in words", async () => {
    await open(page);
    await page.getByRole("button", { name: "Add member" }).click();
    await page.getByLabel("Handicap index").fill("12.4");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Enter a name.")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill(ada);
    await page.getByLabel(/^Email/).fill(club.player.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText(/is already on the roster with that email\./)).toBeVisible();

    await page.getByLabel(/^Email/).fill(mail("ada"));
    await page.getByLabel("Phone").fill("5550101");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(row(page, ada)).toHaveCount(1, { timeout: 20_000 });
    await expect(row(page, ada)).toContainText("12.4");
  });

  await test.step("correct her handicap; it is kept", async () => {
    await row(page, ada).getByTitle("Edit").click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(ada);
    await page.getByLabel("Handicap index").fill("9.8");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, ada)).toContainText("9.8", { timeout: 20_000 });
    await open(page);
    await expect(row(page, ada)).toContainText("9.8");
    await expect(row(page, ada)).not.toContainText("12.4");
  });

  await test.step("retire her and bring her back: out of the list, never out of the record", async () => {
    await page.getByLabel("Search members").fill(`Quillfeather ${STAMP}`);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await row(page, ada).getByTitle("Set inactive").click();
    await expect(row(page, ada)).toHaveCount(0, { timeout: 20_000 });
    await page.getByLabel("Show inactive").check();
    await expect(row(page, ada)).toHaveCount(1);
    await expect(row(page, ada)).toContainText("inactive");
    await row(page, ada).getByTitle("Reactivate").click();
    await expect(row(page, ada).getByTitle("Set inactive")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Show inactive").uncheck();
    await expect(row(page, ada)).toHaveCount(1);
    await page.getByLabel("Search members").fill("");
  });

  const bo = who("Bo");
  const cy = who("Cy");
  const dee = who("Dee");

  await test.step("import a spreadsheet: every row is accounted for, and a plus handicap keeps its sign", async () => {
    const csv = [
      "name,email,handicap,phone,shoe size",
      `${bo},${mail("bo")},+2.4,5550102,10`,
      `${cy},${mail("cy")},18.1,5550103,9`,
      // Already here: the file corrects her handicap rather than adding her twice.
      `${ada},${mail("ada")},7.5,5550101,8`,
      // Cannot be read as an address: skipped, and said.
      `${dee},not-an-address,20,5550104,7`,
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    const summary = page.getByRole("status").filter({ hasText: /added|updated|skipped/ });
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary).toContainText("2 added");
    await expect(summary).toContainText("1 updated");
    await expect(summary).toContainText("1 skipped (no name, or a bad email)");
    await expect(summary).toContainText("Ignored column: shoe size");

    await open(page);
    await expect(row(page, bo)).toHaveCount(1);
    // A plus handicap is BETTER than scratch. Read without its sign it is 2.4 strokes received.
    await expect(row(page, bo)).toContainText("+2.4");
    await expect(row(page, cy)).toContainText("18.1");
    await expect(row(page, ada)).toHaveCount(1);
    await expect(row(page, ada)).toContainText("7.5");
    await expect(row(page, dee)).toHaveCount(0);
  });

  await test.step("the form shows a plus handicap with its plus, and takes one typed that way", async () => {
    await row(page, bo).getByTitle("Edit").click();
    const box = page.getByLabel("Handicap index");
    // As a golfer writes it. The box was number-only: it showed -2.4 and would not take "+2.4" at all.
    await expect(box).toHaveValue("+2.4");
    await box.fill("two and a bit");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/Enter the handicap as a number, like 12\.4/)).toBeVisible();
    await box.fill("77");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("A handicap index runs from +10 to 54.")).toBeVisible();
    await box.fill("+1.9");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, bo)).toContainText("+1.9", { timeout: 20_000 });
    await open(page);
    await expect(row(page, bo)).toContainText("+1.9");
    // Put back, typed the other way a secretary might: with the minus the arithmetic uses.
    await row(page, bo).getByTitle("Edit").click();
    await page.getByLabel("Handicap index").fill("-2.4");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, bo)).toContainText("+2.4", { timeout: 20_000 });
  });

  await test.step("the same file again adds nobody", async () => {
    const again = ["name,email,handicap,phone", `${bo},${mail("bo")},+2.4,5550102`, `${cy},${mail("cy")},18.1,5550103`].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(again, "utf8") });
    const summary = page.getByRole("status").filter({ hasText: /added|updated|up to date|Nothing to import/ });
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary).not.toContainText(/\d+ added/);
    await open(page);
    await expect(row(page, bo)).toHaveCount(1);
    await expect(row(page, cy)).toHaveCount(1);
  });

  await test.step("put two of them into the tournament from here; the list then says so", async () => {
    await page.getByLabel(`Select ${bo}`).check();
    await page.getByLabel(`Select ${ada}`).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: /^Add 2 to .*Captain/ }).click();
    await expect(row(page, bo)).toContainText("in field", { timeout: 20_000 });
    await expect(row(page, ada)).toContainText("in field");
    await expect(row(page, cy)).not.toContainText("in field");
    // And the tournament's own screen agrees about who is in it.
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    // By the field's own rows — each has a handicap box named for its player. A name alone is on
    // this screen for anybody the club could still add.
    await expect(page.getByLabel(`Handicap for ${bo}`)).toHaveCount(1);
    await expect(page.getByLabel(`Handicap for ${ada}`)).toHaveCount(1);
    await expect(page.getByLabel(`Handicap for ${cy}`)).toHaveCount(0);
    // The plus handicap went into the field as what it is — 2.4 BETTER than scratch — and the
    // tournament's own row writes it the way the Members list does. (Until 2026-10-13 this line
    // expected "-2.4": it was pinning the stored number, which was the defect.)
    await expect(page.getByLabel(`Handicap for ${bo}`)).toHaveValue("+2.4");
  });

  await test.step("on the tournament's own screen a plus handicap is shown, corrected and added with its plus", async () => {
    const box = page.getByLabel(`Handicap for ${bo}`);
    // Corrected the way it is written. A number box could not hold "+3.1" at all.
    await box.fill("+3.1");
    // Enter, as somebody finishing a figure presses: until 2026-10-13 it saved nothing here (`leave-on-enter.ts`).
    await box.press("Enter");
    await expect(page.getByLabel(`Handicap for ${bo}`)).toHaveValue("+3.1", { timeout: 20_000 });
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByLabel(`Handicap for ${bo}`), "kept, and still 3.1 better than scratch").toHaveValue("+3.1");

    // Nonsense is refused in words, by name, and nothing is saved.
    await page.getByLabel(`Handicap for ${bo}`).fill("three or so");
    await page.getByLabel(`Handicap for ${bo}`).blur();
    await expect(page.getByText(`${bo}: Enter the handicap as a number, like 12.4 — or +2.4 for a plus handicap.`)).toBeVisible();
    await page.getByLabel(`Handicap for ${bo}`).fill("77");
    await page.getByLabel(`Handicap for ${bo}`).blur();
    await expect(page.getByText(`${bo}: A handicap index runs from +10 to 54.`)).toBeVisible();
    // Emptied is not scratch: the box says again what is stored.
    await page.getByLabel(`Handicap for ${bo}`).fill("");
    await page.getByLabel(`Handicap for ${bo}`).blur();
    await expect(page.getByLabel(`Handicap for ${bo}`)).toHaveValue("+3.1");
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByLabel(`Handicap for ${bo}`), "none of the three refusals saved anything").toHaveValue("+3.1");

    // And somebody new, added from this screen as a plus handicap.
    const dee = who("Dee");
    await page.getByLabel("Player name").fill(dee);
    // By its placeholder: every row of the field has an "Email for …" box of its own.
    await page.getByPlaceholder("name@email").fill(mail("dee"));
    // A mobile, though since 2026-10-21 (A7) this tournament no longer insists on one. A number
    // from the range kept for fiction; nothing is sent to it.
    await page.getByPlaceholder("+1…").fill("+1 555 555 0142");
    await page.getByLabel("Handicap", { exact: true }).fill("+1.5");
    await page.getByRole("button", { name: "Add to field" }).click();
    await expect(page.getByLabel(`Handicap for ${dee}`)).toHaveValue("+1.5", { timeout: 20_000 });
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByLabel(`Handicap for ${dee}`), "added 1.5 BETTER than scratch, not with no handicap at all").toHaveValue("+1.5");
  });

  await test.step("who has entered may not be removed, and is told why; who never has, may", async () => {
    await open(page);
    const refused = page.getByRole("button", { name: new RegExp(`^Cannot remove ${bo} — they have played in 1 tournament\\. Set them inactive instead\\.$`) });
    await expect(refused).toBeDisabled();
    await expect(page.getByText(/A member who has played cannot be removed/)).toBeVisible();

    await page.getByRole("button", { name: `Remove ${cy} from the roster` }).click();
    await expect(row(page, cy)).toHaveCount(0, { timeout: 20_000 });
    await open(page);
    await expect(row(page, cy)).toHaveCount(0);
    await page.getByLabel("Show inactive").check();
    await expect(row(page, cy), "removed is removed, not set aside").toHaveCount(0);
    await expect(row(page, bo)).toHaveCount(1);
  });

  await test.step("her handicap record opens beside her", async () => {
    await page.getByRole("button", { name: `Handicap record for ${ada}` }).click();
    // She has entered and not yet played: the record says there is nothing to go on, and why.
    await expect(page.getByText("No approved cards yet. A card counts once the committee has accepted it.")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText(/No approved cards yet/)).toHaveCount(0);
  });

  expect(errors, "a screen threw").toEqual([]);
});

/**
 * MEMBERS WITH THEIR HISTORY, ON ONE SCREEN (R7, behind the redesign switch).
 *
 * In a club of this spec's own the Commissioner adds a member on Members; opens her history in the section under
 * the list (the address `/member` used to be); and, once she has entered a tournament, reads it there after a
 * reload. A player of the same club is then turned away from the screen and never sees her name. The entry is
 * set up with Prisma (the history is read from entries, which Registration makes); the add is the press.
 */
test.describe("@redesign", () => {
  test("a member is added on Members, her history opens under the list and is read again after a reload, and a player is turned away", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one project: the list is a table at desktop width");
    test.setTimeout(240_000);
    const errors: string[] = [];
    const mark = `zz-r7members-${testInfo.project.name}`;
    const theirs = await makeClub(mark);
    const device = testInfo.project.use;
    const desk = await browser.newContext({ ...device, baseURL, storageState: undefined });
    const stranger = await browser.newContext({ ...device, baseURL, storageState: undefined });
    try {
      const { event } = await makeEvent(theirs, "Spring Medal", { stages: [{}], players: 0 });
      await signIn(desk, baseURL!, theirs, event.id);
      const page = await desk.newPage();
      watchPageErrors(page, errors, "commissioner");
      const name = `Ada Quillfeather ${STAMP}`;
      const email = `${mark}-ada@example.invalid`;
      const stored = () => prisma.member.findFirst({ where: { organizationId: theirs.orgId, email } });

      // ── adds her on Members; kept after a reload ──────────────────────────
      await openMembers(page);
      // A new club's first look at Members: an EMPTY list, with the history fold drawn under it.
      await expect(page.getByText(/No members yet/), "the empty list is not said").toBeVisible();
      await page.getByRole("button", { name: "Add member" }).click();
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("Handicap index").fill("12.4");
      await page.getByLabel(/^Email/).fill(email);
      await page.getByRole("button", { name: "Add member" }).click();
      await expect.poll(async () => (await stored())?.name, { timeout: 20_000, message: "the member was not added" }).toBe(name);
      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Members" }).waitFor({ state: "visible" });
      await expect(page.locator("tbody tr").filter({ hasText: name }).first(), "the member is not listed after a reload").toBeVisible();

      // ── her history opens under the list, on the same screen ──────────────
      // The name in the member's own ROW opens it; the history section does not list every name again.
      await page.locator("tbody tr").filter({ hasText: name }).first().getByRole("link", { name }).click();
      await expect(page, "a name in the list did not open that member").toHaveURL(/[?&]member=/);
      let history = await openHistory(page);
      await expect(history.getByText(/has not entered any of the club.s tournaments yet/)).toBeVisible();

      // She enters a tournament (set up directly: the history reads entries), and the screen is read again.
      const member = await stored();
      await prisma.player.create({ data: { eventId: event.id, name, email, handicap: 12.4, seed: 1, status: "confirmed", memberId: member!.id } });
      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Members" }).waitFor({ state: "visible" });
      history = await openHistory(page);
      await expect(history.locator("tbody tr").filter({ hasText: `${mark} Spring Medal` }), "her tournament is not in her history after a reload").toContainText("Played");

      // ── a player of the same club is turned away and never sees her ───────
      const player = await memberSession(event.id, `${mark}-player@example.invalid`, "Pat Player");
      await signInWith(stranger, baseURL!, player.session, event.id);
      const away = await stranger.newPage();
      watchPageErrors(away, errors, "player");
      await away.goto(consoleUrl(`/roster?member=${member!.id}`, "build"));
      await away.locator("h1").first().waitFor({ state: "visible" });
      expect(new URL(away.url()).pathname, "a player was let into the club's members").not.toBe("/roster");
      expect(await away.content(), "a member's name was sent to a player").not.toContain(name);

      expect(errors, "a screen threw").toEqual([]);
    } finally {
      await closeAll(desk, stranger);
      await dropClub(mark);
    }
  });

  test("on every size, a member's name opens her history (open on a phone too), it is read after a reload, and the old /member address lands there", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const mark = `zz-r7history-${testInfo.project.name}`;
    const theirs = await makeClub(mark);
    const device = testInfo.project.use;
    const desk = await browser.newContext({ ...device, baseURL, storageState: undefined });
    try {
      const { event } = await makeEvent(theirs, "Autumn Medal", { stages: [{}], players: 0 });
      const name = `Bea Quillfeather ${STAMP}`;
      // Set-up: the history is read from entries, which Registration makes.
      const member = await prisma.member.create({ data: { organizationId: theirs.orgId, name, email: `${mark}-bea@example.invalid`, handicap: 9.4 } });
      await prisma.player.create({ data: { eventId: event.id, name, email: member.email, handicap: 9.4, seed: 1, status: "confirmed", memberId: member.id } });
      await signIn(desk, baseURL!, theirs, event.id);
      const page = await desk.newPage();
      watchPageErrors(page, errors, "commissioner");

      await openMembers(page);
      const folded = page.locator('section[data-section="history"] button[aria-expanded]').first();
      await expect(folded, "the history section is not on Members").toBeVisible();
      await page.locator("tbody tr").filter({ hasText: name }).first().getByRole("link", { name }).click();
      await expect(page, "the member's name did not open her history").toHaveURL(/[?&]member=/);
      // Opened by the press itself, on a phone too: asserted BEFORE any opener, which would hide a shut fold.
      await expect(
        page.locator('section[data-section="history"] button[aria-expanded]').first(),
        "pressing a name left the history fold shut",
      ).toHaveAttribute("aria-expanded", "true");
      let history = await openHistory(page);
      await expect(history.locator("tbody tr").filter({ hasText: `${mark} Autumn Medal` })).toContainText("Played");

      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Members" }).waitFor({ state: "visible" });
      history = await openHistory(page);
      await expect(history.locator("tbody tr").filter({ hasText: `${mark} Autumn Medal` }), "her history is not read after a reload").toContainText("Played");

      // The old address sends a person to the same place, the preview kept.
      await page.goto(consoleUrl(`/member?member=${member.id}`, "build"));
      await page.getByRole("heading", { level: 1, name: "Member history" }).waitFor({ state: "visible" });
      // The old address still opens (as every old door does) and leads, keeping the member and the preview.
      expect(new URL(page.url()).pathname, "/member stopped opening").toBe("/member");
      await page.locator("main").getByRole("link", { name: "Members", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Members" }).waitFor({ state: "visible" });
      expect(new URL(page.url()).pathname, "the link did not lead to Members").toBe("/roster");
      history = await openHistory(page);
      await expect(history.locator("tbody tr").filter({ hasText: `${mark} Autumn Medal` }), "/member did not open her history").toContainText("Played");

      expect(errors, "a screen threw").toEqual([]);
    } finally {
      await closeAll(desk);
      await dropClub(mark);
    }
  });
});
