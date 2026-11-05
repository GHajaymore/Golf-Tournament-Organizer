import { prisma } from "@/lib/db";
import {
  attestRequirement,
  isAttested,
  isAttestRule,
  stillNeeded,
  type AttestRule,
  type MatchSides,
} from "@/lib/domain/attest";

/**
 * Applying the club's attestation rule to a match result.
 *
 * `domain/attest.ts` has decided this since it was written — who may sign a
 * card, how many of them, and the one rule the whole mechanism exists for: the
 * person who wrote a card is never one of the people who may sign it off. It
 * was imported by nothing. `confirmMatch` marked a result confirmed on the
 * FIRST signature, whichever of the three options the club had chosen, so an
 * organizer who picked "everyone in the match" — the one described as "worth it
 * when the result will be argued about" — got the fastest behaviour available.
 *
 * This is the join between the two. It is a service rather than inline in the
 * action because the action is not the only door: `confirmMatches` approves in
 * bulk and `savePlayMatchHoles` writes from the round-code surface, and a rule
 * spelled out at one of three call sites is the shape this repo keeps finding
 * broken. Staff approval deliberately does not come through here — an organizer
 * approving a card is not attestation, it is the committee, and it is allowed
 * to stand alone.
 */

/** The stored approvals, defensively parsed. */
export function parseAttested(raw: string): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
  } catch {
    // A malformed column is "nobody has signed", never "everybody has". The
    // failure direction matters: the other way round would confirm a result
    // off a parse error.
    return [];
  }
}

/** The club's rule, falling back to the default rather than throwing. */
export function ruleFrom(attestBy: string): AttestRule {
  return isAttestRule(attestBy) ? attestBy : "marker";
}

interface MatchRow {
  id: string;
  playerAId: string;
  playerBId: string;
  teamAId: string;
  teamBId: string;
  enteredById: string;
  attestedBy: string;
}

/**
 * The two sides as PLAYER ids.
 *
 * A team match names teams and leaves the player columns empty — `teams.ts`
 * says so where it writes them — so the members have to be resolved or every
 * four-ball would have two empty sides and no candidate could ever sign. That
 * is the same shape as the bug the comment in `confirmMatch` already records
 * about reading only the player columns.
 */
export async function matchSidesOf(match: MatchRow): Promise<MatchSides> {
  if (match.teamAId || match.teamBId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: { in: [match.teamAId, match.teamBId].filter(Boolean) } },
      select: { teamId: true, playerId: true },
    });
    return {
      id: match.id,
      sideA: members.filter((m) => m.teamId === match.teamAId).map((m) => m.playerId),
      sideB: members.filter((m) => m.teamId === match.teamBId).map((m) => m.playerId),
    };
  }
  return {
    id: match.id,
    sideA: [match.playerAId].filter(Boolean),
    sideB: [match.playerBId].filter(Boolean),
  };
}

export type AttestOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      /** What the row's scoreStatus should become. */
      status: "confirmed" | "pending";
      /** The full approval list to store. */
      attestedBy: string[];
      /** Who has still to sign, for the message the screen shows. */
      outstanding: string[];
      /**
       * Whether the signatures collected satisfy the rule — the sides AGREE.
       * In "confirm" mode this is the same as `status === "confirmed"`; in
       * "record" mode the status stays pending and this is what the
       * committee's queue reads ("both sides agree").
       */
      agreed: boolean;
    };

/**
 * What a signature DOES in this tournament (2026-11-04).
 *
 *   confirm  players approve results (`scoreApproval: "players"`): enough
 *            signatures make the result confirmed.
 *   record   the committee approves (`scoreApproval: "staff"`): the end-of-round
 *            check still asks the other side, and their agreement is RECORDED —
 *            the result stays pending for the committee, which now sees that
 *            both sides agree. A player's signature never approves a result the
 *            committee was given to approve.
 *
 * Required, so every caller says which it means.
 */
export type AttestMode = "confirm" | "record";

/**
 * One player signing one match off.
 *
 * Returns the new state rather than writing it, so the action stays the only
 * thing that touches the row and this stays testable without a database.
 */
export function attestMatch(
  sides: MatchSides,
  match: Pick<MatchRow, "enteredById" | "attestedBy">,
  approver: string,
  rule: AttestRule,
  mode: AttestMode,
): AttestOutcome {
  const req = requirementOf(sides, match.enteredById, rule);

  if (req.needed === 0) {
    /**
     * Nobody else is bound into this result, so there is no one to attest it.
     * `attest.ts` is explicit that this must read as "needs staff approval"
     * rather than "approved" — a player cannot sign their own round into the
     * record however the tournament is configured.
     */
    return {
      ok: false,
      error: "There is nobody else in this match to confirm it. An organizer has to approve it.",
    };
  }

  if (approver === match.enteredById) {
    return {
      ok: false,
      error: "You entered this score, so somebody else in the match has to confirm it.",
    };
  }

  if (!req.candidates.includes(approver)) {
    return {
      ok: false,
      error: "This tournament needs someone from the other side to confirm this result.",
    };
  }

  const attestedBy = [...new Set([...parseAttested(match.attestedBy), approver])];
  const agreed = isAttested(attestedBy, req);
  return {
    ok: true,
    status: agreed && mode === "confirm" ? "confirmed" : "pending",
    attestedBy,
    outstanding: stillNeeded(attestedBy, req),
    agreed,
  };
}

/** Who may sign this match off, and how many — the owner always a player in it. */
function requirementOf(sides: MatchSides, enteredById: string, rule: AttestRule) {
  const ctx = { foursomes: [], matches: [sides] };

  /**
   * Whose card, for the purpose of "someone from the other side": ALWAYS A
   * PLAYER IN THE MATCH (2026-11-04).
   *
   * The author when they are on a side, so `opponent` means a signature from
   * the side that did NOT write the result down — which is what the setting's
   * help text promises: "the people with a reason to check it".
   *
   * This used to take the author whoever they were. Since one scorer may keep
   * a whole group's card (`Stage.scoreKeeping: "group"`), the author can be
   * somebody in the group who is not in this match at all — and then the
   * owner was a player on neither side, whose "scoring group" was themselves
   * alone, and the check said "nobody else in this match to confirm it" about
   * a match with four people in it. The scorer stays the AUTHOR (never a
   * candidate); the card belongs to the match.
   *
   * With no author on either side — a scorer outside the match, or nobody
   * recorded — there is no side to oppose: nobody in the match wrote it down,
   * so under `opponent` anybody in the match may confirm it (the marker rule),
   * and `all` still asks every one of them.
   */
  const inMatch = (id: string) => id !== "" && (sides.sideA.includes(id) || sides.sideB.includes(id));
  const authorPlays = inMatch(enteredById);
  const owner = authorPlays ? enteredById : sides.sideA[0] || sides.sideB[0] || "";
  // A match with nobody on either side has nobody to sign it: the committee's.
  if (!owner) return { candidates: [], needed: 0 };
  const effectiveRule: AttestRule = rule === "opponent" && !authorPlays ? "marker" : rule;
  return attestRequirement(enteredById, owner, ctx, effectiveRule);
}

/**
 * Whether a stored match's signatures already satisfy the rule — "both sides
 * agree", for the committee's queue under staff approval. The same decision
 * `attestMatch` takes, asked of what is stored rather than of a new signature.
 */
export function sidesAgree(sides: MatchSides, match: Pick<MatchRow, "enteredById" | "attestedBy">, rule: AttestRule): boolean {
  return isAttested(parseAttested(match.attestedBy), requirementOf(sides, match.enteredById, rule));
}
