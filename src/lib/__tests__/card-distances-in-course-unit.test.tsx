import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScorecardTable } from "@/components/ScorecardTable";
import { HoleByHoleCard } from "@/components/HoleByHoleCard";
import { DistanceUnitProvider, useClubDistanceWords, useDistanceWords } from "@/components/DistanceUnitProvider";
import { readSource } from "./source";

/**
 * A CARD'S DISTANCES ARE LABELLED IN ITS COURSE'S UNIT (decision 15).
 *
 * Every card said "Yards", so a German club's own card read its 150 m par 3 as
 * 150 yards. The label comes from the nearest `DistanceUnitProvider`; with none
 * it stays "Yards", which is what every card said before.
 */
const pars = new Array(18).fill(4);
const si = Array.from({ length: 18 }, (_, i) => i + 1);
const yards = new Array(18).fill(150);
const strokes = new Array(18).fill(null) as (number | null)[];

const table = () => <ScorecardTable holes={18} pars={pars} yards={yards} strokeIndex={si} strokes={strokes} />;
const byHole = () => (
  <HoleByHoleCard holes={18} pars={pars} yards={yards} strokeIndex={si} players={[{ id: "p1", name: "zz-Ann" }]}
    cards={{ p1: strokes }} onSet={() => {}} />
);

describe("the card's distance row", () => {
  it("says Metres on a course measured in metres", () => {
    const html = renderToStaticMarkup(<DistanceUnitProvider unit="metres">{table()}</DistanceUnitProvider>);
    expect(html).toContain(">Metres<");
    expect(html).not.toContain(">Yards<");
  });

  it("CONTROL: says Yards on a course in yards, and with no provider at all", () => {
    expect(renderToStaticMarkup(<DistanceUnitProvider unit="yards">{table()}</DistanceUnitProvider>)).toContain(">Yards<");
    expect(renderToStaticMarkup(table())).toContain(">Yards<");
  });

  it("the hole-by-hole card writes the suffix in the same unit", () => {
    expect(renderToStaticMarkup(<DistanceUnitProvider unit="metres">{byHole()}</DistanceUnitProvider>)).toContain("150 m");
    expect(renderToStaticMarkup(byHole())).toContain("150 yds");
  });
});

describe("a form for a NEW course inside a round's card says the club's unit", () => {
  function Probe() {
    return <span>{useDistanceWords().row}|{useClubDistanceWords().row}</span>;
  }

  it("a card screen overrides the card, and keeps the club", () => {
    // A British club (yards) playing an away round in France (metres): the
    // card says Metres, a "new venue" form nested inside still says Yards.
    const html = renderToStaticMarkup(
      <DistanceUnitProvider unit="yards" club="yards">
        <DistanceUnitProvider unit="metres"><Probe /></DistanceUnitProvider>
      </DistanceUnitProvider>,
    );
    expect(html).toContain("Metres|Yards");
  });
});

describe("every screen that shows a round's card says which course it is on", () => {
  // The default is Yards, so a screen that forgets the provider does not fail —
  // it quietly labels a metric card in yards. Each one is named.
  for (const file of [
    "src/app/(player)/me/card/page.tsx",
    "src/app/play/page.tsx",
    "src/components/EntryModes.tsx",
  ]) {
    it(file, () => {
      const src = readSource(file);
      expect(src).toContain("<DistanceUnitProvider unit=");
    });
  }
});
