/**
 * PLAY HAS BEGUN FOR THIS ROUND, said once (R12; it was written inline in the Rounds context and a looser copy grew on Score
 * entry). It has a result or is closed, or the tournament is live and the round's day has come (`today` is the CLUB's day,
 * told by the caller). Per round, not per tournament: once a tournament was live, "This round is finished" appeared on a
 * round three weeks away. An UNDATED round is under way only when it is the round in play: a knockout three weeks off showed
 * "Scoring window · Open" the day the tournament went live (2026-10-16).
 *
 * NO DIRECTIVE: the Rounds screens (client) and Score entry (server) both ask it.
 */
export function roundUnderWay(f: {
  /** Somebody has returned something for the round (`roundsWithResults`). */
  hasResult: boolean;
  closed: boolean;
  launched: boolean;
  /** The round's day, yyyy-mm-dd, or "" for no fixed day. */
  playedOn: string;
  /** Today at the club, yyyy-mm-dd, or "" when not known. */
  today: string;
  /** This is the round in play (`activeStage`). */
  isActiveRound: boolean;
}): boolean {
  const dayHasCome = !f.playedOn || !f.today || f.playedOn <= f.today;
  return f.hasResult || f.closed || (f.launched && (f.playedOn ? dayHasCome : f.isActiveRound));
}
