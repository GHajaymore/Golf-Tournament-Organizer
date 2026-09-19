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
