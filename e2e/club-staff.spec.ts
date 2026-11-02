import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { openSettingsTab } from "./settings-tabs";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * WHO RUNS THE CLUB: SOMEBODY ADDED, MOVED DOWN, MOVED UP, AND REMOVED.
 *
 * A role at the club reaches further than one on a tournament: an Admin is an
 * organizer on EVERY tournament the club runs, without being added to any.
 * `addOrganizationMember` and `removeOrganizationMember` were performed by no
 * browser test (round 1 on the frozen app, 2026-10-13), and the role itself
 * was only ever changed by the control crawl, which flips every radio it finds.
 *
 * Reading the screen to write this found the class the tournament's access
 * screen was fixed for and this one was not: THE ROLE WAS CHANGED BY THE RADIO.
 * One stray tap made a member an organizer everywhere, or a co-organizer a
 * guest, and the only sign was the row redrawing.
 *
 * The person being added has a browser of their own, and after each thing the
 * secretary does they ask for a tournament's Registration screen — which an
 * organizer may open and a member may not:
 *
 *   before anything                     → turned away (the control)
 *   an address that is not one          → refused in words, where the button is
 *   added as an Admin                   → Registration opens. Until they have
 *                                          been back, the list shows the address
 *                                          that was typed and "not opened yet" —
 *                                          not the name on their account, which
 *                                          is theirs, and is NOT changed to the
 *                                          one the secretary typed
 *   …and once they have opened it       → the list shows their own name
 *   Member picked — asked first         → nothing changes until it is confirmed;
 *                                          then they are turned away
 *   Admin picked — asked first          → told what it hands over; then in again
 *   removed — asked first               → turned away, and off the list
 *   the secretary, the only Commissioner → moving themselves down is warned
 *                                          about and then refused, and so is
 *                                          removing themselves — each said where
 *                                          the press was
 *
 * WHAT IT CANNOT SEE: the invitation email, and a plan's limit on staff seats
 * (`a-promotion-takes-a-seat.audit.test.ts` holds that against real rows).
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const MARK = "zz-clubstaff";
const THEIR_NAME = "Morgan Ashdown";
const TYPED_NAME = "Robin Typedname";
const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

let clubId = "";
let secretary = { id: "", email: "" };
/** The seat this spec gives the secretary, to take away again; empty if they already held one. */
let commissionerSeat = "";
let madeTheSeat = false;
const sweep = async () => {
  await prisma.organizationMember.deleteMany({ where: { user: { email: { startsWith: MARK } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
};
test.beforeAll(async () => {
  clubId = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true } })).organizationId!;
  await sweep();
  /**
   * THE SECRETARY IS THE CLUB'S COMMISSIONER, as whoever makes a club through the app is. The
   * fixture's club has nobody at all — a state only a club from before memberships can be in, where
   * the tournament's organizer may manage it UNTIL it has its first member, and is then shut out by
   * the rule that stops one tournament's organizer taking a club. The first draft of this spec added
   * somebody as that secretary and found every control on the screen disabled a moment later.
   * (`docs/deferred-register.md` has what that does to a real ownerless club.)
   */
  const account = await prisma.account.findFirstOrThrow({ where: { eventId: data.eventId, role: "admin" }, select: { email: true } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: account.email }, select: { id: true, email: true } });
  secretary = user;
  const held = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: clubId, userId: user.id } } });
  madeTheSeat = !held;
  commissionerSeat = (held ?? (await prisma.organizationMember.create({ data: { organizationId: clubId, userId: user.id, role: "owner" } }))).id;
});
test.afterAll(async () => {
  if (madeTheSeat && commissionerSeat) await prisma.organizationMember.deleteMany({ where: { id: commissionerSeat } });
  await sweep();
  await prisma.$disconnect();
});

/** What the person gets when they ask for a tournament's Registration screen: "in", or where they were sent instead. */
async function asks(page: Page): Promise<string> {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const path = new URL(page.url()).pathname;
  if (path !== "/registration") return `sent to ${path}`;
  return (await page.getByRole("heading", { level: 1 }).count()) ? "in" : "a screen with no heading";
}

test("the secretary adds somebody to the club, changes their role, removes them, and cannot lose the only Commissioner — and that person's own browser agrees each time", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  // One person per size, so three sizes are three people and none of them meets another's rows.
  const email = `${MARK}-${testInfo.project.name}@example.invalid`;
  const person = await prisma.user.create({ data: { email, name: THEIR_NAME, password: "x:unusable" } });
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const theirs = await browser.newContext({ ...device, baseURL, storageState: undefined });
  // Signed in, and nothing more: which tournament they are in is theirs to open, below.
  await theirs.addCookies([{ name: "ng_session", value: sign(signedInNow(person.id)), url: baseURL! }]);
  const tournament = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { name: true } })).name;
  try {
    const desk = await organizer.newPage();
    const own = await theirs.newPage();
    watchPageErrors(desk, errors, "secretary");
    watchPageErrors(own, errors, "the person added");
    const settings = async () => {
      await desk.goto(`/organization?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      // The club's staff are on their own tab: Club settings shows one section at a time.
      await openSettingsTab(desk, "Staff & access");
    };
    const membership = () => prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: clubId, userId: person.id } } });
    const row = () => desk.locator("tbody tr", { hasText: email }).first();
    const addCard = () => desk.locator(".card", { has: desk.locator(".card-title", { hasText: /^Add staff$/ }) }).last();
    const addAs = async (role: string) => {
      await settings();
      const add = addCard();
      await add.getByLabel("Name").fill(TYPED_NAME);
      await add.getByLabel("Email").fill(email);
      await add.locator("label.seg-opt", { hasText: new RegExp(`^\\s*${role}\\s*$`) }).click();
      await add.getByRole("button", { name: "Add staff" }).click();
    };

    /**
     * The person OPENS the tournament, from the list of what they may open — the way a person
     * arrives. The first draft handed them a cookie that said they were already in it, and the
     * staff list went on saying "not opened yet": rightly, because being drawn a page is not
     * arriving, and the app marks somebody as back only when they open something.
     */
    const arrive = async () => {
      await own.goto(`/choose?bust=${Date.now()}`);
      await own.waitForLoadState("networkidle").catch(() => {});
      const door = own.locator("button", { hasText: tournament }).first();
      if (await door.count()) {
        await door.click();
        await own.waitForLoadState("networkidle").catch(() => {});
      }
    };

    // ── holding a sign-in is not being let in ───────────────────────────────
    await arrive();
    expect(await asks(own), "CONTROL: somebody with no role anywhere was let into the console").not.toBe("in");

    // ── an address that is not one ──────────────────────────────────────────
    await settings();
    const add = addCard();
    await add.getByLabel("Email").fill("not an address");
    await add.getByRole("button", { name: "Add staff" }).click();
    const refusal = desk.getByText("Enter a valid email address.");
    await expect(refusal, "an address that is not one is not refused in words").toBeVisible({ timeout: 20_000 });
    await expect(refusal, "the refusal is printed where the person who pressed Add staff cannot see it").toBeInViewport();
    expect(await prisma.user.count({ where: { email: "not an address" } }), "an account was made for an address that is not one").toBe(0);

    // ── added as an Admin ───────────────────────────────────────────────────
    await addAs("Admin");
    await expect.poll(async () => (await membership())?.role, { timeout: 20_000, message: "the person was not added" }).toBe("admin");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).name, "adding somebody renamed their account to what the secretary typed").toBe(THEIR_NAME);
    await settings();
    await expect(row(), "somebody just added is not marked as not yet back").toContainText("Invited — not opened yet");
    await expect(row(), "the list shows the name on an account its owner has not yet brought here").not.toContainText(THEIR_NAME);
    await arrive();
    expect(await asks(own), "an Admin of the club cannot open one of its tournaments").toBe("in");
    await settings();
    await expect(row(), "somebody who has been back is still shown as not opened yet").not.toContainText("not opened yet");
    await expect(row(), "the list does not show the person's own name once they have been back").toContainText(THEIR_NAME);

    // ── moved down: asked first ─────────────────────────────────────────────
    await row().locator("label.seg-opt", { hasText: /^\s*Member\s*$/ }).click();
    await expect(row(), "picking a role does not ask before it changes one").toContainText(`Change ${THEIR_NAME} from Admin to Member?`);
    expect((await membership())?.role, "one press changed somebody's role at the club without asking").toBe("admin");
    await expect(row()).toContainText(`${THEIR_NAME} loses Admin access.`);
    await row().getByRole("button", { name: `Yes — make ${THEIR_NAME} Member` }).click();
    await expect.poll(async () => (await membership())?.role, { timeout: 20_000, message: "the role was not changed" }).toBe("member");
    expect(await asks(own), "a Member of the club can open the organizer's console").not.toBe("in");

    // ── moved up: asked first, and told what it hands over ──────────────────
    await settings();
    await row().locator("label.seg-opt", { hasText: /^\s*Admin\s*$/ }).click();
    await expect(row(), "making somebody an Admin does not say what that hands over").toContainText(`${THEIR_NAME} becomes an organizer on every tournament this`);
    // Cancelled first: the radios go back, and nothing is changed.
    await row().getByRole("button", { name: "Cancel" }).click();
    await expect(row().locator("label.seg-opt", { hasText: /^\s*Member\s*$/ }).locator("input"), "cancelling did not put the role back on the screen").toBeChecked();
    expect((await membership())?.role, "cancelling changed the role").toBe("member");
    await row().locator("label.seg-opt", { hasText: /^\s*Admin\s*$/ }).click();
    await row().getByRole("button", { name: `Yes — make ${THEIR_NAME} Admin` }).click();
    await expect.poll(async () => (await membership())?.role, { timeout: 20_000, message: "the role was not changed back" }).toBe("admin");
    await arrive();
    expect(await asks(own), "an Admin made one again is still shut out").toBe("in");

    // ── removed: asked first ────────────────────────────────────────────────
    await settings();
    await row().getByTitle("Remove from organization").click();
    expect(await membership(), "one press removed somebody from the club without asking").not.toBeNull();
    await row().getByRole("button", { name: "Remove them" }).click();
    await expect.poll(membership, { timeout: 20_000, message: "the person was not removed" }).toBeNull();
    expect(await asks(own), "somebody removed from the club can still open its tournaments as an organizer").not.toBe("in");
    await settings();
    await expect(row(), "somebody removed is still on the list").toHaveCount(0);

    // ── the only Commissioner is kept ───────────────────────────────────────
    // The secretary themselves: the only one this club has.
    const mine = () => desk.locator("tbody tr", { hasText: secretary.email }).first();
    const seat = () => prisma.organizationMember.findUnique({ where: { id: commissionerSeat } });
    await settings();
    await mine().locator("label.seg-opt", { hasText: /^\s*Admin\s*$/ }).click();
    await expect(mine(), "the only Commissioner is not warned that this will be refused").toContainText("This is the only Commissioner — promote someone else first, or this will be refused.");
    await mine().getByRole("button", { name: /^Yes — make / }).click();
    const kept = desk.getByText("This is the only Commissioner — make someone else a Commissioner first.");
    await expect(kept, "the refusal is not said in words").toBeVisible({ timeout: 20_000 });
    await expect(kept, "the refusal is printed where the person who pressed cannot see it").toBeInViewport();
    expect((await seat())?.role, "the only Commissioner was moved down").toBe("owner");

    await settings();
    await mine().getByTitle("Remove from organization").click();
    await mine().getByRole("button", { name: "Remove them" }).click();
    const stays = desk.getByText("This is the only Commissioner — make someone else a Commissioner before removing them.");
    await expect(stays, "removing the only Commissioner is not refused in words").toBeVisible({ timeout: 20_000 });
    await expect(stays, "the refusal is printed where the person who pressed cannot see it").toBeInViewport();
    expect((await seat())?.role, "the only Commissioner was removed").toBe("owner");

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await prisma.organizationMember.deleteMany({ where: { userId: person.id } });
    await Promise.all([organizer, theirs].map((c) => c.close()));
  }
});
