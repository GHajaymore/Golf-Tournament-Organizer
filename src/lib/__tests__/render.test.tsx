import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeamEntryMode } from "@/lib/domain/team-entry";
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
vi.mock("@/app/actions/messaging", actionModule);

import { SeriesClient } from "@/components/SeriesClient";
import { TeeEditor } from "@/components/TeeEditor";
import { TeamsClient } from "@/components/TeamsClient";
import { TeamEntryClient } from "@/components/TeamEntryClient";
import { teamEntryNote, teamEntryFixedReason } from "@/lib/domain/team-entry";
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

  it("says on the page why matches cannot be generated yet", () => {
    // "Generate matches" was disabled with the reason in a `title` only — the
    // last surviving instance of that pattern, flagged in the 2026-08-18
    // record and left for whoever was next in this file. The refusal names the
    // other button by the exact words on it, not by where it sits.
    const one = render(
      <TeamsClient rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]} activeRoundId="r1"
        format={format}
        teams={[{ id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: 14, members: [] }]}
        problems={[]} unassigned={[]} matchCount={0} />,
    );
    expect(one).toContain("A match is between two sides and there is only one so far");
    expect(one).toContain("Draw sides automatically");

    // Two sides, and the explanation goes away because the button works.
    const two = render(
      <TeamsClient rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]} activeRoundId="r1"
        format={format}
        teams={[
          { id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: 14, members: [] },
          { id: "t2", name: "Side B", seed: 2, stageId: "r1", playingHandicap: 15, members: [] },
        ]}
        problems={[]} unassigned={[]} matchCount={0} />,
    );
    expect(two).not.toContain("only one so far");
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

  it("says why a player cannot be added to a side", () => {
    // "Add player" carried three conditions in one `disabled` and explained
    // none — the same defect the Generate matches button on this very screen
    // was fixed for. A full four-ball and an exhausted field looked identical.
    const side = (members: number) => ({
      id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: 14,
      members: Array.from({ length: members }, (_, i) => ({
        playerId: `p${i}`, name: `zz-P${i}`, handicap: 10, position: i,
      })),
    });
    const board = (members: number, spare: number) =>
      render(
        <TeamsClient rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]} activeRoundId="r1"
          format={{ ...format, min: 2, max: 2 }} teams={[side(members)]} problems={[]}
          unassigned={Array.from({ length: spare }, (_, i) => ({
            id: `u${i}`, name: `zz-U${i}`, handicap: 12,
          }))}
          matchCount={0} />,
      );

    expect(board(2, 3)).toContain("This side is full");
    expect(board(0, 0)).toContain("already on a side");
    // Room and somebody spare: no refusal at all.
    expect(board(1, 3)).not.toContain("This side is full");
    expect(board(1, 3)).not.toContain("already on a side");
  });

  it("says what the side's handicap number is", () => {
    // It rendered as a bare "14" beside the side's name with its meaning in a
    // `title` — an unlabelled number on a screen about handicaps, explained
    // only to a mouse.
    const html = render(
      <TeamsClient rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]} activeRoundId="r1"
        format={format}
        teams={[{ id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: 14, members: [] }]}
        problems={[]} unassigned={[]} matchCount={0} />,
    );
    expect(html).toContain("Plays off 14");
    expect(html).not.toContain("The side&#x27;s playing handicap");
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

  it("renders team score entry in each shape a round can be written down", () => {
    // The note comes from the rule rather than a literal, so a test cannot
    // pass while the screen says something the rule does not.
    const own = render(
      <TeamEntryClient round="Four-Ball" note={teamEntryNote("Four-Ball")} holes={18}
        pars={Array(18).fill(4)} strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        teams={[{ teamId: "t1", teamName: "Side A", matchId: "m1", opponentName: "Side B",
          playingHandicap: 14, grossTotal: 0, netTotal: 0, played: 0,
          cards: [{ playerId: "p1", playerName: "Ann", handicap: 8, strokes: Array(18).fill(null) }] }]} />,
    );
    expect(own).toContain("One card each");
    expect(own).toContain("Ann");

    const shared = render(
      <TeamEntryClient round="Scramble" note={teamEntryNote("Scramble")} holes={18}
        pars={Array(18).fill(4)} strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        teams={[{ teamId: "t1", teamName: "Side A", matchId: "", playingHandicap: 7,
          grossTotal: 0, netTotal: 0, played: 0,
          cards: [{ playerId: "", playerName: "", handicap: 0, strokes: Array(18).fill(null) }] }]} />,
    );
    expect(shared).toContain("One card per side");
    expect(shared).toContain("Team card");
  });

  it("tells a side-only four-ball which number to write down", () => {
    /**
     * The case this screen used to get wrong twice over. A four-ball set to
     * "one card for the side" was shown a card per player, ignoring the
     * setting entirely; and even now it honours it, "one card for the side"
     * does not say WHICH score goes in the box. The individual balls are not
     * recorded, so there is no better NET ball to take — it is the better
     * ball's GROSS, and a scorer entering net scores would produce a round
     * that validates perfectly and is wrong by the side's handicap.
     */
    const html = render(
      <TeamEntryClient round="Four-Ball" note={teamEntryNote("Four-Ball", "side-only")} holes={18}
        pars={Array(18).fill(4)} strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        teams={[{ teamId: "t1", teamName: "Side A", matchId: "m1", opponentName: "Side B",
          playingHandicap: 14, grossTotal: 0, netTotal: 0, played: 0,
          cards: [{ playerId: "", playerName: "", handicap: 0, strokes: Array(18).fill(null) }] }]} />,
    );
    expect(html).toContain("gross");
    // The apostrophe is left out of the match: React escapes it, and pinning
    // the entity would be pinning React rather than the sentence.
    expect(html).toContain("playing handicap rather than from the better net ball");
    expect(html).toContain("Team card");
  });

  it("renders team entry with no sides drawn", () => {
    const html = render(
      <TeamEntryClient round="Scramble" note={teamEntryNote("Scramble")} holes={18} pars={[]} strokeIndex={[]} teams={[]} />,
    );
    expect(html).toContain("No sides drawn yet");
  });
});

describe("picking a course, wherever you pick one", () => {
  /**
   * One control, used everywhere a venue is chosen. Each screen used to roll
   * its own — a bare select here, a text field there — so the same act looked
   * different depending where you stood, and only one of them could narrow a
   * long list.
   */
  const courses = [
    { id: "c1", name: "Hillcrest Golf Course", city: "Montpelier", country: "US", hasCard: true },
    { id: "c2", name: "Green Crest Golf Course", city: "Middletown", country: "US", hasCard: false },
    { id: "c3", name: "Golf de Chantilly", city: "Chantilly", country: "FR", hasCard: true },
  ];

  const picker = async (over: Record<string, unknown> = {}) => {
    const { CoursePicker } = await import("@/components/CoursePicker");
    return render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <CoursePicker options={courses} value="c1" onChange={() => {}} {...(over as any)} />,
    );
  };

  it("shows the chosen course rather than an empty box", async () => {
    // A picker that forgets its own answer is the commonest way one of these
    // goes wrong, and the round already has a venue.
    expect(await picker()).toContain("Hillcrest Golf Course");
  });

  it("is a combobox, so the narrowing is announced and not just drawn", async () => {
    const html = await picker();
    expect(html).toContain('role="combobox"');
  });

  it("labels itself for whatever screen it is on", async () => {
    expect(await picker({ label: "Round venue" })).toContain("Round venue");
  });

  it("carries the caller's note about what the choice affects", async () => {
    const html = await picker({ hint: "applies to new tournaments" });
    expect(html).toContain("applies to new tournaments");
  });

  it("offers no empty choice unless the caller allows one", async () => {
    // A round that must be played somewhere should not offer "none".
    expect(await picker()).not.toContain("None —");
  });

  it("shows a chosen non-course answer rather than going blank", async () => {
    // "No fixed course" is a real answer. A box that empties itself when you
    // pick it reads as though the choice did not take.
    const html = await picker({
      value: "__open",
      extras: [{ id: "__open", label: "No fixed course — players choose" }],
    });
    expect(html).toContain("No fixed course");
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
    holes: 18, playedOn: "", deadline: "", scoringBasis: "gross", scoreInput: "", carryEnabled: false, carryPct: 0,
    carryAsked: false, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall", deadlineOverride: null, optDeadline: "", attendance: null,
    matchCount: 0, courseId: null, nine: "full", teamScoring: null, handicaps: [], ...over,
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

  /**
   * How scores are RECORDED, offered only where the format produces something
   * other than a card.
   *
   * The panel is open here because the carry-forward question is unanswered,
   * which is the only way this component shows its inside without a click.
   */
  it("offers the input choice on match play and nowhere else", () => {
    const matchPlay = render(
      <StagesClient {...base} chainsRounds
        stages={[stage(), stage({ id: "r2", position: 2, carryAsked: false })]} />,
    );
    expect(matchPlay).toContain("How scores are recorded");
    expect(matchPlay).toContain("Hole-by-hole result");
    expect(matchPlay).toContain("Final result only");

    // Stroke play produces a card and has nothing to decide, so it gets no
    // control rather than a control with one option in it.
    const strokePlay = render(
      <StagesClient {...base} chainsRounds
        stages={[
          stage({ format: "Stroke Play", scoringBasis: "stableford" }),
          stage({ id: "r2", position: 2, format: "Stroke Play", scoringBasis: "stableford", carryAsked: false }),
        ]} />,
    );
    expect(strokePlay).not.toContain("How scores are recorded");
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
    /**
     * The venue names are no longer in the markup until the picker is
     * opened — a native <select> put every option in the DOM, and the shared
     * CoursePicker renders its list on demand. So the assertion is what the
     * test always meant: the control is OFFERED when there is a choice to
     * make, and absent when there is not.
     */
    const comboboxes = (html: string) => html.split('role="combobox"').length - 1;
    expect(comboboxes(two)).toBeGreaterThan(comboboxes(one));
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

  // What a round DECIDES is not a customization, and used to sit two clicks
  // deep: expand the round, expand "Customize this round", then scroll. A
  // Single Match Stage with no rule set is an unconfigured round, not a
  // customized one, and a third-place play-off is something plenty of clubs
  // run every year. These assert the controls are in the markup with the
  // Customize panel CLOSED — which is what "one click, not two" means here.
  describe("what the round decides is reachable in one click", () => {
    const closedPanel = (html: string) => {
      // The proof the assertions above it mean anything: if the Customize
      // panel were open, everything would be in the markup for the wrong
      // reason. "Result calculation" only ever renders inside it.
      expect(html).not.toContain("Result calculation");
    };

    it("shows the third-place play-off on a Bracket Stage", () => {
      const html = render(
        <StagesClient {...base}
          stages={[stage({ id: "b1", position: 0, type: "Bracket Stage" })]}
          thirdPlaces={{
            b1: { on: true, problem: "", aName: "Ann Reyes", bName: "Bo Kite", made: false },
          }} />,
      );
      expect(html).toContain("Third and fourth");
      expect(html).toContain("Play off for third");
      expect(html).toContain("Ann Reyes");
      closedPanel(html);
    });

    it("shows the pairing rule on a Single Match Stage", () => {
      const html = render(
        <StagesClient {...base}
          stages={[stage({ id: "sm1", position: 0, type: "Single Match Stage" })]}
          singleMatches={{
            sm1: {
              stageId: "sm1", rule: null, ruleLabel: "No pairing set",
              resolution: { pairing: null, problem: "This round has no pairing rule set — choose who plays it." },
              aName: "", bName: "", matchId: null, canCreate: false, stale: false,
              rounds: [], players: [],
            },
          }} />,
      );
      expect(html).toContain("The match");
      expect(html).toContain("No pairing set");
      closedPanel(html);
    });

    it("shows the qualification cut on a Qualification Stage", () => {
      const html = render(
        <StagesClient {...base}
          stages={[stage({ id: "q1", position: 0, type: "Qualification Stage" })]} />,
      );
      expect(html).toContain("Qualification cut");
      closedPanel(html);
    });

    it("says nothing at all on a round that decides nothing of its own", () => {
      // SettingsGroup renders no heading when it has no children, so a plain
      // Round Robin must not grow an empty "What this round decides".
      const html = render(
        <StagesClient {...base} chainsRounds={false} stages={[stage({ position: 0 })]} />,
      );
      expect(html).not.toContain("What this round decides");
    });
  });

  // The guard against a "simplification" that quietly drops a setting. Every
  // control the round card carried before the separation is asserted present,
  // by its own visible label, with the panel open.
  it("keeps every control on the round card", () => {
    // Two points-scored Round Robin rounds with the carry question unanswered:
    // that is what opens the Customize panel on a static render.
    const html = render(
      <StagesClient {...base} chainsRounds
        flightCount={2}
        stages={[
          stage({ id: "r1", position: 0, attendance: { in: 18, out: 2, inByDefault: 5 } }),
          stage({ id: "r2", position: 1, carryAsked: false }),
        ]}
        venues={[{ id: "c1", name: "Bushwood" }, { id: "c2", name: "Augusta" }]} />,
    );
    for (const control of [
      // The header row of the open round
      "Format", "Holes", "Played on", "Course", "Remove stage",
      // Inside "Customize this round"
      "Result calculation",
      "When scores are due", "Completion deadline", "Scoring window",
      "Sign-up deadline",
      "Before the next round", "Carry forward points into Round 2", "Cut the field for Round 2",
      "Generate", "Tiebreakers",
    ]) {
      expect(html, `missing control: ${control}`).toContain(control);
    }
  });

  it("names the scoring window once, not twice", () => {
    // The group was titled "On the day" and blurbed "whether scores can still
    // go in", above one control labelled "Scoring window" blurbed "Whether
    // scores can still be entered for this round." The same trap this pass
    // walked into on PlaySettings, already sitting on this screen.
    const html = render(
      <StagesClient {...base} chainsRounds
        stages={[stage({ id: "r1", position: 0 }), stage({ id: "r2", position: 1, carryAsked: false })]} />,
    );
    expect(html).toContain("Scoring window");
    expect(html).not.toContain("Whether scores can still be entered for this round");
  });

  it("promises two tiebreaker questions only where there are two", () => {
    // The 1./2. numbering is conditional on Match Play; the blurb was not, so
    // a stroke-play round robin advertised a second question and numbers that
    // never rendered.
    const open = (format: string) =>
      render(
        <StagesClient {...base} chainsRounds
          stages={[
            stage({ id: "r1", position: 0, format }),
            stage({ id: "r2", position: 1, format, carryAsked: false }),
          ]} />,
      );
    expect(open("Match Play")).toContain("Two separate questions");
    expect(open("Stroke Play")).not.toContain("Two separate questions");
  });

  it("says what a closed round decides, not just 'Standard settings'", () => {
    // A bracket playing off for third and a single match with a real pairing
    // both used to summarise as "Standard settings" — the two settings hardest
    // to reach were the only two the closed row never mentioned. Three stages,
    // so none opens by default.
    const html = render(
      <StagesClient {...base}
        stages={[
          stage({ id: "r1", position: 0 }),
          stage({ id: "b1", position: 1, type: "Bracket Stage" }),
          stage({ id: "q1", position: 2, type: "Qualification Stage" }),
        ]}
        thirdPlaces={{ b1: { on: true, problem: "waiting on the semi-finals", aName: "", bName: "", made: false } }} />,
    );
    expect(html).toContain("Plays off for third");
    expect(html).toContain("Top 8 overall");
  });
});

describe("course library", () => {
  const course = {
    id: "c1", name: "Bushwood", city: "Chicago",
    pars: Array(18).fill(4), yards: Array(18).fill(400),
    strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    inEvent: true, source: "manual", verified: true, verifiedBy: "", sourceUrl: "", hasCard: true,
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

  it("names the prize list, which another card points at by name", async () => {
    // The table's card was the only untitled one on the screen, and the
    // side-bets card refers to "the prize list" — pointing at something no
    // heading called that. The empty state also said "above", a claim about
    // layout that nothing checks.
    const { PrizesClient } = await import("@/components/PrizesClient");
    const html = render(<PrizesClient prizes={[]} players={[]} />);
    expect(html).toContain("Prizes");
    expect(html).toContain("Add a prize");
    expect(html).not.toContain("specials above");
  });

  it("says what an unverified card costs, once, and only when one exists", () => {
    // The badge showed the STATE on the row and left the stakes in a `title`.
    // The stakes are the whole reason the badge exists and are not obvious: a
    // wrong stroke index is invisible in play — it just sends handicap shots
    // to the wrong holes, every round, for as long as the course is listed.
    const unverified = render(
      <CourseLibrary canEdit courses={[{ ...course, verified: false, sourceUrl: "https://zz.invalid/card" }]} />,
    );
    expect(unverified).toContain("stroke index");
    expect(unverified).toContain("wrong holes");
    // Where it came from is per-row, so it stays on the row — in the
    // accessible name, not only in a title a phone never shows.
    expect(unverified).toContain("imported from https://zz.invalid/card");

    // Nothing to warn about when every card has been checked.
    const verified = render(<CourseLibrary canEdit courses={[course]} />);
    expect(verified).not.toContain("wrong holes");
  });

  it("gives the verified seal an accessible name", () => {
    // It was an icon with no name at all: decorative markup, and the only text
    // — who checked it — in a `title` a screen reader may never announce.
    const html = render(
      <CourseLibrary canEdit courses={[{ ...course, verified: true, verifiedBy: "zz-Ann Reyes" }]} />,
    );
    expect(html).toContain('aria-label="Card checked by zz-Ann Reyes"');
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
    handicapSource: "manual", status: "active", notes: "", entryCount: 0, lastEvent: "", entryStatus: "out",
    entered: false, ...over,
  });
  const result = (over: Partial<MemberImportResult> = {}): MemberImportResult => ({
    imported: 0, updated: 0, skippedDuplicates: 0, skippedInvalid: 0, unknownColumns: [], ...over,
  });

  it("offers both ways of adding someone", () => {
    const html = render(
      <RosterClient clubName="Bushwood" orgKind="club" eventName="Spring Medal" fieldLocked={false} members={[]}
        fieldSize={0} unlinkedCount={0} />,
    );
    expect(html).toContain("Add member");
    expect(html).toContain("Import CSV");
    expect(html).toContain('accept=".csv,text/csv"');
  });

  it("shows the empty roster message outside a table", () => {
    // The table declares minWidth 820, so an empty one still claimed 820px and
    // put a horizontal scrollbar under a list with nothing in it — and the
    // message, living in a colSpan cell, inherited that width and ran off the
    // right edge. The one sentence a new club needs was the one being cut in
    // half. No rows, no table.
    const html = render(
      <RosterClient clubName="Bushwood" orgKind="club" eventName="Spring Medal" fieldLocked={false} members={[]}
        fieldSize={0} unlinkedCount={0} />,
    );
    expect(html).toContain("No members yet.");
    expect(html).toContain("joins the roster automatically.");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("minWidth");
  });

  it("renders a populated roster", () => {
    const html = render(
      <RosterClient clubName="Bushwood" orgKind="club" eventName="Spring Medal" fieldLocked={false}
        fieldSize={2} unlinkedCount={0}
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
    holes: 18, playedOn: "", deadline: "", scoringBasis: "gross", scoreInput: "", carryEnabled: false, carryPct: 0,
    carryAsked: true, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall", deadlineOverride: null, optDeadline: "", attendance: null,
    matchCount: 0, courseId: null, nine: "full", teamScoring: null, handicaps: [], ...over,
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

  it("says why the tee sheet cannot be saved on an empty field", () => {
    // Both save buttons carried `groups.length === 0` and said nothing, so on
    // the ordinary first-day state an organizer got two grey buttons and no
    // way to tell whether the app was broken or something was missing.
    // drawReadiness rather than a second rule: a tee sheet is drawn from the
    // FIELD exactly as flights are.
    const html = render(<FoursomeMaker players={[]} stageId="s1" />);
    expect(html).toContain("empty field");
    expect(html).toContain('href="/registration"');

    // A field that exists gets no refusal.
    const drawn = render(<FoursomeMaker players={field} stageId="s1" />);
    expect(drawn).not.toContain("empty field");
  });

  it("names the greyed-out options and why, on the page", () => {
    // Both button groups explained themselves with a `title` only. The names
    // come from the ALGORITHMS and DRAW_ORDERS arrays that do the greying, so
    // the sentence cannot come to list the wrong ones.
    const html = render(<FoursomeMaker players={field} />);
    expect(html).not.toContain("Needs a round to have been played");
    expect(html).toContain("By position needs the leaderboard");
    expect(html).toContain("Leaders out last and Leaders out first need the leaderboard");

    // Gone once a round has been played and nothing is greyed.
    const standings = field.map((p, i) => ({ playerId: p.id, position: i + 1 }));
    const played = render(<FoursomeMaker players={field} standings={standings} />);
    expect(played).not.toContain("needs the leaderboard");
    expect(played).not.toContain("need the leaderboard");
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

  it("does not file every kind of match under one stage type", () => {
    // The list is the matches of ONE ROUND, whatever type it is — the entry
    // page filters state.matches by stage.id and hands them over. A bracket's
    // semi-finals and a third-place play-off arrived under a heading reading
    // "Round-robin matches", and an organizer looking for the semi-final there
    // concludes they are on the wrong screen.
    const html = render(<ScoreEntryClient matches={[match]} format="Match Play" isStaff />);
    expect(html).not.toContain("Round-robin matches");
    expect(html).toContain("Matches");
  });

  it("does not tell a bracket to generate a round-robin schedule", () => {
    // The no-matches state sends an organizer to Flights, which is right — but
    // it said "to create the round-robin schedule", and this screen shows one
    // round of whatever type. A bracket's semi-finals and a single match arrive
    // here too, and neither comes from a round-robin draw.
    const empty = render(<ScoreEntryClient matches={[]} format="Match Play" isStaff />);
    expect(empty).toContain("No matches yet");
    expect(empty).toContain('href="/grouping"');
    expect(empty).not.toContain("round-robin");

    // A player sees the same emptiness without being sent anywhere they cannot
    // act — that half is unchanged.
    const player = render(<ScoreEntryClient matches={[]} format="Match Play" />);
    expect(player).toContain("check back once flights are set");
  });

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

  it("says on the page why there is no per-flight choice with one flight", () => {
    // This asserted `title="Only one flight — same as overall."` — a tooltip,
    // which never appears on a touch device and is not announced to a screen
    // reader. The test agreeing with the code did not make the code right.
    const html = render(<CutControl {...base} scope="overall" flightCount={1} />);
    expect(html).not.toContain("title=");
    expect(html).toContain("The field is in one flight, so a per-flight cut would be the same cut");
    // And it is not said when there are flights to cut inside.
    const many = render(<CutControl {...base} scope="overall" flightCount={8} />);
    expect(many).not.toContain("The field is in one flight");
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
    hasCard: true,
    tees: [],
  };

  it("says so when a course has no card at all, rather than printing a par", () => {
    // An imported course whose card the directory got wrong arrives with its
    // name and its tees and nothing else. It used to print "72" — the sum of
    // the placeholder the service falls back to — presented as this course's
    // par, which is the exact mistake deleting the bundled courses was for.
    const html = render(<CourseLibrary courses={[{ ...course, verified: false, hasCard: false }]} canEdit />);
    expect(html).toContain("No card yet");
    expect(html).not.toContain(">72<");
  });

  it("opens the editor on the course score entry sent someone to correct", () => {
    // Open in the FIRST render, not after an effect: somebody who followed
    // "correct this card" arrives looking at the boxes rather than at a table
    // they have to find their course in again.
    const html = render(
      <CourseLibrary courses={[{ ...course, verified: false }]} canEdit openCourseId="c1" />,
    );
    expect(html).toContain("Save course");
  });

  it("opens a cardless course on empty boxes, not on the placeholder", () => {
    // clubCourses falls back to eighteen 4s and a 1-18 index so a cardless row
    // stays editable. Loading that INTO the editor would present invented
    // numbers as this course's card and invite somebody to save them.
    const html = render(
      <CourseLibrary
        courses={[{ ...course, verified: false, hasCard: false }]}
        canEdit
        openCourseId="c1"
      />,
    );
    expect(html).not.toContain('value="4"');
  });

  it("offers paste inside the editor, not only as a way to create a course", () => {
    // "Paste a card" on the toolbar CREATES a course, so it was no use to
    // anyone correcting one — and score entry now sends people here to enter
    // a card for a venue that already exists. Fifty-four boxes when a
    // twenty-second paste exists a button away is a bad handoff.
    const html = render(
      <CourseLibrary courses={[{ ...course, verified: false }]} canEdit openCourseId="c1" />,
    );
    expect(html).toContain("Paste the card");
  });

  it("offers to re-check a course that came from the directory", () => {
    const fromDirectory = {
      ...course,
      verified: false,
      sourceUrl: "https://api.opengolfapi.org/api/v1/courses/abc123",
    };
    const html = render(<CourseLibrary courses={[fromDirectory]} canEdit />);
    expect(html).toContain("Check source");
    // And says what it does on the page rather than in a tooltip — an
    // organizer will not press something that might rewrite a card they
    // confirmed, so "It never writes" has to be readable.
    expect(html).toContain("never writes");
  });

  it("does not offer it for a card typed in by hand", () => {
    // There is nothing to check it against, and a database arguing with a
    // card the club typed is not a feature.
    const html = render(<CourseLibrary courses={[{ ...course, verified: false }]} canEdit />);
    expect(html).not.toContain("Check source");
  });

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

  it("reports the totals this round is won on, not all four every time", () => {
    // A gross medal used to display a Net and a Stableford figure the
    // tournament never reads. Two of four numbers being noise is worse than
    // two numbers: on a phone in the sun the reader has to work out which
    // one is theirs.
    const gross = render(<StrokePlayEntry {...base} cardsByPlayer={{}} scoringBasis="gross" />);
    expect(gross).toContain("To par");
    expect(gross).not.toContain("Stableford");
    expect(gross).not.toContain(">Net<");

    const net = render(<StrokePlayEntry {...base} cardsByPlayer={{}} scoringBasis="net" />);
    expect(net).toContain("Net");
    expect(net).not.toContain("Stableford");
  });

  it("leads with points on a Stableford even when the basis says otherwise", () => {
    // Rule 21.1 — most points wins. The format and the basis are two settings
    // that can contradict each other, and the one that is a fact about the
    // game wins.
    const html = render(
      <StrokePlayEntry {...base} cardsByPlayer={{}} scoringBasis="gross" format="Stableford" />,
    );
    expect(html).toContain("Stableford");
    expect(html.indexOf("Stableford")).toBeLessThan(html.indexOf("Gross"));
  });

  it("carries the club's mark, the same as the card the player holds", () => {
    // The organizer's card and the player's are the same card. Branding one
    // and not the other would mean a returned card and the phone it was
    // entered on disagreed about whose tournament it is.
    const html = render(
      <StrokePlayEntry {...base} cardsByPlayer={{}} brand={{ name: "Bushwood", logoUrl: "https://x.test/l.png" }} />,
    );
    expect(html).toContain("Bushwood");
    expect(html).toContain("https://x.test/l.png");
  });

  it("stays unbranded when the club has set no mark", () => {
    expect(render(<StrokePlayEntry {...base} cardsByPlayer={{}} />)).not.toContain("<img");
  });
});

describe("where this round was played", () => {
  const twoVenues = [{ id: "c1", name: "Bushwood" }, { id: "c2", name: "Ridgeline" }];
  const carded = { name: "Bushwood", courseId: "c1", hasCard: true };
  const venue = async (props: Record<string, unknown>) => {
    const { RoundVenue } = await import("@/components/RoundVenue");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return render(<RoundVenue stageId="s1" courseId="" venues={[]} venue={carded} canEdit {...(props as any)} />);
  };

  it("asks nothing when the tournament has one venue and it has a card", async () => {
    // There is nothing to choose. The venue is already named in the header
    // beside the dates, and a locked dropdown of one is furniture.
    expect(await venue({ venues: [{ id: "c1", name: "Bushwood" }] })).toBe("");
    expect(await venue({ venues: [] })).toBe("");
  });

  it("offers the choice once the tournament has more than one", async () => {
    // A multi-day event rotating courses, or a league with no fixed venue:
    // the round has to say which card it is scored against.
    const html = await venue({ venues: twoVenues });
    expect(html).toContain("Played at");
    // The other venue appears once the list is opened; what the markup has
    // to show before that is the control itself.
    expect(html).toContain('role="combobox"');
  });

  it("names what an unset venue inherits, rather than showing a blank", async () => {
    const html = await venue({ venues: twoVenues });
    expect(html).toContain("Bushwood (inherited)");
  });

  it("says a venue has no card, however many venues there are", async () => {
    // The case the course importer creates: a course arrives with its name
    // and its rated tees because the directory's hole data could not be
    // trusted. Scoring a round there computes net and Stableford against
    // nothing, so this is raised where the scores are about to be entered.
    const html = await venue({
      venues: [{ id: "c1", name: "Bushwood" }],
      venue: { name: "Bushwood", courseId: "c1", hasCard: false },
    });
    expect(html).toContain("has no card yet");
  });

  it("sends the correction to the one card editor rather than growing another", async () => {
    // Two writers of the same eighteen numbers is how the event's own card
    // came to disagree with its venue's, and be silently ignored. So this
    // links, deep, into the course library's editor — and it links whether
    // the card is missing or merely wrong, because "the S.I. on hole 7 is
    // not ours" is the correction that actually gets made mid-round.
    const missing = await venue({ venue: { name: "Bushwood", courseId: "c1", hasCard: false } });
    expect(missing).toContain("/event?course=c1");
    expect(missing).not.toContain("Paste the card");

    const present = await venue({ venues: twoVenues });
    expect(present).toContain("/event?course=c1");
    expect(present).toContain("Check par and stroke index");
  });

  it("shows none of it to someone who cannot edit the tournament", async () => {
    // A player entering their own card does not set the venue for the field.
    expect(await venue({ venues: twoVenues, canEdit: false })).toBe("");
    expect(
      await venue({
        venues: twoVenues,
        canEdit: false,
        venue: { name: "Bushwood", courseId: "c1", hasCard: false },
      }),
    ).toBe("");
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

  it("prints the club's logo beside its name", () => {
    // The card a group carries to the first tee is the club's card. The name
    // was already on it; the badge that is on the paper one was not.
    const html = render(<TeeSheetPrint {...base} clubLogoUrl="https://x.test/l.png" />);
    expect(html).toContain("https://x.test/l.png");
    expect(html).toContain("Cinci Desi Golf");
  });

  it("prints the name alone for a club with no logo", () => {
    // No logo means no mark — never ours in its place.
    const html = render(<TeeSheetPrint {...base} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("Cinci Desi Golf");
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
    // A shared ball by default, which is the shape with no choice in it —
    // the tests that care about the choice pass their own.
    entryChoices: ["side-only"] as TeamEntryMode[],
    entryMode: "side-only" as TeamEntryMode,
    sideOnlyCost: null as string | null,
    fixedReason: "",
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

describe("what a player plays off in one round", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    playerId: "p1", name: "Ainsley", member: 12, override: null as number | null,
    frozen: null as number | null, handicap: 12, source: "member" as const,
    editable: true, differsFromCurrent: null as number | null,
    ...over,
  });

  it("says nothing has been changed, rather than showing a field of boxes", async () => {
    // Almost every round wants the roster handicap. A row of inputs would
    // suggest an organizer is expected to fill them in.
    const { RoundHandicaps } = await import("@/components/RoundHandicaps");
    const html = render(<RoundHandicaps stageId="s1" rows={[row()]} />);
    expect(html).toContain("Everyone plays off their handicap from the roster");
    expect(html).toContain("Set one for this round");
  });

  it("counts the players a committee has decided for", async () => {
    const { RoundHandicaps } = await import("@/components/RoundHandicaps");
    const html = render(
      <RoundHandicaps
        stageId="s1"
        rows={[row({ override: 8, handicap: 8, source: "override" }), row({ playerId: "p2", name: "Brody" })]}
      />,
    );
    expect(html).toContain("1</b> player has a handicap set for this round");
  });

  it("says cards are in, rather than disabling a box with no explanation", async () => {
    const { RoundHandicaps } = await import("@/components/RoundHandicaps");
    const html = render(
      <RoundHandicaps
        stageId="s1"
        rows={[row({ frozen: 12, handicap: 12, source: "frozen", editable: false })]}
      />,
    );
    expect(html).toContain("keeps the handicaps it was scored against");
    expect(html).not.toContain("Set one for this round");
  });

  it("answers 'why is my net different in round one' without being asked", async () => {
    // The frozen round disagrees with today's roster. Volunteered, because
    // without it somebody eventually decides the app is wrong and re-enters
    // the round.
    const { RoundHandicaps } = await import("@/components/RoundHandicaps");
    const html = render(
      <RoundHandicaps
        stageId="s1"
        rows={[row({ frozen: 14, handicap: 14, source: "frozen", editable: false, differsFromCurrent: 9 })]}
      />,
    );
    expect(html).toContain("was scored off");
    expect(html).toContain("14");
    expect(html).toContain("9");
  });

  it("writes a plus handicap and scratch the way a golfer says them", async () => {
    // A plus player is "+2", never "-2", and nobody plays off "0".
    const { RoundHandicaps } = await import("@/components/RoundHandicaps");
    const html = render(
      <RoundHandicaps
        stageId="s1"
        rows={[
          row({ member: 0, frozen: -2, handicap: -2, source: "frozen", editable: false, differsFromCurrent: 0 }),
        ]}
      />,
    );
    expect(html).toContain("+2");
    expect(html).toContain("scratch");
  });
});

describe("whose card a team round is written on", () => {
  const scoring = async (over: Record<string, unknown>) => {
    const { RoundTeamScoring } = await import("@/components/RoundTeamScoring");
    return render(
      <RoundTeamScoring stageId="s1" info={{
        name: "Foursomes", allowance: 50, recommendedAllowance: 50,
        allowanceOverridden: false, allowanceIsConvention: false,
        shares: null, recommendedShares: null, sharesOverridden: false,
        countBest: null, countBestOverridden: false, maxSide: 2,
        entryChoices: ["side-only"], entryMode: "side-only", sideOnlyCost: null,
        fixedReason: teamEntryFixedReason("Foursomes"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...over } as any} />,
    );
  };

  it("states the fact for a shared ball rather than offering a choice", async () => {
    // Rule 22: one ball, alternating strokes. A dropdown with one option is a
    // question with one answer, and offering the other option would invite
    // somebody to invent a round nobody played.
    const html = await scoring({});
    expect(html).toContain("One ball, one card");
    expect(html).not.toContain("Scores are entered as");
  });

  it("gives a NET four-ball its own reason, not the one-ball one", async () => {
    /**
     * Rule 23.2b: in a handicap four-ball the side's score is the lower NET
     * ball, which a single team number cannot produce. So a net four-ball
     * has no choice either — but for a different reason, and telling a club
     * "one ball, one card" about their four-ball would be simply false.
     */
    const html = await scoring({
      name: "Four-Ball",
      entryChoices: ["per-player"],
      entryMode: "per-player",
      fixedReason: teamEntryFixedReason("Four-Ball", "net"),
    });
    expect(html).not.toContain("One ball, one card");
    expect(html).toContain("scored on net");
    // And the way to get the other shape back, rather than a dead end.
    expect(html).toContain("gross");
    expect(html).not.toContain("Scores are entered as");
  });

  it("offers the choice where both are physically real", async () => {
    // Rule 23: each player plays their own ball, so both scores exist and are
    // on the paper card.
    const html = await scoring({
      name: "Four-Ball",
      entryChoices: ["per-player", "side-only"],
      entryMode: "per-player",
      sideOnlyCost: "Recording only the side's score means this round cannot count towards anybody's handicap.",
      fixedReason: "",
    });
    expect(html).toContain("Scores are entered as");
    expect(html).toContain("Each player&#x27;s own card");
  });

  it("says what the reduced option costs, beside the control", async () => {
    // Not a footnote and not a title — see no-tooltip-refusals.test.ts. The
    // cost is that the round stops counting for anybody's handicap, and it is
    // given up silently because the entry screen afterwards looks the same.
    const html = await scoring({
      name: "Four-Ball",
      entryChoices: ["per-player", "side-only"],
      entryMode: "side-only",
      sideOnlyCost: "Recording only the side's score means this round cannot count towards anybody's handicap.",
      fixedReason: "",
    });
    expect(html).toContain("cannot count towards anybody");
  });

  it("says nothing about the cost until the reduced option is actually chosen", async () => {
    const html = await scoring({
      name: "Four-Ball",
      entryChoices: ["per-player", "side-only"],
      entryMode: "per-player",
      sideOnlyCost: "Recording only the side's score means this round cannot count towards anybody's handicap.",
      fixedReason: "",
    });
    expect(html).not.toContain("cannot count towards anybody");
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
        // A scramble is one ball, so there is no choice of card to offer.
        entryChoices: ["side-only"], entryMode: "side-only", sideOnlyCost: null,
        fixedReason: "",
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
    ranked: true,
    holesOwed: 18,
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

  /**
   * A card that stopped short.
   *
   * Rule 3.2a(3) ends a match when a side leads by more holes than remain, so
   * a match won 5&4 leaves four holes conceded under Rule 3.2b and never
   * played. The player is SHOWN with the holes they played and holds no
   * position — and the board has to say which, because an unexplained dash
   * where the rank should be reads as a bug.
   */
  it("shows a card that stopped short without giving it a position", async () => {
    const { PlayerLeaderboard } = await import("@/components/PlayerLeaderboard");
    const html = render(
      <PlayerLeaderboard
        isStroke
        rows={[
          row({ id: "p1", name: "A. Moore", toPar: -4 }),
          row({ id: "p9", name: "D. Shaw", thru: 14, rank: 0, ranked: false, toPar: 2 }),
        ]}
        holes={18}
        youId="p9"
      />,
    );
    expect(html).toContain("D. Shaw");
    // Said on the page, in the row. Not in a `title` — see
    // no-tooltip-refusals.test.ts for why that is not an explanation.
    expect(html).toContain("not ranked");
    // And their card is still there to read.
    expect(html).toContain("thru 14");
  });

  /**
   * "F" is a claim about the player's round, not about eighteen holes.
   *
   * Found by opening the board: a Round Robin stage holds the whole round
   * robin, so a flight of four gives each player three matches inside ONE
   * round. Measured against the round's hole count, fifty holes out of
   * fifty-four read as "F" — the board telling two players still short of a
   * full round that they had finished.
   */
  it("measures 'F' against what the player's own cards cover", async () => {
    const { PlayerLeaderboard } = await import("@/components/PlayerLeaderboard");
    const html = render(
      <PlayerLeaderboard
        isStroke
        holes={18}
        rows={[
          row({ id: "p1", name: "C. Roe", thru: 54, holesOwed: 54, toPar: 0 }),
          row({ id: "p2", name: "A. Vale", thru: 50, holesOwed: 54, rank: 0, ranked: false, toPar: 0 }),
        ]}
      />,
    );
    expect(html).toContain("thru 50 · not ranked");
    // The player who played all three of their matches HAS finished.
    expect(html).toContain("C. Roe");
    expect(html).not.toContain("thru 54");
  });

  it("captions the organizer's board with how much of the card came back", async () => {
    const { LeaderboardTable } = await import("@/components/LeaderboardTable");
    const html = render(
      <LeaderboardTable
        isStroke
        rows={[
          row({ id: "p1", name: "A. Moore", toPar: -4 }),
          row({
            id: "p9",
            name: "D. Shaw",
            thru: 50,
            holesOwed: 54,
            rank: 0,
            ranked: false,
            toPar: 2,
          }),
        ]}
      />,
    );
    expect(html).toContain("Not ranked — 50 of 54 holes played");
    // A player yet to tee off is not captioned: an empty row explains itself,
    // and labelling the whole field would bury the two rows this is for.
    const early = render(
      <LeaderboardTable
        isStroke
        rows={[row({ id: "p8", name: "E. Vance", thru: 0, rank: 0, ranked: false })]}
      />,
    );
    expect(early).not.toContain("Not ranked");
  });
});

describe("the scorecard shows the whole card", () => {
  /**
   * There were two grids in this app and neither showed everything: the
   * organizer's had yards, par, stroke index and a gross total but never the
   * shots a player receives or the net they produce, and the player's card had
   * no grid at all — one hole at a time, with no way to check the round
   * against the paper card in your pocket.
   *
   * One component now, rendered by both, so a card checked on a phone and the
   * same card on the console cannot disagree.
   */
  const pars = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
  const si = [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 16, 2, 6, 10, 18, 4, 12, 14];
  const strokes: (number | null)[] = [4, 6, 3, 5, 4, 4, 5, 4, 4, 4, 3, 6, 4, 5, 3, 4, 5, 4];

  it("shows every hole, both nines and the total", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable holes={18} pars={pars} strokeIndex={si} strokes={strokes} />,
    );
    // Every hole number is a column heading, 1 through 18.
    for (let h = 1; h <= 18; h += 1) expect(html, `hole ${h}`).toContain(`>${h}<`);
    expect(html).toContain("Out");
    expect(html).toContain("In");
    expect(html).toContain("Tot");
  });

  it("totals gross, to par and holes played", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable holes={18} pars={pars} strokeIndex={si} strokes={strokes} />,
    );
    // 77 gross against a par of 72.
    expect(html).toContain("77");
    expect(html).toContain("Gross");
    expect(html).toContain("To par");
    expect(html).toContain("+5");
    expect(html).toContain("18 of 18");
  });

  it("shows the shots received and the net they produce", async () => {
    // The part neither old grid had. A 12 handicap gets a stroke on the twelve
    // hardest holes, and the net has to be checkable from the card.
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const shots = si.map((n) => (n <= 12 ? 1 : 0));
    const html = render(
      <ScorecardTable
        holes={18}
        pars={pars}
        strokeIndex={si}
        strokes={strokes}
        shotsPerHole={shots}
        playingHandicap={12}
      />,
    );
    expect(html).toContain("Shots");
    expect(html).toContain("Net");
    expect(html).toContain("65"); // 77 less 12
  });

  it("counts par and shots over the holes PLAYED, not the whole course", async () => {
    // Through nine, "to par" against all eighteen would read nine under.
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const nine: (number | null)[] = [...strokes.slice(0, 9), ...new Array(9).fill(null)];
    const html = render(
      <ScorecardTable
        holes={18}
        pars={pars}
        strokeIndex={si}
        strokes={nine}
        shotsPerHole={si.map((n) => (n <= 12 ? 1 : 0))}
        playingHandicap={12}
      />,
    );
    expect(html).toContain("9 of 18");
    // 39 out against a par of 36.
    expect(html).toContain("39");
    expect(html).toContain("+3");
  });

  it("renders a nine-hole round without an empty back nine", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable
        holes={9}
        pars={pars.slice(0, 9)}
        strokeIndex={si.slice(0, 9)}
        strokes={strokes.slice(0, 9)}
      />,
    );
    expect(html).not.toContain(">10<");
    expect(html).not.toContain("Out");
    expect(html).toContain("Tot");
  });

  it("marks a birdie and a double the way a card does", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable holes={18} pars={pars} strokeIndex={si} strokes={strokes} />,
    );
    // Hole 2 is a 6 on a par 5 (over), hole 12 a 6 on a par 5 (over) — and the
    // classes are what the eye reads before the column is added up.
    expect(html).toContain("is-over");
  });

  it("reads as a card even before a score is entered", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable holes={18} pars={pars} strokeIndex={si} strokes={new Array(18).fill(null)} />,
    );
    expect(html).toContain("0 of 18");
    expect(html).toContain("Par");
    expect(html).toContain("S.I.");
  });
});

describe("MessagesClient", () => {
  const threads = [
    {
      id: "t1",
      scopeKey: "foursome:s1#Group 1",
      kind: "foursome" as const,
      title: "Your group",
      label: "Your group",
      lastMessageAt: Date.now() - 60_000,
      unread: 2,
      canPost: true,
      preview: "running 5 late",
    },
    {
      id: "t2",
      scopeKey: "event:",
      kind: "event" as const,
      title: "Everyone in this tournament",
      label: "Everyone in this tournament",
      lastMessageAt: Date.now() - 86_400_000,
      unread: 0,
      canPost: false,
      preview: "",
    },
  ];
  const composable = [{ key: "foursome:s1#Group 1", label: "Your group — Group 1", kind: "foursome" }];
  const people = [{ name: "Sam Ellis", email: "sam@example.invalid" }];

  it("lists conversations with their unread counts", async () => {
    const { MessagesClient } = await import("@/components/MessagesClient");
    const html = render(
      <MessagesClient threads={threads} composable={composable} people={people} isStaff={false} />,
    );
    expect(html).toContain("Your group");
    expect(html).toContain("running 5 late");
    // The badge is the whole reason a player opens this screen.
    expect(html).toContain(">2<");
  });

  it("comes up on the first day, before anybody has said anything", async () => {
    // The state every new tournament is in, and the one a list component is
    // most likely to crash reading rows[0] of.
    const { MessagesClient } = await import("@/components/MessagesClient");
    const html = render(<MessagesClient threads={[]} composable={[]} people={[]} isStaff />);
    expect(html).toContain("No conversations yet");
  });

  it("answers its own question about who a message is for", async () => {
    // "Who is this for?" sat above two selects, and picking a person set the
    // first one to a value none of its options carries — so it rendered blank
    // and the card showed no answer while a real one was in force.
    const { ComposePanel } = await import("@/components/MessagesClient");
    const html = render(
      <ComposePanel composable={composable} people={people} isStaff onOpen={() => {}} />,
    );
    expect(html).toContain("Going to everyone in");
    expect(html).toContain("Your group — Group 1");
    // Both selects have an accessible name; they had none at all before.
    expect(html).toContain('aria-label="Send to a group"');
    expect(html).toContain("…or send to one person");
  });

  it("says nothing false when there is no group to compose to", async () => {
    const { ComposePanel } = await import("@/components/MessagesClient");
    const html = render(<ComposePanel composable={[]} people={[]} isStaff onOpen={() => {}} />);
    expect(html).toContain("this tournament");
    expect(html).not.toContain("everyone in <b></b>");
  });

  it("renders a thread with no preview text without falling over", async () => {
    const { MessagesClient } = await import("@/components/MessagesClient");
    const html = render(
      <MessagesClient threads={[threads[1]]} composable={[]} people={[]} isStaff={false} />,
    );
    expect(html).toContain("No messages yet");
  });
});

describe("locked metered features", () => {
  /**
   * The locked state is a render path of its own, reached only when a club is
   * on a plan without the feature — which, today, is every club. So it is the
   * path most people actually see, and it had no coverage at all until this.
   */
  it("shows the card reader as locked rather than hiding it", async () => {
    const { CardPhotoReader } = await import("@/components/CardPhotoReader");
    const html = render(
      <CardPhotoReader
        stageId="s1"
        players={[{ id: "p1", name: "Rita" }]}
        holeCount={18}
        onReading={() => {}}
        available={false}
      />,
    );
    expect(html).toContain("Photograph a scorecard");
    expect(html).toContain("On the paid plan");
    // And it says what to do instead, so the screen is still usable.
    expect(html).toContain("Type the scores in below");
    // The control itself must be gone — a button that does nothing is worse
    // than no button.
    expect(html).not.toContain("Read from a photo");
  });

  it("shows the drafting panels as locked", async () => {
    const { DraftAssistant } = await import("@/components/DraftAssistant");
    const { DescribeTournament } = await import("@/components/DescribeTournament");

    const draft = render(<DraftAssistant onUse={() => {}} available={false} />);
    expect(draft).toContain("AjAi drafting");
    expect(draft).toContain("Write it yourself below");
    expect(draft).not.toContain("Write a draft");

    const describe = render(<DescribeTournament available={false} />);
    expect(describe).toContain("AjAi drafting");
    expect(describe).not.toContain("Work out the rounds");
  });

  it("disables the commentary draft button but leaves it visible", async () => {
    // Different treatment on purpose: this one is a single button inside a
    // panel that still works, so it greys out rather than replacing anything.
    const { CommentaryPanel } = await import("@/components/CommentaryPanel");
    const html = render(<CommentaryPanel items={[]} canPost aiAvailable={false} />);
    expect(html).toContain("AjAi draft");
    expect(html).toContain("disabled");
    // The whole sentence, including what to do instead — the same standard the
    // scorecard reader above is held to. It used to read "On the paid plan"
    // here and keep the useful half in a `title`, which never appears on a
    // phone and is not announced.
    expect(html).toContain("Drafting comes with the paid plan");
    expect(html).toContain("write your own line for now");
    expect(html).not.toContain("title=");
  });

  it("renders every one of them normally when the plan allows it", async () => {
    // The other half — the locked path must not have broken the working one.
    const { CardPhotoReader } = await import("@/components/CardPhotoReader");
    const { CommentaryPanel } = await import("@/components/CommentaryPanel");
    expect(
      render(
        <CardPhotoReader
          stageId="s1"
          players={[{ id: "p1", name: "Rita" }]}
          holeCount={18}
          onReading={() => {}}
        />,
      ),
    ).toContain("Read from a photo");
    expect(render(<CommentaryPanel items={[]} canPost />)).not.toContain("On the paid plan");
  });

  it("offers one reading for the whole card when more than one player is on it", async () => {
    // The failure this replaces: a fourball photographing the same piece of
    // paper four times, because the control only ever offered one player.
    const { CardPhotoReader } = await import("@/components/CardPhotoReader");
    const html = render(
      <CardPhotoReader
        stageId="s1"
        players={[
          { id: "p1", name: "Rita" },
          { id: "p2", name: "Sam" },
          { id: "p3", name: "Priya" },
          { id: "p4", name: "Marco" },
        ]}
        holeCount={18}
        onReading={() => {}}
      />,
    );
    expect(html).toContain("Read the whole card");
    // One photo, not four — said on the screen, because a scorer who does not
    // know that will take four.
    expect(html).toContain("4 players on this card");
    expect(html).not.toContain("Read from a photo");
  });

  it("shows the course card camera as locked rather than hiding it", async () => {
    const { CourseCardCamera } = await import("@/components/CourseCardCamera");
    const html = render(<CourseCardCamera holes={18} onReading={() => {}} available={false} />);
    expect(html).toContain("On the paid plan");
    // And the way in that always works, because pasting a card is free.
    expect(html).toContain("Paste or type the rows below");
    expect(html).not.toContain("Photograph the card");
  });

  it("renders the course card camera normally when the plan allows it", async () => {
    const { CourseCardCamera } = await import("@/components/CourseCardCamera");
    const html = render(<CourseCardCamera holes={9} onReading={() => {}} />);
    expect(html).toContain("Photograph the card");
    // The hole count is on screen: a nine-hole card read as eighteen is the
    // expensive mistake here, and it is the one thing the reader is told.
    expect(html).toContain("9 holes");
    expect(html).not.toContain("On the paid plan");
  });
});

describe("the two controls built after the audit", () => {
  // Both were shipped on a typecheck and a build alone, which is exactly the
  // hole this file exists to cover. Each renders in the states a committee
  // actually meets it in: nothing decided yet, waiting on earlier results,
  // and resolved.
  const rounds = [
    { id: "r1", label: "Round 1" },
    { id: "r2", label: "Round 2" },
  ];
  const players = [
    { id: "p1", name: "Rita Ahuja" },
    { id: "p2", name: "Tom Brooks" },
  ];

  it("offers the single match a rule before one has been chosen", async () => {
    const { SingleMatchRulePicker } = await import("@/components/SingleMatchRulePicker");
    const html = render(
      <SingleMatchRulePicker
        stageId="s1"
        rule={null}
        ruleLabel=""
        problem="No pairing rule set yet."
        aName=""
        bName=""
        matchId={null}
        stale={false}
        rounds={rounds}
        players={players}
      />,
    );
    expect(html).toContain("No pairing rule set yet.");
  });

  it("names the pair once the rule resolves, and offers to make the match", async () => {
    const { SingleMatchRulePicker } = await import("@/components/SingleMatchRulePicker");
    const html = render(
      <SingleMatchRulePicker
        stageId="s1"
        rule={{ kind: "seeds", a: 1, b: 2 }}
        ruleLabel="1st against 2nd"
        problem=""
        aName="Rita Ahuja"
        bName="Tom Brooks"
        matchId={null}
        stale={false}
        rounds={rounds}
        players={players}
      />,
    );
    expect(html).toContain("Rita Ahuja");
    expect(html).toContain("Tom Brooks");
  });

  it("renders the single match picker with no rounds and no players to point at", async () => {
    // The first day of a tournament: the stage exists and nothing else does.
    // "Winner of round X" has nothing to offer, which must not throw.
    const { SingleMatchRulePicker } = await import("@/components/SingleMatchRulePicker");
    expect(() =>
      render(
        <SingleMatchRulePicker
          stageId="s1"
          rule={{ kind: "stage-winners", a: "r1", b: "r2" }}
          ruleLabel="Winner of Round 1 against winner of Round 2"
          problem="Waiting on the earlier rounds."
          aName=""
          bName=""
          matchId={null}
          stale={false}
          rounds={[]}
          players={[]}
        />,
      ),
    ).not.toThrow();
  });

  it("explains the third-place play-off rather than showing a bare checkbox", async () => {
    const { ThirdPlaceControl } = await import("@/components/ThirdPlaceControl");
    const html = render(
      <ThirdPlaceControl stageId="s1" on={false} problem="" aName="" bName="" made={false} />,
    );
    expect(html).toContain("Play off for third");
    expect(html).toContain("beaten semi-finalists");
  });

  it("says what it is waiting for when the semi-finals are unplayed", async () => {
    const { ThirdPlaceControl } = await import("@/components/ThirdPlaceControl");
    const html = render(
      <ThirdPlaceControl
        stageId="s1"
        on
        problem="Waiting on the semi-finals — the losers of those two play for third."
        aName=""
        bName=""
        made={false}
      />,
    );
    expect(html).toContain("Waiting on the semi-finals");
    expect(html).not.toContain("Create the play-off");
  });

  it("names the two beaten semi-finalists once both semis are settled", async () => {
    const { ThirdPlaceControl } = await import("@/components/ThirdPlaceControl");
    const html = render(
      <ThirdPlaceControl
        stageId="s1"
        on
        problem=""
        aName="Rita Ahuja"
        bName="Tom Brooks"
        made={false}
      />,
    );
    expect(html).toContain("Rita Ahuja");
    expect(html).toContain("Create the play-off");
  });

  it("stops offering to create it once the play-off exists", async () => {
    // The guard against a second play-off is server-side, but the screen must
    // not keep inviting a click that will now be refused.
    const { ThirdPlaceControl } = await import("@/components/ThirdPlaceControl");
    const html = render(
      <ThirdPlaceControl
        stageId="s1"
        on
        problem=""
        aName="Rita Ahuja"
        bName="Tom Brooks"
        made
      />,
    );
    expect(html).not.toContain("Create the play-off");
    expect(html).toContain("Score entry");
  });
});

describe("side bets", () => {
  const field = [
    { id: "p1", name: "zz-Ann Reyes", playing: true },
    { id: "p2", name: "zz-Bo Kite", playing: true },
  ];
  const bets = async (over: Record<string, unknown> = {}) => {
    const { ContestsClient } = await import("@/components/ContestsClient");
    return render(
      <ContestsClient roundLabel="Round 1" stageId="s1" field={field}
        contests={[]} sideGames={[]} {...over} />,
    );
  };

  it("keeps every control on the side-bets card", async () => {
    const html = await bets();
    for (const control of [
      "Side bets — Round 1", "Add a bet",
      "Settled by the scores", "You name the winner",
      "Low gross", "Nassau", "Stake",
    ]) {
      expect(html, `missing control: ${control}`).toContain(control);
    }
  });

  it("does not claim there are no side bets while showing five", async () => {
    // The empty state counted `contests` and sat ABOVE the derived pots, which
    // are side bets with stake fields on them — so with no hand-settled
    // contest it read "No side bets on this round yet" directly above five.
    const html = await bets();
    expect(html).not.toContain("No side bets on this round yet");
    // It answers for its own group now, and says how to start one.
    expect(html).toContain("None on this round yet");
    expect(html.indexOf("You name the winner")).toBeLessThan(html.indexOf("None on this round yet"));
  });

  it("names both halves of the distinction, not just one", async () => {
    // "Settled by the scores" only means something against something else, and
    // that something was a bare list of contests under no heading at all.
    const html = await bets();
    expect(html.indexOf("Settled by the scores")).toBeLessThan(html.indexOf("You name the winner"));
  });

  it("explains the pot entry modes without making anyone switch to find out", async () => {
    // The unselected mode's help was a `title` on its button, so on a phone the
    // only way to read it was to switch — and opt-out marks the whole field as
    // in AND paid, so trying it moves money.
    const { POT_MODE_HELP } = await import("@/lib/domain/pot-entry");
    const html = await bets({
      contests: [{
        id: "c1", kind: "closest-pin", name: "zz-Closest to the pin", hole: 7, buyInCents: 500,
        entrantIds: [], winnerIds: [], potCents: 0, pending: [], entryMode: "opt-in", excluded: [],
      }],
    });
    // The mode IN FORCE is stated visibly, as it was before.
    expect(html).toContain(POT_MODE_HELP["opt-in"].slice(0, 40));
    // The comparison is behind a FieldInfo, which opens on TAP — so its panel
    // is not in a static render, and the assertion is that the opener is there
    // and says what it opens. That is the whole difference from a `title`: an
    // accessible name a screen reader announces and a finger can reach.
    expect(html).toContain("More about how a pot fills");
    // And the hover-only copy is gone.
    expect(html).not.toContain(`title="${POT_MODE_HELP["opt-out"]}"`);
  });
});

describe("the weekly sign-up calendar", () => {
  const round = (over: Record<string, unknown> = {}) => ({
    stageId: "s1", label: "Round 7", status: "in" as const, explicit: true,
    locked: false, playedOn: "2026-09-09", ...over,
  });
  const cal = async (rounds: ReturnType<typeof round>[]) => {
    const { AvailabilityCalendar } = await import("@/components/AvailabilityCalendar");
    return render(
      <AvailabilityCalendar rounds={rounds} today="2026-09-01" pending={false} onAnswer={() => {}} />,
    );
  };

  it("tells a screen reader whether the player is in or out", async () => {
    // The square was `<button role="gridcell">`, and overriding a button's
    // implicit role with gridcell takes aria-pressed with it — the attribute is
    // not supported there. So the one screen whose entire question is "am I
    // playing on these dates" announced no state at all. The lint rule had been
    // saying so and reading as a nag.
    const html = await cal([round({ status: "in" })]);
    expect(html).toContain('aria-pressed="true"');
    const out = await cal([round({ status: "out" })]);
    expect(out).toContain('aria-pressed="false"');
  });

  it("keeps the cell role on a container rather than on the button", async () => {
    const html = await cal([round()]);
    // A gridcell exists...
    expect(html).toContain('role="gridcell"');
    // ...and it is not the button, which keeps its own role and its state.
    expect(html).not.toMatch(/<button[^>]*role="gridcell"/);
  });

  it("keeps the weeks it already had in the data", async () => {
    // `m.weeks` is an array of weeks and the markup called .flat() on it, so a
    // screen reader got forty-two cells in one undifferentiated run.
    const html = await cal([round()]);
    expect(html).toContain('role="row"');
    expect(html).toContain('role="grid"');
    // September 2026 spans five weeks; the point is only that there is more
    // than one, so the flattening cannot come back unnoticed.
    expect((html.match(/role="row"/g) ?? []).length).toBeGreaterThan(1);
  });

  it("does not make a tappable square out of a day with no round", async () => {
    // A grid of thirty tappable nothings is how a player taps the wrong one.
    const html = await cal([round()]);
    // Far more cells than rounds, and exactly one button among them.
    expect((html.match(/role="gridcell"/g) ?? []).length).toBeGreaterThan(5);
    expect((html.match(/aria-pressed/g) ?? []).length).toBe(1);
  });
});

describe("the honours board", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: "h1", eventId: "e1", eventName: "zz Club Championship", dates: "May 2026",
    year: 2026, championName: "zz Alex Vaughn", confirmedBy: "zz Secretary", note: "", ...over,
  });
  const board = async (groups: unknown[], pending: unknown[] = [], canEdit = true) => {
    const { HonoursBoard } = await import("@/components/HonoursBoard");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return render(<HonoursBoard board={groups as any} pending={pending as any} canEdit={canEdit} />);
  };

  it("shows a confirmed champion and who said so", async () => {
    // "Says who" is the question a board gets asked, years later, by somebody
    // who was not there.
    const html = await board([{ year: 2026, entries: [entry()] }]);
    expect(html).toContain("zz Alex Vaughn");
    expect(html).toContain("confirmed by zz Secretary");
  });

  it("says the board is empty rather than showing nothing at all", async () => {
    expect(await board([])).toContain("Nothing on the board yet");
  });

  it("keeps a proposal visibly apart from the record", async () => {
    // A fresh computation must never read as a result. The heading is the
    // whole guard: one section is what the club decided, the other is what the
    // app thinks.
    const html = await board(
      [{ year: 2026, entries: [entry()] }],
      [{ eventId: "e2", eventName: "zz Summer Cup", dates: "Aug 2026", year: 2026,
         suggestion: { ok: true, playerId: "p2", name: "zz Sam Okafor", runnersUp: [] } }],
    );
    expect(html).toContain("Finished, not yet on the board");
    expect(html).toContain("Standings say");
  });

  it("asks the committee to decide a tie instead of naming somebody", async () => {
    // The app refuses to break a tie, so the screen has to offer the choice —
    // otherwise the refusal is a dead end and the tournament never goes up.
    const html = await board([], [{
      eventId: "e3", eventName: "zz Winter Meeting", dates: "", year: 2025,
      suggestion: { ok: false, reason: "tied", tied: [
        { playerId: "a", name: "zz Alex Vaughn", rank: 1 },
        { playerId: "b", name: "zz Sam Okafor", rank: 1 },
      ] },
    }]);
    expect(html).toContain("committee decides this one");
    expect(html).toContain("zz Alex Vaughn and zz Sam Okafor");
  });

  it("gives a reason when it will not propose anybody", async () => {
    const html = await board([], [{
      eventId: "e4", eventName: "zz Empty Cup", dates: "", year: 0,
      suggestion: { ok: false, reason: "no-results", tied: [] },
    }]);
    expect(html).toContain("nobody can be named");
  });

  it("offers no confirming and no removing to somebody who cannot edit", async () => {
    const html = await board(
      [{ year: 2026, entries: [entry()] }],
      [{ eventId: "e5", eventName: "zz X", dates: "", year: 2026,
         suggestion: { ok: true, playerId: "p", name: "zz Winner", runnersUp: [] } }],
      false,
    );
    expect(html).not.toContain("Put on the board");
    expect(html).not.toContain("off the board");
  });
});

describe("the roster and the tournament in front of it", () => {
  const member = (over: Partial<RosterRow> = {}): RosterRow => ({
    id: "m1", name: "zz-Priya Nair", email: "", phone: "", ghin: "",
    homeClub: "", gender: "", preferredTee: "", memberNumber: "", handicap: 12,
    handicapType: "18", handicapSource: "manual", status: "active", notes: "",
    entryCount: 0, lastEvent: "", entered: false, entryStatus: "out", ...over,
  });
  const roster = async (members: RosterRow[]) => {
    const { RosterClient } = await import("@/components/RosterClient");
    return render(
      <RosterClient clubName="zz-Club" orgKind="club" eventName="zz-Cup" fieldLocked={false}
        members={members} fieldSize={members.length} unlinkedCount={0} />,
    );
  };

  it("does not call a waitlisted member 'in field'", async () => {
    // They signed up and have no place. The person who most needs to know is
    // the organizer on this screen working out who else to add — and the roster
    // read every Player row as an entry whatever its status, so a full
    // tournament showed its whole queue as already playing.
    const html = await roster([member({ id: "w", name: "zz-Waiting", entered: true, entryStatus: "waitlisted" })]);
    expect(html).toContain("waitlisted");
    expect(html).not.toContain("in field");
  });

  it("still says 'in field' for somebody who actually has a place", async () => {
    const html = await roster([member({ entered: true, entryStatus: "in" })]);
    expect(html).toContain("in field");
    expect(html).not.toContain("waitlisted");
  });

  it("tags nobody who is not entered at all", async () => {
    // Most of a club roster is not in any one tournament. That is the ordinary
    // case, not an omission.
    const html = await roster([member()]);
    expect(html).not.toContain("in field");
    expect(html).not.toContain("waitlisted");
  });

  it("offers to show only the members who are NOT in this tournament", async () => {
    // Signing a field up means looking at exactly those people, and searching
    // one name at a time was the only way to find them.
    const html = await roster([member()]);
    expect(html).toContain("only those not in it");
    expect(html).toContain("only those in zz-Cup");
  });
});

describe("members", () => {
  // Typed as the row the component takes, so a new required field fails here
  // rather than widening to `string` and passing anything.
  const member = (over: Partial<RosterRow> = {}): RosterRow => ({
    id: "m1", name: "zz-Priya Nair", email: "zz1@example.invalid", phone: "", ghin: "",
    homeClub: "", gender: "", preferredTee: "", memberNumber: "", handicap: 12,
    handicapType: "18", handicapSource: "manual", status: "active", notes: "",
    entryCount: 0, lastEvent: "", entered: false, entryStatus: "out", ...over,
  });
  const roster = async (members: ReturnType<typeof member>[]) => {
    const { RosterClient } = await import("@/components/RosterClient");
    return render(
      <RosterClient clubName="zz-Club" orgKind="club" eventName="zz-Cup" fieldLocked={false}
        members={members} fieldSize={members.length} unlinkedCount={0} />,
    );
  };

  it("keeps every control on the members screen", async () => {
    const html = await roster([member()]);
    for (const control of [
      "Active members", "Inactive", "In zz-Cup", "Type",
      "Members (1)", "Search name, email, number", "Show inactive",
      "Add member", "Import CSV",
      "Name", "Index", "Contact", "Played", "Last event",
    ]) {
      expect(html, `missing control: ${control}`).toContain(control);
    }
  });

  it("calls the list what the sidebar calls it", async () => {
    // The page heading and the sidebar both say Members; the card said
    // "Roster". One screen, one list, two names.
    const html = await roster([member()]);
    expect(html).toContain("Members (1)");
    expect(html).not.toContain("Roster (1)");
  });

  it("keeps the remove button on screen and says why it refuses", async () => {
    // It used to render only when entryCount was 0, so for anybody who had
    // played the control simply was not there — and an organizer wondering why
    // had nothing to read. Present and refusing now, with the reason in the
    // accessible name, because a `title` never appears on a phone.
    const played = await roster([member({ entryCount: 3 })]);
    expect(played).toContain("Cannot remove zz-Priya Nair");
    expect(played).toContain("they have played in 3 tournaments");
    expect(played).toContain("Set them inactive instead");
    // And the rule once for the whole table, for anybody not using a reader.
    expect(played).toContain("A member who has played cannot be removed");

    // Somebody who has played nothing can still be removed, and the sentence
    // does not appear for a table where it applies to nobody.
    const fresh = await roster([member({ entryCount: 0 })]);
    expect(fresh).toContain("Remove zz-Priya Nair from the roster");
    expect(fresh).not.toContain("A member who has played cannot be removed");
  });

  it("counts one tournament without the plural", async () => {
    const html = await roster([member({ entryCount: 1 })]);
    expect(html).toContain("played in 1 tournament.");
  });
});

describe("club settings", () => {
  const club = async (over: Record<string, unknown> = {}) => {
    const { OrganizationClient } = await import("@/components/OrganizationClient");
    return render(
      <OrganizationClient
        name="Ridgeline National" shortName="" logoUrl="" city="" region="" country=""
        brandDisplay="short" kind="club" plan="free" eventCount={2} memberCount={9} canEdit
        {...over} />,
    );
  };

  it("keeps every control on club settings", async () => {
    const html = await club();
    for (const control of [
      "Type", "Plan", "Tournaments", "Staff",
      "Branding", "Organization name", "Short name", "Logo URL", "Name beside the logo",
      "Where the club is", "City", "State or region", "Country",
      "Preview", "Save changes",
    ]) {
      expect(html, `missing control: ${control}`).toContain(control);
    }
  });

  it("does not file the club's address under Branding", async () => {
    // The comment on that block said "Not branding" while it sat under a
    // heading reading Branding. The address prefills a new course's city; it
    // reaches no scorecard.
    const html = await club();
    expect(html.indexOf("Branding")).toBeLessThan(html.indexOf("Where the club is"));
    // One control, so the heading is the label — not repeated beneath itself.
    expect(html.match(/Where the club is/g)?.length ?? 0).toBe(1);
  });

  it("previews the header the same way twice", async () => {
    // Two previews of one header, disagreeing. The "Preview" card
    // re-implemented both halves by hand: `shortName || name`, which ignores
    // the "Name beside the logo" setting three inches to its left, and
    // charAt(0) for the monogram where brandMonogram takes two initials.
    const { brandMonogram, brandLines } = await import("@/lib/brand");
    const html = await club({ name: "Ridgeline National", shortName: "", brandDisplay: "full" });
    // "RN", not "R" — and it has to appear in BOTH boxes.
    expect(brandMonogram("Ridgeline National", "")).toBe("RN");
    expect(html.match(/>RN</g)?.length ?? 0).toBe(2);
    expect(html).not.toContain(">R<");
    // And with a short name set and display "full", both show the full name.
    const full = await club({ name: "Ridgeline National", shortName: "Ridgeline", brandDisplay: "full" });
    expect(brandLines("Ridgeline National", "Ridgeline", "full").primary).toBe("Ridgeline National");
    expect(full.match(/>Ridgeline National</g)?.length ?? 0).toBe(2);
  });
});

describe("how money works", () => {
  const money = async (over: Record<string, unknown> = {}) => {
    const { MoneySetup } = await import("@/components/MoneySetup");
    return render(
      <MoneySetup mode="tournament" eventMode="" orgMode="" orgKind="club" clubName="zz-Club" {...over} />,
    );
  };

  it("puts the club default on club settings, where the checklist sends people", async () => {
    // SETUP_HREF.money is /organization, and orgSetupState ticks the step off
    // `organization.moneyMode`. That column was written only from a collapsed
    // disclosure inside a card titled "Money in this tournament", on Prizes &
    // payouts — so the step could not be ticked by following its own link.
    const { SETUP_HREF } = await import("@/lib/domain/org-setup");
    expect(SETUP_HREF.money).toBe("/organization");
    const html = await money({ mode: "organization", orgMode: "", canEdit: true });
    for (const label of ["Costs handled outside the app", "Tournament kitty", "Split shared costs", "Follow what we are"]) {
      expect(html, `missing club money option: ${label}`).toContain(label);
    }
  });

  it("keeps the tournament's own choice, and says where the club default is", async () => {
    const html = await money();
    expect(html).toContain("Money in this tournament");
    // Every mode is still offered here, plus "follow the club".
    for (const label of ["Costs handled outside the app", "Tournament kitty", "Split shared costs"]) {
      expect(html, `missing tournament money option: ${label}`).toContain(label);
    }
    expect(html).toContain('href="/organization"');
  });

  it("does not let a read-only viewer change the club default", async () => {
    const html = await money({ mode: "organization", canEdit: false });
    expect(html).toContain("Only an organization owner or admin can change this");
    expect(html).toContain("disabled");
  });
});

describe("registration and field", () => {
  // Another screen with no render test of its own before today.
  const reg = async (over: Record<string, unknown> = {}) => {
    const { RegistrationClient } = await import("@/components/RegistrationClient");
    return render(
      <RegistrationClient
        confirmed={[]} waitlist={[]} pendingEntries={[]} locked={false} isAdmin roster={[]}
        event={{
          name: "zz-Club Championship", capacity: 32, status: "registration", regDeadline: "",
          registrationOverride: null, inviteMessage: "Come and play", organizationName: "zz-Club",
          dates: "", course: "", city: "", registrationOpen: false, registrationApproval: "auto",
          requirePhone: false, phoneLocked: false, registrationToken: "",
          ...over,
        }} />,
    );
  };

  it("keeps every control on the registration screen", async () => {
    const html = await reg({ registrationOpen: true, registrationToken: "zztok" });
    for (const control of [
      "Confirmed", "Waitlisted", "Registration closes", "Status",
      "Public sign-up link", "Take the link down", "When someone registers",
      "Auto-confirm to capacity", "Approve each entry", "Require a mobile number",
      "Invite players", "Message", "Add someone new", "Player name",
      "Close registration",
    ]) {
      expect(html, `missing control: ${control}`).toContain(control);
    }
  });

  it("does not give two different switches the same name", async () => {
    // The banner's "Close registration" is registrationOverride — whether this
    // tournament takes entries at all. The card's switch is registrationOpen —
    // whether the public link exists. They are not opposites, and both used to
    // say "registration": the card was titled "Open registration" and its
    // button read "Open registration" / "Close sign-ups", inches under a button
    // reading "Close registration".
    const html = await reg({ registrationOpen: false });
    expect(html).toContain("Publish the link");
    expect(html).not.toContain(">Open registration<");
    // The refusal in "Invite players" names the button by the words on it — a
    // refusal pointing at a button that no longer exists is worse than none.
    expect(html).toContain("Publish the sign-up link first");
  });

  it("says when a published link is turning everybody away", async () => {
    // Both switches are real and independent: decideIntake checks
    // registrationOpen AND registrationStatus. A live, copyable link on a
    // closed tournament refuses every visitor, and the screen said nothing.
    const html = await reg({
      registrationOpen: true, registrationToken: "zztok", registrationOverride: true,
    });
    expect(html).toContain("The link is live but this tournament is not taking");
    // And not when the tournament is actually accepting entries.
    const open = await reg({ registrationOpen: true, registrationToken: "zztok" });
    expect(open).not.toContain("The link is live but");
  });

  it("does not tell an organizer that closing is cosmetic", async () => {
    // "closing only changes what this says" was false. registrationStatus
    // returning acceptingEntries:false makes decideIntake refuse the entry.
    const html = await reg({ registrationOverride: true });
    expect(html).not.toContain("only changes what this says");
    // The specific sentence, not just the words "sign-up link" — those also
    // appear in the invite card's refusal, which would pass this vacuously.
    expect(html).toContain("while it is closed the sign-up link turns everyone else away");
  });
});

describe("tournament details", () => {
  // Neither this component nor the /event page had a render test — the screen
  // was covered by smoke alone, which proves it does not 500 and nothing else.
  const setup = async (over: Record<string, unknown> = {}) => {
    const { EventSetupClient } = await import("@/components/EventSetupClient");
    return render(
      <EventSetupClient
        playersCount={24}
        courses={[{ id: "c1", name: "Bushwood", city: "Chicago", address: "" }]}
        initial={{
          name: "zz-Club Championship", dates: "", format: "match", course: "Bushwood",
          courseId: "c1", courseMode: "fixed", city: "Chicago", address: "", regDeadline: "", capacity: 32,
          playerCountMode: "registration", manualPlayerCount: 0, sideStyle: "individual",
          ...over,
        }} />,
    );
  };

  it("keeps every control on the setup card", async () => {
    // The guard against a separation becoming a removal. Manual mode, so the
    // target and its Apply button are in the markup too.
    const html = await setup({ playerCountMode: "manual", manualPlayerCount: 24 });
    for (const control of [
      "Tournament identity", "Tournament name", "Tournament dates",
      "The kind of golf", "Scoring", "Match play", "Stroke play", "How do people play?",
      "Venue", "Golf course", "City", "Address",
      "Registration", "Registration deadline", "Field capacity",
      "Where the field size comes from", "Player count", "From registrations",
      "Target player count", "Apply",
      // The save button reads "Saved" until something is dirty, which on a
      // fresh render is always.
      "Summary", "Recommended flow", "Saved",
    ]) {
      expect(html, `missing control: ${control}`).toContain(control);
    }
  });

  it("does not file the scoring questions under Tournament identity", async () => {
    // A name and a date say WHICH tournament this is. Match-versus-stroke and
    // singles-versus-sides say what kind of golf it is, and both used to sit
    // under "Tournament identity" where nobody would look for them.
    const html = await setup();
    expect(html.indexOf("Tournament identity")).toBeLessThan(html.indexOf("The kind of golf"));
    expect(html.indexOf("The kind of golf")).toBeLessThan(html.indexOf("How do people play?"));
  });

  it("does not name a section after a screen that already has that name", async () => {
    // "Registration & field" is the SIDEBAR SCREEN at /registration. A section
    // of this card wore the same name, and the Recommended flow card below it
    // told organizers to go to "Registration & field" — meaning the screen.
    const html = await setup();
    // Once, in the Recommended flow list, where it means the screen.
    expect(html.match(/Registration &amp; field/g)?.length ?? 0).toBe(1);
  });

  it("separates the field-resizing tool from the registration rules", async () => {
    // The deadline and the capacity decide whether the public form takes an
    // entry. "Player count" → Manual → Apply waitlists confirmed players,
    // invents placeholder rows and deletes scored matches. One heading held
    // all three.
    const html = await setup({ playerCountMode: "manual" });
    expect(html.indexOf("Field capacity")).toBeLessThan(html.indexOf("Where the field size comes from"));
    expect(html.indexOf("Where the field size comes from")).toBeLessThan(html.indexOf("Player count"));
  });

  it("names real screens in the recommended flow", async () => {
    const { NAV } = await import("@/lib/nav");
    const labels = new Set(NAV.flatMap((s) => s.items.map((i) => i.label)));
    const html = await setup();
    // Every screen the flow names has to be one the sidebar actually offers.
    // The list used to say "Rounds & format" (it is Rounds & formats) and
    // "Prizes & Reports" (two screens, neither called that).
    for (const label of ["Rounds &amp; formats", "Tee sheet", "Score entry", "Qualification", "Bracket", "Prizes &amp; payouts", "Reports &amp; export", "Flights"]) {
      const plain = label.replace(/&amp;/g, "&");
      expect(labels, `not a real screen: ${plain}`).toContain(plain);
      expect(html, `not named in the flow: ${plain}`).toContain(label);
    }
  });
});

describe("the setup checklist", () => {
  const state = async (over: Record<string, unknown> = {}) => {
    const { orgSetupState } = await import("@/lib/domain/org-setup");
    return orgSetupState({
      kind: "club",
      named: true,
      hasCourse: true,
      memberCount: 30,
      eventCount: 1,
      moneyAnswered: true,
      ...over,
    });
  };

  it("renders nothing once everything that applies is done", async () => {
    // A checklist that stays on screen congratulating itself is clutter on
    // every visit afterwards.
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    expect(render(<OrgSetupChecklist state={await state()} />)).toBe("");
  });

  it("lists what is left and marks the next one", async () => {
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    const html = render(<OrgSetupChecklist state={await state({ memberCount: 0, eventCount: 0 })} />);
    expect(html).toContain("Add your members");
    expect(html).toContain("Next");
  });

  it("says what an undone step costs", async () => {
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    expect(render(<OrgSetupChecklist state={await state({ memberCount: 0 })} />)).toContain("empty field");
  });

  it("leaves every step a live link, including ones not reached yet", async () => {
    // The point of a checklist rather than a gate: creating the tournament
    // before the roster is loaded is a normal way to work.
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    const { SETUP_HREF } = await import("@/lib/domain/org-setup");
    const html = render(<OrgSetupChecklist state={await state({ memberCount: 0, eventCount: 0 })} />);
    // Read from the table rather than written out again here. This line used
    // to assert `href="/tournaments/new"`, a route that has never existed —
    // the test agreed with the code and both were wrong. What routes exist is
    // checked against the filesystem in org-setup.test.ts.
    expect(html).toContain(`href="${SETUP_HREF.tournament}"`);
    expect(html).not.toContain("disabled");
  });

  it("renders for a personal organizer without inventing a roster step", async () => {
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    const html = render(
      <OrgSetupChecklist state={await state({ kind: "personal", eventCount: 0, memberCount: 0 })} />,
    );
    expect(html).not.toContain("Add your members");
  });

  it("does not link a step at the page it is already on", async () => {
    // On /choose, "Create your first tournament" pointed at /choose?stay=1 —
    // the page it was on, directly above CreateFirstTournament, the form that
    // does it. The query string is not part of "which page is this".
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    const html = render(
      <OrgSetupChecklist currentPath="/choose"
        state={await state({ memberCount: 0, eventCount: 0 })} />,
    );
    expect(html).not.toContain('href="/choose');
    // The row itself stays: it is a real step, it is what a brand-new
    // organizer does next, and dropping it would understate "0 of 5 done".
    expect(html).toContain("Create your first tournament");
    expect(html).toContain("You do this one on this page");
    // Only that one row loses its link — the others are unaffected.
    expect(html).toContain('href="/roster"');
  });

  it("still links it from anywhere else", async () => {
    const { OrgSetupChecklist } = await import("@/components/OrgSetupChecklist");
    const { SETUP_HREF } = await import("@/lib/domain/org-setup");
    const html = render(
      <OrgSetupChecklist currentPath="/dashboard"
        state={await state({ memberCount: 0, eventCount: 0 })} />,
    );
    expect(html).toContain(`href="${SETUP_HREF.tournament}"`);
    expect(html).not.toContain("You do this one on this page");
  });
});

describe("the single match picker does not invent a rule", () => {
  const picker = async (rule: unknown) => {
    const { SingleMatchRulePicker } = await import("@/components/SingleMatchRulePicker");
    return render(
      <SingleMatchRulePicker
        stageId="s3"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rule={rule as any}
        ruleLabel={rule ? "1st in the standings v 2nd" : "No pairing set"}
        problem={rule ? "" : "This round has no pairing rule set — choose who plays it."}
        aName="Tom Halloran"
        bName="Diego Alvarez"
        matchId={null}
        stale={false}
        rounds={[{ id: "s1", label: "Round 1" }, { id: "s2", label: "Round 2" }, { id: "s3", label: "Round 3" }]}
        players={[{ id: "p1", name: "Tom Halloran" }, { id: "p2", name: "Diego Alvarez" }]}
      />,
    );
  };

  it("selects nothing and shows no dropdowns when no rule is stored", async () => {
    // THE BUG. `useState(rule?.kind ?? "seeds")` made the editor invent an
    // answer: the segmented control highlighted "From the standings" and the
    // seed dropdowns rendered "1st in the standings" against "2nd", directly
    // above a box reading "This round has no pairing rule set". The screen
    // showed a complete pairing and denied it existed in the same breath.
    const html = await picker(null);
    expect(html).toContain("No pairing set");
    // The seed dropdowns must not be there to be read as an answer.
    expect(html).not.toContain("1st in the standings");
    // Nothing in the segmented control is marked selected.
    expect(html).not.toMatch(/class="[^"]*\bon\b[^"]*"/);
  });

  it("still offers all three rules to choose from", async () => {
    // Separation, not removal: the options are all still there.
    const html = await picker(null);
    for (const label of ["From the standings", "Winners of two rounds", "Two players I pick"]) {
      expect(html, label).toContain(label);
    }
  });

  it("shows the stored rule when there actually is one", async () => {
    const html = await picker({ kind: "seeds", a: 1, b: 2 });
    expect(html).toContain("1st in the standings");
    expect(html).toContain("Tom Halloran");
  });
});

describe("play settings name one thing per heading", () => {
  const settings = {
    leaderboardVisibility: "players",
    scoreEntryBy: "players",
    scoreEntryWindow: "anytime",
    voiceEntry: false,
    playerAccess: "code",
    scoreApproval: "players",
    attendanceMode: "off",
    attestBy: "one",
  };
  const panel = async (mode: "tournament" | "organization") => {
    const { PlaySettings } = await import("@/components/PlaySettings");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return render(<PlaySettings mode={mode} settings={settings as any} canEdit />);
  };

  it("separates the four questions that shared one heading", async () => {
    // Seven controls sat flat under "Players & scoring", answering four
    // unrelated questions. The setting somebody came for could not be found
    // because nothing on screen named it — the "Match points & tiebreakers"
    // failure again.
    const html = await panel("tournament");
    for (const heading of ["Who can see results", "How scores get in", "Who signs off a result", "Weekly sign-up"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("keeps every control it had — this separates, it does not remove", async () => {
    // Asserts the OPTIONS, not the headings. Two controls had their label
    // suppressed because the group heading above already said the same words,
    // so checking for the label would pass while the control itself had gone.
    const html = await panel("tournament");
    for (const option of [
      "Organizers only", // who can see the leaderboard
      "Players may enter their own scores", // who enters scores
      "During the round, hole by hole", // when players may submit
      "An organizer approves each card", // who signs off
      "Everyone plays every round", // weekly sign-up
    ]) {
      expect(html, option).toContain(option);
    }
  });

  it("does not say the same words twice in a row", async () => {
    // Grouping put "Who signs off a result" directly under a heading reading
    // "Who signs off a result". Separation that makes a screen wordier rather
    // than clearer is not the point of this pass.
    const html = await panel("tournament");
    for (const words of ["Who signs off a result", "Weekly sign-up"]) {
      expect(html.split(words).length - 1, words).toBe(1);
    }
  });

  it("renders the house-defaults mode too, which shares this component", async () => {
    // It appears on the organization screen as well, so a change here lands
    // on two screens.
    expect(await panel("organization")).toContain("How scores get in");
  });
});

describe("the scorecard carries the club's own mark", () => {
  const card = async (brand?: { name: string; logoUrl?: string; secondary?: string } | null) => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    return render(
      <ScorecardTable
        holes={18}
        pars={new Array(18).fill(4)}
        strokes={new Array(18).fill(null)}
        brand={brand}
      />,
    );
  };

  it("puts the club's name and logo at the head of the card", async () => {
    // The app already renders a club's mark in the sidebar, the play shell and
    // the reports. The scorecard — the screen that most wants to look like the
    // club's own — was the one place that did not.
    const html = await card({ name: "Bushwood", logoUrl: "https://x.test/l.png" });
    expect(html).toContain("Bushwood");
    expect(html).toContain("https://x.test/l.png");
  });

  it("shows the name alone when there is no logo", async () => {
    // Most clubs have a name long before they host an image somewhere.
    const html = await card({ name: "Bushwood" });
    expect(html).toContain("Bushwood");
    expect(html).not.toContain("<img");
  });

  it("renders no header at all when unbranded", async () => {
    // Absent rather than falling back to the TourneyHQ mark. An unbranded card
    // should look like plain paper, not like it belongs to us — which is why
    // this does NOT use OrgBrand, whose fallback is right in a sidebar.
    const html = await card(null);
    expect(html).not.toContain("<img");
    expect(html).toContain("Par");
  });

  it("leaves every existing caller unchanged", async () => {
    // The prop is optional and omitted by default, so a card that never passes
    // one renders exactly what it rendered before.
    expect(await card(undefined)).not.toContain("<img");
  });

  it("leads with the course when it is not the club's own", async () => {
    // A scorecard is the COURSE's card. Heading a society's outing at Pebble
    // Beach with the society's name reads as though the society owns it.
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable
        holes={18}
        pars={new Array(18).fill(4)}
        strokes={new Array(18).fill(null)}
        brand={{ name: "Bushwood", logoUrl: "https://x.test/l.png" }}
        courseName="Pebble Beach Golf Links"
      />,
    );
    expect(html).toContain("Pebble Beach Golf Links");
    expect(html).toContain("Bushwood");
    expect(html.indexOf("Pebble Beach")).toBeLessThan(html.indexOf("Bushwood"));
  });

  it("leads with the club at the club's own course", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable
        holes={18}
        pars={new Array(18).fill(4)}
        strokes={new Array(18).fill(null)}
        brand={{ name: "Bushwood" }}
        courseName="Bushwood Links"
        venueIsHome
      />,
    );
    expect(html.indexOf("Bushwood")).toBeLessThan(html.indexOf("Par"));
  });

  it("says the name once when the club and the course are the same place", async () => {
    const { ScorecardTable } = await import("@/components/ScorecardTable");
    const html = render(
      <ScorecardTable
        holes={18}
        pars={new Array(18).fill(4)}
        strokes={new Array(18).fill(null)}
        brand={{ name: "Bushwood" }}
        courseName="Bushwood Golf Club"
      />,
    );
    expect(html.split("Bushwood").length - 1).toBe(1);
  });
  it("never puts our name on a club's card", async () => {
    // `EventBrand` carries showAttribution, and the sidebar honours it by
    // printing "Powered by TourneyHQ" beside the club's mark. That is right in
    // a sidebar and wrong on a scorecard, which is why `CardBrand` has no such
    // field and `cardBrand()` is the only way a page gets one.
    for (const html of [await card({ name: "Bushwood", logoUrl: "https://x.test/l.png" }), await card(null)]) {
      expect(html).not.toContain("TourneyHQ");
      expect(html).not.toContain("Powered by");
    }
  });
});

describe("the organization roles read as Commissioner", () => {
  const report = {
    events: [{ id: "e1", name: "Spring Medal", dates: "May 14" }],
    people: [
      {
        email: "pro@club.test", name: "The Pro", orgRole: "owner", memberId: "m1",
        hasLogin: true, access: { e1: { role: "admin", source: "organization" } },
      },
    ],
  };
  const panel = async () => {
    const { OrganizationAccess } = await import("@/components/OrganizationAccess");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return render(<OrganizationAccess report={report as any} canEdit />);
  };

  it("shows Commissioner and never Owner", async () => {
    // Ajay's call 2026-08-21. "Owner" is false for the most professional
    // audience: at a club the person in this seat is usually the professional
    // or the competition secretary, an employee. The club holds the account.
    const html = await panel();
    expect(html).toContain("Commissioner");
    expect(html).not.toContain("Owner");
  });

  it("still says the role holds the billing", async () => {
    // The one thing that distinguishes this role from Admin — their powers are
    // identical, `canAdministerOrg` is `owner || admin`. "Owner" implied money;
    // "Commissioner" does not, so the sentence has to carry it. If this
    // assertion is ever deleted, the distinction goes with it.
    expect(await panel()).toMatch(/billing/i);
  });

  it("shows the person stored as `owner` under the new label", async () => {
    // The mapping, which is the thing that could break: the label changed and
    // the stored value did not, because `owner` gates sixteen authorization
    // sites. This fixture's person has orgRole "owner", so a checked control
    // proves the label is reading that value rather than a renamed one.
    //
    // Not asserted via `value="owner"`: the radios carry the value in an
    // onChange closure, so it never reaches the markup. Asserting a string
    // that cannot appear would be a test that only ever proved itself wrong.
    const html = await panel();
    expect(html).toContain("Commissioner");
    expect(html).toContain("checked");
  });
});

describe("the lifecycle button names the phase, not the link", () => {
  const summary = {
    name: "Demo Cup", dates: "May 14–16", course: "Ridgeline", format: "Match Play",
    players: 33, flights: 8, rounds: 4,
  };
  const bar = async (status: string) => {
    const { LifecycleBar } = await import("@/components/LifecycleBar");
    return render(
      <LifecycleBar status={status} isAdmin configUnlocked={false} summary={summary} matchesScored={0} />,
    );
  };

  it("says what it does — move a phase — rather than promising a link", async () => {
    // It calls setEventStatus("registration"). It publishes no sign-up link
    // and does not change what registrationStatus decides, so "Open
    // registration" promised the one thing it did not do — while the public
    // link and the accepting-entries switch used the same word a few inches
    // away. Ajay's call 2026-08-21: the phase takes a different word.
    const html = await bar("draft");
    expect(html).toContain("Start taking entries");
    expect(html).not.toContain("Open registration");
  });

  it("leaves the later steps alone", async () => {
    // Only the draft step was ambiguous; renaming the rest would churn
    // vocabulary an organizer has already learned.
    expect(await bar("registration")).toContain("Mark ready");
    expect(await bar("ready")).toContain("Launch tournament");
  });
});

describe("the draw's refusal", () => {
  const controls = async (players: unknown[], locked = false) => {
    const { GroupingControls } = await import("@/components/GroupingControls");
    return render(
      <GroupingControls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        players={players as any}
        currentRule="balanced"
        currentMode="auto"
        currentValue={0}
        locked={locked}
      />,
    );
  };
  const player = (id: string) => ({ id, name: `Player ${id}`, handicap: 10, seed: 1, email: "" });

  it("says why the draw is dead on an empty field, and links to the fix", async () => {
    // The whole point. This button was `disabled={... players.length === 0}`
    // with no reason given anywhere on the page — the same dead-control
    // complaint that was raised about Rounds & formats.
    const html = await controls([]);
    expect(html).toMatch(/empty field/i);
    expect(html).toContain('href="/registration"');
  });

  it("puts the locked reason on the page, not only in a tooltip", async () => {
    // It was a `title`, which never appears on a touch device and is not
    // announced.
    const html = await controls([player("a"), player("b")], true);
    expect(html).toMatch(/lock/i);
    expect(html).toContain("href=");
  });

  it("says nothing at all when the draw can just go ahead", async () => {
    // The refusal must not become permanent furniture on a working screen.
    const html = await controls([player("a"), player("b")]);
    expect(html).not.toMatch(/empty field/i);
    expect(html).not.toContain('href="/registration"');
  });
});
