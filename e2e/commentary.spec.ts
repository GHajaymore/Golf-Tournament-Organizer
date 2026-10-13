import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A LINE OF COMMENTARY: POSTED, READ BY THE FIELD, AND TAKEN DOWN.
 *
 * Under the organizer's leaderboard is a box: "Post an update, milestone or
 * highlight…". Neither `postCommentary` nor `deleteCommentary` was performed
 * by any browser test (the first measured round, 2026-10-13).
 *
 * WRITING THIS FOUND THE FAULT IT NOW GUARDS. The first draft posted a line
 * and then had to say where to look for it — and there was one place: the
 * organizer's own screen. The public board and a player's Board never read
 * it. A live update that only its author can see. Ajay's ruling: decide; and
 * it is shown (`CommentaryFeed`). So this is the whole of it:
 *
 *   before anything is posted  → neither board has the strip at all (the control)
 *   an empty line              → cannot be posted
 *   a line is posted           → on the organizer's board with who wrote it;
 *                                on a player's Board and the public board
 *                                WITHOUT the name, under "From the …"
 *   more than three exist      → a board shows the latest, and the two before it on one tap
 *   it is taken down           → one press asks, the second does it; and it is
 *                                gone from all three screens
 *
 * NOT DONE HERE: the drafted line ("AjAi draft"). It asks a paid service and is
 * switched off on the plan the fixture is on; the button's own words say so.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; shareToken: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const MARK = "zz-commentary";
const LINE = `${MARK}: birdie at the 9th and the lead changes hands`;
const prisma = new PrismaClient();
const sweep = () => prisma.commentary.deleteMany({ where: { eventId: data.eventId, text: { startsWith: MARK } } });

test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

test("the organizer posts a line; a player and the public board read it, unsigned; and it is taken down everywhere", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  await sweep();
  // CONTROL on the fixture: nobody has said anything yet, so "the strip is absent" below means something.
  expect(await prisma.commentary.count({ where: { eventId: data.eventId } }), "the fixture already carries commentary").toBe(0);

  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const family = await browser.newContext({ ...device, baseURL, storageState: undefined });
  try {
    const page = await organizer.newPage();
    const phone = await member.newPage();
    const board = await family.newPage();
    for (const p of [page, phone, board]) watchPageErrors(p, errors);

    /** The strip on a board the field reads: a section named "From the …". */
    const strip = (p: typeof page) => p.getByRole("region", { name: /^From the / });
    const openPhone = async () => {
      await phone.goto(`/me/board?bust=${Date.now()}`);
      await expect(phone.locator("h1").first()).toBeVisible();
    };
    const openBoard = async () => {
      await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
      await expect(board.locator("h1").first()).toBeVisible();
    };

    // ── before: no strip anywhere ───────────────────────────────────────────
    await openPhone();
    await openBoard();
    await expect(strip(phone), "CONTROL: a player's Board has a commentary strip with nothing said").toHaveCount(0);
    await expect(strip(board), "CONTROL: the public board has a commentary strip with nothing said").toHaveCount(0);

    // ── an empty line cannot be posted ──────────────────────────────────────
    await page.goto(`/leaderboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const box = page.getByLabel("Commentary update");
    const post = page.getByRole("button", { name: "Post", exact: true });
    await expect(post, "an empty line can be posted").toBeDisabled();
    await box.fill("   ");
    await expect(post, "a line of spaces can be posted").toBeDisabled();

    // ── posted ──────────────────────────────────────────────────────────────
    await box.fill(LINE);
    await post.click();
    await expect(page.getByText(LINE, { exact: true }), "the line posted is not on the organizer's board").toBeVisible({ timeout: 20_000 });
    await expect(box, "the box still holds the line after it was posted").toHaveValue("");
    const rows = await prisma.commentary.findMany({ where: { eventId: data.eventId, text: LINE } });
    expect(rows.length, "the line was stored more or fewer times than once").toBe(1);
    expect(rows[0].source, "an organizer's own line is stored as a machine's").toBe("organizer");
    const author = rows[0].author;
    expect(author, "the line does not say who wrote it").toBeTruthy();
    // On the committee's own screen the line and, under it, who wrote it: the two share a parent.
    const mine = page.getByText(LINE, { exact: true }).locator("xpath=..");
    await expect(mine, "the organizer's board does not say who wrote the line").toContainText(author);
    await expect(mine.locator(".tag", { hasText: "AjAi" }), "a line a person wrote is tagged as a machine's").toHaveCount(0);

    // ── the field reads it, and is not told who typed it ────────────────────
    await openPhone();
    await expect(strip(phone), "a player's Board does not show what the committee posted").toBeVisible();
    await expect(strip(phone)).toContainText(LINE);
    await expect(strip(phone), "a player's Board names the committee member who posted").not.toContainText(author);
    await openBoard();
    await expect(strip(board), "the public board does not show what the committee posted").toBeVisible();
    await expect(strip(board)).toContainText(LINE);
    await expect(strip(board), "the public board names the committee member who posted").not.toContainText(author);
    await expect(strip(board), "a line posted seconds ago does not say so").toContainText("just now");

    // ── a board carries the latest three, newest first ──────────────────────
    const hour = 3_600_000;
    await prisma.commentary.createMany({
      data: [1, 2, 3].map((n) => ({ eventId: data.eventId, author, source: "organizer", text: `${MARK}: older line ${n}`, createdAt: new Date(Date.now() - n * hour) })),
    });
    await openBoard();
    // The latest is on the board as it opens; the two before it are one tap away, and the scores stay near the top.
    await expect(strip(board).getByText(LINE, { exact: false }).first(), "the newest line is not the one shown").toBeVisible();
    await expect(strip(board).getByText("older line 1"), "an earlier line is on the board before it was asked for").toBeHidden();
    const earlier = strip(board).locator("summary");
    await expect(earlier, "the board does not say how many earlier updates there are").toHaveText("2 earlier updates");
    await earlier.click();
    const shown = await strip(board).getByRole("listitem").allInnerTexts();
    expect(shown.length, "the board keeps more or fewer than two earlier lines").toBe(2);
    expect(shown[0], "the earlier lines are not newest first").toContain("older line 1");
    expect(shown[1]).toContain("older line 2");
    expect(shown.join("\n"), "the oldest of four is still on the board").not.toContain("older line 3");
    expect(shown[0], "an hour-old line does not say how old it is").toContain("an hour ago");
    await prisma.commentary.deleteMany({ where: { eventId: data.eventId, text: { startsWith: `${MARK}: older line` } } });

    // ── taken down: the first press asks, and nothing has gone yet ──────────
    await page.goto(`/leaderboard?bust=${Date.now()}`);
    const line = page.getByText(LINE, { exact: true }).locator("xpath=../..");
    await line.getByRole("button", { name: "Delete this line" }).click();
    expect(await prisma.commentary.count({ where: { eventId: data.eventId, text: LINE } }), "one press deleted the line without asking").toBe(1);
    await line.getByRole("button", { name: "Delete it" }).click();
    await expect(page.getByText(LINE, { exact: true }), "the line is still on the organizer's board after it was deleted").toHaveCount(0, { timeout: 20_000 });
    expect(await prisma.commentary.count({ where: { eventId: data.eventId, text: LINE } }), "the line is still stored").toBe(0);
    await openPhone();
    await expect(strip(phone), "a player's Board still shows a line that was taken down").toHaveCount(0);
    await openBoard();
    await expect(strip(board), "the public board still shows a line that was taken down").toHaveCount(0);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member, family].map((c) => c.close()));
  }
});
