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
    };

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
): AttestOutcome {
  const ctx = { foursomes: [], matches: [sides] };

  /**
   * Whose card, for the purpose of "someone from the other side".
   *
   * The author when we know them, so `opponent` means a signature from the
   * side that did NOT write the result down — which is what the setting's help
   * text promises: "the people with a reason to check it". With no author
   * recorded there is no side to oppose, and `attestRequirement` falls back to
   * anyone else bound into the result, which is the marker system.
   */
  const owner = match.enteredById || sides.sideA[0] || sides.sideB[0] || approver;
  const req = attestRequirement(match.enteredById, owner, ctx, rule);

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
  return {
    ok: true,
    status: isAttested(attestedBy, req) ? "confirmed" : "pending",
    attestedBy,
    outstanding: stillNeeded(attestedBy, req),
  };
}
