/**
 * WHEN A DEPLOY MUST WAIT (the testing panel, 2026-10-23 — docs/testing-panel-2026-10-23.md).
 *
 * A deploy is a few minutes in which a page may answer from the old build and
 * the next from the new one, and in which a fault nobody has seen yet goes out
 * to everybody at once. On a Tuesday evening that costs nobody anything. On a
 * Saturday morning it lands on a secretary running a shotgun start and on a
 * hundred and forty players each saving a card after every hole. The tournament
 * director's rule, which the panel adopted:
 *
 *   FROZEN while any club has a tournament ON TODAY, in that club's own time —
 *     a round dated today (`Stage.playedOn`), or a tournament whose dates
 *     (`startOn`..`endOn`) take in today and span at most a week. A league's
 *     "April to September" is a season, not a day's golf, and does not freeze
 *     anything by itself; its round on the day does.
 *   FROZEN on Saturday and Sunday from 05:00 to 14:00 in ANY club's zone —
 *     when clubs play, whether or not they have told the app.
 *
 * "Today" is asked of the club's clock (`club-clock.ts`), never the server's,
 * for the reason that file gives. A club that has not said where it is keeps
 * the server's day, as everywhere else in the app.
 *
 * THAT IS THE RULE ONCE ACCOUNTS ARE LIVE. BEFORE LAUNCH IT GUARDS ONLY PILOT
 * CLUBS (Ajay, 2026-11-06: "we can't waste time waiting this long. this kind of
 * real tournament [freeze] we should do at the last when we have all other
 * foundations and basic issues fixed"). While production holds sign-ins, no
 * member can be signed in, so a deploy lands on nobody but the owners and the
 * people let in by name on `SIGNIN_ALLOW_EMAILS` — a pilot club's organizer.
 * So, held (`deployWindowFor`):
 *   FROZEN only while a PILOT club — one at which somebody on the allow-list is
 *     staff — has a tournament on today, by the same `onToday`;
 *   NOT frozen on a weekend morning, and not for the owners' own clubs, the
 *     demo club or any other club: their tournaments are test tournaments.
 * Live, it is exactly the rule above. The launch state is asked of the one
 * answer every held page asks (`launchState()`), never worked out again here.
 * And until 20 November 2026 (`FREEZE_RESUMES`, Ajay's ruling the same night)
 * the freeze is off altogether, held or live.
 *
 * Pure: no clock of its own and no database. The service reads the rows, the
 * route `/api/deploy-window` answers the deploy job, and the deploy job never
 * touches the database — it may not hold production credentials.
 */
import { clubToday, isTimeZone } from "./club-clock";
import { fieldsAt } from "./date-words";
import type { LaunchState } from "@/lib/go-live";

/** The weekend morning, by the club's clock: from this hour, up to (not including) that one. */
export const WEEKEND_MORNING = { from: 5, to: 14 } as const;
/** A tournament whose dates span longer than this is a season, not a day's golf. */
export const LONGEST_TOURNAMENT_DAYS = 7;

export interface TournamentOnTheBooks {
  /** The club's IANA zone, or "" for a club that has not said. */
  timeZone: string;
  /** yyyy-mm-dd, or "". */
  startOn: string;
  endOn: string;
  /** The days its rounds are played on, yyyy-mm-dd ("" where not set). */
  playedOn: string[];
}

export interface DeployWindow {
  frozen: boolean;
  /** One sentence for the deploy job's summary. Zones and counts, never a club's or a person's name. */
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The weekday (0 Sunday … 6 Saturday), hour and minute at `at` in `zone` — the server's own zone for "". */
export function clockIn(zone: string, at: Date): { weekday: number; hour: number; minute: number } {
  // The app's one reader of a zone's calendar fields (date-words.ts), so this asks no locale of its own.
  const f = fieldsAt(at, isTimeZone(zone) ? zone : undefined) ?? fieldsAt(at);
  return { weekday: f?.weekday ?? -1, hour: f?.hour ?? -1, minute: f?.minute ?? 0 };
}

/** Whether this tournament is being played today, by its own club's clock. */
export function onToday(t: TournamentOnTheBooks, at: Date): boolean {
  const today = clubToday(t.timeZone, at);
  if (t.playedOn.includes(today)) return true;
  if (!t.startOn) return false;
  const end = t.endOn || t.startOn;
  return t.startOn <= today && today <= end && spanDays(t.startOn, end) < LONGEST_TOURNAMENT_DAYS;
}

/**
 * Whether a deploy must wait right now.
 *
 * `zones` is every club's zone ("" for a club that has not said — read as the
 * server's); `tournaments` is whatever might be on today, the service having
 * narrowed it to a day either side.
 */
export function deployWindow(at: Date, zones: string[], tournaments: TournamentOnTheBooks[]): DeployWindow {
  const playing = tournaments.filter((t) => onToday(t, at));
  if (playing.length) return { frozen: true, reason: beingPlayed(playing) };
  const distinct = [...new Set(zones.length ? zones : [""])];
  for (const zone of distinct.sort()) {
    const { weekday, hour, minute } = clockIn(zone, at);
    if ((weekday === 0 || weekday === 6) && hour >= WEEKEND_MORNING.from && hour < WEEKEND_MORNING.to) {
      return {
        frozen: true,
        reason: `it is ${weekday === 6 ? "Saturday" : "Sunday"} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} in ${zone || "the server's own zone"} — weekend mornings, ${WEEKEND_MORNING.from}:00 to ${WEEKEND_MORNING.to}:00 at any club, are frozen`,
      };
    }
  }
  return { frozen: false, reason: `no tournament is on today at any club, and it is not a weekend morning in any of ${distinct.length} club time zone(s)` };
}

/** "2 tournaments are being played today in the club's own time (…zones…)" — counts and zones, never a name. */
function beingPlayed(playing: TournamentOnTheBooks[]): string {
  const where = [...new Set(playing.map((t) => t.timeZone || "the server's own zone"))].sort();
  return `${playing.length} tournament${playing.length === 1 ? " is" : "s are"} being played today in the club's own time (${where.slice(0, 4).join(", ")}${where.length > 4 ? ` and ${where.length - 4} more` : ""})`;
}

/** A tournament and the club it is at. The id is used only to ask "is this a pilot club" — never said. */
export interface ClubTournament extends TournamentOnTheBooks {
  clubId: string;
}

/**
 * THE FREEZE IS OFF UNTIL 20 NOVEMBER 2026 (Ajay, 2026-11-06: "let's turn off that freez until Nov
 * 20th"). Before this instant no deploy waits, held or live: no event day, no weekend morning.
 *
 * The instant is 20 November 00:00 in the EARLIEST zone on Earth (UTC+14, Pacific/Kiritimati) —
 * 19 November 10:00 UTC — so the freeze is back before 20 November has begun at any club anywhere.
 * Midnight UTC would leave a club east of Greenwich (Auckland is UTC+13 then) the first hours of its
 * 20th unguarded. It matters from that day: the Florida pilot club's organizer starts setting up on
 * 20 November, and the outing is 29–30 November.
 */
export const FREEZE_RESUMES = new Date("2026-11-20T00:00:00+14:00");
/** The answer before `FREEZE_RESUMES`. */
export const FREEZE_OFF = "the freeze is off until 20 Nov 2026 (the owner's ruling of 6 Nov)";

/** The first words of every answer before launch, so the deploy summary says which rule applied. */
export const HELD_RULE = "sign-ins are held: only pilot clubs count";
/** And after it. */
export const LIVE_RULE = "accounts are live: every club counts";

/**
 * WHETHER A DEPLOY MAY GO NOW — the answer the deploy job is given, held or live.
 *
 * Before `FREEZE_RESUMES` nothing freezes, held or live. From then, `launch` decides:
 * `launch` is `launchState()`, the one answer every held page asks; `pilotClubs` is the clubs at
 * which somebody on `SIGNIN_ALLOW_EMAILS` (and not an owner) is staff. Live, `pilotClubs` is not
 * read and the answer is `deployWindow`'s, unchanged but for the words saying which rule it was.
 */
export function deployWindowFor(
  launch: LaunchState,
  at: Date,
  zones: string[],
  tournaments: ClubTournament[],
  pilotClubs: ReadonlySet<string>,
): DeployWindow {
  if (at.getTime() < FREEZE_RESUMES.getTime()) return { frozen: false, reason: FREEZE_OFF };
  if (launch === "live") {
    const live = deployWindow(at, zones, tournaments);
    return { frozen: live.frozen, reason: `${LIVE_RULE} — ${live.reason}` };
  }
  const playing = tournaments.filter((t) => pilotClubs.has(t.clubId) && onToday(t, at));
  if (playing.length) return { frozen: true, reason: `${HELD_RULE}, and ${beingPlayed(playing)} at a pilot club` };
  const weekend = "weekend mornings are not frozen before launch";
  if (!pilotClubs.size) {
    return { frozen: false, reason: `${HELD_RULE}, and there is none (nobody on the sign-in allow-list is staff at a club); ${weekend}` };
  }
  return {
    frozen: false,
    reason: `${HELD_RULE}, and none is playing today (${pilotClubs.size} pilot club${pilotClubs.size === 1 ? "" : "s"}); ${weekend}`,
  };
}
