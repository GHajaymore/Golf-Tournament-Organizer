import type { Page } from "@playwright/test";
import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, addDays, dayIn } from "./rounds-fixture";

/**
 * A PLAYER WITH NO HANDICAP INDEX IN A NET ROUND: THE LAUNCH DIALOG NAMES THEM FIRST (lane N PR A, #1144;
 * state machine PR 9a, #1156).
 *
 * As the secretary would meet it: a tournament ready to launch, Launch pressed, and the dialog's "Still open"
 * block read from the top. One of four entered has no handicap index (`handicapSource: "none"`) and Round 1 is
 * scored net, so the organizer needs to hear, FIRST, that they are scored as a scratch golfer until given
 * strokes, with the way to Give strokes, and that it can be done after launch. A warning, never a refusal.
 *
 *   1. A PLAIN NET EVENT: the row is first.
 *   2. A LEAGUE with later weeks that have no day yet: the row is first, ABOVE the later-weeks row. Before 9a
 *      the machine reworded a league's Rounds & formats warning as its later weeks (or skipped it) and the
 *      no-index row went with it, so this case is red on main.
 *   3. THE CONTROL: everybody has an index, so no such row is drawn.
 *
 * WHAT THIS DOES NOT COVER, AND WHY. (a) A round with no course card holds Rounds & formats: Launch is refused
 * in place and the dialog never opens, so a person cannot see a row there; the row surviving the hold is
 * pinned by `no-index-in-a-net-round.audit.test.ts` ("launchDialog" cases). (b) A family with no Rounds &
 * formats step: none can hold a net round. That step is in every flow (`setup-flow.ts`, no `applies`), and
 * the one shape with no flow, a casual round, has no launch dialog.
 *
 * Every locator is scoped to the dialog. Marked zz-, one club per case, deleted afterwards.
 */

const WALKED = ["desktop"];
/**
 * THE DAYS ARE NEAR, ON PURPOSE. The dashboard's one button is the tournament's FIRST job by due day
 * (`tournamentJob`): "Give strokes" is due on the round's day, Launch on the day the tournament starts, and
 * Launch counts as a job only inside the fortnight. So it starts in two days and its round is played in
 * five: Launch comes first and is the button to press.
 */
const STARTS = addDays(dayIn(""), 2);
const PLAYED = addDays(dayIn(""), 5);
const ENDS = addDays(dayIn(""), 20);
const SAYS =
  "1 player has no handicap index and Round 1 is scored net. Until you give them strokes they are scored as a scratch golfer (handicap index 0).";

test.describe.configure({ timeout: 150_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** One draft tournament, four entered, a tee sheet saved and money answered: nothing else to warn of. */
async function ready(
  mark: string,
  name: string,
  stages: { scoringBasis: string; playedOn: string }[],
  opts: { noIndex: boolean; league?: boolean },
) {
  const club = await makeClub(mark);
  const { event, players } = await makeEvent(club, name, {
    status: "draft",
    stages,
    players: 4,
    event: { dates: "Soon", startOn: STARTS, endOn: ENDS, moneyMode: "none", ...(opts.league ? { playKind: "league" } : {}) },
  });
  await prisma.stage.updateMany({ where: { eventId: event.id }, data: { teeSheet: JSON.stringify({ groups: [] }) } });
  if (opts.noIndex) await prisma.player.update({ where: { id: players[0].id }, data: { handicap: 0, handicapSource: "none" } });
  return { club, event };
}

async function openLaunchDialog(page: Page) {
  await page.goto(`/dashboard?bust=${Date.now()}`);
  const launch = page.getByRole("button", { name: "Launch tournament" }).first();
  await expect(launch, "Launch tournament is not offered").toBeEnabled({ timeout: 30_000 });
  await launch.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog, "the launch dialog did not open").toBeVisible({ timeout: 15_000 });
  return dialog;
}

test("a plain net event: the dialog's first row is the player with no index", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked once, at laptop size");
  const mark = `zz-noidxplain-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await dropClub(mark);
  try {
    const { club, event } = await ready(mark, "Spring Medal", [{ scoringBasis: "net", playedOn: PLAYED }], { noIndex: true });
    await signIn(context, baseURL!, club, event.id);
    const dialog = await openLaunchDialog(page);
    const first = dialog.getByRole("region", { name: "Still open" }).getByRole("listitem").first();
    await expect(first, "the no-index warning is not the dialog's first row").toContainText(SAYS);
    await expect(first.getByRole("link", { name: /Give strokes/ })).toHaveAttribute("href", "/stages");
    await expect(first).toContainText("you can still do this after launch");
    expect(errors).toEqual([]);
  } finally {
    await dropClub(mark).catch(() => {});
  }
});

test("a league with later weeks undated: the no-index row is first, above the later-weeks row", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked once, at laptop size");
  const mark = `zz-noidxleague-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await dropClub(mark);
  try {
    // Week 1 is dated and scored net; weeks 2 and 3 have no day yet and are gross, so the round named is Round 1 only.
    const { club, event } = await ready(
      mark,
      "Thursday League",
      [
        { scoringBasis: "net", playedOn: PLAYED },
        { scoringBasis: "gross", playedOn: "" },
        { scoringBasis: "gross", playedOn: "" },
      ],
      { noIndex: true, league: true },
    );
    await signIn(context, baseURL!, club, event.id);
    const dialog = await openLaunchDialog(page);
    const rows = dialog.getByRole("region", { name: "Still open" }).getByRole("listitem");
    await expect(rows.first(), "the no-index warning is not the league dialog's first row").toContainText(SAYS);
    await expect(rows.first().getByRole("link", { name: /Give strokes/ })).toHaveAttribute("href", "/stages");
    await expect(rows.nth(1), "the later weeks row is not second").toContainText("no day or deadline yet");
    expect(errors).toEqual([]);
  } finally {
    await dropClub(mark).catch(() => {});
  }
});

test("control: everybody has an index, so the dialog draws no such row", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked once, at laptop size");
  const mark = `zz-noidxctrl-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await dropClub(mark);
  try {
    const { club, event } = await ready(mark, "Spring Medal", [{ scoringBasis: "net", playedOn: PLAYED }], { noIndex: false });
    await signIn(context, baseURL!, club, event.id);
    const dialog = await openLaunchDialog(page);
    await expect(dialog.getByText("no handicap index"), "a no-index row was drawn though everybody has an index").toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await dropClub(mark).catch(() => {});
  }
});
