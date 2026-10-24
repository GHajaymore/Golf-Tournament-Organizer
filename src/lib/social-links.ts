/**
 * TOURNEYHQ'S OWN SOCIAL PROFILES, in the one place their addresses are written
 * (Ajay, 2026-10-23: link the new Facebook Page on the website).
 *
 * Every surface that links one reads `SOCIAL_LINKS` (or `socialLink(id)`) and
 * never writes the address again, so a renamed page is changed here and
 * nowhere else. `social-links-written-once.test.ts` sweeps `src` for any of
 * these addresses outside this file.
 *
 * To add a network: give it a line in `SocialId` and a line in `SOCIAL_LINKS`.
 * The website footer draws every entry in this list, so a new line appears
 * there without anybody touching the footer — check it at 393px, since the
 * footer's base row wraps on a phone.
 *
 * `icon` names a symbol in the landing's sprite (`iconSprite()` in
 * `components/landing/chrome.tsx`, drawn as `#i-<icon>`); a new network needs
 * its symbol there too.
 *
 * Plain constants with no imports, so a client component may read them.
 */

export type SocialId = "facebook";
// Later, one line each: | "instagram" | "youtube" | "linkedin" | "tiktok" | "x"

export interface SocialLink {
  id: SocialId;
  /** The network's own name, as the visitor knows it — the link's words. */
  label: string;
  /** The profile's address. */
  href: string;
  /** The sprite symbol drawn beside the label. */
  icon: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { id: "facebook", label: "Facebook", href: "https://www.facebook.com/TourneyHQ", icon: "facebook" },
];

/** One profile, by id. */
export function socialLink(id: SocialId): SocialLink {
  const found = SOCIAL_LINKS.find((s) => s.id === id);
  if (!found) throw new Error(`No social link "${id}"`);
  return found;
}
