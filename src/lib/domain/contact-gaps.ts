import { looksLikePhone } from "./registration-intake";

/**
 * Which contact details the field is missing, in words.
 *
 * The email half of this has been on the Registration screen for a while and
 * earns its place: access is email-based, so a player without one cannot sign
 * in, and that is worth saying loudly. The phone half was missing, and its
 * absence was uneven in a way that read as the app not knowing its own mind —
 * a free club is now obliged to collect a mobile from every new entrant while
 * the screen said nothing about a field of thirty-two that had none.
 *
 * The important thing this has to convey is that the existing entries are not
 * a mistake. The requirement applies when somebody is entered, so anyone
 * already in the field predates it and nobody is removed retroactively. An
 * organizer who reads "a mobile is required" and then counts thirty-two blanks
 * will otherwise assume something is broken.
 */

export interface FieldContact {
  email?: string | null;
  phone?: string | null;
}

export interface ContactGaps {
  missingEmail: number;
  missingPhone: number;
  /** One sentence per gap worth reporting; empty when the field is complete. */
  lines: string[];
}

export function contactGaps(
  field: FieldContact[],
  phoneRequired: boolean,
  /**
   * Whether an email address is the ONLY way into this tournament.
   *
   * `entryNeedsEmail` — which is `!usesAccessCodes` — and the caller already
   * had it. Without it this line asserted "access is email-based" about every
   * tournament, and was simply WRONG on the ones that sign players in by Round
   * Code: those players can sign in perfectly well, which is the whole of what
   * #296 made possible.
   *
   * Measured on the seeded Demo Cup on 2026-09-15, which has
   * `playerAccess: "code"` and 31 entrants with no address. The screen told its
   * organizer that 31 players "can't sign in until one's added". They could.
   *
   * Defaults to true, so a caller written before this argument existed keeps
   * the wording it had — and the ONE caller supplies it.
   */
  emailIsTheWayIn = true,
): ContactGaps {
  const missingEmail = field.filter((p) => !(p.email ?? "").trim()).length;
  // Counted with the same reading the rule enforces, so the banner and the
  // refusal can never disagree about what counts as a number.
  const missingPhone = field.filter((p) => !looksLikePhone((p.phone ?? "").trim())).length;

  const lines: string[] = [];

  if (missingEmail > 0) {
    const who = `${plural(missingEmail, "player")} ${missingEmail === 1 ? "has" : "have"}`;
    lines.push(
      emailIsTheWayIn
        ? `${who} no email on file — access is email-based, so they can’t sign in until one’s added below.`
        : /**
           * CODES ARE ON, so an address is not how they get in and saying it is
           * would be false. What it still decides is whether they can be
           * MESSAGED: `messageableField` selects on `email: { not: "" }`, so a
           * player without one is absent from the Messages screen.
           *
           * NOT FROM ANNOUNCEMENTS, which this line used to claim ("announcements
           * and messages go by email, so those players won't receive any").
           * Checked 2026-09-26 walking the app as a new organizer: announcements
           * are loaded by tournament alone (`listAnnouncements`, eventId only)
           * and shown on every entrant's Today screen, email or not —
           * `messageableField` is read by the two Messages screens and nothing
           * else. Telling an organizer that eight players will miss the tee-time
           * notice is how they end up chasing addresses nobody needs.
           */
          `${who} no email on file. They sign in with the Round Code and see every announcement in ` +
          `the app — but Messages finds players by email, so they can’t be messaged until one’s added.`,
    );
  }

  // Only when the tournament actually asks for it. A blank phone on a
  // tournament that never wanted one is not a gap, and a banner about it would
  // be the app inventing a problem.
  if (phoneRequired && missingPhone > 0) {
    lines.push(
      `${plural(missingPhone, "player")} ${missingPhone === 1 ? "has" : "have"} no mobile on file. New entries ` +
        `need one, so these were entered before that applied — nothing has been removed, but you can’t reach them ` +
        `on the day until a number’s added below.`,
    );
  }

  return { missingEmail, missingPhone, lines };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
