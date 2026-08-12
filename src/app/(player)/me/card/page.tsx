import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canEnterScores } from "@/lib/tournament-settings";
import { resolveCourse, hasCourseData } from "@/lib/courses";
import { meFor } from "@/lib/services/me";
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

  const course = resolveCourse(state.event);
  const known = hasCourseData(state.event);
  const holes = me.round.holes;

  return (
    <PlayerCard
      stageId={me.round.stageId}
      playerId={me.playerId}
      playerName={me.name}
      roundLabel={me.round.label}
      holes={holes}
      pars={known ? course.pars.slice(0, holes) : []}
      yards={known ? course.yards.slice(0, holes) : []}
      strokeIndex={known ? course.strokeIndex.slice(0, holes) : []}
      status={me.round.card?.status ?? "entered"}
    />
  );
}
