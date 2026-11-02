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
