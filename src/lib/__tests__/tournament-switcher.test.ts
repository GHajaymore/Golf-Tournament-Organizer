import { describe, it, expect } from "vitest";
import { switcherFor, isWatching, type SwitchableRow } from "@/lib/domain/tournament-switcher";
import { BAND_LABEL, type EventBand } from "@/lib/domain/club-event-card";

const row = (eventId: string, band: EventBand, over: Partial<SwitchableRow> = {}): SwitchableRow => ({
  eventId,
  name: `zz-${eventId}`,
  band,
  bandLabel: BAND_LABEL[band],
  entered: band === "entered",
  canView: true,
  ...over,
});

describe("the tournament switcher", () => {
  it("names the tournament on screen and says the member is watching one they are not in", () => {
    const s = switcherFor([row("medal", "entered"), row("cup", "live")], "cup", false);
    // `waiting` joined the shape on 2026-09-20, when a member on the waiting
    // list stopped being called a spectator — see `waiting-is-not-watching`.
    // Asserted here rather than loosened: this is the one place that pins the
    // whole object, and a field arriving unnoticed is what it exists to stop.
    expect(s.current).toEqual({
      eventId: "cup",
      name: "zz-cup",
      note: "Watching · On now",
      watching: true,
      waiting: false,
    });
  });

  it("does not call a member watching a tournament they are in", () => {
    const s = switcherFor([row("medal", "entered")], "medal", false);
    expect(s.current?.watching).toBe(false);
    expect(s.current?.note).toBe("You’re in");
  });

  it("never calls staff watching — an organizer in the player view is running it", () => {
    const s = switcherFor([row("cup", "live")], "cup", true);
    expect(s.current?.watching).toBe(false);
    expect(s.current?.note).toBe("On now");
  });

  it("says a finished tournament the member played in was theirs", () => {
    const s = switcherFor([row("old", "finished", { entered: true })], null, false);
    expect(s.others[0].note).toBe("You’re in · Finished");
  });

  it("leaves the current tournament out of the list of places to go", () => {
    const s = switcherFor([row("medal", "entered"), row("cup", "live")], "medal", false);
    expect(s.others.map((o) => o.eventId)).toEqual(["cup"]);
  });

  it("leaves out a tournament with nothing to look at that the member is not in", () => {
    const s = switcherFor(
      [row("draft", "closed", { canView: false }), row("mine", "open", { entered: true, canView: false })],
      null,
      false,
    );
    expect(s.others.map((o) => o.eventId)).toEqual(["mine"]);
  });

  it("orders the rest the way the events list does — the member's own first, finished last", () => {
    const s = switcherFor(
      [row("done", "finished"), row("open", "open"), row("mine", "entered"), row("now", "live")],
      null,
      false,
    );
    expect(s.others.map((o) => o.eventId)).toEqual(["mine", "now", "open", "done"]);
  });

  it("has no current tournament when the active one is not in the member's list", () => {
    expect(switcherFor([row("cup", "live")], "elsewhere", false).current).toBeNull();
    expect(switcherFor([row("cup", "live")], null, false).current).toBeNull();
  });

  it("says which of the player's own tournaments is being played now, and puts it first", () => {
    // The club's ask: a player in several tournaments picks the one they are playing.
    const s = switcherFor(
      [
        row("league", "entered", { eventStatus: "draft" }),
        row("medal", "entered", { eventStatus: "live" }),
        row("cup", "live"),
      ],
      null,
      false,
    );
    expect(s.others.map((o) => [o.eventId, o.note])).toEqual([
      ["medal", "You’re in · Playing now"],
      ["league", "You’re in"],
      ["cup", "Watching · On now"],
    ]);
  });

  it("isWatching needs a row", () => {
    expect(isWatching(null, false)).toBe(false);
  });
});
