import type { MetadataRoute } from "next";
import { siteUrl, isProductionSite } from "@/lib/site";

/**
 * What a crawler may look at.
 *
 * There was no robots.txt and no `noindex` anywhere in the app, and the surface
 * that matters is not the marketing page — it is `/live/<token>`, which by
 * design "shows names, positions and scores" of real club members.
 *
 * The share token is unguessable, so this is not a hole a crawler can find on
 * its own. It is a hole a crawler is HANDED: a board link posted on a club's
 * website, in a public forum, or in a WhatsApp group with a link preview
 * service in it. Once fetched, nothing in the response asked a search engine
 * not to keep it, and a member's name and score could sit in a public index
 * indefinitely — which is the outcome this repo's rule about player data exists
 * to prevent.
 *
 * So the rule is the conservative one: the only things crawlable are the two
 * pages that are genuinely marketing. Everything else is either credentialed
 * (`/live`, `/register`, `/reset-password`, `/play`) or behind a session, and
 * none of it benefits from being in an index.
 *
 * This is belt to the braces of the per-page `robots: { index: false }` in each
 * of those routes. robots.txt asks a crawler not to FETCH; the meta tag tells
 * one that fetched anyway not to KEEP. A page reached from an external link can
 * be indexed despite a Disallow, so both are needed and neither is redundant.
 */
export default function robots(): MetadataRoute.Robots {
  // A preview deployment serves the same pages on another hostname. Letting it
  // be indexed would rank a branch above production and, worse here, expose a
  // board that was only ever meant to be reachable by its token.
  if (!isProductionSite()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy"],
        disallow: [
          // Credentialed by a token in the URL. Each of these renders real
          // people, an event's details, or a password-reset credential.
          "/live/",
          "/register/",
          "/reset-password",
          "/play",
          // Behind a session. Nothing here is reachable to a crawler anyway;
          // saying so keeps the list honest about what the app contains.
          "/dashboard",
          "/me/",
          "/choose",
          "/api/",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl("/"),
  };
}
