import { describe, expect, it } from "vitest";
import { withdrawWords } from "@/components/WithdrawButton";
import { readSource } from "./source";

/**
 * WITHDRAWING SAYS WHAT YOU ACTUALLY LOSE.
 *
 * Walked 2026-09-28 on the seeded club's Am-Am: a member on the WAITING LIST
 * pressed "Can't make it? Withdraw" and was asked "If the field is full, your
 * place goes to the next person on the waiting list", with "Keep my place" as
 * the way out. They had no place in the field — what they give up is their
 * spot in the queue, and leaving it hands nothing to anybody.
 */
describe("withdrawing tells each person what they give up", () => {
  it("somebody on the waiting list loses their spot in the queue, not a place", () => {
    const w = withdrawWords(true);
    expect(w.consequence).toMatch(/spot in the queue/);
    expect(`${w.consequence} ${w.keep} ${w.done}`).not.toMatch(/your place|my place/i);
    expect(w.keep).toBe("Stay on the list");
  });

  it("somebody awaiting approval is in no queue and holds no place", () => {
    const w = withdrawWords(true, true);
    expect(`${w.consequence} ${w.keep} ${w.done}`).not.toMatch(/queue|waiting list|your place|my place/i);
    expect(w.consequence).toMatch(/before it’s approved/);
  });

  it("CONTROL: somebody in the field is still told their place goes to the next person", () => {
    const w = withdrawWords(false);
    expect(w.consequence).toMatch(/your place goes to the next person/);
    expect(w.keep).toBe("Keep my place");
  });

  it("the Events card tells the button which of the two the member is", () => {
    // The default is the FIELD's words, so a caller that forgets the prop does
    // not fail — it quietly tells the waiting list about a place they lack.
    const src = readSource("src/components/ClubEventsList.tsx");
    const uses = src.split("<WithdrawButton").slice(1).map((rest) => rest.slice(0, rest.indexOf("/>")));
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      // A leading space, because "awaiting=" also contains "waiting=".
      expect(use).toContain(" waiting=");
      expect(use).toContain(" awaiting=");
    }
  });
});
