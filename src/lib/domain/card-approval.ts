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
