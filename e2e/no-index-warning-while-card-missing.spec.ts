import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, CARD_PARS } from "./rounds-fixture";

/**
 * A PLAYER WITH NO HANDICAP INDEX IN A NET ROUND: THE ORGANIZER IS TOLD AT LAUNCH, WHATEVER ELSE OF
 * ROUNDS & FORMATS IS STILL OPEN (lane N PR A, #1144; state machine PR 9a, #1156).
 *
 * As the secretary would meet it. A net medal, four entered, one of them with no handicap index
 * (`handicapSource: "none"`), and the round's course card not yet added:
 *
 *   1. WHILE THE CARD IS MISSING — the Rounds & formats step holds. Launch is refused where it stands, with
 *      the reason and the way out, and no launch dialog opens (a refusal, not a warning). Pressed anyway,
 *      nothing opens and the tournament stays a draft.
 *   2. THE CARD IS ADDED — Launch is offered. The dialog's "Still open" block names the player with no index
 *      FIRST, in the words the Rules-minded organizer needs ("scored as a scratch golfer (handicap index 0)"),
 *      with the way to Give strokes, and says it can be done after launch. A warning, never a refusal.
 *   3. THE CARD GOES AGAIN — the hold returns and the warning is not drawn; the card back, it is drawn
 *      first again. (The row must come from the machine each time, not from what an earlier press saw.)
 *
 * WHAT THIS PINS, AND WHAT IT CANNOT SEE. Before 9a the machine filtered this row out of its warnings
 * whenever a step on /stages held (a missing card is exactly that). The dialog only opens when launch is
 * offered, so a held step shows no dialog at all — the dropped row is not drawn anywhere in the browser in
 * state 1, before or after 9a. This walk therefore proves the PEOPLE'S side of the finding: no dialog is
 * offered while the card is missing, and the moment it is offered the warning is first. The row
 * itself surviving the hold is held by `no-index-in-a-net-round.audit.test.ts` ("launchDialog" cases, which
 * read the machine's own warnings with the card missing).
 *
 * Marked zz-, one club, deleted afterwards.
 */

const WALKED = ["desktop"];
const SAYS =
  "1 player has no handicap index and Round 1 is scored net. Until you give them strokes they are scored as a scratch golfer (handicap index 0).";
const STROKE_INDEX = JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1));

test.describe.configure({ timeout: 150_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("no index in a net round: no dialog while the card is missing, the warning first once Launch is offered", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked once, at laptop size");
  const mark = `zz-noidxcard-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await dropClub(mark);
  const club = await makeClub(mark);
  try {
    const { event, players } = await makeEvent(club, "Spring Medal", {
      status: "draft",
      configUnlocked: true,
      stages: [{ playedOn: "2099-06-12", scoringBasis: "net" }],
      players: 4,
      // No card on the event: the round has no par and stroke index to score against. Money answered and a
      // tee sheet saved, so the only warning left to show is the one under test.
      event: { dates: "Jun 12", moneyMode: "none", customPars: "", customStrokeIndex: "", customYards: JSON.stringify(new Array(18).fill(380)) },
    });
    await prisma.stage.updateMany({ where: { eventId: event.id }, data: { teeSheet: JSON.stringify({ groups: [] }) } });
    await prisma.player.update({ where: { id: players[0].id }, data: { handicap: 0, handicapSource: "none" } });
    await signIn(context, baseURL!, club, event.id);

    const setCard = (on: boolean) =>
      prisma.event.update({
        where: { id: event.id },
        data: on ? { customPars: JSON.stringify(CARD_PARS), customStrokeIndex: STROKE_INDEX } : { customPars: "", customStrokeIndex: "" },
      });

    // 1. The card is missing: refused in place, no dialog.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const refused = page.locator(".refused-action").filter({ hasText: "Launch tournament" });
    await expect(refused, "Launch was not refused while the round's card is missing").toBeVisible({ timeout: 30_000 });
    await expect(refused).toContainText("course card");
    await refused.getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("dialog"), "a launch dialog opened on a refused launch").toHaveCount(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status, "a refused launch changed the tournament").toBe("draft");

    // 2. The card is added: Launch is offered and the warning is the dialog's first row.
    await setCard(true);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const launch = page.getByRole("button", { name: "Launch tournament" }).first();
    await expect(launch, "Launch tournament is not offered once the card is there").toBeEnabled({ timeout: 30_000 });
    await launch.click();
    const open = page.getByRole("dialog").getByRole("region", { name: "Still open" });
    await expect(open, "the launch dialog does not name the player with no index").toBeVisible({ timeout: 15_000 });
    const first = open.getByRole("listitem").first();
    await expect(first, "the no-index warning is not the first row").toContainText(SAYS);
    await expect(first.getByRole("link", { name: /Give strokes/ })).toHaveAttribute("href", "/stages");
    await expect(first).toContainText("you can still do this after launch");
    await page.keyboard.press("Escape");

    // 3. The card goes again: the hold returns and no dialog is offered; back, the warning is first again.
    await setCard(false);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(page.locator(".refused-action").filter({ hasText: "Launch tournament" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SAYS), "the warning was drawn while launch was refused").toHaveCount(0);
    await setCard(true);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.getByRole("button", { name: "Launch tournament" }).first().click();
    await expect(page.getByRole("dialog").getByRole("region", { name: "Still open" }).getByRole("listitem").first()).toContainText(SAYS, { timeout: 15_000 });

    expect(errors).toEqual([]);
  } finally {
    await dropClub(mark).catch(() => {});
  }
});
