import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { roundLabel, roundLabelWith } from "@/lib/domain/round-label";
import { teeNamesForRound, teesForEvent, teeForPlay, roundCourseHandicaps, flightTeeByPlayer } from "@/lib/services/handicaps";
import { effectiveAllowance, effectiveCountBest, teamsForStage } from "@/lib/services/teams";
import { needsTeams, sharesOneCard } from "@/lib/formats";
import { isHeadToHead } from "@/lib/stage-types";
import { allocatedStrokes, matchStrokesCount, matchStrokesPerHole } from "@/lib/domain/team";
import { playingHandicapFrom } from "@/lib/domain/handicap";
import { loadEventState, playingStages } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FoursomeMaker } from "@/components/FoursomeMaker";
import { WeekField, type WeekFieldRow } from "@/components/WeekField";
import type { Standing } from "@/lib/domain/draw";
import { prisma } from "@/lib/db";
import { settingsOf } from "@/lib/services/tournament";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { parseTeeSheet, teeSheetDrift } from "@/lib/domain/tee-sheet";
import { shortDate } from "@/lib/domain/round-dates";
import { TeeSheetPrint } from "@/components/TeeSheetPrint";
import { resolveCourse } from "@/lib/courses";
import { cardForStage, courseForRound } from "@/lib/services/course-resolution";
import { brandForEvent } from "@/lib/services/organization";
import { Icon } from "@/components/Icon";
import { holesPlayed } from "@/lib/domain/handicap";

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
  const course = cardForStage(courseForRound(roundCourse, state.event) ?? resolveCourse(state.event), stage);
  const brand = await brandForEvent(session.eventId);
  const nameOf = new Map(state.confirmed.map((p) => [p.id, p]));
  /**
   * The tee each player is on, for the card they carry out.
   *
   * Resolved through the round's own handicap reader, so the set printed
   * beside a name is the set the round is scored from — including when the
   * competition holds the whole field to one. A card that named a different
   * tee to the one the strokes came from would be worse than a card that
   * named none.
   */
  /**
   * The round's own set — the CONFIGURED one, not the first by position.
   *
   * The comment here used to state the opposite as a fact: "the first tee by
   * position, which is the same default every scoring path uses". It was not.
   * `roundTeeId` puts the round's `defaultTeeId` ahead of first-by-position and
   * the board, the importer, the regrouper, teams and skins all go through it —
   * so a club whose rows run Blue, White and sets its medal off the Whites had
   * this print "Blue" beside every name on a card scored off White. The false
   * invariant is the reason nobody looked: it read as though it had been
   * checked.
   */
  const eventTees = await teesForEvent(session.eventId);
  const teeNames = await teeNamesForRound(
    session.eventId,
    holesPlayed(stage?.holes),
    // The round’s own set first, and the fallback scoped to the course it is
    // played on — a tee sheet for day two of a two-venue event named day
    // one’s tees. See `teeForPlay`.
    teeForPlay(
      eventTees,
      { stageTeeId: stage?.teeId, eventDefaultTeeId: state.event.defaultTeeId },
      stage?.courseId ?? state.event.courseId ?? null,
    ),
  );
  /**
   * THE SHOTS EACH PLAYER GETS, AND WHERE — for the card they carry out.
   *
   * The printed card had blank boxes and a handicap index beside the name, so
   * a player in a net competition could not see which holes they receive a
   * stroke on. The entry screen has shown those dots for a long time; paper
   * had nothing. Ajay, 2026-09-22: "so you have that build into online score
   * entry. now we just need to have it on printed paper."
   *
   * THROUGH THE SAME CHAIN THE ROUND IS SCORED ON, every step of it:
   * `roundCourseHandicaps` for the course handicap off the tee actually being
   * played, `effectiveAllowance` for the round's allowance including the
   * per-format rules and the zero default, and `allocatedStrokes` to apply the
   * allowance ONCE and then spread it by stroke index. That last order is not
   * an implementation detail — `team.ts` records that applying the allowance
   * per hole rounds each hole separately and drifts by several strokes over a
   * round.
   *
   * A second reading here would eventually print dots the round does not
   * score, which is worse than printing none: a player marks a net score on
   * the strength of a dot that was not there.
   */
  const allowance = stage ? effectiveAllowance(stage.format, stage.handicapAllowance) : 100;
  const courseHandicaps = roundCourseHandicaps({
    tees: eventTees,
    players: state.confirmed,
    flightTeeOf: await flightTeeByPlayer(session.eventId),
    stage,
    event: state.event,
  });
  /**
   * ALREADY NARROWED. `course` above is `cardForStage(...)`, which selects the
   * round's nine and RE-RANKS its stroke index — so this was
   * `course.strokeIndex.slice(0, holes)` and both wrong and unnecessary: an
   * eighteen-hole index sliced to nine is 1,3,5,…,17, which is the exact fault
   * `a round's card is narrowed in exactly one place` exists to stop. It
   * caught it.
   */
  const cardStrokeIndex = course.strokeIndex;

  /**
   * WHO IS PARTNERED WITH WHOM, AND WHOSE BALL IS BEING SCORED.
   *
   * The printed card drew one row of boxes per player whatever the round was,
   * so a team round came out looking exactly like a medal. Two things were
   * wrong with that and only one of them is cosmetic:
   *
   *   - a four-ball card that does not name the sides cannot be used. The
   *     default side is TWO (`sideSize: 2`), so a group of four is normally
   *     two sides, and nothing on the paper said which two balls made one;
   *   - a SHARED-ball round got four rows for one ball. `sharesOneCard` says
   *     in its own words that "the side shares a single scorecard rather than
   *     one card each", and the card that prints ignored it — so a foursomes
   *     or a scramble printed three rows nobody may write in, beside handicaps
   *     that are not the ones the side plays off.
   *
   * Read from `teamsForStage`, which is the same reader the team boards use,
   * and the side's strokes are allocated with `allocatedStrokes(hcp, 100, …)`
   * because `TeamView.playingHandicap` already carries the round's allowance
   * — that is byte-for-byte what `singleBallTeamCard` does when it scores the
   * round, so the paper cannot disagree with the board.
   */
  /**
   * SINGLES MATCH PLAY IS THE SAME CARD PROBLEM, and it was the gap the sweep
   * found. `needsTeams` is false for Match Play, so a singles match printed a
   * MEDAL card: the index in brackets, dots off the full handicap, and no line
   * for the match — while `matchStrokesGiven` has always scored it off the
   * lower of the two. The paper disagreed with the engine.
   *
   * So the card's terms are not "is this a team round" but "what is this round
   * doing", and a singles match carries them with `teams: false`.
   */
  const roundIsMatch = !!stage && isHeadToHead(stage.type);
  const teamRound =
    stage && (needsTeams(stage.format) || roundIsMatch)
      ? {
          format: stage.format,
          allowance,
          teams: needsTeams(stage.format),
          sharedBall: needsTeams(stage.format) && sharesOneCard(stage.format),
          countBest: effectiveCountBest(stage.format, stage.countBest),
          matchPlay: roundIsMatch,
        }
      : null;
  const teams =
    teamRound?.teams && stage
      ? await teamsForStage(session.eventId, stage.id, stage.format, stage.handicapAllowance, holes)
      : [];
  const sideOf = new Map<string, string>();
  for (const t of teams) for (const m of t.members) sideOf.set(m.playerId, t.name);
  /**
   * A MATCH IS PLAYED OFF THE LOWEST HANDICAP IN IT, so the card has to know
   * which match a side is in before it can print a single dot.
   *
   * `matchHolesOffTheLow` scores it that way; a card still printing full
   * allowances would hand a player dots the round does not honour, which is
   * worse than printing none — they mark a net score on the strength of one.
   *
   * THE PAIRING, NOT THE TEE TIME. The low is taken from the two sides of the
   * MATCH, read off the `Match` rows, rather than from whoever shares a group.
   * Those are usually the same four people and occasionally are not, and a
   * card that guessed would be wrong in exactly the case nobody checks.
   */
  const matchPlay = !!stage && !!teamRound?.matchPlay;
  const matches = matchPlay
    ? await prisma.match.findMany({
        where: { stageId: stage!.id },
        select: { id: true, teamAId: true, teamBId: true, playerAId: true, playerBId: true },
      })
    : [];
  const playingOf = new Map<string, number>();
  for (const t of teams) {
    for (const m of t.members) {
      playingOf.set(m.playerId, playingHandicapFrom(courseHandicaps.get(m.playerId) ?? 0, allowance));
    }
  }
  /** The lowest figure in a side's match — its own scale, so a shared ball is
   *  measured against the other SIDE and a four-ball against every player. */
  const lowOf = new Map<string, number>();
  const teamById = new Map(teams.map((t) => [t.id, t]));
  for (const m of matches) {
    const a = teamById.get(m.teamAId);
    const b = teamById.get(m.teamBId);
    if (!a || !b) continue;
    const figures = teamRound!.sharedBall
      ? [a.playingHandicap, b.playingHandicap]
      : [...a.members, ...b.members].map((x) => playingOf.get(x.playerId) ?? 0);
    const low = Math.min(...figures.map((n) => Math.round(n)));
    lowOf.set(a.id, low);
    lowOf.set(b.id, low);
  }
  const lowForPlayer = new Map<string, number>();
  for (const t of teams) {
    const low = lowOf.get(t.id);
    if (low === undefined) continue;
    for (const m of t.members) lowForPlayer.set(m.playerId, low);
  }

  /**
   * SINGLES: the same rule with a field of two. The lower of the pair plays
   * off scratch and the other receives the difference, which is exactly what
   * `matchStrokesGiven` allocates when the result is worked out — so the card
   * reads the Match rows rather than guessing from who shares a tee time.
   *
   * `blockOf` also becomes the grouping: a four-ball of singles is TWO
   * matches, and printing four names in draw order hides which two are
   * playing each other.
   */
  const blockOf = new Map<string, string>();
  if (matchPlay && teamRound && !teamRound.teams) {
    for (const m of matches) {
      if (!m.playerAId || !m.playerBId) continue;
      const a = playingHandicapFrom(courseHandicaps.get(m.playerAId) ?? 0, allowance);
      const b = playingHandicapFrom(courseHandicaps.get(m.playerBId) ?? 0, allowance);
      const low = Math.min(Math.round(a), Math.round(b));
      lowForPlayer.set(m.playerAId, low);
      lowForPlayer.set(m.playerBId, low);
      blockOf.set(m.playerAId, m.id);
      blockOf.set(m.playerBId, m.id);
    }
  }

  const sides = teams.map((t) => {
    const low = lowOf.get(t.id);
    return {
      name: t.name,
      playingHandicap: t.playingHandicap,
      /** Strokes this side receives in its match, where there is one. */
      matchStrokes: low === undefined ? null : matchStrokesCount(t.playingHandicap, low),
      // One definition, shared with the engine and the entry screen.
      shots: matchStrokesPerHole(t.playingHandicap, low ?? 0, cardStrokeIndex),
    };
  });

  const printGroups = (savedSheet?.groups ?? []).map((g) => ({
    name: g.name,
    startHole: g.startHole,
    half: g.half,
    time: g.time,
    players: g.playerIds
      .map((id) => nameOf.get(id))
      .filter((pl): pl is NonNullable<typeof pl> => !!pl)
      .map((pl) => {
        const ch = courseHandicaps.get(pl.id) ?? 0;
        return {
          name: pl.name,
          handicap: pl.handicap,
          handicapType: pl.handicapType,
          handicapSource: pl.handicapSource,
          tee: teeNames.get(pl.id) ?? "",
          /** Which side they are on, so the card can group them. Empty on an
           *  individual round, and on a team round for anyone not yet drawn
           *  into a side — who then prints as themselves rather than being
           *  quietly filed under somebody else's partnership. */
          sideName: sideOf.get(pl.id) ?? blockOf.get(pl.id) ?? "",
          /**
           * The number that goes in the Hcp box — what they actually play off.
           * It stays the FULL figure on a match card too, because it is what
           * the skins and the side bets read; the match's own strokes go in
           * their own column beside it. Ajay's rule: the low-handicap
           * differential is "just for golf. Not for any skins or other
           * bet/money game."
           */
          playingHandicap: playingHandicapFrom(ch, allowance),
          /** Strokes received in this match, where the round is one. */
          matchStrokes: (() => {
            const low = lowForPlayer.get(pl.id);
            if (low === undefined) return null;
            return matchStrokesCount(playingHandicapFrom(ch, allowance), low);
          })(),
          /**
           * One entry per hole: how many shots, so two reads as two dots.
           *
           * `matchStrokesPerHole` is the one definition the engine and the
           * entry screen also use, so the paper, the phone and the result
           * cannot disagree — which is the thing Ajay asked for in as many
           * words: "both online and paper cards should match and consistent."
           * On a medal round there is no low, and this stays the allowance
           * allocation it always was.
           */
          shots: (() => {
            const low = lowForPlayer.get(pl.id);
            return low === undefined
              ? allocatedStrokes(ch, allowance, cardStrokeIndex)
              : matchStrokesPerHole(playingHandicapFrom(ch, allowance), low, cardStrokeIndex);
          })(),
        };
      }),
  }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h1 className="page-title">Tee sheet</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Decide who plays together, what order they go off, and from which tee. Once a round has been
          played you can re-pair off the leaderboard and send the leaders out last.
        </p>
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
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            {drift.departed.length > 0 && (
              <>
                {drift.departed.length} drawn {drift.departed.length === 1 ? "player has" : "players have"} left
                the field, leaving {drift.shortGroups.length === 1 ? "" : "these groups"} short
                {drift.shortGroups.length > 0 ? `: ${drift.shortGroups.join(", ")}` : ""}.{" "}
              </>
            )}
            {drift.undrawn.length > 0 && (
              <>
                {drift.undrawn.length} confirmed {drift.undrawn.length === 1 ? "player has" : "players have"} no
                tee time.{" "}
              </>
            )}
            Re-pair and publish again to put it right — the printed sheet leaves out anyone who has gone, so
            it is correct but shorter than you drew it.
          </p>
        </div>
      )}
      <FoursomeMaker
        players={field.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapType: p.handicapType, handicapSource: p.handicapSource, seed: p.seed }))}
        standings={standings}
        holes={holes}
        stageId={stage?.id ?? ""}
        savedAt={stage ? parseTeeSheet(stage.teeSheet)?.savedAt ?? "" : ""}
        published={stage?.teeSheetPublished ?? false}
        rounds={rounds.map((r) => ({
          id: r.id,
          label: roundLabelWith(rounds, r.id, r.playedOn ? shortDate(r.playedOn) : ""),
        }))}
        activeRoundId={stage?.id ?? ""}
        // Only when the field above has actually been narrowed to a week. In a
        // tournament `field` IS the roster, and passing it would turn "nobody
        // has entered" into "nobody is in for this round" on a screen with no
        // round to be in.
        rosterSize={weekRows.length > 0 ? state.confirmed.length : 0}
      />
      <TeeSheetPrint
        groups={printGroups}
        clubName={brand?.name ?? ""}
        clubLogoUrl={brand?.logoUrl ?? ""}
        courseName={course.name || state.event.course}
        /**
         * THE ROUND'S DAY, not the tournament's.
         *
         * This passed `state.event.dates`, so every card in an eleven-round
         * festival was stamped with the day round one went off — and the round
         * tabs three inches up this same page print the right date from
         * `playedOn`, which is the reading that makes it the "event answer to a
         * round question" shape rather than a missing field. A card is carried
         * on the day and filed afterwards; the wrong date on it is wrong in the
         * one place it will be read later.
         */
        dates={stage?.playedOn ? shortDate(stage.playedOn) : state.event.dates}
        roundLabel={roundLabel(rounds, stage?.id ?? "")}
        pars={course.pars}
        strokeIndex={course.strokeIndex}
        holes={holes}
        teamRound={teamRound}
        sides={sides}
      />
    </>
  );
}
