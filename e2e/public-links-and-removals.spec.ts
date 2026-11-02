import { createHmac } from "node:crypto";
import { test, expect, type Page, type Browser } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A NEW PUBLIC LINK, AND ENTRIES TAKEN OUT IN BULK, AS THE ORGANIZER DOES THEM (2026-10-21).
 *
 * `rotatePublicToken` (both links) and `removeSignups` were performed by no
 * browser test (the reach report).
 *
 *   Entries → New link (sign-up)          → a new address on the screen and stored; the
 *                                           OLD address says "This registration link
 *                                           isn't open" to a stranger, the NEW one opens
 *                                           the entry form
 *   Tournament details → New link (board) → the same for the public leaderboard: the old
 *                                           address is not found, the new one is the board
 *   three entries ticked … two deleted    → the one with no history is gone; the one whose
 *                                           card is in is WITHDRAWN instead and their card
 *                                           kept, and the screen says so beside the press;
 *                                           the third, not ticked, is untouched
 *
 * Its own club, two tournaments and invented entrants, deleted afterwards.
 * WHAT IT CANNOT SEE: a refused new link — only the organizer is shown either
 * button and only the organizer may press it, so the refusal is reachable only
 * by a second organizer's session ending mid-press.
 */

const prisma = new PrismaClient();
const MARK = "zz-public-links";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const rand = () => Math.random().toString(36).slice(2, 10);
const ids = { org: "", entries: "", board: "", user: "", stroke: "", players: {} as Record<string, string> };
const ENTRIES = `${MARK} Spring Open`;
const BOARD = `${MARK} Summer Medal`;
let organizerCookie = "";

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const common = {
    organizationId: org.id,
    shape: "single",
    format: "stroke",
    dates: "",
    course: "Home",
    city: "",
    address: "",
    regDeadline: "",
    customPars: JSON.stringify(new Array(18).fill(4)),
    customYards: JSON.stringify(new Array(18).fill(380)),
    customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
  };
  // Taking entries, with its sign-up link published.
  const entries = await prisma.event.create({
    data: { ...common, name: ENTRIES, status: "registration", registrationOpen: true, registrationToken: `${MARK}-${rand()}`, shareToken: `${MARK}-${rand()}` },
  });
  ids.entries = entries.id;
  ids.stroke = (
    await prisma.stage.create({ data: { eventId: entries.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 18 } })
  ).id;
  // Under way, its board public.
  const board = await prisma.event.create({
    data: { ...common, name: BOARD, status: "live", leaderboardVisibility: "public", shareToken: `${MARK}-${rand()}` },
  });
  ids.board = board.id;
  await prisma.stage.create({ data: { eventId: board.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 18 } });
  await prisma.player.create({ data: { eventId: board.id, name: "Lark Marsh", email: `${MARK}-board@example.invalid`, status: "confirmed", seed: 1, handicap: 4 } });

  const user = await prisma.user.create({ data: { email: `${MARK}-organizer@example.invalid`, name: "Zz Organizer", password: "x:unusable" } });
  for (const eventId of [entries.id, board.id]) {
    await prisma.account.create({ data: { eventId, email: user.email, name: "Zz Organizer", role: "admin" } });
  }
  ids.user = user.id;
  organizerCookie = sign(signedInNow(user.id));
});

test.afterAll(async () => {
  try {
    for (const id of [ids.entries, ids.board]) if (id) await prisma.event.deleteMany({ where: { id } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

async function asOrganizer(page: Page, baseURL: string | undefined, eventId: string) {
  await page.context().addCookies([
    { name: "ng_session", value: organizerCookie, url: baseURL! },
    { name: "ng_active_event", value: sign(eventId), url: baseURL! },
  ]);
}

async function open(page: Page, path: string) {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** A stranger with the address and nothing else. */
async function stranger(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
}

const token = async (eventId: string) =>
  prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationToken: true, shareToken: true } });

test("a new sign-up link: the old address stops working, the new one opens the entry form", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await asOrganizer(page, baseURL, ids.entries);
  const old = (await token(ids.entries)).registrationToken;

  await open(page, "/registration");
  // The box beside "Copy link", which is the address a club sends out.
  const link = page.locator("div:has(> button:has-text('Copy link')) > input[readonly]");
  await expect(link, "the sign-up link is not on the screen").toHaveValue(new RegExp(`/register/${old}$`), { timeout: 30_000 });
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "New link" }).click();

  await expect.poll(async () => (await token(ids.entries)).registrationToken, { message: "the sign-up link was not replaced" }).not.toBe(old);
  const fresh = (await token(ids.entries)).registrationToken;
  expect(fresh, "the new link is empty").not.toBe("");
  await expect(link, "the screen still shows the old link").toHaveValue(new RegExp(`/register/${fresh}$`), { timeout: 20_000 });
  await open(page, "/registration");
  await expect(link, "after a reload the screen shows another link").toHaveValue(new RegExp(`/register/${fresh}$`), { timeout: 20_000 });

  const ctx = await stranger(browser, baseURL);
  try {
    const p = await ctx.newPage();
    watchPageErrors(p, errors, "stranger");
    await p.goto(`/register/${old}`);
    await expect(p.getByRole("heading", { level: 1 }), "the OLD sign-up link still opens the form").toHaveText(/This registration link isn.t open/);
    await expect(p.getByText(ENTRIES), "the old link names the tournament").toHaveCount(0);
    await p.goto(`/register/${fresh}`);
    await expect(p.getByRole("heading", { level: 1 }), "the NEW sign-up link does not open the form").toHaveText(ENTRIES);
  } finally {
    await ctx.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a new leaderboard link: the old address is not found, the new one is the board", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await asOrganizer(page, baseURL, ids.board);
  const old = (await token(ids.board)).shareToken;

  await open(page, "/event");
  // The board's own link: the screen also shows its event page (/event) and clubhouse screen (?screen=clubhouse).
  const shown = page.locator("code").filter({ hasText: /\/live\/[^/?\s]+$/ });
  await expect(shown, "the leaderboard link is not on the screen").toHaveText(new RegExp(`/live/${old}$`), { timeout: 30_000 });
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "New link" }).click();

  await expect.poll(async () => (await token(ids.board)).shareToken, { message: "the leaderboard link was not replaced" }).not.toBe(old);
  const fresh = (await token(ids.board)).shareToken;
  await expect(shown, "the screen still shows the old leaderboard link").toHaveText(new RegExp(`/live/${fresh}$`), { timeout: 20_000 });

  const ctx = await stranger(browser, baseURL);
  try {
    const p = await ctx.newPage();
    const gone = await p.goto(`/live/${old}`);
    expect(gone?.status(), "the OLD leaderboard link still answers").toBe(404);
    watchPageErrors(p, errors, "stranger");
    const live = await p.goto(`/live/${fresh}`);
    expect(live?.status(), "the NEW leaderboard link does not answer").toBe(200);
    await expect(p.getByText(BOARD).first(), "the new link is not this tournament's board").toBeVisible({ timeout: 20_000 });
  } finally {
    await ctx.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("entries deleted together: the one who has played is withdrawn and keeps their card, and the screen says so", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await asOrganizer(page, baseURL, ids.entries);
  await prisma.player.deleteMany({ where: { eventId: ids.entries } });
  for (const [i, first] of ["Ivy", "Juniper", "Kestrel"].entries()) {
    ids.players[first] = (
      await prisma.player.create({
        data: { eventId: ids.entries, name: `${first} Marsh`, email: `${MARK}-entry-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 6 + i },
      })
    ).id;
  }
  // Juniper's card for the round is already in.
  await prisma.scorecard.create({ data: { eventId: ids.entries, stageId: ids.stroke, playerId: ids.players.Juniper, strokes: JSON.stringify(new Array(18).fill(4)) } });

  await open(page, "/registration");
  await page.getByRole("checkbox", { name: "Select Ivy Marsh" }).check();
  await page.getByRole("checkbox", { name: "Select Juniper Marsh" }).check();
  const remove = page.getByRole("button", { name: "Delete 2 selected" });
  await expect(remove).toBeVisible();
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await remove.click();

  const said = page.getByText("1 player has played, so that entry was withdrawn rather than deleted — their results are kept.");
  await expect(said, "the screen does not say one entry was withdrawn rather than deleted").toBeVisible({ timeout: 20_000 });
  await expect(said, "the sentence is not on screen where Delete was pressed").toBeInViewport();
  expect(asked, "the organizer was not asked before two entries went").toContain("Remove 2 players from this tournament?");

  expect(await prisma.player.findUnique({ where: { id: ids.players.Ivy } }), "an entry with no history was not deleted").toBeNull();
  const juniper = await prisma.player.findUnique({ where: { id: ids.players.Juniper } });
  expect(juniper?.status, "a player who has played was deleted rather than withdrawn").toBe("withdrawn");
  expect(await prisma.scorecard.count({ where: { playerId: ids.players.Juniper } }), "the withdrawn player's card went with them").toBe(1);
  expect((await prisma.player.findUnique({ where: { id: ids.players.Kestrel } }))?.status, "an entry nobody ticked was touched").toBe("confirmed");

  await open(page, "/registration");
  await expect(page.getByRole("checkbox", { name: "Select Kestrel Marsh" }), "the entry nobody ticked is gone from the field").toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("checkbox", { name: "Select Ivy Marsh" }), "a deleted entry is still listed").toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Select Juniper Marsh" }), "a withdrawn player is still listed in the field").toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});
