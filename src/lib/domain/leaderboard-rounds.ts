import { boardKindForRound, isPlayingRound, roundIsStroke } from "@/lib/stage-types";
import { roundNameFor } from "./round-label";

/**
 * WHICH ROUNDS THE CONSOLE LEADERBOARD CAN BE ASKED FOR (Ajay, 2026-09-26).
 *
 * The board shows one round's board — `state.boardStage` — and had no way to
 * show another. So a tournament whose LAST round is scored by hand showed that
 * round alone: on the seeded Festival of Formats the dashboard, the leaderboard
 * and Reports all read "scored by hand" and rounds 1–10 could not be reached.
 *
 * Offered only where choosing CHANGES WHAT IS SHOWN. Stroke and match rounds
 * share one board — the tournament's standings, built across all of them — so
 * a plain two-round medal or a seven-week league has nothing to pick, and a
 * picker there would be a control that looks live and does nothing. A round
 * with a board of its own (a team round, skins, a Nassau, Modified Stableford,
 * a round scored by hand) is a separate board, and that is when there is a
 * choice.
 *
 * Returns [] when there is no choice, so a caller renders nothing.
 */
export function leaderboardRounds(
  stages: readonly { id: string; type: string; format: string }[],
): { stageId: string; label: string }[] {
  const playing = stages.filter((s) => isPlayingRound(s.type));
  if (playing.length < 2) return [];

  // What each round's board IS: the shared standings (split only by whether
  // it ranks strokes or match points), or a board of the round's own.
  const boards = new Set(
    playing.map((s) => {
      const kind = boardKindForRound(s.format, s.type);
      return kind === "standard" ? `standings:${roundIsStroke(s.type, s.format)}` : `own:${s.id}`;
    }),
  );
  if (boards.size < 2) return [];

  return playing.map((s) => ({ stageId: s.id, label: roundNameFor(stages, s) }));
}
