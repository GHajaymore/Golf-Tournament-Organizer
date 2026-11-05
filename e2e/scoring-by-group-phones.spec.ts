import { test, expect, type Page, type BrowserContext } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { keepCardOf } from "./keep-on-play";

/**
 * ONE PHONE KEEPS THE GROUP'S CARD, PRESSED ON TWO PHONES (2026-11-05, sprint 2
 * part B, phase 2).
 *
 * The round-code screens of "one scorer per group", as the two players in a
 * match would press them — every press on the screen, no endpoint called by
 * hand (phase 1's `scoring-by-group-server.spec.ts` did that until these
 * buttons existed):
 *
 *   Ailsa's phone        confirms the match → keeps the card (the confirmation is the claim)
 *   Bram's phone         confirms the same match → "… is being kept on Ailsa's phone", follows it read-only
 *   Ailsa                gives hole 1 → Bram's phone, redrawn, follows it
 *   Bram                 Take over the card → one confirmation → keeps it
 *   Ailsa's next hole    refused IN WORDS (the card moved), the pad gone, nothing stored
 *   Bram                 hands the card back to Ailsa (handOverGroup)
 *   Ailsa                finishes the match 5&4
 *   Bram                 the end-of-round check: Confirm the result → confirmed
 *   (committee reopens)  Bram: That's not right → disputed, held off the board
 *   a stroke round       Bram follows the group's card and disputes his own card
 *
 * Its own club, tournament and invented people with @example.invalid
 * addresses, deleted afterwards. Two browser contexts at a phone's size,
 * service workers blocked (a WebKit save spec's rule); about 150 MB beyond the
 * suite's own pages.
 */

/**
 * NOT SERIAL (2026-11-05). The three tests share one tournament but never one
 * round: each has its own round, code and match (`matchStage`, `cardStage`,
 * `ballsStage`), and none reads what another wrote. So a failure in one must
 * not hide the next — in serial mode the first test's failure skipped the
 * other two on every device in three rounds. A failed test restarts the
 * worker, which seeds a fresh tournament (new codes) for the tests after it.
 */

const prisma = new PrismaClient();
const MARK = "zz-scoring-by-group-phones";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const code = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const MATCH_CODE = code();
const CARD_CODE = code();
const BALLS_CODE = code();
const AILSA = "Ailsa Zzphones";
const BRAM = "Bram Zzphones";
const ids = { org: "", event: "", matchStage: "", cardStage: "", ballsStage: "", match: "", ballsMatch: "", ailsa: "", bram: "" };

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Singles`,
      status: "live",
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${MATCH_CODE}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      // The players settle it: the other side's confirmation confirms.
      scoreApproval: "players",
      attestBy: "marker",
    },
  });
  ids.event = event.id;
  const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
  const person = (name: string, i: number) =>
    prisma.player.create({
      data: { eventId: event.id, groupId: group.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  ids.ailsa = (await person(AILSA, 0)).id;
  ids.bram = (await person(BRAM, 1)).id;
  // As a new round is made (`scoringDefaults`): one scorer per group, the end-of-round check on.
  ids.matchStage = (
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: "Single Match Stage",
        format: "Match Play",
        description: "Zz singles",
        holes: 9,
        nine: "front",
        scoringBasis: "gross",
        accessCode: MATCH_CODE,
        matchKeptBy: "holes",
        scoreKeeping: "group",
        endCheck: "on",
      },
    })
  ).id;
  ids.match = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: ids.matchStage,
        groupId: group.id,
        round: 1,
        playerAId: ids.ailsa,
        playerBId: ids.bram,
        holes: JSON.stringify(new Array(9).fill(null)),
      },
    })
  ).id;
  // A stroke round whose published tee sheet puts the two of them in one group.
  ids.cardStage = (
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 1,
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        description: "Zz medal",
        holes: 9,
        nine: "front",
        scoringBasis: "gross",
        accessCode: CARD_CODE,
        scoreKeeping: "group",
        endCheck: "on",
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [{ name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [ids.ailsa, ids.bram] }],
        }),
      },
    })
  ).id;
  // A match round kept on STROKE CARDS, with no sheet of its own: the match is the group.
  ids.ballsStage = (
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 2,
        type: "Single Match Stage",
        format: "Match Play",
        description: "Zz singles on cards",
        holes: 9,
        nine: "front",
        scoringBasis: "gross",
        accessCode: BALLS_CODE,
        matchKeptBy: "cards",
        scoreKeeping: "group",
        endCheck: "on",
      },
    })
  ).id;
  ids.ballsMatch = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: ids.ballsStage,
        groupId: group.id,
        round: 1,
        playerAId: ids.ailsa,
        playerBId: ids.bram,
        holes: JSON.stringify(new Array(9).fill(null)),
      },
    })
  ).id;
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

const matchRow = () => prisma.match.findUniqueOrThrow({ where: { id: ids.match } });
const storedHole = async (i: number) => (JSON.parse((await matchRow()).holes) as (string | null)[])[i];

/** A phone: its own browser, at a phone's size, with no service worker. */
async function newPhone(browser: import("@playwright/test").Browser, baseURL: string, errors: string[], who: string) {
  const ctx: BrowserContext = await browser.newContext({
    baseURL,
    viewport: { width: 393, height: 852 },
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  watchPageErrors(page, errors, who);
  return { ctx, page };
}

/** The round code, typed, and this player's group confirmed — as on the first tee. */
async function openRound(page: Page, roundCode: string, name: string) {
  await page.goto(`/play?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Round code").fill(roundCode);
  await page.getByRole("button", { name: "Continue" }).click();
  await keepCardOf(page, name);
}

const keeping = (page: Page) => page.getByRole("region", { name: "Who keeps the card" });

/** Give a hole to Ailsa on the tap card, as the scorer does. */
async function holeToAilsa(page: Page, n: number) {
  await page.getByRole("group", { name: `Who won hole ${n}` }).getByRole("button", { name: new RegExp(`^Hole ${n} to ${AILSA}`) }).click();
}

test("two phones in one match: one keeps, one follows, take over, hand back, and the other side checks the result", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const ailsa = await newPhone(browser, baseURL!, errors, "Ailsa's phone");
  const bram = await newPhone(browser, baseURL!, errors, "Bram's phone");
  try {
    await test.step("Ailsa confirms the match, and her phone keeps the card", async () => {
      await openRound(ailsa.page, MATCH_CODE, AILSA);
      await expect(keeping(ailsa.page)).toHaveAttribute("data-keeping", "keeper", { timeout: 30_000 });
      await expect(keeping(ailsa.page)).toContainText(/^.*You're keeping score for /);
      const row = await prisma.scoringKeeper.findFirst({ where: { eventId: ids.event, stageId: ids.matchStage } });
      expect(row?.playerId, "the confirmation did not make Ailsa's phone the scorer").toBe(ids.ailsa);
    });

    await test.step("Bram confirms the same match: his phone follows Ailsa's, read-only, and nobody is shut out", async () => {
      await openRound(bram.page, MATCH_CODE, BRAM);
      await expect(keeping(bram.page)).toHaveAttribute("data-keeping", "follower", { timeout: 30_000 });
      await expect(keeping(bram.page)).toContainText("is being kept on Ailsa's phone.");
      await expect(bram.page.getByRole("region", { name: "The match" })).toBeVisible();
      await expect(bram.page.getByRole("group", { name: /^Who won hole/ }), "a following phone was given the pad").toHaveCount(0);
      await expect(keeping(bram.page).getByRole("button", { name: "Take over the card" })).toBeVisible();
    });

    await test.step("Ailsa gives hole 1, and Bram's phone follows it", async () => {
      await holeToAilsa(ailsa.page, 1);
      await expect.poll(() => storedHole(0), { timeout: 15_000, message: "Ailsa's hole was never stored" }).toBe("A");
      await bram.page.reload();
      await expect(bram.page.getByRole("region", { name: "The match" })).toContainText(/1 up with 8 to play/);
    });

    await test.step("Bram takes over the card with one confirmation", async () => {
      await keeping(bram.page).getByRole("button", { name: "Take over the card" }).click();
      await expect(keeping(bram.page)).toContainText("Take the card over from Ailsa? Ailsa's phone stops saving scores, and the change is logged.");
      await keeping(bram.page).getByRole("button", { name: "Yes, take over" }).click();
      await expect(keeping(bram.page)).toHaveAttribute("data-keeping", "keeper", { timeout: 30_000 });
      const logged = await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "keeper.takeover" } });
      expect(logged?.detail).toBe(`${BRAM} took over keeping score from ${AILSA}`);
    });

    await test.step("Ailsa's next hole is refused in words — the card moved — and her pad stops claiming it", async () => {
      // Her phone still holds the old epoch: drawn as the keeper before the take-over.
      await holeToAilsa(ailsa.page, 2);
      await expect(keeping(ailsa.page)).toHaveAttribute("data-keeping", "follower", { timeout: 20_000 });
      await expect(keeping(ailsa.page)).toContainText("is being kept on Bram's phone.");
      await expect(keeping(ailsa.page)).toContainText("this phone's last scores weren't saved");
      await expect(ailsa.page.getByRole("group", { name: /^Who won hole/ }), "the refused phone still offers the pad").toHaveCount(0);
      expect(await storedHole(1), "a phone that was taken over still wrote the hole").toBeNull();
    });

    await test.step("Bram hands the card back to Ailsa, by name", async () => {
      await keeping(bram.page).getByRole("button", { name: "Hand the card to someone else" }).click();
      await keeping(bram.page).getByRole("button", { name: AILSA }).click();
      await keeping(bram.page).getByRole("button", { name: "Yes, hand it to Ailsa" }).click();
      await expect(keeping(bram.page)).toHaveAttribute("data-keeping", "follower", { timeout: 30_000 });
      await ailsa.page.reload();
      await expect(keeping(ailsa.page)).toHaveAttribute("data-keeping", "keeper", { timeout: 30_000 });
    });

    await test.step("Ailsa finishes the match 5&4; her phone waits for the other side", async () => {
      for (const n of [2, 3, 4, 5]) {
        await holeToAilsa(ailsa.page, n);
        await expect.poll(() => storedHole(n - 1), { timeout: 15_000 }).toBe("A");
      }
      expect((await matchRow()).enteredById).toBe(ids.ailsa);
      await ailsa.page.reload();
      await expect(ailsa.page.getByRole("region", { name: "Check the result" })).toContainText("You entered this result, so the other side confirms it.");
    });

    await test.step("the end-of-round check: Bram confirms the result", async () => {
      await bram.page.reload();
      const check = bram.page.getByRole("region", { name: "Check the result" });
      await check.getByRole("button", { name: "Confirm the result" }).click();
      await expect(check).toContainText("Both sides agree. The result is confirmed.", { timeout: 20_000 });
      expect((await matchRow()).scoreStatus).toBe("confirmed");
    });

    await test.step("reopened by the committee, Bram disputes it: held off the board, in words", async () => {
      // The committee's reopen is `reopenMatch` on Score entry; written here as its row.
      await prisma.match.update({ where: { id: ids.match }, data: { scoreStatus: "pending", attestedBy: "[]" } });
      await bram.page.reload();
      const check = bram.page.getByRole("region", { name: "Check the result" });
      await check.getByRole("button", { name: "That’s not right" }).click();
      await check.getByRole("button", { name: "Yes, it’s not right" }).click();
      await expect(check).toContainText("Disputed. It’s held off the leaderboard until the committee settles it.", { timeout: 20_000 });
      expect((await matchRow()).scoreStatus).toBe("disputed");
    });
  } finally {
    // A context Playwright already closed (a timed-out test) is not a second failure.
    await ailsa.ctx.close().catch(() => {});
    await bram.ctx.close().catch(() => {});
  }
  expect(errors).toEqual([]);
});

test("a stroke round: the scorer keeps the group's cards; the other player follows and disputes his own card", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ailsa = await newPhone(browser, baseURL!, errors, "Ailsa's phone, medal");
  const bram = await newPhone(browser, baseURL!, errors, "Bram's phone, medal");
  try {
    await test.step("Ailsa confirms Group 1 and says which one she is: her phone keeps both cards", async () => {
      await openRound(ailsa.page, CARD_CODE, AILSA);
      await expect(keeping(ailsa.page)).toHaveAttribute("data-keeping", "keeper", { timeout: 30_000 });
      await expect(keeping(ailsa.page)).toContainText("You're keeping score for Group 1.");
      await expect(ailsa.page.getByText("Your group's cards, hole by hole.")).toBeVisible();
    });

    await test.step("Bram's card, kept on Ailsa's phone, is complete; Bram follows and says it is wrong", async () => {
      // Written as the scorer's save writes it, so this step is about Bram's press, not the pad.
      await prisma.scorecard.create({
        data: { eventId: ids.event, stageId: ids.cardStage, playerId: ids.bram, strokes: JSON.stringify(new Array(9).fill(5)) },
      });
      await openRound(bram.page, CARD_CODE, BRAM);
      await expect(keeping(bram.page)).toHaveAttribute("data-keeping", "follower", { timeout: 30_000 });
      await expect(keeping(bram.page)).toContainText("Group 1 is being kept on Ailsa's phone.");
      await expect(bram.page.getByRole("region", { name: "The group's card" })).toContainText(BRAM);
      const check = bram.page.getByRole("region", { name: "Check your card" });
      await check.getByRole("button", { name: "Something’s wrong" }).click();
      await check.getByRole("button", { name: "Yes, something’s wrong" }).click();
      await expect(check).toContainText("Disputed. It’s held off the leaderboard until the committee settles it.", { timeout: 20_000 });
      const card = await prisma.scorecard.findFirstOrThrow({ where: { eventId: ids.event, stageId: ids.cardStage, playerId: ids.bram } });
      expect(card.status).toBe("disputed");
    });
  } finally {
    // A context Playwright already closed (a timed-out test) is not a second failure.
    await ailsa.ctx.close().catch(() => {});
    await bram.ctx.close().catch(() => {});
  }
  expect(errors).toEqual([]);
});

test("a match kept on stroke cards: the scorer keeps both balls, picked by name", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const ailsa = await newPhone(browser, baseURL!, errors, "Ailsa's phone, cards");
  const slotCard = async (slot: "A" | "B") =>
    JSON.parse((await prisma.matchScorecard.findFirst({ where: { matchId: ids.ballsMatch, slot }, select: { strokes: true } }))?.strokes ?? "[]") as (number | null)[];
  try {
    await test.step("Ailsa keeps the match: the round has no sheet of its own, so the match is the group", async () => {
      await openRound(ailsa.page, BALLS_CODE, AILSA);
      await expect(keeping(ailsa.page)).toHaveAttribute("data-keeping", "keeper", { timeout: 30_000 });
      await expect(keeping(ailsa.page)).toContainText("You're keeping score for your match.");
    });

    await test.step("she picks Bram's ball by name, and his card is the one written", async () => {
      const whose = ailsa.page.getByRole("group", { name: "Whose card" });
      await expect(whose.getByRole("button")).toHaveText([AILSA, BRAM]);
      await whose.getByRole("button", { name: BRAM }).click();
      await expect(whose.getByRole("button", { name: BRAM })).toHaveAttribute("aria-pressed", "true");
      await expect(ailsa.page.getByLabel("Strokes on hole 1")).toBeVisible();
      await ailsa.page.getByRole("button", { name: /Par$/ }).click();
      await expect.poll(async () => (await slotCard("B"))[0], { timeout: 15_000, message: "Bram's ball never reached his card" }).toBe(4);
      expect((await slotCard("A"))[0] ?? null, "Ailsa's own card took Bram's ball").toBeNull();
    });

    await test.step("and back to her own ball", async () => {
      const whose = ailsa.page.getByRole("group", { name: "Whose card" });
      await whose.getByRole("button", { name: AILSA }).click();
      await ailsa.page.getByRole("button", { name: /Birdie$/ }).click();
      await expect.poll(async () => (await slotCard("A"))[0], { timeout: 15_000 }).toBe(3);
      expect((await slotCard("B"))[0]).toBe(4);
    });
  } finally {
    await ailsa.ctx.close().catch(() => {});
  }
  expect(errors).toEqual([]);
});
