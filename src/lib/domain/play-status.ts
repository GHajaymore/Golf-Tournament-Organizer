/**
 * PLAY SUSPENDED — the one thing a committee has to be able to tell a whole
 * field at once, and fast (Ajay, 2026-09-28: "go ahead with your
 * recommendations").
 *
 * Rule 5.7a: when the committee suspends play for a dangerous situation —
 * lightning, above all — every player must stop immediately and not play
 * another stroke until it resumes play. An announcement in a list is not good
 * enough for that; a player halfway down the 14th needs the screen they are
 * already looking at to say so, and their phone to buzz.
 *
 * One set of words for the banner, the push and the public board, so the
 * three cannot say different things about the same storm.
 */

/** Long enough for "Lightning within 5 miles — go to the clubhouse or a shelter". */
export const MAX_SUSPEND_NOTE = 120;

export function cleanSuspendNote(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_SUSPEND_NOTE) : "";
}

export interface PlayStatus {
  suspended: boolean;
  /** Why, in the organizer's words; "" when they gave none. */
  note: string;
}

export function playStatusOf(e: { playSuspendedAt: Date | null; playSuspendedNote: string } | null | undefined): PlayStatus {
  return { suspended: !!e?.playSuspendedAt, note: e?.playSuspendedNote ?? "" };
}

/**
 * What a player is told while play is suspended. The instruction is Rule
 * 5.7a's, in plain words: stop now, no more shots until play resumes.
 */
export function suspendedWords(note: string, organizer = "organizer"): { title: string; body: string } {
  const why = note ? `${note.replace(/[.!]+$/, "")}. ` : "";
  return {
    title: "Play is suspended",
    body: `${why}Stop now and don't play another shot until the ${organizer} resumes play.`,
  };
}

/**
 * WHAT AN OPEN PLAYER SCREEN DOES WHEN IT NOTICES A CHANGE (Ajay, 2026-09-28:
 * "can you also add an alarming sound?").
 *
 *   - play goes from on to suspended → the siren, then show the banner;
 *   - suspended to on → just show the page without the banner;
 *   - no change → nothing.
 *
 * Only on a CHANGE it saw happen. A screen opened while play is already
 * suspended shows the banner and stays quiet — its player opened it from the
 * notification, and a siren at somebody reading the reason is noise.
 */
export function alarmOnChange(was: boolean, now: boolean): "siren" | "refresh" | null {
  if (!was && now) return "siren";
  if (was && !now) return "refresh";
  return null;
}

/** And when it resumes: back to where you stopped (Rule 5.7d). */
export function resumedWords(): { title: string; body: string } {
  return {
    title: "Play has resumed",
    body: "Go back to where you stopped and play on.",
  };
}
