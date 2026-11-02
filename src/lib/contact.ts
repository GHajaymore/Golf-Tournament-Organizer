/**
 * THE ADDRESSES TOURNEYHQ ANSWERS, in the one place they are written (2026-10-11).
 *
 * Until this day no @tourneyhq.club address received mail, so the app named
 * none: the landing hid its contact line, a forgotten password had nobody to
 * write to, and a push subscription named an address that bounced. Ajay set up
 * five and confirmed a test message arrived. Each has one job:
 *
 *   support    somebody using the app who is stuck — named wherever the app
 *              has to say "we could not do that for you"
 *   contact    the front door's general address
 *   inquiries  several clubs, a corporate programme, pricing questions
 *   admin      the operator's own; what a push service is told to write to
 *
 * SENDING is a different matter and a different domain: mail goes out from
 * `send.tourneyhq.club` through the provider (`RESEND_FROM_EMAIL`), and every
 * message carries SUPPORT_EMAIL as its reply-to, because the sending address
 * reads nothing.
 *
 * Plain constants with no imports, so a client component may read them.
 */
export const SUPPORT_EMAIL = "support@tourneyhq.club";
export const CONTACT_EMAIL = "contact@tourneyhq.club";
export const SALES_EMAIL = "inquiries@tourneyhq.club";
export const ADMIN_EMAIL = "admin@tourneyhq.club";

/**
 * TOURNEYHQ'S OWN SOCIAL ACCOUNTS (2026-10-30), offered as "Follow us" on the
 * early list's thank-you. LinkedIn and YouTube join when their addresses are
 * confirmed; X when it exists.
 */
export const SOCIAL_LINKS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Facebook", url: "https://www.facebook.com/TourneyHQ" },
  { name: "Instagram", url: "https://www.instagram.com/tourneyhq" },
];

/**
 * EVERY CHANNEL, WITH WHAT IS ON IT (2026-11-01, Ajay: "make sure to add social element since we
 * have accounts"), for the site rehaul's "Follow along" and its footer. Each address was opened on
 * 1 Nov and named TourneyHQ (Instagram and LinkedIn also carry its own bio, "Registration to
 * recognition for golf leagues, outings and clubs"). X has no account yet: its row is here with no
 * address so the place exists, and `socialChannels()` leaves out any row without one.
 */
export type SocialKey = "instagram" | "youtube" | "facebook" | "linkedin" | "x";
export const SOCIAL_CHANNELS: ReadonlyArray<{ key: SocialKey; name: string; url: string; handle: string; what: string }> = [
  { key: "instagram", name: "Instagram", url: "https://www.instagram.com/tourneyhq", handle: "@tourneyhq", what: "Pictures and short clips of the app at work: the board, the card, the prize table." },
  { key: "youtube", name: "YouTube", url: "https://www.youtube.com/@tourneyhq", handle: "@tourneyhq", what: "Videos of the app at work, from setting up an event to a round on a player's phone." },
  { key: "facebook", name: "Facebook", url: "https://www.facebook.com/TourneyHQ", handle: "TourneyHQ", what: "News for organizers, and updates as launch comes closer." },
  { key: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com/company/tourneyhq", handle: "TourneyHQ", what: "TourneyHQ the company, for clubs and golf businesses." },
  { key: "x", name: "X", url: "", handle: "", what: "" },
];

/** The channels with an address, in the order above. */
export function socialChannels(): Array<(typeof SOCIAL_CHANNELS)[number]> {
  return SOCIAL_CHANNELS.filter((c) => c.url !== "");
}
