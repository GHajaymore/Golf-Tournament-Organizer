import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * TEAMS & PAIRS, AS ITS SECRETARY USES IT ON A LIVE FOUR-BALL (2026-10-20).
 *
 * `renameTeam`, `removeTeamMember`, `deleteTeam` and `generateTeamMatches` were
 * performed by no browser test (the reach report of round G209). Each changes a
 * side in a round that already has cards on it, which is the state a club is
 * in on the day:
 *
 *   setup locked                → nothing on the screen changes a side; Unlock setup
 *   Generate matches            → NOT OFFERED on a stroke-play four-ball. It was,
 *                                 and it made matches nobody plays: Score entry
 *                                 then keyed every card by its match, so the
 *                                 round's returned cards read as blank
 *   rename a side               → kept on reload, and the round's board calls it that
 *   take out a player with a card → ASKED first, against that player; then out,
 *                                 the side "Needs 1 more", and its score stops
 *                                 counting the card; put back, the board is as it was
 *   remove a side with scores   → refused, said where the press was
 *   add a side and remove it    → gone
 *
 * WHAT IT CANNOT SEE: a greensomes or scramble split (`setStageAllowanceWeights`)
 * — the seeded club has no such round; and a round robin of sides, where
 * Generate matches IS the job — the seeded club has none of those either, so
 * the offer is pinned by its absence here and by `teams-generate.test.ts`.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const WALKED = ["desktop", "phone"];

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (!WALKED.includes(testInfo.project.name)) return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (WALKED.includes(testInfo.project.name)) await teardown();
  await prisma.$disconnect();
});

test("a secretary renames a side, takes a player out and puts them back, and is refused what would lose cards — on a live four-ball", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third seeding of the club proves nothing more");
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");

  const ev = club.events.find((e) => e.slug === "fourball")!;
  const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: ev.id, position: 0 } });
  expect(stage.type, "the seeded four-ball is not a stroke-play round").toBe("Stroke Play Round");
  expect((await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).configUnlocked, "setup is already unlocked").toBe(false);
  const side = await prisma.team.findFirstOrThrow({
    where: { stageId: stage.id },
    orderBy: { seed: "asc" },
    include: { members: { orderBy: { position: "asc" }, include: { player: true } } },
  });
  const out = side.members[1].player;
  // CONTROL: the player taken out has a card on this side, or "asked first" proves nothing.
  expect(await prisma.teamScorecard.count({ where: { teamId: side.id, playerId: out.id } }), `${out.name} has no card`).toBeGreaterThan(0);

  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(ev.id), url: baseURL! },
  ]);
  const teamsPath = `/teams?round=${stage.id}`;
  const open = async (path: string) => {
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
  };
  /** The side's net on the round's board, read by its row. */
  const boardNet = async (name: string) => {
    await open(`/leaderboard?round=${stage.id}`);
    const table = page.locator("main table", { has: page.locator("th", { hasText: /^net$/i }) }).first();
    const heads = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim().toLowerCase());
    const row = table.locator("tbody tr", { hasText: name }).first();
    await expect(row, `${name} is not on the round's board`).toBeVisible();
    const cells = await row.locator("td, th").allInnerTexts();
    return cells[heads.indexOf("net")].trim().split("\n")[0];
  };
  const before = await boardNet(side.name);

  await open(teamsPath);
  // Generate matches is not a thing a stroke-play round has.
  await expect(page.getByRole("button", { name: /Draw sides automatically/ }), "the sides' toolbar did not draw").toBeVisible();
  await expect(page.getByRole("button", { name: /Generate matches|Regenerate matches/ })).toHaveCount(0);

  // Locked: the name box is there and nothing on the side can be pressed.
  await expect(page.getByRole("button", { name: `Remove ${out.name}` })).toBeDisabled();
  await page.getByRole("button", { name: /^Unlock setup$/ }).first().click();
  await expect
    .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).configUnlocked, { message: "Unlock setup stored nothing" })
    .toBe(true);
  await open(teamsPath);

  // ── rename, kept, and the board says it ─────────────────────────────────────
  const renamed = "The Early Birds";
  const nameBox = page.getByRole("textbox", { name: `Name of ${side.name}` });
  await nameBox.fill(renamed);
  await nameBox.press("Enter");
  await expect.poll(async () => (await prisma.team.findUniqueOrThrow({ where: { id: side.id } })).name, { message: "the new name was not stored" }).toBe(renamed);
  await open(teamsPath);
  await expect(page.getByRole("textbox", { name: `Name of ${renamed}` })).toHaveValue(renamed);
  expect(await boardNet(renamed), "renaming a side changed its score").toBe(before);

  // ── a player with a card: asked first, against them ───────────────────────
  await open(teamsPath);
  await page.getByRole("button", { name: `Remove ${out.name}` }).click();
  const asked = page.getByText(`${out.name} has already returned a card for this side.`);
  await expect(asked).toBeVisible({ timeout: 20_000 });
  await expect(asked, "the question is not on screen where the press was").toBeInViewport();
  await page.getByRole("button", { name: "Remove them anyway" }).click();
  await expect(page.getByRole("button", { name: `Remove ${out.name}` })).toHaveCount(0, { timeout: 20_000 });
  const card = page.locator("main .card", { has: page.getByRole("textbox", { name: `Name of ${renamed}` }) });
  await expect(card).toContainText("Needs 1 more.");
  const without = await boardNet(renamed);
  expect(without, `${renamed}'s score still counts ${out.name}'s card`).not.toBe(before);

  // …and put back, the card counts again.
  await open(teamsPath);
  await card.getByRole("button", { name: "Add player" }).click();
  await page.getByRole("combobox", { name: `Add a player to ${renamed}` }).selectOption(out.id);
  await expect(page.getByRole("button", { name: `Remove ${out.name}` })).toBeVisible({ timeout: 20_000 });
  expect(await boardNet(renamed), `putting ${out.name} back did not restore the side's score`).toBe(before);

  // ── a side with scores cannot be removed, and says so where it was pressed ──
  await open(teamsPath);
  await card.getByRole("button", { name: "Remove team" }).click();
  await card.getByRole("button", { name: "Remove the team" }).click();
  const refused = page.getByText("This team has scores recorded. Clear them before removing the team.");
  await expect(refused).toBeVisible({ timeout: 20_000 });
  await expect(refused, "the refusal is not on screen where the press was").toBeInViewport();
  expect(await prisma.team.count({ where: { id: side.id } }), "a side with scores was removed").toBe(1);

  // ── a side with nothing on it comes and goes ───────────────────────────────
  await open(teamsPath);
  await page.getByLabel("Add a team").fill("Spare Side");
  await page.getByRole("button", { name: "Add team" }).click();
  const spare = page.locator("main .card", { has: page.getByRole("textbox", { name: "Name of Spare Side" }) });
  await expect(spare).toBeVisible({ timeout: 20_000 });
  await spare.getByRole("button", { name: "Remove team" }).click();
  await spare.getByRole("button", { name: "Remove the team" }).click();
  await expect(page.getByRole("textbox", { name: "Name of Spare Side" })).toHaveCount(0, { timeout: 20_000 });

  expect(errors, errors.join("\n")).toEqual([]);
});
