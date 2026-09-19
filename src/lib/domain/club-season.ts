/**
 * WHICH SEASON A TOURNAMENT BELONGS TO.
 *
 * A club's year is not always the calendar's, and it is a WINDOW rather than a
 * turnover day. All four of these are real answers a secretary gives:
 *
 *   January to December    the calendar year, and the default
 *   April to September     a playing season with half a year outside it
 *   April to March         a full year that crosses the new year: "2026–27"
 *   October to May         a winter society, same crossing
 *
 * The club says its window once — `Organization.seasonStartsOn` /
 * `seasonEndsOn`, as `mm-dd` — and every tournament falls into a season by its
 * own start date.
 *
 * DERIVED, NEVER STORED. A season written onto each tournament is a second
 * copy of a fact the dates already carry, and the two drift the first time
 * somebody moves a tournament by a fortnight across the boundary. Same shape
 * as `standingRows` returning `[]` for a manual format: decide it where the
 * data is, so no caller can get it wrong by forgetting.
 */

/** The club's season, as the two days that bound it. */
export interface SeasonWindow {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}

/** A season a club's tournaments fall into. */
export interface Season {
  /** Sorts and dedupes: the calendar year the season STARTED in. */
  key: number;
  /** What a member reads: "2026", or "2026–27" when the window crosses the new year. */
  label: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MMDD = /^(\d{2})-(\d{2})$/;

/** Days in a month, ignoring leap years — this validates input, it does not do arithmetic. */
const LONGEST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthDay(value: string): { month: number; day: number } | null {
  const m = MMDD.exec((value ?? "").trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > LONGEST[month - 1]) return null;
  return { month, day };
}

/**
 * The club's window, or the calendar year.
 *
 * Anything unparseable reads as January–December rather than throwing: this
 * decides how a list is GROUPED, and a bad value in one column should not take
 * a screen down. The calendar year is also the honest reading of an unanswered
 * question — a club that has not said has told us nothing.
 *
 * The two halves fall back INDEPENDENTLY, so a club that has set a start and
 * not an end gets its own start with the year's end, which is what "we open in
 * April" means on its own.
 */
export function seasonWindow(startsOn: string, endsOn: string): SeasonWindow {
  const start = monthDay(startsOn) ?? { month: 1, day: 1 };
  const end = monthDay(endsOn) ?? { month: 12, day: 31 };
  return { startMonth: start.month, startDay: start.day, endMonth: end.month, endDay: end.day };
}

/** Whether the window crosses the new year — April to March, October to May. */
export function seasonWraps(w: SeasonWindow): boolean {
  return w.endMonth < w.startMonth || (w.endMonth === w.startMonth && w.endDay < w.startDay);
}

/**
 * Which season a date falls in, or null when there is no date.
 *
 * NULL RATHER THAN A GUESS. A tournament with no start date belongs to no
 * season, and putting it in "this season" because that is where undated things
 * are least noticeable is the app inventing a fact. Screens group those
 * separately and say so.
 *
 * A date OUTSIDE the playing window still belongs to a season — the one that
 * opened most recently. A club playing April to September that runs a December
 * outing has run it in its 2026 season, and telling a member it belongs to
 * 2027 would be worse than saying nothing.
 */
export function seasonOf(startOn: string, w: SeasonWindow): Season | null {
  const m = ISO.exec((startOn ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // The shape is not the value: "2026-13-01" is four-two-two digits and is not
  // a date. Caught by this file's own test rather than in a club's fixture
  // list, where it would have grouped a tournament under an impossible season.
  if (month < 1 || month > 12 || day < 1 || day > LONGEST[month - 1]) return null;
  const beforeOpening = month < w.startMonth || (month === w.startMonth && day < w.startDay);
  const key = beforeOpening ? year - 1 : year;
  return { key, label: seasonLabel(key, w) };
}

/**
 * "2026", or "2026–27" for a season that crosses the new year.
 *
 * An en dash and a two-digit second year, which is how a golf club writes it
 * on a fixture card.
 */
export function seasonLabel(key: number, w: SeasonWindow): string {
  if (!seasonWraps(w)) return String(key);
  return `${key}–${String((key + 1) % 100).padStart(2, "0")}`;
}

/** The season today falls in — what a member is shown first. */
export function currentSeason(today: string, w: SeasonWindow): Season | null {
  return seasonOf(today, w);
}

/**
 * Whether a date is inside the club's playing window at all.
 *
 * Separate from which season it belongs to, because they are different
 * questions: a December outing at an April-to-September club is IN the 2026
 * season and OUT of its playing window, and only the second one is unusual
 * enough to be worth a word on screen.
 */
export function inPlayingWindow(date: string, w: SeasonWindow): boolean {
  const m = ISO.exec((date ?? "").trim());
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const at = month * 100 + day;
  const from = w.startMonth * 100 + w.startDay;
  const to = w.endMonth * 100 + w.endDay;
  return seasonWraps(w) ? at >= from || at <= to : at >= from && at <= to;
}

export interface Dated {
  startOn: string;
}

export interface SeasonGroup<T> {
  season: Season | null;
  items: T[];
}

/**
 * A club's tournaments, newest season first, undated ones last.
 *
 * Order inside a season is left exactly as it arrives: the caller has already
 * sorted by whatever that screen is about (entries closing, a board worth
 * opening), and re-sorting here would quietly overrule it.
 */
export function bySeason<T extends Dated>(items: readonly T[], w: SeasonWindow): SeasonGroup<T>[] {
  const groups = new Map<number, SeasonGroup<T>>();
  const undated: T[] = [];
  for (const item of items) {
    const season = seasonOf(item.startOn, w);
    if (!season) {
      undated.push(item);
      continue;
    }
    const group = groups.get(season.key) ?? { season, items: [] };
    group.items.push(item);
    groups.set(season.key, group);
  }
  const out = [...groups.values()].sort((a, b) => (b.season?.key ?? 0) - (a.season?.key ?? 0));
  if (undated.length) out.push({ season: null, items: undated });
  return out;
}
