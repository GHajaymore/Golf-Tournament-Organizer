import { PRE_LAUNCH_STATUSES } from "./lifecycle-state";
import { isMatch } from "@/lib/tournament-shape";
import { STATUS_META } from "@/lib/format";
import { formatDay, formatDayRange, resolveLocale } from "./locale";
import { clubToday } from "./club-clock";

/**
 * ONE NAME IN PLAY PER CLUB (Ajay, 2026-11-01: "year may not solve. what if they run same
 * tournament twice a year?").
 *
 * The rule, as the panel wrote it: no two of a club's tournaments still IN PLAY may share a
 * name. Completed tournaments may share a name with each other and with one in play — a club
 * that runs its Spring Medal every year has a shelf of them — and wherever two of those could
 * be confused they are told apart by their date (`tellApart`, below).
 *
 * THIS FILE IS THE RULE: what "in play" is, how two names are compared, and the words of the
 * refusal. `services/tournament-name.ts` asks it of the database, and every door a name comes
 * into play through calls that — create, rename, copy and reopen. A sweep
 * (`a-tournament-name-is-checked-one-way.test.ts`) refuses a second copy of the comparison.
 *
 * The database holds the same rule as a partial unique index (migration A036), for the race
 * between two presses; it must say exactly what `holdsItsName` and `nameKey` say.
 */

/**
 * The statuses in which a tournament HOLDS its name: every step before launch and live. The
 * stored values, enumerated on the development database (2026-11-01: draft, registration,
 * live, completed; `ready` is written by older rows and still a status the app reads).
 *
 * A POSITIVE list, deliberately, because the index lists the same four words and the two must
 * agree; a status the app does not know is not in play, which is the side that never blocks a
 * club from naming something.
 */
export const NAME_HOLDING_STATUSES: readonly string[] = [...PRE_LAUNCH_STATUSES, "live"];

/**
 * Whether this tournament holds its name against the rest of its club.
 *
 * A casual round never does: it is the Sunday fourball named after whoever is in it ("Alex v
 * Sam"), it deletes itself after a day, and the same two playing again tomorrow are not
 * confusing anybody. A lapsed club's ARCHIVE keeps its status, so a tournament archived while
 * live still holds its name: it comes back exactly as it was when the club resubscribes, and
 * the name must still be its own when it does.
 */
export function holdsItsName(t: { status: string; shape: string }): boolean {
  return NAME_HOLDING_STATUSES.includes(t.status) && !isMatch(t.shape);
}

/**
 * Two names are the same when they read the same: case ignored, runs of spaces collapsed and
 * the ends trimmed. "Spring  Medal " and "spring medal" are one name on a list.
 */
export function nameKey(name: string): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** What `createEvent` calls a tournament whose name box was left empty. */
export const UNNAMED_TOURNAMENT = "New Tournament";

/**
 * Whether a name is still the app's placeholder — "New Tournament", or the free form of it the
 * app picked when the club already had one ("New Tournament 2026", "New Tournament (2)"). A
 * placeholder being recognised, so a name somebody chose is never mistaken for one.
 */
export function isUnnamed(name: string): boolean {
  const key = nameKey(name);
  const base = nameKey(UNNAMED_TOURNAMENT);
  if (!key || key === base) return true;
  return key.startsWith(`${base} `) && /^(?:\d{4}|\(\d+\))$/.test(key.slice(base.length + 1));
}

export type NameHolder ={ id: string; name: string; status: string; shape: string };

/**
 * The tournament of the club already holding this name in play, or null when it is free.
 * `selfId` is the tournament being renamed or reopened (null when it is new), which never
 * clashes with itself.
 */
export function nameClash(input: {
  name: string;
  selfId: string | null;
  others: readonly NameHolder[];
}): NameHolder | null {
  const key = nameKey(input.name);
  if (!key) return null;
  return input.others.find((o) => o.id !== input.selfId && holdsItsName(o) && nameKey(o.name) === key) ?? null;
}

/**
 * A name the club is not using, offered and never imposed: the year where the name does not
 * already carry it, then "(2)", "(3)"… Taken means ANY tournament of the club, completed ones
 * too — a name that is free in law but already on the shelf is the confusion this exists to
 * end. Kept within `max` characters by shortening the name, never the number.
 */
export function freeName(input: { name: string; taken: Iterable<string>; year: string; max: number }): string {
  const base = input.name.replace(/\s+/g, " ").trim();
  const taken = new Set([...input.taken].map(nameKey));
  const fit = (suffix: string) => `${base.slice(0, Math.max(1, input.max - suffix.length)).trim()}${suffix}`;
  const tries: string[] = [];
  if (input.year && !base.includes(input.year)) tries.push(fit(` ${input.year}`));
  for (let n = 2; n < 200; n += 1) tries.push(fit(` (${n})`));
  return tries.find((t) => !taken.has(nameKey(t))) ?? fit(` (${Date.now() % 100000})`);
}

/** Where a name was coming into play, which decides how the fix is worded. */
export type NameDoor = "create" | "rename" | "copy" | "reopen";

/**
 * The refusal, in plain words: which tournament holds the name, how to fix it, and a free name.
 */
export function nameTakenRefusal(input: { wanted: string; holder: { name: string; status: string }; suggestion: string; door: NameDoor }): string {
  const status = (STATUS_META[input.holder.status]?.label ?? "In play").toLowerCase();
  const holder = `“${input.holder.name.trim()}” (${status})`;
  if (input.door === "reopen") {
    return `This tournament can’t be reopened under its name: ${holder} already uses it, and two tournaments still in play can’t share a name. Rename this one first — “${input.suggestion}” is free — or complete or rename the other.`;
  }
  return `${holder} already uses that name, and two tournaments still in play can’t share one. Choose another — “${input.suggestion}” is free — or rename or complete “${input.holder.name.trim()}” first.`;
}

/** Said when the database's backstop refused a name and the holder could not be read back. */
export const NAME_TAKEN_RACE =
  "Another tournament in play took that name a moment ago. Choose another name and save again.";

/* ── Telling apart the tournaments that may share a name ─────────────────────────────────── */

/** A tournament as a list holds it, with its club's clock and words. */
export type ListedTournament = {
  id: string;
  organizationId: string;
  name: string;
  startOn: string;
  endOn: string;
  /** The dates as the organizer typed them, for a row older than `startOn`/`endOn`. */
  dates: string;
  createdAt: Date;
  organization?: { timeZone?: string | null; locale?: string | null } | null;
};

/**
 * What to write for each tournament on a list so two of one name can be told apart, keyed by
 * id; a name nobody else on the list uses gets nothing, and its row stays as it was.
 *
 * By DATE first: the days it is played, the club's way (`formatDayRange`, through
 * `date-words`); the typed dates of an older row; or "created" and the day it was made, at the
 * club, where it has no dates yet. Where two of ONE CLUB share the name and that date too, a
 * short number in the order the club made them ("#2"), counted among those twins only.
 */
export function tellApart(rows: readonly ListedTournament[]): Map<string, string> {
  const out = new Map<string, string>();
  const byName = new Map<string, ListedTournament[]>();
  for (const r of rows) {
    const k = nameKey(r.name);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const dated = group.map((r) => ({ r, words: dateWords(r) }));
    const twinsOf = new Map<string, ListedTournament[]>();
    for (const d of dated) {
      const k = `${d.r.organizationId}\u0000${d.words}`;
      twinsOf.set(k, [...(twinsOf.get(k) ?? []), d.r]);
    }
    for (const d of dated) {
      const twins = [...(twinsOf.get(`${d.r.organizationId}\u0000${d.words}`) ?? [])].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
      );
      out.set(d.r.id, twins.length > 1 ? `${d.words} · #${twins.indexOf(d.r) + 1}` : d.words);
    }
  }
  return out;
}

function dateWords(r: ListedTournament): string {
  const locale = resolveLocale(r.organization);
  if (r.startOn) return formatDayRange(r.startOn, r.endOn || r.startOn, locale);
  if (r.dates.trim()) return r.dates.trim();
  return `created ${formatDay(clubToday(r.organization?.timeZone, r.createdAt), locale)}`;
}
