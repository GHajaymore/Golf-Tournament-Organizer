import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, addDays, dayIn } from "./rounds-fixture";
import { buildBracket } from "../src/lib/domain/bracket";
import { tieToPlay } from "../src/lib/domain/knockout-play-by";
import type { Player as DomainPlayer } from "../src/lib/domain/types";

/**
 * EACH SURFACE OF A KNOCKOUT OPENS ON ITS OWN QUESTION (the panel, 2026-10-23,
 * part b; `docs/bracket-panel-2026-10-23.md`). Walked as the three people:
 *
 *   the secretary   /bracket opens on "To play": the play-by dates set on the
 *                   screen itself and shown on every round heading, "Overdue"
 *                   once the club's day is past; a result entered in a row
 *                   lands on that tie and is said back naming the round and
 *                   both players; a refusal is said in the row it came from;
 *                   "The draw" is the next tab and Back returns
 *   a member        /me/board opens on their own tie: who, the strokes, the
 *                   play-by date, where a win takes them
 *   signed out      /live opens on the latest results and what is still to
 *                   play, then the drawing
 *
 * A knockout of 22 — 12 play in Round 1, 10 sit it out — so Round 1 and Round 2
 * both have ties ready at once (two seeds who both had byes meet in Round 2).
 * Its own club (`zz-ko-open-<project>`), invented names, dropped in a `finally`;
 * the shared e2e fixture is not touched.
 *
 * WHAT IT CANNOT SEE: print (part c), and the club's clock in another zone —
 * this club has none and keeps the server's day (`E2E_TZ` is how to reach that).
 */

const NAMES = [
  "Ailsa Brackenridge", "Bram Cottesloe", "Cora Dunwoody", "Dafydd Eskdale", "Elspeth Fairlie", "Fergus Glenholm",
  "Greer Halkirk", "Hamish Invergarry", "Isla Jedburgh", "Jago Kilbride", "Kirsten Lochore", "Lachlan Moffat",
  "Morven Nairn", "Niall Ochiltree", "Orla Pitlochry", "Piran Quarrier", "Rhona Strathy", "Struan Tarbert",
  "Tamsin Ullapool", "Ewart Vaila", "Wynne Whithorn", "Yvaine Yarrow",
];

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 20_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("h1").first(), `${path} has no heading`).toBeVisible();
}

/** The pictures for the owner, when asked for (`BRACKET_CAPTURE=<dir>`): what the screen opens on. */
async function capture(page: Page, name: string) {
  const dir = process.env.BRACKET_CAPTURE;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function expectNoSidewaysPage(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${where}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

test("a knockout opens on To play for the secretary, a player's own tie, and the news for the public", async ({ page, browser, baseURL }, testInfo) => {
  const project = testInfo.project.name;
  const mark = `zz-ko-open-${project}`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const club = await makeClub(mark);
  try {
    const { event } = await makeEvent(club, "Spring Knockout", {
      status: "live",
      stages: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "net" }],
      players: 0,
      event: { shape: "knockout", bracketMode: "single", qualifyMode: "overall", qualifyOverall: NAMES.length, leaderboardVisibility: "public" },
    });
    const players: Array<{ id: string; name: string; email: string; handicap: number; seed: number }> = [];
    for (const [i, name] of NAMES.entries()) {
      players.push(
        await prisma.player.create({
          data: { eventId: event.id, name, email: `${mark}-p${i}@example.invalid`, handicap: 1 + i * 1.3, seed: i + 1, status: "confirmed" },
        }),
      );
    }
    const field: DomainPlayer[] = players.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }));
    const view = buildBracket("winners", field, {});
    expect(view.rounds.map((r) => r.label)).toEqual(["Round 1", "Round 2", "Quarter-finals", "Semi-finals", "Final"]);
    const ready = view.rounds.flatMap((r) => r.matches).filter(tieToPlay);
    const r1 = ready.filter((m) => m.roundIndex === 0);
    const r2 = ready.filter((m) => m.roundIndex === 1);
    expect(r1.length).toBe(6);
    expect(r2.length, "two seeds who both had byes meet in Round 2").toBeGreaterThan(0);
    await signIn(page.context(), baseURL!, club, event.id);

    const today = dayIn("");
    await test.step("the secretary opens on To play, and sets each round's play-by date there", async () => {
      await open(page, "/bracket");
      await expect(page.getByRole("tab", { name: "To play", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: "To play", level: 2 })).toBeVisible();
      const form = page.locator("section", { has: page.getByRole("heading", { name: "Play-by dates" }) });
      await form.getByLabel("Round 1", { exact: true }).fill(addDays(today, -1));
      await form.getByLabel("Round 2", { exact: true }).fill(addDays(today, 6));
      await form.getByLabel("Final", { exact: true }).fill(addDays(today, 30));
      await form.getByRole("button", { name: "Save dates" }).click();
      await expect(form.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
      // Out of order — the semi-finals after the final: refused beside the button, nothing kept.
      await form.getByLabel("Semi-finals", { exact: true }).fill(addDays(today, 40));
      await form.getByRole("button", { name: "Save dates" }).click();
      await expect(form.getByRole("alert")).toContainText("can't be due after the round it feeds");
      const kept = await prisma.stage.findFirstOrThrow({ where: { eventId: event.id } });
      expect(JSON.parse(kept.knockoutPlayBy)).toEqual({ "0": addDays(today, 30), "3": addDays(today, 6), "4": addDays(today, -1) });
    });

    await test.step("To play lists the ready ties by round, with the date and Overdue written out", async () => {
      await open(page, "/bracket");
      const round1 = page.getByRole("heading", { level: 3, name: /^Round 1/ });
      await expect(round1).toContainText("Play by");
      await expect(round1).toContainText("Overdue");
      const round2 = page.getByRole("heading", { level: 3, name: /^Round 2/ });
      await expect(round2).toContainText("Play by");
      await expect(round2).not.toContainText("Overdue");
      await expect(page.locator("[data-tie-row]")).toHaveCount(r1.length + r2.length);
      await expectNoSidewaysPage(page, `${project} To play`);
      const tabHeights = await page.getByRole("tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(tabHeights.every((h) => h >= 44), `tabs under 44px: ${tabHeights}`).toBe(true);
    });

    const [first, second] = r1;
    await test.step("a refusal is said in its own row; a result lands on its tie and is said back", async () => {
      /*
       * EVERY ROW'S CONTROLS BELONG TO THAT ROW (round bracket-defaults-2): the rows once
       * shared the list's one card, so the button nearest a later row's winner — "the
       * card's" — was the FIRST row's, and a winner chosen in the second row was refused
       * "Choose who won." up in the first. Asked as the control crawl asks it: from each
       * radio and each box, the enclosing form/section/card holds one button, its row's.
       */
      const owners = await page.locator("[data-tie-row]").evaluateAll((rows) =>
        rows.flatMap((row) =>
          [...row.querySelectorAll("input, select")].map((c) => {
            const home = c.closest("form, section, .card");
            const buttons = home ? [...home.querySelectorAll("button")] : [];
            return buttons.length === 1 && buttons[0].closest("[data-tie-row]") === row ? "own" : `${row.getAttribute("data-tie-row")}: ${buttons.length} buttons`;
          }),
        ),
      );
      expect(owners.filter((o) => o !== "own"), "a tie row's control whose nearest button is not its own row's").toEqual([]);
      // A later row, entered by Enter in its margin box with nobody chosen: refused in THAT row, in view.
      const later = page.locator(`[data-tie-row="${second.key}"]`);
      await later.getByLabel(`Margin, ${second.a.name} v ${second.b.name}`).fill("2&1");
      await later.getByLabel(`Margin, ${second.a.name} v ${second.b.name}`).press("Enter");
      await expect(later.getByRole("alert")).toHaveText("Choose who won.");
      await expect(later.getByRole("alert"), "the refusal is not beside the press").toBeInViewport();
      await page.reload();
      await page.locator("[data-tie-row]").first().waitFor();
      const row = page.locator(`[data-tie-row="${first.key}"]`);
      await row.getByRole("button", { name: "Record result" }).click();
      await expect(row.getByRole("alert")).toHaveText("Choose who won.");
      await expect(page.locator("[data-tie-row] [role=alert]")).toHaveCount(1);
      // The lower seed wins, 3&2.
      const winner = first.b;
      await row.getByRole("radio", { name: `${winner.name} won` }).check();
      await row.getByLabel(`Margin, ${first.a.name} v ${first.b.name}`).fill("3&2");
      await row.getByRole("button", { name: "Record result" }).click();
      const said = page.getByRole("list", { name: "Just recorded" });
      await expect(said).toContainText(`Recorded — Round 1: ${winner.name} beat ${first.a.name} 3&2.`);
      await expect
        .poll(async () => prisma.bracketWinner.findMany({ where: { eventId: event.id }, select: { key: true, winnerId: true, result: true } }))
        .toEqual([{ key: first.key, winnerId: winner.playerId, result: "3&2" }]);
      await expect(page.locator(`[data-tie-row="${first.key}"]`), "a decided tie is still to play").toHaveCount(0);
      // A walkover, in golf's words.
      const row2 = page.locator(`[data-tie-row="${second.key}"]`);
      await row2.getByRole("radio", { name: `${second.a.name} won` }).check();
      await row2.getByLabel(`How it was settled, ${second.a.name} v ${second.b.name}`).selectOption("walkover");
      await row2.getByRole("button", { name: "Record result" }).click();
      await expect(said).toContainText(`Recorded — Round 1: ${second.a.name} beat ${second.b.name} by walkover.`);
      await page.getByRole("tab", { name: "To play", exact: true }).scrollIntoViewIfNeeded();
      await capture(page, `to-play-${project}`);
    });

    await test.step("The draw is the next tab, its headings carry the dates, and Back returns", async () => {
      await page.getByRole("tab", { name: "The draw", exact: true }).click();
      expect(new URL(page.url()).searchParams.get("view")).toBe("draw");
      const head = page.locator(".bracket-round-head").first();
      await expect(head.locator(".bracket-round-name")).toHaveText(/Round 1/i);
      await expect(head).toContainText("Overdue");
      await page.goBack();
      await expect(page.getByRole("tab", { name: "To play", exact: true })).toHaveAttribute("aria-selected", "true");
    });

    await test.step("a member opens on their own tie", async () => {
      const me = players.find((p) => p.id === r2[0].a.playerId)!;
      const opponent = r2[0].b.name;
      const { session } = await memberSession(event.id, me.email, me.name);
      const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      await signInWith(ctx, baseURL!, session, event.id);
      const phone = await ctx.newPage();
      watchPageErrors(phone, errors, "member");
      await open(phone, "/me/board");
      const card = phone.locator("section", { has: phone.getByRole("heading", { name: "Your tie" }) });
      await expect(card).toContainText(`Round 2 v ${opponent}`);
      await expect(card).toContainText(/You (receive|give) .*strokes?|Level: no strokes/);
      await expect(card).toContainText("Play by");
      await expect(card).toContainText(/Win, and you play /);
      // Their tie is above the draw.
      const cardTop = (await card.boundingBox())!.y;
      const drawTop = (await phone.getByRole("heading", { name: "The draw" }).boundingBox())!.y;
      expect(cardTop).toBeLessThan(drawTop);
      await card.scrollIntoViewIfNeeded();
      await capture(phone, `player-own-tie-${project}`);
      await expectNoSidewaysPage(phone, `${project} /me/board`);
      await ctx.close();
    });

    await test.step("signed out, the public board opens on the news, then the drawing", async () => {
      const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      const pub = await ctx.newPage();
      watchPageErrors(pub, errors, "public");
      await expect
        .poll(async () => {
          await open(pub, `/live/${event.shareToken}`);
          return (await pub.locator("section", { has: pub.getByRole("heading", { name: "Latest results" }) }).innerText().catch(() => "")) ?? "";
        }, { timeout: 60_000 })
        .toContain(`Round 1: ${first.b.name} beat ${first.a.name} 3&2`);
      const still = pub.locator("section", { has: pub.getByRole("heading", { name: "Still to play" }) });
      await expect(still).toContainText(`${NAMES.length - 2} players are still in`);
      await expect(still).toContainText("Overdue");
      const newsTop = (await pub.getByRole("heading", { name: "Latest results" }).boundingBox())!.y;
      const drawTop = (await pub.getByRole("heading", { name: "The draw" }).boundingBox())!.y;
      expect(newsTop).toBeLessThan(drawTop);
      await pub.getByRole("heading", { name: "Latest results" }).scrollIntoViewIfNeeded();
      await capture(pub, `public-news-${project}`);
      await expectNoSidewaysPage(pub, `${project} /live`);
      await ctx.close();
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
