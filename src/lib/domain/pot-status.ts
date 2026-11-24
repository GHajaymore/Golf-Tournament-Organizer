/**
 * WHAT IS STILL OUTSTANDING ON THE FIELD'S POTS AND CONTESTS, in words (R8b). Winners & money does not draw a pot's or a contest's
 * own card (it is one card, mounted once, on Prizes & side games), so it says how far the card has got: a COUNT OF STORED ROWS
 * (contests that have a winner, stakes the organizer has the cash for), never an amount and never a computed figure. A count of
 * rows can be read mid-round without breaking final-only: it is a fact about what has been recorded, not about money.
 */
export interface PotStatus {
  contests: number;
  contestsWithWinner: number;
  /** Every stake put down, in a contest, a side game or a skins pot of the whole field. */
  stakes: number;
  /** Of those, the ones the organizer has the cash for. */
  stakesPaid: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function potStatusLine(s: PotStatus): string {
  if (s.contests === 0 && s.stakes === 0) return "No contests or stakes have been set up yet.";
  const parts: string[] = [];
  if (s.contests > 0) parts.push(`${s.contestsWithWinner} of ${s.contests} ${plural(s.contests, "contest has", "contests have")} a winner`);
  if (s.stakes > 0) parts.push(`${s.stakesPaid} of ${s.stakes} ${plural(s.stakes, "stake", "stakes")} paid`);
  return `${parts.join(". ")}.`;
}
