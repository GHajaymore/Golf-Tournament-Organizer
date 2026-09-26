import { screenMetadataForEvent } from "@/lib/screen-metadata";
import Link from "next/link";
import { roundLabel, roundNameFor, roundNumber } from "@/lib/domain/round-label";
import { reviewQueueDetail } from "@/lib/domain/review-queue";
import { requireState } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { StatCard, FactCard } from "@/components/PageHeader";
import { LifecycleBar } from "@/components/LifecycleBar";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard, canEnterScores } from "@/lib/tournament-settings";
import { showBracket, bracketBadge } from "@/lib/bracket-visibility";
import { standingRows } from "@/lib/services/tournament";
import { usesStandardBoard } from "@/lib/formats";
import { pts, shortName, distinctLabels, plural } from "@/lib/format";
import { toParText } from "@/lib/domain";
import { RoundAvailability } from "@/components/RoundAvailability";
import { todayIso } from "@/lib/deadline";
import { isStablefordRound } from "@/lib/domain/week-basis";
import { availabilityFor } from "@/lib/services/availability";
import { parseTeeSheet, groupForPlayer, type TeeSheet } from "@/lib/domain/tee-sheet";
import { currentRoundCut } from "@/lib/domain/cut";
import { bracketScreenName } from "@/lib/domain/bracket-name";
import { navForRole, screenName } from "@/lib/nav";
import { hasKnockoutStage, isKnockoutRound, isPlayingRound, isWeeklyRound } from "@/lib/stage-types";
import { launchRefusal, finishRefusal } from "@/lib/domain/phase-gate";
import { nextLifecycleAction } from "@/lib/domain/lifecycle-state";
import { TEAM_FORMAT_NAMES } from "@/lib/formats";
import { SetupChecklist } from "@/components/SetupChecklist";
import { setupChecklist, isUnstarted, clubBrandingState } from "@/lib/services/checklist";
import { setupFlowFor } from "@/lib/services/setup-flow";
import { isMatch } from "@/lib/tournament-shape";
import { RoundExpiryBanner } from "@/components/RoundExpiryBanner";
import { expiryNotice, hoursLeft } from "@/lib/domain/round-expiry";
import { OrgSetupChecklist } from "@/components/OrgSetupChecklist";
import { orgSetupFactsFor } from "@/lib/services/organization";
import { placesWithin } from "@/lib/domain/flight-places";
import { announcementsFor } from "@/lib/services/announcements";
import { AnnouncementList } from "@/components/AnnouncementList";
import { orgSetupState } from "@/lib/domain/org-setup";
import { Icon } from "@/components/Icon";
import { CasualRoundPanel } from "@/components/CasualRoundPanel";

/**
 * Shortcuts into the sidebar, with the dashboard's own shorter labels.
 *
 * Which of these actually appear is decided by the sidebar (see below), never
 * here. This list used to gate itself, and drifted twice as a result: it kept
 * offering Scorecards after that screen was retired into the tee sheet, and
 * kept offering Qualification and Bracket to tournaments with no knockout to
 * qualify for — the exact doors-to-empty-rooms the sidebar had already closed.
 */
/**
 * NO LABELS HERE. The name of a screen comes from the sidebar, once.
 *
 * These carried their own: "Players", "Rounds", "Prizes", "Reports" — for
 * screens the sidebar calls Registration & field, Rounds & formats, Prizes &
 * payouts and Reports & export. Four screens with two names each, and both
 * names appear on THIS page at the same time: the setup checklist above says
 * "Registration & field" and a tile a few inches below says "Players", and
 * they are the same link.
 *
 * `nav.ts` already states the rule and grants exactly one exception — the
 * phone's tab bar, whose "Board" and "Scores" exist because a tab is 80px
 * wide — and says of it: "confined to this list so it cannot spread". This is
 * where it had spread to.
 *
 * `/qualification` is gone with them. It is a redirect to `/bracket` now, not
 * a screen, so it is not in the sidebar — which meant `navHrefs.has()` had
 * already filtered this tile out, and it had rendered for nobody since the
 * two screens were merged.
 */
const QUICK_ACTIONS = [
  { href: "/registration", icon: "ph ph-user-plus", staff: true },
  { href: "/grouping", icon: "ph ph-squares-four", staff: true },
  { href: "/stages", icon: "ph ph-stack", staff: true },
  { href: "/foursomes", icon: "ph ph-users-four", staff: true },
  { href: "/bracket", icon: "ph ph-tree-structure", staff: true },
  { href: "/announcements", icon: "ph ph-megaphone", staff: true },
  { href: "/prizes", icon: "ph ph-trophy", staff: true },
  { href: "/reports", icon: "ph ph-export", staff: true },
];

export const generateMetadata = () => screenMetadataForEvent("/dashboard");

export default async function DashboardPage() {
  const { session, state } = await requireState();
  const { event, groupStandings, advancingCount, overallCutoff, brackets } = state;

  /**
   * The venues attached to this tournament, for the line under the title.
   *
   * That line read `event.course` and nothing else, so a tournament whose
   * venue was set through the COURSE LIBRARY — the checkbox list on
   * Tournament details, which is how a club picks from its own courses and
   * the only way a league that rotates them can say anything at all — was
   * greeted every time with "No dates or venue set yet".
   *
   * The app disagreed with itself about the same tournament: setup counted it
   * as venued (`venued` is `event.course || venues > 0`, and generously so on
   * purpose), the dashboard said there was no venue, and both were reading the
   * same event. Read off one on 2026-09-09 after ticking a course.
   *
   * Only asked when the free-text field is empty, so nothing changes for a
   * tournament that names its course the ordinary way.
   */
  const attachedVenues = event.course.trim()
    ? []
    : (
        await prisma.course.findMany({
          where: { events: { some: { eventId: event.id } } },
          select: { name: true },
          orderBy: { name: "asc" },
        })
      ).map((c) => c.name);

  /**
   * Flight-standings labels, decided across the whole card.
   *
   * `shortName` gives "Dave S." to Dave Sherman and Dave Salt alike, and this
   * card highlights the rows that are advancing — so two identical names, one
   * highlighted and one not, say nothing about which Dave is through.
   */
  const rankedAll = groupStandings.flatMap((gs) => gs.ranked);
  const standingLabels = new Map(
    distinctLabels(rankedAll.map((r) => r.player.name), shortName).map(
      (label, i) => [rankedAll[i].player.id, label] as const,
    ),
  );

  /**
   * The flight columns, ON THE MEASURE THE TOURNAMENT IS ACTUALLY RANKED BY.
   *
   * This card read `groupStandings`, which ranks by MATCH POINTS. On a medal
   * nobody has any, so every figure printed 0 and the order fell through to
   * the tiebreak chain — while the highlighting beside it came from
   * `advancingIds`, which the engine correctly derives from the stroke
   * standings. One card, two measures, disagreeing about the same flight.
   *
   * Measured on 2026-09-09, on a four-player medal with every card in: the
   * board above this said -1, E, +2, +4, and this card said 0, 0, 0, 0. The
   * ORDER happened to agree that day, which is the part worth being careful
   * about — with every total equal, the sequence is whatever the match
   * tiebreak chain settles on, and agreeing with the leaderboard is a
   * coincidence rather than a property. It is a wrong answer waiting for a
   * different field, printed under a heading that says standings.
   *
   * `strokeStandings` is already sorted and ranked, so filtering it per flight
   * keeps the engine's order rather than inventing a second one — the same
   * reason qualification reads it too.
   *
   * IT KEPT THE ORDER AND THEN REINVENTED THE NUMBER. This mapped
   * `rank: s.ranked ? i + 1 : 0`, so two players in a flight that the engine
   * had ranked level were printed 1 and 2 — the paragraph above being right
   * about the order and silent about the place.
   *
   * The match branch below never had it: `groupStandings` runs
   * `computeStandings` over the group alone, so `r.rank` is already the flight
   * place with its ties intact. The two halves of one card answered "what
   * place in this flight" differently.
   *
   * `placesWithin` is the same rule the board's by-flight view and the flight
   * results CSV use. Unranked rows still report 0 — a player with no card has
   * no place, and that is a different statement from being last.
   */
  // The board's answer, like the table beneath it. `placesWithin` is fed from
  // `strokeStandings`, which now holds the cards of the round on the board —
  // so a flight card headed by match points under a leaderboard ranked on
  // strokes was the same screen contradicting itself.
  /**
   * A STABLEFORD BOARD PRINTS POINTS, on this card as on the board above it.
   *
   * The card printed a to-par whatever the round was ranked on, so a
   * Stableford flight came out sorted by points and printing strokes: found
   * 2026-09-26 on a newcomer's club Stableford, Flight 1 read "+18, +18, E,
   * +18" — the level-par round third, behind two players eighteen over, in
   * points order that nothing on the card printed. The rule every board
   * follows: the figure printed is the figure the rows are ordered by. Same
   * test (`isStablefordRound`) the leaderboard card above uses.
   */
  const stablefordBoard = isStablefordRound(state.boardStage?.scoringBasis, state.boardStage?.format);
  const flightColumns = state.boardIsStroke
    ? state.groups.map((group) => ({
        group,
        ranked: placesWithin(state.strokeStandings.filter((s) => s.player.groupId === group.id))
          .map((s) => ({
            player: s.player,
            rank: s.ranked ? s.rank : 0,
            // To-par where there is a par, net where there is not — never the
            // gross wearing a plus sign. `toParShown` follows the board's basis
            // (net to-par on a net board); reading `toPar` here printed the
            // gross, so this card disagreed with the leaderboard above it.
            figure:
              s.thru > 0
                ? stablefordBoard
                  ? `${s.points} pts`
                  : s.parKnown
                    ? toParText(s.toParShown)
                    : `${s.net}`
                : "—",
          })),
      }))
    : groupStandings.map((gs) => ({
        group: gs.group,
        ranked: gs.ranked.map((r) => ({
          player: r.player,
          rank: r.rank,
          figure: pts(r.stats.totalPoints),
        })),
      }));

  /**
   * Whether the round ON THE BOARD is scored by SIDES rather than players.
   *
   * `boardStage`, because its one reader is the empty note under
   * `LeaderboardTable` — which is showing the board's rows. Asked of
   * `activeStage` it explained the absence of rows by describing a different
   * round's format.
   */
  const teamRound = TEAM_FORMAT_NAMES.includes(state.boardStage?.format ?? "");

  /* `matchProgress` is gone from this screen. Its one reader here was the
     lifecycle bar's result count, and it was the wrong number for that
     question twice over — the active stage's matches only, so it ignored every
     scorecard and reported a round the rest of the card was not about. The
     bar reads `state.resultsIn` now. The progress BAR below still counts, and
     counts `boardProgress`, which knows which round it is describing. */
  /**
   * THE ROUND THE "CURRENT ROUND" CARD IS ABOUT, and it has to be the one the
   * progress bar under it counts.
   *
   * This was `state.activeStage ?? state.stages[0]` — the expression
   * `boardStage` exists to replace — while the bar and the caption beneath it
   * read `boardIsStroke` and `cardsIn`. On the Demo Cup that printed
   *
   *     Current round
   *     Round 1 · Round Robin
   *     Every player meets everyone in their flight.
   *     7/33 scorecards in
   *
   * — the NAME of the group phase over the CARD COUNT of the medal round, in
   * one card, with the leaderboard directly above it ranking the medal. A
   * round robin has no scorecards at all.
   *
   * Half of that is mine: before the boards were moved onto `boardIsStroke`
   * the bar said "matches complete", which was coherent about the wrong round
   * rather than incoherent about two. Found by reading the rendered dashboard
   * on 2026-09-12 rather than by any test.
   */
  const currentStage = state.boardStage ?? state.stages[0];
  /**
   * Two people playing each other, rather than a tournament.
   *
   * Read from the event's own shape rather than counted off the field, which
   * is the distinction the shape exists to keep: "two players are entered" is
   * a fact about today and stops being true the moment a third arrives; "this
   * was set up as a match" stays true and is what the wording should follow.
   *
   * Declared HERE, above the first reader, rather than beside the other
   * role flags below. Same reason the attendance rows on the Rounds screen
   * carry that note: a const read before its own line throws on every render
   * of the page, and tsc does not catch it.
   */
  const matchEvent = isMatch(event.shape);
  // A casual round has exactly one round in it, which is what makes a single
  // panel the whole of its settings. The active stage rather than stages[0]:
  // same reader every other screen uses.
  // `boardStage`, which for a casual round is the SAME stage — there is only
  // one — so this is not a behaviour change. It is written this way so the
  // guard in `board-follows-the-round.audit.test.ts` needs no exception here:
  // an allowance for "the one place that is fine" is how the next one that is
  // not fine gets written.
  const casualStage = matchEvent ? state.boardStage ?? state.stages[0] ?? null : null;

  /**
   * IS THIS CASUAL ROUND ACTUALLY A MATCH — which `shape` cannot tell you.
   *
   * `shape: "match"` is how a casual round is STORED. It was named when the
   * quick round was only ever one person against another, and the word stuck
   * while the screen grew four more formats: stroke play, modified Stableford,
   * four-ball and foursomes. So every sentence below keyed off `matchEvent`
   * described a medal as a match.
   *
   * Walked on 2026-09-18 after setting one up as a player: a Stroke Play
   * round, stored `format: "stroke"` with a "Stroke Play Round" stage, was
   * headed "The match", reported "head to head", and ranked under "Holes
   * won" — on the dashboard a casual player lands on. The leaderboard one
   * click away had it right all along, gross, net and to-par, because it asks
   * the ROUND. This is `event-answer-vs-round-answer` again, in the words
   * rather than in the arithmetic.
   *
   * `boardIsStroke` is the round's own basis and is what every board here
   * already reads. `matchEvent` keeps deciding LAYOUT — what a casual round
   * shows and hides — which is the question `shape` genuinely answers.
   */
  const casualMatch = matchEvent && !state.boardIsStroke;

  // Counted over the rounds the field plays, not over the Round Robins: those
  // two lists are the same only in a tournament that is nothing but round
  // robins, and this screen sits beside others that always counted rounds.
  const currentRoundLabel = matchEvent
    ? // "Round Robin" is the structure the app stores a match as, not
      // anything the two people playing it would recognise. The type is a
      // truthful label for a tournament with several kinds of round in it and
      // a piece of internal vocabulary here.
      //
      // "The round" when it is not a match: four of the five formats the
      // casual screen offers are not one, and calling a medal a match is a
      // claim about how it is decided.
      casualMatch
      ? "The match"
      : "The round"
    : currentStage
      ? /* THE HEADING'S WORDS, from the heading's function. This printed the
           type alone, so a one-round Scramble read "Stroke Play Round" here
           under a heading saying "Round 1 · Scramble". See `roundNameFor`. */
        roundNameFor(state.playRounds, currentStage)
      : // "—" is what a tournament with no rounds read, over an empty progress
        // bar and "0/0 scorecards certified". A dash is a missing VALUE; this
        // is a state, and the line under it now says what to do about it.
        "No rounds yet";
  const currentRoundDesc = matchEvent
    ? // A round robin of two IS the match, and telling two friends that
      // "every player meets everyone in their flight" describes the schema
      // rather than the golf.
      casualMatch
      ? "One match, decided hole by hole."
      : "One round. Everyone returns a card."
    : currentStage?.type === "Round Robin"
      ? "Every player meets everyone in their flight."
      : currentStage?.description ?? "";
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";

  /**
   * A casual round says, on its own screen, that it is temporary.
   *
   * `hoursLeft` returns null for anything with no expiry — which is every
   * tournament that has ever existed — so `expiryNotice` renders nothing here
   * and the banner does not mount. The check is the ABSENCE of an expiry
   * rather than "is this a match", because the sweep keys on the same column:
   * the screen and the deletion agree by reading one fact, not two.
   */
  const expiry = expiryNotice(hoursLeft(event), isStaff);
  /**
   * Null for anybody who runs no organization of their own — AND ON A CASUAL
   * ROUND, whoever they are.
   *
   * A club is not the subject of this screen when the screen is a Sunday
   * fourball. Somebody who opened the app to play their mate is not being
   * asked to name a society and load a roster, and since a quick round now
   * belongs to the person's own organization rather than their club, the
   * checklist would be reporting on a club they are not currently inside.
   *
   * `isMatch` rather than a new flag: the same fact the heading, the round
   * label and the sidebar already turn on.
   */
  const orgFacts = isStaff && !matchEvent ? await orgSetupFactsFor(session.email, session.name, session.eventId) : null;
  const orgSetup = orgFacts ? orgSetupState(orgFacts) : null;
  const isAdmin = session.viewRole === "admin";

  // The dashboard mirrors the leaderboard and links into score entry, so it
  // has to respect the same settings the dedicated screens do — otherwise a
  // blind event leaks its standings on the page every player lands on first.
  const settings = settingsOf(event);
  const showStandings = canSeeLeaderboard(settings, session.viewRole);
  const showEntry = canEnterScores(settings, session.viewRole);

  /**
   * THE SIXTH BOARD, and it was found by a guard rather than by a person.
   *
   * This screen renders `LeaderboardTable` off `standingRows` — the same pair
   * the console leaderboard and Reports do — and passed it `state.isStroke`,
   * the EVENT's format, while `standingRows` itself now answers for the round
   * on the board. In a mixed tournament that is a table ordered one way and
   * headed the other.
   *
   * The four boards were fixed on 2026-09-11, Reports on 2026-09-12, and this
   * one was still wrong after both — which is why the rule is now swept from
   * the filesystem in `board-follows-the-round.audit.test.ts` instead of kept
   * as a list. It went red on this file the first time it ran.
   */
  const isStroke = state.boardIsStroke;

  /**
   * What decides the bracket differs by tournament: a round robin decides it
   * by matches, a stroke qualifier by cards returned, a straight knockout by
   * nothing at all.
   *
   * This screen used to work that out, and the comment here said to "measure
   * whichever this tournament actually uses rather than assuming one shape"
   * — above a line that asked `state.isStroke`, which is one value for a whole
   * tournament and so assumes exactly one shape. With a round robin inside a
   * stroke-format event it counted cards, found none however many matches were
   * decided, and hid the draw for good.
   *
   * `bracketFeederProgress` asks each feeder in its own unit, beside the data.
   */
  const bracketProgress = {
    // `hasKnockoutStage` now that the feeder slice has moved, which is the
    // question this line was always really asking — and one fewer place
    // comparing the type to a literal.
    hasBracketStage: hasKnockoutStage(state.stages),
    feederProgress: state.bracketFeederProgress,
    bracketStarted:
      !!brackets.winners.champion ||
      brackets.winners.rounds.some((r) => r.matches.some((m) => !!m.winnerId)),
    /**
     * FALSE, since the "Qualification Stage" type was removed on 2026-09-11.
     *
     * It used to be the one thing that could settle a bracket's field outright
     * — a stage the field never played, whose only control wrote the event's
     * own `qualifyPerGroup`. With it gone, what feeds a bracket is the round
     * the field actually plays, and that is measured by `feederProgress` two
     * lines up.
     *
     * Passed explicitly rather than dropped from `BracketProgress`: the
     * question it asks is still a real one — a field CAN be decided outright
     * rather than progressively — and leaving the input there means whoever
     * adds that back has somewhere to say so, instead of re-deriving the rule.
     */
    qualificationDecided: false,
  };
  const showBracketTile = showStandings && showBracket(bracketProgress);
  const bracketTileBadge = bracketBadge(bracketProgress);

  // One source of truth for which screens exist in this tournament: the same
  // sidebar the layout renders. A shortcut to a door the sidebar has closed is
  // still a door to an empty room, so the quick actions are an intersection
  // rather than a second opinion.
  // Whether the field advances into a knockout at all. The "Advancing" stat and
  // the "Qualification cutoff" card read event-level qualifyPerGroup/advancing,
  // which only mean something when there is a Bracket/Qualification stage to
  // qualify into — a tournament that instead cuts round to round has neither.
  const hasKnockout = hasKnockoutStage(state.stages);
  /**
   * A knockout with nothing before it: the whole field is drawn, nobody
   * qualifies, and there is no standings table — the draw is the standings.
   * Found 2026-09-26: this dashboard showed "Qualification cutoff · Top
   * 2/flight · cutoff ≈ 0 pts", "8 of 8 advancing" and a table of 0-0-0 rows
   * with a semi-final already decided on the bracket.
   */
  const straightKnockout = state.stages.findIndex((s) => isKnockoutRound(s.type)) === 0;

  /**
   * WHY THE NEXT PHASE IS NOT AVAILABLE YET, for the lifecycle bar's button.
   *
   * Computed here and enforced again inside the actions, from the same two
   * functions — so the greyed-out button and the refusal say the same thing in
   * the same words, and neither is load-bearing on its own.
   *
   * Only the two transitions that mean something. Moving from draft to "taking
   * entries" is a club saying what it is doing and gates nothing; going live
   * and declaring a result are the ones that change what the field sees.
   *
   * ASKED OF THE ACTION, NOT OF THE STATUS, since a draft can now be offered
   * Launch. This listed the statuses that could reach a launch button —
   * `ready` and `registration` — and `nextLifecycleAction` has since added a
   * third route to it: a pre-launch tournament with results in it is offered
   * Launch from `draft` too. Keyed off the status, this would have handed that
   * tournament an ungated button whose action then refused on the server, for
   * a reason the screen had already worked out and thrown away.
   */
  const lifecycleAction = nextLifecycleAction({ status: event.status, resultsIn: state.resultsIn });
  const phaseBlock =
    lifecycleAction?.kind === "launch"
      ? launchRefusal({
          playingRounds: state.stages.filter((s) => isPlayingRound(s.type)).length,
          confirmed: state.confirmed.length,
          dated: !!state.event.dates.trim(),
        })
      : lifecycleAction?.to === "completed"
        ? finishRefusal({
            pendingConfirmations: state.pendingConfirmations,
            disputed: state.reviewing.disputed,
          })
        : null;
  const navHrefs = new Set(
    navForRole(session.viewRole, settings, {
      hasTeamRound: state.stages.some((s) => TEAM_FORMAT_NAMES.includes(s.format)),
      hasKnockout,
      isLeague: state.stages.filter((s) => isWeeklyRound(s.type)).length > 1,      // Same list the sidebar is filtered by, so the quick actions cannot
      // offer a match a door to Flights that the sidebar has just closed.
      isMatch: matchEvent,
    })
      .flatMap((section) => section.items)
      .map((item) => item.href),
  );
  const quickActions = QUICK_ACTIONS.filter(
    (a) => !(a.staff && !isStaff) && navHrefs.has(a.href),
  );

  // A tournament with no field yet has nothing to report: every stat reads
  // zero, the leaderboard is an empty table, and "0/0 matches complete" is
  // true but useless. Someone who just created a tournament lands here, so
  // this is the one place the next step has to be spelled out.
  const unstarted = isUnstarted(state) && isStaff;
  // The club's branding, loaded only for the first-run checklist, so it can
  // nudge (never gate) an organizer to add a logo and colours before they've
  // set either.
  const brandingOrg = unstarted
    ? await prisma.organization.findUnique({
        where: { id: event.organizationId },
        // `kind` so the nudge below calls the outfit by its own name — a
        // society is not a club. See ChecklistState.orgKind.
        // `country` and `communityNoun` with it: the kind alone cannot know
        // what the outfit CALLS itself, so a US league read "society".
        select: { logoUrl: true, themeSetAt: true, kind: true, country: true, communityNoun: true },
      })
    : null;
  /**
   * The setup flow, for the one step this list never had.
   *
   * The dashboard is where a new organizer lands straight after creating a
   * tournament, and it never once said the thing needed a name, a date or a
   * venue — the rail on the Set-up screens said it first, and this list did
   * not carry the step at all.
   *
   * Loaded only while the tournament is UNSTARTED, which is the only time the
   * checklist renders, so a running tournament pays nothing for it. Returns
   * null for a match, which is correct: two people on the first tee have no
   * tournament to set up.
   */
  const flow = unstarted ? await setupFlowFor(session.eventId) : null;
  // EVERY step's own answer, not two of them. The flow decides what is
  // finished and a second copy of any of those tests here is how the rail and
  // the dashboard come to disagree — which two of the five rows already did.
  const checklist = unstarted
    ? setupChecklist({
        ...state,
        branding: clubBrandingState(brandingOrg),
        orgKind: brandingOrg?.kind,
        orgCountry: brandingOrg?.country,
        orgNoun: brandingOrg?.communityNoun,
        flow: flow?.steps,
      })
    : [];

  // Empty for a round the ordinary board does not cover (D8) — a team round
  // would list the field at gross 0, a manual round a ranking the app has no
  // basis for. The dashboard's leaderboard card hides itself when there are no
  // rows, which is the honest thing here: the real board is one click away and
  // knows how to read this format.
  // `boardStage`, because the rows beside it are the board's. Asking
  // `activeStage` in a mixed tournament gates one round's rows on a different
  // round's format. Same correction as `/entry`'s spoken position.
  // No rows for a straight knockout: its standings are its draw, and the table
  // printed every player on 0-0-0 (see `straightKnockout`).
  const rows =
    usesStandardBoard(state.boardStage?.format) && !straightKnockout ? standingRows(state).slice(0, 8) : [];
  const advancingIds = state.advancingIds;

  // With no knockout to qualify into, the field advances by a per-round cut
  // instead — the cut out of the current round is the next round's, if it has
  // one. This replaces the qualification card, which would otherwise show an
  // event-level "top N/flight" that doesn't match how this tournament cuts.
  const activeRoundIdx = state.activeStage
    ? state.playRounds.findIndex((s) => s.id === state.activeStage!.id)
    : -1;
  /**
   * How far the FIELD has actually got, which is a different question from
   * which round the cut chain is on — see the note on `RoundCutLine.note`.
   * `boardStage` is the board's own answer, so the card and the leaderboard
   * beside it cannot disagree about what has been returned.
   */
  const playedThroughRound = state.boardStage
    ? roundNumber(state.playRounds, state.boardStage.id)
    : 0;
  const roundCut = hasKnockout
    ? null
    : currentRoundCut(state.playRounds, activeRoundIdx, playedThroughRound);

  // ── Published tee sheet ─────────────────────────────────────────────────
  // The player's answer to the only question that matters on the morning:
  // when do I go, and with whom. Their own group first, the whole sheet
  // under it — and nothing at all until the organizer publishes, because a
  // draft draw is the organizer's.
  const nameOf = new Map(state.confirmed.map((pl) => [pl.id, pl.name]));
  const myPlayerRows = await prisma.player.findMany({
    where: { eventId: session.eventId, email: { equals: session.email, mode: "insensitive" }, status: "confirmed" },
    select: { id: true },
  });
  const myIds = new Set(myPlayerRows.map((r) => r.id));
  let publishedSheet: { roundLabel: string; sheet: TeeSheet; mine: string | null } | null = null;
  {
    const rounds = state.playRounds;
    for (let i = rounds.length - 1; i >= 0; i -= 1) {
      const r = rounds[i];
      if (!r.teeSheetPublished) continue;
      const sheet = parseTeeSheet(r.teeSheet);
      if (!sheet) continue;
      let mine: string | null = null;
      for (const id of myIds) {
        const g = groupForPlayer(sheet, id);
        if (g) { mine = g.name; break; }
      }
      publishedSheet = { roundLabel: roundLabel(rounds, r.id), sheet, mine };
      break;
    }
  }

  // ── Weekly sign-up ──────────────────────────────────────────────────────
  // Only when the league asks the question, and only for a session that maps
  // to a player. Captains additionally see their own flight's list — theirs,
  // and nobody else's; staff see everything on the Flights and Tee sheet
  // screens instead of here.
  // Assembled by the availability service, which the player shell at /me also
  // calls. It used to be built inline here — and only here, which is why the
  // one screen players actually land on never showed it.
  const availability = await availabilityFor(state, session.email);

  // Through the service the player screen also calls, so the organizer
  // previewing a notice here sees what the field sees. See `announcementsFor`.
  const announcements = await announcementsFor(session.eventId);

  return (
    <>
      {/* FIRST, above everything, because it is the only thing on this screen
          with a deadline on it. A warning that something will be deleted is
          not useful below the fold, and the round it is about is short enough
          that there is nothing here it should be yielding to. */}
      <RoundExpiryBanner notice={expiry} canKeep={isStaff} />

      {/* The ORGANIZATION checklist, above the per-tournament one below it.
          Two different things and deliberately two components: this one is
          about the club or society that OWNS the tournaments — its name, its
          course, its roster — and is answered once rather than per event.
          Merging them would put "add your members" inside a list about one
          tournament.

          Staff only, and it renders nothing once everything that applies is
          done, so an established club never sees it. A player never sees it
          either — they run no organization, so the facts come back null. */}
      {isStaff && orgSetup && (
        <div style={{ marginBottom: 16 }}>
          {/* No step points at /dashboard today, so this changes nothing now.
              Passed anyway: it is a fact about where the component is mounted,
              and it means a future step pointing here cannot become the same
              link-to-the-page-you-are-on that /choose carried for weeks. */}
          <OrgSetupChecklist state={orgSetup} currentPath="/dashboard" />
        </div>
      )}

      {publishedSheet && (
        <div className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
          <div>
            <span className="card-title" style={{ fontSize: 15 }}>
              Tee sheet — {publishedSheet.roundLabel}
            </span>
            {publishedSheet.mine && (
              <p style={{ fontSize: 13, margin: "4px 0 0", fontWeight: 600 }}>
                {(() => {
                  const g = publishedSheet!.sheet.groups.find((x) => x.name === publishedSheet!.mine)!;
                  return `You're in ${g.name} — hole ${g.startHole}${g.half ?? ""} at ${g.time}.`;
                })()}
              </p>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {publishedSheet.sheet.groups.map((g) => (
              <div
                key={g.name}
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  boxShadow: `inset 0 0 0 1px ${g.name === publishedSheet!.mine ? "var(--color-accent)" : "var(--color-divider)"}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  <span className="text-muted">Hole {g.startHole}{g.half ?? ""} · {g.time}</span>
                </div>
                {g.playerIds.map((id) => (
                  <div key={id} style={{ fontSize: 12.5, padding: "1px 0" }}>
                    {nameOf.get(id) ?? "—"}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {availability.playerId && (
        <div style={{ marginBottom: 16 }}>
          <RoundAvailability
            playerId={availability.playerId}
            next={availability.next}
            future={availability.future}
            past={availability.past}
            captainOf={availability.captainOf}
            asksPlayer={availability.asksPlayer}
            today={todayIso()}
          />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="page-kicker">{event.name}</div>
          {/* A match is not a tournament, and calling its one screen a
              "Tournament dashboard" is the app telling two friends they have
              set up the wrong thing. */}
          <h1 className="page-title">
            {matchEvent ? (casualMatch ? "The match" : "The round") : "Tournament dashboard"}
          </h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {/* The library's venues stand in for the free-text course when
                there is none — see `attachedVenues`. Named rather than
                counted: "2 venues" tells an organizer nothing they did not
                already know, and a rotating league's whole point is which
                courses. */}
            {[
              event.dates,
              [event.course || attachedVenues.join(" · "), event.city].filter(Boolean).join(", "),
            ]
              .filter(Boolean)
              .join(" · ") ||
              (matchEvent ? "No date or course set — neither is needed to play it" : "No dates or venue set yet")}
          </p>
        </div>
        {/**
         * ONE PRIMARY ON THE SCREEN, and the lifecycle wins it when it has
         * something to say.
         *
         * "Enter scores", "Leaderboard", "Start taking entries" and "Launch
         * tournament" were all on this screen at once, three of them
         * primary-weighted, and nothing said which an organizer in this state
         * should press. Two of those are the same button now
         * (`nextLifecycleAction`); these two are the rest of the problem.
         *
         * They are NAVIGATION — go and look at the golf — and they stay, at
         * secondary weight, whenever the lifecycle card is offering an action
         * to the person looking. When it is not (a player, an assistant, or a
         * completed tournament with nothing left to move) the screen would
         * otherwise have no primary at all, and for a player the leaderboard
         * genuinely is the thing they came for — so it takes the weight back.
         *
         * Asked of `nextLifecycleAction` rather than re-derived, so this
         * cannot come to disagree with the button it is deferring to. A match
         * renders no LifecycleBar at all, hence `matchEvent` — otherwise a
         * fourball would demote its own leaderboard for a card that is not on
         * the screen.
         */}
        {(() => {
          const lifecycleLeads = !matchEvent && isAdmin && !!lifecycleAction;
          return (
            <div style={{ display: "flex", gap: 8 }}>
              {showEntry && (
                <Link className="btn btn-secondary" href="/entry">
                  <Icon name="pencil-simple" /> Enter scores
                </Link>
              )}
              {showStandings && (
                <Link className={lifecycleLeads ? "btn btn-secondary" : "btn btn-primary"} href="/leaderboard">
                  <Icon name="ranking" /> Leaderboard
                </Link>
              )}
            </div>
          );
        })()}
      </div>

      {/* A MATCH HAS NO LIFECYCLE TO RUN, so it is not offered one.
          Draft → taking entries → ready → launch → complete is the arc of an
          event with a field: entries open and close, a draw is published, and
          launching is the moment the field gets to see any of it. None of
          those steps exists for two people who agreed to play on Sunday —
          there is nobody to open entries to, nothing to publish, and the
          "Launch tournament" dialog would ask them to confirm their flight
          count. The match is created live and stays unlocked; the only
          question left, whether it is finished, is answered by the card. */}
      {/* A CASUAL ROUND'S OWN CONTROLS, in place of a tournament's setup
          screens. `/event`, `/registration` and `/stages` are gone from this
          shape's sidebar — they are a club's settings, a registration desk and
          a rounds screen with cut lines — and these three things are what a
          fourball actually reconsiders: eighteen or nine, shots or level, and
          a handicap somebody typed wrong. Staff only, which on a quick round
          means whoever set it up. */}
      {matchEvent && isStaff && casualStage && (
        <CasualRoundPanel
          stageId={casualStage.id}
          holes={casualStage.holes}
          scoringBasis={casualStage.scoringBasis}
          accessCode={casualStage.accessCode}
          players={state.confirmed.map((p) => ({
            id: p.id,
            name: p.name,
            // Plus handicaps are stored negative and must never be shown back
            // as "-2" — the same rule the setup form states.
            handicap: p.handicap < 0 ? `+${Math.abs(p.handicap)}` : String(p.handicap),
          }))}
        />
      )}

      {/* STAFF FURNITURE, AND IT WAS ON EVERY PLAYER'S DASHBOARD.
          The card is titled "Tournament status" and reports where the
          ORGANIZER is in their workflow: draft or live, whether configuration
          is locked, and the nudge when the stored status disagrees with the
          golf. `isAdmin` already gates the button, the re-open control and the
          refusal — but not the sentence, so the field read

            "The tournament is being played and the app is calling it a draft.
             Scoring works either way, so nothing is stuck — but the 33 in the
             field can already open the board and their card, on a tournament
             that still calls itself a draft."

          Which is a nudge, addressed to somebody who can act on it, describing
          the reader to themselves in the third person — thirty-three people
          told the competition they are playing in is not quite real, about an
          admin task none of them can do. Read off the demo as a player on
          2026-09-16.

          `isStaff` rather than `isAdmin`: an assistant runs the event and
          should see the state. Only an admin can change it, which is what the
          gates inside the component already say. */}
      {!matchEvent && isStaff && (
        <LifecycleBar
          status={event.status}
          isAdmin={isAdmin}
          configUnlocked={event.configUnlocked}
          resultsIn={state.resultsIn}
          blockedReason={phaseBlock ?? undefined}
          summary={{
            name: event.name,
            dates: event.dates,
            // The header's answer, from the same two sources: the launch
            // confirmation read "Course —" under a header naming the course,
            // for any tournament that holds its course as a venue only.
            course: event.course || attachedVenues.join(" · "),
            format: event.format,
            players: state.confirmed.length,
            flights: state.groups.length,
            rounds: state.stages.length,
          }}
        />
      )}

      <AnnouncementList items={announcements} />

      {/* Ahead of the shortcuts, because "what next" outranks "where to". */}
      {unstarted && (
        <div className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
          <div>
            <span className="card-kicker">Getting started</span>
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
              This tournament doesn&rsquo;t have a field yet, so there&rsquo;s nothing to score or
              rank. Work down the list and the dashboard fills in as you go.
            </p>
          </div>
          <SetupChecklist items={checklist} />
        </div>
      )}

      {isStaff && (
        <div className="card elev-sm" style={{ marginBottom: 16 }}>
          <span className="card-kicker">Quick actions</span>
          {/* `auto-fit` rather than a fixed five, because the labels are the
              sidebar's now and some of them are three words. Five hard columns
              put "Registration & field" into a 64px tile on a 320px phone. The
              same fix, for the same reason, as the flights grid in
              QualificationPanel. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 8, marginTop: 6 }}>
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="link-reset"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 6px",
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                <Icon name={a.icon} style={{ fontSize: 20, color: "var(--color-accent)" }} />
                {/* The sidebar renames three of these on a casual round; this tile
                    has to agree with it or the reader hunts for a screen that is
                    not in the list. */}
                {screenName(a.href, matchEvent)}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Every number in here is derived from the field, so with no field
          they all read zero. The checklist above says what to do instead. */}
      {!unstarted && (
        <>
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          {/* "1 flights" was on this card for every one-flight tournament, and
              a match is one flight by construction — so the plural is fixed
              here rather than only hidden for matches. A match says what its
              two players are actually doing instead of counting the flight
              that exists only because the schema needs one. */}
          <StatCard
            label={matchEvent ? "Playing" : "Players"}
            value={state.confirmed.length}
            sub={
              matchEvent
                ? // "head to head" is a claim about the format, and a casual
                  // medal of four is not one. See `casualMatch`.
                  casualMatch
                  ? "head to head"
                  : "in this round"
                : `${state.groups.length} flight${state.groups.length === 1 ? "" : "s"}`
            }
            icon="ph ph-users-three"
          />
          {/* TWO PEOPLE PLAYING EACH OTHER IS STILL ITS OWN SENTENCE. A quick
              match has no schedule to be half way through, so it says whether
              it is finished rather than how much of it is. Everything else
              counts `boardProgress`, which knows both the number and what it
              is counting. */}
          {matchEvent ? (
            <StatCard
              label={casualMatch ? "Match" : "Round"}
              value={state.boardProgress.certified > 0 ? "Finished" : "Not finished"}
              // "hole by hole" is how a MATCH is decided. A medal is decided
              // on the total, and saying otherwise on the card that reports
              // whether it is finished is the same error as "Holes won" below.
              sub={casualMatch ? "hole by hole" : "on the card"}
              icon="ph ph-check-circle"
            />
          ) : state.boardProgress.unit === "manual" ? (
            /* A ROUND THE APP DOES NOT SCORE HAS NO CARDS COMING IN. The
               format's own entry says "no engine computes this. That is the
               point" — the committee works the result out — so "Cards in 0/16
               · 0% submitted" counted a field that owes nothing, and would
               have read zero for ever. */
            <StatCard
              label="Scored by hand"
              value="—"
              sub="the committee works this round out"
              icon="ph ph-clipboard-text"
            />
          ) : !state.boardStage ? (
            /* A TOURNAMENT WITH NO ROUND HAS NOTHING TO BE A FRACTION OF.
               "Cards in 0/0 · 0% submitted" is the shape of an answer to a
               question nobody has asked yet, on the screen a club sees for its
               first ten minutes — which CLAUDE.md names as the state the demo
               fixture never covers and `verify-lifecycle` exists for.

               It says what is missing instead, in the words the setup
               checklist on this same screen already uses. */
            <StatCard
              label="Rounds"
              value="None yet"
              sub="add one to start scoring"
              icon="ph ph-stack"
            />
          ) : state.boardProgress.unit === "cards" ? (
            <StatCard
              label="Cards in"
              value={`${state.boardProgress.certified}/${state.boardProgress.total}`}
              sub={`${state.boardProgress.pct}% submitted`}
              icon="ph ph-cards"
            />
          ) : state.boardProgress.unit === "sides" ? (
            /* A TEAM DAY IS COUNTED IN SIDES. Eight sides in a four-ball file
               sixteen team cards between them, so "16 cards in" would be true
               about the rows and wrong about the round — and until this counter
               learned where a team round files its cards it said 0 of 16, with
               the round finished. */
            <StatCard
              label="Sides in"
              value={`${state.boardProgress.certified}/${state.boardProgress.total}`}
              sub={`${state.boardProgress.pct}% returned`}
              icon="ph ph-users-three"
            />
          ) : state.boardProgress.unit === "ties" ? (
            /* A KNOCKOUT KEEPS ITS RESULTS SOMEWHERE ELSE, so counting
               fixtures answers zero for one however far through it is. This
               said "Matches complete 0/0 · 0% of round robin" over a bracket
               with five ties decided and its final drawn — two inches above the
               Bracket status card, which had the same bracket right.

               THE ARITHMETIC IS NO LONGER HERE. It shipped in this screen
               first (#512) and moved into `boardProgress`, so `/reports` and
               the printed snapshot get it too — a rule living in one screen is
               a rule the next screen does not inherit. */
            <StatCard
              label="Ties decided"
              value={`${state.boardProgress.certified}/${state.boardProgress.total}`}
              sub={state.boardProgress.total > 0 ? `${state.boardProgress.pct}% of the draw` : "nothing drawn yet"}
              icon="ph ph-tree-structure"
            />
          ) : (
            <StatCard
              label="Matches complete"
              value={`${state.boardProgress.certified}/${state.boardProgress.total}`}
              /* NOT "of round robin". This tile shows for every round scored as
                 fixtures, and a Single Match Stage is not a round robin — the
                 phrase was true of the only shape that existed when it was
                 written. */
              sub={`${state.boardProgress.pct}% of this round`}
              icon="ph ph-check-circle"
            />
          )}
          {/* An organizer's review queue, not a player-facing number.

              The sub-line NAMES WHAT IS IN IT rather than calling everything a
              "score". Read off the demo tournament: "36 scores to confirm"
              sitting beside "Cards in 7/33" was thirty-six MATCH RESULTS, and
              the two numbers were about different rounds. See
              `domain/review-queue.ts` — it counts both sources over the whole
              tournament now, so a round the organizer has moved on from cannot
              take its unreviewed work off the screen with it. */}
          {isStaff && (
            <StatCard
              label="Awaiting review"
              value={state.pendingConfirmations}
              sub={reviewQueueDetail(state.reviewing)}
              icon="ph ph-seal-check"
            />
          )}
          {/* Who's advancing is a live read on the standings, so it follows them
              — and only counts when there's a knockout to advance into; a
              round-to-round cut has no single event-level "advancing" number. */}
          {hasKnockout && !straightKnockout && showStandings && (
            <StatCard label="Advancing" value={advancingCount} sub={`of ${state.confirmed.length} players`} icon="ph ph-flag-checkered" />
          )}
        </div>

        <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <div className="card elev-sm">
            {showStandings ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <span className="card-title">
                    {matchEvent
                      ? casualMatch
                        ? "Where the match stands"
                        : "Where the round stands"
                      : "Live leaderboard"}
                  </span>
                  {/* "Overall · all flights" is a claim about scope, and a
                      match has no other flights for this one to be all of.

                      "Holes won" is a claim about the BASIS, and it was made
                      for every casual round including the four formats that
                      are not decided that way. The table underneath is fed
                      `isStroke` and has always printed gross, net and to-par
                      for them — so the heading contradicted the columns
                      directly below it. */}
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {matchEvent
                      ? casualMatch
                        ? "Holes won"
                        : "Gross, net and to-par"
                      : "Overall · all flights"}
                  </span>
                </div>
                <LeaderboardTable
                  isStroke={isStroke}
                  /* `boardStage`, like the two props either side of it. All
                     three describe the round these ROWS came from, and asking
                     `activeStage` headed one round's scores with another
                     round's basis. */
                  isStableford={isStablefordRound(state.boardStage?.scoringBasis, state.boardStage?.format)}
                  rows={rows}
                  compact
                  /* Compact has room for ONE of the two stroke scores, and it
                     must be the one the round is decided on. Same round these
                     rows came from, like the props either side. */
                  rankedOn={state.boardStage?.scoringBasis === "gross" ? "gross" : "net"}
                  /* `standingRows` is per PLAYER, and a team round's result
                     belongs to the SIDE — so this card had five column names
                     and no rows under them on a four-ball that had finished.
                     Name where the answer actually is.

                     BOTH places, since 2026-09-26. This said "they're on
                     Reports & export" only, which sent a newcomer running a
                     scramble away from the Live leaderboard — the screen built
                     for it, which ranks the sides ("Scramble · 2 sides · lowest
                     net wins"). Checked on the seeded club: both screens show
                     them. */
                  emptyNote={
                    straightKnockout
                      ? `This is a knockout, so the standings are the draw — who is still in and who plays whom is on the ${screenName("/bracket")}.`
                      : teamRound
                      ? `This round is played in sides, so the standings rank the sides — they're on the ${screenName("/leaderboard")} and in ${screenName("/reports")}.`
                      : /* A HAND-SCORED ROUND'S BOARD NEVER FILLS IN. "The
                           board fills in as scores come back" is a promise
                           about cards that this format does not have — the
                           committee works the result out and posts it. The
                           same sentence was on this card while the tile beside
                           it already said "Scored by hand". */
                        state.boardProgress.unit === "manual"
                        ? "This round is scored by hand, so there is no board — post the result as an announcement and the field sees it."
                        : "Nothing to rank here yet — the board fills in as scores come back."
                  }
                />
              </>
            ) : (
              <>
                <span className="card-title">Standings</span>
                <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
                  <Icon name="eye-slash" /> The organizer is running this as a blind event — standings are
                  published when the tournament finishes.
                </p>
              </>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card elev-sm">
              <span className="card-title">Current round</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                <div
                  style={{
                    width: 40, height: 40, borderRadius: 8,
                    background: "var(--color-accent-900)", display: "grid", placeItems: "center",
                    color: "var(--color-accent-200)",
                  }}
                >
                  <Icon name="arrows-clockwise" style={{ fontSize: 20 }} />
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{currentRoundLabel}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>{currentRoundDesc}</div>
                </div>
              </div>
              {/* NO ROUND, NO BAR. An empty progress bar under a round named
                  "—", over the words "0/0 scorecards certified", is three
                  pieces of furniture describing a question this tournament has
                  not reached. What an organizer needs here is the next step,
                  which the setup checklist at the top of this same screen is
                  already telling them. */}
              {!state.boardStage ? (
                <p className="text-muted" style={{ fontSize: 12.5, margin: "10px 0 0", lineHeight: 1.6 }}>
                  Add a round and the field&rsquo;s progress shows here.
                </p>
              ) : state.boardProgress.unit === "manual" ? (
                /* Same reason, different absence: there is no progress to draw
                   because no card is owed. Said once, here, rather than drawn
                   as an empty bar over a count of nothing. */
                <p className="text-muted" style={{ fontSize: 12.5, margin: "10px 0 0", lineHeight: 1.6 }}>
                  This round is scored by hand, so no cards come in — the result is whatever the
                  committee records.
                </p>
              ) : (
                <>
              {/* The bar and the caption are one fact, and `boardProgress`
                  already holds it — counted for the round this card NAMES,
                  which is the whole of what went wrong here. */}
              <div style={{ marginTop: 12, height: 8, borderRadius: 6, background: "var(--color-neutral-800)", overflow: "hidden" }}>
                <div style={{ height: "100%", background: "var(--color-accent)", width: `${state.boardProgress.pct}%` }} />
              </div>
              {/* CERTIFIED, AND THE ONES STILL OUT THERE.
                  This read `done` — which was `hasAnyHole`, "somebody typed a
                  digit" — under the words "scorecards in", so a round where
                  every player had written one hole down said 33/33 in. It now
                  counts cards RETURNED, in the sense Rule 3.3b and
                  `Scorecard.status` both mean by it.
                  The second line is the number that count no longer carries.
                  An organizer wants both: how many are in, and how many are
                  still on the course. Shown only while they differ, because
                  "21 still out" under "33 of 33 certified" is noise. */}
              <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                {state.boardProgress.certified}/{state.boardProgress.total}{" "}
                {state.boardProgress.unit === "cards"
                  ? "scorecards certified"
                  : state.boardProgress.unit === "sides"
                    ? /* NOT "certified": a side's card has no marker's signature to
                         read, so the word would describe a step this round does not
                         have. "In" is the whole of what is known about it. */
                      "sides in"
                    : "matches complete"}
              </div>
              {/* Out on the course EXCLUDES a dispute: a player disputing a
                  finished card is not playing, and counting them as if they
                  were hid the one card the committee has to act on. */}
              {state.boardProgress.started - state.boardProgress.certified - state.boardProgress.disputed > 0 && (
                <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {state.boardProgress.started - state.boardProgress.certified - state.boardProgress.disputed}{" "}
                  {state.boardProgress.unit === "matches" ? "still being played" : "still out on the course"}
                </div>
              )}
              {state.boardProgress.disputed > 0 && (
                <div style={{ fontSize: 11.5, marginTop: 2, color: "var(--color-danger)" }}>
                  {state.boardProgress.disputed} disputed
                </div>
              )}
                </>
              )}
            </div>

            {showBracketTile && (
            <div className="card elev-sm">
              <div className="card-head">
                <span className="card-title">Bracket status</span>
                <span className="tag tag-neutral">{bracketTileBadge}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: -2 }}>
                {straightKnockout ? "The whole field, seeded in order" : "Seeded from live group standings"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                  <span><Icon name="trophy" style={{ color: "var(--color-accent)", marginRight: 6 }} />Winners</span>
                  {/* `plural`, because this card printed "1 matches" on the
                      demo tournament's consolation bracket — read off the
                      rendered screen on 2026-09-14. The stat card at the top
                      of this same page had "1 flights" fixed for exactly this
                      reason; the helper exists so the next one does not have
                      to be spotted by eye. */}
                  <span className="text-muted">{brackets.winners.champion?.name ?? plural(state.brackets.winners.rounds[0].matches.length, "match", "matches")}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                  <span><Icon name="medal" style={{ color: "var(--color-accent)", marginRight: 6 }} />Consolation</span>
                  <span className="text-muted">{brackets.consolation.champion?.name ?? plural(state.brackets.consolation.rounds[0].matches.length, "match", "matches")}</span>
                </div>
              </div>
              <Link className="btn btn-ghost" href="/bracket" style={{ alignSelf: "flex-start", marginTop: 6 }}>
                Open the {bracketScreenName(!isStaff).toLowerCase()} <Icon name="arrow-right" />
              </Link>
            </div>
            )}

            {/* Only when the field qualifies into a knockout: this card reads
                event-level qualifyPerGroup/advancing, which mean nothing when a
                tournament cuts round to round instead. The cutoff line is also a
                live read on the standings — in a blind event it would give away
                exactly what the leaderboard hides, hence the showStandings gate. */}
            {hasKnockout && !straightKnockout && showStandings && (
              <FactCard
                title="Qualification cutoff"
                /*
                  THE RULE THIS TOURNAMENT ACTUALLY USES. This printed
                  "Top {qualifyPerGroup}/flight" whatever `qualifyMode` said, so
                  an event qualifying OVERALL was badged with a per-flight rule
                  it does not apply — and the count beside it contradicted the
                  badge in the same card. On the Demo Cup, which takes the top
                  four overall across eight flights: "Top 2/flight" over "4 of
                  33 advancing".

                  The same sentence `/bracket` has always built from the same
                  two fields; it is only this card that had one hard-coded.
                */
                badge={
                  event.qualifyMode === "overall"
                    ? `Top ${event.qualifyOverall} overall`
                    : `Top ${event.qualifyPerGroup}/flight`
                }
                figure={
                  <>
                    {advancingCount}{" "}
                    <span className="text-muted" style={{ fontSize: 14 }}>
                      of {state.confirmed.length} advancing
                    </span>
                  </>
                }
                /* THE CLAUSE IS A PROMISE, SO IT IS ONLY MADE WHILE IT IS TRUE.
                   "updates live with scores" was printed whatever the state,
                   and on a knockout at the semi-finals that cutoff cannot move
                   however many scores come in — a statement about FUTURE
                   behaviour, and a false one. The figure itself is true in
                   every state and stays. `qualifyingSettled` is decided in
                   `loadEventState` so this and the Qualification watch cannot
                   disagree about whether the race is live. */
                note={`Cutoff line ≈ ${overallCutoff === null ? "—" : pts(overallCutoff)} pts${
                  state.qualifyingSettled ? "" : " · updates live with scores"
                }`}
              />
            )}

            {/* No knockout, but the current round cuts into the next: show that
                round's own cut instead of the generic qualification card. This
                is a configured "top N advance", not a standings read, so it
                needs no showStandings gate — it reveals nothing about who leads. */}
            {!hasKnockout && roundCut && (
              <FactCard
                title="Round cut"
                badge={`Round ${roundCut.fromRound} → ${roundCut.toRound}`}
                // `roundCut.advance` is stored lower-case ("top 8 advance"), so
                // the capital comes from CSS rather than from the data.
                figure={<span style={{ textTransform: "capitalize" }}>{roundCut.advance}</span>}
                note={roundCut.note}
              />
            )}
          </div>
        </div>
        </>
      )}

      {/* Flight standings are standings — same rule as the leaderboard card.
          Not rendered at all rather than hidden with CSS: display:none still
          ships every name and score in the HTML for anyone reading source.

          And never for a match: its one flight holds both players, so this
          card is the leaderboard directly above it printed a second time
          under a heading about flights.

          Nor for a round played in SIDES. The rows are per PLAYER, and a team
          round's result belongs to the side — the standings card above says so
          in words. This one printed all eight players of a finished scramble
          with "—" against every name, which reads as a round nobody has
          scored. Found 2026-09-26 running a scramble from scratch. */}
      {showStandings && !unstarted && !matchEvent && !teamRound && (
      <div className="card elev-sm" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="card-title">Flight standings</span>
          <span className="text-muted" style={{ fontSize: 12 }}>Advancing rows highlighted</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 6 }}>
          {flightColumns.map((gs, gi) => (
            <div key={gs.group.id}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Flight {gi + 1}</div>
              {gs.ranked.map((r) => {
                /* Labelled across every flight, not within one — the flights
                   are four columns of one card, so a "Dave S." repeated in the
                   next column reads exactly as badly as one repeated here, and
                   advancing rows are highlighted. See standingLabels. */
                const advancing = advancingIds.has(r.player.id);
                return (
                  <div
                    key={r.player.id}
                    className="mini-row"
                    style={{
                      background: advancing ? "var(--color-accent-900)" : "transparent",
                      borderRadius: 4,
                      padding: advancing ? "3px 6px" : "3px 0",
                    }}
                  >
                    {/* NO POSITION WHERE NONE WAS EARNED. `rank` is 0 for a
                        player who holds no position — nobody has returned a
                        card, or theirs stopped short — and 0 is not a
                        finishing place. The board directly above this has
                        always printed "—" for exactly that; this card printed
                        a zero against every name before a ball was struck. */}
                    <span style={{ width: 14, color: "var(--color-neutral-500)" }}>{r.rank || "—"}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {standingLabels.get(r.player.id) ?? shortName(r.player.name)}
                    </span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.figure}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      )}
    </>
  );
}
