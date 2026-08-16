import type { ScopeKind } from "./messaging";

/**
 * The rules that decide whether a text is sent, and what it costs.
 *
 * Pure, because every one of these is a rule somebody will want to argue with
 * later and all three failure modes here are expensive in a way the rest of
 * the app is not:
 *
 *  - a text costs real money per recipient, so a rule that fans out too widely
 *    bills the club;
 *  - a text to somebody who did not ask for one is a complaint and, in several
 *    jurisdictions, a fine;
 *  - a text that arrives after the group has teed off is worthless.
 *
 * None of that is visible in a type signature, so it is written down and
 * tested here rather than discovered on an invoice.
 */

/**
 * Scopes a text may ever fan out to.
 *
 * Deliberately only the ones an organizer broadcasts to. A fourball's
 * conversation is where somebody says "putting now" nine times, and at a few
 * pence a message across a 120-player field that is a bill nobody agreed to —
 * so chat scopes are in-app only, permanently, and not behind a setting a
 * club can switch on by accident.
 *
 * `direct` is excluded for a different reason: a text from one member to
 * another, sent by the club's number, makes the club the publisher of
 * something it never saw.
 */
export const SMS_BROADCAST_SCOPES: ScopeKind[] = ["club", "event", "flight", "round", "team"];

export function canFanOutToSms(kind: ScopeKind): boolean {
  return SMS_BROADCAST_SCOPES.includes(kind);
}

/**
 * A GSM-7 segment is 160 characters; 153 once a message is long enough to need
 * concatenating. Anything outside the GSM alphabet forces UCS-2, where those
 * numbers drop to 70 and 67 — which is why one curly quote can double a bill.
 */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function isGsm7(text: string): boolean {
  return [...text].every((c) => GSM7.includes(c) || GSM7_EXT.includes(c));
}

/**
 * How many segments this text will be billed as.
 *
 * Surfaced to the organizer before they send, because "this will cost about
 * £14" is the only number that actually changes what somebody writes.
 */
export function segmentCount(text: string): number {
  if (!text) return 0;
  // Extended characters take two slots in GSM-7.
  const gsm = isGsm7(text);
  const length = gsm
    ? [...text].reduce((n, c) => n + (GSM7_EXT.includes(c) ? 2 : 1), 0)
    : [...text].length;

  const single = gsm ? 160 : 70;
  const concat = gsm ? 153 : 67;
  return length <= single ? 1 : Math.ceil(length / concat);
}

/**
 * Rewrite the characters that silently double a bill.
 *
 * A curly apostrophe, an en dash and a "…" are what a phone's keyboard and a
 * copy-paste from a mail client produce, and any one of them pushes the whole
 * message into UCS-2 — halving the characters per segment. Substituting them
 * is invisible to the reader and routinely halves the cost.
 */
export function toGsmSafe(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

export interface ComposedSms {
  text: string;
  segments: number;
  /** True when we had to shorten the body to fit the cap. */
  truncated: boolean;
}

/** Beyond this a broadcast is a newsletter, not an alert. */
export const MAX_SMS_SEGMENTS = 4;

/**
 * The text as it will actually arrive.
 *
 * Prefixed with the club so a message from an unknown number is not binned,
 * and suffixed with how to stop — which is not decoration: an SMS programme
 * without a visible opt-out is the thing regulators actually act on. The
 * suffix is counted before the body is trimmed, so it can never be the part
 * that gets cut.
 */
export function composeSms(clubName: string, body: string, includeStop = true): ComposedSms {
  const prefix = clubName.trim() ? `${toGsmSafe(clubName.trim())}: ` : "";
  const suffix = includeStop ? "\nReply STOP to opt out" : "";
  const clean = toGsmSafe(body).trim();

  const full = `${prefix}${clean}${suffix}`;
  if (segmentCount(full) <= MAX_SMS_SEGMENTS) {
    return { text: full, segments: segmentCount(full), truncated: false };
  }

  // Trim the body only, one character at a time from the end, until the whole
  // message fits. The club name and the opt-out both have to survive.
  let trimmed = clean;
  while (trimmed.length > 0 && segmentCount(`${prefix}${trimmed}…${suffix}`) > MAX_SMS_SEGMENTS) {
    trimmed = trimmed.slice(0, -1);
  }
  const text = `${prefix}${toGsmSafe(`${trimmed}…`)}${suffix}`;
  return { text, segments: segmentCount(text), truncated: true };
}

/**
 * Keywords a carrier expects to be honoured, whatever we do with them.
 *
 * STOP is not optional and not something to confirm with a follow-up question:
 * somebody texting STOP has already decided. START and UNSTOP are the standard
 * way back, and HELP has to answer with who this is.
 */
const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out"];
const START_WORDS = ["start", "unstop", "yes", "optin", "opt-in"];
const HELP_WORDS = ["help", "info"];

export type InboundIntent = "stop" | "start" | "help" | "other";

/**
 * What an inbound text means.
 *
 * Matched on the whole message once punctuation and case are stripped, not on
 * "contains stop" — "we had to stop at the turn" is not an opt-out, and
 * treating it as one loses somebody their tee times.
 */
export function inboundIntent(raw: string): InboundIntent {
  const word = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
  if (STOP_WORDS.includes(word)) return "stop";
  if (START_WORDS.includes(word)) return "start";
  if (HELP_WORDS.includes(word)) return "help";
  return "other";
}

/**
 * Normalise a number for sending and for matching an inbound reply.
 *
 * Digits only, plus a leading `+` when the number carried one or already looks
 * international. Deliberately NOT a full E.164 conversion: guessing a country
 * code from a bare national number is how a club texts a stranger in another
 * country. A number that cannot be normalised confidently is passed through
 * for the carrier to reject, which is a visible failure rather than a message
 * delivered to the wrong person.
 */
export function normalizePhone(raw: string, defaultCountryCode = ""): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const hadPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  if (!digits) return "";
  if (hadPlus) return `+${digits}`;
  const cc = defaultCountryCode.replace(/\D/g, "");
  // A national number with a trunk zero: drop it before the country code, or
  // the result is a number nobody has.
  if (cc) return `+${cc}${digits.replace(/^0/, "")}`;
  return digits;
}

/** Two numbers written differently are still one person. */
export function samePhone(a: string, b: string): boolean {
  const digits = (s: string) => (s ?? "").replace(/\D/g, "");
  const x = digits(a);
  const y = digits(b);
  if (!x || !y) return false;
  // Compare from the right: one may carry a country code the other omits.
  const n = Math.min(x.length, y.length, 9);
  return n >= 7 && x.slice(-n) === y.slice(-n);
}

export interface SmsRecipient {
  name: string;
  phone: string;
  /** Explicitly agreed to receive texts. */
  smsOptIn: boolean;
}

export interface FanOut {
  send: SmsRecipient[];
  /** Everyone excluded, and why — shown to the organizer before they pay. */
  skipped: { name: string; reason: string }[];
  segmentsEach: number;
  /** segments × recipients, which is what the bill is counted in. */
  totalSegments: number;
}

/**
 * Who actually gets the text, and what it will cost.
 *
 * Opt-in is required rather than assumed. Somebody who handed over a phone
 * number so the organizer could ring them about a tee time has not agreed to
 * receive bulk texts, and treating those as the same thing is exactly the
 * conflation that gets an SMS programme shut down.
 */
export function planFanOut(recipients: SmsRecipient[], text: string): FanOut {
  const segmentsEach = segmentCount(text);
  const send: SmsRecipient[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const r of recipients) {
    if (!r.phone.trim()) {
      skipped.push({ name: r.name, reason: "no mobile number" });
      continue;
    }
    if (!r.smsOptIn) {
      skipped.push({ name: r.name, reason: "hasn't opted in to texts" });
      continue;
    }
    // One person entered twice, or sharing a number with a partner, is one
    // text — not two, and not two charges.
    const key = r.phone.replace(/\D/g, "").slice(-9);
    if (seen.has(key)) {
      skipped.push({ name: r.name, reason: "same number as someone already on the list" });
      continue;
    }
    seen.add(key);
    send.push(r);
  }

  return { send, skipped, segmentsEach, totalSegments: segmentsEach * send.length };
}
