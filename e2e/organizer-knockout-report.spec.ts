import { test, expect, type Page, type Browser, type TestInfo } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { playScratch } from "./round-basis";
import { seedOrganizer, teardownOrganizer, medalEmail, memberSession } from "./organizer-fixture.mjs";
import { pressRadio } from "./press-radio";
import { expectLaunched } from "./end-early";
import { statusFixture, prisma } from "./status-fixture";

/**
 * A PLAYER REPORTS THEIR OWN KNOCKOUT TIE, AND THE COMMITTEE APPROVES IT.
 *
 * Ajay's rule of 2026-09-28: "player may enter it but organizer/club needs to
 * approve it". So a report is a REQUEST — it moves nothing on the draw until
 * the organizer says so — and both players can see it is waiting.
 *
 *   draw        seeded on handicap: Alder (1) v Dune (4), Briar (2) v Cedar (3)
 *   Dune        reports from his phone: "I won", 2&1
 *   Alder       sees the report waiting on his own phone
 *   organizer   sees "A result to approve", the draw not yet moved, approves
 *   draw        the semi holds 2&1 and Dune's next tie is the final
 */

type Entrant = { name: string; index: string };
// Entry order, not seed order; Dune is entered first so his address is medalEmail(0).
const FIELD: Entrant[] = [
  { name: "Dune Quayle", index: "20" },
  { name: "Briar Quayle", index: "8" },
  { name: "Cedar Quayle", index: "14" },
  { name: "Alder Quayle", index: "0" },
];
const TOURNAMENT = "Club Knockout — Players Report";

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/** A player's own phone, signed in as them. */
async function phoneOf(browser: Browser, testInfo: TestInfo, baseURL: string, name: string) {
  const i = FIELD.findIndex((p) => p.name === name);
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  await ctx.addCookies([{ name: "ng_session", value: await memberSession(medalEmail(i), name), url: baseURL }]);
  return ctx;
}

test("a player reports their knockout tie; the organizer approves it and the draw moves", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await test.step("a four-player knockout, launched", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A knockout/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });

    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · optional/ }).fill(medalEmail(i));
      // A new club is on Par, which since 2026-10-21 (A7) asks no mobile unless the organizer does.
      await expect(page.getByRole("textbox", { name: /^Mobile · required/ }), "Par still demands a mobile").toHaveCount(0);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }

    await open(page, "/stages");
    await page.getByRole("button", { name: /^Bracket/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Match Play");
    await page.getByRole("button", { name: /^Add bracket/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Bracket Stage/ })).toBeVisible({ timeout: 20_000 });
    // A scratch knockout: Gross, which a new round is not unless the organizer
    // chooses it (the club default since 2026-10-16). A net one needs a course
    // card before launch, and this walk's course has none.
    await playScratch(page, "Round 1 · Bracket Stage");

    await open(page, "/dashboard");
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expectLaunched(page);
  });

  const duneCtx = await phoneOf(browser, testInfo, baseURL!, "Dune Quayle");
  const alderCtx = await phoneOf(browser, testInfo, baseURL!, "Alder Quayle");
  const dune = await duneCtx.newPage();
  const alder = await alderCtx.newPage();
  watchPageErrors(dune, errors, "dune");
  watchPageErrors(alder, errors, "alder");

  try {
    await test.step("Dune reports beating the top seed, 2&1", async () => {
      await open(dune, "/me");
      await expect(dune.getByText("Semi-final v Alder Quayle")).toBeVisible({ timeout: 20_000 });
      await dune.getByRole("button", { name: "Report the result" }).click();
      await pressRadio(dune.getByRole("radio", { name: "I won" }));
      await dune.getByLabel("By how much (optional)").fill("2&1");
      await dune.getByRole("button", { name: /^Send to the organi[sz]er/ }).click();
      await expect(dune.getByText(/You won 2&1 — you reported it\. Waiting for the organi[sz]er to approve it\./)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Alder sees the report waiting, on his own phone", async () => {
      await open(alder, "/me");
      await expect(alder.getByText(/Dune Quayle won 2&1 — Dune Quayle reported it\. Waiting for the organi[sz]er/)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("the organizer sees it, the draw not yet moved, and approves", async () => {
      await open(page, "/bracket?view=draw");
      await expect(page.getByText("A result to approve")).toBeVisible();
      await expect(page.getByText(/Alder Quayle v Dune Quayle: Dune Quayle won 2&1/)).toBeVisible();
      await expect(page.getByText("Reported by Dune Quayle")).toBeVisible();
      // A report is a request: no result is on the draw yet.
      await expect(page.getByRole("textbox", { name: /^Result of Alder Quayle v Dune Quayle/ })).toHaveCount(0);

      await page.getByRole("button", { name: /^Approve: Dune Quayle won Alder Quayle v Dune Quayle/ }).click();
      await expect(page.getByText("A result to approve")).toHaveCount(0, { timeout: 20_000 });
      await expect(async () => {
        await open(page, "/bracket?view=draw");
        await expect(page.getByRole("textbox", { name: /^Result of Alder Quayle v Dune Quayle, Semi-finals$/ })).toHaveValue("2&1");
      }).toPass({ timeout: 20_000 });
    });

    await test.step("Dune's next tie is the final", async () => {
      await open(dune, "/me");
      await expect(dune.getByText(/Final v the winner of Briar Quayle v Cedar Quayle/)).toBeVisible({ timeout: 20_000 });
    });
  } finally {
    await duneCtx.close();
    await alderCtx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});

/**
 * A KNOCKOUT RESULT, RECORDED ON SCORE ENTRY BY THE SECRETARY ON A PHONE
 * (simplicity review, cut 3, 2026-11-14).
 *
 * The bracket recorded a winner on one tap of a 13.5 px seat, with no confirm
 * and no undo. On Score entry a knockout round is now its ties as a list: two
 * name buttons per tie, the card saying who goes through with Undo on it, Change
 * result on a decided tie, and Approve on a tie a player reported. Walked here as the
 * secretary would, on the phone projects (393 and 320 wide):
 *
 *   semi-final 1   margin typed, the higher seed pressed, "goes through", Undo,
 *                  then the other player pressed (the result that stands)
 *   semi-final 2   reported by a player (written as their phone's report writes
 *                  it, `BracketReport`), "Needs approval (1)", approved on the tie
 *   the Final      recorded by one press
 *   Change result  on semi-final 1 is REFUSED where the press was, naming the
 *                  Final; the way out (take the Final back first) works
 *   the record     every taking-back is an audit line naming the secretary
 *
 * Nothing is removed: "See the whole draw" still opens the bracket.
 *
 * The draw is read off the fixture (`seed` 1–4: 1 v 4 and 2 v 3), never assumed
 * from the names. Its own throwaway club (`zz-status-ko-ties-*`, not the organizer fixture above), deleted in
 * `finally`. Saves through the app, so the service worker is blocked (WebKit's
 * save rule). Light: four players, one round.
 */

test("the secretary records, undoes, approves and changes knockout results on Score entry, on a phone", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "the walk is the secretary's phone; the desktop draws the same list");
  test.setTimeout(240_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "ko-ties",
    players: 4,
    saves: true,
    event: { shape: "knockout", qualifyMode: "overall", qualifyOverall: 4, bracketMode: "single", status: "live", configUnlocked: false },
    rounds: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    // The fixture's own seeds decide the draw: 1 v 4 and 2 v 3.
    const players = await prisma.player.findMany({ where: { eventId: f.eventId }, select: { id: true, name: true, seed: true }, orderBy: { seed: "asc" } });
    const [s1, s2, s3, s4] = players;
    const stageId = f.stageIds[0];
    const row = (key: string) => page.locator(`[data-tie="${key}"]`);
    // Each card says what its last press did, on the card: the way back is where the thumb is.
    const saidOn = (key: string) => row(key).getByRole("status");
    const order = () => page.locator("[data-tie]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tie));
    const stored = () => prisma.bracketWinner.findMany({ where: { eventId: f.eventId }, select: { key: true, winnerId: true, result: true }, orderBy: { key: "asc" } });

    await test.step("Score entry opens the knockout as its ties, with the draw one press away", async () => {
      await open(page, `/entry?round=${stageId}`);
      await expect(page.getByRole("heading", { name: "Ties" })).toBeVisible({ timeout: 30_000 });
      await expect(row("winners-0-0")).toContainText(`${s1.name} v ${s4.name}`);
      await expect(row("winners-0-1")).toContainText(`${s2.name} v ${s3.name}`);
      // No halves in a knockout (Rule 3.2a(4)): two names and nothing else to press.
      await expect(page.getByRole("button", { name: /halve/i })).toHaveCount(0);
      // How it ended and the margin are folded away: the usual result is the name alone.
      await expect(row("winners-0-0").getByLabel(`Margin, ${s1.name} v ${s4.name} (optional)`)).toBeHidden();
      await expect(page.getByRole("link", { name: "See the whole draw" })).toHaveAttribute("href", "/bracket");
    });

    await test.step("a result recorded with one press says on its card who goes through, and Undo there takes it back", async () => {
      const opened = await order();
      await row("winners-0-0").getByText("How it ended, or the margin").click();
      await row("winners-0-0").getByLabel(`Margin, ${s1.name} v ${s4.name} (optional)`).fill("3&2");
      await row("winners-0-0").getByRole("button", { name: `${s1.name} won` }).click();
      await expect(saidOn("winners-0-0")).toHaveText(`Semi-finals: ${s1.name} goes through.`, { timeout: 20_000 });
      await expect.poll(stored, { timeout: 20_000 }).toEqual([{ key: "winners-0-0", winnerId: s1.id, result: "3&2" }]);
      // The list does not move under the thumb.
      expect(await order(), "the list reordered after a press").toEqual(opened);

      await row("winners-0-0").getByRole("button", { name: `Undo, ${s1.name} v ${s4.name}` }).click();
      await expect(saidOn("winners-0-0")).toContainText("Taken back:", { timeout: 20_000 });
      await expect.poll(stored, { timeout: 20_000 }).toEqual([]);
      // The tie is back to its two names.
      await row("winners-0-0").getByRole("button", { name: `${s4.name} won` }).click();
      await expect(saidOn("winners-0-0")).toHaveText(`Semi-finals: ${s4.name} goes through.`, { timeout: 20_000 });
    });

    await test.step("a tie a player reported is approved on the tie itself", async () => {
      // As the player's phone files it (`reportBracketResult`); the report's own walk is the test above.
      await prisma.bracketReport.create({ data: { eventId: f.eventId, key: "winners-0-1", winnerId: s3.id, result: "2&1", reportedById: s3.id, reportedBy: s3.name } });
      await open(page, `/entry?round=${stageId}`);
      await expect(page.getByRole("link", { name: "Needs approval (1)" })).toHaveAttribute("href", "#tie-winners-0-1");
      await expect(row("winners-0-1")).toContainText(`Reported by ${s3.name}: ${s3.name} won 2&1`);
      await row("winners-0-1").getByRole("button", { name: `Approve: ${s3.name} won ${s2.name} v ${s3.name}` }).click();
      await expect(saidOn("winners-0-1")).toHaveText(`Semi-finals: ${s3.name} goes through.`, { timeout: 20_000 });
      await expect(page.getByRole("link", { name: /^Needs approval/ })).toHaveCount(0);
    });

    await test.step("the Final is recorded by one press", async () => {
      await expect(row("winners-1-0")).toContainText(`${s4.name} v ${s3.name}`, { timeout: 20_000 });
      await row("winners-1-0").getByRole("button", { name: `${s3.name} won` }).click();
      // The Final's OWN card, and the row read back: the approval above already said "goes through".
      await expect(saidOn("winners-1-0")).toHaveText(`Final: ${s3.name} goes through.`, { timeout: 20_000 });
      await expect.poll(async () => (await stored()).find((r) => r.key === "winners-1-0")?.winnerId, { timeout: 20_000 }).toBe(s3.id);
    });

    await test.step("Change result on a semi-final is refused where the press was, naming the Final and linking it, and the way out works", async () => {
      const before = await stored();
      await row("winners-0-0").getByRole("button", { name: `Change result, ${s1.name} v ${s4.name}` }).click();
      const refused = row("winners-0-0").getByRole("alert");
      await expect(refused).toContainText(
        `Final: ${s4.name} v ${s3.name} already has a result, and this tie's winner played in it. Take that result back first with Change result on its card (on the Bracket, tap its winner again), then change this one.`,
        { timeout: 20_000 },
      );
      await expect(refused.getByRole("link", { name: "Go to that tie" })).toHaveAttribute("href", "#tie-winners-1-0");
      expect(await stored(), "a refused change moved the draw").toEqual(before);

      await refused.getByRole("link", { name: "Go to that tie" }).click();
      await row("winners-1-0").getByRole("button", { name: new RegExp(`^(Undo|Change result), ${s4.name} v ${s3.name}$`) }).click();
      await expect(saidOn("winners-1-0")).toContainText("Taken back:", { timeout: 20_000 });
      await row("winners-0-0").getByRole("button", { name: `Change result, ${s1.name} v ${s4.name}` }).click();
      await expect(row("winners-0-0").getByRole("button", { name: `${s1.name} won` })).toBeVisible({ timeout: 20_000 });
      await row("winners-0-0").getByRole("button", { name: `${s1.name} won` }).click();
      await expect(saidOn("winners-0-0")).toHaveText(`Semi-finals: ${s1.name} goes through.`, { timeout: 20_000 });
    });

    await test.step("every result taken back is on the record, with who took it back", async () => {
      const lines = await prisma.auditLog.findMany({ where: { eventId: f.eventId, action: "knockout.undo" }, select: { actor: true, detail: true }, orderBy: { createdAt: "asc" } });
      expect(lines.map((l) => l.detail)).toEqual([
        `Semi-finals: ${s1.name} beat ${s4.name} 3&2: taken back on Score entry`,
        `Final: ${s3.name} beat ${s4.name}: taken back on Score entry`,
        `Semi-finals: ${s4.name} beat ${s1.name}: taken back on Score entry`,
      ]);
      expect(new Set(lines.map((l) => l.actor))).toEqual(new Set(["Zz Status Organizer"]));
    });

    await test.step("the phone never scrolls sideways", async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
    });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
  }
});
