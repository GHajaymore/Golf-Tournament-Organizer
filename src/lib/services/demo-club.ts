import "server-only";
import { prisma } from "@/lib/db";
import { clubToday } from "@/lib/domain/club-clock";
import { formatDayRange } from "@/lib/domain/locale";
import { eventLinks } from "@/lib/domain/event-page";
import {
  DEMO_CLUB,
  DEMO_COURSE,
  DEMO_EVENTS,
  DEMO_FIELD,
  dayFrom,
  demoCard,
  demoClubName,
  demoGroups,
  demoShareTokens,
  demoStrokesDue,
  holesDueAt,
  minuteAtClub,
} from "@/lib/domain/demo-club";
import { writeScorecard } from "@/lib/services/scorecard-write";
import { settingsOf } from "@/lib/services/tournament";
import { ensureRoundCodes } from "@/lib/services/round-codes";
import { boardChanged } from "@/lib/services/board-refresh";

/**
 * THE DEMO CLUB'S ONE WRITER (2026-10-24). `domain/demo-club.ts` says what the
 * club is; this builds it, rebuilds it, and plays its day. The rules, and why:
 * `docs/claude/demo-club.md`.
 *
 * THREE PROMISES, each kept here rather than by whoever calls:
 *
 *  1. IT NEVER TOUCHES A CLUB THAT IS NOT THE DEMO. The club is found by its
 *     name and `isDemo` both. A club of that name WITHOUT the mark is refused,
 *     whole, before anything is written — a real club that happened to choose
 *     the name keeps every row. Every delete below is scoped to an organization
 *     id read back with `isDemo: true`.
 *  2. IT WRITES SCORES THROUGH THE APP'S OWN WRITER. `writeScorecard` is what
 *     the console and the round-code card call; the boards, the report and the
 *     scoring readers see the demo's cards exactly as they see a club's, and
 *     none of them has a branch for it.
 *  3. IT SENDS NOTHING. No call in this file reaches email, text or push, and
 *     the senders refuse the demo themselves besides (`demo-guard.ts`): the demo's players have no address at all, and its
 *     rows that need one are on `demo.example.invalid`.
 *
 * Nothing in production runs it but the owner's button on /owner and the replay
 * cron, and the build is the same function a test calls under its own mark.
 */

/** Said when the name is taken by a club that is not the demo. Nothing has been written. */
export const DEMO_NAME_TAKEN = "A club that is not the demo already has the demo club's name, so nothing was changed.";

/**
 * Which demo this server builds: the bare one in production, and a test's own
 * under `DEMO_CLUB_MARK` anywhere else — so a browser test's create and
 * refresh can never reach the demo a visitor is watching. Production ignores
 * the variable whatever it says.
 */
export function demoMark(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === "production") return "";
  return (env.DEMO_CLUB_MARK ?? "").trim();
}

/** The demo club this server builds, if it exists. Never a club without the mark. */
async function demoClub(mark: string) {
  return prisma.organization.findFirst({
    where: { name: demoClubName(mark), isDemo: true },
    select: { id: true, name: true, timeZone: true, updatedAt: true },
  });
}

export interface DemoStatus {
  built: boolean;
  /** When the demo was last built or refreshed. */
  builtAt: Date | null;
  /** The club's day the "playing now" medal is on, and how many holes are in. */
  day: string;
  holesIn: number;
  links: DemoLinks;
}

export interface DemoLinks {
  board: string;
  event: string;
  clubhouse: string;
  /** The finished championship's event page and report. */
  finishedEvent: string;
  report: string;
}

/** The demo's addresses: stable, because its share tokens are. */
export function demoLinks(mark: string): DemoLinks {
  const tokens = demoShareTokens(mark);
  const today = eventLinks(tokens.today);
  const finished = eventLinks(tokens.finished);
  return { board: today.board, event: today.event, clubhouse: today.clubhouse, finishedEvent: finished.event, report: finished.report };
}

/** What the owner's card and the /demo page show. Read-only. */
export async function demoStatus(mark: string): Promise<DemoStatus> {
  const links = demoLinks(mark);
  const club = await demoClub(mark).catch(() => null);
  if (!club) return { built: false, builtAt: null, day: "", holesIn: 0, links };
  const today = await prisma.event.findFirst({
    where: { organizationId: club.id, shareToken: demoShareTokens(mark).today },
    select: { stages: { select: { playedOn: true }, take: 1 }, scorecards: { select: { strokes: true } } },
  });
  const holesIn = (today?.scorecards ?? []).reduce(
    (n, c) => n + (JSON.parse(c.strokes) as (number | null)[]).filter((s) => typeof s === "number").length,
    0,
  );
  return { built: true, builtAt: club.updatedAt, day: today?.stages[0]?.playedOn ?? "", holesIn, links };
}

/** The round code of the "playing now" medal, for the QR that opens a player's card. "" until built. */
export async function demoRoundCode(mark: string): Promise<string> {
  const club = await demoClub(mark).catch(() => null);
  if (!club) return "";
  const stage = await prisma.stage.findFirst({
    where: { event: { organizationId: club.id, shareToken: demoShareTokens(mark).today } },
    select: { accessCode: true },
  });
  return stage?.accessCode ?? "";
}

export type DemoBuildResult = { ok: true; organizationId: string; links: DemoLinks } | { ok: false; error: string };

/**
 * BUILD THE DEMO CLUB, OR BUILD IT AGAIN FROM NOTHING — the owner's
 * "Demo club: create / refresh". Idempotent: whatever state the demo was left
 * in, it comes back the same club, the same two tournaments and the same two
 * links, with today's medal played up to the club's present minute.
 */
export async function buildDemoClub(input: { mark: string; at?: Date }): Promise<DemoBuildResult> {
  const at = input.at ?? new Date();
  const name = demoClubName(input.mark);

  // PROMISE 1: a club of this name that is not the demo stops everything here.
  const sameName = await prisma.organization.findMany({ where: { name }, select: { id: true, isDemo: true } });
  if (sameName.some((o) => !o.isDemo)) return { ok: false, error: DEMO_NAME_TAKEN };

  const tokens = demoShareTokens(input.mark);
  // And a board address held by some other club's tournament is not the demo's to take.
  const tokenHolders = await prisma.event.findMany({
    where: { shareToken: { in: [tokens.today, tokens.finished] } },
    select: { organization: { select: { isDemo: true, name: true } } },
  });
  if (tokenHolders.some((e) => !e.organization.isDemo || e.organization.name !== name)) return { ok: false, error: DEMO_NAME_TAKEN };

  const club = {
    name,
    kind: "club",
    shortName: DEMO_CLUB.shortName,
    city: DEMO_CLUB.city,
    region: DEMO_CLUB.region,
    country: DEMO_CLUB.country,
    timeZone: DEMO_CLUB.timeZone,
    locale: DEMO_CLUB.locale,
    currency: DEMO_CLUB.currency,
    currencySymbol: DEMO_CLUB.currencySymbol,
    moneyMode: "none",
    themeAppearance: "auto",
    isDemo: true,
  };
  const existing = sameName[0];
  const org = existing
    ? await prisma.organization.update({ where: { id: existing.id }, data: { ...club, defaultCourseId: null } })
    : await prisma.organization.create({ data: club });
  // Read back WITH the mark before anything is deleted under it.
  const orgId = (await prisma.organization.findFirstOrThrow({ where: { id: org.id, isDemo: true }, select: { id: true } })).id;

  // Clear the demo's own rows: its tournaments (and everything under them), then its course.
  await prisma.event.deleteMany({ where: { organizationId: orgId } });
  const courses = await prisma.course.findMany({ where: { organizationId: orgId }, select: { id: true } });
  await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
  await prisma.course.deleteMany({ where: { organizationId: orgId } });

  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: DEMO_COURSE.name,
      city: DEMO_CLUB.city,
      address: "",
      pars: JSON.stringify(DEMO_COURSE.pars),
      yards: JSON.stringify(DEMO_COURSE.yards),
      strokeIndex: JSON.stringify(DEMO_COURSE.strokeIndex),
    },
  });
  const tees = [];
  for (const [position, t] of DEMO_COURSE.tees.entries()) {
    tees.push(await prisma.tee.create({ data: { courseId: course.id, position, ...t } }));
  }
  await prisma.organization.update({ where: { id: orgId }, data: { defaultCourseId: course.id } });

  const today = clubToday(DEMO_CLUB.timeZone, at);
  await buildFinished(orgId, course.id, tees[0].id, tokens.finished, today, at);
  await buildToday(orgId, course.id, tees[0].id, tokens.today, today);
  await advanceDemoReplay({ mark: input.mark, at });
  return { ok: true, organizationId: orgId, links: demoLinks(input.mark) };
}

/** The columns both tournaments share. */
function eventBase(orgId: string, courseId: string, teeId: string, shareToken: string, start: string, end: string) {
  return {
    organizationId: orgId,
    dates: formatDayRange(start, end, DEMO_CLUB.locale),
    startOn: start,
    endOn: end,
    course: DEMO_COURSE.name,
    courseId,
    defaultTeeId: teeId,
    city: DEMO_CLUB.city,
    address: "",
    regDeadline: "",
    shareToken,
    shape: "single",
    format: "stroke",
    sideStyle: "individual",
    customPars: JSON.stringify(DEMO_COURSE.pars),
    customYards: JSON.stringify(DEMO_COURSE.yards),
    customStrokeIndex: JSON.stringify(DEMO_COURSE.strokeIndex),
    leaderboardVisibility: "public",
    // Players keep their own cards, as at a club day, so a visitor who opens a
    // card from the landing's QR can tap a score and see it save. What they
    // type lasts until the replay reaches that hole: the replay writes the
    // script over every hole a group has played (`demoStrokesDue`), so the
    // board a visitor watches is the club's day, not a stranger's taps.
    scoreEntryBy: "players",
    scoreApproval: "staff",
    playerAccess: "code",
    moneyMode: "none",
    capacity: DEMO_FIELD.length,
    tiebreakers: JSON.stringify(["toughest-6", "toughest-3", "lower-handicap"]),
  };
}

/** The field, entered: invented names, no addresses at all. */
async function enterField(eventId: string) {
  const players = [];
  for (const [seat, [name, handicap, gender]] of DEMO_FIELD.entries()) {
    players.push(
      await prisma.player.create({
        data: { eventId, name, handicap, handicapType: "18", gender, seed: seat + 1, status: "confirmed" },
        select: { id: true },
      }),
    );
  }
  return players;
}

function teeSheet(players: { id: string }[]) {
  return JSON.stringify({
    savedAt: new Date().toISOString(),
    startType: "tee",
    groups: demoGroups(players.length).map((g) => ({ name: g.name, startHole: 1, time: g.time, playerIds: g.players.map((i) => players[i].id) })),
  });
}

/**
 * THE FINISHED CHAMPIONSHIP: two rounds, four and three days ago, every card
 * written through `writeScorecard`, approved, the rounds closed and the
 * tournament completed — the states the committee's own presses leave.
 */
async function buildFinished(orgId: string, courseId: string, teeId: string, token: string, today: string, at: Date) {
  const [day1, day2] = [dayFrom(today, -4), dayFrom(today, -3)];
  const event = await prisma.event.create({
    data: { ...eventBase(orgId, courseId, teeId, token, day1, day2), name: DEMO_EVENTS.finished, status: "live", launchedAt: at },
  });
  const players = await enterField(event.id);
  const settings = settingsOf(event);
  for (const [position, day] of [day1, day2].entries()) {
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position,
        description: `Round ${position + 1}`,
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        nine: "full",
        courseId,
        teeId,
        scoringBasis: "net",
        playedOn: day,
        teeSheet: teeSheet(players),
        teeSheetPublished: true,
      },
    });
    for (const [i, p] of players.entries()) {
      await writeScorecard({
        eventId: event.id,
        stageId: stage.id,
        playerId: p.id,
        strokes: demoCard(`${token}:${position}`, i, DEMO_FIELD[i][1]),
        settings,
        role: "admin",
      });
    }
  }
  const done = new Date(at.getTime() - 3 * 24 * 60 * 60 * 1000);
  await prisma.scorecard.updateMany({
    where: { eventId: event.id },
    data: { status: "approved", approvedBy: "The committee", approvedAt: done },
  });
  await prisma.stage.updateMany({ where: { eventId: event.id }, data: { closedAt: done } });
  await prisma.event.update({ where: { id: event.id }, data: { status: "completed", completedAt: done } });
}

/** TODAY'S MEDAL: launched, drawn in threes from eight o'clock, nobody off yet. The replay plays it. */
async function buildToday(orgId: string, courseId: string, teeId: string, token: string, today: string) {
  const event = await prisma.event.create({
    data: { ...eventBase(orgId, courseId, teeId, token, today, today), name: DEMO_EVENTS.today, status: "live", launchedAt: new Date() },
  });
  const players = await enterField(event.id);
  await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      nine: "full",
      courseId,
      teeId,
      scoringBasis: "net",
      playedOn: today,
      teeSheet: teeSheet(players),
      teeSheetPublished: true,
    },
  });
  await ensureRoundCodes(event.id);
}

export type DemoReplayResult =
  | { ok: true; day: string; reset: boolean; holesWritten: number; cards: number }
  | { ok: false; reason: "no demo" | "no medal" };

/**
 * PLAY THE DEMO'S DAY UP TO NOW — the replay cron, every quarter of an hour.
 *
 * On a new day at the club (the first tick after its midnight) the medal
 * starts again: its cards are cleared and it is dated today, and the finished
 * championship moves with it so it is always "four days ago". Then every
 * group's card is written up to the holes it has played by the club's clock
 * (`holesDueAt`), through `writeScorecard`. A missed tick is made up by the
 * next, and a second tick in the same minute writes nothing.
 *
 * It only ever writes the demo club's events: the club is found with
 * `isDemo: true`, and every write is under that club's own tournaments.
 */
export async function advanceDemoReplay(input: { mark: string; at?: Date }): Promise<DemoReplayResult> {
  const at = input.at ?? new Date();
  const club = await demoClub(input.mark);
  if (!club) return { ok: false, reason: "no demo" };
  const tokens = demoShareTokens(input.mark);
  const event = await prisma.event.findFirst({
    where: { organizationId: club.id, shareToken: tokens.today },
    include: { stages: { orderBy: { position: "asc" }, take: 1 }, players: { orderBy: { seed: "asc" }, select: { id: true, seed: true, handicap: true } } },
  });
  const stage = event?.stages[0];
  if (!event || !stage) return { ok: false, reason: "no medal" };

  const zone = club.timeZone || DEMO_CLUB.timeZone;
  const today = clubToday(zone, at);
  let reset = false;
  if (stage.playedOn !== today) {
    reset = true;
    await prisma.scorecard.deleteMany({ where: { eventId: event.id } });
    await prisma.roundHandicap.deleteMany({ where: { stageId: stage.id } });
    await prisma.stage.update({ where: { id: stage.id }, data: { playedOn: today, closedAt: null } });
    await prisma.event.update({
      where: { id: event.id },
      data: { startOn: today, endOn: today, dates: formatDayRange(today, today, DEMO_CLUB.locale), status: "live", completedAt: null },
    });
    await redateFinished(club.id, tokens.finished, today);
  }

  const minute = minuteAtClub(zone, at) ?? 0;
  const stored = new Map(
    (await prisma.scorecard.findMany({ where: { stageId: stage.id }, select: { playerId: true, strokes: true } })).map((c) => [
      c.playerId,
      JSON.parse(c.strokes) as (number | null)[],
    ]),
  );
  const settings = settingsOf(event);
  let holesWritten = 0;
  let cards = 0;
  for (const group of demoGroups(event.players.length)) {
    const due = holesDueAt(group.teeMinute, minute, stage.holes);
    if (due === 0) continue;
    for (const i of group.players) {
      const player = event.players[i];
      if (!player) continue;
      const before = stored.get(player.id) ?? [];
      const script = demoCard(`${tokens.today}:${today}`, i, player.handicap);
      const next = demoStrokesDue(script, due, before);
      // Nothing to write when every played hole already reads the script.
      if (next.every((s, h) => s === (before[h] ?? null))) continue;
      try {
        await writeScorecard({ eventId: event.id, stageId: stage.id, playerId: player.id, strokes: next, settings, role: "admin" });
      } catch {
        // One card that will not take a write (say, locked) does not stop the rest of the field.
        continue;
      }
      holesWritten += next.filter((s, h) => s !== (before[h] ?? null)).length;
      cards += 1;
    }
  }
  if (reset || holesWritten > 0) {
    boardChanged(event.id);
    const finished = await prisma.event.findFirst({ where: { organizationId: club.id, shareToken: tokens.finished }, select: { id: true } });
    if (reset && finished) boardChanged(finished.id);
  }
  return { ok: true, day: today, reset, holesWritten, cards };
}

/** The championship stays "four and three days ago", whatever day it is now. */
async function redateFinished(orgId: string, token: string, today: string) {
  const event = await prisma.event.findFirst({
    where: { organizationId: orgId, shareToken: token },
    select: { id: true, stages: { orderBy: { position: "asc" }, select: { id: true } } },
  });
  if (!event) return;
  const days = [dayFrom(today, -4), dayFrom(today, -3)];
  for (const [i, s] of event.stages.entries()) {
    await prisma.stage.update({ where: { id: s.id }, data: { playedOn: days[i] ?? days[1] } });
  }
  await prisma.event.update({
    where: { id: event.id },
    data: { startOn: days[0], endOn: days[1], dates: formatDayRange(days[0], days[1], DEMO_CLUB.locale) },
  });
}
