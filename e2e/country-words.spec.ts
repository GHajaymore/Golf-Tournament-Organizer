import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, NAMES } from "./rounds-fixture";
import { openSettingsTab } from "./settings-tabs";

/**
 * A US CLUB READS US GOLF AND A BRITISH CLUB READS BRITISH GOLF — on the
 * screens that carry the words, as the secretary and a member see them.
 *
 * Ajay, 2026-10-24: "we are using societies a lot. in US its Leagues. We need
 * to represent all geographies." `docs/country-words.md` is the table and
 * `golf-terms.ts` its one source. The unit tests prove the table and refuse a
 * word typed into a screen (`country-words.test.ts`); this proves the words
 * REACH the screen, from the club's country, through the providers and the
 * token-filled tables:
 *
 *   Club settings   the heading (League settings / Society settings), the
 *                   golf-words preview, the plan's own line in Compare plans
 *   the guide       "How TourneyHQ works" — the plan card and the honours title
 *                   — and the step-by-step guide and its search
 *   a casual round  "/match/new": a foursome or a fourball
 *   the player      Today on the waiting list ("the organiser will confirm")
 *                   and Help ("Ask your organiser")
 *
 * Two throwaway clubs, `zz-words-us` and `zz-words-uk`, each a community with a
 * country, invented names and `@example.invalid` addresses, dropped in a
 * `finally`. Each asserts its own words AND the absence of the other country's,
 * so a screen that printed both would fail either way.
 *
 * WHAT IT CANNOT SEE: the third register (`au`) in a browser — the same code
 * path with a third set of words, held by the unit table; the email and SMS
 * text, which no browser draws; and the PDF guide, which is the US edition.
 */

const WALKED = ["desktop", "phone"];

type Want = {
  country: string;
  settings: string;
  preview: RegExp;
  tagline: string;
  honours: string;
  guideWhere: string;
  guideWords: string;
  casual: string;
  waiting: string;
  help: string;
  never: RegExp;
};

const WANT: Record<"us" | "uk", Want> = {
  us: {
    country: "US",
    settings: "League settings",
    preview: /Screens say cart, your foursome, league, outing and organizer\./,
    tagline: "Leagues and golf groups",
    honours: "From a name to the honors board",
    guideWhere: "Club → Club settings (or League settings)",
    guideWords: "Your club reads cart, foursome, league and outing today.",
    casual: "A match, a stroke-play round or a foursome",
    waiting: "the organizer will confirm your place",
    help: "Ask your organizer.",
    never: /\b(societ(y|ies)|buggy|buggies|fourball|organiser|honours)\b/i,
  },
  uk: {
    country: "GB",
    settings: "Society settings",
    preview: /Screens say buggy, your fourball, society, society day and organiser\./,
    tagline: "Leagues and societies",
    honours: "From a name to the honours board",
    guideWhere: "Club → Club settings (or Society settings)",
    guideWords: "Your club reads buggy, fourball, society and society day today.",
    casual: "A match, a medal or a fourball",
    waiting: "the organiser will confirm your place",
    help: "Ask your organiser.",
    never: /\b(golf groups?|foursome|organizer|honors)\b/i,
  },
};

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function go(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // A refused cookie answers every screen with the sign-in page, which reads
  // like the app working: ask where we are before reading a word.
  expect(new URL(page.url()).pathname, `sent away from ${path} — not signed in?`).toBe(path.split("?")[0]);
  await expect(page.locator("main h1").first()).toBeVisible();
}

for (const register of ["us", "uk"] as const) {
  test(`a ${register.toUpperCase()} club reads its own golf on every screen that names it`, async ({ page, context, browser, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
    const want = WANT[register];
    const mark = `zz-words-${register}-${testInfo.project.name}`;
    const errors: string[] = [];
    watchPageErrors(page, errors, "secretary");
    const club = await makeClub(mark);
    try {
      await prisma.organization.update({ where: { id: club.orgId }, data: { kind: "community", country: want.country } });
      const { event, players } = await makeEvent(club, "Autumn Stableford", { stages: [{ format: "Stableford" }] });
      // A member on the waiting list: Today names who confirms the place.
      await prisma.player.update({ where: { id: players[1].id }, data: { status: "waitlisted" } });
      await signIn(context, baseURL!, club, event.id);

      await test.step("Club settings: the heading, the golf words and the plan", async () => {
        await go(page, "/organization");
        await expect(page.locator("main h1").first()).toHaveText(want.settings);
        await expect(page.locator("main")).toContainText(want.preview);
        await openSettingsTab(page, "Plan");
        await expect(page.locator("main")).toContainText(want.tagline);
      });

      await test.step("the guide and the step-by-step guide", async () => {
        await go(page, "/guide");
        await expect(page.locator("main")).toContainText(want.tagline);
        await expect(page.getByRole("heading", { name: want.honours })).toBeVisible();
        await go(page, "/guide/steps");
        const main = page.locator("main");
        await expect(main).toContainText(want.guideWhere);
        await expect(main).toContainText(want.guideWords);
        // Nothing left in braces: a token the screen forgot to fill.
        expect(await main.textContent(), "a {token} reached the screen").not.toMatch(/\{[A-Za-z]+\}/);
      });

      await test.step("a casual round", async () => {
        await go(page, "/match/new");
        await expect(page.locator("main")).toContainText(want.casual);
        await expect(page.locator("main")).not.toContainText(WANT[register === "us" ? "uk" : "us"].casual);
      });

      await test.step("the player's Today and Help", async () => {
        const other = await browser.newContext({ baseURL });
        try {
          const member = await memberSession(event.id, players[1].email, NAMES[1]);
          await signInWith(other, baseURL!, member.session, event.id);
          const p = await other.newPage();
          watchPageErrors(p, errors, "member");
          await go(p, "/me");
          await expect(p.locator("main")).toContainText("on the waiting list");
          await expect(p.locator("main")).toContainText(want.waiting);
          await go(p, "/me/help");
          await expect(p.locator("main")).toContainText(want.help);
          expect(await p.locator("main").textContent(), "the other country's golf on Help").not.toMatch(want.never);
          expect(await p.locator("main").textContent(), "a {token} reached Help").not.toMatch(/\{[A-Za-z]+\}/);
        } finally {
          await other.close();
        }
      });
    } finally {
      await dropClub(mark);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
