import Link from "next/link";
import { redirect } from "next/navigation";
import { needsTeams } from "@/lib/formats";
import { generatesPairings } from "@/lib/stage-types";
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
      initialStrokes={me.round.card?.strokes ?? []}
    />
  );
}
