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
