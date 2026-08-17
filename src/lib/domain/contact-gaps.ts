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

export function contactGaps(field: FieldContact[], phoneRequired: boolean): ContactGaps {
  const missingEmail = field.filter((p) => !(p.email ?? "").trim()).length;
  // Counted with the same reading the rule enforces, so the banner and the
  // refusal can never disagree about what counts as a number.
  const missingPhone = field.filter((p) => !looksLikePhone((p.phone ?? "").trim())).length;

  const lines: string[] = [];

  if (missingEmail > 0) {
    lines.push(
      `${plural(missingEmail, "player")} ${missingEmail === 1 ? "has" : "have"} no email on file — access is ` +
        `email-based, so they can’t sign in until one’s added below.`,
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
