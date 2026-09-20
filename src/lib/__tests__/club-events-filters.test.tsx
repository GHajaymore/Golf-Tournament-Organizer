import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClubEventsList, FILTER_FROM } from "@/components/ClubEventsList";
import type { ClubEventRow } from "@/lib/services/club-events";

/**
 * THE EVENTS TAB SHOWS ITS FILTERS ONLY WHEN THERE IS SOMETHING TO FILTER.
 *
 * A club running one tournament gave its players a search box, a status menu
 * and "1 tournament" above the single card they had come for. Walked on the
 * player app at phone width, 2026-09-19.
 */

function row(i: number): ClubEventRow {
  return {
    eventId: `zz-ev-${i}`,
    name: `zz-filters Medal ${i}`,
    dates: "",
    startOn: "2026-05-14",
    playKind: "tournament",
    datesTentative: false,
    venue: "zz-filters Course",
    seriesName: "",
    eventStatus: "registration",
    statusLabel: "Open",
    statusDetail: "",
    entryDates: "",
    canEnter: true,
    entered: false,
    waiting: false,
    registrationHref: "",
    canView: false,
    viewLabel: "Leaderboard",
    band: "open",
    bandLabel: "Open",
    when: "upcoming",
    windowNote: "",
    yourStatus: "",
    progress: null,
    placesNote: "",
  };
}

const open = async () => {};
const html = (n: number) =>
  renderToStaticMarkup(
    <ClubEventsList events={Array.from({ length: n }, (_, i) => row(i))} openAction={open} />,
  );

describe("where this member stands", () => {
  /**
   * A MEMBER ON THE WAITING LIST IS TOLD SO, ON ANY BAND.
   *
   * The service has computed that sentence since #480. The card rendered it
   * inside the entry-window block, which shows only for "open" and "soon" — so
   * on a FULL tournament, which is exactly when somebody is waitlisted, it was
   * dropped. Read off the seeded club's Am-Am on 2026-09-19: "All 12 places
   * taken; further entries join the waitlist", and not a word about the fact
   * that this member was on it.
   */
  const waiting = "You’re on the waiting list — the organizer will confirm your place.";

  it("says so on a closed, full tournament", () => {
    const out = renderToStaticMarkup(
      <ClubEventsList
        events={[{ ...row(0), band: "closed", canEnter: false, yourStatus: waiting }]}
        openAction={open}
      />,
    );
    expect(out).toContain("waiting list");
  });

  it("says so while entries are still open, too", () => {
    const out = renderToStaticMarkup(
      <ClubEventsList events={[{ ...row(0), band: "open", yourStatus: waiting }]} openAction={open} />,
    );
    expect(out).toContain("waiting list");
  });

  it("says nothing about a member who is simply not entered", () => {
    // The line is about THEM. A card with no personal status must not grow a
    // blank one.
    const out = renderToStaticMarkup(
      <ClubEventsList events={[{ ...row(0), band: "closed", yourStatus: "" }]} openAction={open} />,
    );
    expect(out).not.toContain("waiting list");
  });
});

describe("dates a club has not fixed", () => {
  /**
   * SAID IN WORDS, on the line a member plans around.
   *
   * Ajay's rule, 2026-09-19: every tournament carries dates, and where the
   * committee has not settled them they are tentative rather than absent.
   * Launching requires dates (`launchRefusal`), so the honest answer had to
   * be available — and an honest answer nobody can see is not one.
   */
  const withDates = (over: Partial<ClubEventRow>) =>
    renderToStaticMarkup(
      <ClubEventsList events={[{ ...row(0), dates: "14–15 June", ...over }]} openAction={open} />,
    );

  it("says so beside the dates", () => {
    expect(withDates({ datesTentative: true })).toContain("Tentative");
  });

  it("says nothing when the club has fixed them", () => {
    const out = withDates({ datesTentative: false });
    expect(out).toContain("14–15 June");
    expect(out).not.toContain("Tentative");
  });

  it("does not label an empty date tentative", () => {
    // "Dates to be confirmed" already says it, and a chip beside it would be
    // the same fact twice. The venue is cleared too, because the card joins
    // the two and only falls back when it has neither.
    const out = withDates({ dates: "", venue: "", datesTentative: true });
    expect(out).toContain("Dates to be confirmed");
    expect(out).not.toContain("Tentative");
  });
});

describe("the Events tab's filters", () => {
  it("are not offered over a single tournament", () => {
    const out = html(1);
    expect(out).toContain("zz-filters Medal 0");
    expect(out).not.toContain('aria-label="Filter tournaments"');
  });

  it("are not offered just below the threshold", () => {
    expect(html(FILTER_FROM - 1)).not.toContain('aria-label="Filter tournaments"');
  });

  it("appear once the list is long enough to need them", () => {
    const out = html(FILTER_FROM);
    expect(out).toContain('aria-label="Filter tournaments"');
    expect(out).toContain(`${FILTER_FROM} tournaments`);
  });
});
