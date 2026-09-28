import { countryCode } from "./country";
import { directoryIdFrom } from "./course-directory";

/**
 * WHAT A COURSE'S DISTANCES ARE MEASURED IN.
 *
 * Every card in the app was labelled "Yards", and nothing recorded a unit. The
 * app serves Australia and New Zealand, continental Europe, Korea and China,
 * where cards are printed in metres — so a German club typing its own card read
 * its 150 back as 150 yards (walked 2026-09-28; Ajay's decision 15).
 *
 * The unit belongs to the COURSE, not the club: a Scottish society touring
 * France plays a card in metres, and a card is published in one unit. The
 * numbers are stored exactly as entered and NEVER converted — a converted 150 m
 * reads "164", which is on no card anywhere, and a card edited after a
 * conversion drifts every time it is saved.
 *
 * Nothing scores off distance (strokes come from the stroke index, handicaps
 * from rating, slope and par), so this is a label and never a result.
 */
export type DistanceUnit = "yards" | "metres";

export const DISTANCE_UNITS: readonly DistanceUnit[] = ["yards", "metres"];

export function isDistanceUnit(v: unknown): v is DistanceUnit {
  return typeof v === "string" && (DISTANCE_UNITS as readonly string[]).includes(v);
}

/**
 * Where golf courses are measured in metres. Everywhere else — the US, Great
 * Britain, Ireland, Canada, Japan, India — measures in yards, and so does a
 * club that has not said where it is. Ireland is deliberately yards: its cards
 * are mixed, and the course's own switch is the answer for the ones in metres.
 */
const METRIC_COUNTRIES = new Set([
  "AU", "NZ", "ZA",
  "AT", "BE", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GR", "HR", "IS", "IT",
  "LU", "NL", "NO", "PL", "PT", "SE", "SI", "SK",
  "KR", "CN",
]);

/**
 * The unit a course's card is in.
 *
 *  1. what the course says, when somebody has set it;
 *  2. otherwise YARDS for a card from the course directory, whose source
 *     measures in yards wherever the course is;
 *  3. otherwise the club's country — a card a club typed or pasted is in the
 *     unit its members use.
 *
 * Empty is a real stored value and means "not set", so existing courses need no
 * rewriting and an unrecognised value falls through rather than throwing.
 */
export function resolveDistanceUnit(input: {
  stored?: string | null;
  sourceUrl?: string | null;
  country?: string | null;
}): DistanceUnit {
  const stored = (input.stored ?? "").trim().toLowerCase();
  if (isDistanceUnit(stored)) return stored;
  if (directoryIdFrom(input.sourceUrl ?? "")) return "yards";
  return clubDistanceUnit(input.country);
}

/** The unit a club measures in when a course has not said — its country's. */
export function clubDistanceUnit(country?: string | null): DistanceUnit {
  return METRIC_COUNTRIES.has(countryCode(country ?? "")) ? "metres" : "yards";
}

/** How a card labels its distances: a row heading and a short suffix. */
export function distanceWords(unit: DistanceUnit): { row: string; short: string; noun: string } {
  return unit === "metres"
    ? { row: "Metres", short: "m", noun: "metres" }
    : { row: "Yards", short: "yds", noun: "yards" };
}
