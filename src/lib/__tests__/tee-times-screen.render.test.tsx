import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/foursomes" }));

const { TeeTimesScreen } = await import("@/components/teetimes/TeeTimesScreen");
const { DRAW_SECTION_KEYS } = await import("@/lib/domain/draw-sections");

/**
 * TEE TIMES & DRAW, DRAWN (R9a): the head, the round's tabs and chip, "This round needs", and the sections
 * the machine's `drawSections` chose, in order, with the ones the page left out not drawn at all.
 */

const sections = {
  whoIn: { state: "6 in the field", node: <p>WHO-IN-BODY</p> },
  draw: { state: "Not drawn yet", node: <p>DRAW-BODY</p> },
  teeTimes: { state: "No tee times yet", node: <p>TEE-BODY</p> },
  onTheDay: { state: "Pins and pace", node: <p>DAY-BODY</p> },
  paper: { state: "From the saved sheet", node: <p>PAPER-BODY</p> },
};

function draw(over: Partial<Parameters<typeof TeeTimesScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <div style={{ width: 320 }}>
      <TeeTimesScreen
        kicker="Tee times"
        roundLabel="Round 2"
        roundChip={{ chip: "Not drawn yet", tone: "neutral" }}
        tabs={[
          { stageId: "r1", label: "Round 1 · Played" },
          { stageId: "r2", label: "Round 2 · Not drawn yet" },
        ]}
        activeStageId="r2"
        find={{ players: [], rounds: [], nextUnplayedId: "r2" }}
        needs={[{ key: "teeSheet", text: "Round 2 has no tee times, so players cannot see when they start.", href: "#teeTimes" }]}
        keys={DRAW_SECTION_KEYS}
        needsYou="draw"
        sections={sections}
        previewMode="build"
        {...over}
      />
    </div>,
  );
}

describe("TeeTimesScreen", () => {
  it("carries the one name, the stop's own kicker, Find a player, the round's chip and its tabs", () => {
    const html = draw();
    expect(html).toContain("Tee times &amp; draw");
    expect(html).toContain('class="page-kicker">Tee times<');
    expect(html).toContain('placeholder="Find a player"');
    expect(html).toContain('data-round-state="Not drawn yet"');
    expect(html).toContain("Round 1 · Played");
    expect(html).toContain("data-view-picker");
  });

  it("says what the round needs, each a link to the section that puts it right", () => {
    const html = draw();
    expect(html).toContain("This round needs");
    expect(html).toContain('href="#teeTimes"');
    expect(draw({ needs: [] })).not.toContain("This round needs");
  });

  it("while previewed, a link to another screen keeps the preview on; once the screen is on, links are plain", () => {
    const date = [{ key: "date", text: "Round 2 has no date.", href: "/stages?round=r2" }];
    const previewed = draw({ needs: date });
    expect(previewed).toContain("/stages?round=r2&amp;stepper=1&amp;build=1");
    const plain = draw({ needs: date, previewMode: null });
    expect(plain).toContain('href="/stages?round=r2"');
  });

  it("draws the sections in the TD's order, marks Needs you on one, and folds every line with its state", () => {
    const html = draw();
    const at = ["whoIn", "draw", "teeTimes", "onTheDay", "paper"].map((k) => html.indexOf(`data-section="${k}"`));
    expect(at.every((n) => n > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html.match(/Needs you/g)).toHaveLength(1);
    expect(html).toContain('data-section="draw" data-needs-you="true"');
    for (const state of ["6 in the field", "Not drawn yet", "No tee times yet", "Pins and pace", "From the saved sheet"]) expect(html).toContain(state);
  });

  it("a folded line is a button of 48px or more, and every section is drawn open before the script runs", () => {
    const html = draw();
    expect(html).toContain("min-height:48px");
    expect(html).not.toMatch(/id="draw-body"[^>]*hidden/);
  });

  it("a section the page left out is not drawn, and a person who is not staff gets no Find a player", () => {
    const html = draw({ sections: { ...sections, paper: undefined, whoIn: undefined }, find: null });
    expect(html).not.toContain('data-section="paper"');
    expect(html).not.toContain('data-section="whoIn"');
    expect(html).not.toContain('placeholder="Find a player"');
  });

  it("uses tokens, never a hard-coded colour, and lets every flex child shrink", () => {
    const src = [
      readSource("src/components/teetimes", "TeeTimesScreen.tsx"),
      readSource("src/components/setup", "SectionFold.tsx"),
      readSource("src/components/teetimes", "FindAPlayer.tsx"),
    ].join("\n");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgba?\(/);
    expect(src).toMatch(/minWidth: 0/);
  });
});

describe("the page: one panel of handicaps, one set of tabs", () => {
  const page = readSource("src/app/(app)/foursomes", "page.tsx");

  it("RoundHandicaps is mounted once here, inside the redesigned branch, and only when the screen is shown", () => {
    expect(page.match(/<RoundHandicaps\b/g)).toHaveLength(1);
    expect(page.indexOf("<RoundHandicaps")).toBeGreaterThan(page.indexOf('shown.has("teeTimes")'));
  });

  it("the old screen keeps its own round buttons; the new one hands the groups none (its tabs are the RoundPicker)", () => {
    expect(page).toMatch(/rounds=\{pickRounds \? roundTabs : \[\]\}/);
    expect(page).toMatch(/makerEl\(false\)/);
    expect(page).toMatch(/makerEl\(true\)/);
  });

  it("the draw section's banner asks the teeSheet scope, never draw (draw is in BLANKET: it would say Locked over a live medal's working controls)", () => {
    // `locksOf` puts `draw` in BLANKET, so on a launched stroke event it is locked by "launch"; only flight actions ask it.
    // The sheet's writers ask `teeSheetChangeAllowed`, which refuses only a COMPLETED event: that is the `teeSheet` scope.
    expect(page).toMatch(/scopeLockFor\(session\.eventId, "teeSheet"\)/);
    expect(page).not.toMatch(/scopeLockFor\([^)]*"draw"\)/);
  });

  it("the pairing requests stand outside the banner (setPairingRequest asks no lock), and the teeSheet need goes to the draw section", () => {
    expect(page.indexOf("{pairingEl}")).toBeLessThan(page.indexOf("<LockedOnce"));
    expect(page).toMatch(/n\.key === "teeSheet" \? "#draw"/);
    expect(page).not.toMatch(/"#teeTimes"/);
  });

  it("asks which screens are shown of the one service, and the layout of the sheet is chosen by drawSections", () => {
    expect(page).toMatch(/screensShownFor\(session\)/);
    expect(page).not.toMatch(/mergesShown\(/);
    expect(page).toMatch(/plan\?\.built/);
  });
});
