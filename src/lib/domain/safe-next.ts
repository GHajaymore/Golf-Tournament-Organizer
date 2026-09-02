/**
 * Where it is safe to send somebody after they sign in.
 *
 * An organizer texts a player a link to the tee sheet. They are not signed in,
 * so they land on the marketing page, sign in, and arrive at `/me` — not the
 * tee sheet. On a phone, at a course, that is usually where you lose them. The
 * fix is to remember the destination across the sign-in, and this decides which
 * destinations may be remembered.
 *
 * IT IS A SECURITY BOUNDARY, not a formatting helper. A "where should I go
 * next" parameter that accepts anything is an OPEN REDIRECT: an attacker sends
 * `https://tourneyhq.club/?next=https://evil.example/login`, the victim sees a
 * genuine domain in the link they were sent, signs in, and is bounced to a copy
 * of the login page that harvests whatever they type next. The link looked
 * right because it WAS right, up to the redirect.
 *
 * So this allows exactly one shape: a path on this site. Everything else is
 * refused, and a refusal is not an error — the caller falls back to the normal
 * landing screen, which is where somebody would have gone anyway.
 *
 * ## What it must not be fooled by
 *
 * Each of these defeats a naive `startsWith("/")` check, and each has its own
 * test:
 *
 *     //evil.example/x       protocol-relative — a browser reads this as a HOST
 *     /\evil.example/x       backslash, which several browsers normalise to /
 *     /<tab>/evil.example    control characters that get stripped on parse
 *     https://evil.example   absolute, obviously
 *     javascript:alert(1)    a scheme with no slashes at all
 *
 * ## What it deliberately does not check
 *
 * Whether the person is ALLOWED there. `next` is a preference, not an
 * authorisation: a player who follows one to `/dashboard` still meets
 * `requireScreen`, which bounces them to `/me` exactly as if they had typed the
 * URL. Deciding permissions here too would put one rule in two places, and the
 * other one is the one that counts.
 */

/** Paths that would send somebody straight back where they came from. */
const POINTLESS = new Set(["/", "/choose"]);

/** An origin that cannot exist, used only to detect a change of origin. */
const PROBE_ORIGIN = "https://tourneyhq.invalid";

/**
 * Whether every character is one a path may legitimately contain.
 *
 * An explicit code-point test rather than a character class, on purpose. The
 * first version of this was `/[ -\s\\]/`, which reads as a range from space to
 * the whitespace class and is ambiguous enough to be read instead as the
 * literal set {space, hyphen, whitespace, backslash} — and a rule that refused
 * every hyphenated path would break the share links this whole feature exists
 * to preserve. A guard nobody can read at a glance is a guard nobody can be
 * sure of, so this one is written to be obvious.
 *
 * Refusing rather than stripping is also deliberate. A tab inside a URL exists
 * precisely to be removed by one parser and kept by another; "tidy it up and
 * carry on" is the disagreement being exploited.
 */
function isPlainPathText(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    // Control characters, space, DEL, and the backslash browsers fold to "/".
    if (code <= 0x20 || code === 0x7f || ch === "\\") return false;
  }
  return true;
}

/**
 * The destination to use after sign-in, or null to use the normal landing.
 *
 * Null rather than a default, because "normal" differs by role and this module
 * has no business knowing that.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (!value) return null;
  if (!isPlainPathText(value)) return null;

  // Must be a path on this site.
  if (!value.startsWith("/")) return null;

  // `//host` is protocol-relative — it leaves this origin while looking like a
  // path. (`/\host` is already gone, since backslashes are refused above.)
  if (value.startsWith("//")) return null;

  /**
   * Parsed as a second opinion.
   *
   * The checks above are the ones that matter; this catches anything that still
   * changes origin once a real URL parser has had its way with it. Where they
   * disagree the parser wins, because it is what the browser will actually use.
   */
  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PROBE_ORIGIN) return null;

  // Sending somebody to the page they just left is not a destination.
  if (POINTLESS.has(parsed.pathname)) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Build the sign-in URL that remembers where somebody was going.
 *
 * Kept beside the validator so the two halves cannot drift: whatever is encoded
 * here is what `safeNextPath` is later asked to approve.
 */
export function signInUrlFor(pathname: string, search = ""): string {
  const target = safeNextPath(`${pathname}${search}`);
  return target ? `/?next=${encodeURIComponent(target)}` : "/";
}
