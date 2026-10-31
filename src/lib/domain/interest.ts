import { EMAIL_RE } from "./typed-limits";
import { golfTermsFor, inClubWords, type GolfWords } from "./golf-terms";

/**
 * SOMEBODY INTERESTED BEFORE WE OPEN (2026-10-21) — the rules of the public
 * /interest form, in one place: what it asks, what it offers, and what it
 * refuses. The action (`app/actions/interest.ts`), the form and the owner's
 * list all read from here.
 *
 * Ajay, 2026-10-21: "encourage them to send their interest … do you think we
 * need a short form … taking little more information from them like who are
 * they?" — then, of the offer: "just mention that if you are interested, you
 * will receive 25% discount code for the plan you sign up when the app will
 * launch". The CODE is never printed; it is sent when we open. 25% is off the
 * first term only (his ruling, 2026-10-17): the first month, or the first year.
 */

/**
 * EVERY WORD THE FORM SAYS that is the same held and live: its labels, hints and
 * buttons. Worded with the panel's marketing manager (2026-10-21). The words that
 * change when TourneyHQ goes live — the heading, the offer, the thanks, the line
 * under the form — are in `go-live.ts` (`interestWords`), both ways, so the page
 * cannot say "opening soon" after launch.
 */
export const INTEREST_COPY = {
  title: "Register your interest",
  bullets: [
    "Entries, tee sheets and live scoring on players' own phones — players need only a round code, no account.",
    "Match play, team cups, skins and side games with who owes what worked out, and a final report — in one place.",
    "Already used for a real 20-player team match, scored live on players' phones.",
  ],
  labels: {
    name: "Your name",
    email: "Email",
    phone: "Phone",
    // In the visitor's golf (2026-10-24): "Club or golf group" from the US,
    // "Club or society" from Britain. `{golfGroup}` is filled by `interestWords`.
    club: "Club or {golfGroup}",
    role: "Which best describes you?",
    members: "Roughly how many members?",
    note: "Anything you'd like us to know?",
  },
  hints: {
    email: "We'll send your code here.",
    phone: "If you'd like a call about your club's events.",
    club: "The one you run or play events for.",
  },
  placeholders: {
    email: "you@example.com",
    note: "Events you run, dates you're planning for, questions…",
  },
  optional: "optional",
  submit: "Register my interest",
  sentPlayer: "Tournaments are set up by your club or {golfGroup}. Tell your secretary or {organizer}, and they can register here too.",
} as const;

/** The subject of the copy sent to inquiries@: sortable at a glance. */
export function interestSubject(who: { name: string; club: string; role: string; size: string }): string {
  return `Interest: ${who.role || "someone"} at ${who.club || "a club"}${who.size ? ` (${who.size})` : ""} – ${who.name}`;
}

/** Who they are. Asked so the reply can be written to the right person. */
export const INTEREST_ROLES = [
  { key: "secretary", label: "Club secretary or manager" },
  { key: "committee", label: "Captain or committee member" },
  { key: "society", label: "League or {golfGroup} {organizer}" },
  { key: "player", label: "Player" },
  { key: "other", label: "Something else" },
] as const;

/** Roughly how big — which plan suits them. */
export const INTEREST_SIZES = [
  { key: "under-50", label: "Under 50 members" },
  { key: "50-150", label: "50 to 150" },
  { key: "150-400", label: "150 to 400" },
  { key: "over-400", label: "Over 400" },
  { key: "unsure", label: "Not sure" },
] as const;

export const INTEREST_LIMITS = { name: 80, email: 160, phone: 30, club: 120, note: 600 } as const;

export interface InterestInput {
  name: string;
  email: string;
  /** Optional — email is the required way to reach them, since the code goes there. */
  phone: string;
  club: string;
  role: string;
  members: string;
  note: string;
  /** Which link brought them — see `interestSource`. Never typed by them. */
  source?: string;
  /** The hidden box. A person never fills it; a script fills every box. */
  website?: string;
}

/** The URL parameters a campaign link carries, kept in this order. */
export const SOURCE_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"] as const;

/**
 * WHERE A NOTE OF INTEREST CAME FROM (2026-10-21), from the address they
 * arrived at and the site that sent them — no cookie, nothing stored on their
 * device. "utm_source=meta; utm_campaign=pre-c1; from=facebook.com". The
 * panel's marketing manager and ad director both called it blocking: without
 * it no post or advertisement can be judged.
 */
export function interestSource(search: string, referrer: string, ownHost: string): string {
  const params = new URLSearchParams(search);
  const parts: string[] = [];
  for (const k of SOURCE_KEYS) {
    const v = (params.get(k) ?? "").trim();
    if (v) parts.push(`${k}=${v}`);
  }
  let from = "";
  try {
    from = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "";
  } catch {
    from = "";
  }
  if (from && from !== ownHost.replace(/^www\./, "")) parts.push(`from=${from}`);
  return cleanSource(parts.join("; "));
}

/** Only the characters a tag is made of, and a short line of them. */
export function cleanSource(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").replace(/[^\w.=;:/ +-]/g, "").trim().slice(0, 300);
}

export type InterestCheck =
  | { ok: true; clean: Omit<InterestInput, "website"> }
  | { ok: false; error: string; field?: keyof InterestInput }
  | { ok: false; spam: true };

const text = (v: unknown) => (typeof v === "string" ? v : "").trim();
/** One address, plainly shaped — the reply goes to it, so it has to be one. The app's one shape. */
const EMAIL = EMAIL_RE;
const PHONE = /^[+()\-.\s\d]+$/;

/**
 * Check what was sent. Types are erased: a "use server" action is a public
 * endpoint, so every field is read as unknown and cut to its length here.
 */
export function checkInterest(raw: unknown): InterestCheck {
  const r = (raw ?? {}) as Record<string, unknown>;
  // A filled hidden box is a script. Told nothing — it is answered as if sent.
  if (text(r.website)) return { ok: false, spam: true };

  const name = text(r.name).slice(0, INTEREST_LIMITS.name);
  const email = text(r.email).toLowerCase().slice(0, INTEREST_LIMITS.email);
  const phone = text(r.phone).slice(0, INTEREST_LIMITS.phone);
  const club = text(r.club).slice(0, INTEREST_LIMITS.club);
  const role = text(r.role);
  const members = text(r.members);
  const note = text(r.note).slice(0, INTEREST_LIMITS.note);

  if (!name) return { ok: false, error: "Tell us your name.", field: "name" };
  if (!EMAIL.test(email)) return { ok: false, error: "That email address doesn't look right — the reply goes to it.", field: "email" };
  // Optional; when given, it has to be a number somebody can dial: digits,
  // spaces and + ( ) - . only, at least seven digits, any country's shape.
  if (phone && (!PHONE.test(phone) || phone.replace(/\D/g, "").length < 7)) {
    return { ok: false, error: "That phone number doesn't look right — or leave it empty.", field: "phone" };
  }
  if (!club) return { ok: false, error: "Tell us your club or {golfGroup} — or write \"none\".", field: "club" };
  if (!INTEREST_ROLES.some((x) => x.key === role)) return { ok: false, error: "Choose who you are.", field: "role" };
  // Size is optional: "Not sure" is an answer, and so is leaving it.
  const size = INTEREST_SIZES.some((x) => x.key === members) ? members : "";
  return { ok: true, clean: { name, email, phone, club, role, members: size, note, source: cleanSource(r.source) } };
}

/**
 * A role as the owner reads it — on `/owner` and in the copy to inquiries@ —
 * in the app's default golf, the US register. The visitor's own form names it
 * in THEIR golf through `interestWords`.
 */
export const roleLabel = (key: string) =>
  interestWords(INTEREST_ROLES.find((x) => x.key === key)?.label ?? key, golfTermsFor("us"));

/** A line of this flow in one register's golf: the form passes the visitor's. */
export function interestWords(text: string, words: GolfWords): string {
  return inClubWords(text, words);
}
export const sizeLabel = (key: string) => INTEREST_SIZES.find((x) => x.key === key)?.label ?? "";
