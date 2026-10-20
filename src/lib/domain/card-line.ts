/**
 * ONE BALL'S GROSS AND NET, AS FAR AS IT HAS GOT (2026-10-19).
 *
 * Ajay, 2026-10-17: "do show both Gross and net scores … it may not relavent
 * for some formats but always good to publish". A cup match kept on stroke
 * cards (`matchKeptBy`) is decided hole by hole, and the board says who won;
 * under each name it now also says what each ball went round in.
 *
 * Net is the gross less the strokes this ball receives on the holes it has
 * played — its playing handicap allocated by stroke index (Rule 6.2), through
 * `holeStrokesReceived`, the one allocation every card uses. A hole with no
 * score (not reached, or picked up) counts toward neither figure, and `thru`
 * says how many holes are in, so a part-played card is never read as a round.
 *
 * Pure: the caller resolves the playing handicap and the card the round is
 * played on.
 */
import { holeStrokesReceived } from "@/lib/domain/stroke";

export interface CardLine {
  name: string;
  gross: number;
  net: number;
  /** Holes with a score on them. */
  thru: number;
}

export function cardLine(input: {
  name: string;
  strokes: ReadonlyArray<number | null>;
  /** The playing handicap this ball plays the round off. */
  playing: number;
  /** The round's stroke index, hole by hole, for the holes it is played over. */
  strokeIndex: ReadonlyArray<number>;
  holeCount: number;
}): CardLine | null {
  let gross = 0;
  let received = 0;
  let thru = 0;
  for (let h = 0; h < input.holeCount; h++) {
    const s = input.strokes[h];
    if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) continue;
    gross += s;
    received += holeStrokesReceived(input.playing, input.strokeIndex[h] ?? 18, input.holeCount);
    thru += 1;
  }
  if (thru === 0) return null;
  return { name: input.name, gross, net: gross - received, thru };
}

/** "38 · net 35", and "thru 9" while the card is still going. */
export function cardLineText(line: CardLine, holeCount: number): string {
  const figures = `${line.gross} · net ${line.net}`;
  return line.thru < holeCount ? `${figures} · thru ${line.thru}` : figures;
}
