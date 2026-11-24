import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { playByFormRounds } from "@/lib/domain/knockout-play-by";
import type { BracketView } from "@/lib/domain/bracket";

vi.mock("@/app/actions/tournament", () => new Proxy({}, { get: (_t, k) => (typeof k === "string" && k !== "then" ? async () => ({ ok: true }) : undefined) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { LockedOnce } = await import("@/components/setup/LockedOnce");
const { ThirdPlaceControl } = await import("@/components/ThirdPlaceControl");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const { launched, FAMILY_FIXTURES } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * A GREYED SWITCH SAYS WHY, AND HOW TO GET OUT (R9c review; lock-scopes.md "On screen").
 *
 * `setThirdPlace` asks the `rounds` scope, which a live knockout has shut by launch. The switch is greyed on Tee times & draw, so the
 * section's one banner must carry the rounds lock with its reason and its way out beside it; a greyed control with no words stops the person.
 */
describe("the play-off for third place, greyed on a live knockout, is explained on Tee times & draw", () => {
  it("a live knockout with no correction: the switch is disabled and the banner draws the reason and the way out", () => {
    const lock = scopeLockOf(locksFor(launched(FAMILY_FIXTURES.knockout())), "rounds");
    expect(lock, "a live knockout has its rounds scope shut").not.toBeNull();
    const html = renderToStaticMarkup(
      <LockedOnce locks={[lock!]} isAdmin correction={null} open={null}>
        {(locked) => <ThirdPlaceControl stageId="s1" on={false} problem="" aName="" bName="" made={false} locked={locked} />}
      </LockedOnce>,
    );
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html).toContain(lock!.because);
    expect(html, "no way out beside the greyed switch").toMatch(/correction|Correct|Open/i);
  });

  it("the page hands the section's one banner the rounds lock and its correction whenever the switch or the lineup is drawn", () => {
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(page).toMatch(/screenLocksFor\(session\.eventId, \["rounds"\]\)/);
    expect(page).toMatch(/\.\.\.roundsFacts\.locks\]/);
    expect(page).toMatch(/correction=\{bracketControls \|\| lineupHere \? roundsFacts\.correction : null\}/);
    // Flights first, and the knockout's controls sit INSIDE the banner's render prop, under it.
    expect(page.indexOf("const sectionLocks = [...(flightsLock")).toBeGreaterThan(0);
    expect(page.indexOf("{knockoutEl}")).toBeGreaterThan(page.indexOf("<LockedOnce locks={sectionLocks}"));
  });

  it("the play-by dates come above the play-off for third, flights first", () => {
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    const at = (needle: string) => page.indexOf(needle);
    expect(at("{setup.flights && <BracketFlights")).toBeLessThan(at("{setup.playBy && ("));
    expect(at("{setup.playBy && (")).toBeLessThan(at("{setup.thirdPlace && ("));
  });
});

describe("playByFormRounds, with THREE flights", () => {
  const view = (labels: string[]) => ({ rounds: labels.map((label) => ({ label })) }) as unknown as BracketView;
  it("asks a day for each round of the LONGEST draw, counted back from the final, however many flights and in whatever order", () => {
    const small = view(["Semi-finals", "Final"]);
    const big = view(["Round 1", "Quarter-finals", "Semi-finals", "Final"]);
    const middle = view(["Quarter-finals", "Semi-finals", "Final"]);
    // Worked by hand: the longest (the middle flight of the three) has four rounds, so the final is 0 back and Round 1 is 3 back.
    const want = [
      { fromFinal: 3, label: "Round 1" },
      { fromFinal: 2, label: "Quarter-finals" },
      { fromFinal: 1, label: "Semi-finals" },
      { fromFinal: 0, label: "Final" },
    ];
    expect(playByFormRounds([{ view: small }, { view: big }, { view: middle }], small)).toEqual(want);
    expect(playByFormRounds([{ view: middle }, { view: small }, { view: big }], small)).toEqual(want);
    // No draws at all: the winners bracket stands in.
    expect(playByFormRounds([], middle).map((r) => r.fromFinal)).toEqual([2, 1, 0]);
  });
});
