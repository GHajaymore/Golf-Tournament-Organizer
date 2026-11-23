import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundsScreen, type RoundsScreenProps } from "@/components/rounds/RoundsScreen";
import type { StageView } from "@/components/StagesClient";
import type { ScopeLock } from "@/lib/domain/tournament-status";
import type { ScreenKey } from "@/lib/domain/console-merges";
import { roundDrawHref } from "@/lib/domain/round-draw-door";
import { CupLineup } from "@/components/CupLineup";
import { MatchTiebreakControl } from "@/components/MatchTiebreakControl";
import { SingleMatchRulePicker } from "@/components/SingleMatchRulePicker";

/**
 * THE REDESIGNED ROUNDS & FORMATS RENDERS WHAT THE MACHINE SAID (R4), and mounts each control that leaves it exactly once.
 *
 * The first half draws the screen from invented rounds and asks of the markup what the brief promises: a ring where the
 * machine gave one, the state chip where it did not, text and one line for a played round, text and no control for a
 * completed event, the event's Scoring once. The second half is the mounted-once check: for each `shown` value of the room a
 * control leaves for, the draw, a round's handicaps and the closing controls are drawn in ONE place (here, or as a link/line
 * where the room is shown), never twice and never neither.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/attendance", actionModule);
vi.mock("@/app/actions/cup", actionModule);

const stage = (over: Partial<StageView> = {}): StageView => ({
  id: "r1", position: 0, type: "Stroke Play Round", description: "", format: "Stroke Play", closed: false, holes: 18, playedOn: "",
  deadline: "", scoringBasis: "net", scoreInput: "", matchKeptBy: "", carryEnabled: false, carryPct: 0, carryAsked: false, cutEnabled: false,
  cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall", cutTies: "ties", deadlineOverride: null, optDeadline: "", attendance: null,
  matchCount: 0, courseId: null, nine: "full", teamScoring: null, allowance: { allowance: 95, recommended: 95, overridden: false }, handicaps: [], ...over,
});

const two = [stage({ id: "r1", position: 0 }), stage({ id: "r2", position: 1 })];

const screen = (over: Partial<RoundsScreenProps> = {}): RoundsScreenProps => ({
  stages: two,
  today: "2026-10-11",
  rrMatchesPerPlayer: 0,
  scoring: { winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 },
  tiebreakers: [],
  qual: { mode: "overall", perFlight: 2, overall: 8 },
  confirmedCount: 8,
  chips: { r1: { chip: "Setting up", tone: "accent", standing: "setup" }, r2: { chip: "Setting up", tone: "accent", standing: "setup" } },
  rings: { r1: { set: 3, of: 3, holds: false }, r2: { set: 2, of: 3, holds: true } },
  dayMarks: { r1: null, r2: null },
  defaultDays: { r1: "2026-10-12", r2: "2026-10-13" },
  dayWords: "The event's first day, one round a day",
  allowanceSources: { r1: "the Rules' recommendation", r2: "the Rules' recommendation" },
  inheritedTees: {},
  eventScoring: { scoreEntryBy: "staff" },
  lock: { locks: [], correction: null, isAdmin: true, open: null },
  shown: [],
  drawHref: {},
  cup: null,
  ...over,
});

const render = (p: RoundsScreenProps) => renderToStaticMarkup(<RoundsScreen {...p} />);
const count = (html: string, needle: string) => html.split(needle).length - 1;
const lock = (by: ScopeLock["by"]): ScopeLock => ({ scope: "rounds", by, because: "Locked because it is.", wayOut: { says: "Reopen", href: "/event" }, correctable: false });

describe("the redesigned Rounds & formats draws the machine's answers", () => {
  it("draws one column per round, the ring where the machine gave one, and the Scoring card once", () => {
    const html = render(screen());
    expect(count(html, "data-round-column=")).toBe(2);
    expect(html).toContain("3 of 3 set");
    expect(html).toContain("2 of 3 set");
    expect(count(html, "data-scoring-tile")).toBe(1);
    expect(html).toContain("Can players enter scores?");
  });

  it("draws the state chip, not a ring, where the machine gave no ring", () => {
    const html = render(screen({ rings: { r1: null, r2: null }, chips: { r1: { chip: "Played", tone: "neutral", standing: "played" }, r2: { chip: "Next up", tone: "accent", standing: "active" } } }));
    expect(html).toContain("Played");
    expect(html).not.toContain("data-round-ring");
  });

  it("marks the default day and cites the allowance's source", () => {
    const html = render(screen({ dayMarks: { r1: "default", r2: null } }));
    expect(html).toContain("Default");
    expect(html).toContain("Allowance 95%, from the Rules&#x27; recommendation");
  });

  it("a round with scores on a live event is text with one line, and no format picker", () => {
    const html = render(screen({ roundsWithResults: ["r1"], launched: true, locked: true, lock: { locks: [lock("launch")], correction: null, isAdmin: true, open: null } }));
    expect(html).toContain("This round has scores, so its settings are locked.");
    expect(count(html, "Format for Round 1")).toBe(0);
    expect(count(html, "Format for Round 2")).toBeGreaterThan(0);
  });

  it("a completed event is every round as text under ONE banner, and no control", () => {
    const html = render(screen({ launched: true, locked: true, lock: { locks: [lock("completed")], correction: null, isAdmin: true, open: null } }));
    expect(count(html, "data-locked-once")).toBe(1);
    expect(html).not.toContain("<select");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("Add a round");
  });

  it("says who keeps the card from keepingShown: the committee's rule wins over a round's own", () => {
    const keeping = (scoreEntryBy: string) =>
      render(screen({ eventScoring: { scoreEntryBy }, stages: [stage({ id: "r1", scoreKeeping: "group" }), stage({ id: "r2", position: 1, scoreKeeping: "group" })] }));
    expect(keeping("players")).toContain("every round");
    expect(keeping("staff")).toContain("Organizer only");
    expect(keeping("players")).not.toContain("Organizer only");
  });
});

describe("a control that leaves this screen is mounted once, whatever room is shown", () => {
  // Round 2 of a launched event: the draw is owed (not the first round), its handicaps are drawn, its closing controls are play.
  const launched = (shown: RoundsScreenProps["shown"], drawHref: Record<string, string>) =>
    screen({
      launched: true,
      shown,
      drawHref,
      stages: [stage({ id: "r1", position: 0 }), stage({ id: "r2", position: 1, handicaps: [{ playerId: "p1", name: "Ann Example", member: 12, memberExact: 12, parStrokes: 0, override: 14, editable: true } as never] })],
      roundsWithResults: ["r2"],
      lock: { locks: [], correction: null, isAdmin: true, open: null },
    });

  it("the draw: a button here while Tee times & draw is not shown, a link there when it is", () => {
    const here = render(launched([], {}));
    // A stroke round is "given out" (cards), a pairing round "drawn": the one component says either.
    expect(count(here, "Give out Round 2&#x27;s cards")).toBe(1);
    expect(here).not.toContain("/foursomes?round=r2");
    const there = render(launched(["teeTimes"], { r2: "/foursomes?round=r2" }));
    expect(there).toContain("/foursomes?round=r2");
    // The press is gone from here (it would be a second copy).
    expect(count(there, "Give out Round 2")).toBe(0);
  });

  it("a round's handicaps: the control here while Tee times & draw is not shown, one line there", () => {
    const here = render(launched([], {}));
    const there = render(launched(["teeTimes"], { r2: "/foursomes?round=r2" }));
    expect(here).toContain("Handicaps for this round");
    expect(there).not.toContain("Handicaps for this round");
    expect(there).toContain("on Tee times");
  });

  it("closing a round: the controls here while Score entry is not shown, not drawn when it is", () => {
    const here = render(launched([], {}));
    const there = render(launched(["scoreEntry"], {}));
    expect(here).toContain("Scoring window");
    expect(there).not.toContain("Scoring window");
  });
});

describe("R4d: where a match round's next draw is made when Tee times & draw is shown too", () => {
  const draws = (family: Parameters<typeof roundDrawHref>[1], type: string, format: string) => {
    const href = roundDrawHref({ id: "r2", type, format }, family, "admin", new Set<ScreenKey>(["rounds", "teeTimes"]));
    const html = render(
      screen({
        launched: true,
        shown: ["rounds", "teeTimes"],
        drawHref: { r2: href },
        stages: [stage({ id: "r1", position: 0, type, format }), stage({ id: "r2", position: 1, type, format })],
      }),
    );
    return { href, html };
  };

  it("a round robin of a match event: Tee times & draw does not build it, so the one DrawRound stays here", () => {
    const { href, html } = draws("match", "Round Robin", "Match Play");
    expect(href).toBe("/stages");
    expect(count(html, "Draw Round 2&#x27;s matches")).toBe(1);
    expect(html).not.toContain("/foursomes?round=r2");
  });

  it("CONTROL: a stroke round of a stroke event, which Tee times & draw does build, has its draw there and not here", () => {
    const { href, html } = draws("stroke", "Stroke Play Round", "Stroke Play");
    expect(href).toContain("/foursomes");
    expect(count(html, "Give out Round 2")).toBe(0);
  });

  it("a knockout's third place stays here while its draw room does not build it", () => {
    const { href } = draws("knockout", "Bracket Stage", "Match Play");
    expect(href).toBe("/stages");
  });
});

describe("R4d: the cup's points to win and holder are drawn once, on Rounds or on the cup page", () => {
  const teams: [{ id: string; name: string }, { id: string; name: string }] = [
    { id: "a", name: "Oaks" },
    { id: "b", name: "Pines" },
  ];
  const lineup = (settingsHere: boolean) =>
    renderToStaticMarkup(
      <CupLineup teams={teams.map((t) => ({ ...t, players: [] })) as never} sessions={[]} pointsToWin={14.5} holder="a" locked={false} lockWhy={null} settingsHere={settingsHere} />,
    );
  const mounts = (html: string) => count(html, 'id="cup-target"');

  it("Rounds & formats not shown: the cup page holds the tile and Rounds draws none", () => {
    expect(mounts(lineup(true))).toBe(1);
    expect(mounts(render(screen({ cup: null })))).toBe(0);
  });

  it("Rounds & formats shown: Rounds holds the one tile, with the saved figures; the cup page says where it went", () => {
    const rounds = render(screen({ cup: { teams, pointsToWin: 14.5, holder: "a" }, shown: ["rounds"] }));
    expect(mounts(rounds)).toBe(1);
    expect(rounds).toContain('value="14.5"');
    const page = lineup(false);
    expect(mounts(page)).toBe(0);
    expect(page).toContain("data-cup-settings-moved");
    expect(mounts(rounds) + mounts(page)).toBe(1);
  });

  it("a shut rounds scope greys Save on Rounds and says why beside it", () => {
    const html = render(screen({ cup: { teams, pointsToWin: 0, holder: "" }, lock: { locks: [lock("launch")], correction: null, isAdmin: true, open: null } }));
    expect(html).toContain("Locked because it is.");
    expect(html).toContain("cup-settings-why");
  });
});

describe("R4d: the explanations that left the face are behind an ⓘ on the new screen only", () => {
  const tie = (redesign?: boolean) => renderToStaticMarkup(<MatchTiebreakControl selected={[]} holes={18} locked={false} redesign={redesign} />);
  const words = "Tried in order, stopping at the first step that separates them.";

  it("today's screen draws the sentence on the face", () => {
    expect(tie()).toContain(words);
    expect(tie(false)).toContain(words);
  });

  it("the redesigned screen draws an ⓘ that names it, and the sentence is read by opening it", () => {
    const html = tie(true);
    expect(html).not.toContain(words);
    expect(html).toContain("More about if a match finishes all square");
  });

  it("the single match's rule explains itself the same way", () => {
    const picker = (redesign?: boolean) =>
      renderToStaticMarkup(
        <SingleMatchRulePicker stageId="r1" rule={null} ruleLabel="" problem="" aName="" bName="" matchId={null} stale={false} rounds={[]} players={[]} locked={false} redesign={redesign} />,
      );
    expect(picker()).toContain("One match, and the two players are worked out");
    expect(picker(true)).not.toContain("One match, and the two players are worked out");
    expect(picker(true)).toContain("More about who plays this match");
  });
});
