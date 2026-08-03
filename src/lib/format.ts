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
