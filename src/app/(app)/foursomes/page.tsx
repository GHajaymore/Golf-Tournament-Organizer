import Link from "next/link";
import { headers } from "next/headers";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { roundLabel, roundLabelWith } from "@/lib/domain/round-label";
import { teamsForStage, teamStandings } from "@/lib/services/teams";
import { needsTeams } from "@/lib/formats";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { printKit } from "@/lib/services/print-kit";
import { staleSentence } from "@/lib/domain/print-kit";
import { requestOrigin } from "@/lib/request-origin";
import { screenName } from "@/lib/nav";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FoursomeMaker } from "@/components/FoursomeMaker";
import { WeekField, type WeekFieldRow } from "@/components/WeekField";
import { sidesByMatch, type Standing } from "@/lib/domain/draw";
import { prisma } from "@/lib/db";
import { settingsOf } from "@/lib/services/tournament";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { parseTeeSheet, teeSheetDrift, driftSentence } from "@/lib/domain/tee-sheet";
import { strokeCutField, strokeCutOutcomeOf, cutTieRefusal } from "@/lib/services/stroke-cut";
import { shortDate } from "@/lib/domain/round-dates";
import { roundCard } from "@/lib/services/course-resolution";
import { formattingForEvent, golfTermsForEvent } from "@/lib/services/organization";
import { Icon } from "@/components/Icon";
import { MoreInfo } from "@/components/MoreInfo";
import { holesPlayed } from "@/lib/domain/handicap";
import { requestClusters, requestPairs, splitRequests } from "@/lib/domain/pairing-requests";
import { PairingRequests } from "@/components/PairingRequests";
import { parsePinSheet } from "@/lib/domain/pin-sheet";
import { firstHoleOf } from "@/lib/domain/hole-number";
import { RoundDaySetup } from "@/components/RoundDaySetup";

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
  let field = state.confirmed;
  /**
   * The week's list, as rows an organizer can change.
   *
   * It used to be a SENTENCE — "This week: 14 in · 6 out" — and nothing else,
   * which was honest about the field and useless about it. There was no staff
   * writer for attendance anywhere in the app, so the count was the end of the
   * conversation: a player who missed the sign-up deadline could not be taken
   * off by the committee, and under `captains` — where the help text promises
   * the club enters the list its captains send in — nobody could be put ON.
   * That mode resolved every player to out and drew from an empty field.
   */
  let weekRows: WeekFieldRow[] = [];
  if (tracksPerRound(attendanceMode) && stage) {
    const explicit = await prisma.roundAttendance.findMany({
      where: { eventId: session.eventId, stageId: stage.id },
    });
    const resolved = resolveAttendance(
      attendanceMode,
      state.confirmed.map((p) => p.id),
      explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
    );
    const inIds = new Set(resolved.rows.filter((r) => r.status === "in").map((r) => r.playerId));
    field = state.confirmed.filter((p) => inIds.has(p.id));
    const nameById = new Map(state.confirmed.map((p) => [p.id, p.name]));
    weekRows = resolved.rows.map((r) => ({
      playerId: r.playerId,
      name: nameById.get(r.playerId) ?? "",
      status: r.status,
      explicit: r.explicit,
      decidedBy: r.decidedBy,
    }));
  }

  /**
   * AND A ROUND A CUT HAS BEEN MADE INTO IS DRAWN FROM THOSE WHO MADE IT
   * (2026-10-09). Walked on a 120-player championship cut to 40: the Round 2
   * sheet drew all 119, forty three-balls, and a player who missed the cut read
   * "Missed the cut" over "Group 1 · 8:00 AM". `strokeCutField` is the field the
   * cut made — the players holding a card for the round — and null before it.
   */
  const cutField = stage ? await strokeCutField(session.eventId, stage.id) : null;
  if (cutField) field = field.filter((p) => cutField.has(p.id));
  /**
   * AND A CUT WAITING ON A TIE SAYS SO, HERE (2026-10-23). Until the committee
   * records the play-off or the draw for the last place, the cut into this
   * round cannot be made, so the sheet below is still the whole field — and a
   * secretary drawing it should know why, and that nobody has been picked.
   */
  const cutWaiting = await (async () => {
    if (!stage || cutField || !stage.cutEnabled) return "";
    const at = state.playRounds.findIndex((s) => s.id === stage.id);
    const feeder = at > 0 ? state.playRounds[at - 1] : undefined;
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

      {/* The list the sheet below is drawn from, and the control that changes
          it — in that order, above the draw, because a sheet drawn from the
          wrong field is not worth reading. */}
      {stage && weekRows.length > 0 && (
        <WeekField
          stageId={stage.id}
          roundLabel={roundLabel(state.stages, stage.id)}
          mode={attendanceMode}
          rows={weekRows}
          canEdit={session.role === "admin" || session.role === "assistant"}
        />
      )}

      {cutWaiting && (
        <div
          role="status"
          className="card elev-sm"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 6 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> The cut is waiting on a tie
          </span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            {cutWaiting} <Link href="/dashboard">Go to the cut card</Link>
          </p>
        </div>
      )}

      {/* A published sheet is a snapshot of a field that keeps moving.
          validateTeeSheet ran when it went out and never again, so a player
          withdrawn on the Wednesday stayed in the stored draw: the group
          printed with three and a gap, and nothing said why. The print already
          drops the missing name — this is what tells the committee it happened,
          so they can move somebody up rather than send out a three-ball they
          did not choose. */}
      {drift?.stale && (
        <div
          className="card elev-sm"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 6 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> The published sheet no longer matches the field
          </span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            {driftSentence(
              drift,
              new Set(cutField ? state.confirmed.filter((p) => !cutField.has(p.id)).map((p) => p.id) : []),
            )}{" "}
            Re-pair and publish again to put it right — the printed sheet leaves out anyone who has gone, so
            it is correct but shorter than you drew it.
          </p>
        </div>
      )}
      {stage && field.length > 1 && (
        <PairingRequests
          field={field.map((p) => ({ id: p.id, name: p.name }))}
          pairs={requestList}
          splitOnSheet={splitOnSheet}
        />
      )}
      <FoursomeMaker
        firstHole={firstHole}
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
        terms={await golfTermsForEvent(session.eventId)}
        standings={sideStandings.length > 0 ? sideStandings : standings}
        holes={holes}
        stageId={stage?.id ?? ""}
        savedAt={stage ? parseTeeSheet(stage.teeSheet)?.savedAt ?? "" : ""}
        // The sheet of record, so the screen shows what the players were given
        // rather than a fresh shuffle — see `sheetOnScreen`.
        savedGroups={savedSheet?.groups ?? []}
        savedStart={savedSheet?.startType}
        published={stage?.teeSheetPublished ?? false}
        rounds={rounds.map((r) => ({
          id: r.id,
          label: roundLabelWith(rounds, r.id, r.playedOn ? shortDate(r.playedOn, locale) : ""),
        }))}
        activeRoundId={stage?.id ?? ""}
        // Only when the field above has actually been narrowed to a week. In a
        // tournament `field` IS the roster, and passing it would turn "nobody
        // has entered" into "nobody is in for this round" on a screen with no
        // round to be in.
        rosterSize={weekRows.length > 0 ? state.confirmed.length : 0}
      />
      {/*
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
       */}
      {stage && savedSheet && (
        <div id="print-scorecards" className="card elev-sm" style={{ marginTop: 16, gap: 8, scrollMarginTop: 80 }}>
          {staleSheets.length > 0 && (
            <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
              <Icon name="warning-circle" /> <strong>{staleSentence(staleSheets.length)}:</strong>{" "}
              {staleSheets.slice(0, 8).map((s) => s.label).join(" · ")}
              {staleSheets.length > 8 ? ` and ${staleSheets.length - 8} more` : ""}.{" "}
              <Link href={`/print?round=${stage.id}&stale=1`}>Reprint them in the {screenName("/print")}</Link>
            </p>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link
              href={`/print?round=${stage.id}&docs=cards,cup,slips,signs,spare,start`}
              className="btn btn-secondary"
              style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="printer" /> Print…
            </Link>
            <span className="text-muted" style={{ fontSize: 13 }}>
              Scorecards, {(await golfTermsForEvent(session.eventId)).cart} signs and the starting sheet for {roundLabel(rounds, stage.id) || "this round"}, from the saved sheet.
            </span>
          </div>
        </div>
      )}
      {stage && (
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
      )}
    </>
  );
}
