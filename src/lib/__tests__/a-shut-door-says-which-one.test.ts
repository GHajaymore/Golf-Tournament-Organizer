import { describe, it, expect } from "vitest";
import { eventBand, bandLabelFor, BAND_LABEL, type EventBand } from "@/lib/domain/club-event-card";

/**
 * A SHUT DOOR SAYS WHICH DOOR IT IS.
 *
 * `closed` is the catch-all band — full with no waiting list, past the
 * deadline, shut by the organizer, or never opened to self entry — and it was
 * labelled "Closed" for all four. A member could not tell whether to come back
 * later, ask for a place, or give up.
 *
 * The distinction was never missing from the data: `registrationStatus` returns
 * seven states and the band discarded six of them. Ajay, 2026-09-21: "not all
 * tournaments have a waiting list so we may have to use the status label
 * differently — like Registration closed, On the waiting list."
 */

const shut = (regState: string) =>
  bandLabelFor(
    eventBand({ eventStatus: "registration", regState, canEnter: false, entered: false }),
    regState,
  );

describe("the label says which door is shut", () => {
  it("says Full, or Entries closed, and nothing more elaborate", () => {
    /**
     * TWO, not four. A member only ever needs to know which of two things to
     * do: ask about a place, or wait for the next one. Past the deadline,
     * stopped by the club and never opened are three shades of the second, and
     * naming them separately is detail with no decision attached.
     */
    expect(shut("full")).toBe("Full");
    expect(shut("closed-deadline")).toBe("Entries closed");
    expect(shut("closed-manual")).toBe("Entries closed");
    expect(shut("")).toBe("Entries closed");
  });

  it("does not call a full tournament closed", () => {
    /**
     * THE ONE THAT MATTERS MOST. A full tournament is the one a member might
     * ask about, and an organizer who later adds a waiting list or a place is
     * answering a question the word "closed" tells them not to ask.
     */
    expect(shut("full")).not.toMatch(/closed/i);
  });

  it("leaves every other band's wording alone", () => {
    // THE CONTROL: this changes the CLOSED band only. A band that is not shut
    // takes its label from the table exactly as before.
    for (const band of ["entered", "waiting", "open", "soon", "live", "finished"] as EventBand[]) {
      expect(bandLabelFor(band, "anything"), band).toBe(BAND_LABEL[band]);
    }
  });

  it("gives the member's own standing before any reason a door is shut", () => {
    /**
     * A waiting-list place is not a shut door, and it outranks one. This is the
     * defect Ajay found first: `club-events.ts` knew he was waiting, and the
     * band said CLOSED over a card reading "You're on the waiting list".
     */
    const waiting = eventBand({
      eventStatus: "registration",
      regState: "full",
      canEnter: false,
      entered: false,
      waiting: true,
    });
    expect(waiting).toBe("waiting");
    expect(bandLabelFor(waiting, "full")).toBe("On the waiting list");
  });

  it("still says Finished when the golf is over, whatever entries did", () => {
    // The two axes, which is the question that started this: FINISHED is about
    // play, the rest are about entry.
    const band = eventBand({
      eventStatus: "completed",
      regState: "closed-finished",
      canEnter: false,
      entered: false,
    });
    expect(bandLabelFor(band, "closed-finished")).toBe("Finished");
  });
});
