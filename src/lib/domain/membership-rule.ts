/**
 * Who may change who is on a club's staff — ONE function, asked by every
 * membership action, by club deletion, and by the screen that greys a button
 * (so the screen can never offer what the server refuses).
 *
 * Security sweep 2026-11-12 (HIGH): a club Admin could make themselves
 * Commissioner (stored "owner"), demote or remove the real Commissioner, and
 * delete the club. Team ruling (Security Lead + Tournament Director):
 *
 *   - only a Commissioner may appoint, demote or remove a Commissioner;
 *   - an Admin may add, change and remove people only up to Admin level —
 *     never touch a Commissioner, never grant Commissioner;
 *   - a club always keeps at least one Commissioner (self included);
 *   - only a Commissioner may delete the club.
 *
 * "Ownerless" club (no Commissioner at all): the legacy hatch in
 * `org-access.ts` keeps it administrable, so an Admin may then appoint one.
 *
 * Every argument is REQUIRED so the compiler lists every caller the day the
 * rule grows. The Commissioner count is the one read INSIDE the transaction
 * that writes.
 */

export type MembershipVerdict = { ok: true } | { ok: false; reason: string };

const COMMISSIONER = "owner";

export function mayChangeMembership(input: {
  /** The caller's own role in this club ("owner" = Commissioner), or null. */
  actorRole: string | null;
  /** The target's role now, or null for somebody not yet on the staff. */
  targetCurrentRole: string | null;
  /** The role they would hold afterwards, or null when they are removed. */
  targetNewRole: string | null;
  /** How many Commissioners the club has NOW, the target included. */
  commissionerCount: number;
}): MembershipVerdict {
  const { actorRole, targetCurrentRole, targetNewRole, commissionerCount } = input;
  const actorIsCommissioner = actorRole === COMMISSIONER;
  const ownerless = commissionerCount === 0;

  if (!actorIsCommissioner && actorRole !== "admin") {
    return { ok: false, reason: "Only a Commissioner or Admin can manage staff." };
  }

  const touchesCommissioner = targetCurrentRole === COMMISSIONER || targetNewRole === COMMISSIONER;
  if (touchesCommissioner && !actorIsCommissioner && !ownerless) {
    return {
      ok: false,
      reason:
        targetCurrentRole === COMMISSIONER
          ? "Only a Commissioner can change or remove a Commissioner."
          : "Only a Commissioner can make someone a Commissioner.",
    };
  }

  if (targetCurrentRole === COMMISSIONER && targetNewRole !== COMMISSIONER && commissionerCount <= 1) {
    return {
      ok: false,
      reason:
        targetNewRole === null
          ? "This is the only Commissioner — make someone else a Commissioner before removing them."
          : "This is the only Commissioner — make someone else a Commissioner first.",
    };
  }
  return { ok: true };
}

/** Only a Commissioner may delete the club. */
export function mayDeleteClub(actorRole: string | null): boolean {
  return actorRole === COMMISSIONER;
}
