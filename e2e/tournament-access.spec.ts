import { createHmac } from "node:crypto";
import { test, expect, closeAll, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { makeClub, dropClub, makeEvent, signIn } from "./rounds-fixture";
import { consoleUrl } from "../src/lib/console-url";
import { openStaffAndAccess, openAccessSection } from "./console/clubSettings";

/**
 * A HELPER IS LET INTO A TOURNAMENT, MOVED DOWN TO A PLAYER, AND SHOWN THE DOOR.
 *
 * Who may open the console is the organizer's to say, on the Access screen:
 * `addAccount`, `setAccountRole`, `removeAccount`. Every one of them is tried
 * by a stranger and refused (`every-action-vs-a-stranger`) — and none was ever
 * performed by the organizer, with the result checked from the OTHER side
 * (round 1 on the frozen app, 2026-10-13). A grant that grants nothing, or a
 * removal that leaves the door open, would both have passed.
 *
 * So the helper has a browser of their own, and after each thing the organizer
 * does, the helper asks for the console's Registration screen — a screen an
 * assistant may open and a player may not:
 *
 *   before anything                        → turned away (the control: holding the
 *                                             right cookies is not being let in)
 *   added as an assistant                  → Registration opens
 *   made a player — asked first            → turned away from the console
 *   made an assistant again                → opens again
 *   access removed — asked first           → turned away, and the row has gone
 *
 * And the organizer cannot shut themselves out: the only organizer is warned
 * that making themselves a player will be refused, and it is.
 *
 * WHAT IT CANNOT SEE: the email an invited person is sent.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const MARK = "zz-access";
const HELPER = { name: `${MARK} Robin Helper`, email: `${MARK}-helper@example.invalid` };
const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

async function sweep() {
  await prisma.account.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}
let helperSession = "";
test.beforeAll(async () => {
  await sweep();
  const user = await prisma.user.create({ data: { email: HELPER.email, name: HELPER.name, password: "x:unusable" } });
  helperSession = sign(signedInNow(user.id));
});
test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

const account = () => prisma.account.findFirst({ where: { eventId: data.eventId, email: HELPER.email } });

/** What the helper gets when they ask for the console's Registration screen: "in", or where they were sent instead. */
async function asks(page: Page): Promise<string> {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const path = new URL(page.url()).pathname;
  if (path !== "/registration") return `sent to ${path}`;
  return (await page.getByRole("heading", { level: 1 }).count()) ? "in" : "a screen with no heading";
}

test("the organizer lets a helper in, makes them a player, lets them back in and removes them — and the helper's own browser agrees each time", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const helper = await browser.newContext({ ...device, baseURL, storageState: undefined });
  await helper.addCookies([
    { name: "ng_session", value: helperSession, url: baseURL! },
    { name: "ng_active_event", value: sign(data.eventId), url: baseURL! },
  ]);
  try {
    const desk = await organizer.newPage();
    const theirs = await helper.newPage();
    watchPageErrors(desk, errors);
    watchPageErrors(theirs, errors);
    const access = async () => {
      await desk.goto(`/access?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
    };
    const row = () => desk.locator("tr", { hasText: HELPER.email });

    // ── holding the cookies is not being let in ─────────────────────────────
    expect(await asks(theirs), "CONTROL: somebody with no access was let into the console").not.toBe("in");

    // ── added as an assistant ───────────────────────────────────────────────
    await access();
    const add = desk.locator(".card", { has: desk.locator(".card-title", { hasText: "Add account" }) }).last();
    await add.getByLabel("Name").fill(HELPER.name);
    await add.getByLabel("Email").fill(HELPER.email);
    await add.locator("label.seg-opt", { hasText: /^\s*Assistant\s*$/ }).click();
    await add.getByRole("button", { name: "Add account" }).click();
    await expect.poll(async () => (await account())?.role, { timeout: 20_000, message: "the helper was not added" }).toBe("assistant");
    expect(await asks(theirs), "an assistant cannot open the console they were just given").toBe("in");

    // ── made a player: asked first ──────────────────────────────────────────
    await access();
    await row().locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).click();
    expect((await account())?.role, "one press changed somebody's role without asking").toBe("assistant");
    await row().getByRole("button", { name: /^Yes — make / }).click();
    await expect.poll(async () => (await account())?.role, { timeout: 20_000, message: "the role was not changed" }).toBe("player");
    expect(await asks(theirs), "somebody made a player can still open the console").not.toBe("in");

    // ── and back ────────────────────────────────────────────────────────────
    await access();
    await row().locator("label.seg-opt", { hasText: /^\s*Assistant\s*$/ }).click();
    await row().getByRole("button", { name: /^Yes — make / }).click();
    await expect.poll(async () => (await account())?.role, { timeout: 20_000 }).toBe("assistant");
    expect(await asks(theirs), "an assistant made one again is still shut out").toBe("in");

    // ── the organizer cannot shut themselves out ────────────────────────────
    await access();
    const admins = await prisma.account.findMany({ where: { eventId: data.eventId, role: "admin" } });
    if (admins.length === 1) {
      const own = desk.locator("tr", { hasText: admins[0].email });
      await own.locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).click();
      // Told before they press, and refused when they do: the screen says which, in words, both times.
      await expect(own, "the only organizer is not warned that this will be refused").toContainText(/This is the only .+ on the event — promote someone else first/);
      await own.getByRole("button", { name: /^Yes — make / }).click();
      await expect(desk.getByText(/This is the only .+ on this event — promote someone else first\./), "the refusal is not said in words").toBeVisible({ timeout: 20_000 });
      expect((await prisma.account.findFirstOrThrow({ where: { id: admins[0].id } })).role, "the only organizer was made a player").toBe("admin");
    }

    // ── removed: asked first ────────────────────────────────────────────────
    await access();
    await row().getByRole("button", { name: `Remove ${HELPER.name}'s access` }).click();
    expect(await account(), "one press removed somebody's access without asking").not.toBeNull();
    await row().getByRole("button", { name: "Remove access" }).click();
    await expect.poll(account, { timeout: 20_000, message: "the access was not removed" }).toBeNull();
    expect(await asks(theirs), "somebody whose access was removed can still open the console").not.toBe("in");
    await access();
    await expect(row(), "a removed helper is still listed").toHaveCount(0);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await closeAll(organizer, helper);
  }
});

/**
 * THE SAME HELPERS, ON CLUB SETTINGS' "ON THIS EVENT" (R7, behind the redesign switch).
 *
 * The secretary of a club of this spec's own moves a helper down to a player and removes them, each asked first
 * and each seen after a reload of the screen; and the only organizer of the tournament is refused, in words,
 * beside the button they pressed. The helper's own browser agrees: Registration opens or is shut. The three
 * writes are the ones `addAccount`, `setAccountRole` and `removeAccount` make; nothing here is a new action.
 */
test.describe("@redesign", () => {
  test("on 'On this event' a helper is moved down and removed, each asked first and kept after a reload, and the only organizer is refused in words", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const mark = `zz-r7helpers-${testInfo.project.name}`;
    const club = await makeClub(mark);
    const device = testInfo.project.use;
    const secretary = await browser.newContext({ ...device, baseURL, storageState: undefined });
    const helper = await browser.newContext({ ...device, baseURL, storageState: undefined });
    try {
      const { event } = await makeEvent(club, "Spring Medal", { stages: [{}] });
      const helperEmail = `${mark}-helper@example.invalid`;
      const helperName = "Robin Helper";
      const helperUser = await prisma.user.create({ data: { email: helperEmail, name: helperName, password: "x:unusable", emailVerifiedAt: new Date() } });
      // Set-up, not the thing under test: the helper is already an assistant, and the secretary is the tournament's one Admin.
      await prisma.account.create({ data: { eventId: event.id, email: helperEmail, name: helperName, role: "assistant" } });
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: club.userId } });
      const ownerAccount = await prisma.account.create({ data: { eventId: event.id, email: owner.email, name: owner.name, role: "admin" } });
      await signIn(secretary, baseURL!, club, event.id);
      await helper.addCookies([
        { name: "ng_session", value: sign(signedInNow(helperUser.id)), url: baseURL! },
        { name: "ng_active_event", value: sign(event.id), url: baseURL! },
      ]);
      const desk = await secretary.newPage();
      const theirs = await helper.newPage();
      watchPageErrors(desk, errors, "secretary");
      watchPageErrors(theirs, errors, "helper");
      const account = () => prisma.account.findFirst({ where: { eventId: event.id, email: helperEmail } });
      const registration = async () => {
        await theirs.goto(`/registration?bust=${Date.now()}`);
        await theirs.waitForLoadState("networkidle").catch(() => {});
        return new URL(theirs.url()).pathname;
      };
      /** The screen opened afresh, the section opened if a phone folded it, and the section returned. */
      const events = async () => {
        await openStaffAndAccess(desk);
        return openAccessSection(desk, "event");
      };
      const row = (section: Awaited<ReturnType<typeof events>>, email: string) => section.locator("tr", { hasText: email });

      expect(await registration(), "CONTROL: an assistant cannot open the console").toBe("/registration");

      // ── moved down to a player: asked first ─────────────────────────────
      let section = await events();
      await row(section, helperEmail).locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).click();
      expect((await account())?.role, "one press changed somebody's role without asking").toBe("assistant");
      await row(section, helperEmail).getByRole("button", { name: /^Yes — make / }).click();
      await expect.poll(async () => (await account())?.role, { timeout: 20_000, message: "the role was not changed" }).toBe("player");
      await desk.reload();
      await desk.waitForLoadState("networkidle").catch(() => {});
      await openStaffAndAccess(desk);
      section = await openAccessSection(desk, "event");
      await expect(
        row(section, helperEmail).locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).locator("input"),
        "after a reload the helper is not shown as a player",
      ).toBeChecked();
      expect(await registration(), "somebody made a player can still open the console").not.toBe("/registration");

      // ── the only organizer cannot be moved down: told before, refused after, beside the press ─
      const own = row(section, owner.email);
      await own.locator("label.seg-opt", { hasText: /^\s*Player\s*$/ }).click();
      await expect(own, "the only organizer is not warned that this will be refused").toContainText(/This is the only .+ on the event — promote someone else first/);
      await own.getByRole("button", { name: /^Yes — make / }).click();
      const refusal = section.getByText(/This is the only .+ on this event — promote someone else first\./);
      await expect(refusal, "the refusal is not said in words").toBeVisible({ timeout: 20_000 });
      await expect(refusal, "the refusal is printed where the person who pressed cannot see it").toBeInViewport();
      expect((await prisma.account.findUniqueOrThrow({ where: { id: ownerAccount.id } })).role, "the only organizer was made a player").toBe("admin");

      // ── the old address lands on the same list, the preview kept, the tab chosen, the list drawn once ─
      await desk.goto(consoleUrl("/access", "build"));
      await desk.waitForLoadState("networkidle").catch(() => {});
      // The old address still opens (as every old door does) and says where the list is.
      expect(new URL(desk.url()).pathname, "/access stopped opening").toBe("/access");
      await desk.getByRole("link", { name: /Club settings, under Staff & access/ }).click();
      await desk.waitForLoadState("networkidle").catch(() => {});
      expect(new URL(desk.url()).pathname, "the link did not lead to Club settings").toBe("/organization");
      await expect(desk.getByRole("tab", { name: /^Staff & access\b/ }), "the Staff & access tab is not the one chosen").toHaveAttribute("aria-selected", "true");
      section = await openAccessSection(desk, "event");
      await expect(row(section, helperEmail), "the helper is not listed once on the section /access sends to").toHaveCount(1);

      // ── removed: asked first ────────────────────────────────────────────
      section = await events();
      await row(section, helperEmail).getByRole("button", { name: `Remove ${helperName}'s access` }).click();
      expect(await account(), "one press removed somebody's access without asking").not.toBeNull();
      await row(section, helperEmail).getByRole("button", { name: "Remove access" }).click();
      await expect.poll(account, { timeout: 20_000, message: "the access was not removed" }).toBeNull();
      await desk.reload();
      await desk.waitForLoadState("networkidle").catch(() => {});
      await openStaffAndAccess(desk);
      section = await openAccessSection(desk, "event");
      await expect(row(section, helperEmail), "a removed helper is still listed after a reload").toHaveCount(0);

      expect(errors, "a screen threw").toEqual([]);
    } finally {
      await closeAll(secretary, helper);
      await dropClub(mark);
    }
  });
});
