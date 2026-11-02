import { playedOnBy } from "@/lib/services/courses";
import { screenMetadata } from "@/lib/screen-metadata";
import Link from "next/link";
import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { scoringMismatch } from "@/lib/domain/scoring-mismatch";
import { isHeadToHead, isPlayingRound, hasKnockoutStage } from "@/lib/stage-types";
import { loadEventState, parseMatchTiebreakers, playingStages, settingsOf } from "@/lib/services/tournament";
import { roundHandicapsFor, type RoundHandicapView } from "@/lib/services/round-handicap";
import { playersAnswer, resolveAttendance, tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { entitlementForEvent } from "@/lib/services/entitlements";
import { StagesClient } from "@/components/StagesClient";
import { SeasonDates } from "@/components/SeasonDates";
import { SetupNotices } from "@/components/SetupNotices";
import { cleanIsoDate, datedSaid } from "@/lib/domain/round-dates";
import { formatDay } from "@/lib/domain/locale";
import { formattingForEvent } from "@/lib/services/organization";
import { singleMatchFor, type SingleMatchView } from "@/lib/services/single-match";
import { resolveThirdPlace } from "@/lib/domain/third-place";
import type { ThirdPlaceView } from "@/components/StagesClient";
import { shapeOf, effectiveCapabilities } from "@/lib/tournament-shape";
import { unratedWarning } from "@/lib/services/handicaps";
import { roundsMissingCards } from "@/lib/services/round-card-lines";
import { missingCardsRefusal } from "@/lib/domain/round-card-status";
import { PRE_LAUNCH_STATUSES } from "@/lib/domain/lifecycle-state";
import { CardTrustNote } from "@/components/CardTrustNote";
import { cardTrustNote, parseIndex } from "@/lib/domain/card-trust";
import { pickedCardNote } from "@/lib/domain/picked-card";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { DescribeTournament } from "@/components/DescribeTournament";
import { SetupFlowRail, SetupFlowFooter } from "@/components/SetupFlowRail";
import { setupFlowFor } from "@/lib/services/setup-flow";
import { findFormat, needsTeams, sideSizeRange } from "@/lib/formats";
import { teamEntryChoices, resolveTeamEntry, sideOnlyCost, teamEntryFixedReason } from "@/lib/domain/team-entry";
import { effectiveAllowance, effectiveCountBest, recommendedAllowance, snakeDraw } from "@/lib/services/teams";
import type { RoundScoringInfo } from "@/components/RoundTeamScoring";
import { individualAllowanceFor } from "@/lib/round-allowance";
import { drawBrackets, isBracketMode } from "@/lib/domain/bracket";
import { dayAtClubForEvent } from "@/lib/services/club-clock";

/**
 * What a team round costs its sides in strokes, or null where the question
 * doesn't arise — an individual round has no side to price.
 *
 * Each control appears only for a format that actually uses it: the split for
 * formats scored by per-player shares, the count only where separate balls
 * are aggregated. Offering either to a format that ignores it would be a
 * control with nothing behind it.
 */
function teamScoringFor(s: {
  format: string;
  /** The round's type: a four-ball's recommended allowance depends on it. */
  type: string;
  handicapAllowance: number;
  allowanceWeights: number[];
  countBest: number;
  scoreInput: string;
  scoringBasis: string;
}): RoundScoringInfo | null {
  if (!needsTeams(s.format)) return null;
  const f = findFormat(s.format);
  const declared = f.weightsBySideSize?.[f.sideSize] ?? null;
  return {
    // Whose card this round is written on. Derived from the format's `ball`
    // rather than stored, so a shared-ball round can never be offered
    // per-player entry — there was no individual ball to record.
    entryChoices: teamEntryChoices(s.format, s.scoringBasis),
    entryMode: resolveTeamEntry(s.format, s.scoreInput, s.scoringBasis) ?? "side-only",
    sideOnlyCost: sideOnlyCost(s.format, s.scoringBasis),
    // Why there is no choice, where there is none — a net four-ball has no
    // choice for a different reason than a foursomes does.
    fixedReason: teamEntryFixedReason(s.format, s.scoringBasis),
    name: f.name,
    allowance: effectiveAllowance(s.format, s.handicapAllowance, s.type),
    recommendedAllowance: recommendedAllowance(s.format, s.type),
    allowanceOverridden: s.handicapAllowance > 0,
    allowanceIsConvention: !!f.allowanceIsConvention,
    recommendedShares: declared,
    shares: s.allowanceWeights.length === f.sideSize ? s.allowanceWeights : declared,
    sharesOverridden: s.allowanceWeights.length === f.sideSize,
    countBest: f.engine === "team-aggregate" ? effectiveCountBest(s.format, s.countBest) : null,
    countBestOverridden: s.countBest > 0,
    maxSide: sideSizeRange(s.format).max,
  };
}

export const metadata = screenMetadata("/stages");

export default async function StagesPage({ searchParams }: { searchParams: Promise<{ dated?: string; first?: string }> }) {
  const session = await requireScreen("stages");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  // "N rounds dated" — said in the notice the form sat in, which dating would otherwise remove
  // (`SeasonDates`). Words by the UI/UX designer and the golf professional, 2026-10-21.
  const sp = await searchParams;
  const datedCount = Number(sp?.dated);
  const datedFirst = cleanIsoDate(sp?.first ?? "");
  const dated =
    Number.isInteger(datedCount) && datedCount > 0 && datedFirst
      ? datedSaid(datedCount, formatDay(datedFirst, (await formattingForEvent(session.eventId)).locale))
      : "";
  const locked = isSetupLocked(state.event);
  // For "date the season": playing rounds, and how many of them have no day.
  const playingRounds = playingStages(state.stages);
  const playingCount = playingRounds.length;
  const seasonUndated = playingRounds.filter((s) => !cleanIsoDate(s.playedOn)).length;
  /**
   * Whether the event's Scoring can rank what these rounds produce.
   *
   * Playing rounds only. Every stage type is one now — the "Qualification
   * Stage", a cut rather than a round, was removed on 2026-09-11 — but the
   * filter stays: a type that is not played must never be scored against, and
   * that rule should outlive any one type.
   */
  const scoring = scoringMismatch(
    state.event.format,
    state.stages
      .filter((s) => isPlayingRound(s.type))
      .map((s) => ({ type: s.type, headToHead: isHeadToHead(s.type) })),
  );
  // Where this screen sits in setting the tournament up. Null for a match.
  const flow = await setupFlowFor(session.eventId);

  // League sign-up, resolved per round for the counts on each card. Declared
  // before the map that reads them — they used to sit below it, so every
  // render of this page threw "Cannot access 'attendanceMode' before
  // initialization". Because saving a score revalidates the whole layout,
  // that turned every score entry into a 500 and nothing could be entered.
  const attendanceMode = settingsOf(state.event).attendanceMode;
  const attendanceRows = tracksPerRound(attendanceMode as AttendanceMode)
    ? await prisma.roundAttendance.findMany({ where: { eventId: session.eventId } })
    : [];

  /**
   * A resolved view per Single Match Stage.
   *
   * Only those stages — every other kind has no entry, so the picker is
   * rendered by the presence of a view rather than by a second type check
   * that could drift from this one.
   */
  const singleMatches: Record<string, SingleMatchView> = {};
  for (const s of state.stages.filter((x) => x.type === "Single Match Stage")) {
    const view = await singleMatchFor(session.eventId, s.id);
    if (view) singleMatches[s.id] = view;
  }

  /**
   * The third-place view per Bracket Stage.
   *
   * Resolved from the winners bracket as it stands, so a corrected semi-final
   * changes who would play it — the same late reading the Single Match Stage
   * uses, and for the same reason.
   */
  const thirdPlaces: Record<string, ThirdPlaceView> = {};
  for (const s of state.stages.filter((x) => x.type === "Bracket Stage")) {
    // In flights there is no play-off for third at all (see `setThirdPlace`), and the reason is said
    // where the control is rather than discovered by pressing it.
    const r = state.brackets.draws
      ? { problem: "A knockout in several flights has no play-off for third: each flight's beaten semi-finalists share third.", pairing: null }
      : resolveThirdPlace(state.brackets.winners);
    const made = await prisma.match.count({ where: { eventId: session.eventId, stageId: s.id, round: 0 } });
    thirdPlaces[s.id] = {
      on: s.thirdPlace,
      problem: r.problem,
      aName: r.pairing?.a.name ?? "",
      bName: r.pairing?.b.name ?? "",
      made: made > 0,
    };
  }

  /**
   * What each player plays off, per round.
   *
   * Only for rounds the field actually plays — a handicap is something a card
   * is priced with, and a cut or a bracket seeding round has no card. Resolved
   * on the server through the same reader the board uses, so the number an
   * organizer is shown is the number their scores are being worked out from.
   */
  const roundHandicaps: Record<string, RoundHandicapView[]> = {};
  for (const s of playingStages(state.stages)) {
    roundHandicaps[s.id] = await roundHandicapsFor(session.eventId, s.id);
  }

  const stages = state.stages.map((s) => ({
    id: s.id,
    position: s.position,
    type: s.type,
    description: s.description,
    format: s.format,
    holes: s.holes,
    playedOn: s.playedOn,
    deadline: s.deadline,
    scoringBasis: s.scoringBasis,
    // How scores are RECORDED, as opposed to how they are scored. "" means
    // the round takes whatever its format declares.
    scoreInput: s.scoreInput,
    // How players keep the round's matches — read through `matchKeptBy`.
    matchKeptBy: s.matchKeptBy,
    // Whether the organizer has declared the round over. A boolean across the
    // wire because the screen only asks whether, not when — the timestamp is
    // kept for the record and read where that matters.
    closed: s.closedAt !== null,
    carryEnabled: s.carryForwardEnabled,
    carryPct: s.carryForwardPct,
    carryAsked: s.carryForwardAsked,
    cutEnabled: s.cutEnabled,
    cutMode: s.cutMode,
    cutCount: s.cutCount,
    cutPercent: s.cutPercent,
    cutScope: s.cutScope,
    cutTies: s.cutTies,
    deadlineOverride: s.deadlineOverride,
    optDeadline: s.optDeadline,
    // What a team round costs its sides in strokes. Computed here, on the
    // round, because these are settings *of the round* — they used to sit on
    // the Teams screen behind a second round selector, so a format was chosen
    // in one place and priced in another.
    teamScoring: teamScoringFor(s),
    // And what an INDIVIDUAL net round plays at, with the control to change it.
    allowance: individualAllowanceFor(s),
    handicaps: roundHandicaps[s.id] ?? [],
    attendance: !tracksPerRound(attendanceMode as AttendanceMode)
      ? null
      : (() => {
            const resolved = resolveAttendance(
              attendanceMode,
              state.confirmed.map((p) => p.id),
              attendanceRows
                .filter((r) => r.stageId === s.id)
                .map((r) => ({ playerId: r.playerId, status: r.status, decidedBy: r.decidedBy })),
            );
            return {
              in: resolved.in,
              out: resolved.out,
              inByDefault: resolved.inByDefault,
              playersAnswer: playersAnswer(attendanceMode as AttendanceMode),
            };
          })(),
    matchCount: state.matches.filter((m) => m.stageId === s.id).length,
    courseId: s.courseId,
    nine: s.nine,
  }));

  // Venues this tournament may be played on — more than one turns on the
  // per-round course picker.
  /**
   * ROUNDS THE FORMAT CANNOT SCORE, said while they are being built (Ajay,
   * 2026-09-28). The same reader and the same sentence launch refuses with —
   * `roundsMissingCards` and `missingCardsRefusal` — so this screen cannot
   * pass a round the Launch button then stops on.
   */
  // Before launch only: the sentence is about launching, and once a
  // tournament is live score entry's own prompt says the same thing where
  // the card is needed.
  const missingCardsNote = PRE_LAUNCH_STATUSES.includes(state.event.status)
    ? missingCardsRefusal(await roundsMissingCards(session.eventId))
    : null;
  const venueRows = await prisma.course.findMany({
    where: { ...playedOnBy(session.eventId) },
    // Provenance with the name: this is the screen that decides which card a
    // round is scored against, so it is the screen that should say whether
    // anybody has ever checked that card. See domain/card-trust.ts.
    // `strokeIndex` with the rest: since 2026-09-19 the directory importer
    // keeps a card whose index is missing rather than throwing the pars away,
    // so "this course has no stroke index" is a state a club can be in — and
    // it is the one that makes every net score wrong rather than doubtful.
    select: { id: true, name: true, source: true, verifiedAt: true, verifiedBy: true, strokeIndex: true, pars: true },
    orderBy: { name: "asc" },
  });
  // And the round's course picker says it again the moment one is chosen.
  // The day a card was checked, as the club writes a day — see `dayAtClubForEvent`.
  const dayAtClub = await dayAtClubForEvent(session.eventId);
  const venues = venueRows.map((v) => ({ ...v, cardNote: pickedCardNote(v, undefined, dayAtClub) }));
  /**
   * Net scoring on unrated tees, asked of EVERY round: this asked the first Round
   * Robin round and fell back to "gross", so a net MEDAL — which has no Round
   * Robin at all — was never told its handicaps were approximate, and neither was
   * a mixed tournament whose round robin happened to be gross. One line in
   * `SetupNotices` now; it was a card of its own inside the round list.
   */
  const handicapWarning = await unratedWarning(session.eventId, state.stages);

  // Matches per player in a round robin = (largest flight size − 1).
  const flightSizes = state.groups.map(
    (g) => state.confirmed.filter((p) => p.groupId === g.id).length,
  );
  const rrMatchesPerPlayer = Math.max(0, (flightSizes.length ? Math.max(...flightSizes) : 0) - 1);

  /**
   * Built once, placed once.
   *
   * The entitlement behind it is a query, so writing the element into both
   * branches below would run that query twice to render it in one place.
   */
  /**
   * ONLY WHERE THE CLUB HAS IT (2026-10-16). Drafting is off on every plan, so
   * every club saw a "Coming soon" panel in the middle of setting up its rounds —
   * walked as a new organizer, clutter at the moment of most confusion, offering
   * nothing to do. Ajay asked for this screen to be simple. Other locked features
   * still show themselves; this one has no plan to point to yet.
   */
  const describeTournament =
    locked || !(await entitlementForEvent(session.eventId, "aiAssist")).allowed ? null : <DescribeTournament available />;

  return (
    <>
      <SetupFlowRail flow={flow} href="/stages" />
      {/* The title alone (2026-10-16, "redundancies"): "Set up" is the strip above
          and the sidebar's heading, and the subtitle described the list below it. */}
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Rounds &amp; formats</h1>
        {/* A SOCIETY OFTEN CHOOSES THE FORMAT ONCE IT KNOWS THE NUMBERS (Ajay,
            2026-10-16: "sometimes it's hard to set up a round or format unless they
            know how many signed up"). So the way round is offered before a round
            exists, and the number is in front of them once people have entered. The
            entry form already says "Format to be confirmed" with no round. */}
        {state.confirmed.length > 0 ? (
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
            <Link href="/registration" style={{ color: "var(--color-accent-200)" }}>{state.confirmed.length} entered</Link>
            {state.stages.length === 0
              ? ` — ${formatsThatSuit(state.confirmed.length)}.`
              : PRE_LAUNCH_STATUSES.includes(state.event.status)
                ? " so far."
                : "."}
          </p>
        ) : state.stages.length === 0 ? (
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
            Waiting to see how many sign up?{" "}
            <Link href="/registration" style={{ color: "var(--color-accent-200)" }}>Take entries first</Link> — the entry form says &ldquo;Format to be confirmed&rdquo; until you choose.
          </p>
        ) : null}
      </div>
      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />
      {/* A way IN to the builder rather than an alternative to it — whatever
          it proposes lands as ordinary rounds on the cards below, editable
          like any other. That is why it sits above them.

          BUT ONLY WHILE THERE IS NOTHING TO BE ABOVE. A way in belongs where
          you start; once the tournament has rounds it is no longer an
          entrance, and leaving it first put a panel about drafting — locked
          entirely, on the free plan — between the page title and the rounds
          the page exists to show. On a phone that is most of a screen before
          Round 1. Below the list it is still offered and still does the same
          thing, which is the whole of the change: same component, same props,
          same behaviour, a different place on the page depending on whether
          the organizer has started. */}
      {/* THE SAME WARNING THE LEADERBOARD CARRIES, on the screen that creates
          the disagreement.

          The leaderboard is where the harm shows — an empty board over four
          returned cards — but by then the round has been played. Here the
          rounds are being chosen, so a sentence about how they will be scored
          is advice rather than a post-mortem. One rule, in
          `scoringMismatch`, so the two cannot come to say different things. */}
      {!locked && stages.length === 0 && describeTournament}
      {/* EVERYTHING LEFT TO SORT OUT, IN ONE CARD (2026-10-16) — `SetupNotices`.
          These were five cards stacked above the rounds, and on a ten-round
          league at 375px the first round began 950px down. Each is still
          named on the screen, one line each, its reason a tap away:

            the Scoring setting   the same warning the leaderboard carries, on
                                  the screen that creates the disagreement —
                                  one rule, in `scoringMismatch`
            a course card         the sentence launch refuses with
            no dates              a round without a day is off the players'
                                  availability calendar (two or more rounds)
            approximate handicaps net scoring on unrated tees
            an unchecked card     a wrong stroke index is invisible; nothing
                                  is refused */}
      <SetupNotices
        items={[
          ...(scoring
            ? [{
                key: "scoring",
                tone: "block" as const,
                // The rounds score and rank by their own formats; what the setting
                // still decides is a draw or cut made from the standings.
                title: "The Scoring setting does not match these rounds.",
                body: (
                  <>
                    {scoring.message}{" "}
                    <Link href="/event" style={{ color: "var(--color-accent-200)" }}>Tournament details</Link>
                  </>
                ),
              }]
            : []),
          ...(missingCardsNote
            ? [{
                key: "cards",
                tone: "block" as const,
                title: "A course card is missing",
                body: (
                  <>
                    {missingCardsNote}{" "}
                    <Link href="/event" style={{ color: "var(--color-accent-200)" }}>Open the course library</Link>
                  </>
                ),
              }]
            : []),
          ...(seasonUndated > 0 && playingCount >= 2 && !dated
            ? [{
                key: "dates",
                tone: "note" as const,
                title: `${seasonUndated} ${seasonUndated === 1 ? "round has" : "rounds have"} no date`,
                body: <SeasonDates undated={seasonUndated} suggestedStart={state.today} bare />,
              }]
            : []),
          // The same line, kept as the answer once the rounds are dated (same key, so it stays open).
          ...(dated
            ? [{
                key: "dates",
                tone: "note" as const,
                title: `${datedCount} ${datedCount === 1 ? "round" : "rounds"} dated`,
                body: (
                  <>
                    <p role="status" style={{ margin: 0 }}>{dated}</p>
                    <Link href="/stages" scroll={false} className="btn btn-secondary btn-sm" style={{ marginTop: 8, minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                      OK
                    </Link>
                  </>
                ),
              }]
            : []),
          // One notice per cause: with no course card there is no rating either, and the
          // card notice already says what to do (2026-10-16, "redundancies").
          ...(handicapWarning && !missingCardsNote
            ? [{
                key: "handicaps",
                tone: "note" as const,
                title: "Handicaps are approximate",
                body: (
                  <>
                    {handicapWarning} Add tees with a rating and slope under the course on{" "}
                    <Link href="/event" style={{ color: "var(--color-accent-200)" }}>Tournament details</Link>.
                  </>
                ),
              }]
            : []),
          ...venues
            .map((v) => ({ venue: v, si: parseIndex(v.strokeIndex) }))
            .filter(({ venue, si }) => cardTrustNote(venue, new Date(), undefined, si)?.warn)
            .map(({ venue, si }) => ({
              key: `card-${venue.id}`,
              tone: "note" as const,
              title: `${venue.name}: check its card`,
              body: <CardTrustNote card={venue} fix={`/event?course=${venue.id}`} strokeIndex={si} formatDate={dayAtClub} />,
            })),
        ]}
      />
      <StagesClient
        stages={stages}
        // Today AT THE CLUB, from the server, so the browser's render asks the
        // same day — and it is the day the deadline is a deadline in.
        today={state.today}
        // The lock the banner above states; the actions behind most controls
        // refuse it by throwing, so the controls have to know it too.
        locked={locked}
        // Whether play has begun at all: the controls about PLAY wait for it.
        launched={!PRE_LAUNCH_STATUSES.includes(state.event.status)}
        // The knockout's arrangement, chosen on the round that is the knockout —
        // the same reading of the stored mode the Bracket screen makes.
        arrangement={(() => {
          const mode = isBracketMode(state.event.bracketMode) ? state.event.bracketMode : "split";
          return { mode, secondLabel: drawBrackets([], mode).secondLabel, canChange: session.viewRole === "admin" };
        })()}
        // Staff, as `setStageCourse` is since Ajay's decision of 2026-09-27.
        canSetVenue={session.viewRole === "admin" || session.viewRole === "assistant"}
        singleMatches={singleMatches}
        thirdPlaces={thirdPlaces}
        venues={venues}
        // The tournament's own course, for the rounds that name none. Never
        // shown on a one-venue tournament; the moment a club plays a round
        // somewhere else, "Round 1" and "Round 3" have to say WHICH, and a
        // round with no `courseId` is on this one.
        homeVenue={state.event.course?.trim() || ""}
        activeStageId={state.activeStage?.id ?? null}
        roundsWithResults={[...state.roundsWithResults]}
        chainsRounds={
          effectiveCapabilities(shapeOf(state.event.shape), {
            roundCount: state.stages.length,
            // "Does this tournament have a knockout", which is the question
            // `hasKnockoutStage` answers for every other reader. Spelling the
            // type out here was the fifth copy `knockout-readers.test.ts`
            // exists to catch, and it caught it.
            hasBracketStage: hasKnockoutStage(state.stages),
          }).chainsRounds
        }
        matchTiebreakers={parseMatchTiebreakers(state.event.matchTiebreakers)}
        rrMatchesPerPlayer={rrMatchesPerPlayer}
        scoring={{
          winPts: state.scoring.winPts,
          tiePts: state.scoring.tiePts,
          lossPts: state.scoring.lossPts,
          holeRatioPts: state.scoring.holeRatioPts,
          bonusPts: state.scoring.bonusPts,
          maxPerMatch: state.scoring.maxPerMatch,
        }}
        tiebreakers={state.scoring.tiebreakers}
        qual={{
          mode: state.event.qualifyMode,
          perFlight: state.event.qualifyPerGroup,
          overall: state.event.qualifyOverall,
        }}
        flightCount={state.groups.length}
        confirmedCount={state.confirmed.length}
      />
      {/* The other half of the placement decision above: offered after the
          rounds once there are rounds, so it stays available without leading. */}
      {!locked && stages.length > 0 && describeTournament}
      <SetupFlowFooter flow={flow} href="/stages" />
    </>
  );
}

/**
 * WHAT SUITS THE NUMBER ENTERED, in one line, for a society choosing its format
 * once it knows how many signed up (2026-10-16; the golf professional and the
 * tournament director on the review panel: "a single next line, not a format
 * catalogue"). The scramble's sides come from the draw the app will make
 * (`snakeDraw`, sides of 2 to 4 aiming at 4), so the line cannot promise sides it
 * would not draw.
 */
function formatsThatSuit(n: number): string {
  const parts = ["suits a Stableford"];
  if (n >= 4) {
    const pairs = Math.floor(n / 2);
    parts.push(`pairs better-ball (${pairs} pairs${n % 2 ? ", one player alone — or add one" : ""})`);
  }
  if (n >= 6) {
    const sides = snakeDraw(Array.from({ length: n }, (_, i) => ({ id: String(i), handicap: 0 })), 4, { min: 2, max: 4 })
      .map((side) => side.length)
      .sort((a, b) => b - a);
    parts.push(`a Texas scramble (sides of ${sides.join(", ")})`);
  }
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : parts[0];
}
