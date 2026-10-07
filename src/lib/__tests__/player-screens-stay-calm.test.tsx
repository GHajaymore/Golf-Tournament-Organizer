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
const { MicNote, MIC_SHORT } = await import("@/components/MicNote");
const { cardTrustNote } = await import("@/lib/domain/card-trust");
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
  dayWords: "",
  deadlineWords: "",
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
    "src/components/MoreInfo.tsx",
    "src/components/CardTrustNote.tsx",
    "src/app/(player)/me/money/page.tsx",
    "src/app/(player)/me/calendar/page.tsx",
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

describe("a long sentence is a short line, the rest an ⓘ away", () => {
  /**
   * Ajay, 2026-10-05: "why don't we provide a short and long details where
   * long is an info icon away". The short line is what shows; the long text
   * stays in the page, folded, never removed.
   */
  const shortLine = (html: string) => (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();

  it("keeps the microphone's whole promise in the page, behind a short line", () => {
    const html = renderToStaticMarkup(<MicNote />);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)/);
    expect(shortLine(html)).toBe(MIC_SHORT);
    expect(html).toMatch(/never in the background/i);
  });

  it("holds every short line to ten words or fewer", () => {
    for (const s of [MIC_SHORT, "No side games in this tournament."]) {
      expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(10);
    }
  });

  it("asks Today's question in place of the instruction, and keeps the console's sentence", () => {
    const compact = renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={round("1", "2026-09-24")} future={[round("2", "2026-10-01")]} past={[]} compact />,
    );
    expect(compact).toContain("Are you playing?");
    expect(compact).not.toContain("Tap In or Out for each round.");
    // Control: the console's own card still prints the instruction as a sentence.
    const full = renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={round("1", "2026-09-24")} future={[round("2", "2026-10-01")]} past={[]} />,
    );
    expect(full).not.toContain("Are you playing?");
    expect(full).toContain("Say whether you");
  });

  it("gives every course-card warning a short line of its own", () => {
    const unchecked = cardTrustNote({ source: "imported", verifiedAt: null, verifiedBy: "" });
    expect(unchecked?.warn).toBe(true);
    expect(unchecked!.short.length).toBeLessThan(unchecked!.text.length / 2);
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

  it("puts the next round's question above the fold", () => {
    const answer = html.indexOf("I&#x27;m playing") >= 0 ? html.indexOf("I&#x27;m playing") : html.indexOf("I’m playing");
    const fold = html.indexOf("Your other rounds");
    expect(answer, "the next round has no answer to give").toBeGreaterThan(-1);
    expect(fold, "the season is not folded").toBeGreaterThan(-1);
    expect(answer).toBeLessThan(fold);
    // The OTHER rounds: the next one is already on screen above it.
    expect(html).toContain("Your other rounds (2)");
  });

  it("folds the calendar under it rather than dropping it", () => {
    // The calendar toggle is still there — inside the fold. Both indexes are
    // asserted present: a position compared against a missing anchor (-1)
    // passes whatever the order, which is how this test went vacuous once.
    const fold = html.indexOf("Your other rounds");
    const toggle = html.indexOf('name="avail-view"');
    expect(fold).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(fold);
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
    expect(one).not.toContain("Your other rounds");
    expect(one).toContain("Are you playing?");
  });
});

/**
 * THE NEXT ROUND, ASKED AS A GOLFER ASKS IT (Ajay, 2026-10-06) — the four
 * states of `NextRound`, and the rule that decided the design: an unanswered
 * round shows two EQUAL buttons, because filling the default would make an
 * assumption look like an answer.
 */
describe("Are you playing?", () => {
  const next = (over: Record<string, unknown> = {}) => ({
    ...round("1", "2026-09-24"),
    dateLabel: "Thu 24 Sep",
    label: "Round 2",
    dayWords: "Thursday",
    deadlineWords: "Wednesday",
    optDeadline: "2026-09-23",
    ...over,
  });
  const render = (r: ReturnType<typeof next>, asksPlayer = true) =>
    renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={r} future={[]} past={[]} asksPlayer={asksPlayer} compact />,
    ).replace(/&#x27;/g, "'");
  const buttonClasses = (html: string) =>
    [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(?:(?!<\/button>)[\s\S])*?(I’m playing|Can't make it)/g)].map((m) => m[1]);

  it("unanswered: says the default in words, and weighs both answers the same", () => {
    const html = render(next({ explicit: false, status: "in" }));
    expect(html).toContain("You’re down as playing until you say.");
    const classes = buttonClasses(html);
    expect(classes, "both answers are offered").toHaveLength(2);
    expect(new Set(classes).size, `one answer is weighted: ${classes.join(" | ")}`).toBe(1);
    expect(classes[0]).not.toMatch(/btn-primary/);
    expect(html).toContain("Answer by Wednesday");
    // The default the other way is said the other way.
    expect(render(next({ explicit: false, status: "out" }))).toContain("You’re down as not playing until you say.");
  });

  it("answered: one line, with the day, and a way to change it", () => {
    const html = render(next({ explicit: true, status: "in" }));
    expect(html).toContain("You're playing on Thursday");
    expect(html).toContain(">Change<");
    expect(buttonClasses(html), "the question is not asked again").toHaveLength(0);
    expect(render(next({ explicit: true, status: "out" }))).toContain("You're not playing on Thursday");
  });

  it("today and tomorrow stand alone; an undated round goes by its number", () => {
    expect(render(next({ explicit: true, dayWords: "tomorrow" }))).toContain("You're playing tomorrow");
    expect(render(next({ explicit: true, dayWords: "", dateLabel: "" }))).toContain("You're playing Round 2");
  });

  it("closed: the answer that stands, and who to ask", () => {
    const html = render(next({ explicit: false, locked: true }));
    expect(html).toContain("You're playing on Thursday");
    expect(html).toContain("Answers closed");
    expect(buttonClasses(html)).toHaveLength(0);
  });

  it("where the captain answers, a statement and nothing to press", () => {
    const sent = render(next({ explicit: true, status: "in" }), false);
    expect(sent).toContain("Your captain has you playing on Thursday");
    expect(buttonClasses(sent)).toHaveLength(0);
    expect(render(next({ explicit: false }), false)).toContain("Your captain hasn't sent the side in yet");
  });
});

describe("the tee time sits above the leaders on Today", () => {
  it("renders the group before the leaders board", () => {
    // Source order is render order here: both are top-level blocks of the
    // same fragment. "What time am I off" is asked before "who is leading".
    // Since 2026-10-06 the group card is built once (`groupCard`) and placed
    // twice — on the screen before the round, under More during it — and the
    // leaders likewise. The order holds in BOTH places, so it is pinned in both.
    const src = readSource("src/app/(player)/me/page.tsx");
    const body = src.slice(src.indexOf("  return ("));
    const onScreen = { group: body.indexOf("{groupOnScreen && groupCard}"), leaders: body.indexOf("{leadersOnScreen && leaders.length > 0") };
    const more = body.slice(body.indexOf("{moreLabel}"));
    const inMore = { group: more.indexOf("{!groupOnScreen && groupCard}"), leaders: more.indexOf("<ScoreboardLeaders") };
    for (const [where, at] of Object.entries({ onScreen, inMore })) {
      expect(at.group, `${where}: no group`).toBeGreaterThan(-1);
      expect(at.leaders, `${where}: no leaders`).toBeGreaterThan(-1);
      expect(at.group, `${where}: the leaders come first`).toBeLessThan(at.leaders);
    }
  });
});

/**
 * TODAY HAS NO BUTTON WHOSE ONLY JOB IS TO OPEN A TAB (2026-10-06).
 *
 * "See every match", "See every side", "See the draw", "See the board" — five
 * cards each carried a button to the Board tab, which the tab bar offers on
 * every screen. Ajay asked what "Every match" even was. A second way to the
 * same place is clutter on the screen kept to the moment. The position line
 * still links to the board: it is the player's position, content that opens.
 */
describe("Today does not repeat the tab bar", () => {
  const today = readSource("src/app/(player)/me/page.tsx");
  const cup = readSource("src/components/MyCup.tsx");
  const tabButtons = (src: string) =>
    [...src.matchAll(/className="btn[^"]*"[^>]*href="\/me\/(board|events|card|money)"|href="\/me\/(board|events|card|money)"[^>]*className="btn[^"]*"/g)].map((m) => m[0]);

  it("finds a tab button when there is one (control)", () => {
    expect(tabButtons('<Link className="btn btn-secondary" href="/me/board">See</Link>')).toHaveLength(1);
  });

  it("has none on Today or its cup card", () => {
    expect(tabButtons(today), "Today").toEqual([]);
    expect(tabButtons(cup), "MyCup").toEqual([]);
  });
});

/**
 * ONE RHYTHM (2026-10-06): blocks on Today sit 12px apart. They were 12, 14,
 * 16 and 18 depending on the card, which read as gaps — Ajay: "there is still
 * space gaps".
 */
describe("Today keeps one spacing between blocks", () => {
  it("sets no block margin other than the rhythm's", () => {
    const off = [...readSource("src/app/(player)/me/page.tsx").matchAll(/marginTop:\s*(14|16|18|20|24)\b/g)].map((m) => m[0]);
    expect(off).toEqual([]);
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
