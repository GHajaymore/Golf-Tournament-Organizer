import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/attendance", () => ({ setAttendance: async () => ({ ok: true }) }));

const { RoundAvailability } = await import("@/components/RoundAvailability");

/**
 * A LEAGUE WITH NO ROUND DATES SAYS WHY THERE IS NO CALENDAR.
 *
 * The club's Thursday league showed players a list where they expected the
 * availability calendar (2026-09-19), because its rounds had no dates — and
 * nothing said so, so it read as the app going back to the old screen.
 */
const round = (stageId: string, playedOn: string) => ({
  stageId,
  label: `Week ${stageId}`,
  playedOn,
  dateLabel: "",
  whenLabel: "",
  optDeadline: "",
  deadlineLabel: "",
  dayWords: "",
  deadlineWords: "",
  status: "in" as const,
  explicit: false,
  locked: false,
});

describe("availability for a season without dates", () => {
  it("says the rounds have no dates yet, and who can change that", () => {
    const html = renderToStaticMarkup(
      <RoundAvailability today="2026-09-19" playerId="p1" next={round("1", "")} future={[round("2", ""), round("3", "")]} past={[]} />,
    );
    expect(html).toContain("have dates yet");
    expect(html).toContain("organizer");
    expect(html, "no calendar toggle without dates").not.toContain("avail-view");
  });

  it("says nothing of the sort once the rounds are dated — the calendar is there", () => {
    const html = renderToStaticMarkup(
      <RoundAvailability
        today="2026-09-19"
        playerId="p1"
        next={round("1", "2026-09-24")}
        future={[round("2", "2026-10-01")]}
        past={[]}
      />,
    );
    expect(html).not.toContain("have dates yet");
    expect(html).toContain("avail-view");
  });
});

/**
 * AN UNDATED ROUND IS NAMED ONCE (2026-10-08, grid cell L3).
 *
 * Its title already names it by number — "Your captain has you out Week 2" —
 * and the line beneath repeated "Week 2" because, without a date, the round's
 * label was all it had to say. The muted line is only drawn when it adds
 * something; a dated round still gets its date there.
 */
describe("an undated round on the answered line", () => {
  const visible = (html: string) => html.replace(/<details[\s\S]*?<summary[^>]*>/g, "").replace(/<[^>]+>/g, " ");
  const count = (s: string, needle: string) => s.split(needle).length - 1;

  it("names the round once on a captain's answer", () => {
    const html = renderToStaticMarkup(
      <RoundAvailability
        today="2026-09-19"
        playerId="p1"
        asksPlayer={false}
        next={{ ...round("2", ""), status: "out", explicit: true }}
        future={[]}
        past={[]}
        compact
      />,
    );
    expect(html).toContain("Your captain has you out Week 2");
    expect(count(visible(html).split("Sent in by your captain")[0], "Week 2"), "the round named twice").toBe(1);
    expect(html).toContain("Sent in by your captain");
  });

  it("names it once on the player's own answer", () => {
    const html = renderToStaticMarkup(
      <RoundAvailability
        today="2026-09-19"
        playerId="p1"
        asksPlayer
        next={{ ...round("2", ""), status: "out", explicit: true }}
        future={[]}
        past={[]}
        compact
      />,
    );
    expect(html).toContain("not playing Week 2");
    expect(count(visible(html).split("Change")[0], "Week 2")).toBe(1);
  });
});
