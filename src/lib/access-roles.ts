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

import { roleName } from "./roles";

/**
 * The roles an account can hold, in order. The LABEL is not here: a role is
 * named through `roleName`, which spells "Organizer" / "Organiser" by the
 * club's golf words — see `roles.ts`.
 */
export const ROLE_OPTS = [{ v: "admin" }, { v: "assistant" }, { v: "player" }] as const;

export type AccountRoleValue = (typeof ROLE_OPTS)[number]["v"];

/** Human label for a stored role value, falling back to the raw value. */
export function roleLabel(role: string, organizer = "organizer"): string {
  return roleName(role, organizer);
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
  /** What this club calls the top role — "Organizer" or "Organiser". */
  adminName: string;
  /**
   * True when this would demote the only remaining organizer. The server
   * refuses this outright; the client warns before it is even attempted.
   */
  lastAdmin: boolean;
  /** Where the top role is the only one: "on the event" unless said otherwise. A club's says "". */
  place?: string;
  /** What a promotion hands over that the person did not have, when that is worth a sentence. */
  grants?: string;
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
  organizer = "organizer",
): RoleChange | null {
  if (account.role === next) return null;
  return {
    name: account.name,
    from: roleLabel(account.role, organizer),
    to: roleLabel(next, organizer),
    demotion: isDemotion(account.role, next),
    adminName: roleLabel("admin", organizer),
    lastAdmin: account.role === "admin" && next !== "admin" && adminCount <= 1,
  };
}

/* ── The same question, asked of a role at the CLUB ───────────────────────── */

// Commissioner > Admin > Member > Guest. A Commissioner and an Admin have the
// same rights on a tournament; the rank is what a person stands to lose.
const ORG_ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1, guest: 0 };
const orgRank = (role: string) => ORG_ROLE_RANK[role] ?? 0;

/**
 * Describe a proposed change of somebody's role at the club, or `null` when
 * nothing would change.
 *
 * THE CLUB'S SCREEN COMMITTED ON THE RADIO, which is the defect this module's
 * header describes — fixed on a tournament's access screen and left in place
 * on the club's, where one stray tap does more: Admin is organizer on EVERY
 * tournament the club runs, and Guest takes away the sight of all but one.
 * Found 2026-10-13 by reading the club screen to write its first browser test.
 *
 * `ownerCount` is the number of Commissioners including this person — the
 * count `setOrganizationMemberRole` guards on — so "the only Commissioner"
 * is decided the same way in the warning as in the refusal.
 */
export function describeOrgRoleChange(
  person: { name: string; role: string },
  next: string,
  ownerCount: number,
  label: (role: string) => string,
  /** "club", "society", "league" — what this outfit calls itself. */
  outfit: string,
): RoleChange | null {
  if (person.role === next) return null;
  const runsEverything = (role: string) => role === "owner" || role === "admin";
  return {
    name: person.name,
    from: label(person.role),
    to: label(next),
    demotion: orgRank(next) < orgRank(person.role),
    adminName: label("owner"),
    lastAdmin: person.role === "owner" && next !== "owner" && ownerCount <= 1,
    place: "",
    // Said only when it is NEWS: somebody who did not run the club's
    // tournaments and now would.
    grants: runsEverything(next) && !runsEverything(person.role) ? `${person.name} becomes an organizer on every tournament this ${outfit} runs.` : "",
  };
}
