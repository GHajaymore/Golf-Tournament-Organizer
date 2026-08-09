/**
 * Account roles, and the arithmetic of changing one.
 *
 * The role control on the access screen used to commit the moment a radio
 * changed — one stray click and a member was silently re-roled, with the only
 * feedback being the row quietly redrawing. This module holds the pure part of
 * the safer version: the labels, and the judgement of what a proposed change
 * actually *is* — a demotion, or the removal of the last organizer — so the
 * confirmation the client shows and the guard the server enforces agree on the
 * same facts, and so both are testable without a browser.
 */

export const ROLE_OPTS = [
  { v: "admin", l: "Organizer" },
  { v: "assistant", l: "Assistant" },
  { v: "player", l: "Player" },
] as const;

export type AccountRoleValue = (typeof ROLE_OPTS)[number]["v"];

/** Human label for a stored role value, falling back to the raw value. */
export function roleLabel(role: string): string {
  return ROLE_OPTS.find((o) => o.v === role)?.l ?? role;
}

// Organizer > Assistant > Player. Higher rank = more access; a move to a lower
// rank is a demotion — the change that loses someone rights they had.
const ROLE_RANK: Record<string, number> = { admin: 2, assistant: 1, player: 0 };

const rank = (role: string) => ROLE_RANK[role] ?? 0;

/** True when moving from `from` to `to` reduces access. */
export function isDemotion(from: string, to: string): boolean {
  return rank(to) < rank(from);
}

export interface RoleChange {
  /** The account's display name. */
  name: string;
  /** Label of the current role. */
  from: string;
  /** Label of the proposed role. */
  to: string;
  /** True when the proposed role has less access than the current one. */
  demotion: boolean;
  /**
   * True when this would demote the only remaining organizer. The server
   * refuses this outright; the client warns before it is even attempted.
   */
  lastAdmin: boolean;
}

/**
 * Describe a proposed role change, or `null` when nothing would change.
 *
 * `adminCount` is the number of organizers on the event *including* this
 * account — the same count the server checks — so "the last admin" is decided
 * identically on both sides.
 */
export function describeRoleChange(
  account: { name: string; role: string },
  next: string,
  adminCount: number,
): RoleChange | null {
  if (account.role === next) return null;
  return {
    name: account.name,
    from: roleLabel(account.role),
    to: roleLabel(next),
    demotion: isDemotion(account.role, next),
    lastAdmin: account.role === "admin" && next !== "admin" && adminCount <= 1,
  };
}
