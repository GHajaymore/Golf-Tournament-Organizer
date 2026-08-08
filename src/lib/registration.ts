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

import { deadlineState, deadlinePassed, isIsoDate } from "./deadline";

export { deadlinePassed, isIsoDate };

export type RegistrationState =
  | "open"
  | "full"
  | "closed-deadline"
  | "closed-manual"
  | "open-extended";

export interface RegistrationStatus {
  state: RegistrationState;
  /** Whether new entries are accepted at all. */
  acceptingEntries: boolean;
  /** Whether an entry would land on the waitlist rather than in the field. */
  waitlisting: boolean;
  /** Short label for a status chip. */
  label: string;
  /** One line of explanation, or "" when the label says everything. */
  detail: string;
}

export interface RegistrationInput {
  /** ISO yyyy-mm-dd, or free text from before the date picker existed. */
  deadline: string;
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
}

export function registrationStatus(input: RegistrationInput): RegistrationStatus {
  const { deadline, capacity, confirmedCount, override, now = new Date() } = input;
  const unlimited = capacity <= 0;
  const full = !unlimited && confirmedCount >= capacity;
  // The deadline half of the question is the shared rule; capacity is layered
  // on top of it here.
  const passed = deadlineState(deadline, null, now).state === "closed";

  if (override === true) {
    return {
      state: "closed-manual",
      acceptingEntries: false,
      waitlisting: false,
      label: "Closed",
      detail: "Closed by the organizer. Reopen it to take more entries.",
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
      detail: `Past the ${deadline} deadline, kept open by the organizer.`,
    };
  }

  if (passed) {
    return {
      state: "closed-deadline",
      acceptingEntries: false,
      waitlisting: false,
      label: "Closed",
      detail: `The ${deadline} deadline has passed. Reopen it if you're still taking entries.`,
    };
  }

  if (full) {
    return {
      state: "full",
      acceptingEntries: true,
      waitlisting: true,
      label: "Full — waitlist active",
      detail: `All ${capacity} places taken; further entries join the waitlist.`,
    };
  }

  return {
    state: "open",
    acceptingEntries: true,
    waitlisting: false,
    label: unlimited ? "Open · unlimited" : "Open",
    detail: "",
  };
}
