import { describe, it, expect } from "vitest";
import { switcherFor, isWatching, openCardOf, type SwitchableRow } from "@/lib/domain/tournament-switcher";
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

  it("says which one has the member's card open, and puts it first", () => {
    // The seeded member on 2026-09-27: five live tournaments, five identical
    // "Playing now" lines, and his card open at the 12th in the last of them.
    const s = switcherFor(
      [
        row("twilight", "entered", { eventStatus: "live" }),
        row("league", "entered", { eventStatus: "live" }),
        row("medal", "entered", { eventStatus: "live", openCard: { thru: 11, complete: false } }),
        row("signing", "entered", { eventStatus: "live", openCard: { thru: 9, complete: true } }),
      ],
      null,
      false,
    );
    expect(s.others.map((o) => [o.eventId, o.note])).toEqual([
      ["medal", "You’re in · Your card · thru 11"],
      ["signing", "You’re in · Your card · to sign"],
      ["twilight", "You’re in · Playing now"],
      ["league", "You’re in · Playing now"],
    ]);
  });

  it("does not repeat the card on the tournament already on screen", () => {
    // Today, directly beneath, says "YOUR CARD · THRU 11" itself — the second
    // copy was found by e2e/player.spec.ts matching both.
    const s = switcherFor(
      [row("medal", "entered", { eventStatus: "live", openCard: { thru: 11, complete: false } })],
      "medal",
      false,
    );
    expect(s.current?.note).toBe("You’re in · Playing now");
  });
});

describe("a card that still needs its player", () => {
  const card = (holes: (number | null)[]) => JSON.stringify(holes);

  it("is one started and not finished, counted in holes", () => {
    expect(openCardOf(card([4, 5, 3, null, null, null, null, null, null]), 9, false)).toEqual({ thru: 3, complete: false });
  });

  it("is still open with every hole in, until it is signed", () => {
    expect(openCardOf(card([4, 4, 4, 4, 4, 4, 4, 4, 4]), 9, false)).toEqual({ thru: 9, complete: true });
  });

  it("counts the holes played, not the position — a card started on the 10th", () => {
    const back = [null, null, null, null, null, null, null, null, null, 4, 5, 4, null, null, null, null, null, null];
    expect(openCardOf(card(back), 18, false)).toEqual({ thru: 3, complete: false });
  });

  it("is nothing when blank, when the round is closed, or when the card will not read", () => {
    expect(openCardOf(card([null, null, null]), 3, false)).toBeNull();
    expect(openCardOf(card([4, 5]), 18, true)).toBeNull();
    expect(openCardOf("not json", 18, false)).toBeNull();
    expect(openCardOf("{}", 18, false)).toBeNull();
  });

  it("does not count past the round's own holes", () => {
    // A nine played off an eighteen-long array still finishes at nine.
    expect(openCardOf(card([...new Array(9).fill(4), ...new Array(9).fill(null)]), 9, false)).toEqual({
      thru: 9,
      complete: true,
    });
  });
});
