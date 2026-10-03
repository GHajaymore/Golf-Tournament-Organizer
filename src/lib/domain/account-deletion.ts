/**
 * MAY THIS PERSON DELETE THEIR OWN ACCOUNT? (2026-10-03)
 *
 * Deleting an account removes the person's LOGIN and ACCESS — the account
 * itself, the staff memberships and per-tournament access it carried, the
 * phones registered for notifications, the read markers on conversations.
 *
 * It does NOT remove what clubs hold about them: a roster entry, a place in a
 * tournament's field, a card, a message they wrote in a club conversation. The
 * privacy policy says why — the club decides what it keeps about its members
 * and is the one to ask — and the account page says so in the same words, so
 * nobody believes a club's records went with their login.
 *
 * One refusal, because one outcome is worse than any other: the LAST OWNER of
 * a club leaving it with nobody who can run it, pay for it or delete it. They
 * hand it to somebody in Staff & access, or delete it, first.
 *
 * Confirmed by typing their own email address — the one thing they certainly
 * know, and different on every account, so a habit learnt on one does not
 * carry to another.
 */

export interface AccountDeletionInput {
  /** The account's email, as stored. */
  email: string;
  /** What they typed to confirm. Compared case-insensitively, trimmed. */
  typedEmail: string;
  /** Names of clubs where this person is the ONLY owner. */
  soleOwnerOf: string[];
}

export function accountDeletionRefusal(input: AccountDeletionInput): string | null {
  if (input.soleOwnerOf.length > 0) {
    const names = input.soleOwnerOf.join(", ");
    const one = input.soleOwnerOf.length === 1;
    return (
      `You're the only owner of ${names}. Give ${one ? "it" : "each of them"} another owner in Staff & access, ` +
      `or delete ${one ? "it" : "them"} from its settings, first — otherwise nobody could run ${one ? "it" : "them"}.`
    );
  }
  const typed = input.typedEmail.trim().toLowerCase();
  if (!typed || typed !== input.email.trim().toLowerCase()) {
    return "Type your account's email address exactly to confirm.";
  }
  return null;
}
