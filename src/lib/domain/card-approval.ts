/**
 * Which cards a committee can accept in one action, and which it must look at.
 *
 * The two-step shape comes from Rule 3.3b: the marker and the player certify
 * the hole scores, then the committee accepts the card. Match play has always
 * had this; stroke play did not, so a card went from a text box to the
 * leaderboard with nothing in between.
 *
 * The hazard in adding it is the rubber stamp. If one button approves
 * everything, the certification step becomes theatre and the app has bought
 * the ceremony without the safety. So a blanket approval here is not "approve
 * all" — it is "approve everything that is clean, and tell me what isn't".
 * Anything incomplete, disputed, or uncertified is excluded and named. The
 * point of the exception list is that it cannot be swept.
 *
 * Pure: no Prisma, no dates from the environment. The caller supplies the
 * rows and decides what to do with the verdict.
 */

export type CardStatus = "entered" | "certified" | "approved" | "disputed";

export interface CardForReview {
  id: string;
  playerId: string;
  playerName: string;
  status: string;
  /** Per-hole gross strokes; null is a hole with no score. */
  strokes: (number | null)[];
  /** The round's length, so a 9-hole round is not judged against 18. */
  holes: number;
}

export type ExceptionReason =
  | "incomplete"
  | "not-certified"
  | "disputed"
  | "already-approved";

export interface CardVerdict {
  id: string;
  playerId: string;
  playerName: string;
  reason: ExceptionReason;
  /** Filled holes, for "14 of 18" in the UI. */
  filled: number;
  holes: number;
}

export interface ApprovalReview {
  /** Safe to approve in one action. */
  ready: CardForReview[];
  /** Must be dealt with individually. Never approved by the blanket action. */
  exceptions: CardVerdict[];
}

export const EXCEPTION_LABEL: Record<ExceptionReason, string> = {
  incomplete: "Holes missing",
  "not-certified": "Not certified yet",
  disputed: "Disputed",
  "already-approved": "Already approved",
};

/**
 * The one state a stored card may not be written out of.
 *
 * Approval is the committee accepting the card as a result, and from that
 * point the row is theirs. `certifyScorecard` has refused to touch an approved
 * card since it was written — but the two paths that change what the card
 * *says* did not ask: `saveScorecard` writes strokes and never reads status,
 * and `disputeScorecard` flipped an accepted card to disputed at player level.
 * So an approved 82 could become a 76, or stop being a result at all, under a
 * row that still read `approvedBy: committee@club`.
 *
 * There is exactly one way out of approved and it is `reopenScorecard`:
 * organizer-only, and it deliberately keeps approvedBy/approvedAt so "who
 * signed this off" survives the card changing.
 *
 * Here rather than in each action so all three ask the same question and the
 * player is told the same thing, whichever door they came through.
 */
export function isCardLocked(status: string): boolean {
  return status === "approved";
}

export const LOCKED_CARD_REFUSAL =
  "That card has been approved. An organizer has to reopen it before it can be changed.";

/**
 * Whether returning a new set of strokes invalidates the sign-off already on
 * the card.
 *
 * A certification is a statement about the numbers that were on the card when
 * it was given — change them and it vouches for something nobody read. Match
 * play has always worked this way: every score edit resets `scoreStatus` to
 * pending "so a correction always goes back through approval".
 *
 * A DISPUTED card is deliberately not reset. Disputed means someone says this
 * card is wrong and it must never silently become approved; letting an edit
 * clear that would hand the flag's own subject the way to remove it.
 */
export function statusAfterEdit(status: string): CardStatus | null {
  return status === "certified" ? "entered" : null;
}

export function filledHoles(strokes: (number | null)[], holes: number): number {
  let n = 0;
  for (let i = 0; i < holes; i += 1) if (strokes[i] != null) n += 1;
  return n;
}

/**
 * Split a round's cards into the ones a blanket approval may take and the ones
 * it may not.
 *
 * Order matters: a disputed card is reported as disputed even if it is also
 * short a hole, because that is the thing the committee has to resolve.
 */
export function reviewCards(cards: CardForReview[]): ApprovalReview {
  const ready: CardForReview[] = [];
  const exceptions: CardVerdict[] = [];

  for (const c of cards) {
    const filled = filledHoles(c.strokes, c.holes);
    const flag = (reason: ExceptionReason) =>
      exceptions.push({
        id: c.id,
        playerId: c.playerId,
        playerName: c.playerName,
        reason,
        filled,
        holes: c.holes,
      });

    if (c.status === "disputed") {
      flag("disputed");
      continue;
    }
    if (c.status === "approved") {
      flag("already-approved");
      continue;
    }
    if (filled < c.holes) {
      // A short card is not a small problem. A missing hole silently becomes a
      // better score than the player made, and the leaderboard cannot tell.
      flag("incomplete");
      continue;
    }
    if (c.status !== "certified") {
      flag("not-certified");
      continue;
    }
    ready.push(c);
  }

  return { ready, exceptions };
}

/**
 * One line stating what a blanket approval is about to do.
 *
 * Written so approving is a decision rather than a reflex: the count that is
 * about to change, and the count that will be left behind, in the same breath.
 */
export function approvalSummary(review: ApprovalReview): string {
  const r = review.ready.length;
  const e = review.exceptions.length;
  if (r === 0 && e === 0) return "No cards returned yet.";
  if (r === 0) return `Nothing ready to approve — ${e} ${e === 1 ? "card needs" : "cards need"} attention.`;
  const head = `Approve ${r} ${r === 1 ? "card" : "cards"}`;
  return e === 0 ? `${head}.` : `${head}, leaving ${e} that ${e === 1 ? "needs" : "need"} attention.`;
}
