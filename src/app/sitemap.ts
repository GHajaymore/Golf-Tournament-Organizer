import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * The pages worth finding, which is a short list on purpose.
 *
 * A sitemap is an invitation, and the only two pages this app WANTS indexed are
 * the landing page and the privacy policy. Every other public route is
 * credentialed by a token in its URL — listing one would publish the credential
 * in a file whose whole job is to be read by strangers.
 *
 * Deliberately NOT generated from the filesystem, unlike the layout sweep in
 * `e2e/layout.spec.ts`. That sweep exists because a route missing from a
 * hand-written list goes UNTESTED, which is a silent gap. Here the risk runs
 * the other way: a route missing from this list is merely unlisted, while a
 * route wrongly added is a leak. When the safe failure is omission, a hand list
 * is the right shape.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl("/"),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      // Every question the product answers, from the same module as the
      // landing's eight (added 2026-09-27).
      url: siteUrl("/faq"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: siteUrl("/privacy"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
