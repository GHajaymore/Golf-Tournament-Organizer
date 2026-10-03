import { LIGHT_GROUND } from "../themes";

/**
 * WHAT EVERY EMAIL LOOKS LIKE (2026-10-03).
 *
 * Each sender in `email.ts` sent a few bare paragraphs: no name at the top, no
 * line saying who sent it or why, and no plain-text part. The first thing a
 * new club or player received from TourneyHQ looked like a test message, and
 * a missing text part is one of the things mail filters count against a
 * sender. So every email now goes through one layout:
 *
 *   - the product's name at the top, as text — no remote image, which most
 *     clients block by default and which would be a tracker in all but name;
 *   - the body in a single readable column, built for a phone first;
 *   - a footer saying WHY this person got it, which is what decides whether a
 *     message is read as service or as spam;
 *   - a plain-text twin, made from the same body so the two cannot say
 *     different things.
 *
 * Colours are the light ground's own (`themes.ts`), never typed here: email
 * clients cannot read the app's CSS variables, and the brand test forbids a
 * hex anywhere that does not own one. Light, always — a dark email in a light
 * inbox reads as a warning.
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

export interface EmailParts {
  /** The subject, as plain text. Escaped here for the document title. */
  subject: string;
  /** The message, as HTML the sender has already escaped. */
  bodyHtml: string;
  /** Why this person is receiving it, as HTML the sender has already escaped. */
  whyHtml: string;
}

/** The whole HTML document for one email. */
export function emailDocument({ subject, bodyHtml, whyHtml }: EmailParts): string {
  const { bg, surface, text } = LIGHT_GROUND;
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(subject)}</title>`,
    `<style>a{color:${text};text-decoration:underline}p{margin:0 0 14px}</style></head>`,
    `<body style="margin:0;padding:0;background:${bg};color:${text}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg}">`,
    `<tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${surface};border-radius:12px">`,
    `<tr><td style="padding:22px 24px 6px;font:700 18px/1.2 ${FONT};color:${text}">TourneyHQ</td></tr>`,
    `<tr><td style="padding:10px 24px 12px;font:16px/1.55 ${FONT};color:${text}">${bodyHtml}</td></tr>`,
    `</table>`,
    `<p style="max-width:560px;margin:16px auto 0;padding:0 12px;font:13px/1.5 ${FONT};color:${text}">${whyHtml}</p>`,
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
 * The plain-text twin of a body and its footer.
 *
 * A link keeps its address — "Reset your password (https://…)" — because in a
 * text email the address is the only way to follow it. Entities are decoded
 * LAST, so text a person typed that was escaped to `&lt;b&gt;` comes out as the
 * characters they typed, never re-read as markup.
 */
export function emailText({ bodyHtml, whyHtml }: Pick<EmailParts, "bodyHtml" | "whyHtml">): string {
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
  return `TourneyHQ\n\n${flatten(bodyHtml)}\n\n--\n${flatten(whyHtml)}\n`;
}
