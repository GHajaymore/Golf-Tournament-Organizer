import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type Locator } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession } from "./rounds-fixture";
import { buildBracket, type BracketView } from "../src/lib/domain/bracket";
import { drawSections, sectionOfPlayer } from "../src/lib/domain/bracket-layout";
import type { Player as DomainPlayer } from "../src/lib/domain/types";

/**
 * A KNOCKOUT OF 129, READ IN SECTIONS ON EVERY SURFACE THAT SHOWS IT.
 *
 * Ajay, 2026-10-23, after the Bracket screen drew a field of 129 as one page
 * 16,341px tall: "we need to show entire bracket … including tabs based on the
 * QF, SF, F". His panel's ruling is `docs/bracket-panel-2026-10-23.md`. This
 * walks it as the three people who read a draw:
 *
 *   the secretary   /bracket — tabs Quarter 1–4, Finals, Whole draw; the arrow
 *                   keys move between them; a winner pressed INSIDE a quarter
 *                   lands on exactly that tie, while the tabs are switched
 *                   under a save held in the air; Find a player opens the
 *                   player's quarter and lights their path; Back returns
 *   a member        /me/board — opens on the quarter that holds them, "You"
 *   signed out      /live/<token> — the same tabs, the same names and results
 *                   for every tie as the secretary's Whole draw
 *
 * and, on each, no bye drawn as a box, a preliminary column only in the quarter
 * holding 128 v 129, every tab and seat at least 44px, and the page itself
 * never wider than the screen (the draw scrolls in its own box).
 *
 * The fixture is its own club (`zz-bracket-<project>`), invented names and
 * `@example.invalid` addresses, dropped in a `finally`. It does not touch the
 * shared e2e fixture, so it runs beside another session's run.
 *
 * WHAT IT CANNOT SEE: the three surface defaults the panel ruled on (part b —
 * "To play", the player's own tie, the public's latest results) and print
 * (part c); those come with their own pull requests. WebKit is not run here.
 */

const FIRST = ["Alder", "Briony", "Caspian", "Delphine", "Ewan", "Fenella", "Gideon", "Honor", "Ivo", "Juniper", "Kester", "Linnea", "Merrick"];
const LAST = ["Ashgrove", "Bramwell", "Cobbledene", "Dunmore", "Fernsby", "Gorsefield", "Hazelrigg", "Inchbold", "Larkworthy", "Moorcroft"];
const N = 129;
const MARGINS = ["3&2", "1 up", "2&1", "W/O", "4&3", "19th"];

const nameOf = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 20_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** A knockout of 129, part played: the preliminary tie, all of Quarter 1's first round and half of Quarter 2's. */
async function knockoutOf129(mark: string) {
  const club = await makeClub(mark);
  const { event, stages } = await makeEvent(club, "Club Knockout", {
    status: "live",
    stages: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
    players: 0,
    event: { shape: "knockout", bracketMode: "single", qualifyMode: "overall", qualifyOverall: N, leaderboardVisibility: "public" },
  });
  const players = [];
  for (let i = 0; i < N; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: event.id,
          name: nameOf(i),
          email: `${mark}-p${i}@example.invalid`,
          handicap: 2 + i * 0.2,
          seed: i + 1,
          status: "confirmed",
        },
      }),
    );
  }
  const field: DomainPlayer[] = players.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }));
  const winners: Record<string, string> = {};
  const results: Record<string, string> = {};
  let view = buildBracket("winners", field, winners);
  const play = (key: string, upset = false) => {
    const m = view.rounds.flatMap((r) => r.matches).find((x) => x.key === key)!;
    const [a, b] = [m.a, m.b];
    const better = (a.seed ?? 999) < (b.seed ?? 999) ? a : b;
    const worse = better === a ? b : a;
    winners[key] = (upset ? worse : better).playerId!;
    results[key] = MARGINS[Object.keys(results).length % MARGINS.length];
    view = buildBracket("winners", field, winners);
  };
  play("winners-0-1", true); // 129 beats 128 in the preliminary round
  const r1 = view.rounds[1].matches;
  r1.slice(0, 16).forEach((m, i) => play(m.key, i === 5));
  r1.slice(16, 24).forEach((m) => play(m.key));
  play(view.rounds[2].matches[0].key);
  await prisma.bracketWinner.createMany({
    data: Object.entries(winners).map(([key, winnerId]) => ({ eventId: event.id, key, winnerId, result: results[key] })),
  });
  return { club, event, stage: stages[0], players, field, winners, results, view };
}

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("h1").first(), `${path} has no heading`).toBeVisible();
}

const drawing = (page: Page) => page.locator(".bracket-drawing").first();
const tab = (page: Page, name: string) => drawing(page).getByRole("tab", { name: new RegExp(`^${name}`) });

async function expectSelected(page: Page, name: string) {
  await expect(tab(page, name), `${name} is not the open tab`).toHaveAttribute("aria-selected", "true");
}

/** The page is never wider than the screen; the drawing scrolls in its own box. */
async function expectNoSidewaysPage(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${where}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

/** Every tab, and every seat a secretary presses, is a thumb's width tall. */
async function expectTargets(page: Page, where: string, seats: boolean) {
  const heights = await drawing(page)
    .locator(seats ? '[role="tab"], button.bracket-seat' : '[role="tab"]')
    .evaluateAll((els) => els.slice(0, 80).map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(heights.length, `${where}: nothing measured`).toBeGreaterThan(0);
  expect(heights.filter((h) => h < 44), `${where}: targets under 44px`).toEqual([]);
}

/** No tie is a bye: no seat in the drawing reads "Bye", and the word is beside names instead. */
async function expectNoByeBoxes(page: Page, where: string) {
  const seats = await drawing(page).locator("[data-tie]").allInnerTexts();
  expect(seats.length, `${where}: no ties drawn`).toBeGreaterThan(0);
  expect(seats.filter((t) => /^\s*Bye\s*$/m.test(t)), `${where}: a bye drawn as a box`).toEqual([]);
}

/** Each tie's names and results as the drawing prints them, by tie key — "You" aside. */
async function tieTexts(scope: Locator): Promise<Record<string, string>> {
  return scope.locator("[data-tie]").evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => [
        e.getAttribute("data-tie")!,
        ((e as HTMLElement).innerText ?? "").replace(/\bYou\b/g, "").replace(/\s+/g, " ").trim(),
      ]),
    ),
  );
}

test("a knockout of 129: sections, a result from inside one, Find a player, on all three surfaces", async ({ page, browser, baseURL }, testInfo) => {
  const project = testInfo.project.name;
  const mark = `zz-bracket-${project}`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const ko = await knockoutOf129(mark);
  try {
    const sections = drawSections(ko.view);
    expect(sections.map((s) => s.label)).toEqual(["Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4", "Finals", "Whole draw"]);
    await signIn(page.context(), baseURL!, ko.club, ko.event.id);

    await test.step("the secretary's draw: six tabs, each with what is left to play", async () => {
      await open(page, "/bracket");
      for (const s of sections) {
        await expect(tab(page, s.label)).toContainText(s.toPlay === 0 ? "all played" : `${s.toPlay} to play`);
      }
      // The owner wanted the whole of it on hand: it is what the secretary opens on until "To play" exists.
      await expectSelected(page, "Whole draw");
      await expectTargets(page, `${project} /bracket`, true);
      await expectNoSidewaysPage(page, `${project} /bracket, whole draw`);
      await expectNoByeBoxes(page, `${project} /bracket, whole draw`);
    });

    await test.step("Quarter 1 starts with the preliminary tie; Quarter 2 with Round 1; the arrow keys move along", async () => {
      await tab(page, "Quarter 1").click();
      await expectSelected(page, "Quarter 1");
      expect(new URL(page.url()).searchParams.get("section")).toBe("q1");
      const heads = await drawing(page).locator(".bracket-round-head").allInnerTexts();
      expect(heads.map((h) => h.trim().toUpperCase())).toEqual(["PRELIMINARY ROUND", "ROUND 1", "ROUND 2", "ROUND 3", "ROUND 4", "QUARTER-FINALS"]);
      // The seed through a bye is marked so, beside the name.
      await expect(drawing(page).locator(".bracket-tag", { hasText: "bye" }).first()).toBeVisible();
      await tab(page, "Quarter 1").focus();
      await page.keyboard.press("ArrowRight");
      await expectSelected(page, "Quarter 2");
      await expect(tab(page, "Quarter 2")).toBeFocused();
      const heads2 = await drawing(page).locator(".bracket-round-head").allInnerTexts();
      expect(heads2[0].trim().toUpperCase()).toBe("ROUND 1");
      await expectNoSidewaysPage(page, `${project} /bracket, Quarter 2`);
      // Back returns to the tab before.
      await page.goBack();
      await expectSelected(page, "Quarter 1");
      await page.goForward();
      await expectSelected(page, "Quarter 2");
    });

    // The first tie in Quarter 2 with two players and no result.
    const q2 = sections.find((s) => s.key === "q2")!;
    const tie = ko.view.rounds.flatMap((r) => r.matches).find((m) => q2.keys.includes(m.key) && !m.winnerId && m.a.playerId && m.b.playerId)!;
    const winner = tie.a.seed! < tie.b.seed! ? tie.a : tie.b;
    const roundLabel = ko.view.rounds[tie.roundIndex].label;

    await test.step("a winner pressed inside Quarter 2 lands on that tie, with the tabs switched while the save is held", async () => {
      // Hold every server action back a second and a half: the press is in the air while the tabs move.
      await page.route("**/bracket**", async (route) => {
        if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      const box = drawing(page).locator(`[data-tie="${tie.key}"]`);
      await box.getByRole("button", { name: new RegExp(`^${winner.name}`) }).click();
      await tab(page, "Quarter 3").click();
      await expectSelected(page, "Quarter 3");
      await tab(page, "Quarter 2").click();
      await expect
        .poll(async () => (await prisma.bracketWinner.findFirst({ where: { eventId: ko.event.id, key: tie.key } }))?.winnerId ?? null, {
          message: "the result did not land on the tie that was pressed",
          timeout: 30_000,
        })
        .toBe(winner.playerId);
      await page.unroute("**/bracket**");
      // Nothing else moved: the rows are the fixture's and this one.
      expect(await prisma.bracketWinner.count({ where: { eventId: ko.event.id } })).toBe(Object.keys(ko.winners).length + 1);
      await open(page, "/bracket?section=q2");
      const margin = page.getByRole("textbox", { name: `Result of ${tie.a.name} v ${tie.b.name}, ${roundLabel}` });
      await expect(margin, "no margin box on the tie just decided").toBeVisible();
      await margin.fill("2&1");
      await margin.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Find a player opens their quarter and lights their path; the address carries both", async () => {
      // A seed in Quarter 4, found from Quarter 2.
      const who = ko.field.find((p) => sectionOfPlayer(ko.view, sections, p.id) === "q4")!;
      const search = drawing(page).getByRole("searchbox");
      await search.fill(who.name);
      await drawing(page).getByRole("button", { name: `Show ${who.name}` }).click();
      await expectSelected(page, "Quarter 4");
      await expect(drawing(page).getByRole("status").filter({ hasText: `Showing ${who.name}` })).toBeVisible();
      const url = new URL(page.url());
      expect([url.searchParams.get("section"), url.searchParams.get("p")]).toEqual(["q4", who.id]);
      const lit = await drawing(page).locator('[data-tie][data-on-path="true"]').count();
      expect(lit, "their path is not lit").toBeGreaterThan(0);
      await capture(page, `find-a-player-${project}`);
      // The link, opened fresh, shows the same.
      await open(page, `/bracket?section=q4&p=${who.id}`);
      await expectSelected(page, "Quarter 4");
      expect(await drawing(page).locator('[data-tie][data-on-path="true"]').count()).toBe(lit);
    });

    await open(page, "/bracket?section=whole");
    const secretary = await tieTexts(drawing(page));

    await test.step("signed out, the public board: the same tabs, the same names and results for every tie", async () => {
      const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      const pub = await ctx.newPage();
      watchPageErrors(pub, errors, "public");
      await expect
        .poll(
          async () => {
            await open(pub, `/live/${ko.event.shareToken}?section=whole`);
            return (await tieTexts(drawing(pub)))[tie.key] ?? "";
          },
          { message: "the public board never showed the result", timeout: 60_000 },
        )
        .toContain("2&1");
      const shown = await tieTexts(drawing(pub));
      expect(Object.keys(shown).sort()).toEqual(Object.keys(secretary).sort());
      const differ = Object.keys(secretary).filter((k) => secretary[k] !== shown[k]);
      expect(differ.map((k) => `${k}: secretary "${secretary[k]}" / public "${shown[k]}"`)).toEqual([]);
      await tab(pub, "Quarter 3").click();
      await expectSelected(pub, "Quarter 3");
      await expectNoByeBoxes(pub, `${project} public, Quarter 3`);
      await expectTargets(pub, `${project} public`, false);
      await expectNoSidewaysPage(pub, `${project} public, Quarter 3`);
      await ctx.close();
    });

    await test.step("a member's Board opens on the quarter that holds them, with You", async () => {
      const me = ko.players.find((p) => sectionOfPlayer(ko.view, sections, p.id) === "q3")!;
      const { session } = await memberSession(ko.event.id, me.email, me.name);
      const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      await signInWith(ctx, baseURL!, session, ko.event.id);
      const phone = await ctx.newPage();
      watchPageErrors(phone, errors, "member");
      await open(phone, "/me/board");
      await expectSelected(phone, "Quarter 3");
      await expect(drawing(phone).locator(".bracket-tag-you").first()).toBeVisible();
      expect(await drawing(phone).locator('[data-tie][data-on-path="true"]').count()).toBeGreaterThan(0);
      await capture(phone, `player-own-section-${project}`);
      await expectNoSidewaysPage(phone, `${project} /me/board`);
      await open(phone, "/me/board?section=whole");
      const member = await tieTexts(drawing(phone));
      const differ = Object.keys(secretary).filter((k) => secretary[k] !== member[k]);
      expect(differ.map((k) => `${k}: secretary "${secretary[k]}" / member "${member[k]}"`)).toEqual([]);
      await ctx.close();
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/** The pictures for the owner, when asked for (`BRACKET_CAPTURE=<dir>`): the bracket area, not a 16,000px page. */
async function capture(page: Page, name: string) {
  const dir = process.env.BRACKET_CAPTURE;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await drawing(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

test("the pictures: the finished 129 on every tab, at this width", async ({ page }, testInfo) => {
  test.skip(!process.env.BRACKET_CAPTURE || !process.env.BRACKET_CAPTURE_TOKEN, "pictures only when asked for");
  const project = testInfo.project.name;
  for (const [key, label] of [["q1", "Quarter 1"], ["q2", "Quarter 2"], ["q3", "Quarter 3"], ["q4", "Quarter 4"], ["finals", "Finals"], ["whole", "Whole draw"]]) {
    // A finished draw, read signed out: nothing on it is written to.
    await open(page, `/live/${process.env.BRACKET_CAPTURE_TOKEN}?section=${key}`);
    await expectSelected(page, label);
    await expectNoSidewaysPage(page, `${project} ${label}`);
    await capture(page, `ko129-${key}-${project}`);
  }
});

export type { BracketView };
