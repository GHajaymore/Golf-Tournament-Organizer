import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A KNOCKOUT IN FLIGHTS, ADJUSTED BY HAND BEFORE ANYBODY PLAYS (2026-10-21).
 *
 * `reseedFlight` and `clearFlights` were performed by no browser test (the reach
 * report): `organizer-knockout-flights.spec` divides, moves and renames, and
 * never reseeds or starts again. A field of six, divided by handicap into two
 * flights of three — each a bracket of four, so its TOP SEED has the bye.
 *
 *   Seed Briar higher                  → stored order Briar, Alder, Cedar; the list
 *                                        and, after a reload, the draw itself put the
 *                                        bye with Briar now (a seed is what decides it)
 *   a result recorded in another tab,
 *   then a reseed                      → refused, in words, beside the press; the
 *                                        order stored does not move (Committee
 *                                        Procedures 5F(1): the draw is fixed once play
 *                                        in it has begun)
 *   Start again → Undo the flights     → the division is gone, stored and on screen:
 *                                        the field is undivided and offered afresh,
 *                                        and nothing is drawn
 *
 * Its own club, tournament, bracket round and six invented players, deleted
 * afterwards. WHAT IT CANNOT SEE: a field fed by a qualifying round (straight
 * knockout here), and "Draw again" on a random division.
 */

const prisma = new PrismaClient();
const MARK = "zz-flights-adjust";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
// By handicap: Alder 0 … Fern 10. Entered in another order, so a division read off the entry list differs.
const BY_HANDICAP = ["Alder", "Briar", "Cedar", "Dune", "Elm", "Fern"];
const ENTERED = ["Elm", "Briar", "Fern", "Alder", "Dune", "Cedar"];
const ids = { org: "", event: "", user: "", players: {} as Record<string, string> };
let organizerCookie = "";

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Club Knockout`,
      status: "draft",
      shape: "knockout",
      format: "match",
      bracketMode: "flights",
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
  await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", scoringBasis: "gross", holes: 18 } });
  for (const [i, first] of ENTERED.entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${first} Marsh`,
        email: `${MARK}-${i}@example.invalid`,
        status: "confirmed",
        seed: i + 1,
        handicap: BY_HANDICAP.indexOf(first) * 2,
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

/** The flights as stored: each flight's players, by first name, in seed order. */
async function storedFlights(): Promise<string[][] | null> {
  const e = await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { bracketDraw: true } });
  if (!e.bracketDraw) return null;
  const byId = new Map(Object.entries(ids.players).map(([first, id]) => [id, first]));
  const plan = JSON.parse(e.bracketDraw) as { flights: { playerIds: string[] }[] };
  return plan.flights.map((f) => f.playerIds.map((id) => byId.get(id) ?? id));
}

async function open(page: Page) {
  await page.goto(`/bracket?view=draw&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** One flight's card in the flights panel, by the name on it. */
const flightCard = (page: Page, name: string) => page.locator("details").filter({ has: page.locator("summary", { hasText: name }) });

/** Every test starts from a field nobody has divided, and divides it the way the secretary would. */
async function divided(page: Page) {
  await prisma.bracketWinner.deleteMany({ where: { eventId: ids.event } });
  await prisma.event.update({ where: { id: ids.event }, data: { bracketDraw: "" } });
  await open(page);
  await expect(page.getByRole("heading", { name: "Divide the field of 6" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Your own sizes" }).check();
  await page.getByLabel("Players in each flight, top flight first, separated by commas").fill("3, 3");
  await expect(page.getByText("2 flights, 6 players.")).toBeVisible();
  await page.getByRole("button", { name: "Divide the field" }).click();
  await expect(page.getByRole("heading", { name: "2 flights · by handicap" })).toBeVisible({ timeout: 20_000 });
  expect(await storedFlights(), "the field was not divided by handicap").toEqual([
    ["Alder", "Briar", "Cedar"],
    ["Dune", "Elm", "Fern"],
  ]);
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([
    { name: "ng_session", value: organizerCookie, url: baseURL! },
    { name: "ng_active_event", value: sign(ids.event), url: baseURL! },
  ]);
});

test("a flight reseeded by hand is stored in that order, and the bye goes with the new top seed", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await divided(page);

  const top = flightCard(page, "Championship flight");
  await top.locator("summary").click();
  await top.getByRole("button", { name: "Seed Briar Marsh higher" }).click();
  await expect(top.locator("ol > li"), "the list is not in the new order").toHaveText([/Briar Marsh/, /Alder Marsh/, /Cedar Marsh/], { timeout: 20_000 });
  await expect.poll(storedFlights, { message: "the new seeding was not stored" }).toEqual([
    ["Briar", "Alder", "Cedar"],
    ["Dune", "Elm", "Fern"],
  ]);

  await open(page);
  const after = flightCard(page, "Championship flight");
  await after.locator("summary").click();
  await expect(after.locator("ol > li"), "after a reload the seeding is not kept").toHaveText([/Briar Marsh/, /Alder Marsh/, /Cedar Marsh/]);
  // A flight of three is a bracket of four: its top seed has the bye — Briar now, not Alder.
  // A bye is not drawn as a tie (the panel, 2026-10-23): the seed starts in the final with
  // "bye" under the name, and seed 1 beside it.
  await page.locator(".seg").getByText("Championship flight", { exact: true }).click();
  const text = await page.locator("main").innerText();
  const drawn = text.slice(text.indexOf("Bracket manager"));
  expect(drawn, `the bye did not go with the new top seed:\n${drawn}`).toMatch(/Briar Marsh\s+bye\s+1/);
  expect(drawn, `the old top seed kept the bye:\n${drawn}`).not.toMatch(/Alder Marsh\s+bye/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a reseed after a result is recorded is refused beside the press, and the order does not move", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await divided(page);
  const top = flightCard(page, "Championship flight");
  await top.locator("summary").click();

  // From the bracket in another tab meanwhile: Briar beats Cedar in the Championship flight's semi-final.
  await prisma.bracketWinner.create({ data: { eventId: ids.event, key: "winners-0-1", winnerId: ids.players.Briar, result: "2&1" } });

  await top.getByRole("button", { name: "Seed Cedar Marsh higher" }).click();
  const refused = page.getByText("This knockout has results, so its flights are fixed. Clear the results to change them.");
  await expect(refused, "the refusal was not said").toBeVisible({ timeout: 20_000 });
  await expect(refused, "the refusal is not on screen where the seed was pressed").toBeInViewport();
  expect(await storedFlights(), "a refused reseed changed the draw").toEqual([
    ["Alder", "Briar", "Cedar"],
    ["Dune", "Elm", "Fern"],
  ]);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Start again undoes the division: the field is undivided, stored and on screen, and nothing is drawn", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await divided(page);

  await page.getByRole("button", { name: "Start again" }).click();
  await expect(page.getByText("Nobody has played, so nothing is lost.")).toBeVisible();
  await page.getByRole("button", { name: "Undo the flights" }).click();
  await expect(page.getByRole("heading", { name: "Divide the field of 6" }), "the screen still shows the flights").toBeVisible({ timeout: 20_000 });
  await expect.poll(storedFlights, { message: "the division is still stored" }).toBeNull();

  await open(page);
  await expect(page.getByRole("heading", { name: "Divide the field of 6" }), "after a reload the field is divided again").toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Nothing is drawn until the field is divided into flights.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Marsh/ }), "a tie is drawn on an undivided field").toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});
