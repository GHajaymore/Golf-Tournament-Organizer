/**
 * TWO RULES OF A TEAM CUP THAT THE SCORE PATHS HAVE TO SHARE (Ajay,
 * 2026-10-06). Pure, and named, so every write that can reach a cup match asks
 * the same question in the same words rather than each spelling it out.
 *
 * Literal rather than imported: `TEAM_SESSION` lives in a service that reads
 * the database, and this has to be importable from anywhere.
 */
const CUP_SESSION = "Team Session";

/**
 * A session whose lineup the organizer has not announced. The captains'
 * pairings are a draft until then — nobody but staff sees them, and nobody
 * but staff can score them. Per session, because a captain picks the
 * afternoon's pairs knowing the morning's score.
 */
export function lineupHidden(stage: { type: string; lineupPublished?: boolean | null }): boolean {
  return stage.type === CUP_SESSION && !stage.lineupPublished;
}

/** What a player is told when they try to score one. */
export const LINEUP_HIDDEN = "This session's lineup hasn't been announced yet — your match appears once the organizer publishes it.";

/**
 * Whether a score saved into this match keeps a concession already on it.
 *
 * Everywhere else, a real result supersedes a forfeit: an organizer who
 * recorded one against the wrong name and then entered the true card should
 * see the card. In a cup, the concession is the ORGANIZER's call (Ajay,
 * 2026-10-06: "let organizer control the score entry") while the players go on
 * saving their cards — so a player's save must not quietly undo it. The
 * organizer undoes a concession on the Team cup screen.
 */
export function keepsConcession(stageType: string): boolean {
  return stageType === CUP_SESSION;
}
