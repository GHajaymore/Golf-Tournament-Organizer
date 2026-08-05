import "server-only";

/**
 * Check that a logo URL actually serves an image, from the server.
 *
 * This exists to catch the failure mode an organizer can never see: they copy
 * a URL from their own club website while logged into it, the preview renders
 * because their browser has the session cookie and the right referer, they
 * save — and the logo is broken for every player, every printed scorecard and
 * the public leaderboard.
 *
 * Fetching server-side has no cookies and no referer, so it fails in the same
 * way a stranger's browser would. That is the whole point of doing it here
 * rather than in the preview.
 */

/** Give up quickly — an organizer is waiting on a save. */
const TIMEOUT_MS = 5000;
/** Redirects are normal for CDNs, but a chain is a good way to smuggle a
 *  request somewhere it shouldn't go, so allow a couple and re-check each. */
const MAX_REDIRECTS = 2;
const MAX_BYTES = 5 * 1024 * 1024;

export interface LogoCheck {
  /** False only for definite failures — a real answer that wasn't an image. */
  ok: boolean;
  /** Safe to show the organizer. */
  error?: string;
  /** Set when the URL couldn't be checked rather than definitely being wrong.
   *  The save is allowed; the organizer is told it may not load for players. */
  warning?: string;
}

/**
 * Hosts a logo must never point at.
 *
 * This endpoint takes a URL from a user and fetches it from inside our
 * network, which is the textbook shape of an SSRF vector: without this, a
 * "logo URL" of http://169.254.169.254/... turns the branding form into a
 * reader for cloud instance metadata.
 *
 * Blocking IP literals outright is blunt but right for this field — clubs
 * point at a domain, never at a raw address — and it removes the direct path
 * without needing DNS resolution and rebinding defences.
 */
export function blockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  // Cloud metadata services, by name as well as by address.
  if (h === "metadata.google.internal" || h === "metadata") return true;

  // Any IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // Any IPv6 literal (contains a colon; a hostname never does).
  if (h.includes(":")) return true;

  return false;
}

export function problemWithUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full image URL, starting with https://";
  }
  if (url.protocol !== "https:") return "Logo URL must start with https://";
  if (blockedHost(url.hostname)) return "That address isn't allowed. Use your club's public website address.";
  return null;
}

/**
 * Fetch the URL and confirm it's an image.
 *
 * Sends browser-ish headers because some CDNs reject unknown clients, and a
 * false rejection here would block a perfectly good logo.
 */
export async function checkLogoUrl(raw: string): Promise<LogoCheck> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true }; // Clearing the logo is always fine.

  const urlProblem = problemWithUrl(trimmed);
  if (urlProblem) return { ok: false, error: urlProblem };

  let target = trimmed;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // No cookies are sent (server-side fetch has no jar), which is
          // exactly the condition we're testing for.
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; TourneyHQ/1.0; +logo-check)",
        },
      });
    } catch {
      // DNS failure, TLS problem, timeout, or the host refusing us
      // specifically. We can't tell "broken" from "blocks our server but
      // serves browsers fine", so don't block the save over it.
      return {
        ok: true,
        warning:
          "We couldn't load that image from our server. Save it if you're sure, but check it appears for someone not signed in to your website.",
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, error: "That URL redirects somewhere we can't follow." };
      // Re-run every check on the new target — a redirect is a fresh URL, not
      // a trusted continuation of the old one.
      const next = new URL(location, target).toString();
      const nextProblem = problemWithUrl(next);
      if (nextProblem) return { ok: false, error: nextProblem };
      target = next;
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error:
          "That image is private — it loads for you but not for anyone else. Use a URL that works when you're signed out.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: `That URL returned an error (${res.status}). Check the address.` };
    }

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("image/")) {
      return {
        ok: false,
        error:
          "That URL points at a page, not an image file. Right-click the logo on your site and copy the image address.",
      };
    }

    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      return { ok: false, error: "That image is very large. Use one under 5 MB so pages stay quick to load." };
    }

    return { ok: true };
  }

  return { ok: false, error: "That URL redirects too many times." };
}
