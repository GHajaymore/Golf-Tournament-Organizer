import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({ setQualifyPerGroup: vi.fn(), setQualifyMode: vi.fn() }));

import { QualControl } from "@/components/QualControl";

/**
 * TOP 16 OVERALL OF A FIELD OF TEN IS ALL TEN (2026-10-16; the tournament
 * director on the review panel). The draw takes everybody and gives byes, and
 * the knockout's card said "Top 16 overall" over a field that could never fill
 * it. It says so now — and only where it is true, since a number at least the
 * field takes everybody still in, whatever a cut has done.
 */
describe("the knockout's qualifying number, against the field", () => {
  const html = (overall: number, fieldSize: number) =>
    renderToStaticMarkup(<QualControl mode="overall" perFlight={2} overall={overall} fieldSize={fieldSize} />);

  it("says everybody goes in when the number is at least the field", () => {
    expect(html(16, 10)).toContain("10 are entered, so everybody goes into the knockout.");
    expect(html(10, 10)).toContain("everybody goes into the knockout");
  });

  it("CONTROL: says nothing when the number is smaller than the field, or nobody is entered", () => {
    expect(html(16, 24)).not.toContain("everybody goes into the knockout");
    expect(html(16, 0)).not.toContain("everybody goes into the knockout");
  });
});
