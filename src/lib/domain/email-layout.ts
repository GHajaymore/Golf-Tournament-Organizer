import { EMAIL } from "../themes";

/**
 * WHAT EVERY EMAIL LOOKS LIKE (2026-10-03).
 *
 * Each sender in `email.ts` used to send a few bare paragraphs: no logo, no
 * line saying who sent it or why, no plain-text part. The first thing a new
 * club or player received from TourneyHQ read like a test message. Now every
 * email goes through one layout:
 *
 *   - THE LOGO FIRST, by Ajay's brand rule (2026-09-18): TourneyHQ's lockup,
 *     with the club's name — and its logo, when it has one — beneath it,
 *     smaller. A white-label club with its own logo shows THAT in place of
 *     TourneyHQ's, exactly as its screens do. The lockup is a PNG photographed
 *     from the real one (`public/email/tourneyhq-lockup.png`): Gmail drops SVG.
 *     Every image carries `alt` text, so a client that blocks images still
 *     shows the names.
 *   - a hidden PREVIEW line, which is what the inbox shows beside the subject;
 *   - the body in one readable column, phone first;
 *   - the ACTION as a real button where there is one (reset, sign in, answer),
 *     with its address written underneath for anybody whose client strips it;
 *   - a SIGN-OFF: the tagline, a link home, the privacy policy, and WHY this
 *     person got it — which is what decides whether a message reads as service
 *     or as spam;
 *   - a PLAIN-TEXT twin made from the same parts, so the two cannot disagree.
 *
 * Colours come from `EMAIL` in `themes.ts`: an email client reads no
 * stylesheet, and the brand test allows a hex only where the theme owns it.
 */

/**
 * Text from a person, going into HTML built by concatenation. EVERY value a
 * person typed goes through this; see `email-escapes-what-people-typed.test.ts`
 * for the defect that put it everywhere. Ampersand first, or the escapes escape
 * each other.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Single quotes inside, always: this sits inside `style="…"` attributes, and a
 * double-quoted family name ends the attribute early — the first render of this
 * layout came out in Times with an unbolded heading for exactly that reason.
 */
const FONT = `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/** The photographed lockup, at its CSS size (the file is 2x for sharp phones). */
export const LOCKUP_PATH = "/email/tourneyhq-lockup.png";
const LOCKUP_W = 182;
const LOCKUP_H = 44;

export const TAGLINE = "From Registration to Recognition.";

/** Whose email this is, beyond TourneyHQ's own. All plain text; escaped here. */
export interface EmailBrand {
  clubName?: string;
  /** An ABSOLUTE address for the club's logo, or empty. */
  clubLogoUrl?: string;
  /** A white-label plan: the club's logo replaces TourneyHQ's, as on its screens. */
  whiteLabel?: boolean;
}

export interface EmailParts {
  /** The subject, as plain text. Escaped here for the document title. */
  subject: string;
  /** The message, as HTML the sender has already escaped. */
  bodyHtml: string;
  /** Why this person is receiving it, as HTML the sender has already escaped. */
  whyHtml: string;
  /** The app's own address, e.g. https://tourneyhq.club — images and links need it whole. */
  base: string;
  /** What the inbox shows beside the subject. Plain text; escaped here. */
  preview?: string;
  /** The one thing to do, as a button. Plain text label; the URL is the app's own. */
  action?: { label: string; url: string };
  brand?: EmailBrand;
}

const cell = (style: string, inner: string) => `<tr><td style="${style}">${inner}</td></tr>`;

function header({ base, brand }: Pick<EmailParts, "base" | "brand">): string {
  const club = brand?.clubName?.trim() ?? "";
  const clubLogo = brand?.clubLogoUrl?.trim() ?? "";
  const clubOwnsTheHeader = Boolean(brand?.whiteLabel && clubLogo);

  const lead = clubOwnsTheHeader
    ? `<img src="${escapeHtml(clubLogo)}" alt="${escapeHtml(club || "Club logo")}" height="48" style="display:block;height:48px;width:auto;max-width:240px;border:0">`
    : `<img src="${escapeHtml(base)}${LOCKUP_PATH}" alt="TourneyHQ" width="${LOCKUP_W}" height="${LOCKUP_H}" style="display:block;width:${LOCKUP_W}px;height:${LOCKUP_H}px;border:0">`;

  // The club beneath TourneyHQ, smaller — its logo too when it has one, unless
  // that logo already leads the header.
  const clubLine =
    club && !clubOwnsTheHeader
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>` +
        (clubLogo
          ? `<td style="padding-right:10px;vertical-align:middle"><img src="${escapeHtml(clubLogo)}" alt="" height="28" style="display:block;height:28px;width:auto;max-width:120px;border:0"></td>`
          : "") +
        `<td style="vertical-align:middle;font:600 14px/1.3 ${FONT};color:${EMAIL.text}">${escapeHtml(club)}</td></tr></table>`
      : "";

  return cell(`padding:26px 28px 18px;border-bottom:3px solid ${EMAIL.flag}`, lead + clubLine);
}

function button(action: NonNullable<EmailParts["action"]>): string {
  const url = escapeHtml(action.url);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 10px"><tr>` +
    `<td style="border-radius:8px;background:${EMAIL.buttonBg}">` +
    `<a href="${url}" style="display:inline-block;padding:13px 22px;font:600 15px/1.2 ${FONT};color:${EMAIL.buttonText};text-decoration:none;border-radius:8px">${escapeHtml(action.label)}</a>` +
    `</td></tr></table>` +
    `<p style="margin:0 0 14px;font:13px/1.5 ${FONT};color:${EMAIL.text};word-break:break-all">Or open this address: <a href="${url}" style="color:${EMAIL.text}">${url}</a></p>`
  );
}

function signOff({ whyHtml, base, brand }: Pick<EmailParts, "whyHtml" | "base" | "brand">): string {
  const home = escapeHtml(base);
  const attribution = brand?.whiteLabel && brand.clubLogoUrl ? "" : `<strong>TourneyHQ</strong> &middot; ${TAGLINE}<br>`;
  return (
    `<p style="max-width:560px;margin:18px auto 0;padding:0 16px;font:12.5px/1.6 ${FONT};color:${EMAIL.text};text-align:center">` +
    attribution +
    `${whyHtml}<br>` +
    `<a href="${home}" style="color:${EMAIL.text}">${home.replace(/^https?:\/\//, "")}</a> &middot; ` +
    `<a href="${home}/privacy" style="color:${EMAIL.text}">Privacy</a>` +
    `</p>`
  );
}

/** The whole HTML document for one email. */
export function emailDocument(parts: EmailParts): string {
  const { subject, bodyHtml, preview, action } = parts;
  // The preview line, hidden in the message itself, followed by spacing that
  // stops a client pulling the start of the body in after it.
  const previewHtml = preview
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}${"&nbsp;&zwnj;".repeat(40)}</div>`
    : "";
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(subject)}</title>`,
    `<style>a{color:${EMAIL.text}}p{margin:0 0 14px}</style></head>`,
    `<body style="margin:0;padding:0;background:${EMAIL.bg};color:${EMAIL.text}">`,
    previewHtml,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.bg}">`,
    `<tr><td align="center" style="padding:28px 12px">`,
    // `align` as well as the parent's: Outlook centres a capped table by its own attribute only.
    `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:${EMAIL.surface};border-radius:12px;border:1px solid ${EMAIL.divider}">`,
    header(parts),
    cell(`padding:22px 28px 14px;font:16px/1.6 ${FONT};color:${EMAIL.text}`, bodyHtml + (action ? button(action) : "")),
    `</table>`,
    signOff(parts),
    `</td></tr></table></body></html>`,
  ].join("");
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&middot;": "·",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rsquo;": "’",
  "&nbsp;": " ",
};

/**
 * The plain-text twin.
 *
 * A link keeps its address — "Reset your password (https://…)" — because in a
 * text email the address is the only way to follow it. Entities are decoded
 * LAST, so text a person typed that was escaped to `&lt;b&gt;` comes out as the
 * characters they typed, never re-read as markup.
 */
export function emailText(parts: Pick<EmailParts, "bodyHtml" | "whyHtml" | "action" | "brand">): string {
  const flatten = (html: string) =>
    html
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
        const words = label.replace(/<[^>]+>/g, "").trim();
        return words && words !== href ? `${words} (${href})` : href;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|blockquote|div|li)>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e] ?? e)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const club = parts.brand?.clubName?.trim();
  const head = parts.brand?.whiteLabel && parts.brand.clubLogoUrl && club ? club : club ? `TourneyHQ — ${club}` : "TourneyHQ";
  const action = parts.action ? `\n\n${parts.action.label}: ${parts.action.url}` : "";
  return `${head}\n\n${flatten(parts.bodyHtml)}${action}\n\n--\n${flatten(parts.whyHtml)}\n`;
}
