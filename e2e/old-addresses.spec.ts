import { test, expect } from "./coverage";
import { join } from "node:path";
import { watchPageErrors } from "./page-errors";

/**
 * TWO SCREENS MOVED, AND THEIR OLD ADDRESSES STILL TAKE YOU THERE.
 *
 * Every round's verdict said "49 of 51 screens opened; never opened:
 * /qualification, /scoring" (2026-10-13). They are not screens. Match points
 * moved into the round builder and qualification under the draw it seeds, and
 * each address was kept as a forward — for an organizer's bookmark, a link in
 * an old email, and this app's own screenshots. Nothing ever asked for either
 * address, so nothing knew whether the forward still went anywhere.
 *
 *   /scoring         → Rounds & formats, which draws
 *   /qualification   → the draw, which draws
 *   signed out       → the sign-in page, not an error (the control: the forward
 *                      does not let anybody past the door)
 */

const MOVED = [
  { old: "/scoring", now: "/stages" },
  { old: "/qualification", now: "/bracket" },
];

test.describe("as the organizer", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });
  for (const { old, now } of MOVED) {
    test(`${old} forwards to ${now}`, async ({ page }) => {
      const errors: string[] = [];
      watchPageErrors(page, errors);
      const answer = await page.goto(`${old}?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      expect(answer?.status(), `${old} answered with an error`).toBeLessThan(400);
      expect(new URL(page.url()).pathname, `${old} no longer forwards to where the screen went`).toBe(now);
      await expect(page.getByRole("heading", { level: 1 }), `${now} drew no heading`).toHaveCount(1);
      expect(errors, "the screen it forwards to threw").toEqual([]);
    });
  }
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const { old } of MOVED) {
    test(`${old} sends a stranger to sign in`, async ({ page }) => {
      const answer = await page.goto(`${old}?bust=${Date.now()}`);
      expect(answer?.status(), `${old} answered a stranger with an error`).toBeLessThan(400);
      const path = new URL(page.url()).pathname;
      expect(["/stages", "/bracket", old], `a stranger was let through ${old} to ${path}`).not.toContain(path);
    });
  }
});
