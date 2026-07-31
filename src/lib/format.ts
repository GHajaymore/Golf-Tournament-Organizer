import type { PlayerStats } from "./domain";

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
