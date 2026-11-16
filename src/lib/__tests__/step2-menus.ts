import { navForRole, type NavItem, type NavSection } from "../nav";
import { lifecycleTrack, type LifecycleTrack } from "../domain/lifecycle-track";
import { tournamentJob } from "../domain/needs-you-now";
import { tournamentStatus, type Family, type TournamentFacts } from "../domain/tournament-status";
import { FAMILIES, FAMILY_FIXTURES, completed, launched, playedOut } from "../domain/__tests__/tournament-facts-fixtures";
import { DEFAULT_SETTINGS, type TournamentSettings } from "../tournament-settings";
import type { Role } from "../roles";

/**
 * THE CASES WHOSE STEP 2 MENU IS FROZEN in `step2-menus.json` (console step 3, PR 0; review of #1142).
 *
 * Step 3's merges are switched off as shipped, and "off" must mean the menu `main` drew before
 * them — not the menu this branch draws with an empty set, which a change to the code both paths
 * share would leave equal to itself. So the menus were taken ONCE from `main`'s own
 * `nav-lifecycle.ts` at 25fce89d (= e5178d1c for that file) and committed; the test compares the
 * head against that file. To take them again, run main's `lifecycleNav` over `step2Cases()` and
 * write `frozenMenus()` — never regenerate it from the head, or it proves nothing.
 *
 * Every name is invented.
 */

const TODAY = "2026-11-20";

function trackOf(f: TournamentFacts): LifecycleTrack {
  const status = tournamentStatus(f);
  const job = tournamentJob(
    { eventId: "e1", name: "zz-menu Quillstone Autumn Medal", awaitingApproval: 0, entriesClose: "", nextSheet: null, board: null, startOn: f.startOn, endOn: f.endOn, status },
    TODAY,
    (iso: string) => iso,
  );
  const track = lifecycleTrack(status, job);
  if (!track) throw new Error("a tournament that is not a casual round has a track");
  return track;
}

const dated = (family: Family) => ({ ...FAMILY_FIXTURES[family](), startOn: "2026-11-28", endOn: "2026-11-29" });
const STAGES: Array<[string, (f: TournamentFacts) => TournamentFacts]> = [
  ["set up", (f) => f],
  ["launched", launched],
  ["played out", playedOut],
  ["completed", completed],
];
const ROLES: Role[] = ["admin", "assistant", "player"];
const SETTINGS: Array<[string, TournamentSettings | undefined]> = [
  ["no settings", undefined],
  ["open", { ...DEFAULT_SETTINGS, leaderboardVisibility: "participants", scoreEntryBy: "players" }],
  ["blind", { ...DEFAULT_SETTINGS, leaderboardVisibility: "staff", scoreEntryBy: "players" }],
  ["staff-scored", { ...DEFAULT_SETTINGS, leaderboardVisibility: "participants", scoreEntryBy: "staff" }],
];
const FLAGS = ["hasTeamRound", "hasKnockout", "hasCup", "isLeague", "isPlayerToo", "isMatch"] as const;
/** Every combination of the six facts that show, hide or rename a screen: 64 shapes. */
const SHAPES = Array.from({ length: 1 << FLAGS.length }, (_, n) => Object.fromEntries(FLAGS.map((f, i) => [f, (n & (1 << i)) !== 0])));
const EVERYTHING = Object.fromEntries(FLAGS.filter((f) => f !== "isMatch").map((f) => [f, true]));

export interface MenuCase {
  key: string;
  role: Role;
  flat: NavSection[];
  track: LifecycleTrack;
  roundName: string;
}

/** Every role × setting × shape on a medal, and every family × stage for an organizer with everything. */
export function step2Cases(): MenuCase[] {
  const out: MenuCase[] = [];
  const medal = trackOf(dated("stroke"));
  const roundName = "Round 1 of 2 · Stroke Play";
  for (const role of ROLES) {
    for (const [name, settings] of SETTINGS) {
      // The shape is its number: bit i is `FLAGS[i]`.
      for (const [n, shape] of SHAPES.entries()) {
        out.push({ key: `${role}|${name}|${n}`, role, flat: navForRole(role, settings, { ...shape, roundName }), track: medal, roundName });
      }
    }
  }
  for (const family of FAMILIES.filter((f) => f !== "casual")) {
    for (const [stage, at] of STAGES) {
      out.push({ key: `admin|${family}|${stage}`, role: "admin", flat: navForRole("admin", undefined, EVERYTHING), track: trackOf(at(dated(family))), roundName });
    }
  }
  return out;
}

/**
 * The frozen file's shape: each distinct entry once (`items`, as JSON), each distinct menu once
 * (`menus`: its sections, each entry written as `[item, [items beneath it]]`), and which menu each
 * case drew. Every field of every entry and section is kept, so a decoded menu deep-equals the one
 * that was drawn.
 */
export interface FrozenMenus {
  taken: string;
  items: string[];
  menus: string[];
  cases: Record<string, number>;
}

type Packed = Array<Omit<NavSection, "items"> & { items: Array<[number, number[]]> }>;

export function frozenMenus(menuOf: (c: MenuCase) => NavSection[], taken: string): FrozenMenus {
  const items: string[] = [];
  const menus: string[] = [];
  const cases: Record<string, number> = {};
  const itemAt = (i: NavItem): number => {
    const text = JSON.stringify({ ...i, children: undefined });
    const at = items.indexOf(text);
    return at === -1 ? items.push(text) - 1 : at;
  };
  for (const c of step2Cases()) {
    const packed: Packed = menuOf(c).map((s) => ({ ...s, items: s.items.map((i) => [itemAt(i), (i.children ?? []).map(itemAt)] as [number, number[]]) }));
    const text = JSON.stringify(packed);
    const at = menus.indexOf(text);
    cases[c.key] = at === -1 ? menus.push(text) - 1 : at;
  }
  return { taken, items, menus, cases };
}

/** The menu a case drew when it was frozen. */
export function frozenMenu(frozen: FrozenMenus, key: string): NavSection[] | undefined {
  const at = frozen.cases[key];
  if (at === undefined) return undefined;
  const item = (n: number): NavItem => JSON.parse(frozen.items[n]) as NavItem;
  return (JSON.parse(frozen.menus[at]) as Packed).map((s) => ({
    ...s,
    items: s.items.map(([n, beneath]) => (beneath.length > 0 ? { ...item(n), children: beneath.map(item) } : item(n))),
  }));
}
