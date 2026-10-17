/**
 * THE CONTESTS ON THE PUBLIC BOARD, AND WHO SPONSORS THEM (2026-10-17).
 *
 * A closest-to-the-pin or long-drive winner was a fact that reached nobody but
 * the money ledger: not the board a club sends its members, not the printed
 * results. Clubs and charity days announce them, and a sponsor who put their
 * name on the 7th expects to see it beside the winner. Pure.
 */

import { CONTEST_LABEL, isContestKind } from "./contests";

/**
 * Which kinds a spectator is shown: the ones a club announces. Poker after
 * dinner and a side bet between four friends are their business, not the
 * club's board's.
 */
export const BOARD_CONTEST_KINDS = ["closest-pin", "long-drive"] as const;

export function shownOnBoard(kind: string): boolean {
  return (BOARD_CONTEST_KINDS as readonly string[]).includes(kind);
}

export const SPONSOR_NAME_MAX = 60;

/**
 * A sponsor's website as it may be stored: https and nothing else, or "" for
 * none. Null means "not a website" — refused, never silently dropped, so the
 * organizer is told rather than finding the link missing on the day.
 *
 * https only because the board is public and a link on it is the club
 * vouching for where it goes: no javascript:, no data:, no plain http.
 */
export function sponsorUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || withScheme.length > 200) return null;
  return url.toString();
}

/** "Closest to the pin · 7th", or the organizer's own name where they gave one. */
export function contestTitle(c: { kind: string; name: string; hole: number }): string {
  const label = isContestKind(c.kind) ? CONTEST_LABEL[c.kind] : CONTEST_LABEL.other;
  const named = c.name.trim() && c.name.trim() !== label ? c.name.trim() : label;
  return c.hole > 0 && !/\d/.test(named) ? `${named} · ${ordinal(c.hole)}` : named;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The sponsors to thank, once each, in the order their contests were made. */
export function sponsorsToThank(contests: Array<{ sponsorName: string; sponsorUrl: string }>): Array<{ name: string; url: string }> {
  const seen = new Map<string, { name: string; url: string }>();
  for (const c of contests) {
    const name = c.sponsorName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, url: c.sponsorUrl });
    // The name as first written; a website from whichever contest gave one.
    else if (!seen.get(key)!.url && c.sponsorUrl) seen.get(key)!.url = c.sponsorUrl;
  }
  return [...seen.values()];
}
