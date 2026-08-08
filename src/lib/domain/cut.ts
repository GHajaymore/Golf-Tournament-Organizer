/**
 * Who survives a cut.
 *
 * The cut line and the qualification screen were two mechanisms for one
 * question, each with half an answer. The cut line could say "top 16" or "top
 * 50%" but only ever across the whole field; qualification could say "per
 * flight" or "overall" but lived at tournament level and had no percentage.
 * An organizer could set both, to different things, and nothing reconciled
 * them.
 *
 * This is the union: how many, and out of what.
 */

export type CutScope = "overall" | "perFlight";
export type CutMode = "count" | "percent";

export interface CutRule {
  scope: CutScope;
  mode: CutMode;
  /** Used when mode is "count" — per flight when the scope is per flight. */
  count: number;
  /** Used when mode is "percent". */
  percent: number;
}

export interface CutCandidate {
  id: string;
  /** Which flight they played in; null groups everyone together. */
  groupId?: string | null;
}

export function isCutScope(v: string): v is CutScope {
  return v === "overall" || v === "perFlight";
}

/** How many survive out of a field of this size, never fewer than one. */
export function survivorCount(rule: CutRule, fieldSize: number): number {
  if (fieldSize <= 0) return 0;
  const n =
    rule.mode === "percent"
      ? Math.ceil((fieldSize * rule.percent) / 100)
      : rule.count;
  return Math.max(1, Math.min(n, fieldSize));
}

/**
 * The players who go through, from standings already in finishing order.
 *
 * Order matters and is the caller's responsibility — this takes the front of
 * the list, it does not rank. Passing unsorted standings would silently cut
 * the wrong people, which is why the parameter is named for what it must be.
 *
 * A per-flight cut applies the rule *within each flight*, so "top 2" means two
 * from every flight rather than two from the tournament. That is what a club
 * means by it, and it is the difference between a bracket of eight and a
 * bracket of two.
 */
export function survivors(rankedInOrder: CutCandidate[], rule: CutRule): Set<string> {
  if (rule.scope === "overall") {
    const n = survivorCount(rule, rankedInOrder.length);
    return new Set(rankedInOrder.slice(0, n).map((p) => p.id));
  }

  // Group while preserving the ranking order inside each flight.
  const byFlight = new Map<string, CutCandidate[]>();
  for (const p of rankedInOrder) {
    const key = p.groupId ?? "";
    const list = byFlight.get(key);
    if (list) list.push(p);
    else byFlight.set(key, [p]);
  }

  const out = new Set<string>();
  for (const list of byFlight.values()) {
    // Sized against that flight, not the whole field: "top 50%" of a flight of
    // eight is four, whatever the other flights look like.
    const n = survivorCount(rule, list.length);
    for (const p of list.slice(0, n)) out.add(p.id);
  }
  return out;
}

/** One line describing what the rule will do, for the setup screen. */
export function describeCut(rule: CutRule, fieldSize: number, flightCount: number): string {
  const perFlight = rule.scope === "perFlight" && flightCount > 0;

  if (rule.mode === "percent") {
    return perFlight
      ? `Top ${rule.percent}% of each flight advances.`
      : `Top ${rule.percent}% of the field advances — ${survivorCount(rule, fieldSize)} of ${fieldSize}.`;
  }

  if (perFlight) {
    const total = rule.count * flightCount;
    return `Top ${rule.count} from each of the ${flightCount} flights advances — ${total} in total.`;
  }
  return `Top ${survivorCount(rule, fieldSize)} of ${fieldSize} advances.`;
}
