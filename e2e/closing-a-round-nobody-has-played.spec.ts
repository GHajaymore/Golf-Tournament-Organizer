import { test, expect } from "./coverage";
import type { Locator } from "@playwright/test";
import { withScoreEntry, type ScoreEntryDay } from "./console/scoreEntry";
import { prisma, makeClub, dropClub, makeEvent, addDays, dayIn } from "./rounds-fixture";

/**
 * A ROUND NOBODY HAS PLAYED IS ASKED BEFORE IT CLOSES, AND A MATCH ROUND'S CLOSE SECTION COUNTS MATCHES (B113, the Golf Pro's
 * ruling of 27 Nov 2026), pressed as the secretary does on Score entry, on a launched cup whose round is today:
 *
 *   - a tapped four-ball session with NO hole tapped: the tick shows the question beside it ("Nobody has played a hole in …
 *     Close it anyway? …"); Keep it open leaves the round open (after a reload too); the tick again and Close anyway closes it,
 *     and a reload reads it closed;
 *   - CONTROL: a session with one hole tapped closes on the first press, no question;
 *   - a session whose only match was CONCEDED (a forfeit is a result, `roundsWithResultsFrom`) closes on the first press;
 *   - a tapped four-ball with two matches, one won 3&2 and one not finished: the section reads "1 of 2 matches finished", the
 *     line beside the tick and the text behind the ⓘ are the match words, and no "card" or "place" is said anywhere in the
 *     section; the tick, then a reload, reads it closed;
 *   - CONTROL: a four-ball MEDAL (a Stroke Play Round) keeps the stroke words.
 *
 * WHAT THE SCREEN OFFERS FOR THESE FIXTURES (read in the source, never assumed): the close section is drawn by `closingFor`
 * (`src/app/(app)/entry/page.tsx`) for staff once `roundUnderWay` holds: a launched event and a round whose day is today
 * (`src/lib/domain/round-under-way.ts`). The tick is `RoundClosedControl`'s checkbox, disabled only while a save is pending or
 * while the question is open (`src/components/RoundClosedControl.tsx`: `disabled={pending || !!asking}`), so it is pressed once and
 * the question's two buttons (`RoundCloseAsk.tsx`, disabled only while pending) are the next presses. The question is the
 * group "Close the round anyway?" (`RoundCloseAsk`), NOT an alert. The ⓘ is "More about what closing a round does"
 * (`FieldInfo`), a button that opens a `role="note"`. On a phone the section is folded unless a card is to come: `openClose()`.
 *
 * Each club is `zz-rd-nobody-*`, with invented names and `@example.invalid` addresses, dropped afterwards. Service workers
 * blocked. Memory: one browser context and one page at a time, about 150 MB.
 */

const ZONE = "UTC";

interface Seed {
  type: string;
  matchKeptBy?: string;
  /** A cup (a match event) or a team medal. */
  cup?: boolean;
  /** One entry per match: the holes tapped so far (null = not played), or `forfeit` to record a concession. */
  matches: Array<{ holes?: Array<string | null>; forfeit?: boolean }>;
}

interface Built {
  day: ScoreEntryDay;
  stageId: string;
}

const blank = (): Array<string | null> => new Array(18).fill(null);

/** A launched cup with ONE four-ball round today, its matches as the seed names them. Two sides of two per match, from 8 entries. */
async function build(mark: string, s: Seed): Promise<Built> {
  await dropClub(mark);
  const club = await makeClub(mark, { timeZone: ZONE });
  const today = dayIn(ZONE);
  const made = await makeEvent(club, s.cup === false ? "Team Event" : "Cup", {
    status: "live",
    stages: [{ type: s.type, format: "Four-Ball", scoringBasis: "gross", playedOn: today }],
    players: 8,
    flights: 2,
    event: s.cup === false ? {} : { format: "match" },
  });
  const stage = made.stages[0];
  await prisma.stage.update({ where: { id: stage.id }, data: { description: "", matchKeptBy: s.matchKeptBy ?? "", lineupPublished: true } });
  const side = (name: string, members: string[], seed: number) =>
    prisma.team.create({ data: { eventId: made.event.id, stageId: stage.id, name, seed, members: { create: members.map((playerId, position) => ({ playerId, position })) } } });
  const carrier = await prisma.group.create({
    data: { eventId: made.event.id, name: "Four-Ball - session 1", position: 5, stageId: stage.id, isCarrier: true },
  });
  for (const [i, m] of s.matches.entries()) {
    const ps = made.players.slice(i * 4, i * 4 + 4);
    const blues = await side(`Zz Blues ${i + 1}`, [ps[0].id, ps[1].id], i * 2 + 1);
    const whites = await side(`Zz Whites ${i + 1}`, [ps[2].id, ps[3].id], i * 2 + 2);
    await prisma.match.create({
      data: {
        eventId: made.event.id, stageId: stage.id, groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: blues.id, teamBId: whites.id,
        holes: JSON.stringify(m.holes ?? blank()), ...(m.forfeit ? { forfeitedBy: blues.id } : {}),
      },
    });
  }
  const day: ScoreEntryDay = {
    club, eventId: made.event.id, round1: stage.id, round2: stage.id,
    returned: [], missing: { id: made.players[3].id, name: made.players[3].name }, zone: ZONE, today, yesterday: addDays(today, -1),
  };
  return { day, stageId: stage.id };
}

const closedAt = async (stageId: string) => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { closedAt: true } })).closedAt;
const question = (section: Locator) => section.getByRole("group", { name: "Close the round anyway?" });
const TAPPED_ONE_HOLE = (): Array<string | null> => ["A", ...new Array(17).fill(null)];
/** 3 up with 2 to play after 16 holes: won 3&2, so the match is over. */
const WON_3_AND_2 = (): Array<string | null> => [...new Array(3).fill("A"), ...new Array(13).fill("H"), null, null];
const UNFINISHED = (): Array<string | null> => [...new Array(4).fill("A"), ...new Array(14).fill(null)];
const NO_CARD_OR_PLACE = /\bcards?\b|\bplaces?\b/i;

test.describe("@redesign closing a tapped four-ball nobody has played", () => {
  const MARK = "zz-rd-nobody-empty";
  let built: Built;
  test.beforeAll(async () => {
    built = await build(MARK, { type: "Team Session", matchKeptBy: "holes", matches: [{}] });
  });
  test.afterAll(async () => {
    await dropClub(MARK);
  });

  test("the tick asks first; Keep it open leaves it open after a reload; Close anyway closes it, kept after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    await withScoreEntry(browser, baseURL!, testInfo, built.day, async (screen, page) => {
      // The tapped view is the branch under test.
      await expect(page.getByText("Kept by tapping who won each hole")).toBeVisible();
      const section = await screen.openClose();
      await expect(screen.finishedTick(section)).not.toBeChecked();

      await screen.finishedTick(section).click();
      // The question, beside the tick, in the server's words; nothing has been closed.
      await expect(question(section)).toContainText(/Nobody has played a hole in .+ yet\. Close it anyway\? If play was rained off, keep it open and change its day/);
      await expect(question(section).getByRole("button", { name: "Close anyway" })).toBeVisible();
      expect(await closedAt(built.stageId), "an unplayed round was closed without a word").toBeNull();

      await question(section).getByRole("button", { name: "Keep it open" }).click();
      await expect(question(section)).toHaveCount(0);
      await expect(screen.finishedTick(section)).not.toBeChecked();
      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).not.toContainText("is closed");
      expect(await closedAt(built.stageId), "Keep it open closed the round").toBeNull();

      const again = await screen.openClose();
      await screen.finishedTick(again).click();
      await expect(question(again)).toBeVisible();
      await question(again).getByRole("button", { name: "Close anyway" }).click();
      await expect(screen.finishedTick(again)).toBeChecked();

      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      const closed = await screen.openClose();
      await expect(screen.finishedTick(closed)).toBeChecked();
      await expect(question(closed)).toHaveCount(0);
      expect(await closedAt(built.stageId), "Close anyway did not close the round in the database").not.toBeNull();
    });
  });
});

test.describe("@redesign closing a tapped four-ball that has been played, or conceded, is not asked", () => {
  const PLAYED = "zz-rd-nobody-played";
  const CONCEDED = "zz-rd-nobody-conceded";
  let played: Built;
  let conceded: Built;
  test.beforeAll(async () => {
    played = await build(PLAYED, { type: "Team Session", matchKeptBy: "holes", matches: [{ holes: TAPPED_ONE_HOLE() }] });
    conceded = await build(CONCEDED, { type: "Team Session", matchKeptBy: "holes", matches: [{ forfeit: true }] });
  });
  test.afterAll(async () => {
    await dropClub(PLAYED);
    await dropClub(CONCEDED);
  });

  test("CONTROL: with one hole tapped the tick closes it on the first press, with no question", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, played.day, async (screen) => {
      const section = await screen.openClose();
      await screen.finishedTick(section).click();
      await expect(screen.finishedTick(section)).toBeChecked();
      await expect(question(section)).toHaveCount(0);
      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      expect(await closedAt(played.stageId)).not.toBeNull();
    });
  });

  test("a match conceded before play is a result: the tick closes it on the first press, with no question", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, conceded.day, async (screen) => {
      const section = await screen.openClose();
      await screen.finishedTick(section).click();
      await expect(screen.finishedTick(section)).toBeChecked();
      await expect(question(section)).toHaveCount(0);
      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      expect(await closedAt(conceded.stageId)).not.toBeNull();
    });
  });
});

test.describe("@redesign a match round's close section counts matches", () => {
  const CUP = "zz-rd-nobody-matches";
  const MEDAL = "zz-rd-nobody-medal";
  let cup: Built;
  let medal: Built;
  test.beforeAll(async () => {
    cup = await build(CUP, { type: "Team Session", matchKeptBy: "holes", matches: [{ holes: WON_3_AND_2() }, { holes: UNFINISHED() }] });
    // A four-ball MEDAL: a team event's Stroke Play Round, two sides of two. Nothing is pressed on it; only its words are read.
    medal = await build(MEDAL, { type: "Stroke Play Round", cup: false, matches: [] });
    const entries = await prisma.player.findMany({ where: { eventId: medal.day.eventId }, orderBy: { seed: "asc" }, select: { id: true } });
    for (const [i, name] of ["Zz Blues", "Zz Whites"].entries()) {
      await prisma.team.create({
        data: {
          eventId: medal.day.eventId, stageId: medal.stageId, name, seed: i + 1,
          members: { create: entries.slice(i * 2, i * 2 + 2).map((p, position) => ({ playerId: p.id, position })) },
        },
      });
    }
  });
  test.afterAll(async () => {
    await dropClub(CUP);
    await dropClub(MEDAL);
  });

  test("1 of 2 matches finished, the match words beside the tick and behind the ⓘ, no card or place; the tick closes it after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    await withScoreEntry(browser, baseURL!, testInfo, cup.day, async (screen) => {
      const section = await screen.openClose();
      await expect(screen.closeLine()).toContainText("1 of 2 matches finished");
      await expect(section.getByText("Tell the board this round's matches are over.")).toBeVisible();
      await section.getByRole("button", { name: "More about what closing a round does" }).click();
      const note = section.getByRole("note").filter({ hasText: "matches are over" });
      await expect(note).toContainText("A match that isn't finished keeps the holes it has, and the committee decides it.");
      // Nothing in the whole section, line, tick, ⓘ and window, says card or place.
      await expect(section).not.toContainText(NO_CARD_OR_PLACE);

      await screen.finishedTick(section).click();
      // 1 of 2 matches finished, and a tapped hole on both: played, so no question.
      await expect(screen.finishedTick(section)).toBeChecked();
      await expect(question(section)).toHaveCount(0);
      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      const again = await screen.openClose();
      await expect(screen.finishedTick(again)).toBeChecked();
      await expect(again).not.toContainText(NO_CARD_OR_PLACE);
      expect(await closedAt(cup.stageId)).not.toBeNull();
    });
  });

  test("CONTROL: a four-ball medal keeps the stroke words (the pattern above can fail)", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, medal.day, async (screen) => {
      const section = await screen.openClose();
      await expect(section.getByText("Tell the board the round is over.")).toBeVisible();
      await section.getByRole("button", { name: "More about what closing a round does" }).click();
      await expect(section.getByRole("note").filter({ hasText: "round is over" })).toContainText("Anybody without a complete card for it is then shown without a place");
      await expect(section).not.toContainText("matches are over");
      await expect(screen.closeLine()).not.toContainText("matches finished");
    });
  });
});
