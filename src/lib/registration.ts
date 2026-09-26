/**
 * Whether a tournament is still taking entries.
 *
 * The screen used to answer this from capacity alone, so a tournament whose
 * deadline passed a week ago still said "Open · unlimited". That is the app
 * stating something false about the organizer's own event, on the screen they
 * hand to members.
 *
 * Three inputs, in priority order: an explicit decision by the organizer, the
 * deadline, then capacity. The explicit decision comes first in both
 * directions — deadlines get extended by a word at the bar far more often than
 * they get edited in software, and an organizer who says "we'll take two more"
 * needs the app to agree rather than argue.
 */

import { deadlineState, deadlinePassed, isIsoDate, formatDeadline, parseDeadlineIso, todayIso } from "./deadline";

export { deadlinePassed, isIsoDate, formatDeadline, parseDeadlineIso };

export type RegistrationState =
  | "not-open-yet"
  | "open"
  | "full"
  | "closed-deadline"
  | "closed-manual"
  | "closed-finished"
  | "open-extended";

export interface RegistrationStatus {
  state: RegistrationState;
  /** Whether new entries are accepted at all. */
  acceptingEntries: boolean;
  /** Whether an entry would land on the waitlist rather than in the field. */
  waitlisting: boolean;
  /** Short label for a status chip. */
  label: string;
  /**
   * One line of explanation, or "" when the label says everything.
   *
   * THE FULL SENTENCE, AND IT BELONGS ON ONE ELEMENT. `RegistrationClient`
   * printed it in three places at once — the Status stat card, the banner
   * directly beneath it, and the warning on the public sign-up link — so an
   * organizer whose deadline had passed read "The May 7, 2026 deadline has
   * passed. Reopen it if you're still taking entries." three times on one
   * screen, twice within an inch of each other. Measured on the demo
   * tournament, 2026-09-12.
   *
   * Nothing was wrong with any of the three; each had been added on its own
   * and none knew about the others. Use `short` where the sentence is context
   * rather than the point.
   */
  detail: string;
  /**
   * The same state in a few words, for somewhere a whole sentence would repeat
   * one already on screen.
   *
   * Not a truncation of `detail` — a sub-line under a heading that already
   * reads "Closed" wants the REASON ("past the May 7, 2026 deadline"), not the
   * remedy, and the remedy is the half that made the repeat grating.
   */
  short: string;
}

export interface RegistrationInput {
  /**
   * The tournament's own lifecycle state — draft | registration | ready | live
   * | completed.
   *
   * Required, not optional, and that is the point. `registerForEvent` never
   * consulted it, so a FINISHED tournament kept taking public entries; making
   * the field optional would have left the same hole open for the next caller
   * to fall into. A caller that has no status to give passes the event's, and
   * there is always an event.
   */
  eventStatus: string;
  /** ISO yyyy-mm-dd, or free text from before the date picker existed. */
  deadline: string;
  /**
   * The first day entries are taken, as ISO yyyy-mm-dd — or "" for "as soon as
   * self sign-up is switched on", which is how every tournament behaved before
   * this existed.
   *
   * REQUIRED, for the reason `eventStatus` is: this function is the one rule
   * the organizer's screen, the member's list of club tournaments and the
   * public entry form all read. A caller that could leave it out would take
   * entries before the date its own screen advertises.
   */
  opens: string;
  /** 0 or less means no limit. */
  capacity: number;
  confirmedCount: number;
  /**
   * The organizer's explicit decision, overriding the deadline either way.
   * null means "follow the deadline".
   */
  override: boolean | null;
  /** Injected so this is testable and so "today" is the caller's business. */
  now?: Date;
  /**
   * How this tournament writes a date — `formattingFor(club, event).locale`.
   * Omitted, the sentences below fell back to US English, so a Scottish club
   * showing "24 Oct 2026" for its tournament said entries "close Oct 17, 2026"
   * on the same card. Walked as a member, 2026-09-26.
   */
  locale?: string;
}

/**
 * The entry window in one line, for a member deciding whether to enter:
 * "Entries open 14 Sep · close 27 Sep", or just the half that is set.
 *
 * Only dates that PARSE are printed. A deadline stored as free text ("end of
 * the month") is shown as typed on the organizer's own screen, but printed
 * here beside a status it cannot affect it would be a date with nothing behind
 * it. Nothing at all once the tournament is over.
 */
export function entryDatesOf(opens: string, closes: string, eventStatus: string, locale?: string): string {
  if (eventStatus === "completed") return "";
  const o = parseDeadlineIso(opens) ? formatDeadline(opens, locale) : "";
  const c = parseDeadlineIso(closes) ? formatDeadline(closes, locale) : "";
  if (o && c) return `Entries open ${o} · close ${c}`;
  if (o) return `Entries open ${o}`;
  if (c) return `Entries close ${c}`;
  return "";
}

export function registrationStatus(input: RegistrationInput): RegistrationStatus {
  const { eventStatus, deadline, opens, capacity, confirmedCount, override, now = new Date(), locale } = input;
  const unlimited = capacity <= 0;
  const full = !unlimited && confirmedCount >= capacity;
  // The deadline half of the question is the shared rule; capacity is layered
  // on top of it here.
  const passed = deadlineState(deadline, null, now).state === "closed";

  // Above the override, and deliberately: "we'll take one more" is a decision
  // about a tournament that is still being played. A finished one has a result,
  // and an entry added after it can only corrupt the record — it lands in the
  // field, on the roster, and in a leaderboard nobody is watching any more.
  //
  // Only `completed` closes the door. A LIVE tournament may legitimately still
  // be taking entries — a club league runs for weeks and members join mid-season
  // — and that is what the organizer's own switch is for, now that they can
  // actually reach it once the event is launched.
  if (eventStatus === "completed") {
    return {
      state: "closed-finished",
      acceptingEntries: false,
      waitlisting: false,
      label: "Closed",
      detail: "This tournament has finished.",
      short: "the tournament has finished",
    };
  }

  if (override === true) {
    return {
      state: "closed-manual",
      acceptingEntries: false,
      waitlisting: false,
      label: "Closed",
      detail: "Closed by the organizer. Reopen it to take more entries.",
      short: "closed by the organizer",
    };
  }

  /**
   * NOT OPEN YET — before the day entries open.
   *
   * Compared as dates, like the deadline, and the opening day itself is open:
   * "entries open on the 14th" means a member can enter ON the 14th.
   *
   * The organizer's keep-open override (`false`) lets entries in early too.
   * It is the same button — "take entries now, whatever the dates say" — and a
   * second switch that meant nearly the same thing would be one more thing an
   * organizer has to understand to open their own tournament.
   *
   * A date that names nothing ("", or free text) opens nothing and closes
   * nothing, exactly as `parseDeadlineIso` treats a deadline: refusing entries
   * on a date nobody actually set would be worse than taking them.
   */
  const opensIso = parseDeadlineIso(opens);
  if (override !== false && opensIso && todayIso(now) < opensIso) {
    return {
      state: "not-open-yet",
      acceptingEntries: false,
      waitlisting: false,
      label: "Opens soon",
      detail: `Entries open ${formatDeadline(opens, locale)}.`,
      short: `not open until ${formatDeadline(opens, locale)}`,
    };
  }

  if (override === false && passed) {
    // Deliberately says so rather than just showing "Open": an extension is a
    // decision someone made, and the next person to look at this screen should
    // be able to see that it was made rather than assume the date is wrong.
    return {
      state: "open-extended",
      acceptingEntries: true,
      waitlisting: full,
      label: full ? "Extended — waitlist" : "Extended",
      detail: `Past the ${formatDeadline(deadline, locale)} deadline, kept open by the organizer.`,
      short: "kept open past the deadline",
    };
  }

  if (passed) {
    return {
      state: "closed-deadline",
      acceptingEntries: false,
      waitlisting: false,
      label: "Closed",
      detail: `The ${formatDeadline(deadline, locale)} deadline has passed. Reopen it if you're still taking entries.`,
      short: `past the ${formatDeadline(deadline, locale)} deadline`,
    };
  }

  if (full) {
    return {
      state: "full",
      acceptingEntries: true,
      waitlisting: true,
      label: "Full — waitlist active",
      detail: `All ${capacity} places taken; further entries join the waitlist.`,
      short: "further entries join the waitlist",
    };
  }

  return {
    state: "open",
    acceptingEntries: true,
    waitlisting: false,
    label: unlimited ? "Open · unlimited" : "Open",
    detail: "",
    // The one state whose label really does say everything. Both blank rather
    // than inventing a phrase, so a caller rendering `short` on an open
    // tournament prints nothing instead of a redundant "open".
    short: "",
  };
}

/**
 * How many confirmed entries there are BEYOND the cap, or 0.
 *
 * The field screen printed "Confirmed 33 · of 32 capacity" with nothing
 * remarking on it, beside "Waitlisted 0 · bumped in if a spot opens" — which
 * describes a spot that does not exist and will not. Read off the demo
 * tournament on 2026-09-12.
 *
 * IT IS A REACHABLE AND LEGITIMATE STATE, which is why this reports rather
 * than refuses. `RegistrationClient` says so of the deadline and the same is
 * true here: "adding a player by hand is never blocked by this — that is how a
 * closed event still takes a late entry, and it is the organizer's job."
 * Lowering the cap after entries are in gets there too, and a committee that
 * decides to squeeze two more in is making a decision, not a mistake.
 *
 * What it must not do is go unsaid. `spotsLeft` is clamped with `Math.max(0,
 * …)`, so the screen reports "spots remaining: 0" whether the field is exactly
 * full or three over — and an organizer drawing a tee sheet for thirty-two has
 * thirty-three people turning up.
 */
export function overCapacity(capacity: number, confirmedCount: number): number {
  // Unlimited cannot be exceeded; a cap of 0 or less means there is no cap.
  if (capacity <= 0) return 0;
  return Math.max(0, confirmedCount - capacity);
}

/**
 * A SUGGESTED invite, built from the tournament's own details.
 *
 * `inviteMessage` is free text an organizer types once, and it was the one
 * field a copy carried that contains the things a copy does not: the demo
 * club's reads "You're invited to the Demo Cup — May 14–16, 2026 at Ridgeline
 * National, Aspen Falls." Next year's copy would have shipped that verbatim,
 * to the whole membership, one WhatsApp button away.
 *
 * So the copy starts blank — see `NOT_CLONED_EVENT_FIELDS` — and this fills
 * the gap as a PLACEHOLDER rather than a stored value. That distinction is the
 * whole design: a placeholder is recomputed from the event on every render, so
 * it cannot be wrong about the date the way a saved sentence can. Type over it
 * and what you typed is yours; leave it and there is nothing stale to send.
 *
 * Deliberately does NOT include the sign-up link. `fullMessage` appends that
 * separately, and a second copy of it in the body would go out twice.
 */
export function suggestedInvite(input: {
  name: string;
  /** Free text — "May 14–16, 2026", or "" for a tournament with no date yet. */
  dates: string;
  /** The course, or "" for a league that moves each week. */
  course: string;
}): string {
  const name = input.name.trim();
  if (!name) return "";
  const dates = input.dates.trim();
  const course = input.course.trim();
  /**
   * Each clause only when there is something to say. A tournament with no date
   * yet produced "— at ." from a template built by concatenation, which is
   * worse than the blank box this replaces.
   */
  const when = dates ? ` on ${dates}` : "";
  const where = course ? ` at ${course}` : "";
  return `You're invited to ${name}${when}${where}. Tap the link to claim a spot.`;
}
