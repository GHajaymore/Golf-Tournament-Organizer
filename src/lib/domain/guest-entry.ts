/**
 * A GUEST ENTERS THEMSELVES ON THE ONE SIGN-UP LINK (J39/J40 PR 3B). The pure half: the words, the
 * boundary checks and the small rules. Reads no clock, no database, no secret.
 *
 * Ruling (Ajay, 7 Nov): guests need no email and no app; they enter themselves only when the
 * organizer switches it on, and always with approval. So nothing here makes a place, an account or a
 * session: an entry made through this door is WAITING, whatever the event's approval mode, and a
 * staff press (`approveSignup`) is the only way it becomes anything else.
 */
import { readHandicapIndex } from "./handicap-label";
import { PERSON_NAME_MAX } from "./typed-limits";
import { isNetBasis } from "./match-entry";

/** The note under "Who invited you?" is staff's to read, never shown to anybody else. */
export const INVITER_MAX = 80;

/** At most this many guest entries wait at once per event: `max(24, the field's limit)`. */
export const WAITING_CAP_FLOOR = 24;
export function waitingCapFor(fieldLimit: number): number {
  return Math.max(WAITING_CAP_FLOOR, fieldLimit > 0 ? fieldLimit : 0);
}

/** A retry of "Ask to play" returns the same entry within this window (C3.5). */
export const NONCE_WINDOW_MINUTES = 15;
/** The page makes a nonce of at least 128 bits (22 base64url characters); this is what the server accepts. */
const NONCE_SHAPE = /^[A-Za-z0-9_-]{22,128}$/;
export function isGuestNonce(v: unknown): v is string {
  return typeof v === "string" && NONCE_SHAPE.test(v);
}

export const GUEST_WORDS = {
  /** The one sentence for EVERY limit in the guest branch: it reveals nothing and never ends in a bare no (C1.10). */
  limit: "We can't take your entry on this phone just now. See the organizer at the desk: they can add you.",
  /** A real token whose guest button is not open (switch off, closed, archived): the form says so in words. */
  notOpen: "Guests can't ask to play here just now. See the organizer at the desk: they can add you.",
  needName: "Type the name you'll play under.",
  nameTooLong: `Keep the name to ${PERSON_NAME_MAX} characters or fewer.`,
  badFigure: "Type the handicap as a number, like 12.4 (or +2.4), or leave it empty.",
  figureRange: "A handicap index runs from +10 to 54. Leave it empty if you don't have one.",
  badNote: `Keep that to ${INVITER_MAX} characters or fewer.`,
  noSend: "Couldn't send. Try again.",
  /** A dead pass, shown to that browser only (C3.4): declined, removed or any other way out. */
  dead: "The organizer hasn't confirmed this entry. Please see them at the desk.",
  /** A failed typed code in any box (C1.10): no kind, no reason. */
  codeOpensNothing: "That code doesn't open anything. Check it on your card or poster, or see the organizer at the desk.",
  noSignal: "No signal just now. We'll keep trying.",
  checkNow: "Check now",
  tryAgain: "Try again",
  askToPlay: "Ask to play",
  hasLive: "You've already asked to play in this event on this phone.",
  /** The member form's one line (N4): costs no press, never says "guest". */
  notAMember: (club: string, organizer: string) => `Not a member of ${club}? Ask the ${organizer}: they can add you.`,
  enterAsGuest: (club: string) => `Not a member of ${club}?`,
  enterAsGuestButton: "Enter as a guest",
  enterAsGuestHint: "No email needed",
  nameLabel: "Your name",
  figureLabel: "Handicap, if you have one",
  figureHint: "Leave it empty if you don't. The organizer will give you one for the day if it's needed.",
  inviterLabel: "Who invited you?",
  inviterHint: "So the organizer knows who you are",
  closedOn: (event: string, day: string, organizer: string) =>
    day
      ? `Entries for ${event} closed on ${day}. See the ${organizer} at the desk: they can add you.`
      : `Entries for ${event} are closed. See the ${organizer} at the desk: they can add you.`,
  waitingLead: "You've asked to play as a guest. The organizer needs to say yes.",
  atTheCourse: "At the course? Show this screen at the desk.",
  lastChecked: (time: string) => `Last checked ${time}`,
  saveCode: "Save this code. It is how you get back in:",
  keepToYourself: "Keep it to yourself.",
  approved: "You're in. Your tee time will show here.",
  // Staff
  switchLabel: "Let guests enter themselves",
  switchHint: (until: string) =>
    `Anyone with this link can ask to play as a guest. No email or phone is asked. You approve each one.${until ? ` Guests can ask until entries close: ${until}.` : ""}`,
  posterGuests: "Guests: no email needed",
  posterWarn: (day: string) => `Entries close ${day}. After that this poster tells guests to see you at the desk. Reopen entries on the day to keep taking them.`,
  newLinkConfirm: "Make a new link? The old link and the code on the poster stop working.",
  morningLine: (day: string) => `Entries closed ${day}. Guests arriving today?`,
  morningAction: "Reopen entries",
  /** The row. */
  asked: (time: string) => `asked ${time}`,
  invitedBy: (name: string) => `Invited by ${name}`,
  noInviter: "No inviter given",
  sameName: (name: string) => `Same name as ${name}, already in the field.`,
  approveDifferent: "Approve: a different person",
  declineAlready: "Decline: already entered",
  figureBoxLabel: "Handicap for today",
  theyGave: (n: string) => `They gave ${n}. Change it if the committee gives a different figure.`,
  noFigure: "No handicap given. Type the figure the committee allows them today.",
  grossOnly: "No handicap given. Not needed: every round is gross.",
  inTheField: "In the field · no tee time yet",
  putInGroup: "Put in a group",
  declineConfirm: (name: string) => `Decline ${name}? They are told to see you at the desk.`,
} as const;

export interface CleanedGuest {
  name: string;
  /** The index the guest declared, or null for none. A pre-fill only: the committee's figure is what is used. */
  declared: number | null;
  invitedBy: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
const squash = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

/**
 * THE FORM, VALIDATED AT THE BOUNDARY (C1.1, C1.8). A `"use server"` export is a public endpoint and types are
 * erased, so every field is read as `unknown`. There is NO email or phone field to fill: a key the caller adds
 * is never read.
 */
export function cleanGuestRegistration(form: unknown): { ok: true; value: CleanedGuest } | { ok: false; error: string } {
  const f = form && typeof form === "object" ? (form as Record<string, unknown>) : {};
  const name = typeof f.name === "string" ? squash(f.name) : "";
  if (!name) return { ok: false, error: GUEST_WORDS.needName };
  if (name.length > PERSON_NAME_MAX) return { ok: false, error: GUEST_WORDS.nameTooLong };
  const note = typeof f.invitedBy === "string" ? squash(f.invitedBy) : "";
  if (note.length > INVITER_MAX) return { ok: false, error: GUEST_WORDS.badNote };
  let declared: number | null = null;
  const raw = f.handicap;
  if (typeof raw === "string" && raw.trim() !== "") {
    if (raw.length > 12) return { ok: false, error: GUEST_WORDS.badFigure };
    const typed = readHandicapIndex(raw);
    if (typed.kind === "unreadable") return { ok: false, error: GUEST_WORDS.badFigure };
    if (typed.kind === "out-of-range") return { ok: false, error: GUEST_WORDS.figureRange };
    if (typed.kind === "index") declared = typed.value;
  } else if (raw !== undefined && raw !== null && raw !== "" && typeof raw !== "string") {
    return { ok: false, error: GUEST_WORDS.badFigure };
  }
  return { ok: true, value: { name, declared, invitedBy: note } };
}

/**
 * THE COMMITTEE'S FIGURE, AS A PAYLOAD (C1.8): a finite number in the handicap range, or absent. NaN, Infinity,
 * a string, an object are refused in words; nothing is coerced.
 */
export function figurePayload(v: unknown): { ok: true; figure: number | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, figure: null };
  if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: GUEST_WORDS.badFigure };
  if (v < -10 || v > 54) return { ok: false, error: GUEST_WORDS.figureRange };
  return { ok: true, figure: Math.round(v * 10) / 10 };
}

/**
 * IS ANY ROUND OF THE EVENT SCORED NET: the question approval asks (Golf Pro, 14 Nov, D1). The guest cannot be
 * approved into such an event with no figure; in a gross-only event no figure is asked. Never a silent scratch.
 */
export function anyRoundNet(stages: ReadonlyArray<{ scoringBasis: string }>): boolean {
  return stages.some((s) => isNetBasis(s.scoringBasis));
}

/** Why this guest cannot be approved yet, or null: the one gate for "nobody without a figure enters a net round". */
export function approvalFigureRefusal(netEvent: boolean, guestName: string, figure: number | null): string | null {
  if (!netEvent || figure !== null) return null;
  return `Type the handicap the committee gives ${guestName} first: a round of this event is scored net.`;
}

