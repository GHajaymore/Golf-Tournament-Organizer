import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * SCORE ENTRY'S HEADER WRAPS ON A PHONE.
 *
 * Its caption — "Stableford · Braid Hollow — Championship Course · 2026-…" —
 * was `white-space: nowrap`. With a real course name that line is ~530px, and
 * it dragged the round tabs and the hole buttons past the edge of the screen:
 * at 393px Score entry scrolled sideways by 85–170px on six of the eleven
 * seeded tournaments (measured 2026-09-26), on the screen an organizer uses
 * standing on the course.
 *
 * `e2e/layout.spec.ts` measures overflow on every route at phone widths, and
 * missed it because the e2e fixture's course name is short enough to fit. A
 * fixture cannot carry every course name, so the cause is pinned instead.
 * After the fix all eleven measured clean at 393 and 320.
 */
describe("Score entry's round caption", () => {
  const src = readSource("src/components/EntryModes.tsx");
  const at = src.indexOf('<Icon name="map-pin"');
  const span = src.slice(src.lastIndexOf("<span", at), at);

  it("is found (control)", () => {
    expect(at).toBeGreaterThan(0);
    expect(span).toContain('className="text-muted"');
  });

  it("is allowed to wrap", () => {
    expect(span).not.toMatch(/nowrap/);
    expect(span).toMatch(/minWidth: 0/);
  });
});
