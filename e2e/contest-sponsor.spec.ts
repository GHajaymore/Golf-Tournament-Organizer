import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A CONTEST'S WINNER AND ITS SPONSOR, ON THE BOARD A CLUB SENDS ITS MEMBERS (2026-10-17).
 *
 * A closest-to-the-pin winner reached nobody but the money ledger. Walked as
 * the two people involved:
 *
 *   the organizer adds a sponsor on Prizes   → a website that is not https is
 *                                               refused in words, beside Save
 *                                             → the sponsor is saved
 *   a spectator opens the public board       → the contest, its winner and
 *                                               "Sponsored by …", and the
 *                                               sponsor thanked at the foot
 *                                             → CONTROL: the poker game, with a
 *                                               winner too, is not on it
 *
 * WHAT IT CANNOT SEE: the printed results, which do not carry contests yet.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as {
  eventId: string;
  shareToken: string;
  partialCard: { stageId: string };
};
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();
const MARK = "zz-sponsor";
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

let kp = "";
let poker = "";
let winner = "";
test.beforeAll(async () => {
  const field = await prisma.player.findMany({ where: { eventId: data.eventId, status: "confirmed" }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true } });
  winner = field[0].name;
  kp = (
    await prisma.contest.create({
      data: { eventId: data.eventId, stageId, kind: "closest-pin", name: `${MARK} KP`, hole: 7, buyInCents: 0, entrants: { create: [{ playerId: field[0].id, won: true }, { playerId: field[1].id }] } },
    })
  ).id;
  poker = (
    await prisma.contest.create({
      data: { eventId: data.eventId, stageId, kind: "off-course", name: `${MARK} poker`, buyInCents: 0, entrants: { create: [{ playerId: field[1].id, won: true }] } },
    })
  ).id;
});
test.afterAll(async () => {
  await prisma.contest.deleteMany({ where: { id: { in: [kp, poker].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("an organizer names a contest's sponsor, and the public board shows the winner and thanks the sponsor", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  // ── the organizer, on Prizes ────────────────────────────────────────────
  await page.goto(`/prizes?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page.locator("div", { has: page.getByText(`${MARK} KP`, { exact: true }) }).filter({ has: page.getByRole("button", { name: /sponsor/i }) }).last();
  await card.getByRole("button", { name: "Add a sponsor" }).click();
  await card.getByLabel("Sponsored by").fill(`${MARK} Motors`);
  await card.getByLabel(/Sponsor.s website/).fill("http://zz-sponsor.example");
  await card.getByRole("button", { name: "Save sponsor" }).click();
  await expect(card.getByRole("alert"), "a plain-http website was not refused beside the press").toContainText("https");
  await card.getByLabel(/Sponsor.s website/).fill("zz-sponsor.example");
  await card.getByRole("button", { name: "Save sponsor" }).click();
  await expect(card.getByText(`${MARK} Motors`), "the sponsor was not saved").toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await prisma.contest.findUniqueOrThrow({ where: { id: kp }, select: { sponsorUrl: true } })).sponsorUrl, { timeout: 20_000 })
    .toBe("https://zz-sponsor.example/");

  // ── a spectator, on the public board ────────────────────────────────────
  const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const board = await visitor.newPage();
    watchPageErrors(board, errors);
    await board.goto(`/live/${data.shareToken}?round=${stageId}&bust=${Date.now()}`);
    const contests = board.getByRole("region", { name: "Contests" });
    await expect(contests, "the public board shows no contests").toBeVisible({ timeout: 20_000 });
    const line = contests.getByRole("listitem").filter({ hasText: `${MARK} KP` });
    await expect(line).toContainText(winner);
    await expect(line).toContainText(`Sponsored by ${MARK} Motors`);
    const link = line.getByRole("link", { name: `${MARK} Motors` });
    await expect(link).toHaveAttribute("href", "https://zz-sponsor.example/");
    await expect(link).toHaveAttribute("rel", "noopener nofollow");
    await expect(contests).toContainText(`Thanks to our sponsors: ${MARK} Motors`);
    // CONTROL: the poker school's winner is nobody's business on the club's board.
    await expect(contests, "an off-course game was put on the public board").not.toContainText(`${MARK} poker`);
  } finally {
    await visitor.close();
  }

  expect(errors, "a screen threw").toEqual([]);
});
