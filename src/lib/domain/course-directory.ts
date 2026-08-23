import { cardProblems } from "./venue";
import { implausibleCard } from "./scorecard-parse";

/**
 * Reading a course card out of a public course directory.
 *
 * Everything here is pure: it takes whatever JSON a directory returned and
 * turns it into either a card this app can score with, or a refusal that says
 * why not. The network lives in `services/course-directory.ts`, so the
 * judgement about what is trustworthy can be tested against real payloads
 * without a live host.
 *
 * The judgement is the whole point. A directory of ~17,000 courses assembled
 * from community mapping is right most of the time and confidently wrong the
 * rest, and the two look identical in JSON. `Course.source` already models
 * that — an imported card is usable but flagged until a human confirms it —
 * and this decides what is worth flagging versus what should not be imported
 * at all.
 */

/**
 * ODbL 1.0 permits commercial use WITH attribution, so this is a licence
 * obligation rather than a courtesy. It has to appear on screen wherever an
 * imported course is shown, which is why it is a constant here and not a
 * string typed into one component.
 */
export const DIRECTORY_ATTRIBUTION =
  "© OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI";

/**
 * Where an imported course came from, stored so it can be re-checked later.
 *
 * `Course.sourceUrl` already exists for exactly this — "where an imported card
 * came from, so it can be re-checked". Keeping the directory's id inside that
 * URL means re-checking needs no new column and no second flag: a course with
 * a directory URL can be re-checked and one without cannot, which is the truth
 * rather than a stored opinion about it.
 *
 * Here rather than in the action because the screen has to make the same call
 * — whether to offer the button at all — and two copies of a prefix is how the
 * button appears on a course the server will then refuse.
 */
const DIRECTORY_URL = "https://api.opengolfapi.org/api/v1/courses/";

export const directorySourceUrl = (id: string): string => `${DIRECTORY_URL}${encodeURIComponent(id)}`;

export const directoryIdFrom = (sourceUrl: string): string =>
  sourceUrl.startsWith(DIRECTORY_URL)
    ? decodeURIComponent(sourceUrl.slice(DIRECTORY_URL.length)).trim()
    : "";

/** Whether this course can be re-checked against the directory it came from. */
export const isDirectorySource = (sourceUrl: string): boolean => directoryIdFrom(sourceUrl) !== "";

/** A course as the search list shows it — enough to pick the right one. */
export interface DirectoryHit {
  id: string;
  name: string;
  city: string;
  state: string;
  /** ISO 3166-1 alpha-2. Empty where the directory does not say. */
  country: string;
  /** The course's nominal par, shown so a picker can tell two courses apart. */
  par: number;
  website: string;
}

/** A rated set of tees, which is the part free sources usually omit. */
export interface DirectoryTee {
  name: string;
  /** any | men | women, as the schema stores it. */
  gender: string;
  courseRating: number;
  slopeRating: number;
  par: number;
  /** Total yardage off these tees. Per-hole yardage lives on the card. */
  yards: number;
}

/**
 * The hole-by-hole card, or the reason there isn't a usable one.
 *
 * A discriminated union rather than a card plus a `problems` array, because
 * the two are not both true at once and a caller that forgot to check would
 * otherwise write a scrambled card into the library. CLAUDE.md's rule: prefer
 * making the wrong thing unrepresentable over documenting that callers must
 * check.
 */
export type DirectoryCard =
  | { usable: true; pars: number[]; strokeIndex: number[]; yards: number[] }
  | { usable: false; reason: string };

export interface DirectoryCourse {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  website: string;
  address: string;
  card: DirectoryCard;
  tees: DirectoryTee[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Whose card a tee set is rated for.
 *
 * WHS rates the same tees separately by gender — Pebble Beach's Gold tees are
 * 73.4/137 for men and 78.2/146 for women off identical yardage — and using
 * the wrong one shifts every course handicap on that tee. So an unrecognised
 * value becomes "any" rather than guessing a side.
 */
function genderOf(raw: unknown): string {
  const v = str(raw).toLowerCase();
  if (v === "male" || v === "men" || v === "mens" || v === "m") return "men";
  if (v === "female" || v === "women" || v === "womens" || v === "ladies" || v === "f") return "women";
  return "any";
}



/**
 * The card, if it can be trusted enough to score with.
 *
 * Refuses rather than importing something quietly wrong, and names which part
 * failed — the organizer's next move is the paste box or typing the card, and
 * neither is helped by "import failed".
 */
export function cardFrom(holes: unknown): DirectoryCard {
  const rows = Array.isArray(holes) ? holes : [];
  /**
   * Nine holes is a golf course, not a broken eighteen.
   *
   * This took eighteen or nothing, and threw away 119 nine-hole courses out
   * of the 724 US ones catalogued — a quarter of them — while the app has
   * scored nine-hole rounds all along. `applyNine` already passes a natively
   * nine-hole card straight through, and the import writes the card at its
   * own length rather than padding it.
   *
   * The old refusal was reasoned about PADDING: guessing a back nine from a
   * front nine is how a club ends up scoring eighteen holes it never played.
   * That argument is still right and still holds — nothing here invents a
   * hole. It just does not follow from it that a real nine-hole card should
   * be discarded.
   */
  const holeCount = rows.length === 9 ? 9 : 18;
  if (rows.length !== holeCount) {
    return {
      usable: false,
      reason:
        rows.length === 0
          ? "The directory has no hole-by-hole card for this course."
          : `The directory has ${rows.length} holes for this course, which is neither 9 nor 18.`,
    };
  }

  // Trust `number` over array position: a directory that returns holes out of
  // order is exactly the failure this module exists to catch, and sorting by
  // the hole's own number is the only ordering the source actually asserts.
  const ordered = [...rows].sort(
    (a, b) => num((a as { number?: unknown }).number) - num((b as { number?: unknown }).number),
  ) as Array<Record<string, unknown>>;

  const pars = ordered.map((h) => num(h.par));
  const strokeIndex = ordered.map((h) => num(h.handicap_index));
  const yards = ordered.map((h) => {
    const y = h.yardages;
    if (!y || typeof y !== "object") return 0;
    // Longest set on the card. Which tee a player uses is decided per player
    // at scoring time; this is the reference row printed on a scorecard.
    const values = Object.values(y as Record<string, unknown>).map(num).filter((v) => v > 0);
    return values.length ? Math.max(...values) : 0;
  });

  const problems = cardProblems({ pars, strokeIndex }, holeCount);
  if (problems.length > 0) return { usable: false, reason: problems[0] };

  /**
   * The shape checks, from the one place that holds them.
   *
   * These lived here, which meant they guarded the directory import and
   * nothing else: the same scrambled card pasted in by hand was accepted
   * without complaint. They now sit in `scorecard-parse.ts`, where every way a
   * card enters this app goes past them — typed, pasted, imported, or read off
   * a photograph.
   */
  const shape = implausibleCard(pars, holeCount);
  if (shape) return { usable: false, reason: shape };

  return { usable: true, pars, strokeIndex, yards };
}

/** Search results, from whatever the directory returned. */
export function hitsFrom(payload: unknown): DirectoryHit[] {
  const raw = (payload as { courses?: unknown })?.courses;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({
      id: str(c.id),
      name: str(c.course_name) || str(c.name),
      city: str(c.city),
      state: str(c.state),
      country: str(c.country_iso).toUpperCase(),
      par: num(c.par),
      website: str(c.website),
    }))
    .filter((h) => h.id && h.name);
}

/** One course in full, card and tees, from the directory's detail response. */
export function courseFrom(payload: unknown): DirectoryCourse | null {
  const c = payload as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  const id = str(c.id);
  const name = str(c.course_name) || str(c.name) || str(c.club_name);
  if (!id || !name) return null;

  const teeRows = Array.isArray(c.tees) ? (c.tees as Array<Record<string, unknown>>) : [];
  return {
    id,
    name,
    city: str(c.city),
    state: str(c.state),
    country: str(c.country_iso).toUpperCase(),
    website: str(c.website),
    address: str(c.address),
    card: cardFrom(c.holes_data),
    tees: teeRows
      .map((t) => ({
        name: str(t.tee_name) || str(t.tee_color),
        gender: genderOf(t.gender),
        courseRating: num(t.course_rating),
        slopeRating: Math.round(num(t.slope)),
        par: Math.round(num(t.par)),
        yards: Math.round(num(t.yardage)),
      }))
      .filter((t) => t.name),
  };
}

/** One hole where an imported card and the club's own card disagree. */
export interface CardDifference {
  hole: number;
  field: "par" | "strokeIndex";
  ours: number;
  theirs: number;
}

/**
 * What the source now says that the club's stored card does not.
 *
 * Re-checking a course never writes. A confirmed card is a person at the club
 * stating a fact about a real course, and the source is a community database
 * that we have already watched be wrong — so the source must never outrank the
 * human. But silence is wrong too: a club that has genuinely re-indexed its
 * holes wants to hear about it. So this produces the difference and the caller
 * shows it, in the same refuse-and-explain shape as `drawReadiness`.
 *
 * Yardage is left out on purpose. It is presentation only, it differs by which
 * tee a directory happened to measure, and a list of eighteen yardage
 * disagreements would bury the two that change scoring.
 */
export function cardDifferences(
  ours: { pars: number[]; strokeIndex: number[] },
  theirs: { pars: number[]; strokeIndex: number[] },
): CardDifference[] {
  const out: CardDifference[] = [];
  for (let i = 0; i < 18; i += 1) {
    const op = ours.pars[i];
    const tp = theirs.pars[i];
    if (Number.isFinite(op) && Number.isFinite(tp) && op !== tp) {
      out.push({ hole: i + 1, field: "par", ours: op, theirs: tp });
    }
    const os = ours.strokeIndex[i];
    const ts = theirs.strokeIndex[i];
    if (Number.isFinite(os) && Number.isFinite(ts) && os !== ts) {
      out.push({ hole: i + 1, field: "strokeIndex", ours: os, theirs: ts });
    }
  }
  return out;
}
