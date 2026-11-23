import { noticesOffAmong } from "@/lib/services/push";
import { noticesOffWords } from "@/lib/domain/round-moved";
import { headers } from "next/headers";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { roundLabel, roundLabelWith } from "@/lib/domain/round-label";
import { teamsForStage, teamStandings } from "@/lib/services/teams";
import { needsTeams } from "@/lib/formats";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { printKit } from "@/lib/services/print-kit";
import { staleSentence } from "@/lib/domain/print-kit";
import type { ConsoleMode } from "@/lib/console-url";
import { BUILD_PREVIEW } from "@/lib/domain/console-merges";
import { STEPPER_PREVIEW } from "@/lib/domain/lifecycle-track";
import { screensShownFor } from "@/lib/services/screens-shown";
import { openTournamentJob } from "@/lib/services/whats-next";
import { scopeLockFor, tournamentStatusFor } from "@/lib/services/tournament-status";
import { roundHandicapsFor } from "@/lib/services/round-handicap";
import { courseDayOf } from "@/lib/domain/timeline-step";
import { drawSections, drawControlsOf, matchGeneratorPlace, needsYouSection } from "@/lib/domain/draw-sections";
import { roundRobinCutOf } from "@/lib/services/regroup";
import { isLeaguePointsSystem } from "@/lib/domain/league-meeting";
import { DrawRound } from "@/components/DrawRound";
import { TeamMatchesControl } from "@/components/TeamMatchesControl";
import type { CutTieOnCard } from "@/components/CutReadyCard";
import { needSentence, phaseTitle } from "@/lib/domain/lifecycle-track";
import { RoundHandicaps } from "@/components/RoundHandicaps";
import { LockedOnce } from "@/components/setup/LockedOnce";
import { TeeTimesScreen } from "@/components/teetimes/TeeTimesScreen";
import { CutWaitingCard } from "@/components/teetimes/CutWaitingCard";
import { SheetDriftCard } from "@/components/teetimes/SheetDriftCard";
import { PrintDoor } from "@/components/teetimes/PrintDoor";
import { LeagueDraw } from "@/components/LeagueDraw";
import { leagueDrawPlace } from "@/lib/domain/draw-sections";
import { flightsIn } from "@/lib/services/league-nomination";
import { consoleUrl } from "@/lib/console-url";
import { requestOrigin } from "@/lib/request-origin";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FoursomeMaker } from "@/components/FoursomeMaker";
import { WeekField, type WeekFieldRow } from "@/components/WeekField";
import { sidesByMatch, type Standing } from "@/lib/domain/draw";
import { prisma } from "@/lib/db";
import { settingsOf } from "@/lib/services/tournament";
import { tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { replaceWorldFor } from "@/lib/services/tee-sheet-replace";
import { TEAM_SESSION } from "@/lib/services/cup";
import { sheetFieldFor } from "@/lib/services/sheet-field";
import { parseTeeSheet, teeSheetDrift, driftSentence, groupsWithRoom, markTeedOff, undrawnOn } from "@/lib/domain/tee-sheet";
import { clubWallClock } from "@/lib/domain/club-clock";
import { cleanIsoDate } from "@/lib/domain/round-dates";
import { PlaceInGroup } from "@/components/PlaceInGroup";
import { slotLocksFor } from "@/lib/services/tee-sheet-locks";
import { moveModeOf } from "@/lib/domain/tee-sheet-moves";
import { teeSheetDoorsFor } from "@/lib/services/tee-sheet-change";
import { strokeCutField, strokeCutOutcomeOf, cutTieRefusal } from "@/lib/services/stroke-cut";
import { cutFeederOf } from "@/lib/domain/cut-ready";
import { shortDate } from "@/lib/domain/round-dates";
import { roundCard } from "@/lib/services/course-resolution";
import { formattingForEvent, golfTermsForEvent } from "@/lib/services/organization";
import { MoreInfo } from "@/components/MoreInfo";
import { holesPlayed } from "@/lib/domain/handicap";
import { requestClusters, requestPairs, splitRequests } from "@/lib/domain/pairing-requests";
import { PairingRequests } from "@/components/PairingRequests";
import { parsePinSheet } from "@/lib/domain/pin-sheet";
import { firstHoleOf } from "@/lib/domain/hole-number";
import { RoundDaySetup } from "@/components/RoundDaySetup";
import { MembersAsk } from "@/components/ImportMembers";
import { membersAsked, peopleEntered } from "@/lib/domain/org-setup";
import { awaitingApproval } from "@/lib/registration";
import { orgProfile } from "@/lib/domain/org-profile";

export const metadata = screenMetadata("/foursomes");

export default async function FoursomesPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  await requireScreen("foursomes");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const params = await searchParams;

  /**
   * Which round's sheet is being drawn.
   *
   * This screen used to read state.activeStage and nothing else, alone among
   * every round-scoped screen in the app — score entry, prizes, teams and the
   * weekly view all let an organizer choose. Three things followed: next
   * week's sheet could not be drawn ahead, last week's could not be reopened,
   * and — the real fault — activeStage is DERIVED, so as a tournament advanced
   * the page silently changed which round it was editing, with nothing on
   * screen to say so.
   */
  /**
   * THE ROUND NOBODY HAS STARTED, because that is what a sheet is drawn for.
   *
   * The note above says this screen exists so next week's sheet can be drawn
   * ahead — and it opened on `activeStage`, the match-points chain's position,
   * which on a tournament part way through is a round already played. On the
   * Demo Cup that is Round 1, with Rounds 1 and 2 behind the field: the worst
   * of the three answers the app holds.
   *
   * `boardStage` would only have made it the second worst, which is why this
   * sat in the deferred register rather than being swept along with the other
   * round defaults — the tee sheet wants a THIRD question, and now there is
   * one to ask.
   *
   * Falling back to the board's round once everything has been played, which
   * is what somebody reopening a finished sheet is looking for.
   */
  const rounds = playingStages(state.stages);
  const stage =
    rounds.find((s) => s.id === params.round) ??
    state.nextUnplayedRound ??
    state.boardStage ??
    rounds[0] ??
    null;

  /**
   * The current leaderboard, for re-pairing and for drawing the leaders out
   * last.
   *
   * Only players who have actually posted something count. Both standings
   * lists rank the whole field, including people who haven't teed off — taking
   * them wholesale would hand every player a position before a ball was
   * struck, and "leaders out last" would then draw the sheet off nothing but
   * alphabetical noise.
   */
  const standings: Standing[] = state.isStroke
    ? state.strokeStandings
        // Ranked, not merely started: a card that stopped short holds no
        // position, and drawing "leaders out last" off a rank of 0 would put
        // those players out first for a reason nobody chose.
        .filter((s) => s.ranked)
        .map((s) => ({ playerId: s.player.id, position: s.rank }))
    : state.overall
        .filter((r) => r.stats.played > 0)
        .map((r) => ({ playerId: r.player.id, position: r.rank }));

  /**
   * The SELECTED round's hole count, not round one's.
   *
   * This read `playingStages(state.stages)[0]` — always the first round —
   * while the page lets an organizer draw any round they like, and the tee
   * names two dozen lines below already use `stage?.holes`. A nine-hole round
   * inside an eighteen-hole tournament is fully supported by `setStageHoles`,
   * and it broke both ways.
   *
   * Drawing a nine-hole Round 2 with a split start: `holes` arrived as 18, so
   * `startSlots` sent every second group off the 10TH TEE of a nine-hole
   * course. With two groups the sheet, the published draw and each player's
   * "your tee time" all named a hole that does not exist — while the help text
   * on the same screen said "the 1st and the 10th".
   *
   * The mirror is worse: a nine-hole Round 1 followed by an eighteen-hole
   * Round 2 passed 9, and `TeeSheetPrint` builds its columns from this number
   * — so it printed a nine-column card for an eighteen-hole round and players
   * had nowhere to write holes 10 to 18.
   */
  const holes = holesPlayed(stage?.holes);

  // Printed cards come from the SAVED sheet, never the on-screen preview —
  // the preview reshuffles on every visit, and a card has to match what was
  // announced. No saved sheet, no print button.
  const savedSheet = stage ? parseTeeSheet(stage.teeSheet) : null;

  /**
   * A league tee sheet is drawn from the week's attendees, not the season's
   * roster. Outside league mode this filter is the identity — every confirmed
   * player is in, exactly as before.
   *
   * Computed HERE rather than just above the draw, because the drift check
   * below has to compare the published sheet against the same field the sheet
   * was drawn FROM. It was comparing against `state.confirmed`, the whole
   * season roster: a twenty-player league with fourteen in for the week
   * produced "6 confirmed players have no tee time" on a sheet that was
   * perfectly correct, and republishing could not clear it because the next
   * draw excluded the same six. A warning that is permanently on is a warning
   * nobody reads the day it is real.
   */
  const attendanceMode = settingsOf(state.event).attendanceMode as AttendanceMode;
  /**
   * THE FIELD OF THIS ROUND'S SHEET — `sheetFieldFor`, the one answer: confirmed,
   * narrowed to the week's attendees in a league that asks each week, and to
   * those who made the cut once a cut has been made into the round. The move
   * action counts a group's room against the same field, so this screen never
   * offers a move the server refuses.
   *
   * The week's list comes back as rows an organizer can change (`WeekField`):
   * it used to be a sentence and nothing else, and under `captains` nobody could
   * be put ON.
   */
  const sheetField = stage ? await sheetFieldFor(session.eventId, stage.id) : null;
  const field = sheetField ? state.confirmed.filter((p) => sheetField.ids.has(p.id)) : state.confirmed;
  const weekRows: WeekFieldRow[] = sheetField?.weekRows ?? [];
  // A cut, for the lines below that say who missed it (the field above is already narrowed by it).
  const cutField = stage ? await strokeCutField(session.eventId, stage.id) : null;
  /**
   * AND A CUT WAITING ON A TIE SAYS SO, HERE (2026-10-23). Until the committee
   * records the play-off or the draw for the last place, the cut into this
   * round cannot be made, so the sheet below is still the whole field — and a
   * secretary drawing it should know why, and that nobody has been picked.
   */
  const cutWaiting = await (async () => {
    if (!stage || cutField || !stage.cutEnabled) return "";
    // The round a stroke cut into this one is taken out of (`cutFeederOf`, the
    // one answer to "which round decides a cut").
    const line = cutFeederOf(state.playRounds, stage.id);
    const feeder = line?.kind === "card" ? line.feeder : undefined;
    if (!feeder) return "";
    const made = await strokeCutOutcomeOf(session.eventId, feeder.id);
    if (!made || made.outcome.undecided.length === 0) return "";
    return `The cut into ${roundLabel(state.stages, stage.id)} is not made yet. ${cutTieRefusal(
      made.outcome.undecided,
      made.names,
      roundLabel(state.stages, feeder.id) || "the round before",
    )} Until then this sheet is drawn from the whole field.`;
  })();

  /**
   * PAIRING REQUESTS for this round's field — each request once, whichever of
   * the two made it; the clusters the draw keeps together; and any the saved
   * sheet splits because they came in after it was drawn.
   */
  const requestRows = await prisma.player.findMany({
    where: { eventId: session.eventId, status: "confirmed" },
    select: { id: true, playWith: true },
  });
  const fieldIds = field.map((p) => p.id);
  const requestClustersNow = requestClusters(requestPairs(requestRows), fieldIds);
  const inField = new Set(fieldIds);
  const seenPair = new Set<string>();
  const requestList = requestPairs(requestRows)
    .filter(([a, b]) => inField.has(a) && inField.has(b))
    .filter(([a, b]) => {
      const key = [a, b].sort().join("|");
      if (seenPair.has(key)) return false;
      seenPair.add(key);
      return true;
    })
    .map(([a, b]) => ({ a, b }));
  const splitOnSheet = savedSheet ? splitRequests(savedSheet.groups, requestClustersNow) : [];

  // Only meaningful once a sheet has actually gone out: an unpublished draft
  // being out of step with the field is just a draft.
  const drift =
    savedSheet && stage?.teeSheetPublished
      ? teeSheetDrift(savedSheet, new Set(field.map((p) => p.id)))
      : null;
  /**
   * WHO HAS NO GROUP ON THE SAVED SHEET, AND WHERE THERE IS ROOM (day-of field
   * changes, PR B): a late entry or a reserve who moved in is written into one
   * group, and nobody else moves. Staff only, and only while the one field rule
   * allows it (`place-in-group`). Drawn from the same `field` the sheet is.
   */
  const isStaff = session.role === "admin" || session.role === "assistant";
  const undrawn = savedSheet && isStaff ? undrawnOn(savedSheet, fieldIds) : [];
  // THE ONE TEE-SHEET RULE (`teeSheetChangeAllowed`), asked of this round — the same doors the actions refuse by.
  const doors = stage ? await teeSheetDoorsFor(session.eventId, stage.id) : null;
  const placeDoor = undrawn.length > 0 ? (doors?.place ?? null) : null;
  const nameOf = new Map(field.map((p) => [p.id, p.name]));
  /**
   * MOVING ON A SAVED SHEET (tee sheet moves): staff, while the field rule allows
   * a change, with the slots that have begun and why — asked of the club's clock
   * (`slotLocksFor`), the same reader the server action refuses on.
   */
  const canMove = !!(stage && savedSheet && isStaff);
  const moveDoor = canMove ? (doors?.move ?? null) : null;
  const slotLocks = canMove && !moveDoor && stage && savedSheet ? await slotLocksFor(session.eventId, stage.id, savedSheet) : {};
  /**
   * "REPLACE…" BESIDE A PLAYER (B43): staff, on a saved sheet, where a player is a unit of their own or
   * of a pair — not where the draw IS the pairing (individual match play) and not a cup session (its own
   * screen). What it chooses from is `replaceWorldFor`, the facts the server refuses on.
   */
  const replaceMode = stage ? moveModeOf(stage) : "groups";
  const replace =
    canMove && !moveDoor && stage && savedSheet && replaceMode !== "groups" && stage.type !== TEAM_SESSION
      ? await replaceWorldFor(session.eventId, stage.id, savedSheet, replaceMode === "sides").then((r) => ({
          candidates: r.candidates,
          world: r.world,
          inSides: replaceMode === "sides",
          weekly: tracksPerRound(attendanceMode),
          scoringBasis: stage.scoringBasis,
        }))
      : null;
  // The round's day at the club — its own, or the tournament's first day for
  // the first round (as the late-entry cutoff reads it) — for which groups are out.
  const roundDay = stage ? cleanIsoDate(stage.playedOn) || (stage.id === rounds[0]?.id ? cleanIsoDate(state.event.startOn) : "") : "";
  /**
   * The card THIS ROUND is played on, narrowed to the nine it uses.
   *
   * This printed the EVENT's card, so a two-course tournament put round one's
   * par and stroke index on round two's scorecards — the same gap
   * `loadEventState` was changed to close for scoring, arriving on the sheet
   * the players actually carry. `cardForStage` also narrows and re-ranks a
   * nine, so the dots printed beside a name are the holes the round allocates
   * a stroke on.
   */
  const roundCourse = stage?.courseId
    ? await prisma.course.findUnique({ where: { id: stage.courseId } })
    : null;
  const course = roundCard(stage, state.event, roundCourse);
  // The club's own date order for the round tabs (`shortDate`).
  const { locale } = await formattingForEvent(session.eventId);
  /**
   * WHAT THIS ROUND'S PRINTED SHEETS SAY NOW, against what was printed.
   *
   * The cards this screen used to print — and the chain that priced them: the
   * course handicap off the tee being played, the allowance of the unrounded
   * figure rounded once, the strokes for tees of a higher par, the frozen
   * figure, a match off its low — moved whole to `services/print-kit.ts`
   * (2026-10-23), which every printed document now reads. This screen keeps
   * the door to it, and says when paper already handed out has gone stale.
   */
  const kit = stage ? await printKit(session.eventId, { stageId: stage.id, origin: requestOrigin(await headers()) }) : null;
  const staleSheets = kit?.statuses.filter((s) => s.state === "stale") ?? [];

  /** The round's sides, so partners go out together on the sheet (`groupBySides`). */
  const teams =
    stage && needsTeams(stage.format)
      ? await teamsForStage(session.eventId, stage.id, stage.format, stage.handicapAllowance, holes, stage.allowanceWeights)
      : [];
  /**
   * A PAIRS ROUND IS DRAWN BY THE SIDES' POSITION (2026-10-10). Round 2 of a
   * two-round better-ball goes out leaders last, like any championship — but
   * "By position" read the INDIVIDUAL stroke standings, which a team round
   * never fills, so it stayed greyed out. Each member is given their side's
   * place in the previous team round of the event, read through
   * `teamStandings` exactly as the team board reads it, and the draw orders
   * whole sides by it (`sidesByStandings`).
   */
  const sideStandings: Standing[] = await (async () => {
    if (!stage || teams.length === 0) return [];
    const rounds = playingStages(state.stages);
    const prior = rounds
      .slice(0, rounds.findIndex((r) => r.id === stage.id))
      .reverse()
      .find((r) => needsTeams(r.format));
    if (!prior) return [];
    // The same card the team board prices that round on, so the draw and the
    // board cannot disagree about who leads.
    const card = state.strokeCourseFor(prior.id);
    const rows = await teamStandings(
      session.eventId,
      prior.id,
      prior.format,
      card.pars,
      card.holeDifficulty,
      prior.scoringBasis,
      prior.handicapAllowance,
      prior.allowanceWeights,
      prior.countBest,
    );
    return rows
      .filter((r) => r.played > 0)
      .flatMap((r, i) => r.memberIds.map((playerId) => ({ playerId, position: i + 1 })));
  })();
  /** The course's number for this card's first hole — 10 on a back nine, so the sheet says "Hole 12", not "Hole 3". */
  const firstHole = firstHoleOf(course);

  /** Where the holes are cut for this round — the editor below, and a row on every printed card. */
  const pinSheet = stage ? parsePinSheet(stage.pinSheet, holes) : [];

  /**
   * THE DRAW ASKS FOR THE MEMBERS (Cut A, event-first, Ajay 15 Nov 2026). The
   * members list is never asked for before the first event; it is asked for
   * HERE, where it is first needed: nobody has entered and the club's list is
   * empty too. Asked of staff only, and only when the field is empty, so a
   * running tournament never pays for the two reads. Once the club has a list
   * the same card stays (so the import's answer is still on screen after it)
   * and says to pick who is playing on Entries instead.
   */
  const entered = peopleEntered(state.confirmed.length, awaitingApproval(state.players).length, state.waitlist.length);
  const askMembers =
    isStaff && entered === 0
      ? await (async () => {
          const org = await prisma.organization.findUnique({
            where: { id: state.event.organizationId },
            select: { kind: true, country: true, communityNoun: true },
          });
          if (!org) return null;
          const profile = orgProfile(org.kind, org.country, org.communityNoun);
          if (!profile.sharedRoster) return null;
          const memberCount = await prisma.member.count({ where: { organizationId: state.event.organizationId, status: "active" } });
          return { noun: profile.noun, asked: membersAsked({ ...org, memberCount, fieldSize: entered }), memberCount };
        })()
      : null;

  const terms = await golfTermsForEvent(session.eventId);
  const noticesOff = noticesOffWords(await noticesOffAmong(session.eventId, field.map((p) => p.id)));
  const roundTabs = rounds.map((r) => ({
    id: r.id,
    label: roundLabelWith(rounds, r.id, r.playedOn ? shortDate(r.playedOn, locale) : ""),
  }));

  const membersAskEl = askMembers ? <MembersAsk noun={askMembers.noun} asked={askMembers.asked} memberCount={askMembers.memberCount} /> : null;

  /* The list the sheet below is drawn from, and the control that changes
     it — in that order, above the draw, because a sheet drawn from the
     wrong field is not worth reading. */
  const weekFieldEl =
    stage && weekRows.length > 0 ? (
      <WeekField
        stageId={stage.id}
        roundLabel={roundLabel(state.stages, stage.id)}
        mode={attendanceMode}
        rows={weekRows}
        canEdit={session.role === "admin" || session.role === "assistant"}
      />
    ) : null;

  /* A published sheet is a snapshot of a field that keeps moving.
     validateTeeSheet ran when it went out and never again, so a player
     withdrawn on the Wednesday stayed in the stored draw: the group
     printed with three and a gap, and nothing said why. The print already
     drops the missing name — this is what tells the committee it happened,
     so they can move somebody up rather than send out a three-ball they
     did not choose. */
  const driftEl = drift?.stale ? (
    <SheetDriftCard
      sentence={driftSentence(
        drift,
        new Set(cutField ? state.confirmed.filter((p) => !cutField.has(p.id)).map((p) => p.id) : []),
      )}
      anyUndrawn={drift.undrawn.length > 0}
    />
  ) : null;

  /* Mounted whenever staff have a saved sheet, though nobody is undrawn: the
     refresh after placing the LAST player must not take away the line that
     says where they went (round day-of-field-b-3, phone). The card draws
     nothing when it has nothing to show. */
  const placeEl =
    stage && savedSheet && isStaff ? (
      <PlaceInGroup
        stageId={stage.id}
        undrawn={undrawn.map((id) => ({ id, name: nameOf.get(id) ?? "" }))}
        groups={markTeedOff(groupsWithRoom(savedSheet, new Set(fieldIds)), roundDay, clubWallClock(state.timeZone))}
        door={placeDoor}
        firstHole={firstHole}
      />
    ) : null;

  const pairingEl =
    stage && field.length > 1 ? (
      <PairingRequests field={field.map((p) => ({ id: p.id, name: p.name }))} pairs={requestList} splitOnSheet={splitOnSheet} />
    ) : null;

  /** The groups. The redesigned screen has its own round tabs, so it hands the maker none (`pickRounds` false). */
  const makerEl = (pickRounds: boolean) => (
      <FoursomeMaker
        firstHole={firstHole}
        canMove={canMove}
        door={moveDoor}
        saveDoor={doors?.save ?? null}
        moveMode={stage ? moveModeOf(stage) : "groups"}
        locks={slotLocks}
        replace={replace}
        requests={requestClustersNow}
        players={field.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapType: p.handicapType, handicapSource: p.handicapSource, seed: p.seed }))}
        // The round's sides, so partners go out together — `groupBySides`.
        // Loaded above for the cards already; empty for a round with no sides.
        // Where sides are drawn against each other, a match's two sides are one
        // unit, so the four who play each other go out together (`sidesByMatch`).
        sides={sidesByMatch(
          teams.map((t) => ({ id: t.id, playerIds: t.members.map((m) => m.playerId) })),
          stage ? state.matches.filter((m) => m.stageId === stage.id && m.teamAId && m.teamBId) : [],
        )}
        // "7 foursomes · 1 twosome", or "7 fourballs · 1 two-ball" for a UK club.
        terms={terms}
        standings={sideStandings.length > 0 ? sideStandings : standings}
        holes={holes}
        stageId={stage?.id ?? ""}
        savedAt={stage ? parseTeeSheet(stage.teeSheet)?.savedAt ?? "" : ""}
        // The sheet of record, so the screen shows what the players were given
        // rather than a fresh shuffle — see `sheetOnScreen`.
        savedGroups={savedSheet?.groups ?? []}
        savedStart={savedSheet?.startType}
        published={stage?.teeSheetPublished ?? false}
        // Beside Publish (J39/J40 PR 2): how many of this sheet's field a tee-time push cannot reach.
        noticesOff={noticesOff}
        rounds={pickRounds ? roundTabs : []}
        activeRoundId={stage?.id ?? ""}
        // Only when the field above has actually been narrowed to a week. In a
        // tournament `field` IS the roster, and passing it would turn "nobody
        // has entered" into "nobody is in for this round" on a screen with no
        // round to be in.
        rosterSize={weekRows.length > 0 ? state.confirmed.length : 0}
      />
  );

  /*
       * PRINT… — THE TEE SHEET'S DOOR TO THE PRINT KIT (decision A).
       *
       * This screen printed its own cards, one per group, and `/scorecard` and
       * Reports both sent people HERE to find the button (`#print-scorecards`,
       * Ajay 2026-09-22: "it takes me to teesheet and not the actual
       * scorecards"). The anchor stays, on the door: the Print kit opens with
       * this sheet's documents ticked, and is the one way to the printer.
       *
       * AND IT SAYS WHEN PAPER ALREADY OUT HAS STOPPED BEING TRUE (decision D):
       * a group moved, a tee time changed, a code reissued after the cards and
       * signs were printed.
       */
  const printEl =
    stage && savedSheet ? (
      <PrintDoor stageId={stage.id} roundName={roundLabel(rounds, stage.id) || "this round"} cartWord={terms.cart} stale={staleSheets} />
    ) : null;
  const daySetupEl = stage ? (
    <RoundDaySetup
      // Re-mounted per round, so switching rounds never shows the last
      // round's pins in the editor.
      key={stage.id}
      stageId={stage.id}
      roundLabel={roundLabel(rounds, stage.id)}
      holes={holes}
      pars={course.pars}
      sheet={pinSheet}
      paceMinutes={stage.paceMinutes}
      firstHole={firstHole}
    />
  ) : null;

  /**
   * THE REDESIGNED SCREEN (R9a), for a stroke or Stableford round, behind the redesign switch (OFF for everybody
   * but a preview). `screensShownFor` is the one question; `drawSections` says whether this round has the new
   * screen yet (a knockout, a cup and a casual round still draw the tee sheet below).
   */
  const told = await tournamentStatusFor(session.eventId, state.today);
  const shown = await screensShownFor(session);
  const plan = stage && told ? drawSections({ type: stage.type, format: stage.format, hasSavedSheet: !!savedSheet }, told.status.family) : null;
  if (shown.has("teeTimes") && stage && told && plan?.built) {
    const job = await openTournamentJob(session.eventId, state.today);
    // While the screen is only previewed its own links keep the preview on; once it is on for everybody they are plain.
    const query = new URLSearchParams((await headers()).get("x-search") ?? "");
    const previewMode: ConsoleMode | null = query.get(STEPPER_PREVIEW) !== "1" ? null : query.get(BUILD_PREVIEW) === "1" ? "build" : "preview";
    const mine = told.status.rounds.find((r) => r.id === stage.id);
    const chips = courseDayOf(told.status).rounds;
    const needs = (mine?.needs ?? [])
      .filter((n) => n.key === "draw" || n.key === "teeSheet" || n.key === "date")
      .map((n) => ({
        key: n.key,
        text: needSentence(roundLabel(state.stages, stage.id), n),
        href: n.key === "draw" ? "#draw" : n.key === "teeSheet" ? "#draw" : `/stages?round=${stage.id}`,
      }));
    const sheetLock = await scopeLockFor(session.eventId, "teeSheet");
    /**
     * THE DRAW CONTROLS OF A ROUND OF MATCHES (R9b), each mounted here only while this screen builds the round:
     * "Generate matches" for a round of sides (Teams & pairs draws it otherwise: `matchGeneratorPlace`), and
     * "Draw Round n's matches" for a round drawn from the one before (Rounds & formats keeps it until its link
     * here). `drawControlsOf` is the one answer to which a round has. A league's sides are nominated, so the
     * generator is never offered there (`generateTeamMatches` refuses it).
     */
    const family = told.status.family;
    const controls = drawControlsOf(stage, {
      launched: told.status.step !== "setting-up",
      // As Rounds & formats reads it: the first of ALL the stages (a cut marker counts), never of the playing rounds.
      isFirst: state.stages[0]?.id === stage.id,
      completed: told.status.step === "completed",
      league: isLeaguePointsSystem(state.event.leaguePoints),
    });
    const roundMatches = state.matches.filter((m) => m.stageId === stage.id).length;
    const generatorHere =
      isStaff &&
      controls.teamMatches &&
      !isLeaguePointsSystem(state.event.leaguePoints) &&
      matchGeneratorPlace({ type: stage.type, format: stage.format, hasSavedSheet: !!savedSheet }, family, true) === "teeTimes";
    // AN INTERCLUB LEAGUE'S "DRAW THIS WEEK" IS DRAWN HERE (B110; the TD's ruling of 23 Nov): the week's four-balls
    // (`LeagueDraw`, which writes the matches) in the week's draw section, mounted only while this screen builds the round
    // (`leagueDrawPlace`, the one answer `LeagueSection` asks to hide its own) and the league has clubs, as `LeagueSection`
    // requires. Nominating the pairs stays on Teams & pairs, under Players, and is said here with a link. (The name is the
    // old pointer's: the JSX below is unchanged.)
    const leagueClubs = isStaff && controls.leagueWeek ? await flightsIn(session.eventId) : [];
    const leagueWeekPointer =
      leagueClubs.length > 0 && leagueDrawPlace({ type: stage.type, format: stage.format, hasSavedSheet: !!savedSheet }, family, true) === "teeTimes" ? (
        <div data-league-week="" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <p data-league-pairs-pointer="" className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            The week&rsquo;s pairs are nominated on{" "}
            <a href={previewMode ? consoleUrl(`/teams?round=${stage.id}`, previewMode) : `/teams?round=${stage.id}`} style={{ display: "inline-block", minHeight: 48 }}>
              Teams &amp; pairs
            </a>
            ; draw the week&rsquo;s four-balls from them here.
          </p>
          <LeagueDraw stageId={stage.id} drawn={roundMatches} />
        </div>
      ) : null;
    const sidesLock = generatorHere ? await scopeLockFor(session.eventId, "sides") : null;
    const nextRoundEl = await (async () => {
      if (!isStaff || !controls.nextRound) return null;
      // A tie at a round robin's cut line, for the round it decides the field of (`roundRobinCutOf`, the answer the round is drawn with).
      let cutTie: { feederId: string; ties: CutTieOnCard[] } | null = null;
      if (stage.cutEnabled) {
        const made = await roundRobinCutOf(session.eventId, stage.id);
        if (made) {
          const name = (id: string) => made.names.get(id) ?? "A player";
          const ties = [
            ...made.outcome.undecided.map((t) => ({ t, chosen: [] as string[] })),
            ...made.outcome.decided.map((t) => ({ t, chosen: t.through })),
          ].map(({ t, chosen }) => ({ tied: t.playerIds, names: t.playerIds.map(name), places: t.places, by: t.by, chosen }));
          if (ties.length > 0) cutTie = { feederId: made.feeder.id, ties };
        }
      }
      return (
        <DrawRound
          stage={{ id: stage.id, type: stage.type, matchCount: roundMatches, cutEnabled: stage.cutEnabled, cutTies: stage.cutTies, cutTie }}
          label={roundLabel(rounds, stage.id) || "this round"}
        />
      );
    })();
    // THE ONE ROUND-HANDICAPS PANEL: here while this screen is shown, on Rounds & formats while it is not.
    const handicapRows = isStaff && stage.scoringBasis !== "gross" ? await roundHandicapsFor(session.eventId, stage.id) : [];
    const isAdmin = session.role === "admin";
    const groupsOf = savedSheet?.groups ?? [];
    const who = membersAskEl || weekFieldEl || cutWaiting || handicapRows.length > 0;
    return (
      <TeeTimesScreen
        kicker={phaseTitle("draw", told.status.family)}
        roundLabel={roundLabel(state.stages, stage.id)}
        roundChip={chips[stage.id] ?? { chip: "Upcoming", tone: "neutral" }}
        tabs={rounds.map((r) => ({ stageId: r.id, label: `${roundLabelWith(rounds, r.id, r.playedOn ? shortDate(r.playedOn, locale) : "")} · ${chips[r.id]?.chip ?? ""}` }))}
        activeStageId={stage.id}
        find={
          isStaff
            ? {
                players: state.players.map((p) => ({ id: p.id, name: p.name, status: p.status })),
                rounds: rounds.map((r) => ({
                  id: r.id,
                  label: roundLabel(state.stages, r.id),
                  published: r.teeSheetPublished,
                  groups: parseTeeSheet(r.teeSheet)?.groups ?? [],
                })),
                nextUnplayedId: state.nextUnplayedRound?.id ?? null,
              }
            : null
        }
        needs={needs}
        keys={plan.keys}
        needsYou={needsYouSection(job, stage.id, plan.keys)}
        previewMode={previewMode}
        sections={{
          whoIn: who
            ? {
                state: cutWaiting ? "The cut is waiting on a tie" : `${field.length} in the field`,
                node: (
                  <>
                    {membersAskEl}
                    {weekFieldEl}
                    <CutWaitingCard text={cutWaiting} />
                    {handicapRows.length > 0 && (
                      <RoundHandicaps stageId={stage.id} rows={handicapRows} roundName={roundLabel(rounds, stage.id) || "this round"} />
                    )}
                  </>
                ),
              }
            : undefined,
          draw: {
            state: stage.teeSheetPublished ? "Published" : savedSheet ? "Saved, not published" : "Not drawn yet",
            // The pairing requests sit above the banner: `setPairingRequest` asks no lock, so a banner over it
            // would stand above a control that still writes (lock-scopes.md).
            node: (
              <>
                {nextRoundEl}
                {leagueWeekPointer}
                {pairingEl}
                {/* ONE banner for the section: the sheet's lock, and the sides' while the generator is here (one banner id per page). */}
                <LockedOnce locks={[...(sheetLock ? [sheetLock] : []), ...(sidesLock ? [sidesLock] : [])]} isAdmin={isAdmin} correction={null} open={null}>
                  {() => (
                    <>
                      {generatorHere && (
                        <TeamMatchesControl roundId={stage.id} matchCount={roundMatches} sideCount={teams.length} locked={sidesLock !== null} otherBusy={false} />
                      )}
                      {makerEl(false)}
                    </>
                  )}
                </LockedOnce>
              </>
            ),
          },
          teeTimes: {
            state: groupsOf.length > 0 ? `${groupsOf.length} groups, first off ${groupsOf[0].time}` : "No tee times yet",
            node: (
              <>
                {driftEl}
                {placeEl}
                <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                  The start and the tee times are set in the groups above; a late entry is put in a group here.
                </p>
              </>
            ),
          },
          onTheDay: { state: "Pins and pace", node: daySetupEl },
          paper: printEl
            ? { state: staleSheets.length > 0 ? staleSentence(staleSheets.length) : "From the saved sheet", node: printEl }
            : undefined,
        }}
      />
    );
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h1 className="page-title">Tee sheet</h1>
        {/* One line, the rest an ⓘ away (2026-10-05). */}
        <MoreInfo short="Who plays together, in what order, from which tee." style={{ marginTop: 6 }}>
          Once a round has been played you can re-pair off the leaderboard and send the leaders out last.
        </MoreInfo>
      </div>

      {membersAskEl}
      {weekFieldEl}
      <CutWaitingCard text={cutWaiting} />
      {driftEl}
      {placeEl}
      {pairingEl}
      {makerEl(true)}
      {printEl}
      {daySetupEl}
    </>
  );
}
