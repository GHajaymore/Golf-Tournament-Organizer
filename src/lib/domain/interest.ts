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
 * EVERY WORD THE FLOW SAYS, in one place: the front door's notice, the page,
 * the form, the answer. Worded with the panel's marketing manager (2026-10-21).
 */
export const INTEREST_COPY = {
  title: "Register your interest",
  kicker: "Opening soon",
  h1: "Be first on the tee when TourneyHQ opens",
  sub: "Register now and we'll email you a code for 25% off the paid plan you choose at launch. It covers your first term: your first month, or your first year if you pay yearly.",
  bullets: [
    "Entries, tee sheets and live scoring on players' own phones — players need only a round code, no account.",
    "Match play, team cups, money games and a final report in one place.",
    "Already used for a real 20-player team match, scored live on players' phones.",
  ],
  labels: {
    name: "Your name",
    email: "Email",
    phone: "Phone",
    club: "Club or society",
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
  reassure: "We'll use these details only to tell you when TourneyHQ opens, to send your code, and — if you leave a number — to call you about your events. We never sell them, and we'll delete them whenever you ask.",
  sent: (name: string, email: string) =>
    `Thanks, ${name}, you're on the list. We'll email ${email} when TourneyHQ opens, with your 25% code inside. Nothing else until then.`,
  sentPlayer: "Tournaments are set up by your club or society. Tell your secretary or organizer, and they can register here too.",
  share: "Know another club or society that runs competitions? Send them tourneyhq.club/interest and they'll get the same offer.",
  // The front door's notice, while sign-ins are held.
  noticeOffer: "Register your interest and we'll send you 25% off your first term when accounts open.",
  noticeLink: "Register your interest →",
  noticeOr: "Or write to",
} as const;

/** The offer in one sentence. */
export const INTEREST_OFFER = INTEREST_COPY.sub;

/** The subject of the copy sent to inquiries@: sortable at a glance. */
export function interestSubject(who: { name: string; club: string; role: string; size: string }): string {
  return `Interest: ${who.role || "someone"} at ${who.club || "a club"}${who.size ? ` (${who.size})` : ""} – ${who.name}`;
}

/** Who they are. Asked so the reply can be written to the right person. */
export const INTEREST_ROLES = [
  { key: "secretary", label: "Club secretary or manager" },
  { key: "committee", label: "Captain or committee member" },
  { key: "society", label: "Society or league organizer" },
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
  /** The hidden box. A person never fills it; a script fills every box. */
  website?: string;
}

export type InterestCheck =
  | { ok: true; clean: Omit<InterestInput, "website"> }
  | { ok: false; error: string; field?: keyof InterestInput }
  | { ok: false; spam: true };

const text = (v: unknown) => (typeof v === "string" ? v : "").trim();
/** One address, plainly shaped — the reply goes to it, so it has to be one. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if (!club) return { ok: false, error: "Tell us your club or society — or write \"none\".", field: "club" };
  if (!INTEREST_ROLES.some((x) => x.key === role)) return { ok: false, error: "Choose who you are.", field: "role" };
  // Size is optional: "Not sure" is an answer, and so is leaving it.
  const size = INTEREST_SIZES.some((x) => x.key === members) ? members : "";
  return { ok: true, clean: { name, email, phone, club, role, members: size, note } };
}

export const roleLabel = (key: string) => INTEREST_ROLES.find((x) => x.key === key)?.label ?? key;
export const sizeLabel = (key: string) => INTEREST_SIZES.find((x) => x.key === key)?.label ?? "";
