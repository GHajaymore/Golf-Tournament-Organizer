/**
 * Where this app lives, as an absolute origin.
 *
 * Nothing in the web app knew its own URL. `tourneyhq.club` appeared in exactly
 * one file — `capacitor.config.ts`, so the mobile shells could load it — and
 * the web build had no way to say it. That is why there was no `metadataBase`,
 * and without one every Open Graph image and canonical URL Next generates is
 * relative, which share cards and search engines cannot use.
 *
 * Resolved rather than hard-coded, in this order:
 *
 *   1. `NEXT_PUBLIC_SITE_URL`, for anyone self-hosting under their own domain,
 *      and for a staging origin that must not claim to be production.
 *   2. `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every deployment
 *      to the project's own production hostname.
 *   3. The production domain, which is the answer for this project.
 *
 * NOT `VERCEL_URL`: that is the per-DEPLOYMENT hostname, unique to each push.
 * Using it would give every preview build its own canonical URL and invite a
 * crawler to index a throwaway deployment as though it were the site. Previews
 * are kept out of the index by `robots.ts` instead.
 */
const FALLBACK_ORIGIN = "https://tourneyhq.club";

/** Trailing slashes and an accidental path both break URL joining. */
function normalise(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    // A malformed value must not take the build down, and must not silently
    // become a relative URL either — the fallback is a real origin.
    return null;
  }
}

export function siteOrigin(): string {
  return (
    normalise(process.env.NEXT_PUBLIC_SITE_URL ?? "") ??
    normalise(process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "") ??
    FALLBACK_ORIGIN
  );
}

export function siteUrl(path = "/"): string {
  return new URL(path, siteOrigin()).toString();
}

/**
 * Whether this deployment is the real site.
 *
 * A preview build serves the same pages on a different hostname. If it invites
 * indexing, a search engine can rank a half-finished branch above production
 * and — worse here — index a `/live` board that was only ever meant to be
 * reachable by its share token.
 */
export function isProductionSite(): boolean {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return false;
  return true;
}

/**
 * "Do not index this page", written once so every private route says it the
 * same way.
 *
 * Paired with `robots.ts` rather than replacing it, because the two stop
 * different things. robots.txt asks a crawler not to FETCH a path; this tells
 * one that fetched anyway — because somebody linked to the page from outside —
 * not to KEEP it. A Disallowed URL can still be indexed from an external link,
 * with the listing built from the anchor text alone, so a board's URL and the
 * words somebody wrapped it in can enter an index without the page ever being
 * crawled. Only the meta tag closes that, and it can only be seen if the page
 * IS fetched. They are complements, and neither is redundant.
 *
 * `nocache` and the Google-specific pair keep it out of cached copies and
 * snippets, which is the part that would otherwise outlive a deleted event.
 */
export const NOINDEX = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false, noimageindex: true },
} as const;
