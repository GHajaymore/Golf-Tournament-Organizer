/**
 * Whose name goes at the top of a scorecard.
 *
 * A scorecard is the COURSE's card. The club's mark went at the head of it,
 * which is right for a club playing its own course and wrong everywhere else:
 * a society's outing at Pebble Beach came out headed "Demo Golf Club" above
 * Pebble Beach's holes, which reads as though the society owns the course. On
 * paper that card says Pebble Beach, and the society appears as who is running
 * the day.
 *
 * So the venue leads, and the club is named beneath it — except where the
 * venue IS the club's own course, where the club's mark alone is not a claim
 * but simply true.
 *
 * One rule, resolved once. The player's card, the organizer's card and the
 * printed cards all read this, so a card checked on a phone and the same card
 * on the console cannot disagree about whose it is.
 */

import { normalizeCourseName } from "./venue";

export interface CardHeading {
  /** The line that leads — the course, or the club at its own course. */
  primary: string;
  /** Underneath: who is running the day, or the club's second name. */
  secondary: string;
  /** The club's logo. There are no course logos to have. */
  logoUrl: string;
  /**
   * Whether `primary` is the course rather than the club.
   *
   * The renderer needs it: when the course leads, the club's logo belongs
   * beside the club's name on the second line, not beside the course's — a
   * mark next to a course name reads as that course's mark.
   */
  leadIsCourse: boolean;
}

/**
 * The identifying part of a name of a place.
 *
 * `normalizeCourseName` drops "club", "course" and "links" but keeps "golf",
 * so "Bushwood" and "Bushwood Golf Club" do not converge — and a club calling
 * its organization one and its venue the other is the ordinary case, not an
 * edge one. The club-type abbreviations go too, so "Bushwood GC" lands in the
 * same place.
 *
 * Built on `normalizeCourseName` rather than beside it: that is already the
 * app's reader for "are these the same place", used to match a typed venue
 * against the library, and a second independent one would drift.
 */
const placeKey = (raw: string): string =>
  normalizeCourseName(raw)
    .replace(/\b(golf|gc|cc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The heading, or null for a card that should carry no branding at all.
 *
 * Null rather than a TourneyHQ fallback: an unbranded card should look like
 * plain paper, not like it belongs to us.
 */
export function cardHeading(input: {
  /** The course this round is played on. Empty when unknown. */
  courseName?: string;
  /** The organizing club's name. Empty when the club has set none. */
  clubName?: string;
  /** The club's second line, where it asked for both names. */
  clubSecondary?: string;
  clubLogoUrl?: string;
  /** Whether the venue is the club's own course. */
  venueIsHome?: boolean;
}): CardHeading | null {
  const course = (input.courseName ?? "").trim();
  const club = (input.clubName ?? "").trim();
  const logoUrl = (input.clubLogoUrl ?? "").trim();

  if (!course && !club) return null;

  /**
   * The club and the course being the same thing, said twice.
   *
   * Clubs enter their own course under their own name, and often not
   * identically — "Bushwood" the organization against "Bushwood Golf Club" the
   * venue. Heading the card with both would print the same name twice, and
   * `venueIsHome` does not catch it: a club that never set a home course still
   * plays its own course.
   *
   * `normalizeCourseName` is the app's existing reader for "are these two the
   * same place", already used to match a typed venue against the library, so
   * this cannot disagree with that.
   */
  const sameName = !!course && !!club && placeKey(course) === placeKey(club);

  // The club's own course, or no course to name: the club's mark alone. Not a
  // claim over somebody else's venue — it is their card.
  if (!course || input.venueIsHome || sameName) {
    if (!club) return { primary: course, secondary: "", logoUrl: "", leadIsCourse: true };
    return {
      primary: club,
      secondary: (input.clubSecondary ?? "").trim(),
      logoUrl,
      leadIsCourse: false,
    };
  }

  // Somebody else's course. It leads; the club is who is running the day.
  return { primary: course, secondary: club, logoUrl, leadIsCourse: true };
}
