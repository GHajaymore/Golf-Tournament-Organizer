import { test, expect } from "./coverage";
import { withScoreEntry, type ScoreEntryDay } from "./console/scoreEntry";
import { prisma, makeClub, dropClub, makeEvent, addDays, dayIn } from "./rounds-fixture";

/**
 * CLOSING A ROUND ON THE REDESIGNED SCORE ENTRY, IN THE THREE STAFF BRANCHES THE INDIVIDUAL ROUND IS NOT (B107, from the QA
 * gate on R12). The "Close Round n" section is built in every staff branch of the screen (an individual card, a team round,
 * a cup session, a match kept by tapping) and only the individual branch had a press-then-reload spec
 * (`closing-a-round-where-the-cards-are.spec.ts`, `a-lapsed-club-cannot-close-a-round.spec.ts`). A branch that left the
 * section out would leave its round closable nowhere, so each branch is pressed here as the secretary would, and seen again
 * on a fresh load:
 *
 *   - a TEAM EVENT round (a four-ball medal): the tick closes it, it reads closed after a reload, and no list of cards to
 *     come is drawn (a side's card is the side's, `cardsCounted` is false);
 *   - a CUP SESSION kept on stroke cards: a match in dispute REFUSES the close in words, where the tick was pressed, and the
 *     round is still open after a reload; once the dispute is settled the same tick closes it, kept after a reload;
 *   - a MATCH KEPT BY TAPPING: a four-ball session closes the same way (the refusal first), and a singles session, whose
 *     rounds have no place for a tick (match points), draws only the scoring window: no tick is offered, Keep it open is
 *     pressed and kept after a reload.
 *
 * "Settled" is set up in the database (the ruling itself is another screen's spec); the close is the press under test.
 * Each of these has one hole tapped or one side card in: a round nobody has played is ASKED about before it closes (B113, `closing-a-round-nobody-has-played.spec.ts`).
 * Each club is `zz-rd-close-*`, with invented names and `@example.invalid` addresses, dropped afterwards. Service workers
 * blocked. Memory: one browser context and one page at a time, about 150 MB.
 */

const ZONE = "UTC";

interface Seed {
  type: string;
  format: string;
  description?: string;
  matchKeptBy?: string;
  /** "sides": two sides of two with one match between them; "singles": one match between two players; "none": no match. */
  matches: "sides" | "singles" | "none";
  disputed?: boolean;
  /** A play-by date of yesterday, so the scoring window reads Closed by the date. */
  windowShut?: boolean;
  cup?: boolean;
  /** One hole tapped (or one card in) so the round has a RESULT: a round nobody has played is ASKED about before it closes (B113). */
  played?: boolean;
}

interface Built {
  day: ScoreEntryDay;
  stageId: string;
  matchId: string;
}

/** A launched event with ONE round, in the branch the seed names; the round's day is today at the club. */
async function build(mark: string, s: Seed): Promise<Built> {
  await dropClub(mark);
  const club = await makeClub(mark, { timeZone: ZONE });
  const today = dayIn(ZONE);
  const playedOn = s.windowShut ? addDays(today, -1) : today;
  const made = await makeEvent(club, s.cup ? "Cup" : "Team Event", {
    status: "live",
    stages: [{ type: s.type, format: s.format, scoringBasis: "gross", playedOn, deadline: s.windowShut ? playedOn : "" }],
    players: 4,
    flights: 2,
    event: s.cup ? { format: "match" } : {},
  });
  const stage = made.stages[0];
  await prisma.stage.update({
    where: { id: stage.id },
    data: { description: s.description ?? "", matchKeptBy: s.matchKeptBy ?? "", lineupPublished: true },
  });
  const [p0, p1, p2, p3] = made.players;
  let matchId = "";
  if (s.matches === "sides" || s.type === "Stroke Play Round") {
    const side = (name: string, flight: string, members: string[], seed: number) =>
      prisma.team.create({
        data: { eventId: made.event.id, stageId: stage.id, name, seed, members: { create: members.map((playerId, position) => ({ playerId, position })) } },
      });
    const sa = await side("Zz Rd Blues", made.flights[0].id, [p0.id, p1.id], 1);
    const sb = await side("Zz Rd Whites", made.flights[1].id, [p2.id, p3.id], 2);
    // A side's card with scores on it is the medal's RESULT (`roundsWithResultsFrom`); a round with none is asked about before it closes (B113).
    if (s.played && s.matches === "none") await prisma.teamScorecard.create({ data: { eventId: made.event.id, stageId: stage.id, teamId: sa.id, strokes: JSON.stringify(new Array(18).fill(4)) } });
    if (s.matches === "sides") {
      const carrier = await prisma.group.create({ data: { eventId: made.event.id, name: "Four-Ball - session 1", position: 5, stageId: stage.id, isCarrier: true } });
      matchId = (
        await prisma.match.create({
          data: {
            eventId: made.event.id, stageId: stage.id, groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: sa.id, teamBId: sb.id,
            holes: JSON.stringify(s.played ? ["A", ...new Array(17).fill(null)] : new Array(18).fill(null)), ...(s.disputed ? { scoreStatus: "disputed" } : {}),
          },
        })
      ).id;
    }
  }
  if (s.matches === "singles") {
    const carrier = await prisma.group.create({ data: { eventId: made.event.id, name: "Singles - session 1", position: 5, stageId: stage.id, isCarrier: true } });
    matchId = (
      await prisma.match.create({
        data: {
          eventId: made.event.id, stageId: stage.id, groupId: carrier.id, round: 1, playerAId: p0.id, playerBId: p2.id, teamAId: "", teamBId: "",
          holes: JSON.stringify(new Array(18).fill(null)), ...(s.disputed ? { scoreStatus: "disputed" } : {}),
        },
      })
    ).id;
  }
  const day: ScoreEntryDay = {
    club, eventId: made.event.id, round1: stage.id, round2: stage.id,
    returned: [], missing: { id: p3.id, name: p3.name }, zone: ZONE, today, yesterday: addDays(today, -1),
  };
  return { day, stageId: stage.id, matchId };
}

const closedAt = async (stageId: string) => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { closedAt: true } })).closedAt;


test.describe("@redesign closing a team event round on Score entry", () => {
  const MARK = "zz-rd-close-team";
  let built: Built;
  test.beforeAll(async () => {
    built = await build(MARK, { type: "Stroke Play Round", format: "Four-Ball", matches: "none", played: true });
  });
  test.afterAll(async () => {
    await dropClub(MARK);
  });

  test("the tick closes the four-ball round, no cards-to-come list is drawn, and it reads closed after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, built.day, async (screen, page) => {
      // The control: this is the strokes screen, not the tapped view.
      await expect(page.getByText("Kept by tapping who won each hole")).toHaveCount(0);
      const section = await screen.openClose();
      // The team branch drew the section: its tick, its window, and none of an individual round's cards to come.
      await expect(screen.closeLine()).toContainText("Close ");
      await expect(screen.finishedTick(section)).not.toBeChecked();
      await expect(section.locator("[data-missing-card]"), "a team round drew a list of cards to come").toHaveCount(0);
      expect(await closedAt(built.stageId)).toBeNull();

      await screen.finishedTick(section).click();
      await expect(screen.finishedTick(section)).toBeChecked();

      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      const again = await screen.openClose();
      await expect(screen.finishedTick(again)).toBeChecked();
      await expect(again.locator("[data-missing-card]")).toHaveCount(0);
      expect(await closedAt(built.stageId), "the round was not closed in the database").not.toBeNull();
    });
  });
});

test.describe("@redesign closing a cup session on Score entry", () => {
  const MARK = "zz-rd-close-cup";
  let built: Built;
  test.beforeAll(async () => {
    built = await build(MARK, { type: "Team Session", format: "Four-Ball", description: "Saturday four-balls", matchKeptBy: "cards", matches: "sides", disputed: true, cup: true, played: true });
  });
  test.afterAll(async () => {
    await dropClub(MARK);
  });

  test("a disputed match refuses the close where the tick was pressed, and once settled the tick closes it, kept after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    await withScoreEntry(browser, baseURL!, testInfo, built.day, async (screen, page) => {
      // The control: a cup session kept on stroke cards is not the tapped view.
      await expect(page.getByText("Kept by tapping who won each hole")).toHaveCount(0);
      const section = await screen.openClose();
      // The refusal, said in the section the press was in.
      await screen.finishedTick(section).click();
      await expect(section.getByRole("alert")).toContainText(/1 result in .+ is disputed, so the round can.t be closed yet/);
      await expect(screen.finishedTick(section), "the tick stayed ticked over a refusal").not.toBeChecked();
      expect(await closedAt(built.stageId), "a disputed round was closed").toBeNull();

      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).not.toContainText("is closed");
      const still = await screen.openClose();
      await expect(screen.finishedTick(still)).not.toBeChecked();

      // The committee settles it (set up in the database: the ruling is another screen's spec), and the same press now closes.
      await prisma.match.update({ where: { id: built.matchId }, data: { scoreStatus: "confirmed" } });
      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      const open = await screen.openClose();
      await screen.finishedTick(open).click();
      await expect(screen.finishedTick(open)).toBeChecked();

      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      const again = await screen.openClose();
      await expect(screen.finishedTick(again)).toBeChecked();
      expect(await closedAt(built.stageId), "the cup session was not closed in the database").not.toBeNull();
    });
  });
});

test.describe("@redesign closing a match kept by tapping on Score entry", () => {
  const FOUR = "zz-rd-close-tapfour";
  const ONE = "zz-rd-close-tapone";
  let four: Built;
  let one: Built;
  test.beforeAll(async () => {
    four = await build(FOUR, { type: "Team Session", format: "Four-Ball", description: "Sunday four-balls", matchKeptBy: "holes", matches: "sides", disputed: true, cup: true, played: true });
    one = await build(ONE, { type: "Team Session", format: "Match Play", description: "Sunday singles", matches: "singles", windowShut: true, cup: true });
  });
  test.afterAll(async () => {
    await dropClub(FOUR);
    await dropClub(ONE);
  });

  test("a tapped four-ball is refused while a match is disputed, then closes, and reads closed after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    await withScoreEntry(browser, baseURL!, testInfo, four.day, async (screen, page) => {
      // The tap view is the branch under test: it is the one that says who keeps the match.
      await expect(page.getByText("Kept by tapping who won each hole")).toBeVisible();
      const section = await screen.openClose();
      await screen.finishedTick(section).click();
      await expect(section.getByRole("alert")).toContainText(/1 result in .+ is disputed, so the round can.t be closed yet/);
      expect(await closedAt(four.stageId), "a disputed tapped round was closed").toBeNull();

      await prisma.match.update({ where: { id: four.matchId }, data: { scoreStatus: "confirmed" } });
      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      const open = await screen.openClose();
      await screen.finishedTick(open).click();
      await expect(screen.finishedTick(open)).toBeChecked();

      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      await expect(screen.closeLine()).toContainText("is closed");
      const again = await screen.openClose();
      await expect(screen.finishedTick(again)).toBeChecked();
      expect(await closedAt(four.stageId)).not.toBeNull();
    });
  });

  test("a tapped singles session has no tick, and Keep it open on its scoring window is kept after a reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await withScoreEntry(browser, baseURL!, testInfo, one.day, async (screen, page) => {
      await expect(page.getByText("Kept by tapping who won each hole")).toBeVisible();
      const section = await screen.openClose();
      // Match points: there is no place for closing to take, so the section is the window alone, and says so.
      await expect(screen.closeLine()).toContainText("Scoring window for ");
      await expect(screen.finishedTick(section), "a singles session offered the tick").toHaveCount(0);
      await expect(section).toContainText("Closed");
      await section.getByRole("button", { name: "Keep it open" }).click();
      // The label is drawn at once from the press (RoundDeadlineControl sets its own state first), so the screen cannot say the
      // save is kept: the stored override can. `false` is "extended past the date" (setStageDeadlineOverride, tournament.ts).
      await expect
        .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: one.stageId }, select: { deadlineOverride: true } })).deadlineOverride, {
          message: "Keep it open was not stored before the reload",
          timeout: 20_000,
        })
        .toBe(false);

      await screen.page.reload();
      await screen.page.getByRole("heading", { level: 1, name: "Score entry" }).waitFor({ state: "visible" });
      const again = await screen.openClose();
      await expect(again).toContainText("Extended past the deadline");
      await expect(again.getByRole("button", { name: "Keep it open" })).toBeDisabled();
      expect(await closedAt(one.stageId), "the window press closed the round").toBeNull();
    });
  });
});
