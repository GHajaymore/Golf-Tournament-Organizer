/**
 * AN ARCHIVED TOURNAMENT'S CONSOLE IS READ-ONLY IN ONE PLACE (2026-11-09; the
 * tournament director and the UX designer on the panel).
 *
 * A lapsed club's tournament refuses every change (`domain/club-archive.ts`),
 * and the console said so in a banner — and then drew every button live
 * beneath it. Pressing one ran an action that THREW the archive's refusal, and
 * a production build shows a thrown message as "This screen didn't load". The
 * actions were being taught to return the sentence one by one (#1093), and
 * about 140 more were waiting: a rule kept in every button is a rule one new
 * button forgets.
 *
 * So the console's layout wraps every screen of an archived tournament in
 * `ArchiveReadOnly`, which disables the screen's controls natively (a disabled
 * control is skipped by the keyboard, announced as unavailable, and cannot be
 * pressed), and the banner above says why — once, in the archive's own
 * sentence. The actions' refusals stay as the backstop.
 *
 * WHAT STAYS LIVE is anything that only changes what is SHOWN: links (never
 * touched — they are not controls), a disclosure that opens or closes a panel
 * (`aria-expanded`), a tab, a search box that filters a list, and any control
 * inside `[data-reads]` — the mark a print, an export or a "which round"
 * picker carries, saying "this changes the view, never a record". A control
 * that writes must never carry it.
 *
 * AND WHAT MAKES A NEW TOURNAMENT (2026-11-10, the panel): "Copy last event"
 * writes, but only the copy — a new tournament, never this one (`cloneEvent`
 * reads the source and asks nothing of its archive). It carries its own mark,
 * `[data-new-tournament]`, so `data-reads` stays a promise that nothing is
 * written at all.
 *
 * Pure: the component asks these about each control and each screen, and the
 * test asks them the same questions with no browser.
 */

/** The marked opt-out: inside it, a control only changes what is shown. */
export const READS_ATTRIBUTE = "data-reads";

/** The second opt-out: inside it, a control writes only a NEW tournament (Copy last event). */
export const NEW_TOURNAMENT_ATTRIBUTE = "data-new-tournament";

/** The controls the archive disables. Links are not among them, on purpose. */
export const ARCHIVE_LOCKED_CONTROLS = "button, input, select, textarea";

/**
 * Screens of the console that are NOT the open tournament's, so the archive
 * does not lock them: the club's own settings (where "Resubscribe" is — the way
 * out must stay open), the list of the club's tournaments (to open another),
 * and the organizer's guide.
 */
export const ARCHIVE_WRITABLE_SCREENS = ["/organization", "/tournaments", "/guide"] as const;

/** Does the archive lock this console screen? */
export function archiveLocksScreen(pathname: string): boolean {
  return !ARCHIVE_WRITABLE_SCREENS.some((s) => pathname === s || pathname.startsWith(`${s}/`));
}

/** What the component reads off one control. */
export interface ControlFacts {
  /** Lower-case tag name: button, input, select, textarea. */
  tag: string;
  /** The `type` attribute, lower-case, or "". */
  type: string;
  /** The `role` attribute, or "". */
  role: string;
  /** Carries `aria-expanded` — a disclosure. */
  expands: boolean;
  /** Is inside an element marked `data-reads`. */
  reads: boolean;
  /** Is inside an element marked `data-new-tournament`. */
  makesNew: boolean;
}

/**
 * Does a control stay pressable in an archived tournament? Only when it changes
 * the view alone, or writes nothing but a new tournament.
 */
export function archiveLeavesLive(c: ControlFacts): boolean {
  if (c.reads) return true;
  if (c.makesNew) return true;
  if (c.role === "tab") return true;
  if (c.tag === "button" && c.expands) return true;
  if (c.tag === "input" && c.type === "search") return true;
  return false;
}

/**
 * Events the archive refuses inside a locked screen, at the capture phase:
 * a form sent by any means, and a drag (moving a player between flights, a file
 * dropped on an import) — the two ways a change is made without a control.
 */
export const ARCHIVE_REFUSED_EVENTS = ["submit", "dragstart", "drop"] as const;
