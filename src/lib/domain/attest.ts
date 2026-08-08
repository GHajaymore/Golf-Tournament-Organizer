/**
 * Who may write down a score, and who has to agree it.
 *
 * Two groupings that look the same on a tee sheet and are not:
 *
 *   - The **playing group** is who walked off the tee together. A foursome.
 *   - The **scoring group** is who a single result belongs to.
 *
 * In stroke play they coincide: four players out together, each marking
 * another's card. In match play they do not. Two separate matches routinely go
 * out in one foursome, and the players in the second match have no standing
 * over the first one's result — they were not in it. Letting the foursome
 * approve a match they were not playing is how a result nobody agrees with
 * gets signed off, and it is the failure this module exists to prevent.
 *
 * The entry limit is not configurable. A player may write down scores for
 * their own scoring group and nobody else — not the foursome, and certainly
 * not the field. What *is* configurable is how much agreement a card needs
 * before it counts, because that genuinely varies: a club Sunday medal wants
 * one marker's signature, a county final wants every player in the match.
 */

export type AttestRule = "marker" | "opponent" | "all";

export interface AttestRuleInfo {
  key: AttestRule;
  label: string;
  blurb: string;
}

export const ATTEST_RULES: AttestRuleInfo[] = [
  {
    key: "marker",
    label: "One playing partner",
    blurb:
      "Somebody else in the group confirms the card — the marker system every club medal already runs on. Fastest, and enough for most tournaments.",
  },
  {
    key: "opponent",
    label: "The other side",
    blurb:
      "Someone from the opposing side has to agree the result. The people with a reason to check it. In stroke play this behaves as one playing partner.",
  },
  {
    key: "all",
    label: "Everyone in the match",
    blurb:
      "Every other player bound into the result must confirm. Slowest, and worth it when the result decides something that will be argued about.",
  },
];

export function isAttestRule(v: string): v is AttestRule {
  return v === "marker" || v === "opponent" || v === "all";
}

/** One match: the players on each side of a single result. */
export interface MatchSides {
  id: string;
  sideA: string[];
  sideB: string[];
}

export interface PlayingContext {
  /** Tee-sheet groups — everyone who went off together. */
  foursomes: string[][];
  /** Matches in play. A single foursome may hold more than one. */
  matches: MatchSides[];
}

/** The match a player is in, if any. */
export function matchFor(playerId: string, ctx: PlayingContext): MatchSides | null {
  return (
    ctx.matches.find((m) => m.sideA.includes(playerId) || m.sideB.includes(playerId)) ?? null
  );
}

/**
 * The players a single result belongs to.
 *
 * A match wins over the foursome, always. This is the rule that keeps the
 * second pair in a foursome out of the first pair's match — they share a tee
 * time and nothing else.
 *
 * With no match, the result is a stroke-play card and the group is the
 * foursome, which is exactly the marker system. A player in neither is alone:
 * they can still enter their own card, and it will need staff approval because
 * there is nobody else to ask.
 */
export function scoringGroup(playerId: string, ctx: PlayingContext): string[] {
  const m = matchFor(playerId, ctx);
  if (m) return [...m.sideA, ...m.sideB];

  const four = ctx.foursomes.find((f) => f.includes(playerId));
  if (four) return [...four];

  return [playerId];
}

/**
 * Whether one player may write down another's score — by typing or by voice.
 *
 * Voice is the reason this is enforced in the engine rather than by hiding
 * fields. Dictating "Sam, five" is a free-text path straight into a score, and
 * a name that resolves against the whole field lets anyone overwrite anyone.
 * The dictation parser resolves names against this list and nothing wider.
 */
export function canEnterScoreFor(
  actorId: string,
  targetId: string,
  ctx: PlayingContext,
): boolean {
  if (actorId === targetId) return true;
  return scoringGroup(actorId, ctx).includes(targetId);
}

/** Everyone a player is allowed to enter for, themselves included. */
export function enterableBy(actorId: string, ctx: PlayingContext): string[] {
  const group = scoringGroup(actorId, ctx);
  return group.includes(actorId) ? group : [actorId, ...group];
}

export interface AttestRequirement {
  /** Players who may sign this off. */
  candidates: string[];
  /** How many of them are needed. */
  needed: number;
}

/**
 * Who has to agree a card, and how many of them.
 *
 * The person who entered it is never a candidate. A card signed only by the
 * person who wrote it is not attested, it is asserted — and that is the one
 * property this whole mechanism exists to guarantee.
 *
 * When nobody else is available the requirement comes back empty and needing
 * nothing, which the caller must read as "this needs staff approval" rather
 * than "this is approved". A single player cannot attest their own round into
 * the record however the tournament is configured.
 */
export function attestRequirement(
  enteredBy: string,
  cardOwner: string,
  ctx: PlayingContext,
  rule: AttestRule,
): AttestRequirement {
  const group = scoringGroup(cardOwner, ctx);
  const others = group.filter((p) => p !== enteredBy);

  if (others.length === 0) return { candidates: [], needed: 0 };

  if (rule === "all") return { candidates: others, needed: others.length };

  if (rule === "opponent") {
    const m = matchFor(cardOwner, ctx);
    if (m) {
      // The side the card's owner is not on. Those are the people with a
      // reason to check it.
      const ownSide = m.sideA.includes(cardOwner) ? m.sideA : m.sideB;
      const opposing = (ownSide === m.sideA ? m.sideB : m.sideA).filter((p) => p !== enteredBy);
      // An opponent who entered the card cannot also be the one confirming it,
      // so fall back to anyone else bound into the result.
      if (opposing.length > 0) return { candidates: opposing, needed: 1 };
    }
    // Stroke play has no opposing side; one playing partner is the equivalent.
    return { candidates: others, needed: 1 };
  }

  return { candidates: others, needed: 1 };
}

/** Whether the approvals collected satisfy the requirement. */
export function isAttested(approvals: string[], req: AttestRequirement): boolean {
  if (req.needed === 0) return false;
  const valid = new Set(approvals.filter((a) => req.candidates.includes(a)));
  return valid.size >= req.needed;
}

/** Who still has to sign, for a screen that has to say so. */
export function stillNeeded(approvals: string[], req: AttestRequirement): string[] {
  const given = new Set(approvals);
  return req.candidates.filter((c) => !given.has(c));
}
