/**
 * A GUEST'S PERSONAL PLAYER LINK — THE RULES (J39/J40 PR 1; design 12 Nov, with
 * the Security & TD review's five must-fixes).
 *
 * Ajay, 7 Nov: club members and organizers need an email; GUESTS need no email
 * and no app install. A guest gets a personal player link: their tee time, their
 * card and the board, on any phone browser. One link = one guest entry in one
 * event, nothing wider (D1).
 *
 * The code is 12 characters of Crockford base32 — 60 bits — shown three ways,
 * one secret: a link whose code rides in the FRAGMENT (`/p#K7QM2XRA9DTP`, so it
 * never reaches a server log, a Referer or a preview fetcher's request line), a
 * typed code (`K7QM-2XRA-9DTP` at /p), and read aloud ("K7QM · 2XRA · 9DTP").
 *
 * Pure: no clock of its own, no database, no secret. The keyed hashes, the
 * sealing and the cookie live in `services/player-link.ts` and `guest-auth.ts`.
 */

/** Crockford base32: 0-9 and A-Z without I, L, O and U. Thirty-two symbols, five bits each. */
export const LINK_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Twelve symbols: 60 bits (`player-link.test.ts` holds it). */
export const LINK_CODE_LENGTH = 12;
/** Where a link opens. The code is never a path segment: there is no `/p/[code]` route. */
export const LINK_PATH = "/p";

/**
 * A code as somebody typed, pasted or read it, or null when it is not one.
 *
 * FORGIVING (design §2.1): case is ignored; spaces, dashes, dots and the middle
 * dot a code is read out with are dropped; O reads as 0, I and L as 1 (the
 * letters Crockford leaves out because they are mistaken for those digits). A
 * whole pasted link is read from its fragment. Anything else outside the
 * alphabet, or the wrong length, is not a code.
 */
export function normaliseLinkCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let text = input;
  const hash = text.lastIndexOf("#");
  if (hash >= 0) text = text.slice(hash + 1);
  if (text.length > 64) return null;
  const folded = text
    .toUpperCase()
    .replace(/[\s\-.·•_]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (folded.length !== LINK_CODE_LENGTH) return null;
  for (const ch of folded) if (!LINK_ALPHABET.includes(ch)) return null;
  return folded;
}

/** `K7QM-2XRA-9DTP`: how a code is printed and typed. */
export function groupedCode(code: string): string {
  return [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12)].join("-");
}

/** `K7QM · 2XRA · 9DTP`: how a code is read out on a phone call. */
export function spokenCode(code: string): string {
  return [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12)].join(" · ");
}

/** The link itself. The code rides in the fragment, never the path or a query (S3). */
export function playerLinkUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${LINK_PATH}#${code}`;
}

/** `tourneyhq.club/p`: where a guest types the code, printed under every QR (7N). */
export function linkAddress(origin: string): string {
  return `${origin.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${LINK_PATH}`;
}

/* ───────────────────────── when a pass is live ───────────────────────── */

/** A pass lives until this many CLUB days after the event's last round (design §2.6). */
export const PASS_DAYS_AFTER_LAST_ROUND = 90;

/** The entry statuses a pass stays live for: confirmed, and awaiting a place (Today only — S5). */
const LIVE_STATUSES = new Set(["confirmed", "pending", "waitlisted"]);

/**
 * The event's last day of golf, yyyy-mm-dd, or "" when nothing is dated: the
 * latest of the rounds' own dates and the event's start and end days. Days are
 * compared as text, which is right for yyyy-mm-dd.
 */
export function lastPlayDay(event: { startOn?: string | null; endOn?: string | null }, stages: ReadonlyArray<{ playedOn?: string | null }>): string {
  const days = [event.startOn, event.endOn, ...stages.map((s) => s.playedOn)]
    .map((d) => (d ?? "").trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.sort().at(-1) ?? "";
}

/** A day plus some days, as a DAY (yyyy-mm-dd) — calendar arithmetic, never an instant. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
}

/**
 * A link in an event with NO day at all — no dates, no dated round — lives this
 * many club days from the day its code was made (or last replaced), never for
 * ever (security review SF-4): the cookie's 180-day cap does not bound a CODE,
 * which mints a fresh cookie. The same span as the cookie, so a guest of an
 * undated season is not cut off sooner than one of a dated one would be by it.
 */
export const UNDATED_PASS_DAYS = 180;

/**
 * The last club day a pass opens on: 90 days after the event's last day of
 * golf; or, with no day known, `UNDATED_PASS_DAYS` after the club day its code
 * was made. "" only when neither is known.
 */
export function passLastDay(lastDay: string, madeDay = ""): string {
  if (lastDay) return addDays(lastDay, PASS_DAYS_AFTER_LAST_ROUND);
  return madeDay ? addDays(madeDay, UNDATED_PASS_DAYS) : "";
}

export type PassRefusal = "revoked" | "rotated" | "left" | "member" | "expired";

/**
 * Why a pass does not open, or null when it does (design §2.6). Every one is
 * said to the guest in the SAME words (`PLAYER_LINK_WORDS.dead`), so a refusal
 * never confirms a code was once real.
 *
 * `today` is the CLUB's day (`todayForEvent`), never the server's — a pass
 * ends on a day at the club, and an instant is never compared with it.
 * A lapsed club's archive does NOT end a pass: its board and results stay
 * open to players to view (`archiveRefusal`), and every write is refused by
 * the scoring gate's own archive check, as for any player.
 * `heldVersion` is the version signed into the cookie, or null when the pass is
 * being opened from its code (then any version is the current one).
 */
export function passRefusal(input: {
  revokedAt: Date | null;
  version: number;
  heldVersion: number | null;
  entryStatus: string;
  /** The entry's standing: a pass is a guest's only (D12; S14: made a member, the pass ends). */
  isGuest: boolean;
  lastDay: string;
  /** The club day this pass's current code was made (or last replaced): the undated bound (SF-4). */
  madeDay: string;
  today: string;
}): PassRefusal | null {
  if (input.revokedAt) return "revoked";
  if (input.heldVersion !== null && input.heldVersion !== input.version) return "rotated";
  if (!LIVE_STATUSES.has(input.entryStatus)) return "left";
  if (!input.isGuest) return "member";
  const last = passLastDay(input.lastDay, input.madeDay);
  if (last && input.today > last) return "expired";
  return null;
}

/**
 * S5: WRITES THROUGH A LINK ARE A CONFIRMED ENTRANT'S. A pending or waitlisted
 * pass is live for Today only. The same rule `myPlayerIds` applies to an
 * account ("yours to play" is a confirmed row), said here once for the guest
 * branch of `myPlayerIdsFor` — the one reader every card guard asks.
 */
export function mayPlayThroughLink(entryStatus: string): boolean {
  return entryStatus === "confirmed";
}

/**
 * GUEST_ACTIONS — THE CLOSED LIST of server actions a player link may perform
 * (design §2.8). A guest enters, certifies and disputes their OWN stroke card
 * where the event lets a player do so (`requireScoreEntryForStage`, through
 * `guestActorFor`), and forgets the link or switches view on their own phone.
 * Every other action still calls `getSession()`, gets null, and refuses: no
 * other door learns about guests. `a-guest-acts-only-through-its-list.test.ts`
 * holds the source to this list.
 *
 * And it asks whether play is suspended in its own event, for the siren on an
 * open screen (`currentPlayStatus`, G1: Rule 5.7, a safety notice).
 *
 * Not yet on it (later PRs of the design): messages and push (PR 2), side-game
 * opt-in, withdrawing an entry, and a match card's hole-by-hole presses — a
 * guest's match is kept from the round code until then.
 */
export const GUEST_ACTIONS = [
  "saveScorecard",
  "saveScorecards",
  "certifyScorecard",
  "disputeScorecard",
  "forgetThisPhone",
  "choosePlayerView",
  "currentPlayStatus",
] as const;

/** What a guest viewer carries: one pass, one entry, one event. Never taken from an argument. */
export interface GuestIdentity {
  passId: string;
  version: number;
  playerId: string;
  eventId: string;
  /** The entry's status when the request began. Writes re-read it (`myPlayerIdsFor`). */
  status: string;
}

/* ───────────────────────── the guest cookie ───────────────────────── */

/** The cookie a tap on /p sets. Never the code; a pass id, its version and when (S6). */
export const GUEST_COOKIE = "ng_guest";
/** Which way a browser holding BOTH a sign-in and a link is looking (S4). */
export const PLAYER_VIEW_COOKIE = "ng_player_view";
/** The server holds a guest cookie to 180 days itself, whatever the browser does (D5, S6). */
export const GUEST_COOKIE_MAX_SECONDS = 180 * 24 * 60 * 60;
const COOKIE_PREFIX = "guest1~";
const CLOCK_SKEW_SECONDS = 5 * 60;

export interface HeldGuest {
  passId: string;
  version: number;
  /** Seconds since the epoch. */
  issuedAt: number;
}

/** The value to sign into `ng_guest` (S6: an exact prefix, so no other cookie's signed value stands in). */
export function guestCookieValue(passId: string, version: number, now: Date): string {
  return `${COOKIE_PREFIX}${passId}:${version}:${Math.floor(now.getTime() / 1000).toString(36)}`;
}

/** A VERIFIED cookie value read back, or null for anything that is not exactly one. */
export function readGuestCookieValue(value: string | null | undefined): HeldGuest | null {
  if (!value || !value.startsWith(COOKIE_PREFIX)) return null;
  const parts = value.slice(COOKIE_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [passId, v, stamp] = parts;
  if (!/^[a-z0-9]{8,40}$/.test(passId)) return null;
  if (!/^[1-9][0-9]{0,8}$/.test(v)) return null;
  if (!/^[0-9a-z]{1,12}$/.test(stamp)) return null;
  const issuedAt = parseInt(stamp, 36);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) return null;
  return { passId, version: Number(v), issuedAt };
}

/** Why a cookie that reads correctly is still not good: older than 180 days, or dated ahead. */
export function guestCookieRefusal(held: HeldGuest, now: Date): "expired" | "not yet" | null {
  const at = Math.floor(now.getTime() / 1000);
  if (held.issuedAt > at + CLOCK_SKEW_SECONDS) return "not yet";
  if (at - held.issuedAt > GUEST_COOKIE_MAX_SECONDS) return "expired";
  return null;
}

/* ───────────────────────── the organizer's panel ───────────────────────── */

/** From this many phones or browsers the panel suggests New link (D6: never a hard cap). */
export const SUGGEST_NEW_LINK_AT = 3;

export interface PassStatus {
  made: boolean;
  revoked: boolean;
  /** Phones or browsers it was opened on — by a tap, never a page load (S1). */
  browsers: number;
  /** When it was last opened, as the club writes a day; "" when never. */
  lastOpened: string;
}

/** The panel's status line (design §4.1). "Phones or browsers": a private window is a new one. */
export function passStatusWords(s: PassStatus): string {
  if (!s.made) return "Not made yet";
  if (s.revoked) return "Turned off. The old link no longer opens.";
  if (s.browsers === 0) return "Not opened yet";
  const where = `Opened on ${s.browsers} ${s.browsers === 1 ? "phone or browser" : "phones or browsers"}`;
  return s.lastOpened ? `${where} · last ${s.lastOpened}` : where;
}

/** Whether the panel suggests New link: at three or more phones or browsers (D6). */
export function suggestsNewLink(s: PassStatus): boolean {
  return s.made && !s.revoked && s.browsers >= SUGGEST_NEW_LINK_AT;
}

/** How the organizer handed it over — each one an audit line, never the code (S7). */
export const HAND_OVERS = ["shown", "read", "copied", "shared"] as const;
export type HandOver = (typeof HAND_OVERS)[number];

export function readHandOver(value: unknown): HandOver | null {
  return typeof value === "string" && (HAND_OVERS as readonly string[]).includes(value) ? (value as HandOver) : null;
}

/** The first word of a name, for the share message: the first name only, no other detail (§4.1). */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * THE SHARE MESSAGE (UX Writer, design §4.1). The first name only; editable in
 * the organizer's own app before they send; TourneyHQ never sends it.
 */
export function playerLinkShareMessage(input: { name: string; eventName: string; link: string; address: string; code: string }): string {
  const first = firstNameOf(input.name);
  const to = first ? `${first}, here is` : "Here is";
  const event = input.eventName.trim() ? ` for ${input.eventName.trim()}` : "";
  return `${to} your player link${event}: tee time, card and board. ${input.link} Or go to ${input.address} and type ${groupedCode(input.code)}. Keep it to yourself.`;
}

/** Every sentence the link says, in one place (UX Writer: never "only", "just", "limited"; never "closed"). */
export const PLAYER_LINK_WORDS = {
  /** /p, before the tap (S1). */
  openHeading: "Your player link",
  openLead: "Your tee time, your card and the board for the event your organizer entered you in. No account and no app needed.",
  openButton: "Open my card",
  typeLabel: "Or type the code from your organizer",
  typeButton: "Open",
  notACode: "That doesn't look like a player link code. It's 12 letters and numbers, like K7QM-2XRA-9DTP.",
  /** Unknown, turned off, rotated, ended or expired: one answer (never confirms a code was real). */
  dead: "This link no longer works. Ask your organizer for a new one.",
  noScript: "This page needs JavaScript to open your link. Turn it on, or ask your organizer to read the code out.",
  /** The organizer's panel. */
  panelButton: "Player link",
  panelTitle: "Player link",
  panelLead: "A Guest (not a club member) needs no email or app: this link opens their tee time, card and board for this event.",
  showQr: "Show QR",
  readOut: "Read it out",
  share: "Share…",
  copyMessage: "Copy message",
  copyLink: "Copy link",
  newLink: "New link",
  turnOff: "Turn off link",
  newLinkConfirm: "Make a new link? The old one stops working on every phone that has it.",
  turnOffConfirm: "Turn off this link? It stops working on every phone. They can still score from the round code.",
  sendToOne: (name: string) => `Send it to ${firstNameOf(name) || "them"} only, not to a group.`,
  suggestNew: "Opened on several phones or browsers. If the link has travelled, press New link.",
  membersHaveEmail: "A member's own way in is their email. Player links are for guests.",
  /** The guest's own screens. */
  otherPhone: (day: string) => `Your link was opened on another phone or browser on ${day}. Not you? Ask the organizer for a new link.`,
  forget: "Forget me on this phone",
  forgotten: "This phone no longer holds your player link.",
  waiting: "Your entry is waiting for the organizer. Your tee time and card open here once you are in the field.",
  /** A browser holding a sign-in AND a link (S4): the two side by side, never merged. */
  viewingAsGuest: (name: string) => `You're looking as ${name}, through a player link.`,
  backToAccount: "Your own account",
  alsoHoldsLink: (name: string) => `This phone also holds a player link for ${name}.`,
  openTheLink: "Open it",
} as const;
