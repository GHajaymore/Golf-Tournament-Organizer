import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StandingRow } from "@/components/LeaderboardTable";

/**
 * Do these screens actually render?
 *
 * Every component below was written, typechecked and shipped without once
 * being displayed. TypeScript proves the props line up; it says nothing about
 * a component that reads `rows[0].name` on an empty list, or maps over
 * something that arrives null, or divides by a zero count. Those are render
 * crashes, and they only appear when something renders.
 *
 * So this renders each one — with realistic data, and again with the empty and
 * degenerate inputs a real screen hits on its first day, before anyone has
 * entered anything. It is not a substitute for looking at the page, and it
 * makes no claim about whether any of it looks right. It only proves the
 * screens come up.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Server actions are "use server" modules that pull in Prisma. The components
// only hold references to them until a click, so a no-op stands in for any
// name a component imports. The Proxy means adding an action never breaks a
// render test — the factory is hoisted, so it can't call a helper up here.
// A function declaration, not a const: vi.mock is hoisted above everything, so
// only a declaration is initialized by the time the factory runs.
function actionModule() {
  return new Proxy(
    {},
    {
      // `then` must stay undefined. A module namespace with a callable `then`
      // is a thenable, and `await import(...)` hangs forever waiting on it.
      get: (_t, key) =>
        typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined,
    },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/series", actionModule);
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/teams", actionModule);
vi.mock("@/app/actions/organization", actionModule);
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/event", actionModule);
vi.mock("@/app/actions/stages", actionModule);
vi.mock("@/app/actions/roster", actionModule);

import { SeriesClient } from "@/components/SeriesClient";
import { TeeEditor } from "@/components/TeeEditor";
import { TeamsClient } from "@/components/TeamsClient";
import { TeamEntryClient } from "@/components/TeamEntryClient";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import {
  SkinsLeaderboard,
  NassauLeaderboard,
  ModifiedStablefordLeaderboard,
} from "@/components/PointsLeaderboard";
import { ThemePicker } from "@/components/ThemePicker";
import { DEFAULT_CLUB_THEME, type ClubTheme } from "@/lib/themes";
import { BracketModePicker } from "@/components/BracketModePicker";
import { CreateFirstTournament } from "@/components/CreateFirstTournament";
import { StagesClient, type StageView } from "@/components/StagesClient";
import { CourseLibrary } from "@/components/CourseLibrary";
import { EventSwitcher } from "@/components/EventSwitcher";
import { FlightBoard, type FlightCard } from "@/components/FlightBoard";
import { FoursomeMaker } from "@/components/FoursomeMaker";
import { CutControl } from "@/components/CutControl";
import { ScoreImport } from "@/components/ScoreImport";
import { TeeSheetPrint } from "@/components/TeeSheetPrint";
import { CourseSetupPrompt } from "@/components/CourseSetupPrompt";
import { StrokePlayEntry } from "@/components/StrokePlayEntry";
import { RoundDeadlineControl } from "@/components/RoundDeadlineControl";
import { ScoreEntryClient, defaultEntryMode, type EntryMatch } from "@/components/ScoreEntryClient";
import { RosterClient, ImportSummary, type RosterRow } from "@/components/RosterClient";
import { AccessClient, RoleChangeConfirm } from "@/components/AccessClient";
import { describeRoleChange } from "@/lib/access-roles";
import type { MemberImportResult } from "@/app/actions/roster";
import { playSkins } from "@/lib/domain/skins";
import { playNassau } from "@/lib/domain/nassau";
import type { HoleResult } from "@/lib/domain/types";

/**
 * React reports missing keys, invalid nesting and bad props by writing to
 * console.error and rendering anyway — so a screen with a real reconciliation
 * bug still returns markup and still "passes". Capture those and fail on them,
 * or this suite only catches outright throws.
 *
 * The first thing it found was a keyless fragment in the standings table.
 */
let warnings: string[] = [];
let realError: typeof console.error;

beforeEach(() => {
  warnings = [];
  realError = console.error;
  console.error = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
});

afterEach(() => {
  console.error = realError;
  expect(warnings, "React logged a warning while rendering").toEqual([]);
});

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("season standings", () => {
  const season = {
    id: "s1", name: "Winter League", description: "",
    pointsTable: [100, 80, 65], bestOf: 0, minEvents: 0, status: "active", eventCount: 2,
  };
  const standing = (over = {}) => ({
    memberId: "m1", name: "Ann Doyle", total: 165, played: 2, position: 1,
    finishes: [1, 3],
    entries: [
      { eventId: "e1", eventName: "Round 1", rank: 1, points: 100, counted: true },
      { eventId: "e2", eventName: "Round 2", rank: 3, points: 65, counted: true },
    ],
    ...over,
  });

  it("renders an empty club with no seasons at all", () => {
    // The first thing a club ever sees on this screen.
    const html = render(
      <SeriesClient seasons={[]} activeId={null} events={[]} standings={[]} unlinked={0}
        currentEventId="e1" currentEventSeriesId={null} canEdit />,
    );
    expect(html).toContain("No seasons yet");
    expect(html).toContain("Start a season");
  });

  it("renders a season with no finished rounds", () => {
    const html = render(
      <SeriesClient seasons={[season]} activeId="s1"
        events={[{ id: "e1", name: "Round 1", dates: "", counted: false }]}
        standings={[]} unlinked={0} currentEventId="e1" currentEventSeriesId={null} canEdit />,
    );
    expect(html).toContain("No finished rounds yet");
    expect(html).toContain("Round 1");
  });

  it("renders a populated table with the points scheme described", () => {
    const html = render(
      <SeriesClient seasons={[season]} activeId="s1"
        events={[{ id: "e1", name: "Round 1", dates: "", counted: true }]}
        standings={[standing()]} unlinked={0} currentEventId="e1" currentEventSeriesId="s1" canEdit />,
    );
    expect(html).toContain("Ann Doyle");
    expect(html).toContain("165");
    expect(html).toContain("100, 80, 65");
  });

  it("renders an unranked player without crashing on the null position", () => {
    // position is null for anyone short of the minimum, and the cell has to
    // cope rather than printing "null".
    const html = render(
      <SeriesClient seasons={[{ ...season, minEvents: 3 }]} activeId="s1" events={[]}
        standings={[standing({ position: null, played: 1 })]} unlinked={2}
        currentEventId="" currentEventSeriesId={null} canEdit={false} />,
    );
    expect(html).not.toContain("null");
    expect(html).toContain("no roster record");
  });

  it("renders fractional points from a shared position", () => {
    const html = render(
      <SeriesClient seasons={[season]} activeId="s1" events={[]}
        standings={[standing({ total: 72.5 })]} unlinked={0}
        currentEventId="" currentEventSeriesId={null} canEdit />,
    );
    expect(html).toContain("72.5");
  });
});

describe("tees and ratings", () => {
  it("renders a course with no tees and explains the consequence", () => {
    const html = render(<TeeEditor courseId="c1" tees={[]} canEdit />);
    expect(html).toContain("No tees yet");
    expect(html).toContain("raw handicap index");
  });

  it("renders rated and unrated tees, showing what a 14.0 plays off", () => {
    const html = render(
      <TeeEditor courseId="c1" canEdit
        tees={[
          { id: "t1", name: "Blue", gender: "men", courseRating: 71.5, slopeRating: 125, par: 72, rated: true },
          { id: "t2", name: "Red", gender: "women", courseRating: 0, slopeRating: 0, par: 72, rated: false },
        ]} />,
    );
    expect(html).toContain("Blue");
    expect(html).toContain("Red");
    // 14 off 125 slope with a 71.5/72 rating is 15 — the worked example that
    // lets an organizer sanity-check a transposed number.
    expect(html).toContain(">15<");
    expect(html).toContain("no rating yet");
  });

  it("hides the controls from someone who can't edit", () => {
    const html = render(
      <TeeEditor courseId="c1" canEdit={false}
        tees={[{ id: "t1", name: "Blue", gender: "any", courseRating: 71.5, slopeRating: 125, par: 72, rated: true }]} />,
    );
    expect(html).not.toContain("Add tees");
  });
});

describe("team screens", () => {
  const format = {
    name: "Four-Ball", desc: "Two against two.", min: 2, max: 2,
    sharesOneCard: false, allowance: 90, recommendedAllowance: 90,
    allowanceOverridden: false, allowanceIsConvention: false,
    // Four-Ball takes a flat percentage of the combined handicaps, so it has
    // no per-player split and the split control must not appear.
    shares: null, recommendedShares: null, sharesOverridden: false,
    // It does aggregate separate balls, so it does have a "how many count".
    countBest: 1, countBestOverridden: false, maxCountBest: 2,
  };

  it("renders the teams screen with no sides drawn", () => {
    const html = render(
      <TeamsClient rounds={[{ id: "r1", label: "Round 1 — Four-Ball", format: "Four-Ball" }]}
        activeRoundId="r1" format={format} teams={[]} problems={[]} unassigned={[]} matchCount={0} />,
    );
    expect(html).toContain("Four-Ball");
    expect(html).toContain("Draw sides automatically");
  });

  it("renders sides, their problems, and the unassigned list", () => {
    const html = render(
      <TeamsClient rounds={[{ id: "r1", label: "Round 1", format: "Four-Ball" }]} activeRoundId="r1"
        format={format}
        teams={[{ id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: 14,
          members: [{ playerId: "p1", name: "Ann", handicap: 8, position: 0 }] }]}
        problems={[{ teamId: "t1", teamName: "Side A", problem: "has 1 of 2 players" }]}
        unassigned={[{ id: "p2", name: "Bob", handicap: 20 }]} matchCount={0} />,
    );
    expect(html).toContain("Side A");
    expect(html).toContain("has 1 of 2 players");
    expect(html).toContain("Bob");
  });

  it("states the round's handicap terms and points at where they are set", () => {
    // The controls themselves moved onto the round card, because they are
    // settings of the round and this screen had its own round selector — the
    // same round was being configured in two places. What stays is a summary
    // so nobody has to guess what the sides are playing off, and a link.
    const html = render(
      <TeamsClient rounds={[{ id: "r1", label: "R1", format: "Scramble" }]} activeRoundId="r1"
        format={{ ...format, name: "Scramble", min: 4, max: 4, sharesOneCard: true,
          allowance: 25, recommendedAllowance: 25, allowanceIsConvention: true }}
        teams={[]} problems={[]} unassigned={[]} matchCount={0} />,
    );
    expect(html).toContain("Handicap allowance");
    expect(html).toContain("25%");
    expect(html).toContain('href="/stages"');
    // No editing here any more — one home, not two.
    expect(html).not.toContain("aria-label=\"Handicap allowance percent\"");
  });

  it("renders team score entry for both card shapes", () => {
    const own = render(
      <TeamEntryClient round="Four-Ball" sharesOneCard={false} holes={18}
        pars={Array(18).fill(4)} strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        teams={[{ teamId: "t1", teamName: "Side A", matchId: "m1", opponentName: "Side B",
          playingHandicap: 14, grossTotal: 0, netTotal: 0, played: 0,
          cards: [{ playerId: "p1", playerName: "Ann", handicap: 8, strokes: Array(18).fill(null) }] }]} />,
    );
    expect(own).toContain("one card each");
    expect(own).toContain("Ann");

    const shared = render(
      <TeamEntryClient round="Scramble" sharesOneCard holes={18}
        pars={Array(18).fill(4)} strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        teams={[{ teamId: "t1", teamName: "Side A", matchId: "", playingHandicap: 7,
          grossTotal: 0, netTotal: 0, played: 0,
          cards: [{ playerId: "", playerName: "", handicap: 0, strokes: Array(18).fill(null) }] }]} />,
    );
    expect(shared).toContain("one card per side");
    expect(shared).toContain("Team card");
  });

  it("renders team entry with no sides drawn", () => {
    const html = render(
      <TeamEntryClient round="Scramble" sharesOneCard holes={18} pars={[]} strokeIndex={[]} teams={[]} />,
    );
    expect(html).toContain("No sides drawn yet");
  });
});

describe("leaderboards for every format", () => {
  it("renders a team board, unplayed sides unranked", () => {
    const html = render(
      <TeamLeaderboard format="Scramble" stableford={false}
        rows={[
          { teamId: "t1", name: "Side A", members: ["Ann", "Bob"], playingHandicap: 7,
            gross: 72, net: 65, points: 0, played: 18, toPar: 0 },
          { teamId: "t2", name: "Side B", members: [], playingHandicap: 0,
            gross: 0, net: 0, points: 0, played: 0, toPar: 0 },
        ]} />,
    );
    expect(html).toContain("Side A");
    expect(html).toContain("No players");
    expect(html).toContain("unranked");
  });

  it("renders an empty team board", () => {
    const html = render(<TeamLeaderboard format="Four-Ball" stableford={false} rows={[]} />);
    expect(html).toContain("No sides drawn");
  });

  it("renders skins including the carry and the unclaimed pot", () => {
    const outcome = playSkins(
      [
        { playerId: "a", strokes: [4, 4, 3], courseHandicap: 0 },
        { playerId: "b", strokes: [4, 4, 4], courseHandicap: 0 },
      ],
      3,
    );
    const html = render(
      <SkinsLeaderboard net={false} board={{ outcome, nameById: { a: "Ann", b: "Bob" } }} />,
    );
    expect(html).toContain("Ann");
    expect(html).toContain("Tied — carried");
  });

  it("renders skins before a single hole is decided", () => {
    const html = render(
      <SkinsLeaderboard net board={{ outcome: playSkins([], 18), nameById: {} }} />,
    );
    expect(html).toContain("No holes decided yet");
  });

  it("renders a Nassau's three segments", () => {
    const holes = ([] as HoleResult[]).concat(Array(9).fill("A"), Array(9).fill("B"));
    const html = render(
      <NassauLeaderboard rows={[{ matchId: "m1", aName: "Ann", bName: "Bob", outcome: playNassau(holes) }]} />,
    );
    expect(html).toContain("Front nine");
    expect(html).toContain("Back nine");
    expect(html).toContain("Overall 18");
  });

  it("renders a Nassau with no matches", () => {
    expect(render(<NassauLeaderboard rows={[]} />)).toContain("No matches in this round yet");
  });

  it("renders modified Stableford, including a negative total", () => {
    // The format has no floor at zero, so the board must not choke on it.
    const html = render(
      <ModifiedStablefordLeaderboard
        rows={[{ playerId: "p1", name: "Ann", handicap: 12, points: -4, played: 18, gross: 95 }]} />,
    );
    expect(html).toContain("Ann");
    expect(html).toContain("-4");
  });
});

describe("rounds and format", () => {
  const stage = (over: Partial<StageView> = {}): StageView => ({
    id: "r1", position: 1, type: "Round Robin", description: "", format: "Match Play",
    holes: 18, playedOn: "", deadline: "", scoringBasis: "gross", carryEnabled: false, carryPct: 0,
    carryAsked: false, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall", deadlineOverride: null, optDeadline: "", attendance: null,
    matchCount: 0, courseId: null, nine: "full", teamScoring: null, ...over,
  });
  const base = {
    rrMatchesPerPlayer: 3,
    scoring: { winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 },
    tiebreakers: [] as never[],
    qual: { mode: "overall", perFlight: 2, overall: 8 },
    confirmedCount: 32,
  };

  it("renders a single-round tournament with no chaining controls", () => {
    const html = render(<StagesClient {...base} stages={[stage()]} chainsRounds={false} />);
    expect(html).toContain("Match Play");
    expect(html).not.toContain("Carry forward");
  });

  it("asks the carry-forward question on a points-based chain", () => {
    // Two Round Robin rounds scored on points: the second round's total is
    // ambiguous until someone says whether round one carries into it.
    const html = render(
      <StagesClient {...base} chainsRounds
        stages={[stage(), stage({ id: "r2", position: 2, carryAsked: false })]} />,
    );
    expect(html).toContain("Carry forward");
  });

  it("warns when a carried-forward round changes what it measures", () => {
    // Match play produces points, stroke play produces strokes. Carrying one
    // into the other yields a number that means nothing, and the card says so.
    const html = render(
      <StagesClient {...base} chainsRounds
        stages={[
          stage(),
          stage({ id: "r2", position: 2, format: "Stroke Play", carryEnabled: true, carryPct: 100, carryAsked: true }),
        ]} />,
    );
    expect(html).toContain("doesn&#x27;t mean anything");
  });

  it("stays quiet when consecutive rounds don't chain", () => {
    // Two unrelated formats side by side with no carry and no cut is an
    // ordinary multi-format event, not a mistake — warning there is noise.
    const html = render(
      <StagesClient {...base} chainsRounds
        stages={[stage(), stage({ id: "r2", position: 2, format: "Stroke Play", carryAsked: true })]} />,
    );
    expect(html).not.toContain("follows on");
  });

  it("shows the unrated-tees warning when one is passed", () => {
    const html = render(
      <StagesClient {...base} stages={[stage({ scoringBasis: "net" })]}
        handicapWarning="Bushwood has no course rating, so net scores use raw handicap index." />,
    );
    expect(html).toContain("no course rating");
  });

  it("shows the venue picker only when the tournament has several courses", () => {
    const one = render(<StagesClient {...base} stages={[stage()]} venues={[{ id: "c1", name: "Bushwood" }]} />);
    const two = render(
      <StagesClient {...base} stages={[stage()]}
        venues={[{ id: "c1", name: "Bushwood" }, { id: "c2", name: "Augusta" }]} />,
    );
    expect(two).toContain("Augusta");
    expect(one.match(/Bushwood/g)?.length ?? 0).toBeLessThan(two.match(/Bushwood/g)?.length ?? 99);
  });

  it("knows a stroke-play round follows a round robin, whatever the format", () => {
    // The bug: the chain looked only for the next Round Robin, so a match-play
    // round feeding a stroke-play final reported "No round after this yet" and
    // offered no cut into it. The next round is the next round the field plays.
    const html = render(
      <StagesClient {...base} chainsRounds
        stages={[
          stage({ id: "r1", position: 0, type: "Round Robin" }),
          stage({ id: "r2", position: 1, type: "Stroke Play Round", format: "Stroke Play", carryAsked: true }),
        ]} />,
    );
    expect(html).not.toContain("No round after this yet");
    expect(html).toContain("Into Round 2");
  });

  it("still says so when a round in a chain genuinely has no next round", () => {
    const html = render(<StagesClient {...base} chainsRounds stages={[stage({ id: "r1", position: 0 })]} />);
    expect(html).toContain("No round after this yet");
  });

  it("renders a tournament with no rounds at all", () => {
    expect(() => render(<StagesClient {...base} stages={[]} />)).not.toThrow();
  });
});

describe("course library", () => {
  const course = {
    id: "c1", name: "Bushwood", city: "Chicago",
    pars: Array(18).fill(4), yards: Array(18).fill(400),
    strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    inEvent: true, source: "manual", verified: true, verifiedBy: "", sourceUrl: "",
    tees: [{ id: "t1", name: "Blue", gender: "men", courseRating: 71.5, slopeRating: 125, par: 72, rated: true }],
  };

  it("offers to paste a card when the library is empty", () => {
    // Was a row of buttons for four invented courses. Pasting the real card
    // off the club website is the same number of clicks and is the actual
    // course.
    const html = render(<CourseLibrary courses={[]} canEdit />);
    expect(html).toContain("Paste a card");
    expect(html).not.toContain("Ridgeline");
  });

  it("renders a course with its tees and marks the club's home course", () => {
    const html = render(
      <CourseLibrary courses={[course]} canEdit homeCourse="Bushwood" />,
    );
    expect(html).toContain("Bushwood");
    expect(html).toContain("Blue");
  });

  it("renders a course with no holes entered yet", () => {
    const html = render(
      <CourseLibrary courses={[{ ...course, pars: [], yards: [], strokeIndex: [], tees: [] }]}
        canEdit={false} />,
    );
    expect(html).toContain("Bushwood");
  });
});

describe("event switcher", () => {
  const event = {
    id: "e1", name: "Ajay More Invitational", status: "live", dates: "12–14 Jun",
    course: "Bushwood", players: 32, isActive: true, hasAccess: true, isOrganizer: true,
  };

  it("renders the list with the active event marked", () => {
    const html = render(<EventSwitcher events={[event]} />);
    expect(html).toContain("Ajay More Invitational");
    expect(html).toContain("32");
  });

  it("renders an event the viewer can't open", () => {
    const html = render(
      <EventSwitcher events={[{ ...event, hasAccess: false, isOrganizer: false, isActive: false }]} />,
    );
    expect(html).toContain("Ajay More Invitational");
  });

  it("renders with no events", () => {
    expect(() => render(<EventSwitcher events={[]} />)).not.toThrow();
  });
});

describe("settings screens", () => {
  const theme = (over: Partial<ClubTheme> = {}): ClubTheme => ({
    ...DEFAULT_CLUB_THEME, ...over,
  });

  it("renders the theme picker with a preset selected", () => {
    const html = render(<ThemePicker theme={theme({ accentKey: "claret" })} readOnly={false} />);
    expect(html).toContain("Club colour");
    expect(html).toContain("Claret");
    expect(html).toContain("Fairway");
  });

  it("renders every appearance option, and the preview in each", () => {
    for (const appearance of ["dark", "light", "auto"] as const) {
      const html = render(<ThemePicker theme={theme({ appearance })} readOnly={false} />);
      expect(html, appearance).toContain("Follow the device");
      expect(html, appearance).toContain("Leaderboard");
      expect(html, appearance).toContain("Ann Doyle");
    }
  });

  it("renders a custom colour and warns when it is dim outdoors", () => {
    // Deep blue clears WCAG indoors and fails the sunlight bar.
    const html = render(
      <ThemePicker theme={theme({ accentKey: "custom", accentHex: "#0000cc" })} readOnly={false} />,
    );
    expect(html).toContain("sunlight");
  });

  it("survives a custom theme with a nonsense colour", () => {
    const html = render(
      <ThemePicker theme={theme({ accentKey: "custom", accentHex: "not-a-colour" })} readOnly={false} />,
    );
    expect(html).toContain("Club colour");
  });

  it("renders a two-colour club, naming the second colour", () => {
    const html = render(
      <ThemePicker theme={theme({ accentKey: "links", secondaryKey: "bunker" })} readOnly={false} />,
    );
    expect(html).toContain("+ Bunker");
  });

  it("offers no save controls to someone who can't edit", () => {
    const html = render(<ThemePicker theme={theme()} readOnly />);
    expect(html).not.toContain("Save theme");
  });

  it("renders the bracket arrangement picker for each mode", () => {
    for (const [mode, label] of [["single", "One bracket"], ["split", "Two flights"], ["plate", "Main + plate"]] as const) {
      const html = render(<BracketModePicker mode={mode} secondLabel="Plate" readOnly={false} />);
      expect(html, mode).toContain(label);
    }
  });

  it("renders the create-tournament form with shape and retention notice", () => {
    const html = render(<CreateFirstTournament first plan="free" />);
    expect(html).toContain("How is it played?");
    expect(html).toContain("A single round");
    expect(html).toContain("permanently deleted");
  });

  it("omits the retention notice on a plan that keeps data", () => {
    const html = render(<CreateFirstTournament first plan="club" />);
    expect(html).not.toContain("permanently deleted");
  });
});

describe("roster CSV import", () => {
  const row = (over: Partial<RosterRow> = {}): RosterRow => ({
    id: "m1", name: "Ann Doyle", email: "ann@x.test", phone: "", ghin: "", homeClub: "",
    gender: "", preferredTee: "", memberNumber: "", handicap: 12.4, handicapType: "18",
    handicapSource: "manual", status: "active", notes: "", entryCount: 0, lastEvent: "",
    entered: false, ...over,
  });
  const result = (over: Partial<MemberImportResult> = {}): MemberImportResult => ({
    imported: 0, updated: 0, skippedDuplicates: 0, skippedInvalid: 0, unknownColumns: [], ...over,
  });

  it("offers both ways of adding someone", () => {
    const html = render(
      <RosterClient clubName="Bushwood" isClub eventName="Spring Medal" fieldLocked={false} members={[]} />,
    );
    expect(html).toContain("Add member");
    expect(html).toContain("Import CSV");
    expect(html).toContain('accept=".csv,text/csv"');
  });

  it("renders a populated roster", () => {
    const html = render(
      <RosterClient clubName="Bushwood" isClub eventName="Spring Medal" fieldLocked={false}
        members={[row(), row({ id: "m2", name: "Rob Ferris", status: "inactive" })]} />,
    );
    expect(html).toContain("Ann Doyle");
  });

  it("reports additions and updates separately", () => {
    // The distinction that matters: "142 added" after a re-upload would mean
    // the roster had just doubled.
    const html = render(<ImportSummary result={result({ imported: 12, updated: 130 })} onDismiss={() => {}} />);
    expect(html).toContain("12 added");
    expect(html).toContain("130 updated");
  });

  it("says plainly when a file changed nothing", () => {
    const html = render(<ImportSummary result={result({ skippedDuplicates: 61 })} onDismiss={() => {}} />);
    expect(html).toContain("61 already up to date");
  });

  it("explains why rows were skipped rather than just counting them", () => {
    const html = render(<ImportSummary result={result({ imported: 3, skippedInvalid: 2 })} onDismiss={() => {}} />);
    expect(html).toContain("2 skipped");
    expect(html).toContain("no name");
  });

  it("names the columns it ignored", () => {
    // A file whose handicaps all imported as zero because the column was
    // headed "Playing Hcp" is otherwise a silent, plausible-looking failure.
    const html = render(
      <ImportSummary result={result({ imported: 61, unknownColumns: ["Playing Hcp", "Section"] })} onDismiss={() => {}} />,
    );
    expect(html).toContain("Playing Hcp");
    expect(html).toContain("Section");
    expect(html).toContain("Ignored columns");
  });

  it("uses the singular for one ignored column", () => {
    const html = render(<ImportSummary result={result({ imported: 1, unknownColumns: ["Section"] })} onDismiss={() => {}} />);
    expect(html).toContain("Ignored column:");
    expect(html).not.toContain("Ignored columns");
  });

  it("shows a header error as an error, not a success", () => {
    const html = render(
      <ImportSummary result={result({ error: "Couldn't find a name column in the header row." })} onDismiss={() => {}} />,
    );
    expect(html).toContain("name column");
    expect(html).toContain("ph-warning-circle");
    expect(html).not.toContain("ph-check-circle");
  });

  it("does not claim success when every row was already present", () => {
    const html = render(<ImportSummary result={result()} onDismiss={() => {}} />);
    expect(html).toContain("Nothing to import");
  });
});

describe("access control — no stray re-roles", () => {
  const accounts = [
    { id: "a1", name: "Ann Doyle", email: "ann@x.test", role: "admin" },
    { id: "a2", name: "Rob Ferris", email: "rob@x.test", role: "player" },
  ];

  it("shows the roles without any pending confirmation on first paint", () => {
    // The bug was a control that acted on change. On load there is nothing to
    // confirm and no way it could have already fired.
    const html = render(<AccessClient accounts={accounts} />);
    expect(html).toContain("Ann Doyle");
    expect(html).toContain("Organizer");
    expect(html).not.toContain("Yes — make");
    expect(html).not.toContain("Cancel");
  });

  it("restates a plain change in full, not just 'Confirm'", () => {
    const change = describeRoleChange({ name: "Rob Ferris", role: "player" }, "assistant", 2);
    const html = render(
      <RoleChangeConfirm change={change!} pending={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("Rob Ferris");
    expect(html).toContain("Yes — make Rob Ferris Assistant");
    // A promotion is not dressed up as a loss.
    expect(html).not.toContain("loses");
  });

  it("says what a demotion gives up", () => {
    const change = describeRoleChange({ name: "Ann Doyle", role: "admin" }, "player", 2);
    const html = render(
      <RoleChangeConfirm change={change!} pending={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("loses Organizer access");
  });

  it("warns before anyone tries to demote the only organizer", () => {
    const change = describeRoleChange({ name: "Ann Doyle", role: "admin" }, "assistant", 1);
    const html = render(
      <RoleChangeConfirm change={change!} pending={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("only Organizer");
  });

  it("holds the save while a change is in flight", () => {
    const change = describeRoleChange({ name: "Rob Ferris", role: "player" }, "admin", 2);
    const html = render(
      <RoleChangeConfirm change={change!} pending onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("Saving…");
    expect(html).toContain("disabled");
  });
});

describe("flight board", () => {
  const card = (id: string, label: string, players: Array<[string, string, number]>): FlightCard => ({
    id, label, avg: 12,
    players: players.map(([pid, name, handicap]) => ({ id: pid, name, handicap })),
  });
  const two = [
    card("g1", "Flight 1", [["p1", "Ann Doyle", 8], ["p2", "Rob Ferris", 14]]),
    card("g2", "Flight 2", [["p3", "S. Kaur", 19]]),
  ];

  it("renders players and offers both ways to move them", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed={false} />);
    expect(html).toContain("Ann Doyle");
    expect(html).toContain("Drag a player onto another flight");
    // The keyboard/touch route: a select per row listing every flight.
    expect(html).toContain("Move Ann Doyle to another flight");
  });

  it("offers no way to move anything once setup is locked", () => {
    const html = render(<FlightBoard cards={two} locked canEdit confirmed={false} />);
    expect(html).toContain("Ann Doyle");
    expect(html).not.toContain("Drag a player");
    expect(html).not.toContain("Move Ann Doyle to another flight");
    expect(html).not.toContain('draggable="true"');
  });

  it("offers no way to move anything to someone who can't edit", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit={false} confirmed={false} />);
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("Move Ann Doyle to another flight");
  });

  it("invites a drop on an empty flight rather than looking broken", () => {
    const html = render(
      <FlightBoard cards={[two[0], card("g2", "Flight 2", [])]} locked={false} canEdit confirmed={false} />,
    );
    expect(html).toContain("Empty — drop a player here");
  });

  it("hides the move menu when there is nowhere else to go", () => {
    // One flight means every option is the flight they are already in, so
    // neither the menu nor the drag invitation has anywhere to point.
    const html = render(<FlightBoard cards={[two[0]]} locked={false} canEdit confirmed={false} />);
    expect(html).not.toContain("Move Ann Doyle to another flight");
    expect(html).not.toContain("Drag a player");
  });

  it("renders with no flights at all", () => {
    expect(() => render(<FlightBoard cards={[]} locked={false} canEdit confirmed={false} />)).not.toThrow();
  });
});

describe("round card — which nine and the deadline", () => {
  const stage = (over: Partial<StageView> = {}): StageView => ({
    id: "r1", position: 1, type: "Round Robin", description: "", format: "Match Play",
    holes: 18, playedOn: "", deadline: "", scoringBasis: "gross", carryEnabled: false, carryPct: 0,
    carryAsked: true, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall", deadlineOverride: null, optDeadline: "", attendance: null,
    matchCount: 0, courseId: null, nine: "full", teamScoring: null, ...over,
  });
  const base = {
    rrMatchesPerPlayer: 3,
    scoring: { winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 },
    tiebreakers: [] as never[],
    qual: { mode: "overall", perFlight: 2, overall: 8 },
    confirmedCount: 32,
  };

  it("does not ask which nine on an 18-hole round", () => {
    const html = render(<StagesClient {...base} stages={[stage({ holes: 18 })]} />);
    expect(html).not.toContain("Which nine");
  });

  it("offers a not-fixed answer for a shotgun or a multi-course round", () => {
    // Front-or-back was a forced choice, and a shotgun start genuinely has no
    // answer — groups go out on both nines at once.
    const html = render(<StagesClient {...base} stages={[stage({ holes: 9 })]} />);
    expect(html).toContain("Which nine");
    expect(html).toContain("Front nine");
    expect(html).toContain("Back nine");
    expect(html).toContain("Not fixed");
  });

  it("keeps 'not fixed' selected instead of snapping back to front", () => {
    const html = render(<StagesClient {...base} stages={[stage({ holes: 9, nine: "full" })]} />);
    expect(html).toMatch(/<option value="full" selected="">/);
  });

  it("keeps an explicitly chosen back nine", () => {
    const html = render(<StagesClient {...base} stages={[stage({ holes: 9, nine: "back" })]} />);
    expect(html).toMatch(/<option value="back" selected="">/);
  });
});

describe("confirming a manual draw", () => {
  const two: FlightCard[] = [
    { id: "g1", label: "A Flight", avg: 11, players: [{ id: "p1", name: "Ann Doyle", handicap: 8 }] },
    { id: "g2", label: "B Flight", avg: 19, players: [{ id: "p2", name: "S. Kaur", handicap: 19 }] },
  ];

  it("offers Confirm while the draw is open", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed={false} />);
    expect(html).toContain("Confirm flights");
    expect(html).not.toContain("Edit flights");
    expect(html).toContain('draggable="true"');
  });

  it("locks dragging once confirmed, and offers Edit to reopen", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed />);
    expect(html).toContain("Draw confirmed");
    expect(html).toContain("Edit flights");
    expect(html).not.toContain("Confirm flights");
    // The whole point of confirming: it stops being one stray drag from
    // being different.
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("Move Ann Doyle to another flight");
  });

  it("still shows the players when confirmed", () => {
    // Confirmed is read-only, not hidden.
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed />);
    expect(html).toContain("Ann Doyle");
    expect(html).toContain("A Flight");
  });

  it("offers neither button to someone who can't edit", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit={false} confirmed={false} />);
    expect(html).not.toContain("Confirm flights");
    expect(html).not.toContain("Edit flights");
  });

  it("offers neither once setup is locked", () => {
    const html = render(<FlightBoard cards={two} locked canEdit confirmed={false} />);
    expect(html).not.toContain("Confirm flights");
    expect(html).not.toContain("Edit flights");
  });

  it("uses the club's own flight names", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed={false} />);
    expect(html).toContain("A Flight");
    expect(html).toContain("B Flight");
    expect(html).not.toContain("Flight 1");
  });

  it("offers a rename control per flight", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed={false} />);
    expect(html).toContain("Rename A Flight");
    expect(html).toContain("Rename B Flight");
  });

  it("offers rename even on a confirmed draw", () => {
    // Naming is labelling, not membership — correcting a typo shouldn't mean
    // reopening a signed-off draw.
    const html = render(<FlightBoard cards={two} locked={false} canEdit confirmed />);
    expect(html).toContain("Rename A Flight");
  });

  it("offers no rename to someone who can't edit", () => {
    const html = render(<FlightBoard cards={two} locked={false} canEdit={false} confirmed={false} />);
    expect(html).not.toContain("Rename A Flight");
  });
});

describe("tee sheet", () => {
  const field = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    handicap: i,
    seed: i + 1,
  }));

  it("hides the leaderboard options before a round has been played", () => {
    // Round one: offering "leaders out last" with nothing on the board would
    // draw the sheet off nothing at all.
    const html = render(<FoursomeMaker players={field} />);
    expect(html).toContain("No scores posted yet");
    expect(html).toContain("Order off the tee");
  });

  it("offers them once there are standings", () => {
    const standings = field.map((p, i) => ({ playerId: p.id, position: i + 1 }));
    const html = render(<FoursomeMaker players={field} standings={standings} />);
    expect(html).not.toContain("No scores posted yet");
    expect(html).toContain("Leaders out last");
    expect(html).toContain("By position");
  });

  it("gives every group a time and a starting hole", () => {
    const html = render(<FoursomeMaker players={field} />);
    expect(html).toContain("Hole 1 · 8:00 AM");
  });
});

describe("score entry lands on the right card without asking", () => {
  const match: EntryMatch = {
    id: "m1",
    aId: "a",
    bId: "b",
    aName: "Alex Vaughn",
    bName: "Sam Okafor",
    aHandicap: 8,
    bHandicap: 12,
    groupName: "Flight 1",
    round: 1,
    holes: new Array(18).fill(null),
    status: "pending",
    aStrokes: new Array(18).fill(null),
    bStrokes: new Array(18).fill(null),
  };

  it("shows every shape match play can be recorded as", () => {
    // Visible, not hidden. The format decides which exist and the round
    // decides which is preselected — but the choice between what remains is
    // the organizer's, and it belongs in front of them.
    const html = render(<ScoreEntryClient matches={[match]} format="Match Play" isStaff />);
    expect(html).toContain("mode-pick");
    expect(html).toContain("Hole-by-hole result");
    expect(html).toContain("Full scorecard");
    expect(html).toContain("Final result only");
  });

  it("does not offer a change when the format allows only one shape", () => {
    const html = render(<ScoreEntryClient matches={[match]} format="Stableford" isStaff />);
    expect(html).not.toContain("Entered another way?");
    expect(html).toContain("scored on strokes");
  });

  it("preselects the shape the round implies", () => {
    // Gross match play opens on hole results; a stroke round has only the
    // card, so it says so instead of showing a one-option picker.
    const gross = render(<ScoreEntryClient matches={[match]} format="Match Play" isStaff />);
    expect(gross).toContain('aria-pressed="true"');

    const stroke = render(<ScoreEntryClient matches={[match]} format="Stroke Play" isStaff />);
    expect(stroke).toContain("Full scorecard");
    expect(stroke).toContain("scored on strokes");
  });
});

describe("choosing the card for a round", () => {
  it("takes a full card for net match play, so the app allocates the shots", () => {
    // Hole results on a net match means trusting that four people did the
    // same stroke-index arithmetic in their heads on the 14th tee.
    expect(defaultEntryMode("Match Play", true, true)).toBe("handicap");
  });

  it("takes hole results for gross match play, which is what players write down", () => {
    expect(defaultEntryMode("Match Play", false, true)).toBe("holes");
  });

  it("falls back to hole results on a net match with no course", () => {
    // Without a stroke index there is nowhere to allocate the shots, so a
    // scorecard cannot be scored — but who won each hole still records.
    expect(defaultEntryMode("Match Play", true, false)).toBe("holes");
  });

  it("takes a card for every stroke-based format, which has nothing else", () => {
    for (const f of ["Stroke Play", "Stableford", "Skins", "Four-Ball"]) {
      expect(defaultEntryMode(f, false, true), f).toBe("handicap");
      expect(defaultEntryMode(f, true, true), f).toBe("handicap");
    }
  });
});

describe("cut line scope", () => {
  const base = {
    formId: "s1",
    getStageId: async () => "s1",
    roundLabel: "Round 2",
    enabled: true,
    mode: "count",
    count: 4,
    percent: 50,
    confirmedCount: 64,
  };

  it("counts a per-flight cut inside each flight, not across the field", () => {
    // "Top 4" over eight flights advances thirty-two players. Showing the
    // overall number understates the next round's field eightfold, and the
    // organizer only finds out when the pairings come out wrong.
    const html = render(<CutControl {...base} scope="perFlight" flightCount={8} />);
    expect(html).toContain("4 from each of 8 flights");
    expect(html).toContain("32 of 64");
  });

  it("counts an overall cut across the field", () => {
    const html = render(<CutControl {...base} scope="overall" flightCount={8} />);
    expect(html).toContain("4 of 64 advance");
    expect(html).not.toContain("from each of");
  });

  it("offers no per-flight choice when there is one flight", () => {
    const html = render(<CutControl {...base} scope="overall" flightCount={1} />);
    expect(html).toContain("Only one flight");
  });

  it("warns when the cut number is as big as the field, so it cuts nobody", () => {
    // The default cut count is 16. Enabling a cut on a field of 16 advances
    // everyone — a cut line that cuts nobody — and the screen has to say so
    // rather than leave it as an "16 of 16 advance" line that looks fine.
    const html = render(<CutControl {...base} scope="overall" count={16} confirmedCount={16} flightCount={1} />);
    expect(html).toContain("16 of 16 advance");
    expect(html).toContain("advances the whole field");
  });

  it("does not warn when the cut actually removes players", () => {
    const html = render(<CutControl {...base} scope="overall" count={16} confirmedCount={32} flightCount={1} />);
    expect(html).not.toContain("advances the whole field");
  });
});

describe("round scoring window", () => {
  const base = { stageId: "s1", roundLabel: "Round 2", deadline: "2026-08-01" };

  it("reports a round closed by its own deadline", () => {
    const html = render(<RoundDeadlineControl {...base} override={null} />);
    expect(html).toContain("the deadline has passed");
  });

  it("reports one held open past the date", () => {
    const html = render(<RoundDeadlineControl {...base} override={false} />);
    expect(html).toContain("Extended past the deadline");
    expect(html).toContain("still being accepted");
  });

  it("reports one closed early, whatever the date says", () => {
    const html = render(<RoundDeadlineControl {...base} deadline="2099-01-01" override={true} />);
    expect(html).toContain("Closed early");
  });

  it("stays open when the deadline is still ahead", () => {
    const html = render(<RoundDeadlineControl {...base} deadline="2099-01-01" override={null} />);
    expect(html).toContain("scores can be entered");
  });

  it("always offers a way back to following the date", () => {
    // An override must never be a one-way door.
    const html = render(<RoundDeadlineControl {...base} override={true} />);
    expect(html).toContain("Follow the date");
  });
});

describe("course card verification", () => {
  const course = {
    id: "c1",
    name: "Bushwood",
    city: "Chicago",
    pars: new Array(18).fill(4),
    yards: new Array(18).fill(400),
    strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    inEvent: true,
    source: "imported",
    verifiedBy: "",
    sourceUrl: "https://bushwood.example/card",
    tees: [],
  };

  it("marks an unchecked card on the row", () => {
    // The thing that can be wrong — the stroke index — is invisible in play.
    // It just sends handicap shots to the wrong holes, quietly, forever.
    const html = render(<CourseLibrary courses={[{ ...course, verified: false }]} canEdit />);
    expect(html).toContain("Unverified");
    expect(html).toContain("Verify card");
  });

  it("offers to un-verify one that was checked", () => {
    const html = render(<CourseLibrary courses={[{ ...course, verified: true }]} canEdit />);
    expect(html).not.toContain("Unverified");
    expect(html).toContain("Unverify");
  });

  it("shows neither control to someone who cannot edit", () => {
    const html = render(<CourseLibrary courses={[{ ...course, verified: false }]} canEdit={false} />);
    expect(html).not.toContain("Verify card");
  });
});

describe("stroke-play card", () => {
  const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
  const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
  const base = {
    players: [{ id: "p1", name: "Alex Vaughn", handicap: 8 }],
    pars: PARS,
    yards: new Array(18).fill(400),
    strokeIndex: SI,
    holes: 18,
    stageId: "s1",
  };

  it("uses the shared scorecard, not a bare table", () => {
    // This screen was missed by the score-entry restyle entirely — it is a
    // separate component, and a stroke tournament never saw any of it.
    const html = render(<StrokePlayEntry {...base} cardsByPlayer={{}} />);
    expect(html).toContain("sc-wrap");
    expect(html).toContain('class="sc"');
    expect(html).not.toContain('table class="table"');
  });

  it("rings a birdie and boxes a bogey", () => {
    // Hole 1 is a par 4, so a 3 is under. Hole 2 is a par 5, so a bogey
    // there is a 6 — not a 5, which is the par.
    const cards = { p1: [3, 6, ...new Array(16).fill(null)] };
    const html = render(<StrokePlayEntry {...base} cardsByPlayer={cards} />);
    expect(html).toContain("is-under");
    expect(html).toContain("is-over");
  });

  it("double-marks an eagle and a double bogey", () => {
    // Hole 2 is a par 5: a 3 is an eagle. Hole 3 is a par 3: a 5 is a double.
    const cards = { p1: [null, 3, 5, ...new Array(15).fill(null)] };
    const html = render(<StrokePlayEntry {...base} cardsByPlayer={cards} />);
    expect(html).toContain("is-eagle");
    expect(html).toContain("is-double");
  });

  it("marks nothing on an empty box or a par", () => {
    const cards = { p1: [4, ...new Array(17).fill(null)] };
    const html = render(<StrokePlayEntry {...base} cardsByPlayer={cards} />);
    expect(html).not.toContain("is-under");
    expect(html).not.toContain("is-over");
  });

  it("labels every box for a screen reader", () => {
    const html = render(<StrokePlayEntry {...base} cardsByPlayer={{}} />);
    expect(html).toContain("Hole 1, par 4");
  });
});

describe("course setup prompt", () => {
  it("offers a paste box, not a preset menu with nothing in it", () => {
    // The fictional presets were removed for being data that scored real
    // tournaments. This screen kept offering "start from a preset", leaving a
    // dropdown with one dead option and 54 boxes to type — which made score
    // entry unreachable for any event without a course.
    const html = render(<CourseSetupPrompt eventCourse="Bushwood" eventCity="Chicago" isStaff blocking />);
    expect(html).toContain("Paste the card");
    expect(html).not.toContain("Start from a preset");
    expect(html).not.toContain("Blank card");
  });

  it("says what it needs and why, when it is blocking", () => {
    const html = render(<CourseSetupPrompt eventCourse="Bushwood" eventCity="Chicago" isStaff blocking />);
    expect(html).toContain("Set up this course");
    expect(html).toContain("fill it in by hand");
  });
});

describe("bulk score import", () => {
  const field = [
    { id: "p1", name: "Alex Vaughn" },
    { id: "p2", name: "Sam Okafor" },
  ];

  it("offers only the file shapes the format can score", () => {
    const match = render(<ScoreImport stageId="s1" format="Match Play" holes={18} field={field} />);
    expect(match).toContain("Who won each hole");
    expect(match).toContain("Final results only");

    const stroke = render(<ScoreImport stageId="s1" format="Stableford" holes={18} field={field} />);
    expect(stroke).not.toContain("Who won each hole");
    expect(stroke).not.toContain("Final results only");
  });

  it("shows the header row it expects as the placeholder", () => {
    const html = render(<ScoreImport stageId="s1" format="Stroke Play" holes={18} field={field} />);
    expect(html).toContain("Player,1,2,3");
  });

  it("has nothing to import until a file arrives", () => {
    // The button reads as inert rather than inviting a click that does nothing.
    const html = render(<ScoreImport stageId="s1" format="Stroke Play" holes={18} field={field} />);
    expect(html).toContain("disabled");
  });
});

describe("printed foursome cards", () => {
  const groups = [
    { name: "Group 1", startHole: 1, time: "8:00 AM", players: [{ name: "Ann Doyle", handicap: 8 }, { name: "Rob Ferris", handicap: 14 }] },
    { name: "Group 2", startHole: 10, time: "8:00 AM", players: [{ name: "M. Ndlovu", handicap: 3 }] },
  ];
  const base = {
    groups,
    clubName: "Cinci Desi Golf",
    courseName: "CDG Home Course",
    dates: "May 3 – Sep 30, 2026",
    roundLabel: "Round 1",
    pars: new Array(18).fill(4),
    strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    holes: 18,
  };

  it("carries club, course, date and tee time on every card", () => {
    // A card without its provenance is a page of numbers — this is the whole
    // point of merging printing into the sheet of record.
    const html = render(<TeeSheetPrint {...base} />);
    expect(html).toContain("Cinci Desi Golf");
    expect(html).toContain("CDG Home Course");
    expect(html).toContain("May 3 – Sep 30, 2026");
    expect(html).toContain("Hole 10 · 8:00 AM");
  });

  it("gives every player a row with their handicap, and a marker line", () => {
    const html = render(<TeeSheetPrint {...base} />);
    expect(html).toContain("Ann Doyle");
    expect(html).toContain("(14)");
    expect(html).toContain("Marker");
  });

  it("renders nothing at all with no saved sheet", () => {
    expect(render(<TeeSheetPrint {...base} groups={[]} />)).toBe("");
  });
});

describe("the ask-a-question mic", () => {
  it("renders its prompt and example questions", async () => {
    const { VoiceAsk } = await import("@/components/VoiceAsk");
    const html = renderToStaticMarkup(
      <VoiceAsk context={{ playerName: "Atal Varma", handicapByRound: { 1: 15 }, currentRound: 1 }} />,
    );
    expect(html).toContain("Ask");
    expect(html).toContain("handicap");
  });

  it("renders for a player with nothing scored yet", async () => {
    // The state a mic is most likely to meet: first tee, nothing entered.
    const { VoiceAsk } = await import("@/components/VoiceAsk");
    expect(() =>
      renderToStaticMarkup(<VoiceAsk context={{ playerName: "Nobody Yet" }} />),
    ).not.toThrow();
  });
});

describe("the field info control", () => {
  it("starts closed, and keeps the explanation out of the markup until asked", async () => {
    const { default: FieldInfo } = await import("@/components/FieldInfo");
    const html = renderToStaticMarkup(
      <FieldInfo label="the cut line">the top players carry on</FieldInfo>,
    );
    expect(html).toContain('aria-expanded="false"');
    // Closed means closed: the panel is not merely hidden with CSS, so a
    // screen reader doesn't read out every explanation on the page at once.
    expect(html).not.toContain("the top players carry on");
  });

  it("names what it explains, because the visible label is one glyph", async () => {
    // "info" tells someone using a screen reader nothing about which of the
    // dozen controls on a setup screen they have just landed on.
    const { default: FieldInfo } = await import("@/components/FieldInfo");
    const html = renderToStaticMarkup(<FieldInfo label="the cut line">why</FieldInfo>);
    expect(html).toContain('aria-label="More about the cut line"');
    expect(html).toContain("aria-controls=");
  });

  it("is a real button, not a hoverable span", async () => {
    // The app is used one-handed on a phone. A hover-only affordance — or a
    // native title attribute — is invisible to exactly the people who need
    // it, so this must stay focusable and tappable.
    const { default: FieldInfo } = await import("@/components/FieldInfo");
    const html = renderToStaticMarkup(<FieldInfo label="x">why</FieldInfo>);
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain("title=");
  });
});

describe("the captain's availability grid", () => {
  const flight = (over: Record<string, unknown> = {}) => ({
    flightName: "Flight 1",
    rounds: [
      { stageId: "s1", label: "R1" },
      { stageId: "s2", label: "R2" },
    ],
    rows: [
      {
        playerId: "p1", name: "Ann Doyle",
        cells: [
          { stageId: "s1", status: "in" as const, explicit: true },
          { stageId: "s2", status: "out" as const, explicit: true },
        ],
      },
      {
        playerId: "p2", name: "Rob Ferris",
        cells: [
          { stageId: "s1", status: "in" as const, explicit: false },
          { stageId: "s2", status: "in" as const, explicit: true },
        ],
      },
    ],
    ...over,
  });

  it("shows every round at once, not just the current one", async () => {
    // The point of the change: three players out on the same night is the
    // thing a captain needs to spot, and it is invisible one round at a time.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(<RoundAvailability today="2026-05-01" playerId="p9" next={null} future={[]} past={[]} captainOf={[flight()]} />);
    expect(html).toContain("R1");
    expect(html).toContain("R2");
    expect(html).toContain("Ann Doyle");
    expect(html).toContain("Rob Ferris");
  });

  it("keeps the difference between a stated answer and the league's default", async () => {
    // "In" and "in because nobody said otherwise" are different promises.
    // A captain counting heads deserves to know which one they are reading.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(<RoundAvailability today="2026-05-01" playerId="p9" next={null} future={[]} past={[]} captainOf={[flight()]} />);
    expect(html).toContain("default");
    // Rob is in for R1 only because nobody said otherwise; Ann stated hers.
    expect(html).toContain("In by default");
    expect(html).toContain('aria-label="Out"');
  });

  it("is read-only: a captain cannot change anyone's answer from here", async () => {
    // Deliberate. Captains talk to the organizer, who makes the change —
    // so there is no write-on-behalf-of surface to get wrong.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(<RoundAvailability today="2026-05-01" playerId="p9" next={null} future={[]} past={[]} captainOf={[flight()]} />);
    const captainPart = html.slice(html.indexOf("Flight 1"));
    expect(captainPart).not.toContain("<input");
    expect(captainPart).not.toContain("<button");
  });

  it("counts how many are available each round", async () => {
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(<RoundAvailability today="2026-05-01" playerId="p9" next={null} future={[]} past={[]} captainOf={[flight()]} />);
    expect(html).toContain("Available");
  });

  it("names a deputy correctly rather than calling them the captain", async () => {
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability today="2026-05-01" playerId="p9" next={null} future={[]} past={[]} captainOf={[flight({ deputy: true })]} />,
    );
    expect(html).toContain("vice-captain");
  });

  it("renders nothing at all when there is neither a round nor a flight", async () => {
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    expect(render(<RoundAvailability today="2026-05-01" playerId="p9" next={null} future={[]} past={[]} captainOf={[]} />)).toBe("");
  });
});

describe("a player's own availability", () => {
  const round = (over: Record<string, unknown> = {}) => ({
    stageId: "s1",
    label: "Round 3",
    playedOn: "2026-05-19",
    dateLabel: "Tue 19 May",
    whenLabel: "in 5 days",
    optDeadline: "2026-05-18",
    deadlineLabel: "Answer by Mon 18 May",
    status: "in" as const,
    explicit: true,
    locked: false,
    ...over,
  });

  it("shows the day each round is played, not just its number", async () => {
    // "Round 7" tells a player nothing about whether they are free. The date
    // was the one thing this card never carried.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(<RoundAvailability today="2026-05-01" playerId="p9" next={round()} future={[]} past={[]} />);
    expect(html).toContain("Tue 19 May");
    expect(html).toContain("in 5 days");
    expect(html).toContain("Answer by Mon 18 May");
  });

  it("separates the next round from the ones after it", async () => {
    // Undated, so this is the list view. A season whose rounds carry dates
    // opens on the calendar instead — asserted below.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={round({ playedOn: "" })}
        future={[round({ stageId: "s2", label: "Round 4", playedOn: "", dateLabel: "Tue 26 May", whenLabel: "" })]}
        past={[]}
      />,
    );
    expect(html).toContain("Next round");
    expect(html).toContain("Future rounds");
    // The next round comes first on the page, not merely first in the data.
    expect(html.indexOf("Next round")).toBeLessThan(html.indexOf("Future rounds"));
  });

  it("opens on the calendar once the rounds carry dates", async () => {
    // The question a league member actually asks in May is "am I around for
    // any of this", which is a question about days. The next round still sits
    // above it, because that is the one they came to answer.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={round()}
        future={[round({ stageId: "s2", label: "Round 4", playedOn: "2026-06-02" })]}
        past={[]}
      />,
    );
    expect(html).toContain("May 2026");
    expect(html).toContain("June 2026");
    expect(html).toContain("Next round");
    expect(html.indexOf("Next round"), "the next round leads").toBeLessThan(html.indexOf("May 2026"));
    // Colour never carries the state on its own.
    expect(html).toContain("Playing");
    expect(html).toContain("In by default");
  });

  it("keeps the next round answerable from the calendar view", async () => {
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability today="2026-05-01" playerId="p9" next={round()} future={[]} past={[]} />,
    );
    // The In/Out control of the next-round panel, not just a coloured square.
    expect(html).toContain("Answer by Mon 18 May");
    expect(html).toContain('type="radio"');
  });

  it("lists a round nobody has dated rather than dropping it off the grid", async () => {
    // A round with no date cannot go on a calendar, and it is exactly the one
    // a player would otherwise never be asked about.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={null}
        future={[round({ stageId: "s1", label: "Round 9", playedOn: "2026-05-19" }), round({ stageId: "s2", label: "Round 10", playedOn: "" })]}
        past={[]}
      />,
    );
    expect(html).toContain("Not yet dated");
    expect(html).toContain("Round 10");
  });

  it("collapses played rounds instead of throwing them away", async () => {
    // What you answered is a record. It just isn't what you came to do.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={round({ playedOn: "" })}
        future={[]}
        past={[
          round({ stageId: "s0", label: "Round 2", playedOn: "" }),
          round({ stageId: "sx", label: "Round 1", playedOn: "" }),
        ]}
      />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("Earlier rounds (2)");
  });

  it("keeps a played round on the calendar rather than collapsing it away", async () => {
    // The list tucks the season's history behind a disclosure. The grid has
    // room for it in place, which is the better answer to "what did I say
    // about the week I missed" — the square is simply already decided.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-06-01"
        playerId="p9"
        next={null}
        future={[]}
        past={[round({ stageId: "s0", label: "Round 2", playedOn: "2026-05-12", locked: true })]}
      />,
    );
    expect(html).toContain("May 2026");
    expect(html).toContain("Closed");
  });

  it("still asks the question when every round has been played", async () => {
    // Nothing to answer, but a captain may still have a flight to read, and
    // the player may want to check what they said.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={null}
        future={[]}
        past={[round({ locked: true, playedOn: "" })]}
      />,
    );
    expect(html).not.toContain("Next round");
    expect(html).toContain("Earlier rounds (1)");
  });

  it("disables the choice once sign-up has closed", async () => {
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={round({ locked: true, deadlineLabel: "Sign-up closed" })}
        future={[]}
        past={[]}
      />,
    );
    expect(html).toContain("Sign-up closed");
    expect(html).toContain("disabled");
  });

  it("says when an answer is only the league's default", async () => {
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability today="2026-05-01" playerId="p9" next={round({ explicit: false })} future={[]} past={[]} />,
    );
    expect(html).toContain("by default");
  });

  it("omits the date line entirely for a round with no fixed day", async () => {
    // Rather than printing an empty chip or inventing a date.
    const { RoundAvailability } = await import("@/components/RoundAvailability");
    const html = render(
      <RoundAvailability
        today="2026-05-01"
        playerId="p9"
        next={round({ playedOn: "", dateLabel: "", whenLabel: "", deadlineLabel: "Open" })}
        future={[]}
        past={[]}
      />,
    );
    expect(html).toContain("Round 3");
    expect(html).not.toContain("May");
  });
});

describe("round handicap controls", () => {
  const info = (over: Record<string, unknown> = {}) => ({
    name: "Four-Ball",
    allowance: 90, recommendedAllowance: 90,
    allowanceOverridden: false, allowanceIsConvention: false,
    shares: null as number[] | null, recommendedShares: null as number[] | null,
    sharesOverridden: false,
    countBest: 1 as number | null, countBestOverridden: false, maxSide: 2,
    ...over,
  });

  it("shows the split only for a format scored by one", async () => {
    const { RoundTeamScoring } = await import("@/components/RoundTeamScoring");
    // Greensomes is 60% of the lower handicap plus 40% of the higher, which a
    // single percentage cannot express — so it gets its own control.
    const greensomes = render(
      <RoundTeamScoring stageId="s1"
        info={info({ name: "Greensomes", shares: [60, 40], recommendedShares: [60, 40], countBest: null })} />,
    );
    expect(greensomes).toContain("Handicap split");
    expect(greensomes).toContain("60 / 40");
    // Four-Ball takes a flat percentage, so a split would be a control with
    // nothing behind it.
    expect(render(<RoundTeamScoring stageId="s1" info={info()} />)).not.toContain("Handicap split");
  });

  it("shows how many count only where separate balls are aggregated", async () => {
    const { RoundTeamScoring } = await import("@/components/RoundTeamScoring");
    const fourBall = render(<RoundTeamScoring stageId="s1" info={info()} />);
    expect(fourBall).toContain("Scores that count");
    expect(fourBall).toContain("best 1 of 2");
    // A scramble already plays one ball, so the question doesn't arise.
    const scramble = render(
      <RoundTeamScoring stageId="s1" info={info({ name: "Scramble", countBest: null })} />,
    );
    expect(scramble).not.toContain("Scores that count");
  });

  it("says when a committee has replaced a recommendation", async () => {
    const { RoundTeamScoring } = await import("@/components/RoundTeamScoring");
    const html = render(
      <RoundTeamScoring stageId="s1"
        info={info({ name: "Best Ball", maxSide: 4, countBest: 2, countBestOverridden: true,
          allowance: 80, allowanceOverridden: true })} />,
    );
    expect(html).toContain("best 2 of 4");
    expect(html).toContain("set by your committee");
  });

  it("always offers the allowance, whatever the format", async () => {
    // Every team format prices its sides somehow, so this one is never hidden.
    const { RoundTeamScoring } = await import("@/components/RoundTeamScoring");
    expect(render(<RoundTeamScoring stageId="s1" info={info()} />)).toContain("Handicap allowance");
  });
});

describe("club convention vs published allowance", () => {
  it("says when a recommendation is convention rather than a standard", async () => {
    // A scramble has no published WHS allowance — only what clubs do. Saying
    // so is the difference between citing a rule and admitting a custom.
    const { RoundTeamScoring } = await import("@/components/RoundTeamScoring");
    const html = render(
      <RoundTeamScoring stageId="s1" info={{
        name: "Scramble", allowance: 25, recommendedAllowance: 25,
        allowanceOverridden: false, allowanceIsConvention: true,
        shares: null, recommendedShares: null, sharesOverridden: false,
        countBest: null, countBestOverridden: false, maxSide: 4,
      }} />,
    );
    expect(html).toContain("not a published standard");
  });
});

describe("the player's own card opens on what is already there", () => {
  /**
   * The regression this exists for was a data-loss bug, not a cosmetic one.
   *
   * PlayerCard seeded its state with `new Array(holes).fill(null)` and ignored
   * the card the player had already returned. So a player who entered nine
   * holes at the turn, closed the app, and reopened it saw an empty grid — and
   * the Save button under it would have written that empty grid over the nine
   * holes they had played.
   *
   * Typecheck passed. All 1383 unit tests passed. The production build passed.
   * None of them render a component with state, which is the entire reason
   * this file exists and the reason this test is here rather than in a
   * comment.
   */
  const nine = (): (number | null)[] =>
    Array.from({ length: 18 }, (_, i) => (i < 9 ? 4 : null));

  it("shows the holes already returned rather than a blank round", async () => {
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        status="entered" initialStrokes={nine()}
      />,
    );
    // The hole strip marks a hole as scored, so nine of them must read back.
    const scored = html.match(/aria-label="Hole \d+, complete"/g) ?? [];
    expect(scored.length, "nine returned holes should show as scored").toBe(9);
    expect(html).toContain("9 of 18 holes in");
  });

  it("does not offer to certify a round that is not finished", async () => {
    // Certifying is the claim that these hole scores are correct. Half a card
    // cannot be correct, and the committee then approves what was certified.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        status="entered" initialStrokes={nine()}
      />,
    );
    // The Certify button is the only btn-primary on the screen, so finding it
    // and checking it carries `disabled` is enough — and does not depend on
    // how React happens to serialise the icon element inside it.
    const certify = html.match(/<button[^>]*btn-primary[^>]*>/)?.[0] ?? "";
    expect(certify, "Certify must be disabled on a half-finished card").toContain("disabled");
  });

  it("normalises a card longer than the round", async () => {
    // A round shortened from 18 to 9 leaves 18-slot cards behind. Rendering
    // all eighteen would invite a player to score holes that are not played.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Front nine"
        holes={9} pars={new Array(9).fill(4)} yards={new Array(9).fill(400)}
        strokeIndex={Array.from({ length: 9 }, (_, i) => i + 1)}
        status="entered" initialStrokes={new Array(18).fill(5)}
      />,
    );
    // Nine holes in the strip and no tenth. (The "x of y holes in" line is
    // absent here because a full card shows the certify wording instead —
    // which is itself correct: an 18-slot card trimmed to 9 IS complete.)
    const strip = html.match(/aria-label="Hole \d+, (complete|partly scored|not scored)"/g) ?? [];
    expect(strip.length, "a 9-hole round renders nine holes").toBe(9);
    expect(html, "a 9-hole round must not show a 10th").not.toContain('aria-label="Hole 10');
  });

  it("locks an approved card instead of letting it be edited", async () => {
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        status="approved" initialStrokes={new Array(18).fill(4)}
      />,
    );
    expect(html).toContain("approved by the committee");
    expect(html, "an approved card must not render an entry pad").not.toContain("Certify");
  });

  it("shows where the round stands, without leaving for the board", async () => {
    // The question that follows every single tap, and the screen had no answer
    // to it at all: a player had to open the leaderboard to find out what they
    // were. Nine fours on a par-72 course is level after nine.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        shotsPerHole={new Array(18).fill(0)}
        status="entered" initialStrokes={nine()}
      />,
    );
    expect(html).toContain("Thru");
    expect(html).toContain("Gross");
    expect(html).toContain("To par");
    expect(html).toContain("36"); // gross through nine
    expect(html).toContain("E"); // level par
  });

  it("counts par and shots over the holes played, not the whole course", async () => {
    // Through six holes of a par-72 round, "to par" that used the full 72
    // would read eighteen under. The same rule the server totals by.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const six: (number | null)[] = Array.from({ length: 18 }, (_, i) => (i < 6 ? 5 : null));
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        // A stroke on each of the six holes played, and on nothing else.
        shotsPerHole={Array.from({ length: 18 }, (_, i) => (i < 6 ? 1 : 0))}
        playingHandicap={18}
        status="entered" initialStrokes={six}
      />,
    );
    expect(html).toContain("+6"); // six bogeys
    expect(html).toContain("Net");
    // 30 gross less the six strokes received on those six holes.
    expect(html).toContain("24");
  });

  it("has no Save button, because a Save button loses rounds", async () => {
    // A phone goes in a pocket between greens. The card writes itself on every
    // tap and says so; certifying stays deliberate.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        status="entered" initialStrokes={nine()}
      />,
    );
    expect(html).not.toContain("ph-floppy-disk");
    expect(html).toContain("Certify my card");
    // And the write state has somewhere to be announced from.
    expect(html).toContain('aria-live="polite"');
  });

  it("names the round's own venue when it has one", async () => {
    // A tournament that moves course mid-week: the player needs to know which
    // card the par and stroke index in front of them belong to.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 2"
        courseName="Machrihanish"
        holes={18} pars={new Array(18).fill(4)} yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        status="entered" initialStrokes={new Array(18).fill(null)}
      />,
    );
    expect(html).toContain("Machrihanish");
  });

  it("leaves the net out entirely when the course is unknown", async () => {
    // No par and no stroke index means no honest net to show, and inventing
    // one is worse than the gap.
    const { PlayerCard } = await import("@/components/PlayerCard");
    const html = render(
      <PlayerCard
        stageId="s1" playerId="p1" playerName="A. Moore" roundLabel="Round 1"
        holes={18} pars={[]} yards={[]} strokeIndex={[]}
        status="entered" initialStrokes={nine()}
      />,
    );
    expect(html).toContain("Gross");
    expect(html).not.toContain("To par");
    expect(html).not.toContain("Net");
  });
});

describe("the board answers 'where am I' first", () => {
  /**
   * A leaderboard is read to answer one question before any other, and on a
   * forty-player field that meant scrolling and reading names to find your own
   * row. It is also a column of numbers that legitimately means three
   * different things — strokes, Stableford points, match points — depending on
   * the round, and the screen used to leave the reader to infer which.
   */
  const row = (over: Partial<StandingRow> = {}): StandingRow => ({
    id: "p1",
    rank: 1,
    name: "A. Moore",
    flight: "—",
    advancing: false,
    record: "2-0-0",
    diff: "",
    pts: "6",
    played: 2,
    wins: 2,
    ties: 0,
    losses: 0,
    gross: 72,
    net: 72,
    toPar: 0,
    points: 0,
    thru: 18,
    ...over,
  });

  const field = [
    row({ id: "p1", rank: 1, name: "A. Moore", toPar: -4 }),
    row({ id: "p2", rank: 2, name: "B. Ellis", toPar: -1 }),
    row({ id: "p3", rank: 3, name: "C. Reid", toPar: 3, thru: 14 }),
  ];

  it("puts your own position above the list", async () => {
    const { PlayerLeaderboard } = await import("@/components/PlayerLeaderboard");
    const html = render(
      <PlayerLeaderboard isStroke rows={field} holes={18} youId="p3" unit="strokes" />,
    );
    const you = html.indexOf("You");
    expect(you, "your line renders").toBeGreaterThan(-1);
    expect(you, "and it comes before the field").toBeLessThan(html.indexOf("A. Moore"));
    expect(html).toContain("thru 14");
  });

  it("says what the numbers are", async () => {
    const { PlayerLeaderboard } = await import("@/components/PlayerLeaderboard");
    const html = render(
      <PlayerLeaderboard isStroke rows={field} holes={18} unit="Stableford points" />,
    );
    expect(html).toContain("Ranked by Stableford points");
  });

  it("renders the same board for a spectator, with nothing marked", async () => {
    // The public share link renders this component with no signed-in player.
    const { PlayerLeaderboard } = await import("@/components/PlayerLeaderboard");
    const html = render(<PlayerLeaderboard isStroke rows={field} holes={18} />);
    expect(html).not.toContain(">You<");
    expect(html).toContain("A. Moore");
    expect(html).toContain("C. Reid");
  });

  it("still shows your line before you have started", async () => {
    // "Not started" is an answer, and a blank row is not.
    const { PlayerLeaderboard } = await import("@/components/PlayerLeaderboard");
    const html = render(
      <PlayerLeaderboard
        isStroke
        rows={[row({ id: "p9", name: "D. Shaw", thru: 0, toPar: 0 })]}
        holes={18}
        youId="p9"
      />,
    );
    expect(html).toContain("not started");
  });
});
