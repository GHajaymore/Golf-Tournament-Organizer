import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StagesClient, type StageView } from "@/components/StagesClient";
import { RoundsScreen, type RoundsScreenProps } from "@/components/rounds/RoundsScreen";
import { CloseThisRound } from "@/components/entry/CloseThisRound";
import { RoundVenue } from "@/components/RoundVenue";
import { readSource } from "./source";

/**
 * CLOSING A ROUND HAS ONE HOME AT A TIME (R12). Score entry takes "This round is finished" and the scoring window from the
 * Rounds screens while its key is shown, so for each answer of that ONE boolean they are drawn in exactly one place, counting the
 * old Rounds screen and the redesigned one: never twice (the same press in two rooms), never neither (a round nobody can close).
 * The second half holds the pages to the boolean, since a render cannot see which page asked it.
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

const oldProps = {
  stages: [stage({ id: "r1", position: 0 })],
  today: "2026-10-11",
  rrMatchesPerPlayer: 0,
  scoring: { winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 },
  tiebreakers: [],
  qual: { mode: "overall", perFlight: 2, overall: 8 },
  confirmedCount: 8,
  chainsRounds: false,
  launched: true,
  // A card is in, so the round has play to speak of and the old screen would draw the tick.
  roundsWithResults: ["r1"],
};

const redesigned = (shown: RoundsScreenProps["shown"]): RoundsScreenProps => ({
  ...oldProps,
  chips: { r1: { chip: "Being played", tone: "accent", standing: "setup" } },
  rings: { r1: { set: 3, of: 3, holds: false } },
  dayMarks: { r1: null },
  defaultDays: { r1: "2026-10-12" },
  dayWords: "The event's first day, one round a day",
  allowanceSources: { r1: "the Rules' recommendation" },
  inheritedTees: {},
  eventScoring: { scoreEntryBy: "staff" },
  lock: { locks: [], correction: null, isAdmin: true, open: null },
  shown,
  drawHref: {},
  cup: null,
  onTheDayHere: !shown.includes("scoreEntry"),
});

const TICK = "This round is finished";
const count = (html: string, needle: string) => html.split(needle).length - 1;

const scoreEntryDraws = () =>
  renderToStaticMarkup(
    <CloseThisRound stageId="r1" label="Round 1" closed={false} tick cardsCounted pointsBoard={false} deadline="" deadlineOverride={null} today="2026-10-11" missing={[]} withdrawDoor={null} />,
  );

describe("the tick is drawn in exactly one room", () => {
  it("with Score entry NOT shown: once, on the old Rounds screen; none on Score entry", () => {
    const old = renderToStaticMarkup(<StagesClient {...oldProps} onTheDayHere />);
    expect(count(old, TICK)).toBe(1);
    // The redesigned Rounds screen, with Score entry not shown, draws it too (it is the room until Score entry is shown).
    const rounds = renderToStaticMarkup(<RoundsScreen {...redesigned([])} />);
    expect(count(rounds, TICK)).toBe(1);
  });

  it("with Score entry shown: none on either Rounds screen; once on Score entry", () => {
    const old = renderToStaticMarkup(<StagesClient {...oldProps} onTheDayHere={false} />);
    expect(count(old, TICK)).toBe(0);
    expect(count(old, "Scoring window")).toBe(0);
    const rounds = renderToStaticMarkup(<RoundsScreen {...redesigned(["scoreEntry"])} />);
    expect(count(rounds, TICK)).toBe(0);
    expect(count(rounds, "Scoring window")).toBe(0);
    const there = scoreEntryDraws();
    expect(count(there, TICK)).toBe(1);
    expect(count(there, "Scoring window")).toBe(1);
  });

  it("the old screen draws the whole paragraph, and Score entry draws the short line with the paragraph behind an ⓘ", () => {
    const old = renderToStaticMarkup(<StagesClient {...oldProps} onTheDayHere />);
    expect(old).toContain("Leave it unticked while cards are still coming in.");
    expect(old).not.toContain("what closing a round does");
    const there = scoreEntryDraws();
    expect(there).toContain("Tell the board the round is over.");
    expect(there).toContain("what closing a round does");
  });
});

describe("the cards still to come, with the two answers", () => {
  const draw = (over: { closed?: boolean; missing?: { id: string; name: string }[] }) =>
    renderToStaticMarkup(
      <CloseThisRound
        stageId="r1"
        label="Round 2"
        closed={over.closed ?? false}
        tick
        cardsCounted
        pointsBoard={false}
        deadline=""
        deadlineOverride={null}
        today="2026-10-11"
        missing={over.missing ?? []}
        withdrawDoor={null}
      />,
    );
  const two = [{ id: "p1", name: "Zz Ann" }, { id: "p2", name: "Zz Bo" }];

  it("lists each player with the board's answer and the one other, and says the section needs you", () => {
    const html = draw({ missing: two });
    expect(html).toContain("2 players have no card for");
    expect(html).toContain("Zz Ann");
    expect(html).toContain("Zz Bo");
    expect(count(html, "No card returned: Round 2")).toBe(2);
    expect(count(html, "Withdrew</button>")).toBe(2);
    expect(html).toContain("No card was returned for Round 2");
    expect(html).toContain('data-needs-you="true"');
    expect(html).toContain("2 cards to come");
  });

  it("CONTROL: with every card in, or the round closed, it lists nobody and does not need you", () => {
    const inHand = draw({});
    expect(inHand).not.toContain("data-missing-cards");
    expect(inHand).toContain('data-needs-you="false"');
    const closed = draw({ closed: true, missing: two });
    expect(closed).not.toContain("data-missing-cards");
    expect(closed).toContain("Round 2 is closed");
  });
});

describe("a fixed course asks no Played at on Score entry, and the round's Tees stay", () => {
  const tee = (id: string, name: string) => ({ id, courseId: "c1", name, courseRating: 70, slopeRating: 120, par: 72, rated: true });
  const carded = { name: "Bushwood", courseId: "c1", hasCard: true };
  const draw = (tees: ReturnType<typeof tee>[], pickersHere: boolean) =>
    renderToStaticMarkup(
      <RoundVenue
        stageId="s1"
        courseId=""
        venues={[{ id: "c1", name: "Bushwood" }]}
        library={[{ id: "c1", name: "Bushwood", tees }, { id: "c2", name: "Ridgeline", tees: [] }]}
        venue={carded}
        canEdit
        teesDoor={null}
        pickersHere={pickersHere}
      />,
    );

  it("a course with two tee sets shows Tees and no Played at while the picker is off", () => {
    const html = draw([tee("t1", "White"), tee("t2", "Yellow")], false);
    expect(html).toContain("Tees");
    expect(html).toContain("White");
    expect(html).not.toContain("Played at");
  });

  it("CONTROL: the old screen draws both, and a course with one tee set draws nothing here", () => {
    const old = draw([tee("t1", "White"), tee("t2", "Yellow")], true);
    expect(old).toContain("Played at");
    expect(old).toContain("Tees");
    expect(draw([tee("t1", "White")], false)).toBe("");
  });
});

describe("every staff branch of Score entry carries the close section", () => {
  it("each return after the active round is chosen draws closingFor, except the player-only and casual ones", () => {
    const src = readSource("src/app/(app)/entry/page.tsx");
    const from = src.indexOf("const closingFor");
    expect(from).toBeGreaterThan(0);
    // The three staff branches: a match kept by tapping, a team round, and the individual card.
    expect((src.slice(from).match(/closingFor\(/g) ?? []).length).toBe(3);
    expect(src).toContain("{await closingFor([])}");
    expect(src).toContain("closingFor(absentByStage[");
  });

  it("a team round draws the tick and the window, and no cards to come", () => {
    const html = renderToStaticMarkup(
      <CloseThisRound stageId="r1" label="Round 1" closed={false} tick cardsCounted={false} pointsBoard={false} deadline="" deadlineOverride={null} today="2026-10-11" missing={[]} withdrawDoor={null} />,
    );
    expect(html).toContain(TICK);
    expect(html).toContain("Scoring window");
    expect(html).not.toContain("Cards are in");
  });

  it("a round with no tick is titled for what it holds", () => {
    const html = renderToStaticMarkup(
      <CloseThisRound stageId="r1" label="Round 1" closed={false} tick={false} cardsCounted={false} pointsBoard={false} deadline="" deadlineOverride={null} today="2026-10-11" missing={[]} withdrawDoor={null} />,
    );
    expect(html).toContain("Scoring window for Round 1");
    expect(html).not.toContain(TICK);
  });
});

describe("the pages ask the one boolean", () => {
  it("Rounds & formats says whether the round is closed there, from the same key Score entry asks", () => {
    expect(readSource("src/app/(app)/stages/page.tsx")).toContain('onTheDayHere={!shown.has("scoreEntry")}');
  });

  it("Score entry draws its close section only while its key is shown, for staff", () => {
    const entry = readSource("src/app/(app)/entry/page.tsx");
    const at = entry.indexOf("<CloseThisRound");
    expect(at).toBeGreaterThan(0);
    const guard = entry.slice(entry.indexOf("const closingFor"), at);
    expect(guard).toContain('!shown.has("scoreEntry")');
    expect(guard).toContain("!isStaff");
    expect(guard).toContain("casualRound");
    expect(entry).toContain('playedAtOnlyOpen={shown.has("scoreEntry")}');
  });

  it("every mount of the tick says where its words go (infoBehind is required, so a third site cannot forget)", () => {
    const sites = [
      ["src/components/rounds/RoundOnTheDay.tsx", "infoBehind={false}"],
      ["src/components/entry/CloseThisRound.tsx", "infoBehind"],
    ] as const;
    for (const [file, prop] of sites) expect(readSource(file), file).toContain(prop);
    expect(readSource("src/components/RoundClosedControl.tsx")).toMatch(/infoBehind: boolean;/);
  });

  it("Results draws its one verb only while its key is shown", () => {
    const reports = readSource("src/app/(app)/reports/page.tsx");
    expect(reports).toContain('has("results")');
    expect(reports).toContain("<ReleaseResults");
  });
});
