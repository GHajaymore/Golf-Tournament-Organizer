import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeZonePicker } from "@/components/TimeZonePicker";
import { OrgProfileProvider } from "@/components/OrgProfileProvider";
import { readSource } from "./source";

vi.mock("@/app/actions/organization", () => ({
  saveOrganizationTimeZone: async () => ({ ok: true, clock: "" }),
}));

/**
 * THE CLUB'S TIME ZONE, ON CLUB SETTINGS (2026-10-11).
 *
 * What the organizer is shown is the TIME, because a time is the only thing
 * about a zone they can check — and it is handed in by the server as words,
 * because a clock read while drawing is read twice and the two readings differ.
 */
const ZONES = ["America/Chicago", "America/New_York", "America/Argentina/Buenos_Aires", "Europe/London", "Pacific/Auckland", "UTC"];

const draw = (timeZone: string, clock: string, kind: "club" | "community" = "club") =>
  renderToStaticMarkup(
    <OrgProfileProvider kind={kind} country="US" noun={undefined}>
      <TimeZonePicker timeZone={timeZone} zones={ZONES} clock={clock} />
    </OrgProfileProvider>,
  );

describe("the time zone on Club settings", () => {
  it("shows the time at the club and says what it governs", () => {
    const html = draw("America/New_York", "Sunday 11 October at 09:05");
    expect(html).toContain("Sunday 11 October at 09:05");
    expect(html).toMatch(/closing\s+date ends at midnight on this clock/);
    expect(html).toMatch(/<option value="America\/New_York" selected="">New York<\/option>/);
  });

  it("says so in words when the club has not said where it is", () => {
    const html = draw("", "");
    expect(html).toContain("Not set yet");
    expect(html).toMatch(/closing dates end at midnight UTC/);
    // No time is invented for a club with no zone.
    expect(html).not.toMatch(/It is <b/);
  });

  it("the word Time zone belongs to the box, not to something else", () => {
    const html = draw("Europe/London", "Sunday 11 October at 14:05");
    expect(html).toMatch(/<label for="club-time-zone"/);
    expect(html).toMatch(/<select id="club-time-zone"/);
  });

  it("groups the list by region and names a city the way it is said", () => {
    const html = draw("Europe/London", "x");
    expect(html).toContain('<optgroup label="America">');
    expect(html).toContain('<optgroup label="Europe">');
    expect(html).toContain(">Buenos Aires (Argentina)</option>");
    expect(html).toContain(">New York</option>");
    // A zone with no region still has a home.
    expect(html).toContain('<optgroup label="Other">');
  });

  it("shows a stored zone its own list does not carry, rather than a different place", () => {
    // India is Asia/Calcutta to one runtime and Asia/Kolkata to another; a
    // browser may hand over either, and the control must show what is in force.
    const html = draw("Asia/Kolkata", "Sunday 11 October at 18:35");
    expect(html).toMatch(/<option value="Asia\/Kolkata" selected="">Kolkata<\/option>/);
  });

  it("uses the outfit's own word for itself", () => {
    expect(draw("Europe/London", "Sunday at 14:05", "community")).not.toMatch(/at the club\b/);
    expect(draw("Europe/London", "Sunday at 14:05", "club")).toMatch(/at the club\b/);
  });

  it("does not read a clock while drawing", () => {
    // The device's zone is read in an effect; the time comes from the server.
    const src = readSource("src", "components", "TimeZonePicker.tsx");
    expect(src).not.toContain("new Date(");
    expect(src).not.toContain("Date.now(");
    const firstEffect = src.indexOf("useEffect(");
    expect(firstEffect).toBeGreaterThan(0);
    expect(src.indexOf("resolvedOptions()"), "the device's zone is read outside an effect").toBeGreaterThan(firstEffect);
  });
});
