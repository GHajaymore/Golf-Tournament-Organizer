import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedCutTie, teardownCutTie, roundTwoField } from "./cut-tie-fixture.mjs";

/**
 * A TIE FOR THE LAST PLACE AT A CUT, AS THE SECRETARY SETTLES IT (2026-10-23).
 *
 * Round 1 of a 36-hole medal is in and approved, cut to the top 2, with three
 * players on 72 for the second place — two on identical cards, one with a worse
 * last nine (`cut-tie-fixture.mjs`). In the browser, as the secretary:
 *
 *   1. the default — ties go through — and the cut card says four go on;
 *   2. Play-off chosen on Rounds & formats: the cut card names all three, its
 *      button is held and says why, the board marks them tied, the player in
 *      the tie is not told she is out, and the round 2 tee sheet says it is
 *      waiting; a record of the wrong number is refused in the panel;
 *   3. Countback chosen instead: the worse last nine drops out, the two on
 *      identical cards are left to a draw, which is recorded; the cut is
 *      approved, and round 2's field is the leader and the draw's winner.
 *
 * WHAT IT CANNOT SEE: a tie that a correction CHANGES after it was recorded
 * (the decision stops applying — `a-tie-at-the-cut.test.ts`), a per-flight
 * cut's several ties, and net or nine-hole countbacks, which are worked from
 * the rule on real rows in `a-tie-at-the-cut.audit.test.ts`.
 */
let seeded: Awaited<ReturnType<typeof seedCutTie>>;
test.beforeAll(async () => {
  seeded = await seedCutTie();
});
test.afterAll(async () => {
  await teardownCutTie();
});

test("a tie on the cut line is settled the way the secretary chose, and nobody is out until it is", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const asSecretary = await browser.newContext({ ...device, baseURL });
  const asPlayer = await browser.newContext({ ...device, baseURL });
  await asSecretary.addCookies([{ name: "ng_session", value: seeded.organizer, url: baseURL! }]);
  await asPlayer.addCookies([{ name: "ng_session", value: seeded.player, url: baseURL! }]);
  try {
    const page = await asSecretary.newPage();
    const phone = await asPlayer.newPage();
    watchPageErrors(page, errors, "secretary");
    watchPageErrors(phone, errors, "player");
    const cutCard = page.getByRole("region", { name: "The cut is ready" });
    const tieRule = (p = page) => p.getByRole("radiogroup", { name: /How a tie for the last place in the cut for Round 2 is settled/ });

    const choose = async (label: "Play-off" | "Countback") => {
      expect((await page.goto(`/stages?bust=${Date.now()}`))?.status(), "the secretary is signed in").toBe(200);
      // The segmented control's input is drawn under its label: press the label.
      await tieRule().locator("label", { hasText: label }).click();
      await expect(tieRule().getByRole("radio", { name: label })).toBeChecked();
      await expect(page.getByText("Saved").first()).toBeVisible();
      // Kept: read back from a fresh page.
      await page.goto(`/stages?bust=${Date.now()}`);
      await expect(tieRule().getByRole("radio", { name: label })).toBeChecked();
    };

    await test.step("by default everybody tied goes through, and the cut card says so", async () => {
      expect((await page.goto(`/dashboard?bust=${Date.now()}`))?.status(), "the secretary is signed in").toBe(200);
      await expect(cutCard).toContainText("Top 2 and ties: 4 players go through to Round 2");
      await expect(cutCard.getByRole("button", { name: "Approve the cut" })).toBeEnabled();
    });

    await test.step("a play-off: the cut waits, and says who it waits on", async () => {
      await choose("Play-off");
      await page.goto(`/dashboard?bust=${Date.now()}`);
      const tie = cutCard.getByRole("group", { name: "Tied for the last place" });
      await expect(tie).toContainText("Tamsin Bell, Struan Cowie and Elspeth Drummond are level for the last place");
      await expect(tie.getByRole("checkbox")).toHaveCount(3);
      await expect(cutCard.getByRole("button", { name: "Approve the cut" })).toBeDisabled();
      await expect(cutCard).toContainText("The cut waits on the tie above");

      // The board: the three marked tied, nobody lit as through in their place.
      await page.goto(`/leaderboard?bust=${Date.now()}`);
      await expect(page.getByText("Tied for the last place — play-off to decide")).toHaveCount(3);

      // The player in the tie is told it is a tie, never that she is out.
      expect((await phone.goto(`/me/board?bust=${Date.now()}`))?.status(), "the player is signed in").toBe(200);
      await expect(phone.locator("main")).toContainText("nobody in the tie has missed the cut");
      expect(await phone.locator("main").innerText()).not.toMatch(/missed the cut after/i);

      // The next round's tee sheet says it is waiting, rather than picking.
      await page.goto(`/foursomes?round=${seeded.roundTwo}&bust=${Date.now()}`);
      await expect(page.getByRole("status").filter({ hasText: "The cut is waiting on a tie" })).toContainText(
        "Tamsin Bell, Struan Cowie and Elspeth Drummond are level for the last place",
      );

      // A record of the wrong number is refused where it was pressed.
      await page.goto(`/dashboard?bust=${Date.now()}`);
      await tie.getByLabel("Tamsin Bell").check();
      await tie.getByLabel("Struan Cowie").check();
      await tie.getByRole("button", { name: "Record the play-off" }).click();
      await expect(tie.getByRole("alert")).toContainText("Pick the one player who went through — 2 are ticked.");
      expect(await roundTwoField(seeded.eventId), "nothing was made").toEqual([]);
    });

    await test.step("a countback: the worse last nine drops out, the identical cards are drawn", async () => {
      await choose("Countback");
      await page.goto(`/dashboard?bust=${Date.now()}`);
      const tie = cutCard.getByRole("group", { name: "Tied for the last place" });
      await expect(tie).toContainText("Tamsin Bell and Struan Cowie are level for the last place");
      await expect(tie).toContainText("level on countback too");
      await expect(tie.getByRole("checkbox")).toHaveCount(2);
      await expect(cutCard.getByRole("button", { name: "Approve the cut" })).toBeDisabled();

      await tie.getByLabel("Struan Cowie").check();
      await tie.getByRole("button", { name: "Record the draw" }).click();
      await expect(cutCard.getByRole("group", { name: "Tied for the last place" })).toContainText("The draw for the last place is recorded");
      const approve = cutCard.getByRole("button", { name: "Approve the cut" });
      await expect(approve).toBeEnabled();
      await approve.click();
      await page.getByRole("button", { name: "Make the cut" }).click();
      await expect(cutCard).toHaveCount(0);
    });

    await test.step("the next round's field is the leader and the draw's winner", async () => {
      expect(await roundTwoField(seeded.eventId)).toEqual(["Morven Aird", "Struan Cowie"]);
      await page.goto(`/foursomes?round=${seeded.roundTwo}&bust=${Date.now()}`);
      await expect(page.getByText("The cut is waiting on a tie")).toHaveCount(0);
      // And the player the draw left out is now told so — after it was settled.
      await phone.goto(`/me/board?bust=${Date.now()}`);
      await expect(phone.locator("main")).not.toContainText("nobody in the tie has missed the cut");
    });

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await asSecretary.close();
    await asPlayer.close();
  }
});
