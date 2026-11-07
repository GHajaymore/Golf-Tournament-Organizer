import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * REGISTRATION LISTS WHO WITHDREW (2026-10-09, grid cell T45).
 *
 * Removing a player who has already played keeps their row as withdrawn — the
 * screen says "their results are kept" — and then the organizer's field page
 * showed them nowhere: not confirmed, not waitlisted. A DQ had its own line; a
 * withdrawal had none, so the committee could not see who had gone.
 */
describe("the field page", () => {
  const src = () => readSource("src/app/(app)/registration/page.tsx");

  it("reads the withdrawn rows", () => {
    expect(src()).toMatch(/state\.players\.filter\(\(p\) => p\.status === "withdrawn"\)/);
  });

  it("draws them, and only when there are some", () => {
    // In its own client component since day-of field changes (PR A), for Put back.
    expect(src()).toMatch(/<WithdrawnList withdrawn=\{withdrawn\} door=\{doors\.reinstate\} \/>/);
    const list = readSource("src/components/WithdrawnList.tsx");
    expect(list).toMatch(/if \(withdrawn\.length === 0\) \{\s*return said \?/);
    expect(list).toMatch(/aria-label="Withdrawn"/);
    // Each with Put back, behind the field rule's door.
    expect(list).toMatch(/disabled=\{pending \|\| !!door\}/);
    expect(list).toMatch(/reinstateWithdrawn\(p\.id\)/);
  });
});
