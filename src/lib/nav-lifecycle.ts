import type { LifecycleTrack, PhaseKey } from "./domain/lifecycle-track";
import { NO_MERGES, relocate, type MergeKey, type Move } from "./domain/console-merges";
import { bySetupOrder } from "./domain/setup-flow";
import type { NavItem, NavSection } from "./nav";
import type { Role } from "./roles";

/**
 * THE MENU IS THE LIFECYCLE (the console structure review, 9 Nov 2026; step 2 of its plan).
 *
 * The console's side menu, regrouped so that the event's sections ARE the stepper's four stops —
 * Set up · Tee times (Draw, Lineups, This week) · Play · Results — with Home and Messages above them
 * and the club and the help below. About 18 entries where there were 28.
 *
 * IT DECIDES NOTHING, three times over:
 *
 *   which screens     it is handed `navForRole`'s answer and only REARRANGES it. Who may see a
 *                     screen, and which screens a tournament's shape has, stay that function's one
 *                     rule: a screen it left out is not here, and a screen it kept is never lost
 *                     (anything this arrangement does not place is listed under "More", and
 *                     `nav-lifecycle.test.ts` holds every role, shape and setting to that).
 *   which stops       the sections, their order and their words are the TRACK's phases
 *                     (`lifecycleTrack` → `phaseTitle`), the same object the stepper draws. There
 *                     is no list of stops in this file: `PLACES` below is a map FROM the track's
 *                     stop TO the screens that belong to it, and it is read in the track's order.
 *   where it stands   the stop it marks is the one holding the track's current step, which is
 *                     where the tournament's one button is (`tournamentJob`).
 *
 * MENU ONLY. The decided merges (the draw on one screen, the boards in Leaderboard, money split by
 * when, staff in Club settings, announcements in Messages, a Courses screen) are later steps. Until
 * each lands, the entry that will hold it GROUPS the screens that exist today beneath it, so every
 * old destination is still one press away.
 *
 * Shown only where the stepper is (`stepperShown`): with the switch off the menu is `navForRole`'s,
 * untouched. A casual round and a club with no tournament have no track, so they keep theirs too.
 *
 * STEP 3's MERGES (`domain/console-merges.ts`) reach the menu in two ways, and only while one is
 * shown (`mergesShown`; nothing is, without `?stepper=1&build=1` while every merge is building):
 *
 *   grouping   an entry beneath one place WITHOUT a merge sits beneath another WITH it — given once
 *              here, both ways (the design, §7.2). Only these two are given yet; the money and
 *              courses entries and the cup's new place are added by the PRs that build them:
 *              the Bracket under Leaderboard with the boards merge, the event's helpers named
 *              "Helpers" under Club settings with the staff merge
 *   doors      every entry's address goes through `relocate()`. An entry marked `stays` is
 *              re-pointed (the door is kept, one press as today, and opens the new room); any other
 *              entry whose door has moved is RETIRED, because the room it leads to is in the menu
 *              already. While no room is built (`MOVES` is empty) no door moves.
 */

/** A screen grouped beneath a place: its `NAV` key, or that with how a merge changes it. */
type Beneath =
  | string
  | {
      screen: string;
      /** Drawn here only while this merge shows. */
      with?: MergeKey;
      /** Drawn here only while this merge does not show (it is drawn elsewhere with it). */
      without?: MergeKey;
      /** Its name while this merge shows. */
      renamed?: { by: MergeKey; label: string };
      /** A door that is kept when its room moves: re-pointed by `relocate()`, never retired. */
      stays?: boolean;
    };

const screenOf = (b: Beneath): string => (typeof b === "string" ? b : b.screen);

/** One entry of the arrangement. */
interface Place {
  /** The screen it opens: a `NAV` key. Absent from `navForRole`'s answer, the entry is not drawn. */
  screen: string;
  /** Its own key here, when it is not simply that screen (a group's name, a second door to a screen). */
  id?: string;
  /** Its name in this menu; absent keeps the screen's own (`NAV`, the club's word for its settings). */
  label?: string;
  /** Where it lands, when that is a place ON the screen and not the screen. */
  href?: string;
  icon?: string;
  /** The screens grouped beneath it (`NAV` keys), each drawn only if `navForRole` kept it. */
  under?: readonly Beneath[];
  /** Those are setup steps: listed in setup's one order (`SETUP_ORDER`), never one of this file's. */
  setupOrder?: boolean;
  /** A door kept when its room moves (see `Beneath`). */
  stays?: boolean;
}

/** Above the event: used in every phase (the review, decision 5). */
const ABOVE: readonly Place[] = [
  { screen: "dashboard", label: "Home" },
  { screen: "messages", under: ["announcements"] },
];

/**
 * WHICH SCREENS BELONG TO WHICH STOP — keyed by the track's stop, never a list of them. A `Record`
 * over `PhaseKey`, so a stop added to the track does not compile until it is given its screens.
 */
const PLACES: Record<PhaseKey, readonly Place[]> = {
  setup: [
    { screen: "event", label: "Event details" },
    { screen: "stages" },
    // The field's three screens are one area (the `field`, `flights` and `sides` lock scopes).
    { screen: "registration", id: "players", label: "Players", under: ["registration", "teams", "grouping"], setupOrder: true },
    { screen: "prizes", label: "Prizes & side games" },
  ],
  // One question — who plays with whom, when — still asked on four screens until they are one.
  draw: [{ screen: "foursomes", label: "Tee times & draw", under: ["print", { screen: "bracket", without: "boards" }, "cup", "week"] }],
  // With the boards merge the bracket is a view of the board: its door stays one press, beneath it.
  day: [{ screen: "entry" }, { screen: "leaderboard", under: [{ screen: "bracket", with: "boards", stays: true }] }],
  after: [
    { screen: "reports", label: "Results" },
    // Paying out is done on Prizes today; a group's own games are beside it.
    { screen: "prizes", id: "money", label: "Money & payouts", icon: "ph ph-hand-coins", under: ["group-games"] },
  ],
};

const CLUB: readonly Place[] = [
  { screen: "tournaments", label: "Events" },
  { screen: "roster", under: ["member"] },
  // The club's course library sits on Event details until it has a screen of its own.
  { screen: "event", id: "courses", label: "Courses", href: "/event#courses", icon: "ph ph-map-pin", stays: true },
  { screen: "series", label: "Seasons & honours" },
  // With the staff merge an event's helpers are a section of Club settings: the door keeps one press,
  // named for the job (`navForRole` draws `access` only with an event open).
  { screen: "organization", under: [{ screen: "access", renamed: { by: "staff", label: "Helpers" }, stays: true }] },
];

const HELP: readonly Place[] = [{ screen: "guide-steps", label: "Guide & rules", under: ["guide", "rules"] }, { screen: "me" }];

/** The word over the four stops: what they are the stages OF. */
export const EVENT_SCOPE = "Event";
/** Anything `navForRole` kept that this arrangement has no place for — never dropped. */
export const UNPLACED_SECTION = "More";

/**
 * THE MENU — `sections` is `navForRole`'s answer for this person and this tournament; `track` is
 * the stepper's (`lifecycleTrack`). `roundName` is the round the Play stop's screens are about.
 * `merges` is what this request shows (`mergesShown`), with the `role` its doors are relocated for;
 * absent, the menu is step 2's exactly.
 */
export type LifecycleNavOptions = { roundName?: string } & (
  | { merges?: undefined }
  | { merges: ReadonlySet<MergeKey>; role: Role; /** Tests only: a table other than `MOVES`. */ moves?: readonly Move[] }
);

export function lifecycleNav(
  sections: readonly NavSection[],
  track: Pick<LifecycleTrack, "phases" | "steps" | "current">,
  opts: LifecycleNavOptions = {},
): NavSection[] {
  const merges = opts.merges ?? NO_MERGES;
  const shown = new Map<string, NavItem>();
  for (const s of sections) for (const i of s.items) shown.set(i.key, i);
  const placed = new Set<string>();
  const take = (key: string): NavItem | null => {
    const item = shown.get(key);
    if (item) placed.add(key);
    return item ?? null;
  };
  /** The entry with its door relocated; `null` when the door has moved and the entry is retired. */
  const door = (item: NavItem, stays: boolean | undefined): NavItem | null => {
    if (opts.merges === undefined || merges.size === 0) return item;
    const href = relocate({ href: item.href, role: opts.role }, merges, opts.moves);
    if (href === item.href) return item;
    return stays ? { ...item, href } : null;
  };
  const beneath = (b: Beneath): NavItem[] => {
    const spec = typeof b === "string" ? { screen: b } : b;
    if (spec.with && !merges.has(spec.with)) return [];
    if (spec.without && merges.has(spec.without)) return [];
    const item = take(spec.screen);
    if (!item) return [];
    const label = spec.renamed && merges.has(spec.renamed.by) ? spec.renamed.label : item.label;
    const kept = door({ ...item, label }, spec.stays);
    return kept ? [kept] : [];
  };

  const entries = (places: readonly Place[]): NavItem[] =>
    places.flatMap((p) => {
      const own = take(p.screen);
      // The screens beneath it; the field's in setup's one order (Entries, Teams, Flights).
      const listed = (p.under ?? []).flatMap(beneath);
      const under = p.setupOrder ? bySetupOrder(listed) : listed;
      // Its own screen is not this person's to open: what is beneath it stands on its own.
      if (!own) return under;
      const head = door({ ...own, key: p.id ?? own.key, label: p.label ?? own.label, href: p.href ?? own.href, icon: p.icon ?? own.icon }, p.stays);
      if (!head) return under;
      return under.length > 0 ? [{ ...head, children: under }] : [head];
    });

  const out: NavSection[] = [];
  const add = (section: NavSection) => {
    if (section.items.length > 0) out.push(section);
  };

  add({ label: "", items: entries(ABOVE) });

  // THE FOUR STOPS: the track's phases, in the track's order, under the track's words.
  const current = track.steps[track.current];
  let scoped = false;
  for (const phase of track.phases) {
    const items = entries(PLACES[phase.key]);
    if (items.length === 0) continue;
    out.push({
      label: phase.title,
      items,
      scope: scoped ? undefined : EVENT_SCOPE,
      stop: { key: phase.key, state: phase.state, current: !!current && phase.steps.includes(current) },
      detail: phase.key === "day" ? opts.roundName : undefined,
    });
    scoped = true;
  }

  // The club's section keeps the word `navForRole` gave it: "Club", "Society", "League".
  const clubKeys = new Set(CLUB.flatMap((p) => [p.screen, ...(p.under ?? []).map(screenOf)]));
  const club = sections.find((s) => s.label !== "" && s.items.some((i) => i.key !== "event" && clubKeys.has(i.key)));
  add({ label: club?.label ?? "Club", items: entries(CLUB) });
  add({ label: "Help", items: entries(HELP) });

  // NEVER LOST: a screen added to `NAV` after this was written is listed until it is given a place.
  add({ label: UNPLACED_SECTION, items: [...shown.values()].filter((i) => !placed.has(i.key)) });
  return out;
}

/** Every entry of a menu with what is grouped beneath it, in the order drawn. */
export function everyEntry(sections: readonly NavSection[]): NavItem[] {
  return sections.flatMap((s) => s.items.flatMap((i) => [i, ...(i.children ?? [])]));
}

/**
 * WHICH ENTRY IS "HERE". The flat menu has one entry per screen, so it is the one whose address
 * this is. The lifecycle menu has three screens with two doors (Players and Entries; Prizes & side
 * games and Money & payouts): the entry BENEATH a group is the screen itself, so it wins over the
 * group's name, and otherwise the first door in the menu's order. One entry, never two.
 */
export function activeEntryKey(sections: readonly NavSection[], pathname: string | null): string | null {
  if (!pathname) return null;
  for (const s of sections) {
    for (const i of s.items) {
      const beneath = i.children?.find((c) => c.href === pathname);
      if (beneath) return beneath.key;
      if (i.href === pathname) return i.key;
    }
  }
  return null;
}
