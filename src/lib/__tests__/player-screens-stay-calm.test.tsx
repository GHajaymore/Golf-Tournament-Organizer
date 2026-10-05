import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/attendance", () => ({ setAttendance: async () => ({ ok: true }) }));
vi.mock("@/app/actions/tournament", () => ({
  saveScorecard: async () => ({ ok: true }),
  certifyScorecard: async () => ({ ok: true }),
  disputeScorecard: async () => ({ ok: true }),
}));

const { RoundAvailability } = await import("@/components/RoundAvailability");
const { MicNote } = await import("@/components/MicNote");
const { AnnouncementList } = await import("@/components/AnnouncementList");
const { PlayerCard } = await import("@/components/PlayerCard");

/**
 * THE PLAYER'S SCREENS SAY A THING ONCE, AND SAY IT LARGE ENOUGH TO READ.
 *
 * Ajay, 2026-10-05: score entry and Today were "pretty crowded and font size
 * is small", with "warnings and information … required only once and not a
 * static sentence sitting there". Measured at 393px that day: 67% of the text
 * on `/me/card` and 50% on Today was under 13px, and Today was 2.5 screens
 * tall — over one of them two month grids answering "am I in next Thursday".
 *
 * Nothing was removed. Each promise below is that a sentence MOVED behind a
 * tap, or that the type grew — so each asserts the words are still in the
 * page, and each has a control that fails if the change is undone.
 */

const round = (stageId: string, playedOn: string) => ({
  stageId,
  label: `Week ${stageId}`,
  playedOn,
  dateLabel: "",
  whenLabel: "",
  optDeadline: "",
  deadlineLabel: "",
  status: "in" as const,
  explicit: false,
  locked: false,
});

describe("the type on a phone on the course", () => {
  /**
   * Labels at 13px or more, sentences at 14 — a floor, not a style. The full
   * scorecard grid (`ScorecardTable`) is deliberately NOT here: eighteen
   * columns on a phone is a table that scrolls, and its column heads are the
   * one place small type is the price of seeing the whole card at once.
   */
  const FILES = [
    "src/components/HoleByHoleCard.tsx",
    "src/components/PlayerCard.tsx",
    "src/components/GroupScoring.tsx",
    "src/components/CardConflict.tsx",
    "src/components/OnceTip.tsx",
    "src/components/AnnouncementCard.tsx",
    "src/components/FoldedAnnouncements.tsx",
    "src/components/TournamentSwitcher.tsx",
    "src/components/Scoreboard.tsx",
    "src/app/(player)/me/page.tsx",
    "src/app/(player)/me/card/page.tsx",
  ];
  const sizes = (src: string) => [...src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));

  it("finds the sizes it is checking — the control", () => {
    // A sweep that matched nothing would pass every file. The hole number is
    // 54px in HoleByHoleCard; if this cannot see it, it cannot see anything.
    expect(sizes(readSource("src/components/HoleByHoleCard.tsx"))).toContain(54);
    expect(sizes('style={{ fontSize: 11.5 }}')).toEqual([11.5]);
  });

  it.each(FILES)("%s sets nothing under 13px", (file) => {
    const small = sizes(readSource(file)).filter((n) => n < 13);
    expect(small, `${file} sets text at ${small.join(", ")}px`).toEqual([]);
  });
});

describe("a how-to sentence is said once, then kept a tap away", () => {
  it("keeps the microphone's promise in the page, folded", () => {
    // Folded on the server (no `open`), opened in the browser the first time
    // this phone shows it. The words never leave the markup.
    const html = renderToStaticMarkup(<MicNote />);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)/);
    expect(html).toContain("About the microphone");
    expect(html).toMatch(/never in the background/i);
  });

  it("puts availability's explanation behind the same fold on Today only", () => {
    const compact = renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={round("1", "2026-09-24")} future={[round("2", "2026-10-01")]} past={[]} compact />,
    );
    expect(compact).toContain("How this works");
    expect(compact).toContain("Say whether you");
    // Control: the console's own card still prints it as a sentence.
    const full = renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={round("1", "2026-09-24")} future={[round("2", "2026-10-01")]} past={[]} />,
    );
    expect(full).not.toContain("How this works");
    expect(full).toContain("Say whether you");
  });
});

describe("Today answers the next round, and keeps the season a tap away", () => {
  const html = renderToStaticMarkup(
    <RoundAvailability
      today="2026-09-19"
      playerId="p1"
      next={round("1", "2026-09-24")}
      future={[round("2", "2026-10-01"), round("3", "2026-10-08")]}
      past={[]}
      compact
    />,
  );

  it("puts the next round's In / Out above the fold", () => {
    const answer = html.indexOf('name="avail-1"');
    const fold = html.indexOf("See all rounds");
    expect(answer, "the next round has no In / Out").toBeGreaterThan(-1);
    expect(fold, "the season is not folded").toBeGreaterThan(-1);
    expect(answer).toBeLessThan(fold);
    expect(html).toContain("See all rounds (3)");
  });

  it("folds the calendar under it rather than dropping it", () => {
    // The calendar toggle is still there — inside the fold.
    expect(html.indexOf('name="avail-view"')).toBeGreaterThan(html.indexOf("See all rounds"));
  });

  it("is the form Today asks for", () => {
    // The component tests above prove `compact` works; this proves the
    // player's screen uses it.
    const me = readSource("src/app/(player)/me/page.tsx");
    const block = me.slice(me.indexOf("<RoundAvailability"), me.indexOf("/>", me.indexOf("<RoundAvailability")));
    expect(block).toMatch(/\bcompact\b/);
  });

  it("offers no fold when there is nothing past the next round", () => {
    const one = renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={round("1", "2026-09-24")} future={[]} past={[]} compact />,
    );
    expect(one).not.toContain("See all rounds");
    expect(one).toContain('name="avail-1"');
  });
});

describe("the tee time sits above the leaders on Today", () => {
  it("renders the group before the leaders board", () => {
    // Source order is render order here: both are top-level blocks of the
    // same fragment. "What time am I off" is asked before "who is leading".
    const src = readSource("src/app/(player)/me/page.tsx");
    const group = src.indexOf("round?.group && (");
    const leaders = src.indexOf("<ScoreboardLeaders");
    expect(group).toBeGreaterThan(-1);
    expect(leaders).toBeGreaterThan(-1);
    expect(group).toBeLessThan(leaders);
  });
});

describe("notices fold once read — on Today, and only there", () => {
  const items = [
    { id: "a", title: "Halfway house is open", body: "", pinned: false },
    { id: "b", title: "Carts on paths", body: "", pinned: false },
  ];

  it("shows every notice on the server render, so nothing is ever hidden by default", () => {
    // Folding needs the phone's memory; without it, every notice shows.
    const html = renderToStaticMarkup(<AnnouncementList items={items} foldSeen />);
    expect(html).toContain("Halfway house is open");
    expect(html).toContain("Carts on paths");
    expect(html).not.toContain("earlier message");
  });

  it("is asked for on Today's unpinned list and not on the pinned one or the dashboard", () => {
    const me = readSource("src/app/(player)/me/page.tsx");
    expect(me).toMatch(/filter\(\(a\) => !a\.pinned\)\} foldSeen/);
    expect(me).not.toMatch(/filter\(\(a\) => a\.pinned\)\} foldSeen/);
    expect(readSource("src/app/(app)/dashboard/page.tsx")).not.toContain("foldSeen");
  });
});

describe("the card's foot", () => {
  const card = (strokes: (number | null)[], over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <PlayerCard
        stageId="s1"
        playerId="p1"
        playerName="A. Moore"
        roundLabel="Round 1"
        holes={18}
        pars={new Array(18).fill(4)}
        yards={new Array(18).fill(400)}
        strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
        status="entered"
        initialStrokes={strokes}
        {...over}
      />,
    );

  it("holds both rule links in one folded Rules line", () => {
    const html = card(new Array(18).fill(4), { rulesHref: "/me/rules" });
    const rules = html.indexOf("Rules</summary>");
    expect(rules, "no Rules line").toBeGreaterThan(-1);
    expect(html.indexOf('href="/me/rules"')).toBeGreaterThan(rules);
    expect(html).toContain("This tournament’s rules");
    // The Rules of Golf citation is in the same fold.
    expect(html.indexOf("Rules of Golf")).toBeGreaterThan(rules);
  });

  it("prints no tournament-rules link when the caller gives none", () => {
    // Control for the above: the link comes from `rulesHref`, not from a
    // hard-coded path that would follow the card onto screens without one.
    expect(card(new Array(18).fill(4))).not.toContain('href="/me/rules"');
  });

  it("offers Certify only on a complete card", () => {
    expect(card([4, 4, 4, ...new Array(15).fill(null)])).not.toContain("Certify my card");
    expect(card(new Array(18).fill(4))).toContain("Certify my card");
  });
});
