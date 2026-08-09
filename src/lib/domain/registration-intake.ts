/**
 * Open (self-service) registration: the rules, with no database and no clock.
 *
 * A stranger on a shared link is about to be written into a tournament's field.
 * Two questions decide what happens, and both are the kind that must be
 * answered on the server and are only worth testing in isolation:
 *
 *   1. Is this person's input even usable? (validation)
 *   2. Given capacity, the deadline and the organizer's mode, do they land
 *      confirmed, on the waitlist, pending — or is the door shut? (placement)
 *
 * The action in src/app/actions/register.ts is a thin caller: it counts the
 * confirmed field, reads the event, and hands the numbers here. Keeping the
 * decision pure is what lets the awkward cases — full field, passed deadline,
 * approve mode, a handicap of "-1.4" vs "abc" — be pinned by unit tests rather
 * than discovered in production against a real club's members.
 */

import { registrationStatus, type RegistrationInput } from "../registration";

export type ApprovalMode = "auto" | "approve";

/** Anything other than the explicit "approve" is auto — the safe default is the
 *  one that doesn't silently park every entry in a queue nobody is watching. */
export function approvalModeOf(value: string | null | undefined): ApprovalMode {
  return value === "approve" ? "approve" : "auto";
}

/** Where an accepted entry is placed. Mirrors Player.status values exactly, so
 *  the caller writes this straight through with no translation table. */
export type IntakeStatus = "confirmed" | "waitlisted" | "pending";

export type IntakeDecision =
  | { accepted: true; status: IntakeStatus; waitlisted: boolean }
  | { accepted: false };

export interface IntakeInput {
  /** The organizer's master switch. False means the link isn't live. */
  registrationOpen: boolean;
  approvalMode: ApprovalMode;
  /** Deadline / capacity / current confirmed count / override / now. The same
   *  shape the organizer screen already computes its status from, so open
   *  registration and the console can never disagree about whether entries are
   *  being taken. */
  reg: RegistrationInput;
}

/**
 * Confirmed, waitlisted, pending, or refused — decided on the server.
 *
 * Order matters. The switch is checked first: a closed link accepts nobody,
 * whatever the capacity says. Then the shared open/closed/full rule. Only once
 * an entry is being accepted at all does the mode decide its resting place:
 *
 *   - approve mode  → pending, ALWAYS. The organizer accepts each entry by
 *     hand, and capacity is applied then, not now. Landing an approve-mode
 *     entry straight into a full field's waitlist would pre-empt the decision
 *     the organizer turned this mode on to make.
 *   - auto mode     → confirmed while there's room, waitlisted once full. The
 *     "full" judgement is the shared one from registrationStatus, so an
 *     unlimited field (capacity 0) never waitlists.
 */
export function decideIntake(input: IntakeInput): IntakeDecision {
  if (!input.registrationOpen) return { accepted: false };

  const status = registrationStatus(input.reg);
  if (!status.acceptingEntries) return { accepted: false };

  if (input.approvalMode === "approve") {
    return { accepted: true, status: "pending", waitlisted: false };
  }
  const waitlisted = status.waitlisting;
  return { accepted: true, status: waitlisted ? "waitlisted" : "confirmed", waitlisted };
}

/**
 * When an organizer accepts a pending entry, where does it go?
 *
 * The same capacity rule as auto mode, decided at accept time rather than at
 * sign-up time — which is the whole point of approve mode. Separated out so the
 * approve action and this reasoning are tested together.
 */
export function placementOnApproval(capacity: number, confirmedCount: number): IntakeStatus {
  const unlimited = capacity <= 0;
  return unlimited || confirmedCount < capacity ? "confirmed" : "waitlisted";
}

/* ── Validation ───────────────────────────────────────────────────────────
 *
 * This runs against input from an unauthenticated public form, so it trusts
 * nothing. Every field is bounded: an open text box on a public endpoint is an
 * invitation to paste a megabyte of junk into a name column, and a handicap is
 * a number with a real-world range, not free text.
 */

/** Same shape the rest of the app validates emails with (see EMAIL_RE in
 *  actions/tournament.ts). Deliberately loose — the job is to reject obvious
 *  nonsense, not to adjudicate RFC 5322. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** WHS indexes run from +10 (a plus handicap, better than scratch) to 54.0.
 *  A value outside this is a typo or a joke, and either way not a handicap. */
const HANDICAP_MIN = -10;
const HANDICAP_MAX = 54;

const NAME_MAX = 80;
const PHONE_MAX = 40;
const TEE_MAX = 40;

export interface RegistrationForm {
  name: string;
  email: string;
  /** As typed. Blank is allowed — not everyone signing up knows their index,
   *  and a missing handicap is a 0 to be corrected later, not a rejection. */
  handicap?: string;
  handicapType?: string;
  phone?: string;
  preferredTee?: string;
}

export interface CleanRegistration {
  name: string;
  email: string;
  handicap: number;
  handicapType: "9" | "18";
  /** none when they left it blank, so it reads as "unknown" rather than a real
   *  scratch handicap on the roster. */
  handicapSource: "manual" | "none";
  phone: string;
  preferredTee: string;
}

export type ValidationResult =
  | { ok: true; value: CleanRegistration }
  | { ok: false; error: string };

/**
 * Clean and check one registration.
 *
 * Returns a single human-readable error rather than a field map: this is a
 * short form, and the first thing wrong with it is the thing to say. Messages
 * name what to fix and never hint at anything about the event.
 */
export function cleanRegistration(input: RegistrationForm): ValidationResult {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > NAME_MAX) return { ok: false, error: "That name is too long." };

  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email — it's how the organizer reaches you." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const rawHandicap = (input.handicap ?? "").trim();
  let handicap = 0;
  let handicapSource: "manual" | "none" = "none";
  if (rawHandicap !== "") {
    // Accept a leading "+" as the plus-handicap notation golfers write (+2.4
    // is better than scratch, i.e. -2.4 as a number).
    const normalized = rawHandicap.startsWith("+") ? `-${rawHandicap.slice(1)}` : rawHandicap;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return { ok: false, error: "Enter your handicap as a number, like 12.4." };
    if (parsed < HANDICAP_MIN || parsed > HANDICAP_MAX) {
      return { ok: false, error: "That handicap doesn't look right — it should be between +10 and 54." };
    }
    handicap = parsed;
    handicapSource = "manual";
  }

  const handicapType = input.handicapType === "9" ? "9" : "18";
  const phone = (input.phone ?? "").trim().slice(0, PHONE_MAX);
  const preferredTee = (input.preferredTee ?? "").trim().slice(0, TEE_MAX);

  return {
    ok: true,
    value: { name, email, handicap, handicapType, handicapSource, phone, preferredTee },
  };
}
