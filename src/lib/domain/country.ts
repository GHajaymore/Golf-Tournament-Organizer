/**
 * One country vocabulary for the whole app: ISO 3166-1 alpha-2.
 *
 * This lived inside `course-directory.ts`, where it was written for the
 * catalogue's problem — two providers with two habits, `country_iso` from one
 * and the country's NAME from the other, so the same country accumulated twice
 * (187 rows of "GB" beside 10 of "United Kingdom", "KR" beside "Republic of
 * Korea").
 *
 * It is here now because a SECOND caller needs it and the first one is heavy.
 * `org-profile.ts` had zero imports; pulling in the course directory to reach
 * this one function would have dragged `venue`, `scorecard-parse` and
 * `handicap` behind it into a module twenty-three screens depend on. The map
 * is not about courses — it is about countries — so it moves rather than being
 * copied. `course-directory.ts` re-exports it, so nothing that already imports
 * it from there has to change.
 *
 * ONLY NAMES ACTUALLY OBSERVED are mapped, and anything unrecognised comes
 * back UNCHANGED rather than guessed at. That is deliberate and worth keeping
 * whichever caller is asking: a wrong two-letter code is a course filed under
 * the wrong country and invisible once written, while an unmapped long name is
 * merely untidy and shows up the moment somebody looks. The failure mode is
 * the loud one on purpose.
 */

const ISO_BY_NAME: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "united kingdom": "GB",
  canada: "CA",
  australia: "AU",
  ireland: "IE",
  "republic of korea": "KR",
  "costa rica": "CR",
  "dominican republic": "DO",
  "papua new guinea": "PG",
  "brunei darussalam": "BN",
  "sri lanka": "LK",
  "taiwan (province of china)": "TW",
  serbia: "RS",
};

/**
 * A country code from whatever it was written as.
 *
 * Blank stays blank — "Unknown" is a real value GolfCourseAPI returns, and
 * `Organization.country` is free text defaulting to `""`, so an empty answer
 * is the common case rather than an error.
 */
export function countryCode(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v || v.toLowerCase() === "unknown") return "";
  if (v.length === 2) return v.toUpperCase();
  return ISO_BY_NAME[v.toLowerCase()] ?? v;
}
