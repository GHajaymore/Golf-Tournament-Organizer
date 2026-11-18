import { describe, it, expect } from "vitest";
import { NAV, navForRole, primaryTabs, type NavSection } from "../nav";
import { activeEntryKey, everyEntry, lifecycleNav, EVENT_SCOPE, UNPLACED_SECTION } from "../nav-lifecycle";
import { keepPreview, lifecycleTrack, type LifecycleTrack } from "../domain/lifecycle-track";
import { tournamentJob } from "../domain/needs-you-now";
import { tournamentStatus, type Family, type TournamentFacts } from "../domain/tournament-status";
import { FAMILIES, FAMILY_FIXTURES, completed, launched, playedOut } from "../domain/__tests__/tournament-facts-fixtures";
import { DEFAULT_SETTINGS, type TournamentSettings } from "../tournament-settings";
import type { Role } from "../roles";
import { SCREEN_KEYS, NO_MERGES, mergesShown, relocate, type ScreenKey, type Move } from "../domain/console-merges";
import { readSource } from "./source";
import { frozenMenu, step2Cases, type FrozenMenus } from "./step2-menus";
import FROZEN_STEP2 from "./step2-menus.json";

/**
 * THE MENU THAT FOLLOWS THE LIFECYCLE (the console structure review, 9 Nov 2026; step 2).
 *
 * Four promises, each held here:
 *
 *   nothing lost    every screen the flat menu offers a person is in this one — for every role,
 *                   every shape of tournament, every setting that hides a screen, and every family
 *                   at every stage. And nothing is offered that the flat menu withheld.
 *   the stops       its event sections are the stepper's track: the same stops, the same order, the
 *                   same words — worked here from the review's own table (Tee times; Draw for a
 *                   knockout; Lineups for a cup; This week for a league), not read back from the code.
 *   no second list  hand it a track with other stops in another order and the menu follows it: there
 *                   is no list of stops in the file to disagree with the stepper's.
 *   the decided menu  with everything shown it is the review's eighteen entries, in its order.
 *
 * Pure: `navForRole` in, sections out. Every name is invented.
 */

const TODAY = "2026-11-20";
const day = (iso: string) => iso;

function trackOf(f: TournamentFacts): LifecycleTrack {
  const status = tournamentStatus(f);
  const job = tournamentJob(
    { eventId: "e1", name: "zz-menu Quillstone Autumn Medal", awaitingApproval: 0, entriesClose: "", nextSheet: null, board: null, startOn: f.startOn, endOn: f.endOn, status },
    TODAY,
    day,
  );
  const track = lifecycleTrack(status, job);
  expect(track, "a tournament that is not a casual round has a track").not.toBeNull();
  return track!;
}

const TRACKED = FAMILIES.filter((f) => f !== "casual");
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
const FLAGS = ["hasTeamRound", "hasKnockout", "hasCup", "isLeague", "isPlayerToo"] as const;
type Shape = Partial<Record<(typeof FLAGS)[number], boolean>>;
/** Every combination of the five facts that show or hide a screen: 32 shapes. */
const SHAPES: Shape[] = Array.from({ length: 1 << FLAGS.length }, (_, n) => Object.fromEntries(FLAGS.map((f, i) => [f, (n & (1 << i)) !== 0])));
const EVERYTHING: Shape = Object.fromEntries(FLAGS.map((f) => [f, true]));

const path = (href: string) => href.split(/[?#]/)[0];
const flatHrefs = (sections: readonly NavSection[]) => sections.flatMap((s) => s.items.map((i) => i.href));
/** What the flat menu reaches and this one does not. */
const lost = (flat: readonly NavSection[], menu: readonly NavSection[]) => {
  const reached = new Set(everyEntry(menu).map((i) => i.href));
  return flatHrefs(flat).filter((h) => !reached.has(h));
};
/** What this one offers that the flat menu withheld. */
const added = (flat: readonly NavSection[], menu: readonly NavSection[]) => {
  const allowed = new Set(flatHrefs(flat));
  return everyEntry(menu).map((i) => i.href).filter((h) => !allowed.has(path(h)));
};

describe("no screen the old menu reached is lost", () => {
  const medal = trackOf(dated("stroke"));

  it("for every role, every shape and every setting that hides a screen", () => {
    let checked = 0;
    for (const role of ROLES) {
      for (const [name, settings] of SETTINGS) {
        for (const shape of SHAPES) {
          const flat = navForRole(role, settings, { ...shape, roundName: "Round 1 of 2 · Stroke Play" });
          const menu = lifecycleNav(flat, medal);
          const where = `${role}, ${name}, ${JSON.stringify(shape)}`;
          expect(lost(flat, menu), `lost — ${where}`).toEqual([]);
          expect(added(flat, menu), `offered though withheld — ${where}`).toEqual([]);
          // The arrangement has a place for every screen there is today.
          expect(menu.find((s) => s.label === UNPLACED_SECTION), `unplaced — ${where}`).toBeUndefined();
          // And the phone's three tabs are the same three.
          expect(primaryTabs(menu).map((t) => t.href), where).toEqual(primaryTabs(flat).map((t) => t.href));
          checked++;
        }
      }
    }
    // A sweep over nothing passes everything above it.
    expect(checked).toBe(ROLES.length * SETTINGS.length * 32);
  });

  it("for every family at every stage, and for a society's own words", () => {
    for (const family of TRACKED) {
      for (const [stage, at] of STAGES) {
        const flat = navForRole("admin", undefined, EVERYTHING);
        const menu = lifecycleNav(flat, trackOf(at(dated(family))));
        expect(lost(flat, menu), `${family}, ${stage}`).toEqual([]);
        expect(added(flat, menu), `${family}, ${stage}`).toEqual([]);
      }
    }
  });

  it("covers the whole console: every screen in NAV is reached by an organizer with everything shown", () => {
    const flat = navForRole("admin", undefined, EVERYTHING);
    // CONTROL on the fixture: "everything shown" really is every entry of the flat menu.
    expect(flatHrefs(flat).sort()).toEqual(NAV.flatMap((s) => s.items.map((i) => i.href)).sort());
    expect(lost(flat, lifecycleNav(flat, medal))).toEqual([]);
  });

  it("CONTROL: the check sees a lost screen, and a screen with no place is listed, never dropped", () => {
    const flat = navForRole("admin", undefined, EVERYTHING);
    const menu = lifecycleNav(flat, medal);
    // Take one grouped screen out of the finished menu: the check names it.
    const broken = menu.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, children: i.children?.filter((c) => c.key !== "print") })) }));
    expect(lost(flat, broken)).toEqual(["/print"]);
    // A screen added to NAV tomorrow, which this arrangement has never heard of.
    const tomorrow: NavSection[] = [...flat, { label: "New", items: [{ key: "zz-new", label: "A new screen", href: "/zz-new", icon: "ph ph-flag", tier: "at-desk" }] }];
    const grown = lifecycleNav(tomorrow, medal);
    expect(grown.find((s) => s.label === UNPLACED_SECTION)?.items.map((i) => i.href)).toEqual(["/zz-new"]);
    expect(lost(tomorrow, grown)).toEqual([]);
  });

  it("a person whose role cannot open a group's own screen still gets what is beneath it", () => {
    // A player may read the rules and not the organizer's guide: Rules reference stands on its own.
    const flat = navForRole("player", undefined, { isPlayerToo: true });
    const menu = lifecycleNav(flat, medal);
    const help = menu.find((s) => s.label === "Help")!;
    expect(help.items.map((i) => i.label)).toEqual(["Rules reference", "My round"]);
    // And their side games are not behind Prizes, which is not theirs.
    expect(everyEntry(menu).find((i) => i.href === "/group-games")?.label).toBe("Side games");
    expect(everyEntry(menu).some((i) => i.href === "/prizes")).toBe(false);
  });
});

describe("the event's sections are the stepper's stops", () => {
  const stops = (menu: readonly NavSection[]) => menu.filter((s) => s.stop);

  it("the same stops, in the same order, under the same words, for every family at every stage", () => {
    for (const family of TRACKED) {
      for (const [stage, at] of STAGES) {
        const track = trackOf(at(dated(family)));
        const menu = lifecycleNav(navForRole("admin", undefined, EVERYTHING), track);
        expect(stops(menu).map((s) => s.label), `${family}, ${stage}`).toEqual(track.phases.map((p) => p.title));
        expect(stops(menu).map((s) => s.stop!.key), `${family}, ${stage}`).toEqual(track.phases.map((p) => p.key));
        expect(stops(menu).map((s) => s.stop!.state), `${family}, ${stage}`).toEqual(track.phases.map((p) => p.state));
        // ONE stop is where the tournament is: the one holding the stepper's current step.
        const here = stops(menu).filter((s) => s.stop!.current);
        expect(here.map((s) => s.stop!.key), `${family}, ${stage}`).toEqual([track.steps[track.current].phase]);
        // "Event" is said once, over the first of them.
        expect(menu.filter((s) => s.scope).map((s) => [s.scope, s.stop?.key]), `${family}, ${stage}`).toEqual([[EVENT_SCOPE, "setup"]]);
      }
    }
  });

  it("the second stop is named for the event's shape (the review's table, not the code's)", () => {
    // "EVENT ─ TEE TIMES ("DRAW" for a knockout, "LINEUPS" for a cup, "THIS WEEK" for a league)".
    const SAYS: Record<Exclude<Family, "casual">, string> = {
      stroke: "Tee times",
      stableford: "Tee times",
      match: "Tee times",
      roundRobinFlights: "Tee times",
      knockout: "Draw",
      flightedKnockout: "Draw",
      teamCup: "Lineups",
      league: "This week",
    };
    for (const family of TRACKED) {
      const menu = lifecycleNav(navForRole("admin", undefined, EVERYTHING), trackOf(dated(family)));
      expect(stops(menu).map((s) => s.label), family).toEqual(["Set up", SAYS[family as Exclude<Family, "casual">], "Play", "Results"]);
    }
  });

  it("holds NO list of stops: given another track, it follows that one", () => {
    const real = trackOf(dated("stroke"));
    // The same stops under words and in an order no code here could know.
    const words: Record<string, string> = { setup: "zz-first", draw: "zz-second", day: "zz-third", after: "zz-fourth" };
    const other = { ...real, phases: [...real.phases].reverse().map((p) => ({ ...p, title: words[p.key] })) };
    const menu = lifecycleNav(navForRole("admin", undefined, EVERYTHING), other);
    expect(stops(menu).map((s) => s.label)).toEqual(["zz-fourth", "zz-third", "zz-second", "zz-first"]);
    expect(lost(navForRole("admin", undefined, EVERYTHING), menu)).toEqual([]);
  });

  it("the file spells no stop's name: the words are the track's (`phaseTitle`)", () => {
    // "Results" is left out of the sweep: it is also the name of an ENTRY (the results screen).
    const STOP_WORDS = ["Set up", "Tee times", "Draw", "Lineups", "This week", "Play"];
    const spelled = (source: string) => STOP_WORDS.filter((w) => source.includes(`"${w}"`));
    expect(spelled(readSource("src/lib/nav-lifecycle.ts"))).toEqual([]);
    expect(spelled(readSource("src/components/NavSections.tsx"))).toEqual([]);
    // CONTROL: it sees one planted, and the place the words do live.
    expect(spelled('const second = { label: "Draw" };')).toEqual(["Draw"]);
    expect(spelled(readSource("src/lib/domain/lifecycle-track.ts")).length).toBeGreaterThan(3);
  });

  it("the Play stop says which round its screens are about", () => {
    const flat = navForRole("admin", undefined, { roundName: "Round 2 of 4 · Stableford" });
    const menu = lifecycleNav(flat, trackOf(dated("stableford")), { roundName: "Round 2 of 4 · Stableford" });
    expect(menu.filter((s) => s.detail).map((s) => [s.stop?.key, s.detail])).toEqual([["day", "Round 2 of 4 · Stableford"]]);
  });
});

describe("the decided menu", () => {
  const flat = navForRole("admin", undefined, EVERYTHING);
  const menu = lifecycleNav(flat, trackOf(dated("stroke")));

  it("is the review's eighteen entries, in its order, where the flat menu had twenty-eight", () => {
    expect(flatHrefs(flat)).toHaveLength(28);
    expect(menu.map((s) => [s.label, s.items.map((i) => i.label)])).toEqual([
      ["", ["Home", "Messages"]],
      ["Set up", ["Event details", "Rounds & formats", "Players", "Prizes & side games"]],
      ["Tee times", ["Tee times & draw"]],
      ["Play", ["Score entry", "Leaderboard"]],
      ["Results", ["Results", "Money & payouts"]],
      ["Club", ["Events", "Members", "Courses", "Seasons & honours", "Club settings"]],
      ["Help", ["Guide & rules", "My round"]],
    ]);
    expect(menu.flatMap((s) => s.items)).toHaveLength(18);
  });

  it("groups the screens that are not merged yet beneath the entry that will hold them", () => {
    const beneath = Object.fromEntries(menu.flatMap((s) => s.items).filter((i) => i.children).map((i) => [i.label, i.children!.map((c) => `${c.label} ${c.href}`)]));
    expect(beneath).toEqual({
      Messages: ["Announcements /announcements"],
      // Setup's one order (`SETUP_ORDER`): the field, then its sides, then its flights.
      Players: ["Entries /registration", "Teams & pairs /teams", "Flights /grouping"],
      "Tee times & draw": ["Print kit /print", "Bracket /bracket", "Team cup /cup", "This week /week"],
      "Money & payouts": ["Side games /group-games"],
      Members: ["Member history /member"],
      "Club settings": ["Staff & helpers /access"],
      "Guide & rules": ["How TourneyHQ works /guide", "Rules reference /rules"],
    });
  });

  it("hides by shape exactly as the flat menu does: a medal has no bracket, cup, week or teams", () => {
    const plain = lifecycleNav(navForRole("admin"), trackOf(dated("stroke")));
    const hrefs = everyEntry(plain).map((i) => i.href);
    for (const gone of ["/bracket", "/cup", "/week", "/teams", "/me"]) expect(hrefs, gone).not.toContain(gone);
    expect(plain.flatMap((s) => s.items).find((i) => i.label === "Players")?.children?.map((c) => c.label)).toEqual(["Entries", "Flights"]);
  });

  it("the club's section and its settings keep the outfit's own words", () => {
    const society = navForRole("admin", undefined, { outfit: { groupLabel: "Society", settingsLabel: "Society settings" } as never });
    const m = lifecycleNav(society, trackOf(dated("stableford")));
    const club = m.find((s) => s.items.some((i) => i.href === "/organization"))!;
    expect(club.label).toBe("Society");
    expect(club.items.find((i) => i.href === "/organization")?.label).toBe("Society settings");
  });

  it("gives every entry its own key, and marks ONE entry as here", () => {
    const keys = everyEntry(menu).map((i) => i.key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    // Two doors, one mark: the screen beneath a group's name, else the first door.
    expect(activeEntryKey(menu, "/registration")).toBe("registration");
    expect(activeEntryKey(menu, "/prizes")).toBe("prizes");
    expect(activeEntryKey(menu, "/event")).toBe("event");
    expect(activeEntryKey(menu, "/print")).toBe("print");
    expect(activeEntryKey(menu, "/account")).toBeNull();
    // The flat menu is marked exactly as it was: the entry whose address this is.
    for (const s of flat) for (const i of s.items) expect(activeEntryKey(flat, i.href), i.href).toBe(i.key);
  });
});

/**
 * THE REDESIGN'S SCREENS IN THE MENU (redesign phase 2, R0; the step 3 design of 13 Nov, amended
 * 14 Nov, §7.2; the test plan's PR 0).
 *
 *   off is step 2   with no screen shown — and none is, as shipped, without `&build=1`, nor in
 *                   production without being an owner — the menu is MAIN's, deep-equal, for every
 *                   role, setting and shape (the frozen file)
 *   on loses no     with every screen shown, every destination the flat menu offers is still one
 *   press           press from the menu (here, or where `relocate()` sends it), and the menu offers
 *                   nothing but those and the rooms they lead into
 *   the children    the Bracket beneath Leaderboard, under today's gate; the event's helpers named
 *                   "Helpers" beneath Club settings, only where `access` is drawn today; the cup's
 *                   teams beneath Players
 */
describe("the redesign's screens in the menu", () => {
  const medal = trackOf(dated("stroke"));
  const ALL_SCREENS: ReadonlySet<ScreenKey> = new Set(SCREEN_KEYS);
  const merged = (role: Role, flat: readonly NavSection[], moves?: readonly Move[], shown: ReadonlySet<ScreenKey> = ALL_SCREENS) =>
    lifecycleNav(flat, medal, { merges: shown, role, moves });
  /** Presses from an open menu to reach `href`: 1 when an entry (or one beneath) opens it. */
  const presses = (menu: readonly NavSection[], href: string) => (everyEntry(menu).some((i) => path(i.href) === path(href)) ? 1 : Infinity);
  /** Where a flat entry's door leads with these screens shown (the menu's Money & payouts is Prizes' payout). */
  /** The screens a flat menu gives this person: no door moves into a room withheld from them. */
  const screensOf = (flat: readonly NavSection[]) => new Set(flat.flatMap((s) => s.items.map((i) => i.key)));
  const leadsTo = (role: Role, shown: ReadonlySet<ScreenKey>, moves: readonly Move[] | undefined, screens: ReadonlySet<string>) => (h: string) => [
    h,
    relocate({ href: h, role, job: h === "/prizes" ? "payout" : undefined, screens }, shown, moves),
  ];
  /** The flat menu's destinations, and where each now leads: all the menu may offer. */
  const mayOffer = (role: Role, flat: readonly NavSection[], shown: ReadonlySet<ScreenKey>, moves?: readonly Move[]) => {
    // The menu's own place on a screen it may open: Courses, on Event details.
    const places = flatHrefs(flat).includes("/event") ? ["/event#courses"] : [];
    return new Set([...flatHrefs(flat), ...places].flatMap(leadsTo(role, shown, moves, screensOf(flat))).map(path));
  };
  /** The screens a menu opens, each once (two doors to one screen are one destination). */
  const destinations = (menu: readonly NavSection[]) => [...new Set(everyEntry(menu).map((i) => path(i.href)))].sort();
  /** Every flat destination is one press from the menu, here or where `relocate()` sends it. */
  const longer = (role: Role, flat: readonly NavSection[], menu: readonly NavSection[], shown: ReadonlySet<ScreenKey>, moves?: readonly Move[]) =>
    flatHrefs(flat).filter((h) => presses(menu, relocate({ href: h, role, screens: screensOf(flat) }, shown, moves)) > presses(flat, h));

  it("switched off as shipped: MAIN's step 2 menu, deep-equal, for every role, setting, shape, family and stage", () => {
    // The menus `main` drew before step 3, frozen in a committed file (`step2-menus.ts` says how):
    // compared with the head, never with the head's own empty-set path, which shares its code.
    const frozen = FROZEN_STEP2 as FrozenMenus;
    const off: Array<[string, ReadonlySet<ScreenKey> | undefined]> = [
      ["no screens passed", undefined],
      ["nothing shown", NO_MERGES],
      ["?stepper=1 on a preview deploy", mergesShown("?stepper=1", { owner: false }, "preview")],
      ["?stepper=1, an owner in production", mergesShown("?stepper=1", { owner: true }, "production")],
      ["?stepper=1&build=1, an owner in production", mergesShown("?stepper=1&build=1", { owner: true }, "production")],
      ["?stepper=1&build=1, a club's staff in production", mergesShown("?stepper=1&build=1", { owner: false }, "production")],
    ];
    let checked = 0;
    for (const c of step2Cases()) {
      const was = frozenMenu(frozen, c.key);
      expect(was, `${c.key} is not in the frozen file`).toBeDefined();
      for (const [how, merges] of off) {
        const now = merges ? lifecycleNav(c.flat, c.track, { roundName: c.roundName, merges, role: c.role }) : lifecycleNav(c.flat, c.track, { roundName: c.roundName });
        expect(now, `${c.key}, ${how}`).toEqual(was);
        checked++;
      }
    }
    expect(checked).toBe(Object.keys(frozen.cases).length * off.length);
    expect(Object.keys(frozen.cases)).toHaveLength(3 * 4 * 64 + 8 * 4);
    // CONTROL: the comparison sees a menu the screens DO change (a knockout's bracket moves)…
    const ko = step2Cases().find((c) => c.key === "admin|no settings|2")!;
    expect(ko.flat.flatMap((s) => s.items).some((i) => i.key === "bracket")).toBe(true);
    expect(lifecycleNav(ko.flat, ko.track, { roundName: ko.roundName, merges: ALL_SCREENS, role: "admin" })).not.toEqual(frozenMenu(frozen, ko.key));
    // …and a frozen menu a label has drifted from (the file is read, not trusted to be empty).
    const drifted = JSON.parse(JSON.stringify(frozenMenu(frozen, ko.key))) as NavSection[];
    drifted[0].items[0].label = "zz-drifted";
    expect(lifecycleNav(ko.flat, ko.track, { roundName: ko.roundName })).not.toEqual(drifted);
  });

  it("with every screen shown, every destination is still one press away, and nothing else is offered", () => {
    let checked = 0;
    for (const role of ROLES) {
      for (const [name, settings] of SETTINGS) {
        for (const shape of SHAPES) {
          const flat = navForRole(role, settings, { ...shape, roundName: "Round 1 of 2 · Stroke Play" });
          const menu = merged(role, flat);
          const where = `${role}, ${name}, ${JSON.stringify(shape)}`;
          // NEVER LOST, second leg: here, or where relocate() sends it — and it is an entry of this menu.
          expect(longer(role, flat, menu, ALL_SCREENS), `a job got longer — ${where}`).toEqual([]);
          const offer = mayOffer(role, flat, ALL_SCREENS);
          expect(everyEntry(menu).map((i) => i.href).filter((h) => !offer.has(path(h))), `offered though withheld — ${where}`).toEqual([]);
          expect(menu.find((s) => s.label === UNPLACED_SECTION), `unplaced — ${where}`).toBeUndefined();
          const keys = everyEntry(menu).map((i) => i.key);
          expect(keys.length, `a key twice — ${where}`).toBe(new Set(keys).size);
          expect(primaryTabs(menu).map((t) => t.href), where).toEqual(primaryTabs(flat).map((t) => t.href));
          checked++;
        }
      }
    }
    expect(checked).toBe(ROLES.length * SETTINGS.length * 32);
  });

  it("each screen shown alone, and each left out, loses nothing either (a series lands one screen at a time)", () => {
    const sets: ReadonlySet<ScreenKey>[] = SCREEN_KEYS.flatMap((k) => [new Set([k]), new Set(SCREEN_KEYS.filter((o) => o !== k))]);
    let checked = 0;
    for (const shown of sets) {
      for (const role of ROLES) {
        for (const shape of [EVERYTHING, {}, { hasKnockout: true }, { hasCup: true }, { isLeague: true, isPlayerToo: true }]) {
          const flat = navForRole(role, { ...DEFAULT_SETTINGS, leaderboardVisibility: "participants", scoreEntryBy: "players" }, shape);
          const menu = merged(role, flat, undefined, shown);
          const where = `${[...shown].join(",")}: ${role}, ${JSON.stringify(shape)}`;
          expect(longer(role, flat, menu, shown), where).toEqual([]);
          expect(menu.find((s) => s.label === UNPLACED_SECTION), where).toBeUndefined();
          checked++;
        }
      }
    }
    expect(checked).toBe(SCREEN_KEYS.length * 2 * ROLES.length * 5);
  });

  it("everything shown: the entries, the destinations, and the children where the design puts them", () => {
    const flat = navForRole("admin", undefined, EVERYTHING);
    const menu = merged("admin", flat);
    expect(menu.flatMap((s) => s.items)).toHaveLength(18);
    // Three doors retire into rooms the menu already has (This week → Leaderboard, Print kit → Tee times
    // & draw, Side games → Money); three are re-pointed (Bracket, Helpers, Courses); two rooms are new.
    expect(destinations(flat)).toHaveLength(28);
    expect(destinations(menu)).toEqual(
      [...destinations(flat).filter((p) => !["/access", "/bracket", "/group-games", "/print", "/week"].includes(p)), "/courses", "/money"].sort(),
    );
    const beneath = Object.fromEntries(menu.flatMap((s) => s.items).filter((i) => i.children).map((i) => [i.label, i.children!.map((c) => `${c.label} ${c.href}`)]));
    expect(beneath).toEqual({
      Messages: ["Announcements /announcements"],
      // In setup's one order (`SETUP_ORDER`), which puts the cup's teams before Teams & pairs.
      Players: ["Entries /registration", "Team cup /cup", "Teams & pairs /teams", "Flights /grouping"],
      Leaderboard: ["Bracket /leaderboard?view=bracket"],
      Members: ["Member history /member"],
      "Club settings": ["Helpers /organization#access"],
      "Guide & rules": ["How TourneyHQ works /guide", "Rules reference /rules"],
    });
    const at = (label: string) => everyEntry(menu).find((i) => i.label === label)?.href;
    expect(at("Money & payouts")).toBe("/money");
    expect(at("Prizes & side games")).toBe("/prizes");
    expect(at("Courses")).toBe("/courses");
    expect(at("Tee times & draw")).toBe("/foursomes");
  });

  it("the press table, menu legs: J2 (add a helper) and J11 (read the bracket) cost 1 from the menu, as today", () => {
    const staff = navForRole("admin", undefined, { hasKnockout: true });
    expect(presses(lifecycleNav(staff, medal), "/access")).toBe(1);
    expect(presses(merged("admin", staff), relocate({ href: "/access", role: "admin" }, ALL_SCREENS))).toBe(1);
    const player = navForRole("player", { ...DEFAULT_SETTINGS, leaderboardVisibility: "participants", scoreEntryBy: "players" }, { hasKnockout: true });
    expect(presses(lifecycleNav(player, medal), "/bracket")).toBe(1);
    expect(presses(merged("player", player), relocate({ href: "/bracket", role: "player" }, ALL_SCREENS))).toBe(1);
    // And each is its own entry, not the room's head: the press lands on the job.
    expect(everyEntry(merged("player", player)).find((i) => i.key === "bracket")?.href).toBe("/leaderboard?view=bracket");
  });

  it("the Bracket child keeps today's gate: a knockout, and a board this person may see", () => {
    const childrenOf = (menu: NavSection[], label: string) => menu.flatMap((s) => s.items).find((i) => i.label === label)?.children?.map((c) => c.label) ?? [];
    expect(childrenOf(merged("admin", navForRole("admin", undefined, { hasKnockout: true })), "Leaderboard")).toEqual(["Bracket"]);
    // No knockout: no Bracket anywhere.
    expect(everyEntry(merged("admin", navForRole("admin"))).some((i) => i.key === "bracket")).toBe(false);
    // A blind event hides it from a player, as the flat menu does.
    const blind = { ...DEFAULT_SETTINGS, leaderboardVisibility: "staff" as const, scoreEntryBy: "players" as const };
    expect(everyEntry(merged("player", navForRole("player", blind, { hasKnockout: true }))).some((i) => i.key === "bracket")).toBe(false);
  });

  it("a player on a blind event keeps the cup's board where it is: their menu has no Leaderboard to move it into", () => {
    const blind = { ...DEFAULT_SETTINGS, leaderboardVisibility: "staff" as const, scoreEntryBy: "players" as const };
    const flat = navForRole("player", blind, { hasCup: true });
    expect(flat.flatMap((s) => s.items).some((i) => i.key === "leaderboard")).toBe(false);
    expect(everyEntry(merged("player", flat)).find((i) => i.key === "cup")?.href).toBe("/cup");
    // CONTROL: with the board open to the field, the same door is retired into the Leaderboard.
    const open = navForRole("player", { ...blind, leaderboardVisibility: "participants" }, { hasCup: true });
    expect(everyEntry(merged("player", open)).some((i) => i.key === "cup")).toBe(false);
  });

  it("the Helpers child only where today's Staff & helpers is: an organizer, with an event open", () => {
    const helpers = (menu: NavSection[]) => everyEntry(menu).filter((i) => i.key === "access").map((i) => `${i.label} ${i.href}`);
    expect(helpers(merged("admin", navForRole("admin")))).toEqual(["Helpers /organization#access"]);
    expect(helpers(lifecycleNav(navForRole("admin"), medal))).toEqual(["Staff & helpers /access"]);
    expect(helpers(merged("assistant", navForRole("assistant")))).toEqual([]);
    // No event open: the flat menu has no access entry (and there is no track, so no lifecycle menu).
    expect(navForRole("admin", undefined, { orgAdminWithoutEvent: true }).flatMap((s) => s.items).some((i) => i.key === "access")).toBe(false);
  });

  it("CONTROL: a door that moves is re-pointed where it stays, retired where it does not — and a retired door with no room in the menu is seen as lost", () => {
    const flat = navForRole("player", { ...DEFAULT_SETTINGS, leaderboardVisibility: "participants", scoreEntryBy: "players" }, { hasKnockout: true, isLeague: true, isPlayerToo: true });
    const moves: Move[] = [
      { from: "/bracket", roles: ["player"], homes: { "read-the-bracket": "leaderboard" }, room: "leaderboard", to: () => "/leaderboard?view=bracket" },
      { from: "/week", roles: ["player"], homes: { "read-the-week": "leaderboard" }, room: "leaderboard", to: () => "/leaderboard?view=week" },
    ];
    const menu = merged("player", flat, moves);
    expect(everyEntry(menu).find((i) => i.key === "bracket")?.href).toBe("/leaderboard?view=bracket");
    expect(everyEntry(menu).some((i) => i.key === "week")).toBe(false);
    expect(longer("player", flat, menu, ALL_SCREENS, moves)).toEqual([]);
    // An organizer's week retired into Winners & money, while no entry of THIS table opens that room
    // (its Money & payouts row is left out): the check names the door.
    const admin = navForRole("admin", undefined, { isLeague: true });
    const toMoney: Move[] = [{ from: "/week", roles: ["admin"], homes: { "read-the-week": "money" }, room: "money", to: () => "/money" }];
    expect(longer("admin", admin, merged("admin", admin, toMoney), ALL_SCREENS, toMoney)).toEqual(["/week"]);
  });
});

describe("the preview stays on as an organizer moves", () => {
  it("every link carries the stepper's query, before a place on the screen", () => {
    expect(keepPreview("/dashboard")).toBe("/dashboard?stepper=1");
    expect(keepPreview("/stages?round=r1")).toBe("/stages?round=r1&stepper=1");
    expect(keepPreview("/event#courses")).toBe("/event?stepper=1#courses");
  });
});
