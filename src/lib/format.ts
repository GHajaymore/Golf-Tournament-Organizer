import type { PlayerStats } from "./domain";

/** Lifecycle status display metadata, shared by LifecycleBar (client) and
 * EventContextBar (server) — kept in a plain module so both can import it
 * without crossing a "use client" boundary for a non-component value. */
export const STATUS_META: Record<string, { label: string; tag: string }> = {
  draft: { label: "Draft", tag: "tag-neutral" },
  registration: { label: "Registration open", tag: "tag-accent" },
  ready: { label: "Ready to launch", tag: "tag-accent" },
  live: { label: "Live", tag: "tag-accent-2" },
  completed: { label: "Completed", tag: "tag-neutral" },
};

/** Points as a compact string (no trailing .0). */
export function pts(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * A count and its noun, agreeing.
 *
 * There are forty-odd hand-written `n === 1 ? "" : "s"` conditionals in this
 * codebase, which is fine — until one is forgotten, and then a screen says
 * "1 flights · 1 players" to somebody setting up their first tournament. It
 * reads as a bug in the thing being counted rather than in the sentence, which
 * is why it survives: nobody files "the s is wrong" but everybody notices it.
 *
 * Irregular plurals are given rather than guessed. English has no rule this
 * function could implement, so a caller with a "match" or a "party" passes the
 * plural in; anything else takes an "s".
 *
 *   plural(1, "flight")            → "1 flight"
 *   plural(3, "flight")            → "3 flights"
 *   plural(2, "match", "matches")  → "2 matches"
 */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

export function record(s: PlayerStats): string {
  return `${s.wins}-${s.ties}-${s.losses}`;
}

export function diff(s: PlayerStats): string {
  const d = s.holesWon - s.holesLost;
  return d > 0 ? `+${d}` : `${d}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Shorten a full name to "First L." for dense tables. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * Labels for names shown BESIDE each other, guaranteed to differ.
 *
 * `firstName` is the right label almost always, and useless in the one case
 * that matters most: two players in the same match called Dave. The match
 * screen's legend read "Dave 0 · Dave 0" with two colours the scorer had no
 * way to attach to a person, and the result line said "Dave 3 up" about a
 * match between two Daves.
 *
 * Widen only as far as it takes, and only for the names that actually clash —
 * a Dave playing a Sam still reads "Dave" and "Sam". "Dave S." is enough for
 * two; two people with the SAME full name get the full name twice, because at
 * that point nothing short is honest and the caller should be showing
 * something else entirely.
 *
 * Decided here rather than at each call site: this is the shape CLAUDE.md
 * asks for, since a rule applied where the labels are built cannot be
 * forgotten by the next screen that renders a pair of names.
 */
export function distinctLabels(
  names: string[],
  /**
   * How a name is written when nothing forces it wider. THE CALLER'S NORMAL
   * FORMAT, and it must be passed as such: a screen that shows "First L."
   * wants "Dave S." for everybody and something longer only where two of them
   * collide.
   *
   * Defaulting this to `firstName` and using it on a `shortName` screen
   * shortens every name on that screen — which is a change to all the rows to
   * fix a collision in two of them. `render.test.tsx` caught exactly that: a
   * qualification table that had always read "A. J." started reading "A.".
   */
  base: (name: string) => string = firstName,
): string[] {
  const counts = (labels: string[]) => {
    const seen = new Map<string, number>();
    for (const l of labels) seen.set(l.toLowerCase(), (seen.get(l.toLowerCase()) ?? 0) + 1);
    return seen;
  };

  // Widest last. Each step is tried only by the names still colliding at the
  // step before, so one clash never reformats the rest of the list.
  const ladder = [base, shortName, (n: string) => n.trim()];

  let labels = names.map((n) => base(n));
  for (const step of ladder.slice(1)) {
    const seen = counts(labels);
    if (![...seen.values()].some((c) => c > 1)) break;
    labels = names.map((n, i) => ((seen.get(labels[i].toLowerCase()) ?? 0) > 1 ? step(n) : labels[i]));
  }
  return labels;
}

/**
 * A readable list of names for a one-line notice.
 *
 * Capped, because the case that produces one of these is a bulk action: an
 * organizer adding forty members off the club roster can easily have a dozen
 * without an address, and a notice that names all twelve is a paragraph nobody
 * reads. Naming the first few is what makes it actionable — it tells them the
 * kind of member affected and where to start.
 */
export function listNames(names: string[], max = 3): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length <= max) return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
  const rest = clean.length - max;
  return `${clean.slice(0, max).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}
