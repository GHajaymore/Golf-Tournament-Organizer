import Link from "next/link";
import { redirect } from "next/navigation";
import { needsTeams } from "@/lib/formats";
import { generatesPairings } from "@/lib/stage-types";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canEnterScores } from "@/lib/tournament-settings";
import { resolveCourse, hasCourseData } from "@/lib/courses";
import { courseForRound, applyNine, cleanNine } from "@/lib/services/course-resolution";
import { holeStrokesReceived, allocationHoles } from "@/lib/domain";
import { prisma } from "@/lib/db";
import { meFor } from "@/lib/services/me";
import { cardBrand } from "@/lib/services/organization";
import { PlayerCard } from "@/components/PlayerCard";

/**
 * My card — one player, one round, one hole at a time.
 *
 * The console's score entry can enter anyone's card and switch between tee
 * groups, because an organizer legitimately does both. A player entering
 * their own round needs neither, and every control that offers them is one
 * more thing to get wrong on a phone. So this is the same HoleByHoleCard with
 * the field of one.
 *
 * The tournament's own setting still decides whether players may report at
 * all — and the save action enforces it independently, because hiding a
 * screen stops nobody from calling the action.
 */
export default async function PlayCardPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const settings = settingsOf(state.event);
  const me = await meFor(state, session.email);
  // The club's mark for the head of the card. Same reader every other card in
  // the app uses, so no two of them can disagree about the club's name.
  const brand = await cardBrand(session.eventId);

  if (!me.playerId || !me.round) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You aren&rsquo;t entered in this tournament, so there&rsquo;s no card to fill in.
        </p>
      </div>
    );
  }

  if (!canEnterScores(settings, session.viewRole)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          Scores for this tournament are entered by the organizer. Your card will appear on the board once
          it is in.
        </p>
      </div>
    );
  }

  // This screen is a single player's stroke card and nothing else. A match is
  // scored between two people and a team round on a side's card, so neither
  // can be entered here — and silently rendering an 18-box grid for them would
  // collect strokes the tournament never reads.
  const stage = state.stages.find((s) => s.id === me.round!.stageId) ?? null;
  const teamRound = !!stage && needsTeams(stage.format);
  const matchRound = !!stage && generatesPairings(stage.type);

  if (teamRound || matchRound) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          {teamRound
            ? `${me.round.label} is played as ${stage?.format}, so the card belongs to your side rather than to you individually.`
            : `${me.round.label} is match play, so your score is recorded against your opponent rather than as your own card.`}{" "}
          Your organizer enters it, and it appears on the board as soon as it&rsquo;s in.
        </p>
        <Link className="btn btn-secondary" href="/me/board" style={{ marginTop: 14 }}>
          <i className="ph ph-ranking" /> See the board
        </Link>
      </div>
    );
  }

  const holes = me.round.holes;

  // The course this ROUND is played on, narrowed to the nine actually played
  // — not the event's, which is only the fallback. A player standing on a
  // second venue was being shown the first course's par, yardage and stroke
  // index, and a stroke index is what decides where their shots fall.
  const venue = stage?.courseId
    ? await prisma.course.findFirst({ where: { id: stage.courseId, events: { some: { eventId: state.event.id } } } })
    : null;
  const resolved = courseForRound(venue, state.event);
  const known = !!resolved || hasCourseData(state.event);
  const card = resolved
    ? applyNine(resolved, cleanNine(stage?.nine), holes)
    : { ...resolveCourse(state.event), pars: resolveCourse(state.event).pars, strokeIndex: resolveCourse(state.event).strokeIndex };

  /**
   * Handicap strokes per hole, resolved on the SERVER.
   *
   * Only the server can see the whole chain — the player's tee, its Course
   * Rating and Slope, the round's allowance and its hole count — and the card
   * has never shown any of it. A player working out their own net score from a
   * gross total and a roster Index is doing arithmetic the tournament will not
   * agree with: the audit found exactly that on the organizer's entry screen,
   * where the running net came off the raw Index while the dots beside it came
   * off the Course Handicap, five shots apart on one screen.
   */
  const playing = state.strokeHandicapFor(me.playerId, me.round.stageId);
  const alloc = allocationHoles(holes);
  const shots = Array.from({ length: holes }, (_, i) =>
    known ? holeStrokesReceived(playing, card.strokeIndex[i] ?? 18, alloc) : 0,
  );

  return (
    <PlayerCard
      stageId={me.round.stageId}
      playerId={me.playerId}
      playerName={me.name}
      roundLabel={me.round.label}
      courseName={known ? card.name : ""}
      // Whether that course is the club's own. At home the club's mark heads
      // the card; away, the course leads and the club is named beneath it — a
      // society's outing at Pebble Beach should not look like the society owns
      // the course.
      venueIsHome={!!brand?.homeCourseId && brand.homeCourseId === (venue?.id ?? "")}
      holes={holes}
      pars={known ? card.pars.slice(0, holes) : []}
      yards={known ? card.yards.slice(0, holes) : []}
      strokeIndex={known ? card.strokeIndex.slice(0, holes) : []}
      shotsPerHole={shots}
      playingHandicap={playing}
      status={me.round.card?.status ?? "entered"}
      // The club's badge at the head of the card, so the card a player holds
      // carries the mark that is on the paper one.
      brand={brand}
      initialStrokes={me.round.card?.strokes ?? []}
    />
  );
}
