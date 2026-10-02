/**
 * WHAT AN ERROR REPORT MAY CARRY OFF THE PREMISES (2026-10-02).
 *
 * Server errors go to Sentry when `SENTRY_DSN` is set (`src/instrumentation.ts`).
 * A report is built from the request that failed, and in this app a request can
 * carry a CREDENTIAL in its address:
 *
 *   /live/<shareToken>              the public board, opened by anyone holding it
 *   /register/<token>               a tournament's entry form
 *   /reset-password?token=<token>   a password reset
 *
 * So a report naming the page that failed hands that credential to a third
 * party's dashboard, for as long as it keeps the report. The same goes for an
 * email address, which is how most of the people in this app are identified
 * and which the privacy policy says is shared with nobody for this.
 *
 * Hence one pure function every report passes through before it leaves, which
 * rewrites EVERY string in it rather than the fields one remembers to name.
 * A Sentry event carries the URL in at least five places — request.url, the
 * transaction name, a breadcrumb, the exception message, a stack frame's
 * context — and a scrubber that lists fields misses the sixth.
 *
 * Kept pure and dependency-free so it is provable on its own; the SDK is only
 * ever loaded when error reporting is switched on.
 */

const REDACTED = "[redacted]";

/** A path segment that follows one of these is a credential. */
const TOKEN_ROUTES = ["live", "register"];

/** Query parameters whose value is a credential. */
const TOKEN_PARAMS = ["token", "code", "accessCode", "shareToken"];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Request fields dropped outright: they are nothing BUT credentials or identity. */
const DROPPED_KEYS = new Set(["cookies", "cookie", "authorization", "ip_address", "set-cookie"]);

/** One string, with every credential and email address in it replaced. */
export function scrubText(text: string): string {
  let out = text;
  for (const route of TOKEN_ROUTES) {
    out = out.split(`/${route}/`).map((part, i) => {
      if (i === 0) return part;
      // Everything up to the next separator is the token.
      const end = part.search(/[/?#\s"')]|$/);
      return REDACTED + part.slice(end);
    }).join(`/${route}/`);
  }
  for (const param of TOKEN_PARAMS) {
    out = out.replace(new RegExp(`([?&]${param}=)[^&#\\s"')]*`, "g"), `$1${REDACTED}`);
  }
  return out.replace(EMAIL, REDACTED);
}

/**
 * The whole report, scrubbed. Walks every value, rewrites every string, and
 * drops the keys that are only ever a credential or an identity. Returns a new
 * object; the original is not touched.
 */
export function scrubReport<T>(report: T): T {
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return scrubText(value);
    // Deep enough for any real event; a cycle or a monster stops here.
    if (depth > 12 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (DROPPED_KEYS.has(key.toLowerCase())) continue;
      out[key] = walk(v, depth + 1);
    }
    return out;
  };
  return walk(report, 0) as T;
}
