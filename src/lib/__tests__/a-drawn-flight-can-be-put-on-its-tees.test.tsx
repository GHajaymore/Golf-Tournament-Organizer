import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/courses", () => ({ setFlightTee: async () => ({ ok: true }) }));

const { FlightTeeSelect } = await import("@/components/FlightTeeSelect");

/**
 * A FLIGHT THE APP DREW CAN BE PUT ON ITS TEES (2026-10-10).
 *
 * "Each flight plays its own tees" is how a club runs divisions off different
 * sets. The control naming a flight's set was only on `FlightBoard` — shown
 * only under the Manual rule — so a club that let the app draw its handicap
 * divisions could turn the policy on and had nowhere to set a flight's tees.
 * Found setting up a three-division net medal with the third off the reds.
 */
const tees = [
  { id: "t-white", name: "White" },
  { id: "t-red", name: "Red" },
];

describe("the tees a drawn flight plays", () => {
  it("is a labelled choice of the course's sets, the round's own first", () => {
    const html = renderToStaticMarkup(
      <FlightTeeSelect groupId="g3" label="Flight C" teeId="t-red" tees={tees} defaultTeeName="White (round’s)" />,
    );
    expect(html).toContain('aria-label="Tees for Flight C"');
    expect(html).toMatch(/<option value="">White \(round’s\)<\/option>/);
    expect(html).toMatch(/<option value="t-red" selected="">Red<\/option>/);
  });

  it("is on the Flights screen's generated flights, wherever a flight's tees are read", () => {
    const page = readSource("src/app/(app)/grouping/page.tsx");
    // In the grid the app draws — the branch that is NOT the Manual board.
    const grid = page.slice(page.indexOf("cards.map((g) => ("));
    expect(grid).toMatch(/\{byFlightTees && eventTees\.length > 0 && \(\s*<FlightTeeSelect/);
    // RE-PINNED 2026-10-10. This required `teePolicy === "flight"` — "under
    // the by-flight policy only" — and that was the defect: a flight's tees
    // also price its unassigned players where players are put on a set one by
    // one, and there the control was not drawn. The guarantee is that it is
    // drawn by the scorer's own answer (`flightTeeCounts`, pinned to
    // `teeIdFor` in a-players-tees-are-offered-only-where-they-count).
    expect(page).toMatch(/const byFlightTees = flightTeeCounts\(settingsOf\(state\.event\)\.teePolicy\);/);
  });

  it("CONTROL: the organizer's only — a locked setup or an assistant gets it disabled", () => {
    const page = readSource("src/app/(app)/grouping/page.tsx");
    expect(page).toMatch(/disabled=\{locked \|\| session\.viewRole !== "admin"\}/);
    const html = renderToStaticMarkup(
      <FlightTeeSelect groupId="g3" label="Flight C" teeId={null} tees={tees} defaultTeeName="" disabled />,
    );
    expect(html).toMatch(/<select[^>]*disabled=""/);
  });
});
