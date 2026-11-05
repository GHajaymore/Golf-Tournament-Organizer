import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seedDoorsClub, removeDoorsClub, groupLink, type DoorsClub } from "./doors-fixture";

/**
 * THE BOARD FOR SOMEBODY HOLDING A ROUND CODE (2026-11-05): `/play/board`.
 *
 * Until now `/play` offered a board link only where the organizer had made the
 * board public, and `/live/<token>` answers 404 unless it is. A player who scored
 * from a printed sign, in a tournament whose board is for "participants", could not
 * see how the day stood. Walked here for all three visibility settings, as that
 * player (the code, the group, "Yes", the card) and as somebody with no session:
 *
 *   public         `/play` links to the public board; `/play/board` draws the same board
 *   participants   `/play` links to `/play/board`, which draws it; `/live/<token>` is STILL
 *                  a 404 — that is the privacy line, and it is not widened
 *   staff          no link; `/play/board` is a 404 for a code holder
 *   no session     `/play/board` is the code prompt, whatever the setting
 *   opted out      a player who asked not to be shown on public pages is "Player (name
 *                  withheld)" on `/play/board` exactly as on `/live`
 *
 * Its own clubs (`doors-fixture.ts`), one cup session each, deleted afterwards.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const clubs: Record<"public" | "participants" | "staff", DoorsClub | null> = { public: null, participants: null, staff: null };

test.beforeAll(async () => {
  for (const v of ["public", "participants", "staff"] as const) {
    // Ann's entry says "Don't show my name on public pages" in the two clubs that have a board to show.
    clubs[v] = await seedDoorsClub(prisma, `zz-board-${v}`, { visibility: v, rounds: 1, withholdAnn: v !== "staff" });
  }
});
test.afterAll(async () => {
  try {
    for (const v of ["public", "participants", "staff"] as const) await removeDoorsClub(prisma, clubs[v]);
  } finally {
    await prisma.$disconnect();
  }
});

for (const visibility of ["public", "participants", "staff"] as const) {
  test(`${visibility}: what a code holder is given`, async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const club = clubs[visibility]!;
    const r = club.rounds[0];
    const errors: string[] = [];

    // ── a phone with the round code: the group link, "Yes", the card ────────
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    watchPageErrors(page, errors, `a code holder (${visibility})`);
    try {
      await page.goto(groupLink(r.code, r.match));
      await page.getByRole("button", { name: "Yes, that's my group" }).click({ timeout: 30_000 });
      await expect(page.getByRole("group", { name: /^Who won hole/ }).first()).toBeVisible({ timeout: 30_000 });

      // The link on /play.
      const link = page.getByRole("link", { name: "Leaderboard" });
      if (visibility === "staff") {
        await expect(link, "a board kept to staff was offered to a code holder").toHaveCount(0);
      } else {
        await expect(link).toHaveAttribute("href", visibility === "public" ? `/live/${club.token}` : "/play/board");
      }

      // The door itself.
      const res = await page.goto(`/play/board?bust=${Date.now()}`);
      if (visibility === "staff") {
        expect(res?.status(), "/play/board opened for a board kept to staff").toBe(404);
      } else {
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: club.eventName })).toBeVisible({ timeout: 30_000 });
        // The match is on the board, and the player who asked not to be shown is not.
        await expect(page.locator("main")).toContainText("Zz Bea Birch");
        const text = await page.locator("main").innerText();
        expect(text, "a player who opted out of public pages is named on the code holder's board").not.toContain("Zz Ann Ash");
        expect(text).toContain("Player (name withheld)");
      }

      // /live is the privacy line, and answers as it always has: only a public board resolves.
      const live = await page.goto(`/live/${club.token}?bust=${Date.now()}`);
      expect(live?.status(), `/live/<token> for a ${visibility} board`).toBe(visibility === "public" ? 200 : 404);
      if (visibility === "public") {
        const liveText = await page.locator("main").innerText();
        expect(liveText, "the public board names an opted-out player").not.toContain("Zz Ann Ash");
        expect(liveText).toContain("Player (name withheld)");
      }
    } finally {
      await ctx.close();
    }

    // ── a phone with no session: the code prompt, never a board ─────────────
    const none = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const p = await none.newPage();
      watchPageErrors(p, errors, `no session (${visibility})`);
      await p.goto(`/play/board?bust=${Date.now()}`);
      await expect(p.getByLabel("Round code"), "/play/board drew something for a phone with no session").toBeVisible({ timeout: 30_000 });
      expect(new URL(p.url()).pathname).toBe("/play");
      await expect(p.getByRole("heading", { level: 1, name: club.eventName })).toHaveCount(0);
    } finally {
      await none.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
