import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/prizes" }));
vi.mock("@/app/actions/tournament", () => {
  const act = async () => ({ ok: true });
  return { addPrize: act, updatePrize: act, setPrizeWinner: act, removePrize: act, applyPrizeStructure: act, setOnePrizePerPlayer: act, setPrizeCounts: act };
});

const { PrizesClient } = await import("@/components/PrizesClient");

/**
 * THE PRIZE TABLE IS DRAWN BY HALVES, AND EACH CONTROL IS ON ONE SCREEN ONLY (R8b).
 *
 * Prizes & side games draws the OFFER half (the lines, their amounts, remove, the one-prize rule), Winners & money the SETTLE
 * half (who won each line). `prizeTableHalf` is the function; this is the DRAW: a winner picker is in exactly one of the two
 * renders, an amount box and a Remove in exactly the other, and drawing the table whole (the old screen) is exactly their union.
 */
const prizes = [{ id: "p1", category: "Club Champion", detail: "The Hollow Salver", amount: 250, winnerId: "a", counts: true }];
const players = [{ id: "a", name: "Zz Player", place: 1 }];

const draw = (part?: "both" | "offer" | "settle") =>
  renderToStaticMarkup(<PrizesClient part={part} prizes={prizes} players={players} onePrizePerPlayer />);

const count = (html: string, needle: string) => html.split(needle).length - 1;
const controls = (html: string) => ({
  winner: count(html, 'aria-label="Winner of Club Champion"'),
  amount: count(html, 'aria-label="Amount for Club Champion"'),
  remove: count(html, 'title="Remove prize"'),
  rule: (html.match(/<input type="checkbox"(?![^>]*aria-label)/g) ?? []).length,
  counts: count(html, "counts toward one prize per player"),
});

describe("each prize control is drawn on one half only", () => {
  const offer = controls(draw("offer"));
  const settle = controls(draw("settle"));
  const both = controls(draw());

  it("a winner picker is on the settle half only", () => {
    expect(offer.winner, "the offer half draws a winner picker").toBe(0);
    expect(settle.winner, "the settle half draws no winner picker").toBeGreaterThan(0);
  });

  it("an amount box, Remove, the one-prize rule and the counts switch are on the offer half only", () => {
    for (const c of ["amount", "remove", "rule", "counts"] as const) {
      expect(offer[c], `the offer half does not draw ${c}`).toBeGreaterThan(0);
      expect(settle[c], `the settle half draws ${c}`).toBe(0);
    }
  });

  it("the whole table (the old screen, and a mount that says nothing) is exactly the two halves together", () => {
    for (const c of ["winner", "amount", "remove", "rule", "counts"] as const) expect(both[c], c).toBe(offer[c] + settle[c]);
    expect(draw("both")).toBe(draw());
  });

  it("CONTROL: the counter sees a control that is drawn", () => {
    expect(controls('<select aria-label="Winner of Club Champion"></select>').winner).toBe(1);
    expect(controls("<p></p>").winner).toBe(0);
  });
});
