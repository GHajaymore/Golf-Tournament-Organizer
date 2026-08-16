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

export type HandicapParse =
  | { ok: true; value: number; source: "manual" }
  /** Left blank. Not a zero — a scratch handicap is a claim, and an empty box
   *  is the absence of one. */
  | { ok: true; value: 0; source: "none" }
  | { ok: false; error: string };

/**
 * Read a handicap the way a golfer writes one.
 *
 * D4 of the 2026-08-12 audit. The public form has always done this correctly
 * and the two importers used bare `parseFloat`, which gets the SIGN WRONG on
 * the one notation where it matters: `parseFloat("+2.4")` is 2.4, and a plus
 * handicap is 2.4 strokes BETTER than scratch, i.e. -2.4. Every scratch-and-
 * better player imported as a mid-handicapper and was then GIVEN the strokes
 * they should have been giving — a silent error in the direction that decides
 * matches, on the players most likely to be in the final.
 *
 * `parseFloat` also takes "12.4abc" as 12.4, and nothing downstream
 * range-checked, so "999", "-500" and "1e9" all landed on the roster.
 *
 * Extracted here so there is one answer. The importers had their own, the form
 * had another, and the difference was invisible until a plus-handicapper
 * entered.
 */
export function parseHandicapInput(raw: string | null | undefined): HandicapParse {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, value: 0, source: "none" };

  // "+2.4" is 2.4 better than scratch. The leading plus is golf notation, not
  // arithmetic — which is exactly why parseFloat gets it backwards.
  const normalized = value.startsWith("+") ? `-${value.slice(1)}` : value;
  // Number(), not parseFloat(): parseFloat stops at the first thing it doesn't
  // understand and returns what it has, so "12.4abc" becomes a handicap.
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { ok: false, error: "Enter your handicap as a number, like 12.4." };
  if (parsed < HANDICAP_MIN || parsed > HANDICAP_MAX) {
    return { ok: false, error: "That handicap doesn't look right — it should be between +10 and 54." };
  }
  return { ok: true, value: parsed, source: "manual" };
}

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
/**
 * Is this a usable phone number?
 *
 * Deliberately loose. Golf clubs have members abroad, members who write their
 * number with spaces, dots, brackets or a leading +, and members on a landline.
 * A strict pattern here would reject real numbers, and rejecting a real number
 * on a registration form loses an entry — so this only asks whether there are
 * enough digits to be a number at all. Whether it can actually receive a text
 * is answered by the carrier at send time, not guessed here.
 */
export function looksLikePhone(raw: string): boolean {
  const digits = (raw ?? "").replace(/\D/g, "");
  // Seven is the shortest real subscriber number; fifteen is E.164's maximum.
  return digits.length >= 7 && digits.length <= 15;
}

export function cleanRegistration(input: RegistrationForm, requirePhone = false): ValidationResult {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > NAME_MAX) return { ok: false, error: "That name is too long." };

  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email — it's how the organizer reaches you." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  // The shared reading — this path's own version of it is what the importers
  // were supposed to have been using all along.
  const hcp = parseHandicapInput(input.handicap);
  if (!hcp.ok) return { ok: false, error: hcp.error };
  const handicap = hcp.value;
  const handicapSource = hcp.source;

  const handicapType = input.handicapType === "9" ? "9" : "18";
  const phone = (input.phone ?? "").trim().slice(0, PHONE_MAX);
  // Only when this tournament asks for it. Most don't: a phone number is not
  // needed to run a competition, and a field that costs entries has to earn
  // its place per event rather than be imposed on every club. The ones that
  // turn it on are the ones that ring stragglers off a shotgun start.
  if (requirePhone) {
    if (!phone) return { ok: false, error: "Enter a mobile number — this tournament needs one to reach you on the day." };
    if (!looksLikePhone(phone)) return { ok: false, error: "That doesn't look like a phone number." };
  }
  const preferredTee = (input.preferredTee ?? "").trim().slice(0, TEE_MAX);

  return {
    ok: true,
    value: { name, email, handicap, handicapType, handicapSource, phone, preferredTee },
  };
}
