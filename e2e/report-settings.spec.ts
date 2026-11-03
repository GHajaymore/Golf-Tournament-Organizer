import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { MARK } from "./fixture.mjs";
import { seedRich, teardownRich, setWithheld, setReportSettings } from "./report-rich-fixture.mjs";

/**
 * THE REPORT'S SETTINGS AND A WITHHELD NAME, AS A CLUB AND A VISITOR MEET THEM
 * (2026-10-24).
 *
 *   a withheld name   every signed-out page of the tournament — the public
 *                     board, the public report, the link's title and news
 *                     line — is read for the player's name, whole and as the
 *                     ladder shortens it; with the flag off (the control) the
 *                     same sweep finds it
 *   players only      a visitor reads one sentence and a way in, never a
 *                     padlock or "closed"; the share card's words go
 *   the organizer     reads the settings as one line, changes them with
 *                     Change, and sees the copy the public gets
 *
 * What it cannot see: who sees AMOUNTS under each setting — that is
 * `the-report-settings.audit.test.ts`, against the database.
 */

const RUN = `${MARK}-settings`;
type Seeded = Awaited<ReturnType<typeof seedRich>>;
let seeded: Seeded;

test.beforeAll(async () => {
  seeded = await seedRich(RUN);
});
test.afterAll(async () => {
  await teardownRich(RUN);
});

/** Every signed-out page of a tournament, as text — the page and its head. */
async function signedOutText(page: Page, token: string): Promise<string> {
  const out: string[] = [];
  for (const path of [`/live/${token}`, `/live/${token}/report`]) {
    const res = await page.request.get(`${path}?bust=${Date.now()}`);
    expect(res.status(), path).toBe(200);
    out.push(await res.text());
  }
  return out.join("\n");
}

test("a withheld name is on no signed-out page of the tournament; with the flag off it is", async ({ page }) => {
  const { shareToken } = seeded.events.championship;
  const winner = "Ailsa Thorne";
  const forms = [winner, "Ailsa T."];
  // The control: before the flag, the sweep finds her on the board and in the report.
  const before = await signedOutText(page, shareToken);
  for (const f of forms) expect(before, f).toContain(f);

  const ailsa = seeded.events.championship.players.find((p: { name: string }) => p.name === winner)!;
  await setWithheld(ailsa.id, true);
  try {
    const after = await signedOutText(page, shareToken);
    for (const f of forms) expect(after, f).not.toContain(f);
    expect(after).toContain("Player (name withheld)");
  } finally {
    await setWithheld(ailsa.id, false);
  }
});

test("a report for the players: a visitor reads one sentence and the way in, and no name", async ({ page }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const { eventId, shareToken } = seeded.events.medal;
  await setReportSettings(eventId, { reportVisibility: "players" });
  try {
    await page.goto(`/live/${shareToken}/report?bust=${Date.now()}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("This report is shared with the players in this tournament.");
    await expect(main.getByRole("link", { name: "go to tourneyhq.club/play" })).toHaveAttribute("href", "/play");
    const text = await main.innerText();
    expect(text).not.toMatch(/closed|private|locked/i);
    expect(text).not.toContain("Ailsa");
    // The link's head names nobody either.
    const head = await (await page.request.get(`/live/${shareToken}/report`)).text();
    expect(head).not.toContain("Spring Medal");
  } finally {
    await setReportSettings(eventId, { reportVisibility: "board" });
  }
  expect(errors).toEqual([]);
});

test("the organizer reads the settings as one line, changes them, and sees the public's copy", async ({ page, baseURL }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const { organizer, eventId } = seeded.events.stableford;
  await page.context().addCookies([
    { name: "ng_session", value: organizer.session, url: baseURL! },
    { name: "ng_active_event", value: organizer.event, url: baseURL! },
  ]);
  try {
    await page.goto(`/reports/final?bust=${Date.now()}`);
    const line = page.locator("[data-report-settings-line]");
    await expect(line).toHaveText("Anyone with the board link can see this report · Side-game amounts: players only");
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("radio", { name: "Players in this tournament" }).check();
    await expect(page.getByText("The WhatsApp and Facebook share card is off")).toBeVisible();
    await page.getByRole("radio", { name: "Nobody sees amounts — winners only" }).check();
    await page.getByRole("button", { name: "Save report settings" }).click();
    await expect(line).toHaveText("Only the players in this tournament can see this report · Side-game amounts: nobody — winners only");
    // Kept: a reload reads it back.
    await page.reload();
    await expect(line).toHaveText("Only the players in this tournament can see this report · Side-game amounts: nobody — winners only");
    await page.getByRole("link", { name: "See it as the public does" }).click();
    await expect(page.getByText("This report is shared with the players in this tournament.")).toBeVisible();
  } finally {
    await setReportSettings(eventId, { reportVisibility: "board", reportAmounts: "players" });
  }
  expect(errors).toEqual([]);
});
