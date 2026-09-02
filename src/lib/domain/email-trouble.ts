/**
 * Making a refused email visible.
 *
 * Outbound email is deliberately fire-and-forget everywhere it is used: the
 * on-screen confirmation is the real receipt, and a bounced "you're registered"
 * must never undo a real entry. That is the right shape for one bad address.
 *
 * It is the wrong shape for a quota wall. The provider's free tier stops at 100
 * sends a day, and open registration for a 120-player member-member fills in an
 * afternoon — so entry 101 onward gets no confirmation, every entry is
 * perfectly fine, and nobody finds out until a player asks why they never heard
 * anything. The send still must not throw; what has to change is that the
 * failure stops being invisible.
 *
 * So failures are recorded and summarised here, and the Access screen shows
 * them beside the existing mail-configuration warning — the same reasoning that
 * put that warning there. The reset form cannot say anything (it would leak
 * which addresses are registered), so the organizer's own screen is where a
 * mail problem has to surface.
 */

/** Why a send failed, in the only three ways that lead to different advice. */
export type EmailFailureReason =
  /** The provider refused it: over the daily or monthly allowance. */
  | "quota"
  /** The provider took it and said no — bad address, blocked domain, spam. */
  | "rejected"
  /** No API key, so nothing was even attempted. */
  | "unconfigured";

/** What the email was for. Drives the wording, and who is affected. */
export type EmailKind = "registration" | "reset" | "invite";

/**
 * Classify a provider error.
 *
 * Matched on the message text as well as the status code because the provider
 * returns its allowance errors as prose ("You can only send 100 emails per
 * day") and the SDK does not always surface a status alongside it. Anything
 * unrecognised is "rejected" rather than "quota": telling an operator to
 * upgrade their plan when the real problem is a typo'd address sends them to
 * the wrong place, and a wrong diagnosis is worse than a vague one.
 */
export function classifySendFailure(message: string, statusCode?: number): EmailFailureReason {
  const text = (message ?? "").toLowerCase();
  if (statusCode === 429) return "quota";
  if (/rate.?limit|too many requests|quota|allowance|emails per day|daily limit|limit reached/.test(text)) {
    return "quota";
  }
  // Both spellings of the same sentence — the app's own wording is "isn't
  // configured", and the provider's is "API key".
  if (/not configured|isn['’]t configured|api key/.test(text)) return "unconfigured";
  return "rejected";
}

export interface EmailFailureRow {
  reason: EmailFailureReason;
  kind: EmailKind;
  /** Epoch ms. */
  createdAt: number;
}

export interface EmailTrouble {
  /** "danger" when people are being missed right now. */
  severity: "danger" | "warning";
  title: string;
  detail: string;
  count: number;
}

/** How far back the banner looks. Long enough to cover a registration day. */
export const TROUBLE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Turn recent failures into one line an organizer can act on, or nothing.
 *
 * One banner rather than a list. The actionable fact is "this many people did
 * not get an email, and here is why" — a scrolling log of individual failures
 * on a screen about access control is noise nobody reads twice.
 *
 * Quota wins over rejection when both are present, because it is the one that
 * is still happening: a bad address affects one person and is already over, an
 * exhausted allowance affects everyone for the rest of the day.
 */
export function summariseEmailTrouble(rows: EmailFailureRow[], now: number): EmailTrouble | null {
  const recent = rows.filter((r) => now - r.createdAt <= TROUBLE_WINDOW_MS);
  if (recent.length === 0) return null;

  const quota = recent.filter((r) => r.reason === "quota");
  if (quota.length > 0) {
        return {
      severity: "danger",
      count: quota.length,
      title: `${quota.length} ${quota.length === 1 ? "email was" : "emails were"} refused — the mail allowance is used up`,
      detail:
        `${describeWho(quota)} Entries and accounts are unaffected — only the email failed. ` +
        `The daily allowance resets overnight; raise the plan on the mail provider if this keeps happening on registration day.`,
    };
  }

  const failed = recent.filter((r) => r.reason === "rejected");
  if (failed.length > 0) {
        return {
      severity: "warning",
      count: failed.length,
      title: `${failed.length} ${failed.length === 1 ? "email was" : "emails were"} not delivered`,
      detail: `${describeWho(failed)} Usually a mistyped address — worth checking the address on the roster.`,
    };
  }

  return null;
}

/**
 * What each kind of failure means to the person who did not get the email.
 *
 * A `Record<EmailKind, ...>` rather than a chain of ifs, so that adding a kind
 * without saying what it means is a COMPILE ERROR rather than a silent
 * omission. The previous version took two positional counts, which meant a
 * third kind would have been counted in the headline — "3 emails were refused"
 * — and then left out of the sentence explaining who, so the number and the
 * description would quietly disagree. That is the class of bug this file exists
 * to prevent, and it was one `EmailKind` away from committing it.
 */
const KIND_WORDING: Record<EmailKind, (n: number) => string> = {
  registration: (n) =>
    n === 1
      ? "One player did not get their registration confirmation."
      : `${n} players did not get their registration confirmation.`,
  reset: (n) =>
    n === 1
      ? "One password reset link did not arrive, so that person cannot sign back in."
      : `${n} password reset links did not arrive, so those people cannot sign back in.`,
  invite: (n) =>
    n === 1
      ? "One staff invitation did not arrive, so that person does not know they have access yet."
      : `${n} staff invitations did not arrive, so those people do not know they have access yet.`,
};

/** Who was affected, derived from the rows rather than from counts passed in. */
function describeWho(rows: EmailFailureRow[]): string {
  const parts: string[] = [];
  for (const kind of Object.keys(KIND_WORDING) as EmailKind[]) {
    const n = rows.filter((r) => r.kind === kind).length;
    if (n > 0) parts.push(KIND_WORDING[kind](n));
  }
  return parts.join(" ");
}
