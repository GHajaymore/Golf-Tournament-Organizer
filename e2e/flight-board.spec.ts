import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A HAND-BUILT DRAW ON THE FLIGHTS SCREEN, AS THE SECRETARY BUILDS IT (2026-10-21).
 *
 * `renameGroup`, `movePlayerToGroup` and `setFlightsConfirmed` were performed by
 * no browser test (the reach report). They are the manual formation rule's own
 * board on /grouping: two flights of four in a round robin, one match already
 * played in the first.
 *
 *   rename Flight A "Championship"       → stored, and the board says it after a reload
 *   rename it to nothing                 → refused beside the board, nothing stored
 *   move Cedar to Flight B by the menu   → asked first (a match has been scored);
 *                                          "Move anyway" puts her in B, still in the
 *                                          field, re-drawn against B's four and against
 *                                          nobody in A — and the match already played in
 *                                          A keeps its result
 *   Confirm flights                      → stored; the board reads "Draw confirmed" and
 *                                          offers nobody a move, also after a reload;
 *                                          Edit flights reopens it
 *   Confirm, after another tab changed the
 *   rule away from Manual                → refused beside the button, nothing stored
 *   rename after another tab launched the
 *   tournament                           → a sentence, not an error page
 *
 * Its own club, tournament, round and eight invented players, deleted afterwards.
 * WHAT IT CANNOT SEE: dragging with a mouse (the menu is the route a phone and a
 * keyboard have, and the drop calls the same action); captains and flight tees.
 */

const prisma = new PrismaClient();
const MARK = "zz-flight-board";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const A_FLIGHT = ["Alder", "Briar", "Cedar", "Dune"];
const B_FLIGHT = ["Elm", "Fern", "Gorse", "Hazel"];
const ids = { org: "", event: "", stage: "", a: "", b: "", user: "", players: {} as Record<string, string> };
let organizerCookie = "";

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Winter Matchplay`,
      status: "draft",
      shape: "single",
      format: "match",
      formationRule: "manual",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  ids.event = event.id;
  ids.stage = (
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18 } })
  ).id;
  ids.a = (await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } })).id;
  ids.b = (await prisma.group.create({ data: { eventId: event.id, name: "B", position: 1 } })).id;
  for (const [i, first] of [...A_FLIGHT, ...B_FLIGHT].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        groupId: i < 4 ? ids.a : ids.b,
        name: `${first} Marsh`,
        email: `${MARK}-${i}@example.invalid`,
        status: "confirmed",
        seed: i + 1,
        handicap: 2 + i * 2,
      },
    });
    ids.players[first] = p.id;
  }
  const user = await prisma.user.create({ data: { email: `${MARK}-secretary@example.invalid`, name: "Zz Secretary", password: "x:unusable" } });
  await prisma.account.create({ data: { eventId: event.id, email: user.email, name: "Zz Secretary", role: "admin" } });
  ids.user = user.id;
  organizerCookie = sign(signedInNow(user.id));
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

/** Alder v Briar, played: two up after two, the next fifteen halved — Alder 2&1. */
const PLAYED = JSON.stringify([...new Array(2).fill("A"), ...new Array(15).fill("H"), null]);

/** Every test starts from the same draw: two flights of four, each a round robin, one match played. */
async function reset() {
  await prisma.event.update({ where: { id: ids.event }, data: { status: "draft", formationRule: "manual", flightsConfirmed: false } });
  await prisma.group.update({ where: { id: ids.a }, data: { name: "A" } });
  await prisma.group.update({ where: { id: ids.b }, data: { name: "B" } });
  for (const [i, first] of [...A_FLIGHT, ...B_FLIGHT].entries()) {
    await prisma.player.update({ where: { id: ids.players[first] }, data: { groupId: i < 4 ? ids.a : ids.b, status: "confirmed" } });
  }
  await prisma.match.deleteMany({ where: { stageId: ids.stage } });
  for (const [flight, names] of [[ids.a, A_FLIGHT], [ids.b, B_FLIGHT]] as const) {
    let round = 1;
    for (let x = 0; x < names.length; x += 1) {
      for (let y = x + 1; y < names.length; y += 1) {
        const played = names[x] === "Alder" && names[y] === "Briar";
        await prisma.match.create({
          data: {
            eventId: ids.event,
            stageId: ids.stage,
            groupId: flight,
            round: round++,
            playerAId: ids.players[names[x]],
            playerBId: ids.players[names[y]],
            holes: played ? PLAYED : JSON.stringify(new Array(18).fill(null)),
          },
        });
      }
    }
  }
}

async function open(page: Page) {
  await page.goto(`/grouping?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1, name: "Flights" })).toBeVisible({ timeout: 30_000 });
}

/** One flight's card on the board, by the name at its head. */
const flightCard = (page: Page, label: string) =>
  page.locator(".flight-board > .card").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) });

test.beforeEach(async ({ page, baseURL }) => {
  await reset();
  await page.context().addCookies([
    { name: "ng_session", value: organizerCookie, url: baseURL! },
    { name: "ng_active_event", value: sign(ids.event), url: baseURL! },
  ]);
});

test("the secretary gives a flight the club's own name; a blank name is refused beside the board", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await open(page);

  await page.getByRole("button", { name: "Rename Flight A" }).click();
  const box = page.getByRole("textbox", { name: "Rename Flight A" });
  await box.fill("Championship");
  await box.press("Enter");
  await expect(flightCard(page, "Championship"), "the board does not show the new name").toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await prisma.group.findUniqueOrThrow({ where: { id: ids.a } })).name, { message: "the name was not stored" }).toBe("Championship");
  await open(page);
  await expect(flightCard(page, "Championship"), "after a reload the board has lost the name").toBeVisible();
  await expect(flightCard(page, "Championship")).toContainText("Alder Marsh");

  await page.getByRole("button", { name: "Rename Championship" }).click();
  const again = page.getByRole("textbox", { name: "Rename Championship" });
  await again.fill("   ");
  await again.press("Enter");
  const refused = page.getByText("Give the flight a name.");
  await expect(refused, "a blank name was not refused in words").toBeVisible({ timeout: 20_000 });
  await expect(refused, "the refusal is not on screen where the name was typed").toBeInViewport();
  expect((await prisma.group.findUniqueOrThrow({ where: { id: ids.a } })).name, "a blank name was stored").toBe("Championship");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a player moved to another flight after a match is played is asked about, stays in the field, and is re-drawn against the new flight", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await open(page);

  await page.getByRole("combobox", { name: "Move Cedar Marsh to another flight" }).selectOption({ label: "Flight B" });
  await expect(page.getByText("1 match has already been scored"), "a move over a played match was not asked about").toBeVisible({ timeout: 20_000 });
  expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.players.Cedar } })).groupId, "she was moved before anybody said yes").toBe(ids.a);
  await page.getByRole("button", { name: "Move anyway" }).click();

  await expect(flightCard(page, "Flight B"), "the board does not show her in Flight B").toContainText("Cedar Marsh", { timeout: 20_000 });
  const cedar = await prisma.player.findUniqueOrThrow({ where: { id: ids.players.Cedar } });
  expect(cedar.groupId, "she is not stored in Flight B").toBe(ids.b);
  expect(cedar.status, "moving a player took her out of the field").toBe("confirmed");

  // Flights decide who plays whom: her matches are now against B's four, and nobody in A.
  const hers = await prisma.match.findMany({
    where: { stageId: ids.stage, OR: [{ playerAId: cedar.id }, { playerBId: cedar.id }] },
    select: { playerAId: true, playerBId: true },
  });
  const opponents = hers.map((m) => (m.playerAId === cedar.id ? m.playerBId : m.playerAId)).sort();
  expect(opponents, "she is not drawn against exactly Flight B's four").toEqual(B_FLIGHT.map((f) => ids.players[f]).sort());
  // And the match already played in A keeps its result.
  const played = await prisma.match.findFirstOrThrow({ where: { stageId: ids.stage, playerAId: ids.players.Alder, playerBId: ids.players.Briar } });
  expect(played.holes, "moving somebody else wiped a played match").toBe(PLAYED);

  await open(page);
  await expect(flightCard(page, "Flight B"), "after a reload she is not in Flight B").toContainText("Cedar Marsh");
  await expect(flightCard(page, "Flight A"), "after a reload she is still in Flight A").not.toContainText("Cedar Marsh");
  await expect(flightCard(page, "Flight B")).toContainText(/^Flight B\s*5 ·/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the secretary confirms the draw, which then offers nobody a move, and reopens it", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await open(page);

  await page.getByRole("button", { name: "Confirm flights" }).click();
  await expect(page.getByText("Draw confirmed. Reopen it to move anyone.")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).flightsConfirmed, { message: "the confirmation was not stored" }).toBe(true);
  await expect(page.getByRole("combobox", { name: /^Move .* to another flight$/ }), "a confirmed draw still offers a move").toHaveCount(0);

  await open(page);
  await expect(page.getByText("Draw confirmed. Reopen it to move anyone."), "after a reload the draw is not confirmed").toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Move .* to another flight$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit flights" }).click();
  await expect(page.getByRole("combobox", { name: "Move Cedar Marsh to another flight" }), "Edit flights did not reopen the draw").toBeVisible({ timeout: 20_000 });
  expect((await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).flightsConfirmed, "reopening was not stored").toBe(false);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Confirm flights after another tab changed the rule away from Manual is refused beside the button", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await open(page);
  // Another tab, meanwhile: the formation rule set to Balanced.
  await prisma.event.update({ where: { id: ids.event }, data: { formationRule: "balanced" } });

  await page.getByRole("button", { name: "Confirm flights" }).click();
  const refused = page.getByText("Only a manual draw is confirmed by hand — the other rules regenerate.");
  await expect(refused, "the refusal was not said").toBeVisible({ timeout: 20_000 });
  await expect(refused, "the refusal is not on screen where Confirm flights was pressed").toBeInViewport();
  expect((await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).flightsConfirmed, "a refused confirmation was stored").toBe(false);
  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * FOUND BY THIS SPEC ON 2026-10-21, AND FIXED: the three board actions THREW on a locked tournament
 * (`assertUnlocked`), and the board awaited them with no catch — so the press replaced the whole
 * screen with "This screen didn't load". They return the refusal now (`lockedRefusal`), and the
 * board says it.
 */
test("a rename after another tab launched the tournament is answered in words, not an error page", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await open(page);
  // Another tab, meanwhile: the tournament launched, which locks setup.
  await prisma.event.update({ where: { id: ids.event }, data: { status: "live" } });

  await page.getByRole("button", { name: "Rename Flight B" }).click();
  const box = page.getByRole("textbox", { name: "Rename Flight B" });
  await box.fill("Handicap");
  await box.press("Enter");
  const refused = page.getByText(/Configuration is locked\. Unlock the tournament/);
  await expect(refused, "a locked tournament's refusal was not said where the name was typed").toBeVisible({ timeout: 20_000 });
  await expect(refused).toBeInViewport();
  await expect(page.getByRole("heading", { level: 1, name: "Flights" }), "the screen was replaced by an error page").toBeVisible();
  expect((await prisma.group.findUniqueOrThrow({ where: { id: ids.b } })).name, "a locked tournament's flight was renamed").toBe("B");
});
