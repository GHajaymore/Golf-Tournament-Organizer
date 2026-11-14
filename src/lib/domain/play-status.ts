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
 * WHICH KIND OF SCREEN IS ASKING (2026-11-14, safety sweep G-1).
 *
 *   "player"  the player app (`/me…`): a signed-in member's own tournament
 *   "play"    the round-code surface (`/play`, `/play/board`): the round the
 *             phone's code opened, with no account at all
 *
 * A screen names its KIND, never an event: who the person is and which round
 * they are in is read from their own cookie by `playStatusForScreen`
 * (`services/play-status-screen.ts`), the one place that decides it, so the
 * banner a screen draws and the siren poll on it cannot disagree. Anything
 * else a client sends is read as "player", which is what a cached page from
 * before this change asked for.
 */
export type PlayScreen = "player" | "play";

export function playScreenOf(raw: unknown): PlayScreen {
  return raw === "play" ? "play" : "player";
}

/**
 * WHERE THE COMMITTEE CAN STOP PLAY: EVERY CONSOLE SCREEN (simplicity cut 2,
 * 2026-11-14; Rule 5.7). Suspend play, its banner and Resume play were drawn
 * on the dashboard only: four presses from the tee sheet in a lightning storm,
 * and resuming took the TD off the sheet. They are drawn ONCE now, by the
 * console's shell (`ConsolePlayStatus` in `(app)/layout.tsx`), on every
 * console screen, the dashboard included — so it is the button and the
 * confirm, 2 presses, from wherever the TD is standing.
 *
 * The rule is the dashboard's as it was, from the machine's step (the panel's
 * condition 1: no new "day of play" rule):
 *
 *   - staff only: an organizer or an assistant, as the action requires. Never
 *     a player, nor staff looking at the console as a player; a guest never
 *     reaches the console at all.
 *   - while the tournament is being played (`step === "live"`): not before
 *     launch, and not once play is over (T69: there is no play left to stop).
 *   - and ALWAYS while play is suspended, whatever the step, so the way back
 *     is never hidden.
 */
export function consoleOffersPlayStop(viewRole: string, step: string | null | undefined, suspended: boolean): boolean {
  if (viewRole !== "admin" && viewRole !== "assistant") return false;
  return step === "live" || suspended;
}

/**
 * WHO THE ALARM WILL MISS, on the suspend confirm (F-2 on #1133; the panel's
 * condition 5). Names only — no contact details, device or reason — and the
 * player's own word for the switch, "alerts" (the UX Writer, 14 Nov). The
 * names come from ONE reader, `noticesOffAmong` (#1133); "" when nobody is
 * missed or nobody has been asked, so the confirm then says nothing.
 */
export function alertsOffWords(names: readonly string[]): string {
  if (names.length === 0) return "";
  const who = names.length === 1 ? "1 player has" : `${names.length} players have`;
  return `${who} alerts off and will not be buzzed: ${names.join(", ")}. Tell them another way, or sound the horn.`;
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
