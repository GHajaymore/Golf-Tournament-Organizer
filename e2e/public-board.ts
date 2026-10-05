import { expect, type Page } from "@playwright/test";

/**
 * THE LINK A CLUB SENDS ITS MEMBERS — `/live/<token>` — read as one of them.
 *
 * It is drawn by its own code (`services/live-board.ts`, `LiveBoardView`), not
 * by the console's leaderboard, and CLAUDE.md records it going wrong while the
 * console board beside it was right (the April Medal printing gross under
 * "Ranked by net"). So every organizer walk that produces a board reads this
 * one too, with no cookie at all, the way a member opens it from a text.
 */

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/** On Tournament details: "Who can see the leaderboard" → Anyone with the link. */
export async function makeBoardPublic(page: Page) {
  await open(page, "/event");
  await page.getByRole("radio", { name: /Anyone with the link/ }).check();
  const save = page.getByRole("button", { name: "Save settings" });
  await save.click();
  await expect(save).toHaveCount(0, { timeout: 20_000 });
}

/** The public board's text, opened in a fresh context that holds no session. */
export async function readPublicBoard(page: Page, baseURL: string): Promise<string> {
  await open(page, "/event");
  const link = (await page.locator("code", { hasText: "/live/" }).first().innerText()).trim();
  const path = new URL(link, "http://x").pathname;
  const outsider = await page.context().browser()!.newContext({ baseURL });
  try {
    const pub = await outsider.newPage();
    await pub.goto(`${path}?bust=${Date.now()}`, { waitUntil: "networkidle" });
    expect(new URL(pub.url()).pathname, "the public link did not open the board").toBe(path);
    return await pub.locator("body").innerText();
  } finally {
    await outsider.close();
  }
}
